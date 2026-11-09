/**
 * @file versions_plugin.cc
 * @brief File versions: before a file is overwritten its old content is kept, listed and
 * restorable; only the newest `max_versions` per file are kept, and a job removes versions after
 * `retention_days`. Counterpart of Nextcloud's `apps/files_versions`. The cloud plugin asks
 * `versions.before_write` before every overwrite and keeps the bytes (`cloud.version.*`); this
 * plugin keeps the records.
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

class VersionsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "versions";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Older versions of files";
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
        m_max_versions = std::strtol(host.config("max_versions", "10").c_str(), nullptr, 10);
        m_retention_days = std::strtol(host.config("retention_days", "365").c_str(), nullptr, 10);
        nc::db::Client{&host}.migrate(
            "versions",
            1,
            "CREATE TABLE nc_versions ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, path TEXT NOT NULL,"
            " name TEXT NOT NULL UNIQUE, ts INTEGER NOT NULL, size INTEGER NOT NULL);"
            "CREATE INDEX nc_versions_file ON nc_versions (uid, path, id);"
        );

        host.add_service(
            "capabilities.files_versions",
            [](std::string_view)
            {
                return Response::json(200, R"({"versioning":true})");
            }
        );
        host.add_service(
            "versions.before_write",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                return keep(nc::util::form_value(form, "user"), nc::util::form_value(form, "path"))
                           ? Response::text(200, "kept")
                           : Response::text(404, "nothing to keep");
            }
        );

        m_app->route(
            "GET",
            "/ocs/v2.php/apps/files_versions/api/v1/versions",
            USER,
            [this](const Request& request)
            {
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, ts, size FROM nc_versions WHERE uid = ? AND path = ? ORDER BY "
                         "id DESC",
                         {request.get_user(), request.query_value("path")}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += R"({"id":)" + nc::db::value_of(row, "id") + R"(,"timestamp":)" +
                            nc::db::value_of(row, "ts") + R"(,"size":)" +
                            nc::db::value_of(row, "size") + "}";
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );
        m_app->route(
            "POST",
            "/ocs/v2.php/apps/files_versions/api/v1/versions/{id}/restore",
            USER,
            [this](const Request& request)
            {
                const auto rows = nc::db::Client{m_host}.query(
                    "SELECT name, path FROM nc_versions WHERE uid = ? AND id = ?",
                    {request.get_user(), std::string{request.param("id")}}
                );
                if (rows.empty()) {
                    return nc::http::ocs(404, "No such version", "{}");
                }
                const std::string path = nc::db::value_of(rows.front(), "path");
                keep(request.get_user(), path); // what is there now becomes a version too
                const Response restored = m_host->call_service(
                    "cloud.version.restore",
                    nc::util::form_encode(
                        {{"user", request.get_user()},
                         {"name", nc::db::value_of(rows.front(), "name")},
                         {"path", path}}
                    )
                );
                if (restored.get_status() != 200) {
                    return nc::http::ocs(500, restored.get_body(), "{}");
                }
                m_host->publish(
                    "file.updated",
                    nc::util::form_encode({{"user", request.get_user()}, {"path", path}})
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );

        // The history follows a file that is moved or renamed.
        host.subscribe(
            "file.moved",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                const std::string from = nc::util::form_value(form, "path");
                nc::db::Client{m_host}.exec(
                    "UPDATE nc_versions SET path = ? || substr(path, ?) WHERE uid = ? AND (path = "
                    "? OR path LIKE ? ESCAPE '\\')",
                    {nc::util::form_value(form, "target"),
                     std::to_string(from.size() + 1),
                     nc::util::form_value(form, "user"),
                     from,
                     like_prefix(from) + "/%"}
                );
            }
        );
        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                forget_user(nc::util::form_value(nc::util::parse_form(payload), "id"));
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
            "versions:list",
            "Lists the versions of a file: versions:list <user> <path>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 2) {
                    out = "usage: versions:list <user> <path>\n";
                    return 1;
                }
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, ts, size FROM nc_versions WHERE uid = ? AND path = ? ORDER BY "
                         "id DESC",
                         {args[0], args[1]}
                     )) {
                    out += nc::db::value_of(row, "id") + "\t" + nc::db::value_of(row, "ts") + "\t" +
                           nc::db::value_of(row, "size") + "\n";
                }
                return 0;
            }
        );
        host.add_command(
            "versions:expire",
            "Removes versions older than retention_days",
            [this](const std::vector<std::string>&, std::string& out)
            {
                out = "removed " + std::to_string(expire()) + " version(s)\n";
                return 0;
            }
        );
    }

private:
    [[nodiscard]] static std::string like_prefix(const std::string& path)
    {
        std::string out;
        for (const char letter: path) {
            if (letter == '%' || letter == '_' || letter == '\\') {
                out.push_back('\\');
            }
            out.push_back(letter);
        }
        return out;
    }

    bool keep(const std::string& user, const std::string& path) const
    {
        const std::string name = nc::util::random_hex(8);
        const Response copied = m_host->call_service(
            "cloud.version.put",
            nc::util::form_encode({{"user", user}, {"path", path}, {"name", name}})
        );
        if (copied.get_status() != 200) {
            return false;
        }
        const nc::db::Client db{m_host};
        db.exec(
            "INSERT INTO nc_versions (uid, path, name, ts, size) VALUES (?, ?, ?, ?, ?)",
            {user, path, name, std::to_string(now_seconds()), copied.get_body()}
        );
        if (m_max_versions > 0) {
            for (const nc::db::Row& row: db.query(
                     "SELECT id, name FROM nc_versions WHERE uid = ? AND path = ? ORDER BY id DESC "
                     "LIMIT -1 OFFSET ?",
                     {user, path, std::to_string(m_max_versions)}
                 )) {
                drop(user, nc::db::value_of(row, "id"), nc::db::value_of(row, "name"));
            }
        }
        return true;
    }

    void drop(const std::string& user, const std::string& id, const std::string& name) const
    {
        (void)m_host->call_service(
            "cloud.version.purge",
            nc::util::form_encode({{"user", user}, {"name", name}})
        );
        nc::db::Client{m_host}.exec("DELETE FROM nc_versions WHERE id = ?", {id});
    }

    void forget_user(const std::string& user) const
    {
        for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                 "SELECT id, name FROM nc_versions WHERE uid = ?",
                 {user}
             )) {
            drop(user, nc::db::value_of(row, "id"), nc::db::value_of(row, "name"));
        }
    }

    std::int64_t expire() const
    {
        if (m_retention_days <= 0) {
            return 0;
        }
        std::int64_t count = 0;
        for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                 "SELECT id, uid, name FROM nc_versions WHERE ts < ?",
                 {std::to_string(now_seconds() - m_retention_days * 86'400)}
             )) {
            drop(
                nc::db::value_of(row, "uid"),
                nc::db::value_of(row, "id"),
                nc::db::value_of(row, "name")
            );
            ++count;
        }
        return count;
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
    long m_max_versions{10};
    long m_retention_days{365};
};

} // namespace

NC_PLUGIN(VersionsPlugin)
