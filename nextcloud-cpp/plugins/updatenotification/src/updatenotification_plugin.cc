/**
 * @file updatenotification_plugin.cc
 * @brief Tells administrators when a newer version exists. Once a day (and on `update:check`) it
 * asks the address in `[updatenotification] url` for a JSON document
 * `{"version":"36.0.1","url":"..."}`, compares it with the running version and, when it is newer,
 * sends each administrator one notification per version. Counterpart of Nextcloud's
 * `apps/updatenotification`; it only tells, it never installs anything. Nothing is requested when
 * no `url` is configured.
 */
#include "http_client.h"
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"
#include "version.h"

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions ADMIN{nc::app::Access::ADMIN, nc::app::Format::OCS};

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

class UpdateNotificationPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "updatenotification";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Tells administrators about new versions";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        m_url = host.config("url", "");
        m_client.set_allow_http(host.config("allow_http", "false") == "true");
        m_client.set_allow_local(host.config("allow_local", "false") == "true");
        m_client.set_timeout_seconds(std::atoi(host.config("timeout_seconds", "15").c_str()));
        m_client.set_max_response(64U * 1'024U);
        nc::db::Client{&host}.migrate(
            "updatenotification",
            1,
            "CREATE TABLE nc_updates (version TEXT PRIMARY KEY, url TEXT NOT NULL, found INTEGER "
            "NOT NULL);"
        );

        host.add_job(
            "check",
            24 * 3'600,
            [this]()
            {
                (void)check();
            }
        );
        host.add_command(
            "update:check",
            "Asks for newer versions and tells the administrators",
            [this](const std::vector<std::string>&, std::string& out)
            {
                const std::string result = check();
                out = result + "\n";
                return result.rfind("error:", 0) == 0 ? 1 : 0;
            }
        );
        host.add_service(
            "capabilities.updatenotification",
            [this](std::string_view)
            {
                return Response::json(200, latest_json());
            }
        );
        // For administrators: the newest version found so far.
        m_app->get(
            "/ocs/v2.php/apps/updatenotification/api/v1/applist",
            ADMIN,
            [this](const Request&)
            {
                return nc::http::ocs(200, "OK", latest_json());
            }
        );
    }

private:
    [[nodiscard]] std::string latest_json() const
    {
        const std::string running = m_host->call_service("core.version", "").get_body();
        const auto rows = nc::db::Client{m_host}.query(
            "SELECT version, url FROM nc_updates ORDER BY found DESC, rowid DESC LIMIT 20"
        );
        std::string newest;
        std::string url;
        for (const nc::db::Row& row: rows) {
            const std::string version = nc::db::value_of(row, "version");
            if (nc::update::is_newer(version, newest.empty() ? running : newest)) {
                newest = version;
                url = nc::db::value_of(row, "url");
            }
        }
        return R"({"installed":)" + json_string(running) + R"(,"available":)" +
               (newest.empty() ? std::string{"null"} : json_string(newest)) + R"(,"url":)" +
               (newest.empty() ? std::string{"null"} : json_string(url)) + "}";
    }

    /// Returns a sentence for the command: what was found, or "error: ..." when asking failed.
    std::string check()
    {
        if (m_url.empty()) {
            return "no update address is configured ([updatenotification] url)";
        }
        const auto answer = nc::federation::request(m_client, "GET", m_url, {}, "");
        if (!answer) {
            return "error: " + answer.error();
        }
        if (answer->get_status() != 200) {
            return "error: the update server answered " + std::to_string(answer->get_status());
        }
        const auto json = nc::util::Json::parse(answer->get_body());
        if (!json || !json->is_object()) {
            return "error: the update server did not answer with a JSON document";
        }
        const std::string version = (*json)["version"].string();
        std::string link = (*json)["url"].string();
        if (!nc::update::parse_version(version)) {
            return "error: the update server named a version that is not valid";
        }
        // A link is only passed on when it is a web address.
        if (!(nc::util::starts_with(link, "https://") || nc::util::starts_with(link, "http://")) ||
            link.size() > 500 || link.find_first_of(" \"'<>\\") != std::string::npos) {
            link.clear();
        }
        const std::string running = m_host->call_service("core.version", "").get_body();
        if (!nc::update::is_newer(version, running)) {
            return "up to date (" + running + ")";
        }
        const nc::db::Client db{m_host};
        const bool fresh =
            db.exec(
                "INSERT OR IGNORE INTO nc_updates (version, url, found) VALUES (?, ?, "
                "strftime('%s','now'))",
                {version, link}
            ) != 0;
        if (fresh) {
            // One notification per administrator and version.
            for (const std::string& name: administrators()) {
                (void)m_host->call_service(
                    "notifications.push",
                    nc::util::form_encode(
                        {{"user", name},
                         {"subject", "Version " + version + " is available"},
                         {"message", "You run " + running + "."},
                         {"link", link}}
                    )
                );
            }
        }
        return "version " + version + " is available (you run " + running + ")" +
               (fresh ? "" : ", administrators were told before");
    }

    [[nodiscard]] std::vector<std::string> administrators() const
    {
        std::vector<std::string> names;
        const Response listing = m_host->call_service("users.list_admins", "");
        for (const std::string& line: nc::util::split(listing.get_body(), '\n')) {
            if (!line.empty()) {
                names.push_back(line);
            }
        }
        return names;
    }

    nc::federation::ClientSettings m_client{};
    std::string m_url{};
    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(UpdateNotificationPlugin)
