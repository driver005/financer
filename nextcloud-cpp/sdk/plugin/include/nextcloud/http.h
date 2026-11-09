/**
 * @file http.h
 * @brief The request and response a route handler sees. Plain value types, header only, so the
 * runner and every plugin use the same definition without sharing a binary. Code style: see
 * CODESTYLE.md.
 */
#pragma once

#include "nextcloud/util/text.h"

#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace nc::http {

using Header = std::pair<std::string, std::string>;

/// @brief Case-insensitive lookup in a list of name/value pairs; empty view when absent.
[[nodiscard]] inline std::string_view
find_pair(const std::vector<Header>& pairs, std::string_view key) noexcept
{
    for (const Header& pair: pairs) {
        if (util::equals_ignore_case(pair.first, key)) {
            return pair.second;
        }
    }
    return {};
}

class Request
{
public:
    /// @brief An empty request.
    Request() noexcept = default;

    /// @brief A request with only method and path.
    Request(std::string&& method, std::string&& path) noexcept :
        m_method{std::move(method)},
        m_path{std::move(path)}
    {
    }

    /// @brief A request with every field.
    Request(
        std::string&& method,
        std::string&& path,
        std::string&& query,
        std::string&& body,
        std::string&& user,
        std::vector<Header>&& headers,
        std::vector<Header>&& params
    ) noexcept :
        m_method{std::move(method)},
        m_path{std::move(path)},
        m_query{std::move(query)},
        m_body{std::move(body)},
        m_user{std::move(user)},
        m_headers{std::move(headers)},
        m_params{std::move(params)}
    {
    }

    Request& add_header(std::string&& key, std::string&& value)
    {
        m_headers.emplace_back(std::move(key), std::move(value));
        return *this;
    }

    Request& add_param(std::string&& key, std::string&& value)
    {
        m_params.emplace_back(std::move(key), std::move(value));
        return *this;
    }

    void set_method(std::string&& method) noexcept
    {
        m_method = std::move(method);
    }

    void set_path(std::string&& path) noexcept
    {
        m_path = std::move(path);
    }

    void set_query(std::string&& query) noexcept
    {
        m_query = std::move(query);
    }

    void set_body(std::string&& body) noexcept
    {
        m_body = std::move(body);
    }

    void set_user(std::string&& user) noexcept
    {
        m_user = std::move(user);
    }

    void set_headers(std::vector<Header>&& headers) noexcept
    {
        m_headers = std::move(headers);
    }

    void set_params(std::vector<Header>&& params) noexcept
    {
        m_params = std::move(params);
    }

    [[nodiscard]] std::string& get_method() noexcept
    {
        return m_method;
    }

    [[nodiscard]] const std::string& get_method() const noexcept
    {
        return m_method;
    }

    [[nodiscard]] std::string& get_path() noexcept
    {
        return m_path;
    }

    [[nodiscard]] const std::string& get_path() const noexcept
    {
        return m_path;
    }

    [[nodiscard]] std::string& get_query() noexcept
    {
        return m_query;
    }

    [[nodiscard]] const std::string& get_query() const noexcept
    {
        return m_query;
    }

    [[nodiscard]] std::string& get_body() noexcept
    {
        return m_body;
    }

    [[nodiscard]] const std::string& get_body() const noexcept
    {
        return m_body;
    }

    /// @brief The authenticated user id; empty when anonymous.
    [[nodiscard]] std::string& get_user() noexcept
    {
        return m_user;
    }

    [[nodiscard]] const std::string& get_user() const noexcept
    {
        return m_user;
    }

    [[nodiscard]] std::vector<Header>& get_headers() noexcept
    {
        return m_headers;
    }

    [[nodiscard]] const std::vector<Header>& get_headers() const noexcept
    {
        return m_headers;
    }

    [[nodiscard]] std::vector<Header>& get_params() noexcept
    {
        return m_params;
    }

    [[nodiscard]] const std::vector<Header>& get_params() const noexcept
    {
        return m_params;
    }

    /// @brief Header value by case-insensitive name; empty when absent.
    [[nodiscard]] std::string_view header(std::string_view key) const noexcept
    {
        return find_pair(m_headers, key);
    }

    /// @brief Value of a `{name}` segment of the matched route; empty when absent.
    [[nodiscard]] std::string_view param(std::string_view key) const noexcept
    {
        for (const Header& pair: m_params) {
            if (pair.first == key) {
                return pair.second;
            }
        }
        return {};
    }

    /// @brief Value of `key` in the query string (percent-decoded); empty when absent.
    [[nodiscard]] std::string query_value(std::string_view key) const
    {
        for (const std::string& part: util::split(m_query, '&')) {
            const std::size_t equals = part.find('=');
            const std::string name = util::url_decode(part.substr(0, equals), true);
            if (name == key) {
                return equals == std::string::npos
                           ? std::string{}
                           : util::url_decode(part.substr(equals + 1), true);
            }
        }
        return {};
    }

private:
    std::string m_method{};
    std::string m_path{};
    std::string m_query{};
    std::string m_body{};
    std::string m_user{};
    std::vector<Header> m_headers{};
    std::vector<Header> m_params{};
};

class Response
{
public:
    /// @brief 200 with no body.
    Response() noexcept = default;

    /// @brief A response with status only.
    explicit Response(int status) noexcept :
        m_status{status}
    {
    }

    /// @brief A response with every field.
    Response(
        int status,
        std::string&& content_type,
        std::string&& body,
        std::vector<Header>&& headers
    ) noexcept :
        m_status{status},
        m_content_type{std::move(content_type)},
        m_body{std::move(body)},
        m_headers{std::move(headers)}
    {
    }

    [[nodiscard]] static Response text(int status, std::string body)
    {
        return Response{status, "text/plain; charset=utf-8", std::move(body), {}};
    }

    [[nodiscard]] static Response json(int status, std::string body)
    {
        return Response{status, "application/json", std::move(body), {}};
    }

    [[nodiscard]] static Response xml(int status, std::string body)
    {
        return Response{status, "application/xml; charset=utf-8", std::move(body), {}};
    }

    Response& add_header(std::string&& key, std::string&& value)
    {
        m_headers.emplace_back(std::move(key), std::move(value));
        return *this;
    }

    void set_status(int status) noexcept
    {
        m_status = status;
    }

    void set_content_type(std::string&& content_type) noexcept
    {
        m_content_type = std::move(content_type);
    }

    void set_body(std::string&& body) noexcept
    {
        m_body = std::move(body);
    }

    void set_headers(std::vector<Header>&& headers) noexcept
    {
        m_headers = std::move(headers);
    }

    [[nodiscard]] int get_status() const noexcept
    {
        return m_status;
    }

    [[nodiscard]] std::string& get_content_type() noexcept
    {
        return m_content_type;
    }

    [[nodiscard]] const std::string& get_content_type() const noexcept
    {
        return m_content_type;
    }

    [[nodiscard]] std::string& get_body() noexcept
    {
        return m_body;
    }

    [[nodiscard]] const std::string& get_body() const noexcept
    {
        return m_body;
    }

    [[nodiscard]] std::vector<Header>& get_headers() noexcept
    {
        return m_headers;
    }

    [[nodiscard]] const std::vector<Header>& get_headers() const noexcept
    {
        return m_headers;
    }

    [[nodiscard]] std::string_view header(std::string_view key) const noexcept
    {
        return find_pair(m_headers, key);
    }

private:
    int m_status{200};
    std::string m_content_type{};
    std::string m_body{};
    std::vector<Header> m_headers{};
};

/// @brief An OCS v2 JSON envelope, the answer shape of Nextcloud's `/ocs/v2.php` API. `data_json`
/// is already JSON ("{}" when there is nothing to say). The HTTP status is the OCS status code.
[[nodiscard]] inline Response ocs(int status, std::string_view message, std::string_view data_json)
{
    std::string body = R"({"ocs":{"meta":{"status":")";
    body += status < 300 ? "ok" : "failure";
    body += R"(","statuscode":)" + std::to_string(status) + R"(,"message":")" +
            util::json_escape(message);
    body += R"("},"data":)";
    body += data_json.empty() ? std::string_view{"{}"} : data_json;
    body += "}}";
    return Response::json(status, std::move(body));
}

/// @brief A 401 that asks the client to sign in with HTTP basic authentication.
[[nodiscard]] inline Response unauthorized()
{
    Response response = Response::text(401, "Unauthorized");
    response.add_header("WWW-Authenticate", R"(Basic realm="Nextcloud", charset="UTF-8")");
    return response;
}

/// @brief Reason phrase of the status codes the runner emits.
[[nodiscard]] inline std::string_view reason_phrase(int status) noexcept
{
    switch (status) {
        case 200:
            return "OK";
        case 201:
            return "Created";
        case 204:
            return "No Content";
        case 206:
            return "Partial Content";
        case 207:
            return "Multi-Status";
        case 304:
            return "Not Modified";
        case 416:
            return "Range Not Satisfiable";
        case 301:
            return "Moved Permanently";
        case 302:
            return "Found";
        case 400:
            return "Bad Request";
        case 415:
            return "Unsupported Media Type";
        case 401:
            return "Unauthorized";
        case 403:
            return "Forbidden";
        case 404:
            return "Not Found";
        case 405:
            return "Method Not Allowed";
        case 409:
            return "Conflict";
        case 412:
            return "Precondition Failed";
        case 413:
            return "Payload Too Large";
        case 431:
            return "Request Header Fields Too Large";
        case 500:
            return "Internal Server Error";
        case 501:
            return "Not Implemented";
        case 502:
            return "Bad Gateway";
        case 503:
            return "Service Unavailable";
        case 507:
            return "Insufficient Storage";
        default:
            return "Unknown";
    }
}

} // namespace nc::http
