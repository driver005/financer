#include "nextcloud/runner/http_server.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <chrono>
#include <cstring>

#include "nextcloud/util/text.h"

namespace nc {

Result<RequestHead> parse_request_head(std::string_view raw)
{
    const std::size_t end = raw.find("\r\n\r\n");
    if (end == std::string_view::npos) {
        return fail(ErrorCode::INVALID_ARGUMENT, "incomplete head");
    }
    RequestHead head;
    head.head_size = end + 4;
    const std::vector<std::string> lines = util::split(raw.substr(0, end), '\n');
    const std::vector<std::string> start = util::split(util::trim(lines.front()), ' ');
    if (start.size() != 3 || !util::starts_with(start[2], "HTTP/1.")) {
        return fail(ErrorCode::INVALID_ARGUMENT, "bad request line");
    }
    head.method = start[0];
    head.target = start[1];
    for (std::size_t index = 1; index < lines.size(); ++index) {
        const std::string_view line = util::trim(lines[index]);
        const std::size_t colon = line.find(':');
        if (colon == std::string_view::npos || colon == 0) {
            return fail(ErrorCode::INVALID_ARGUMENT, "bad header line");
        }
        head.headers.emplace_back(std::string{util::trim(line.substr(0, colon))}, std::string{util::trim(line.substr(colon + 1))});
    }
    if (!http::find_pair(head.headers, "Transfer-Encoding").empty()) {
        return fail(ErrorCode::INVALID_ARGUMENT, "chunked requests are not supported");
    }
    const std::string_view length = http::find_pair(head.headers, "Content-Length");
    if (!length.empty()) {
        std::size_t value = 0;
        for (const char digit : length) {
            if (digit < '0' || digit > '9' || value > (SIZE_MAX / 10)) {
                return fail(ErrorCode::INVALID_ARGUMENT, "bad Content-Length");
            }
            value = value * 10 + static_cast<std::size_t>(digit - '0');
        }
        head.content_length = value;
    }
    return head;
}

http::Request request_from_head(const RequestHead& head, std::string&& body)
{
    const std::size_t question = head.target.find('?');
    std::string path = head.target.substr(0, question);
    // Absolute-form targets ("GET http://host/path") are reduced to the path.
    if (util::starts_with(path, "http://") || util::starts_with(path, "https://")) {
        const std::size_t slash = path.find('/', path.find("//") + 2);
        path = slash == std::string::npos ? "/" : path.substr(slash);
    }
    std::string query = question == std::string::npos ? std::string{} : head.target.substr(question + 1);
    http::Request request{std::string{head.method}, std::move(path), std::move(query), std::move(body), {}, {}, {}};
    request.set_headers(std::vector<http::Header>(head.headers));
    return request;
}

std::string serialize_response(const http::Response& response)
{
    std::string out = "HTTP/1.1 " + std::to_string(response.get_status()) + " " + std::string(http::reason_phrase(response.get_status())) + "\r\n";
    bool has_length = false;
    for (const http::Header& header : response.get_headers()) {
        has_length = has_length || util::equals_ignore_case(header.first, "Content-Length");
        out += header.first + ": " + header.second + "\r\n";
    }
    if (!response.get_content_type().empty()) {
        out += "Content-Type: " + response.get_content_type() + "\r\n";
    }
    if (!has_length) {
        out += "Content-Length: " + std::to_string(response.get_body().size()) + "\r\n";
    }
    out += "Connection: close\r\n\r\n";
    out += response.get_body();
    return out;
}

namespace {

bool write_all(int fd, std::string_view data) noexcept
{
    while (!data.empty()) {
        const ssize_t written = ::send(fd, data.data(), data.size(), MSG_NOSIGNAL);
        if (written < 0) {
            if (errno == EINTR) {
                continue;
            }
            return false;
        }
        data.remove_prefix(static_cast<std::size_t>(written));
    }
    return true;
}

}  // namespace

HttpServer::~HttpServer()
{
    stop();
}

Result<std::uint16_t> HttpServer::start(const std::string& address, std::uint16_t port)
{
    if (m_running) {
        return fail(ErrorCode::ALREADY_EXISTS, "the server is already listening");
    }
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        return fail(ErrorCode::IO, std::string("socket: ") + std::strerror(errno));
    }
    const int reuse = 1;
    ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    sockaddr_in socket_address{};
    socket_address.sin_family = AF_INET;
    socket_address.sin_port = htons(port);
    if (::inet_pton(AF_INET, address.c_str(), &socket_address.sin_addr) != 1) {
        ::close(fd);
        return fail(ErrorCode::INVALID_ARGUMENT, "bad listen address " + address);
    }
    if (::bind(fd, reinterpret_cast<const sockaddr*>(&socket_address), sizeof(socket_address)) != 0 || ::listen(fd, 128) != 0) {
        const std::string reason = std::strerror(errno);
        ::close(fd);
        return fail(ErrorCode::IO, "cannot listen on " + address + ":" + std::to_string(port) + ": " + reason);
    }
    socklen_t size = sizeof(socket_address);
    ::getsockname(fd, reinterpret_cast<sockaddr*>(&socket_address), &size);
    m_listen_fd = fd;
    m_running = true;
    m_acceptor = std::thread{[this] { accept_loop(); }};
    return ntohs(socket_address.sin_port);
}

void HttpServer::accept_loop()
{
    while (m_running) {
        const int client = ::accept(m_listen_fd, nullptr, nullptr);
        if (client < 0) {
            if (!m_running) {
                break;
            }
            if (errno == EINTR || errno == ECONNABORTED) {
                continue;
            }
            break;
        }
        ++m_active;
        std::thread{[this, client] {
            serve(client);
            ::close(client);
            --m_active;
        }}.detach();
    }
}

void HttpServer::serve(int client)
{
    timeval timeout{};
    timeout.tv_sec = 60;
    ::setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));

    std::string buffer;
    char chunk[16384];
    Result<RequestHead> head = fail(ErrorCode::INVALID_ARGUMENT, "incomplete head");
    while (!head) {
        const ssize_t got = ::recv(client, chunk, sizeof(chunk), 0);
        if (got <= 0) {
            return;
        }
        buffer.append(chunk, static_cast<std::size_t>(got));
        if (buffer.size() > 64U * 1024U && buffer.find("\r\n\r\n") == std::string::npos) {
            write_all(client, serialize_response(http::Response::text(431, "Request Header Fields Too Large")));
            return;
        }
        head = parse_request_head(buffer);
        if (!head && buffer.find("\r\n\r\n") != std::string::npos) {
            write_all(client, serialize_response(http::Response::text(head.error().get_message().starts_with("chunked") ? 501 : 400, head.error().get_message())));
            return;
        }
    }
    if (head->content_length > m_max_body) {
        write_all(client, serialize_response(http::Response::text(413, "Payload Too Large")));
        return;
    }
    std::string body = buffer.substr(head->head_size);
    // "Expect: 100-continue" is what curl and DAV clients send before a large PUT.
    if (body.size() < head->content_length &&
        util::equals_ignore_case(http::find_pair(head->headers, "Expect"), "100-continue")) {
        write_all(client, "HTTP/1.1 100 Continue\r\n\r\n");
    }
    while (body.size() < head->content_length) {
        const ssize_t got = ::recv(client, chunk, sizeof(chunk), 0);
        if (got <= 0) {
            return;
        }
        body.append(chunk, static_cast<std::size_t>(got));
    }
    body.resize(head->content_length);

    http::Response response = m_kernel->handle(request_from_head(*head, std::move(body)));
    write_all(client, serialize_response(response));
    ::shutdown(client, SHUT_WR);
}

void HttpServer::stop() noexcept
{
    if (!m_running.exchange(false)) {
        return;
    }
    ::shutdown(m_listen_fd, SHUT_RDWR);
    ::close(m_listen_fd);
    if (m_acceptor.joinable()) {
        m_acceptor.join();
    }
    while (m_active > 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds{5});
    }
}

}  // namespace nc
