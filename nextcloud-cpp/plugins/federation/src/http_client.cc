#include "http_client.h"

#include "nextcloud/util/text.h"

#include <arpa/inet.h>
#include <cstring>
#include <netdb.h>
#include <netinet/in.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <openssl/x509v3.h>
#include <sys/socket.h>
#include <unistd.h>

namespace nc::federation {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    struct Socket
    {
        int fd{-1};

        ~Socket()
        {
            if (fd >= 0) {
                ::close(fd);
            }
        }
    };

    struct Tls
    {
        SSL_CTX* context{nullptr};
        SSL* ssl{nullptr};

        ~Tls()
        {
            if (ssl != nullptr) {
                SSL_free(ssl);
            }
            if (context != nullptr) {
                SSL_CTX_free(context);
            }
        }
    };

} // namespace

bool is_local_address(std::string_view numeric_address) noexcept
{
    in_addr v4{};
    in6_addr v6{};
    const std::string text{numeric_address};
    if (::inet_pton(AF_INET, text.c_str(), &v4) == 1) {
        const std::uint32_t a = ntohl(v4.s_addr);
        return (a >> 24U) == 127 || (a >> 24U) == 10 || (a >> 24U) == 0 ||
               (a >> 20U) == 0xA'C1 /* 172.16/12 */ || (a >> 16U) == 0xC0'A8 /* 192.168/16 */ ||
               (a >> 16U) == 0xA9'FE /* 169.254/16 */ || (a >> 22U) == 0x1'91 /* 100.64/10 */;
    }
    if (::inet_pton(AF_INET6, text.c_str(), &v6) == 1) {
        const auto* bytes = reinterpret_cast<const unsigned char*>(&v6);
        bool zeros = true;
        for (int index = 0; index < 15; ++index) {
            zeros = zeros && bytes[index] == 0;
        }
        if (zeros && (bytes[15] == 0 || bytes[15] == 1)) {
            return true; // :: and ::1
        }
        if ((bytes[0] & 0xFEU) == 0xFC || (bytes[0] == 0xFE && (bytes[1] & 0xC0U) == 0x80)) {
            return true; // fc00::/7 and fe80::/10
        }
        // An IPv4 address in disguise: ::ffff:a.b.c.d
        bool mapped = true;
        for (int index = 0; index < 10; ++index) {
            mapped = mapped && bytes[index] == 0;
        }
        if (mapped && bytes[10] == 0xFF && bytes[11] == 0xFF) {
            char buffer[INET_ADDRSTRLEN];
            in_addr inner{};
            std::memcpy(&inner, bytes + 12, 4);
            ::inet_ntop(AF_INET, &inner, buffer, sizeof(buffer));
            return is_local_address(buffer);
        }
        return false;
    }
    return true; // not an address at all: treat it as unsafe
}

Result<Url> parse_url(std::string_view url)
{
    Url out;
    const std::size_t scheme_end = url.find("://");
    if (scheme_end == std::string_view::npos) {
        return failure("not a URL");
    }
    out.scheme = util::to_lower(url.substr(0, scheme_end));
    if (out.scheme != "http" && out.scheme != "https") {
        return failure("only http and https URLs are used");
    }
    std::string_view rest = url.substr(scheme_end + 3);
    const std::size_t path_start = rest.find_first_of("/?#");
    std::string_view authority = rest.substr(0, path_start);
    if (path_start != std::string_view::npos && rest[path_start] == '#') {
        return failure("a fragment is not part of a request");
    }
    if (path_start != std::string_view::npos) {
        out.target = std::string{rest.substr(path_start)};
        if (out.target.front() == '?') {
            out.target.insert(out.target.begin(), '/');
        }
        if (out.target.find('#') != std::string::npos) {
            return failure("a fragment is not part of a request");
        }
    }
    if (authority.empty() || authority.find('@') != std::string_view::npos) {
        return failure("the URL has no host, or has credentials in it");
    }
    std::string_view host = authority;
    std::string port = out.scheme == "https" ? "443" : "80";
    if (authority.front() == '[') {
        const std::size_t close = authority.find(']');
        if (close == std::string_view::npos) {
            return failure("bad IPv6 address");
        }
        host = authority.substr(1, close - 1);
        if (close + 1 < authority.size()) {
            if (authority[close + 1] != ':') {
                return failure("bad port");
            }
            port = std::string{authority.substr(close + 2)};
        }
    } else if (const std::size_t colon = authority.rfind(':'); colon != std::string_view::npos) {
        host = authority.substr(0, colon);
        port = std::string{authority.substr(colon + 1)};
    }
    if (host.empty() || port.empty() || port.size() > 5 ||
        port.find_first_not_of("0123456789") != std::string::npos ||
        host.find_first_of(" \t\r\n/\\") != std::string_view::npos) {
        return failure("bad host or port");
    }
    for (const char letter: out.target) {
        if (static_cast<unsigned char>(letter) <= 0x20U || letter == 0x7f) {
            return failure("the URL contains control characters or spaces");
        }
    }
    out.host = std::string{host};
    out.port = std::move(port);
    return out;
}

Result<nc::http::Response> request(
    const ClientSettings& settings,
    std::string_view method,
    std::string_view url,
    const std::vector<nc::http::Header>& headers,
    std::string_view body
)
{
    auto parsed = parse_url(url);
    if (!parsed) {
        return util::unexpected<std::string>{parsed.error()};
    }
    const bool secure = parsed->scheme == "https";
    if (!secure && !settings.allow_http()) {
        return failure("plain http to other servers is not allowed (allow_http)");
    }
    if (method.find_first_of(" \r\n") != std::string_view::npos) {
        return failure("bad method");
    }

    addrinfo hints{};
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* found = nullptr;
    if (const int code = ::getaddrinfo(parsed->host.c_str(), parsed->port.c_str(), &hints, &found);
        code != 0) {
        return failure("cannot resolve " + parsed->host + ": " + ::gai_strerror(code));
    }
    Socket connection;
    bool refused = false;
    for (const addrinfo* candidate = found; candidate != nullptr && connection.fd < 0;
         candidate = candidate->ai_next) {
        char numeric[INET6_ADDRSTRLEN] = {};
        const void* address =
            candidate->ai_family == AF_INET
                ? static_cast<const void*>(
                      &reinterpret_cast<const sockaddr_in*>(candidate->ai_addr)->sin_addr
                  )
                : static_cast<const void*>(
                      &reinterpret_cast<const sockaddr_in6*>(candidate->ai_addr)->sin6_addr
                  );
        ::inet_ntop(candidate->ai_family, address, numeric, sizeof(numeric));
        // Decided on the address that is connected to, not on the name, so a name cannot answer
        // differently the second time.
        if (!settings.allow_local() && is_local_address(numeric)) {
            refused = true;
            continue;
        }
        const int fd =
            ::socket(candidate->ai_family, candidate->ai_socktype, candidate->ai_protocol);
        if (fd < 0) {
            continue;
        }
        timeval timeout{};
        timeout.tv_sec = settings.get_timeout_seconds();
        ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        ::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
        if (::connect(fd, candidate->ai_addr, candidate->ai_addrlen) == 0) {
            connection.fd = fd;
        } else {
            ::close(fd);
        }
    }
    ::freeaddrinfo(found);
    if (connection.fd < 0) {
        return failure(
            refused ? parsed->host + " is a local address (allow_local_remote_servers)"
                    : "cannot connect to " + parsed->host + ":" + parsed->port
        );
    }

    Tls tls;
    if (secure) {
        tls.context = SSL_CTX_new(TLS_client_method());
        if (tls.context == nullptr) {
            return failure("cannot create the TLS context");
        }
        SSL_CTX_set_min_proto_version(tls.context, TLS1_2_VERSION);
        SSL_CTX_set_verify(tls.context, SSL_VERIFY_PEER, nullptr);
        const bool loaded = settings.get_ca_file().empty()
                                ? SSL_CTX_set_default_verify_paths(tls.context) == 1
                                : SSL_CTX_load_verify_locations(
                                      tls.context,
                                      settings.get_ca_file().c_str(),
                                      nullptr
                                  ) == 1;
        if (!loaded) {
            return failure("cannot load the trusted certificates");
        }
        tls.ssl = SSL_new(tls.context);
        if (tls.ssl == nullptr || SSL_set_fd(tls.ssl, connection.fd) != 1) {
            return failure("cannot start TLS");
        }
        SSL_set_tlsext_host_name(tls.ssl, parsed->host.c_str());
        X509_VERIFY_PARAM* params = SSL_get0_param(tls.ssl);
        // An address in the URL is matched against the IP entries of the certificate, a name
        // against its DNS names.
        in_addr v4{};
        in6_addr v6{};
        const bool is_ip = ::inet_pton(AF_INET, parsed->host.c_str(), &v4) == 1 ||
                           ::inet_pton(AF_INET6, parsed->host.c_str(), &v6) == 1;
        const int checked =
            is_ip ? X509_VERIFY_PARAM_set1_ip_asc(params, parsed->host.c_str())
                  : X509_VERIFY_PARAM_set1_host(params, parsed->host.data(), parsed->host.size());
        if (checked != 1) {
            return failure("cannot check the certificate against " + parsed->host);
        }
        if (SSL_connect(tls.ssl) != 1) {
            const long verify = SSL_get_verify_result(tls.ssl);
            return failure(
                verify != X509_V_OK
                    ? std::string("the certificate of ") + parsed->host +
                          " is not trusted: " + X509_verify_cert_error_string(verify)
                    : "the TLS handshake with " + parsed->host + " failed"
            );
        }
    }
    const auto write_all = [&](std::string_view data)
    {
        while (!data.empty()) {
            const ssize_t written =
                secure ? SSL_write(
                             tls.ssl,
                             data.data(),
                             static_cast<int>(std::min<std::size_t>(data.size(), 1U << 20U))
                         )
                       : ::send(connection.fd, data.data(), data.size(), MSG_NOSIGNAL);
            if (written <= 0) {
                return false;
            }
            data.remove_prefix(static_cast<std::size_t>(written));
        }
        return true;
    };

    std::string head =
        std::string{method} + " " + parsed->target + " HTTP/1.1\r\nHost: " + parsed->host;
    if (parsed->port != (secure ? "443" : "80")) {
        head += ":" + parsed->port;
    }
    head +=
        "\r\nConnection: close\r\nUser-Agent: nextcloud-cpp\r\nAccept: application/json, */*\r\n";
    for (const nc::http::Header& header: headers) {
        if (header.first.find_first_of("\r\n:") != std::string::npos ||
            header.second.find_first_of("\r\n") != std::string::npos) {
            return failure("a header contains a line break");
        }
        head += header.first + ": " + header.second + "\r\n";
    }
    if (!body.empty() || method == "POST" || method == "PUT") {
        head += "Content-Length: " + std::to_string(body.size()) + "\r\n";
    }
    head += "\r\n";
    if (!write_all(head) || !write_all(body)) {
        return failure("the connection to " + parsed->host + " was lost");
    }

    std::string raw;
    char chunk[16'384];
    while (true) {
        const ssize_t got = secure ? SSL_read(tls.ssl, chunk, sizeof(chunk))
                                   : ::recv(connection.fd, chunk, sizeof(chunk), 0);
        if (got <= 0) {
            break;
        }
        raw.append(chunk, static_cast<std::size_t>(got));
        if (raw.size() > settings.get_max_response() + 65'536) {
            return failure("the answer is larger than allowed");
        }
    }
    const std::size_t head_end = raw.find("\r\n\r\n");
    if (head_end == std::string::npos || !util::starts_with(raw, "HTTP/1.")) {
        return failure("no valid answer from " + parsed->host);
    }
    const std::vector<std::string> lines =
        util::split(std::string_view{raw}.substr(0, head_end), '\n');
    const std::vector<std::string> status_line = util::split(util::trim(lines.front()), ' ');
    if (status_line.size() < 2) {
        return failure("bad status line");
    }
    nc::http::Response response{std::atoi(status_line[1].c_str())};
    for (std::size_t index = 1; index < lines.size(); ++index) {
        const std::string_view line = util::trim(lines[index]);
        const std::size_t colon = line.find(':');
        if (colon != std::string_view::npos && colon > 0) {
            const std::string name{util::trim(line.substr(0, colon))};
            const std::string value{util::trim(line.substr(colon + 1))};
            if (util::equals_ignore_case(name, "Content-Type")) {
                response.set_content_type(std::string{value});
            } else {
                response.add_header(std::string{name}, std::string{value});
            }
        }
    }
    std::string content = raw.substr(head_end + 4);
    if (util::equals_ignore_case(response.header("Transfer-Encoding"), "chunked")) {
        std::string decoded;
        std::size_t at = 0;
        while (true) {
            const std::size_t eol = content.find("\r\n", at);
            if (eol == std::string::npos) {
                return failure("bad chunked answer");
            }
            const std::string size_text = content.substr(
                at,
                content.find(';', at) < eol ? content.find(';', at) - at : eol - at
            );
            if (size_text.empty() || size_text.size() > 8 ||
                size_text.find_first_not_of("0123456789abcdefABCDEF") != std::string::npos) {
                return failure("bad chunked answer");
            }
            const auto size =
                static_cast<std::size_t>(std::strtoull(size_text.c_str(), nullptr, 16));
            at = eol + 2;
            if (size == 0) {
                break;
            }
            if (at + size + 2 > content.size()) {
                return failure("cut-off chunked answer");
            }
            decoded.append(content, at, size);
            at += size + 2;
            if (decoded.size() > settings.get_max_response()) {
                return failure("the answer is larger than allowed");
            }
        }
        content = std::move(decoded);
    } else if (const std::string_view length = response.header("Content-Length"); !length.empty()) {
        const auto expected =
            static_cast<std::size_t>(std::strtoull(std::string{length}.c_str(), nullptr, 10));
        if (content.size() < expected) {
            return failure("the answer was cut off");
        }
        content.resize(expected);
    }
    if (content.size() > settings.get_max_response()) {
        return failure("the answer is larger than allowed");
    }
    response.set_body(std::move(content));
    return response;
}

} // namespace nc::federation
