/**
 * @file groups_plugin.cc
 * @brief Groups of accounts: the `groups.*` services, the OCS group API and the `group:*` commands.
 * Counterpart of Nextcloud's `lib/private/Group` and the group part of `apps/provisioning_api`.
 */
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <cctype>
#include <optional>

namespace {

using nc::http::Request;
using nc::http::Response;

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

Response ok(std::string_view data = "{}")
{
    return nc::http::ocs(200, "OK", data);
}

Response failure(int status, std::string_view message)
{
    return nc::http::ocs(status, message, "{}");
}

bool valid_group(std::string_view id) noexcept
{
    return !id.empty() && id.size() <= 64 &&
           std::ranges::all_of(
               id,
               [](unsigned char letter)
               {
                   return std::isalnum(letter) != 0 || letter == ' ' || letter == '_' ||
                          letter == '.' || letter == '@' || letter == '-';
               }
           );
}

class GroupsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "groups";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Groups of accounts";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        const nc::db::Client db{&host};
        db.migrate(
            "groups",
            1,
            "CREATE TABLE nc_groups (id TEXT PRIMARY KEY);"
            "CREATE TABLE nc_group_members ("
            " gid TEXT NOT NULL REFERENCES nc_groups(id) ON DELETE CASCADE,"
            " uid TEXT NOT NULL, PRIMARY KEY (gid, uid));"
            "CREATE INDEX nc_group_members_uid ON nc_group_members (uid);"
        );

        host.add_service(
            "groups.exists",
            [this](std::string_view args)
            {
                return exists(args) ? Response::text(200, "1")
                                    : Response::text(404, "no such group");
            }
        );
        host.add_service(
            "groups.is_member",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                return member(
                           nc::util::form_value(form, "group"),
                           nc::util::form_value(form, "user")
                       )
                           ? Response::text(200, "1")
                           : Response::text(404, "no");
            }
        );
        host.add_service(
            "groups.of",
            [this](std::string_view args)
            {
                std::string body;
                for (const std::string& group: groups_of(args)) {
                    body += group + "\n";
                }
                return Response::text(200, std::move(body));
            }
        );
        host.add_service(
            "groups.members",
            [this](std::string_view args)
            {
                std::string body;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT uid FROM nc_group_members WHERE gid = ? ORDER BY uid",
                         {std::string{args}}
                     )) {
                    body += nc::db::value_of(row, "uid") + "\n";
                }
                return Response::text(200, std::move(body));
            }
        );

        constexpr std::string_view BASE = "/ocs/v2.php/cloud/groups";
        host.add_route(
            "GET",
            BASE,
            [this](const Request& request)
            {
                if (const auto denied = require_admin(request)) {
                    return *denied;
                }
                std::string data = R"({"groups":[)";
                bool first = true;
                for (const nc::db::Row& row:
                     nc::db::Client{m_host}.query("SELECT id FROM nc_groups ORDER BY id")) {
                    data += first ? "" : ",";
                    first = false;
                    data += json_string(nc::db::value_of(row, "id"));
                }
                return ok(data + "]}");
            }
        );
        host.add_route(
            "POST",
            BASE,
            [this](const Request& request)
            {
                if (const auto denied = require_admin(request)) {
                    return *denied;
                }
                const std::string id = field(request, "groupid");
                if (!valid_group(id)) {
                    return failure(400, "Invalid group id");
                }
                if (exists(id)) {
                    return failure(409, "The group already exists");
                }
                nc::db::Client{m_host}.exec("INSERT INTO nc_groups (id) VALUES (?)", {id});
                m_host->publish("group.created", nc::util::form_encode({{"id", id}}));
                return ok();
            }
        );
        host.add_route(
            "DELETE",
            std::string{BASE} + "/{gid}",
            [this](const Request& request)
            {
                if (const auto denied = require_admin(request)) {
                    return *denied;
                }
                const std::string id{request.param("gid")};
                if (nc::db::Client{m_host}.exec("DELETE FROM nc_groups WHERE id = ?", {id}) == 0) {
                    return failure(404, "The group does not exist");
                }
                m_host->publish("group.deleted", nc::util::form_encode({{"id", id}}));
                return ok();
            }
        );
        host.add_route(
            "GET",
            std::string{BASE} + "/{gid}/users",
            [this](const Request& request)
            {
                if (const auto denied = require_admin(request)) {
                    return *denied;
                }
                const std::string id{request.param("gid")};
                if (!exists(id)) {
                    return failure(404, "The group does not exist");
                }
                std::string data = R"({"users":[)";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT uid FROM nc_group_members WHERE gid = ? ORDER BY uid",
                         {id}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += json_string(nc::db::value_of(row, "uid"));
                }
                return ok(data + "]}");
            }
        );
        host.add_route(
            "GET",
            "/ocs/v2.php/cloud/users/{userid}/groups",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const std::string user{request.param("userid")};
                if (user != request.get_user() && !is_admin(request.get_user())) {
                    return failure(403, "Forbidden");
                }
                std::string data = R"({"groups":[)";
                bool first = true;
                for (const std::string& group: groups_of(user)) {
                    data += first ? "" : ",";
                    first = false;
                    data += json_string(group);
                }
                return ok(data + "]}");
            }
        );
        host.add_route(
            "POST",
            "/ocs/v2.php/cloud/users/{userid}/groups",
            [this](const Request& request)
            {
                return change_membership(request, true);
            }
        );
        host.add_route(
            "DELETE",
            "/ocs/v2.php/cloud/users/{userid}/groups",
            [this](const Request& request)
            {
                return change_membership(request, false);
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_group_members WHERE uid = ?",
                    {nc::util::form_value(nc::util::parse_form(payload), "id")}
                );
            }
        );

        host.add_command(
            "group:add",
            "Adds a group: group:add <id>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1 || !valid_group(args[0])) {
                    out = "usage: group:add <id>\n";
                    return 1;
                }
                if (exists(args[0])) {
                    out = "The group already exists\n";
                    return 1;
                }
                nc::db::Client{m_host}.exec("INSERT INTO nc_groups (id) VALUES (?)", {args[0]});
                m_host->publish("group.created", nc::util::form_encode({{"id", args[0]}}));
                out = "Created group \"" + args[0] + "\"\n";
                return 0;
            }
        );
        host.add_command(
            "group:list",
            "Lists the groups and their members",
            [this](const std::vector<std::string>&, std::string& out)
            {
                const nc::db::Client client{m_host};
                for (const nc::db::Row& group:
                     client.query("SELECT id FROM nc_groups ORDER BY id")) {
                    const std::string id = nc::db::value_of(group, "id");
                    out += id + ":";
                    for (const nc::db::Row& row: client.query(
                             "SELECT uid FROM nc_group_members WHERE gid = ? ORDER BY uid",
                             {id}
                         )) {
                        out += " " + nc::db::value_of(row, "uid");
                    }
                    out += "\n";
                }
                return 0;
            }
        );
        host.add_command(
            "group:adduser",
            "Adds an account to a group: group:adduser <group> <user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 2) {
                    out = "usage: group:adduser <group> <user>\n";
                    return 1;
                }
                const std::string error = add_member(args[0], args[1]);
                out = error.empty() ? "done\n" : error + "\n";
                return error.empty() ? 0 : 1;
            }
        );
        host.add_command(
            "group:removeuser",
            "Removes an account from a group: group:removeuser <group> <user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 2) {
                    out = "usage: group:removeuser <group> <user>\n";
                    return 1;
                }
                const bool removed = nc::db::Client{m_host}.exec(
                                         "DELETE FROM nc_group_members WHERE gid = ? AND uid = ?",
                                         {args[0], args[1]}
                                     ) > 0;
                out = removed ? "done\n" : "not a member\n";
                return removed ? 0 : 1;
            }
        );
        host.add_command(
            "group:delete",
            "Deletes a group: group:delete <id>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: group:delete <id>\n";
                    return 1;
                }
                const bool removed =
                    nc::db::Client{m_host}.exec("DELETE FROM nc_groups WHERE id = ?", {args[0]}) >
                    0;
                if (removed) {
                    m_host->publish("group.deleted", nc::util::form_encode({{"id", args[0]}}));
                }
                out = removed ? "done\n" : "no such group\n";
                return removed ? 0 : 1;
            }
        );
    }

private:
    [[nodiscard]] static std::string field(const Request& request, std::string_view name)
    {
        std::string value = nc::util::form_value(nc::util::parse_form(request.get_body()), name);
        return value.empty() ? request.query_value(name) : value;
    }

    [[nodiscard]] bool exists(std::string_view id) const
    {
        return !nc::db::Client{m_host}
                    .query("SELECT 1 AS x FROM nc_groups WHERE id = ?", {std::string{id}})
                    .empty();
    }

    [[nodiscard]] bool member(std::string_view group, std::string_view user) const
    {
        return !nc::db::Client{m_host}
                    .query(
                        "SELECT 1 AS x FROM nc_group_members WHERE gid = ? AND uid = ?",
                        {std::string{group}, std::string{user}}
                    )
                    .empty();
    }

    [[nodiscard]] std::vector<std::string> groups_of(std::string_view user) const
    {
        std::vector<std::string> out;
        for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                 "SELECT gid FROM nc_group_members WHERE uid = ? ORDER BY gid",
                 {std::string{user}}
             )) {
            out.push_back(nc::db::value_of(row, "gid"));
        }
        return out;
    }

    [[nodiscard]] bool is_admin(std::string_view user) const
    {
        const Response answer = m_host->call_service("users.get", user);
        return answer.get_status() == 200 &&
               answer.get_body().find(R"("admin":true)") != std::string::npos;
    }

    [[nodiscard]] std::optional<Response> require_admin(const Request& request) const
    {
        if (request.get_user().empty()) {
            return nc::http::unauthorized();
        }
        if (!is_admin(request.get_user())) {
            return failure(403, "Forbidden");
        }
        return std::nullopt;
    }

    /// Empty on success, the reason otherwise.
    [[nodiscard]] std::string add_member(std::string_view group, std::string_view user) const
    {
        if (!exists(group)) {
            return "The group does not exist";
        }
        if (m_host->call_service("users.get", user).get_status() != 200) {
            return "The user does not exist";
        }
        if (member(group, user)) {
            return "The user is already in the group";
        }
        nc::db::Client{m_host}.exec(
            "INSERT INTO nc_group_members (gid, uid) VALUES (?, ?)",
            {std::string{group}, std::string{user}}
        );
        m_host->publish(
            "group.member_added",
            nc::util::form_encode({{"group", std::string{group}}, {"user", std::string{user}}})
        );
        return {};
    }

    [[nodiscard]] Response change_membership(const Request& request, bool add) const
    {
        if (const auto denied = require_admin(request)) {
            return *denied;
        }
        const std::string user{request.param("userid")};
        const std::string group = field(request, "groupid");
        if (add) {
            const std::string error = add_member(group, user);
            return error.empty()
                       ? ok()
                       : failure(error.find("already") != std::string::npos ? 409 : 404, error);
        }
        if (nc::db::Client{m_host}.exec(
                "DELETE FROM nc_group_members WHERE gid = ? AND uid = ?",
                {group, user}
            ) == 0) {
            return failure(404, "The user is not in the group");
        }
        m_host->publish(
            "group.member_removed",
            nc::util::form_encode({{"group", group}, {"user", user}})
        );
        return ok();
    }

    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(GroupsPlugin)
