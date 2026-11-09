#pragma once

#include "nextcloud/http.h"
#include "nextcloud/util/expected.h"

#include <string>
#include <string_view>
#include <vector>

namespace nc::federation {

/// @brief How outgoing requests to other servers behave. Federation lets people name any server, so
/// the defaults are the cautious ones.
class ClientSettings
{
public:
    ClientSettings() noexcept = default;

    void set_allow_http(bool allow) noexcept
    {
        m_allow_http = allow;
    }

    void set_allow_local(bool allow) noexcept
    {
        m_allow_local = allow;
    }

    void set_ca_file(std::string&& ca_file) noexcept
    {
        m_ca_file = std::move(ca_file);
    }

    void set_timeout_seconds(int seconds) noexcept
    {
        m_timeout_seconds = seconds;
    }

    void set_max_response(std::size_t bytes) noexcept
    {
        m_max_response = bytes;
    }

    [[nodiscard]] bool allow_http() const noexcept
    {
        return m_allow_http;
    }

    [[nodiscard]] bool allow_local() const noexcept
    {
        return m_allow_local;
    }

    [[nodiscard]] std::string& get_ca_file() noexcept
    {
        return m_ca_file;
    }

    [[nodiscard]] const std::string& get_ca_file() const noexcept
    {
        return m_ca_file;
    }

    [[nodiscard]] int get_timeout_seconds() const noexcept
    {
        return m_timeout_seconds;
    }

    [[nodiscard]] std::size_t get_max_response() const noexcept
    {
        return m_max_response;
    }

private:
    bool m_allow_http{false};
    bool m_allow_local{false};
    std::string m_ca_file{};
    int m_timeout_seconds{15};
    std::size_t m_max_response{64U * 1'024U * 1'024U};
};

template<typename Value> using Result = util::expected<Value, std::string>;

/// @brief True for addresses a request to "another server" must not reach unless allowed: loopback,
/// private ranges, link local, unique local, unspecified (SSRF protection).
[[nodiscard]] bool is_local_address(std::string_view numeric_address) noexcept;

/// @brief One request, one response, then the connection is closed. HTTP or HTTPS (certificate and
/// host name are checked), no redirects, bounded time and size. `headers` are added as given.
[[nodiscard]] Result<nc::http::Response> request(
    const ClientSettings& settings,
    std::string_view method,
    std::string_view url,
    const std::vector<nc::http::Header>& headers,
    std::string_view body
);

/// @brief Splits `scheme://host[:port]/path?query` (no userinfo, no fragment).
struct Url
{
    std::string scheme{};
    std::string host{};
    std::string port{};
    std::string target{"/"};
};

[[nodiscard]] Result<Url> parse_url(std::string_view url);

} // namespace nc::federation
