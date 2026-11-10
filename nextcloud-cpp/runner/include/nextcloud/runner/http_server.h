#pragma once

#include "nextcloud/http.h"
#include "nextcloud/runner/error.h"
#include "nextcloud/runner/kernel.h"

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

struct ssl_ctx_st;
struct ssl_st;

namespace nc {

/// @brief Decodes a `Transfer-Encoding: chunked` body (RFC 9112, section 7.1) as bytes arrive, so a
/// big upload is parsed once and not again for every read.
class ChunkedDecoder
{
public:
    enum class State
    {
        NEED_MORE,
        DONE,
        INVALID,
        TOO_LARGE
    };

    explicit ChunkedDecoder(std::size_t max_body) noexcept :
        m_max_body{max_body}
    {
    }

    /// @brief Adds received bytes; returns where decoding stands. Bytes after the final chunk are
    /// left in `leftover()`.
    State feed(std::string_view bytes);

    [[nodiscard]] std::string& body() noexcept
    {
        return m_body;
    }

    [[nodiscard]] const std::string& body() const noexcept
    {
        return m_body;
    }

private:
    enum class Part
    {
        SIZE_LINE,
        DATA,
        DATA_END,
        TRAILERS
    };

    std::size_t m_max_body{0};
    std::string m_body{};
    std::string m_pending{};
    Part m_part{Part::SIZE_LINE};
    std::size_t m_remaining{0};
};

/// @brief The head of a request, once the blank line has been read.
struct RequestHead
{
    std::string method{};
    std::string target{};
    std::vector<http::Header> headers{};
    std::size_t content_length{0};
    /// `Transfer-Encoding: chunked` (curl -T - and streaming DAV clients send uploads this way).
    bool chunked{false};
    std::size_t head_size{0};
};

/// @brief Parses the head of an HTTP/1.1 request out of `raw`. Pure, so it is tested without a
/// socket. `Content-Length` bodies only; `Transfer-Encoding` is refused.
[[nodiscard]] Result<RequestHead> parse_request_head(std::string_view raw);
/// @brief The request a parsed head and body make. `remote` is the client's address: it becomes the
/// `X-NC-Remote-Addr` header, and any such header the client sent is dropped first, so the
/// kernel can trust it.
[[nodiscard]] http::Request
request_from_head(const RequestHead& head, std::string&& body, std::string_view remote = {});

/// @brief The client's address: the peer of the connection, unless the peer is one of the
/// `trusted` proxies and sent `X-Forwarded-For`; then the first address of that list, read from
/// the right, that is not a trusted proxy itself (the one a proxy of ours saw), so a client cannot
/// choose its address by sending the header. Entries that are not addresses are ignored.
[[nodiscard]] std::string resolve_remote(
    std::string_view peer,
    std::string_view forwarded_for,
    const std::vector<std::string>& trusted
);
[[nodiscard]] std::string serialize_response(const http::Response& response);

/// @brief A small HTTP/1.1 server over POSIX sockets: one thread per connection, `Connection:
/// close`. It is the transport only; every request goes to `Kernel::handle`.
class HttpServer
{
public:
    explicit HttpServer(
        const Kernel& kernel,
        std::size_t max_body = 512U * 1'024U * 1'024U
    ) noexcept :
        m_kernel{&kernel},
        m_max_body{max_body}
    {
    }

    ~HttpServer();
    HttpServer(const HttpServer&) = delete;
    HttpServer& operator=(const HttpServer&) = delete;
    HttpServer(HttpServer&&) = delete;
    HttpServer& operator=(HttpServer&&) = delete;

    /// @brief Serves HTTPS from now on: TLS 1.2 or newer, the certificate chain and the private key
    /// from PEM files. Call before `start`. Plain HTTP stays the default; put a reverse proxy in
    /// front if you prefer.
    Result<void> enable_tls(const std::string& certificate_file, const std::string& key_file);

    /// @brief Uploads (PUT) of `threshold` bytes and more are written to a file in `directory`
    /// while they arrive instead of being held in memory; the request carries the file's path
    /// (`Request::get_body_file`) and the file is deleted when the request is answered. Without a
    /// directory every body stays in memory. Call before `start`.
    void set_spool(std::string directory, std::size_t threshold = 1U << 20U);

    /// @brief Proxies (exact addresses) whose `X-Forwarded-For` is believed. Call before `start`.
    void set_trusted_proxies(std::vector<std::string> addresses)
    {
        m_trusted_proxies = std::move(addresses);
    }

    /// @brief Listens on `address:port` (port 0 picks a free one) and returns the port.
    Result<std::uint16_t> start(const std::string& address, std::uint16_t port);

    /// @brief Stops accepting, closes the socket and waits for running requests.
    void stop() noexcept;

private:
    void accept_loop();
    void serve(int client, ssl_st* tls, const std::string& peer);

    const Kernel* m_kernel{nullptr};
    std::size_t m_max_body{0};
    std::vector<std::string> m_trusted_proxies{};
    std::string m_spool_directory{};
    std::size_t m_spool_threshold{1U << 20U};
    ssl_ctx_st* m_tls{nullptr};
    int m_listen_fd{-1};
    std::atomic<bool> m_running{false};
    std::atomic<int> m_active{0};
    std::thread m_acceptor{};
};

} // namespace nc
