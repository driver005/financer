/**
 * @file http.h
 * @brief The request and response a route handler sees. Plain value types, header only, so the
 * runner and every plugin use the same definition without sharing a binary. Code style: see
 * CODESTYLE.md.
 */
#pragma once

#include "nextcloud/util/text.h"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
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

    /// @brief The body. A big upload can live in a file instead (`get_body_file`); asking for the
    /// body then reads that file into memory once, so a handler that does not know about files
    /// still works. A handler that does should look at `get_body_file` and `body_size` first.
    [[nodiscard]] std::string& get_body()
    {
        load_body();
        return m_body;
    }

    [[nodiscard]] const std::string& get_body() const
    {
        load_body();
        return m_body;
    }

    /// @brief Path of the file that holds the body when the server spooled a big upload to disk;
    /// empty otherwise. The file belongs to the server and is gone when the request is answered.
    [[nodiscard]] const std::string& get_body_file() const noexcept
    {
        return m_body_file;
    }

    void set_body_file(std::string&& path) noexcept
    {
        m_body_file = std::move(path);
        m_body_loaded = false;
    }

    /// @brief The body as it is held in memory, without reading the spool file.
    [[nodiscard]] const std::string& get_inline_body() const noexcept
    {
        return m_body;
    }

    /// @brief Size of the body in bytes, from the file when there is one (nothing is read).
    [[nodiscard]] std::uint64_t body_size() const
    {
        if (m_body_file.empty() || m_body_loaded) {
            return m_body.size();
        }
        std::error_code error;
        const auto size = std::filesystem::file_size(m_body_file, error);
        return error ? m_body.size() : static_cast<std::uint64_t>(size);
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
    void load_body() const
    {
        if (m_body_file.empty() || m_body_loaded) {
            return;
        }
        std::ifstream file{m_body_file, std::ios::binary};
        m_body.assign(std::istreambuf_iterator<char>{file}, std::istreambuf_iterator<char>{});
        m_body_loaded = true;
    }

    std::string m_method{};
    std::string m_path{};
    std::string m_query{};
    mutable std::string m_body{};
    std::string m_body_file{};
    mutable bool m_body_loaded{false};
    std::string m_user{};
    std::vector<Header> m_headers{};
    std::vector<Header> m_params{};
};

/// @brief Produces the next piece of a streamed body: writes at most `capacity` bytes into
/// `buffer` and returns how many. 0 means the end, a negative value an error (the connection is
/// cut, because the head with the length is already out).
using BodyReader = std::function<std::int64_t(char* buffer, std::size_t capacity)>;

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

    /// @brief Makes the body a stream of exactly `length` bytes that the server pulls piece by
    /// piece, so a big file is never held in memory whole. Replaces any plain body.
    Response& set_stream(std::uint64_t length, BodyReader&& reader)
    {
        m_body.clear();
        m_stream_length = length;
        m_stream = std::make_shared<BodyReader>(std::move(reader));
        return *this;
    }

    /// @brief Drops the stream (the body is empty afterwards); the length stays readable.
    void clear_stream() noexcept
    {
        m_stream.reset();
    }

    [[nodiscard]] bool is_streamed() const noexcept
    {
        return m_stream != nullptr;
    }

    [[nodiscard]] std::uint64_t get_stream_length() const noexcept
    {
        return m_stream_length;
    }

    /// @brief The stream's reader; empty when the body is not streamed. Copies of a response
    /// share one stream, so only one of them should be read.
    [[nodiscard]] const std::shared_ptr<BodyReader>& get_stream() const noexcept
    {
        return m_stream;
    }

    /// @brief The whole body: the plain body, or a drained stream (a test, or a caller that
    /// needs all of it).
    [[nodiscard]] std::string read_body() const
    {
        if (m_stream == nullptr) {
            return m_body;
        }
        std::string out;
        out.reserve(static_cast<std::size_t>(m_stream_length));
        char buffer[16'384];
        for (;;) {
            const std::int64_t got = (*m_stream)(buffer, sizeof(buffer));
            if (got <= 0) {
                return out;
            }
            out.append(buffer, static_cast<std::size_t>(got));
        }
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
    std::shared_ptr<BodyReader> m_stream{};
    std::uint64_t m_stream_length{0};
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
