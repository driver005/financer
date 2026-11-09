/**
 * @file lookup_plugin.cc
 * @brief A directory of people who agreed to be found by people on other servers, and a client for
 * such directories. Counterpart of Nextcloud's lookup server and `apps/lookup_server_connector`, in
 * the small: this server publishes the entries of its own people (`POST .../lookup/publish`) and
 * answers `GET /index.php/lookup/users?search=` for them; and `lookup.search` asks the directory
 * named in
 * `[lookup] server` (it may be this server or another one) for cloud ids, which the share dialog
 * offers as people on other servers.
 *
 * Nobody is listed until they publish themselves. A search needs at least three characters and
 * answers at most ten entries, matching the start of the name, the cloud id or the e-mail address
 * (the e-mail address is only searchable, and only shown, when the person chose to publish it).
 */
#include "http_client.h"
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <chrono>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions USER{nc::app::Access::USER, nc::app::Format::OCS};
constexpr nc::app::RouteOptions OPEN{nc::app::Access::PUBLIC, nc::app::Format::PLAIN};

std::int64_t now_seconds()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

class LookupPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "lookup";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Find people on other servers";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_public_url = host.config("url", "");
        while (!m_public_url.empty() && m_public_url.back() == '/') {
            m_public_url.pop_back();
        }
        m_directory = host.config("server", "");
        while (!m_directory.empty() && m_directory.back() == '/') {
            m_directory.pop_back();
        }
        m_client.set_allow_http(host.config("allow_http", "false") == "true");
        m_client.set_allow_local(host.config("allow_local", "false") == "true");
        m_client.set_timeout_seconds(std::atoi(host.config("timeout_seconds", "10").c_str()));
        m_client.set_max_response(1U << 20U);
        nc::db::Client{&host}.migrate(
            "lookup",
            1,
            "CREATE TABLE nc_lookup (uid TEXT PRIMARY KEY, cloud_id TEXT NOT NULL, name TEXT NOT "
            "NULL, email TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL);"
        );
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();

        // Publish or withdraw one's own entry. The address is this server's own: `[lookup] url`, or
        // the one the request came to.
        m_app->post(
            "/ocs/v2.php/apps/lookup/api/v1/publish",
            USER,
            [this](const Request& request)
            {
                std::string base = m_public_url;
                if (base.empty()) {
                    const std::string_view host_header = request.header("Host");
                    if (host_header.empty()) {
                        throw nc::app::HttpError{
                            400,
                            "The address of this server is not known (set [lookup] url)"
                        };
                    }
                    base = std::string{host_header};
                } else if (const std::size_t scheme = base.find("://");
                           scheme != std::string::npos) {
                    base = base.substr(scheme + 3);
                }
                const Response account = m_host->call_service("users.get", request.get_user());
                const auto user = nc::util::Json::parse(account.get_body());
                const std::string name = user ? (*user)["displayname"].string() : std::string{};
                const std::string email = user ? (*user)["email"].string() : std::string{};
                const auto form = nc::util::parse_form(request.get_body());
                const bool with_email = nc::util::form_value(form, "email") == "true";
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_lookup (uid, cloud_id, name, email, updated) VALUES (?, ?, ?, "
                    "?, ?) "
                    "ON CONFLICT (uid) DO UPDATE SET cloud_id = excluded.cloud_id, name = "
                    "excluded.name, email = excluded.email, updated = excluded.updated",
                    {request.get_user(),
                     request.get_user() + "@" + base,
                     name.empty() ? request.get_user() : name,
                     with_email ? email : std::string{},
                     std::to_string(now_seconds())}
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        m_app->del(
            "/ocs/v2.php/apps/lookup/api/v1/publish",
            USER,
            [this](const Request& request)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_lookup WHERE uid = ?",
                    {request.get_user()}
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );

        // The directory itself, open to anyone who asks.
        m_app->get(
            "/index.php/lookup/users",
            OPEN,
            [this](const Request& request)
            {
                const std::string search = request.query_value("search");
                if (search.size() < 3 || search.size() > 100) {
                    throw nc::app::HttpError{400, "Search for at least three characters"};
                }
                std::string out = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT cloud_id, name, email FROM nc_lookup WHERE instr(lower(cloud_id), "
                         "lower(?)) = 1 OR instr(lower(name), lower(?)) = 1 OR (email != '' AND "
                         "instr(lower(email), lower(?)) = 1) ORDER BY cloud_id LIMIT 10",
                         {search, search, search}
                     )) {
                    out += first ? "" : ",";
                    first = false;
                    out += R"({"federationId":)" + json_string(nc::db::value_of(row, "cloud_id")) +
                           R"(,"name":)" + json_string(nc::db::value_of(row, "name")) +
                           R"(,"email":)" + json_string(nc::db::value_of(row, "email")) + "}";
                }
                return Response::json(200, out + "]");
            }
        );

        // For other plugins: ask the configured directory. Answers "cloud id<TAB>name" lines.
        host.add_service(
            "lookup.search",
            [this](std::string_view args)
            {
                if (m_directory.empty()) {
                    return Response::text(404, "no directory is configured");
                }
                const std::string search{args};
                if (search.size() < 3 || search.size() > 100) {
                    return Response::text(200, "");
                }
                const auto answer = nc::federation::request(
                    m_client,
                    "GET",
                    m_directory +
                        "/index.php/lookup/users?search=" + nc::util::url_encode_path(search),
                    {},
                    ""
                );
                if (!answer || answer->get_status() != 200) {
                    return Response::text(502, "the directory could not be reached");
                }
                const auto json = nc::util::Json::parse(answer->get_body());
                if (!json || !json->is_array()) {
                    return Response::text(502, "the directory answered something unexpected");
                }
                std::string out;
                std::size_t count = 0;
                for (const nc::util::Json& item: json->items()) {
                    const std::string& id = item["federationId"].string();
                    const std::size_t at = id.rfind('@');
                    // Only addresses that could be shared with, no control characters.
                    if (count < 10 && at != std::string::npos && at > 0 && id.size() < 320 &&
                        id.find_first_of(" \t\r\n/\\") == std::string::npos) {
                        std::string name = item["name"].string();
                        std::ranges::replace_if(
                            name,
                            [](char letter)
                            {
                                return static_cast<unsigned char>(letter) < 0x20;
                            },
                            ' '
                        );
                        out += id + "\t" + name + "\n";
                        ++count;
                    }
                }
                return Response::text(200, out);
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_lookup WHERE uid = ?",
                    {nc::util::form_value(nc::util::parse_form(payload), "id")}
                );
            }
        );
    }

private:
    nc::federation::ClientSettings m_client{};
    std::string m_public_url{};
    std::string m_directory{};
    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(LookupPlugin)
