/**
 * @file settings_plugin.cc
 * @brief Settings that are stored and changed at run time: values per app (administrators) and
 * values per person (preferences). Counterpart of Nextcloud's `OCP\IAppConfig` /
 * `OCP\IConfig::getUserValue` and the config part of `apps/provisioning_api`. The `config` file
 * stays for what the runner needs before it starts; this is for what an administrator or a user
 * changes while it runs.
 *
 * Other plugins read through the services `settings.get_app` (form: app, key) and
 * `settings.get_user` (form: user, app, key), which answer 200 and the value or 404.
 */
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <algorithm>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr std::size_t MAX_VALUE = 64U * 1'024U;

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

/// App and key names: letters, digits and `._-:`, bounded.
bool name_ok(std::string_view name)
{
    return !name.empty() && name.size() <= 64 &&
           std::ranges::all_of(
               name,
               [](char letter)
               {
                   return std::isalnum(static_cast<unsigned char>(letter)) != 0 || letter == '.' ||
                          letter == '_' || letter == '-' || letter == ':';
               }
           );
}

class SettingsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "settings";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Settings changed while the server runs";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        nc::db::Client{&host}.migrate(
            "settings",
            1,
            "CREATE TABLE nc_appconfig (app TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,"
            " PRIMARY KEY (app, key));"
            "CREATE TABLE nc_preferences (uid TEXT NOT NULL, app TEXT NOT NULL, key TEXT NOT NULL,"
            " value TEXT NOT NULL, PRIMARY KEY (uid, app, key));"
        );

        host.add_service(
            "settings.get_app",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                return read(
                    "SELECT value FROM nc_appconfig WHERE app = ? AND key = ?",
                    {nc::util::form_value(form, "app"), nc::util::form_value(form, "key")}
                );
            }
        );
        host.add_service(
            "settings.get_user",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                return read(
                    "SELECT value FROM nc_preferences WHERE uid = ? AND app = ? AND key = ?",
                    {nc::util::form_value(form, "user"),
                     nc::util::form_value(form, "app"),
                     nc::util::form_value(form, "key")}
                );
            }
        );
        // Form: app, key, value. For other plugins; no permission check, the caller is trusted
        // code.
        host.add_service(
            "settings.set_app",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string app = nc::util::form_value(form, "app");
                const std::string key = nc::util::form_value(form, "key");
                const std::string value = nc::util::form_value(form, "value");
                if (!name_ok(app) || !name_ok(key) || value.size() > MAX_VALUE) {
                    return Response::text(400, "bad app, key or value");
                }
                store_app(app, key, value);
                return Response::text(200, "ok");
            }
        );

        constexpr std::string_view APPS = "/ocs/v2.php/apps/provisioning_api/api/v1/config/apps";
        constexpr std::string_view USERS = "/ocs/v2.php/apps/provisioning_api/api/v1/config/users";

        // ---- values per app: administrators ----------------------------------------------------
        host.add_route(
            "GET",
            std::string{APPS} + "/{app}",
            [this](const Request& request)
            {
                if (const auto refusal = require_admin(request)) {
                    return *refusal;
                }
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT key FROM nc_appconfig WHERE app = ? ORDER BY key",
                         {std::string{request.param("app")}}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += json_string(nc::db::value_of(row, "key"));
                }
                return nc::http::ocs(200, "OK", R"({"data":)" + data + "]}");
            }
        );
        host.add_route(
            "GET",
            std::string{APPS} + "/{app}/{key}",
            [this](const Request& request)
            {
                if (const auto refusal = require_admin(request)) {
                    return *refusal;
                }
                const Response value = read(
                    "SELECT value FROM nc_appconfig WHERE app = ? AND key = ?",
                    {std::string{request.param("app")}, std::string{request.param("key")}}
                );
                return value.get_status() == 200
                           ? nc::http::ocs(
                                 200,
                                 "OK",
                                 R"({"data":)" + json_string(value.get_body()) + "}"
                             )
                           : nc::http::ocs(404, "The key does not exist", "{}");
            }
        );
        host.add_route(
            "POST",
            std::string{APPS} + "/{app}/{key}",
            [this](const Request& request)
            {
                if (const auto refusal = require_admin(request)) {
                    return *refusal;
                }
                const std::string app{request.param("app")};
                const std::string key{request.param("key")};
                const std::string value = body_value(request);
                if (!name_ok(app) || !name_ok(key) || value.size() > MAX_VALUE) {
                    return nc::http::ocs(400, "Invalid app, key or value", "{}");
                }
                store_app(app, key, value);
                m_host->publish(
                    "settings.app_changed",
                    nc::util::form_encode({{"app", app}, {"key", key}})
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        host.add_route(
            "DELETE",
            std::string{APPS} + "/{app}/{key}",
            [this](const Request& request)
            {
                if (const auto refusal = require_admin(request)) {
                    return *refusal;
                }
                const std::string app{request.param("app")};
                const std::string key{request.param("key")};
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_appconfig WHERE app = ? AND key = ?",
                    {app, key}
                );
                m_host->publish(
                    "settings.app_changed",
                    nc::util::form_encode({{"app", app}, {"key", key}})
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );

        // ---- values per person: the signed-in user's own ---------------------------------------
        host.add_route(
            "GET",
            std::string{USERS} + "/{app}/{key}",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const Response value = read(
                    "SELECT value FROM nc_preferences WHERE uid = ? AND app = ? AND key = ?",
                    {request.get_user(),
                     std::string{request.param("app")},
                     std::string{request.param("key")}}
                );
                return value.get_status() == 200
                           ? nc::http::ocs(
                                 200,
                                 "OK",
                                 R"({"data":)" + json_string(value.get_body()) + "}"
                             )
                           : nc::http::ocs(404, "The key does not exist", "{}");
            }
        );
        host.add_route(
            "POST",
            std::string{USERS} + "/{app}/{key}",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const std::string app{request.param("app")};
                const std::string key{request.param("key")};
                const std::string value = body_value(request);
                if (!name_ok(app) || !name_ok(key) || value.size() > MAX_VALUE) {
                    return nc::http::ocs(400, "Invalid app, key or value", "{}");
                }
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_preferences (uid, app, key, value) VALUES (?, ?, ?, ?) ON "
                    "CONFLICT (uid, app, key) DO UPDATE SET value = excluded.value",
                    {request.get_user(), app, key, value}
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        host.add_route(
            "DELETE",
            std::string{USERS} + "/{app}/{key}",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_preferences WHERE uid = ? AND app = ? AND key = ?",
                    {request.get_user(),
                     std::string{request.param("app")},
                     std::string{request.param("key")}}
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_preferences WHERE uid = ?",
                    {nc::util::form_value(nc::util::parse_form(payload), "id")}
                );
            }
        );
    }

private:
    [[nodiscard]] static std::string body_value(const Request& request)
    {
        std::string value = nc::util::form_value(nc::util::parse_form(request.get_body()), "value");
        return value.empty() ? request.query_value("value") : value;
    }

    [[nodiscard]] std::optional<Response> require_admin(const Request& request) const
    {
        if (request.get_user().empty()) {
            return nc::http::unauthorized();
        }
        if (m_host->call_service("users.is_admin", request.get_user()).get_status() != 200) {
            return nc::http::ocs(403, "Forbidden", "{}");
        }
        return std::nullopt;
    }

    [[nodiscard]] Response read(std::string_view sql, const std::vector<std::string>& params) const
    {
        const auto rows = nc::db::Client{m_host}.query(sql, params);
        return rows.empty() ? Response::text(404, "not set")
                            : Response::text(200, nc::db::value_of(rows.front(), "value"));
    }

    void store_app(const std::string& app, const std::string& key, const std::string& value) const
    {
        nc::db::Client{m_host}.exec(
            "INSERT INTO nc_appconfig (app, key, value) VALUES (?, ?, ?) ON CONFLICT (app, key) DO "
            "UPDATE SET value = excluded.value",
            {app, key, value}
        );
    }

    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(SettingsPlugin)
