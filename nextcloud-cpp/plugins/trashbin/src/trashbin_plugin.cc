/**
 * @file trashbin_plugin.cc
 * @brief The trash bin: a deleted file or folder is moved aside instead of removed, listed,
 * restored or removed for good, and removed by a background job after `retention_days`. Counterpart
 * of Nextcloud's `apps/files_trashbin`. The cloud plugin asks `trashbin.before_delete` before every
 * delete and keeps the bytes (`cloud.trash.*`); this plugin keeps the records.
 */
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <chrono>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions USER{nc::app::Access::USER, nc::app::Format::OCS};

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

class TrashbinPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "trashbin";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Deleted files can be restored";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"cloud", "db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        m_retention_days = std::strtol(host.config("retention_days", "30").c_str(), nullptr, 10);
        nc::db::Client{&host}.migrate(
            "trashbin",
            1,
            "CREATE TABLE nc_trash ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, name TEXT NOT NULL UNIQUE,"
            " orig_path TEXT NOT NULL, deleted_at INTEGER NOT NULL, size INTEGER NOT NULL, is_dir "
            "INTEGER NOT NULL);"
            "CREATE INDEX nc_trash_uid ON nc_trash (uid, id);"
        );

        host.add_service(
            "capabilities.files_trashbin",
            [](std::string_view)
            {
                return Response::json(200, R"({"undelete":true})");
            }
        );
        host.add_service(
            "trashbin.before_delete",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                const std::string path = nc::util::form_value(form, "path");
                const std::string name = nc::util::random_hex(8);
                const Response moved = m_host->call_service(
                    "cloud.trash.put",
                    nc::util::form_encode({{"user", user}, {"path", path}, {"name", name}})
                );
                if (moved.get_status() != 200) {
                    return Response::text(moved.get_status(), moved.get_body());
                }
                const auto info = nc::util::parse_form(moved.get_body());
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_trash (uid, name, orig_path, deleted_at, size, is_dir) VALUES "
                    "(?, ?, ?, ?, ?, ?)",
                    {user,
                     name,
                     path,
                     std::to_string(now_seconds()),
                     nc::util::form_value(info, "size"),
                     nc::util::form_value(info, "dir")}
                );
                return Response::text(200, name);
            }
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/files_trashbin/api/v1/trash";
        m_app->route(
            "GET",
            BASE,
            USER,
            [this](const Request& request)
            {
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, orig_path, deleted_at, size, is_dir FROM nc_trash WHERE uid = "
                         "? ORDER BY id DESC",
                         {request.get_user()}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += R"({"id":)" + nc::db::value_of(row, "id") + R"(,"original_path":)" +
                            json_string(nc::db::value_of(row, "orig_path")) + R"(,"deleted":)" +
                            nc::db::value_of(row, "deleted_at") + R"(,"size":)" +
                            nc::db::value_of(row, "size") + R"(,"type":")" +
                            (nc::db::value_of(row, "is_dir") == "1" ? "folder" : "file") + "\"}";
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );
        m_app->route(
            "POST",
            std::string{BASE} + "/{id}/restore",
            USER,
            [this](const Request& request)
            {
                const auto rows = entry(request.get_user(), std::string{request.param("id")});
                if (rows.empty()) {
                    return nc::http::ocs(404, "Not in the trash", "{}");
                }
                const Response restored = m_host->call_service(
                    "cloud.trash.restore",
                    nc::util::form_encode(
                        {{"user", request.get_user()},
                         {"name", nc::db::value_of(rows.front(), "name")},
                         {"target", nc::db::value_of(rows.front(), "orig_path")}}
                    )
                );
                if (restored.get_status() != 200) {
                    return nc::http::ocs(
                        restored.get_status() == 404 ? 404 : 500,
                        restored.get_body(),
                        "{}"
                    );
                }
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_trash WHERE id = ?",
                    {std::string{request.param("id")}}
                );
                m_host->publish(
                    "file.restored",
                    nc::util::form_encode(
                        {{"user", request.get_user()}, {"path", restored.get_body()}}
                    )
                );
                return nc::http::ocs(
                    200,
                    "OK",
                    R"({"path":)" + json_string(restored.get_body()) + "}"
                );
            }
        );
        m_app->route(
            "DELETE",
            std::string{BASE} + "/{id}",
            USER,
            [this](const Request& request)
            {
                const auto rows = entry(request.get_user(), std::string{request.param("id")});
                if (rows.empty()) {
                    return nc::http::ocs(404, "Not in the trash", "{}");
                }
                purge(request.get_user(), nc::db::value_of(rows.front(), "name"));
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        m_app->route(
            "DELETE",
            BASE,
            USER,
            [this](const Request& request)
            {
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT name FROM nc_trash WHERE uid = ?",
                         {request.get_user()}
                     )) {
                    purge(request.get_user(), nc::db::value_of(row, "name"));
                }
                return nc::http::ocs(200, "OK", "{}");
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_trash WHERE uid = ?",
                    {nc::util::form_value(nc::util::parse_form(payload), "id")}
                );
            }
        );
        host.add_job(
            "expire",
            3'600,
            [this]()
            {
                expire();
            }
        );
        host.add_command(
            "trash:list",
            "Lists the trash of a user: trash:list <user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: trash:list <user>\n";
                    return 1;
                }
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, orig_path, size FROM nc_trash WHERE uid = ? ORDER BY id",
                         {args[0]}
                     )) {
                    out += nc::db::value_of(row, "id") + "\t" + nc::db::value_of(row, "orig_path") +
                           "\t" + nc::db::value_of(row, "size") + "\n";
                }
                return 0;
            }
        );
        host.add_command(
            "trash:expire",
            "Removes what has been in the trash longer than retention_days",
            [this](const std::vector<std::string>&, std::string& out)
            {
                out = "removed " + std::to_string(expire()) + " item(s)\n";
                return 0;
            }
        );
    }

private:
    [[nodiscard]] std::vector<nc::db::Row>
    entry(const std::string& user, const std::string& id) const
    {
        return nc::db::Client{m_host}.query(
            "SELECT name, orig_path FROM nc_trash WHERE uid = ? AND id = ?",
            {user, id}
        );
    }

    void purge(const std::string& user, const std::string& name) const
    {
        (void)m_host->call_service(
            "cloud.trash.purge",
            nc::util::form_encode({{"user", user}, {"name", name}})
        );
        nc::db::Client{m_host}.exec("DELETE FROM nc_trash WHERE name = ?", {name});
    }

    std::int64_t expire() const
    {
        if (m_retention_days <= 0) {
            return 0;
        }
        std::int64_t count = 0;
        for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                 "SELECT uid, name FROM nc_trash WHERE deleted_at < ?",
                 {std::to_string(now_seconds() - m_retention_days * 86'400)}
             )) {
            purge(nc::db::value_of(row, "uid"), nc::db::value_of(row, "name"));
            ++count;
        }
        return count;
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
    long m_retention_days{30};
};

} // namespace

NC_PLUGIN(TrashbinPlugin)
