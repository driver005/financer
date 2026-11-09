/**
 * @file systemtags_plugin.cc
 * @brief Tags shared by everybody, put on a user's files: create, list, delete, assign, find.
 * Counterpart of Nextcloud's `lib/public/SystemTag` and `apps/systemtags`. Without file ids, an
 * object is the pair (owner, path); assignments follow moved and deleted files through the events
 * of the cloud plugin.
 */
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions USER{nc::app::Access::USER, nc::app::Format::OCS};

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

Response failure(int status, std::string_view message)
{
    return nc::http::ocs(status, message, "{}");
}

bool valid_tag(std::string_view name) noexcept
{
    return !name.empty() && name.size() <= 64 &&
           std::ranges::none_of(
               name,
               [](unsigned char letter)
               {
                   return letter < 0x20 || letter == 0x7f;
               }
           );
}

class SystemTagsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "systemtags";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Tags for files";
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
        nc::db::Client{&host}.migrate(
            "systemtags",
            1,
            "CREATE TABLE nc_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL "
            "UNIQUE);"
            "CREATE TABLE nc_tag_objects ("
            " tag_id INTEGER NOT NULL REFERENCES nc_tags(id) ON DELETE CASCADE,"
            " owner TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (tag_id, owner, path));"
            "CREATE INDEX nc_tag_objects_path ON nc_tag_objects (owner, path);"
        );
        host.add_service(
            "capabilities.systemtags",
            [](std::string_view)
            {
                return Response::json(200, R"({"enabled":true})");
            }
        );

        // Form: name, owner, path. Puts the tag on the file, creating the tag when it is new (for
        // other plugins, such as the workflow engine).
        host.add_service(
            "systemtags.assign",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string name = nc::util::form_value(form, "name");
                if (name.empty() || name.size() > 64 ||
                    nc::util::form_value(form, "owner").empty() ||
                    nc::util::form_value(form, "path").empty()) {
                    return Response::text(400, "name, owner and path are required");
                }
                const nc::db::Client db{m_host};
                db.exec("INSERT OR IGNORE INTO nc_tags (name) VALUES (?)", {name});
                db.exec(
                    "INSERT OR IGNORE INTO nc_tag_objects (tag_id, owner, path) SELECT id, ?, ? "
                    "FROM "
                    "nc_tags WHERE name = ?",
                    {nc::util::form_value(form, "owner"), nc::util::form_value(form, "path"), name}
                );
                return Response::text(200, "ok");
            }
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/systemtags/api/v1";
        m_app->route(
            "GET",
            std::string{BASE} + "/tags",
            USER,
            [this](const Request&)
            {
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row:
                     nc::db::Client{m_host}.query("SELECT id, name FROM nc_tags ORDER BY name")) {
                    data += first ? "" : ",";
                    first = false;
                    data += R"({"id":)" + nc::db::value_of(row, "id") + R"(,"name":)" +
                            json_string(nc::db::value_of(row, "name")) + "}";
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );
        m_app->route(
            "POST",
            std::string{BASE} + "/tags",
            USER,
            [this](const Request& request)
            {
                const std::string name = field(request, "name");
                if (!valid_tag(name)) {
                    return failure(400, "Invalid tag name");
                }
                const nc::db::Client db{m_host};
                if (!db.query("SELECT 1 AS x FROM nc_tags WHERE name = ?", {name}).empty()) {
                    return failure(409, "The tag already exists");
                }
                std::int64_t id = 0;
                db.exec("INSERT INTO nc_tags (name) VALUES (?)", {name}, &id);
                return nc::http::ocs(200, "OK", R"({"id":)" + std::to_string(id) + "}");
            }
        );
        m_app->route(
            "DELETE",
            std::string{BASE} + "/tags/{id}",
            USER,
            [this](const Request& request)
            {
                // Tags belong to everybody, so only an administrator removes one.
                const Response who = m_host->call_service("users.get", request.get_user());
                if (who.get_body().find(R"("admin":true)") == std::string::npos) {
                    return failure(403, "Forbidden");
                }
                return nc::db::Client{m_host}.exec(
                           "DELETE FROM nc_tags WHERE id = ?",
                           {std::string{request.param("id")}}
                       ) == 0
                           ? failure(404, "No such tag")
                           : nc::http::ocs(200, "OK", "{}");
            }
        );
        // Put a tag on one of your own files, or take it off again.
        m_app->route(
            "POST",
            std::string{BASE} + "/objects",
            USER,
            [this](const Request& request)
            {
                const Response found = m_host->call_service(
                    "cloud.stat",
                    nc::util::form_encode(
                        {{"user", request.get_user()}, {"path", field(request, "path")}}
                    )
                );
                if (found.get_status() != 200) {
                    return failure(404, "No such file");
                }
                const std::string path =
                    nc::util::form_value(nc::util::parse_form(found.get_body()), "path");
                const nc::db::Client db{m_host};
                if (db.query("SELECT 1 AS x FROM nc_tags WHERE id = ?", {field(request, "tag")})
                        .empty()) {
                    return failure(404, "No such tag");
                }
                db.exec(
                    "INSERT OR IGNORE INTO nc_tag_objects (tag_id, owner, path) VALUES (?, ?, ?)",
                    {field(request, "tag"), request.get_user(), path}
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        m_app->route(
            "DELETE",
            std::string{BASE} + "/objects",
            USER,
            [this](const Request& request)
            {
                const auto removed = nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_tag_objects WHERE tag_id = ? AND owner = ? AND path = ?",
                    {field(request, "tag"), request.get_user(), field(request, "path")}
                );
                return removed == 0 ? failure(404, "The file does not have that tag")
                                    : nc::http::ocs(200, "OK", "{}");
            }
        );
        // The tags of one file (?path=), or the files that have one tag (?tag=).
        m_app->route(
            "GET",
            std::string{BASE} + "/objects",
            USER,
            [this](const Request& request)
            {
                const nc::db::Client db{m_host};
                std::string data = "[";
                bool first = true;
                const std::string path = request.query_value("path");
                const auto rows =
                    path.empty()
                        ? db.query(
                              "SELECT path AS value FROM nc_tag_objects WHERE tag_id = ? AND owner "
                              "= ? ORDER BY path",
                              {request.query_value("tag"), request.get_user()}
                          )
                        : db.query(
                              "SELECT t.name AS value FROM nc_tag_objects o JOIN nc_tags t ON t.id "
                              "= o.tag_id WHERE o.owner = ? AND o.path = ? ORDER BY t.name",
                              {request.get_user(), path}
                          );
                for (const nc::db::Row& row: rows) {
                    data += first ? "" : ",";
                    first = false;
                    data += json_string(nc::db::value_of(row, "value"));
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );

        host.subscribe(
            "file.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                const std::string path = nc::util::form_value(form, "path");
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_tag_objects WHERE owner = ? AND (path = ? OR path LIKE ? "
                    "ESCAPE '\\')",
                    {nc::util::form_value(form, "user"), path, escape_like(path) + "/%"}
                );
            }
        );
        host.subscribe(
            "file.moved",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                const std::string from = nc::util::form_value(form, "path");
                nc::db::Client{m_host}.exec(
                    "UPDATE nc_tag_objects SET path = ? || substr(path, ?) WHERE owner = ? AND "
                    "(path = ? OR path LIKE ? ESCAPE '\\')",
                    {nc::util::form_value(form, "target"),
                     std::to_string(from.size() + 1),
                     nc::util::form_value(form, "user"),
                     from,
                     escape_like(from) + "/%"}
                );
            }
        );
        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_tag_objects WHERE owner = ?",
                    {nc::util::form_value(nc::util::parse_form(payload), "id")}
                );
            }
        );
        host.add_command(
            "tag:add",
            "Creates a tag: tag:add <name>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1 || !valid_tag(args[0])) {
                    out = "usage: tag:add <name>\n";
                    return 1;
                }
                const nc::db::Client db{m_host};
                if (!db.query("SELECT 1 AS x FROM nc_tags WHERE name = ?", {args[0]}).empty()) {
                    out = "The tag already exists\n";
                    return 1;
                }
                std::int64_t id = 0;
                db.exec("INSERT INTO nc_tags (name) VALUES (?)", {args[0]}, &id);
                out = "created tag " + std::to_string(id) + "\n";
                return 0;
            }
        );
    }

private:
    [[nodiscard]] static std::string escape_like(const std::string& text)
    {
        std::string out;
        for (const char letter: text) {
            if (letter == '%' || letter == '_' || letter == '\\') {
                out.push_back('\\');
            }
            out.push_back(letter);
        }
        return out;
    }

    [[nodiscard]] static std::string field(const Request& request, std::string_view name)
    {
        std::string value = nc::util::form_value(nc::util::parse_form(request.get_body()), name);
        return value.empty() ? request.query_value(name) : value;
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(SystemTagsPlugin)
