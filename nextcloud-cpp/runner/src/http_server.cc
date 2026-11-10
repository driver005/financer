#include "nextcloud/runner/http_server.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <arpa/inet.h>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <netinet/in.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <sys/socket.h>
#include <unistd.h>

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
        head.headers.emplace_back(
            std::string{util::trim(line.substr(0, colon))},
            std::string{util::trim(line.substr(colon + 1))}
        );
    }
    const std::string_view encoding = http::find_pair(head.headers, "Transfer-Encoding");
    const std::string_view length = http::find_pair(head.headers, "Content-Length");
    if (!encoding.empty()) {
        if (!util::equals_ignore_case(encoding, "chunked")) {
            return fail(ErrorCode::INVALID_ARGUMENT, "unsupported Transfer-Encoding");
        }
        if (!length.empty()) {
            return fail(ErrorCode::INVALID_ARGUMENT, "both Content-Length and Transfer-Encoding");
        }
        head.chunked = true;
    }
    if (!length.empty()) {
        std::size_t value = 0;
        for (const char digit: length) {
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
    std::string query =
        question == std::string::npos ? std::string{} : head.target.substr(question + 1);
    http::Request request{
        std::string{head.method},
        std::move(path),
        std::move(query),
        std::move(body),
        {},
        {},
        {}
    };
    request.set_headers(std::vector<http::Header>(head.headers));
    return request;
}

ChunkedDecoder::State ChunkedDecoder::feed(std::string_view bytes)
{
    m_pending.append(bytes);
    while (true) {
        switch (m_part) {
            case Part::SIZE_LINE:
                {
                    const std::size_t end = m_pending.find("\r\n");
                    if (end == std::string::npos) {
                        return m_pending.size() > 1'024 ? State::INVALID : State::NEED_MORE;
                    }
                    // "1a2b;extension" : the hexadecimal size, then optional extensions that are
                    // ignored.
                    const std::string line = m_pending.substr(0, end);
                    const std::string digits = line.substr(0, line.find(';'));
                    if (digits.empty() || digits.size() > 15 ||
                        digits.find_first_not_of("0123456789abcdefABCDEF") != std::string::npos) {
                        return State::INVALID;
                    }
                    m_remaining =
                        static_cast<std::size_t>(std::strtoull(digits.c_str(), nullptr, 16));
                    m_pending.erase(0, end + 2);
                    if (m_remaining > m_max_body || m_body.size() + m_remaining > m_max_body) {
                        return State::TOO_LARGE;
                    }
                    m_part = m_remaining == 0 ? Part::TRAILERS : Part::DATA;
                    break;
                }
            case Part::DATA:
                {
                    const std::size_t take = std::min(m_remaining, m_pending.size());
                    m_body.append(m_pending, 0, take);
                    m_pending.erase(0, take);
                    m_remaining -= take;
                    if (m_remaining > 0) {
                        return State::NEED_MORE;
                    }
                    m_part = Part::DATA_END;
                    break;
                }
            case Part::DATA_END:
                if (m_pending.size() < 2) {
                    return State::NEED_MORE;
                }
                if (m_pending.compare(0, 2, "\r\n") != 0) {
                    return State::INVALID;
                }
                m_pending.erase(0, 2);
                m_part = Part::SIZE_LINE;
                break;
            case Part::TRAILERS:
                {
                    // Trailer fields are read and dropped, up to the empty line that ends the
                    // message.
                    const std::size_t end = m_pending.find("\r\n");
                    if (end == std::string::npos) {
                        return m_pending.size() > 8'192 ? State::INVALID : State::NEED_MORE;
                    }
                    const bool last = end == 0;
                    m_pending.erase(0, end + 2);
                    if (last) {
                        return State::DONE;
                    }
                    break;
                }
        }
    }
}

std::string serialize_response(const http::Response& response)
{
    std::string out = "HTTP/1.1 " + std::to_string(response.get_status()) + " " +
                      std::string(http::reason_phrase(response.get_status())) + "\r\n";
    bool has_length = false;
    for (const http::Header& header: response.get_headers()) {
        has_length = has_length || util::equals_ignore_case(header.first, "Content-Length");
        out += header.first + ": " + header.second + "\r\n";
    }
    if (!response.get_content_type().empty()) {
        out += "Content-Type: " + response.get_content_type() + "\r\n";
    }
    if (!has_length) {
        out +=
            "Content-Length: " +
            std::to_string(
                response.is_streamed() ? response.get_stream_length() : response.get_body().size()
            ) +
            "\r\n";
    }
    out += "Connection: close\r\n\r\n";
    // A streamed body is not part of the head string; the server pulls it after writing this.
    if (!response.is_streamed()) {
        out += response.get_body();
    }
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

    /// One connection, plain or TLS, with the two operations the request loop needs.
    struct Channel
    {
        int fd{-1};
        ssl_st* tls{nullptr};

        [[nodiscard]] ssize_t read(void* buffer, std::size_t size) const
        {
            if (tls == nullptr) {
                return ::recv(fd, buffer, size, 0);
            }
            const int got = SSL_read(tls, buffer, static_cast<int>(size));
            return got > 0 ? got : 0;
        }

        /// Best effort: the caller has nothing better to do when the client is gone.
        bool write(std::string_view data) const
        {
            if (tls == nullptr) {
                return write_all(fd, data);
            }
            while (!data.empty()) {
                const int written = SSL_write(
                    tls,
                    data.data(),
                    static_cast<int>(std::min<std::size_t>(data.size(), 1U << 20U))
                );
                if (written <= 0) {
                    return false;
                }
                data.remove_prefix(static_cast<std::size_t>(written));
            }
            return true;
        }
    };

} // namespace

HttpServer::~HttpServer()
{
    stop();
    if (m_tls != nullptr) {
        SSL_CTX_free(m_tls);
    }
}

Result<void>
HttpServer::enable_tls(const std::string& certificate_file, const std::string& key_file)
{
    SSL_CTX* context = SSL_CTX_new(TLS_server_method());
    if (context == nullptr) {
        return fail(ErrorCode::INTERNAL, "cannot create the TLS context");
    }
    SSL_CTX_set_min_proto_version(context, TLS1_2_VERSION);
    SSL_CTX_set_options(context, SSL_OP_NO_COMPRESSION);
    if (SSL_CTX_use_certificate_chain_file(context, certificate_file.c_str()) != 1) {
        SSL_CTX_free(context);
        return fail(ErrorCode::IO, "cannot read the certificate " + certificate_file);
    }
    if (SSL_CTX_use_PrivateKey_file(context, key_file.c_str(), SSL_FILETYPE_PEM) != 1) {
        SSL_CTX_free(context);
        return fail(ErrorCode::IO, "cannot read the private key " + key_file);
    }
    if (SSL_CTX_check_private_key(context) != 1) {
        SSL_CTX_free(context);
        return fail(
            ErrorCode::INVALID_ARGUMENT,
            "the private key does not belong to the certificate"
        );
    }
    if (m_tls != nullptr) {
        SSL_CTX_free(m_tls);
    }
    m_tls = context;
    return {};
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
    if (::bind(fd, reinterpret_cast<const sockaddr*>(&socket_address), sizeof(socket_address)) !=
            0 ||
        ::listen(fd, 128) != 0) {
        const std::string reason = std::strerror(errno);
        ::close(fd);
        return fail(
            ErrorCode::IO,
            "cannot listen on " + address + ":" + std::to_string(port) + ": " + reason
        );
    }
    socklen_t size = sizeof(socket_address);
    ::getsockname(fd, reinterpret_cast<sockaddr*>(&socket_address), &size);
    m_listen_fd = fd;
    m_running = true;
    m_acceptor = std::thread{[this]
                             {
                                 accept_loop();
                             }};
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
        std::thread{
            [this, client]
            {
                ssl_st* tls = nullptr;
                if (m_tls != nullptr) {
                    timeval timeout{};
                    timeout.tv_sec = 10;
                    ::setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
                    ::setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
                    tls = SSL_new(m_tls);
                    if (tls == nullptr || SSL_set_fd(tls, client) != 1 || SSL_accept(tls) != 1) {
                        // A client that does not speak TLS, or gives up half way, is dropped.
                        if (tls != nullptr) {
                            SSL_free(tls);
                        }
                        ::close(client);
                        --m_active;
                        return;
                    }
                }
                serve(client, tls);
                if (tls != nullptr) {
                    SSL_shutdown(tls);
                    SSL_free(tls);
                }
                ::close(client);
                --m_active;
            }
        }.detach();
    }
}

void HttpServer::serve(int client, ssl_st* tls)
{
    const Channel channel{client, tls};
    timeval timeout{};
    timeout.tv_sec = 60;
    ::setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));

    std::string buffer;
    char chunk[16'384];
    Result<RequestHead> head = fail(ErrorCode::INVALID_ARGUMENT, "incomplete head");
    while (!head) {
        const ssize_t got = channel.read(chunk, sizeof(chunk));
        if (got <= 0) {
            return;
        }
        buffer.append(chunk, static_cast<std::size_t>(got));
        if (buffer.size() > 64U * 1'024U && buffer.find("\r\n\r\n") == std::string::npos) {
            channel.write(
                serialize_response(http::Response::text(431, "Request Header Fields Too Large"))
            );
            return;
        }
        head = parse_request_head(buffer);
        if (!head && buffer.find("\r\n\r\n") != std::string::npos) {
            channel.write(serialize_response(http::Response::text(
                head.error().get_message().starts_with("unsupported") ? 501 : 400,
                head.error().get_message()
            )));
            return;
        }
    }
    if (head->content_length > m_max_body) {
        channel.write(serialize_response(http::Response::text(413, "Payload Too Large")));
        return;
    }
    // The spooled body of a big upload, deleted whichever way this request ends.
    std::string spool_path;

    struct SpoolGuard
    {
        const std::string& path;

        ~SpoolGuard()
        {
            if (!path.empty()) {
                std::error_code error;
                std::filesystem::remove(path, error);
            }
        }
    };

    const SpoolGuard spool_guard{spool_path};
    std::string body = buffer.substr(head->head_size);
    const bool wants_continue =
        util::equals_ignore_case(http::find_pair(head->headers, "Expect"), "100-continue");
    if (head->chunked) {
        // "Expect: 100-continue" is what curl and DAV clients send before a large upload.
        if (wants_continue) {
            channel.write("HTTP/1.1 100 Continue\r\n\r\n");
        }
        ChunkedDecoder decoder{m_max_body};
        ChunkedDecoder::State state = decoder.feed(body);
        while (state == ChunkedDecoder::State::NEED_MORE) {
            const ssize_t got = channel.read(chunk, sizeof(chunk));
            if (got <= 0) {
                return;
            }
            state = decoder.feed(std::string_view{chunk, static_cast<std::size_t>(got)});
        }
        if (state != ChunkedDecoder::State::DONE) {
            channel.write(serialize_response(
                state == ChunkedDecoder::State::TOO_LARGE
                    ? http::Response::text(413, "Payload Too Large")
                    : http::Response::text(400, "Bad chunked body")
            ));
            return;
        }
        body = std::move(decoder.body());
    } else {
        if (body.size() < head->content_length && wants_continue) {
            channel.write("HTTP/1.1 100 Continue\r\n\r\n");
        }
        if (!m_spool_directory.empty() && head->method == "PUT" &&
            head->content_length >= m_spool_threshold) {
            // A big upload goes to a file as it arrives.
            spool_path = m_spool_directory + "/" + util::random_hex(12);
            std::ofstream file{spool_path, std::ios::binary | std::ios::trunc};
            std::size_t stored = std::min(body.size(), head->content_length);
            file.write(body.data(), static_cast<std::streamsize>(stored));
            body.clear();
            while (stored < head->content_length) {
                const ssize_t got = channel.read(chunk, sizeof(chunk));
                if (got <= 0) {
                    return;
                }
                const std::size_t take =
                    std::min(static_cast<std::size_t>(got), head->content_length - stored);
                file.write(chunk, static_cast<std::streamsize>(take));
                stored += take;
            }
            file.flush();
            if (!file) {
                channel.write(
                    serialize_response(http::Response::text(507, "Cannot store the upload"))
                );
                return;
            }
        } else {
            while (body.size() < head->content_length) {
                const ssize_t got = channel.read(chunk, sizeof(chunk));
                if (got <= 0) {
                    return;
                }
                body.append(chunk, static_cast<std::size_t>(got));
            }
            body.resize(head->content_length);
        }
    }

    http::Request request = request_from_head(*head, std::move(body));
    if (!spool_path.empty()) {
        request.set_body_file(std::string{spool_path});
    }
    http::Response response = m_kernel->handle(std::move(request));
    if (!spool_path.empty()) {
        // The handler is done with the upload: the file goes before the answer does, so a client
        // that has the answer never finds it still there (the guard is for the paths that return
        // early).
        std::error_code error;
        std::filesystem::remove(spool_path, error);
    }
    if (!channel.write(serialize_response(response))) {
        return;
    }
    if (response.is_streamed()) {
        // Exactly the announced length goes out; a short or failing stream cuts the connection,
        // so the client sees an incomplete download and not a wrong file.
        std::uint64_t left = response.get_stream_length();
        std::vector<char> piece(64U * 1'024U);
        while (left > 0) {
            const std::int64_t got =
                (*response.get_stream())(piece.data(), std::min<std::uint64_t>(left, piece.size()));
            if (got <= 0 ||
                !channel.write(std::string_view{piece.data(), static_cast<std::size_t>(got)})) {
                return;
            }
            left -= static_cast<std::uint64_t>(got);
        }
    }
    if (tls == nullptr) {
        ::shutdown(client, SHUT_WR);
    }
}

void HttpServer::set_spool(std::string directory, std::size_t threshold)
{
    m_spool_directory = std::move(directory);
    m_spool_threshold = threshold;
    if (m_spool_directory.empty()) {
        return;
    }
    // What a crashed run left behind is of no use to anyone.
    std::error_code error;
    std::filesystem::remove_all(m_spool_directory, error);
    std::filesystem::create_directories(m_spool_directory, error);
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

} // namespace nc
