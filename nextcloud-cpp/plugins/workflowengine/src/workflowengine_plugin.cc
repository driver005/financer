/**
 * @file workflowengine_plugin.cc
 * @brief Rules that react to what happens: "when a file is created whose path matches `*.pdf`, tag
 * it `invoice` and tell an administrator". Counterpart of Nextcloud's `apps/workflowengine` for
 * events that have already happened (it cannot refuse an operation: there is no "block access"
 * action).
 *
 * A flow has an event pattern (`file.created`, `share.*`), optional conditions (`path` glob,
 * `user`) and one action: `notify` (a notification to a user) or `tag` (a system tag on the file).
 * Flows are managed by administrators.
 */
#include "glob.h"
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <chrono>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions ADMIN{nc::app::Access::ADMIN, nc::app::Format::OCS};

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

std::string replace_all(std::string text, std::string_view from, std::string_view to)
{
    for (std::size_t at = text.find(from); at != std::string::npos;
         at = text.find(from, at + to.size())) {
        text.replace(at, from.size(), to);
    }
    return text;
}

class WorkflowEnginePlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "workflowengine";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Rules that react to events";
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
        nc::db::Client{&host}.migrate(
            "workflowengine",
            1,
            "CREATE TABLE nc_flows ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, event TEXT NOT NULL,"
            " path_glob TEXT NOT NULL DEFAULT '', user_glob TEXT NOT NULL DEFAULT '',"
            " action TEXT NOT NULL, target TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',"
            " created_by TEXT NOT NULL);"
        );
        host.subscribe(
            "*",
            [this](std::string_view topic, std::string_view payload)
            {
                run_flows(std::string{topic}, payload);
            }
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/workflowengine/api/v1/flows";
        m_app->route(
            "POST",
            BASE,
            ADMIN,
            [this](const Request& request)
            {
                const auto form = nc::util::parse_form(request.get_body());
                const auto field = [&](std::string_view name)
                {
                    return nc::util::form_value(form, name);
                };
                const std::string action = field("action");
                const std::string event = field("event");
                if (field("name").empty() || field("name").size() > 100 || event.empty() ||
                    event.size() > 100 || (action != "notify" && action != "tag") ||
                    field("target").empty() || field("target").size() > 100 ||
                    field("message").size() > 300 || field("path").size() > 300 ||
                    field("user").size() > 100) {
                    return nc::http::ocs(400, "Invalid flow", "{}");
                }
                if (action == "notify" &&
                    m_host->call_service("users.get", field("target")).get_status() != 200) {
                    return nc::http::ocs(400, "The user to notify does not exist", "{}");
                }
                std::int64_t id = 0;
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_flows (name, event, path_glob, user_glob, action, target, "
                    "message, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    {field("name"),
                     event,
                     field("path"),
                     field("user"),
                     action,
                     field("target"),
                     field("message"),
                     request.get_user()},
                    &id
                );
                return nc::http::ocs(200, "OK", R"({"id":)" + std::to_string(id) + "}");
            }
        );
        m_app->route(
            "GET",
            BASE,
            ADMIN,
            [this](const Request)
            {
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, name, event, path_glob, user_glob, action, target, message "
                         "FROM nc_flows ORDER BY id"
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += R"({"id":)" + nc::db::value_of(row, "id") + R"(,"name":)" +
                            json_string(nc::db::value_of(row, "name")) + R"(,"event":)" +
                            json_string(nc::db::value_of(row, "event")) + R"(,"path":)" +
                            json_string(nc::db::value_of(row, "path_glob")) + R"(,"user":)" +
                            json_string(nc::db::value_of(row, "user_glob")) + R"(,"action":)" +
                            json_string(nc::db::value_of(row, "action")) + R"(,"target":)" +
                            json_string(nc::db::value_of(row, "target")) + R"(,"message":)" +
                            json_string(nc::db::value_of(row, "message")) + "}";
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );
        m_app->route(
            "DELETE",
            std::string{BASE} + "/{id}",
            ADMIN,
            [this](const Request& request)
            {
                return nc::db::Client{m_host}.exec(
                           "DELETE FROM nc_flows WHERE id = ?",
                           {std::string{request.param("id")}}
                       ) == 0
                           ? nc::http::ocs(404, "No such flow", "{}")
                           : nc::http::ocs(200, "OK", "{}");
            }
        );
    }

private:
    void run_flows(const std::string& topic, std::string_view payload) const
    {
        const nc::db::Client db{m_host};
        const auto form = nc::util::parse_form(payload);
        const std::string path = nc::util::form_value(form, "path");
        std::string user = nc::util::form_value(form, "user");
        if (user.empty()) {
            user = nc::util::form_value(form, "owner");
        }
        for (const nc::db::Row& flow: db.query(
                 "SELECT name, event, path_glob, user_glob, action, target, message FROM nc_flows"
             )) {
            if (!nc::topic_matches(nc::db::value_of(flow, "event"), topic)) {
                continue;
            }
            const std::string path_glob = nc::db::value_of(flow, "path_glob");
            const std::string user_glob = nc::db::value_of(flow, "user_glob");
            if ((!path_glob.empty() && !nc::workflow::glob_matches(path_glob, path)) ||
                (!user_glob.empty() && !nc::workflow::glob_matches(user_glob, user))) {
                continue;
            }
            const std::string action = nc::db::value_of(flow, "action");
            const std::string target = nc::db::value_of(flow, "target");
            if (action == "notify") {
                std::string message = nc::db::value_of(flow, "message");
                if (message.empty()) {
                    message = "{event}: {path}";
                }
                message = replace_all(std::move(message), "{event}", topic);
                message = replace_all(std::move(message), "{path}", path);
                message = replace_all(std::move(message), "{user}", user);
                (void)m_host->call_service(
                    "notifications.push",
                    nc::util::form_encode(
                        {{"user", target},
                         {"subject", nc::db::value_of(flow, "name") + ": " + message}}
                    )
                );
            } else if (action == "tag" && !path.empty() && !user.empty()) {
                (void)m_host->call_service(
                    "systemtags.assign",
                    nc::util::form_encode({{"name", target}, {"owner", user}, {"path", path}})
                );
            }
        }
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(WorkflowEnginePlugin)
