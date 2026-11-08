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
[[nodiscard]] http::Request request_from_head(const RequestHead& head, std::string&& body);
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

    /// @brief Listens on `address:port` (port 0 picks a free one) and returns the port.
    Result<std::uint16_t> start(const std::string& address, std::uint16_t port);

    /// @brief Stops accepting, closes the socket and waits for running requests.
    void stop() noexcept;

private:
    void accept_loop();
    void serve(int client);

    const Kernel* m_kernel{nullptr};
    std::size_t m_max_body{0};
    int m_listen_fd{-1};
    std::atomic<bool> m_running{false};
    std::atomic<int> m_active{0};
    std::thread m_acceptor{};
};

} // namespace nc
