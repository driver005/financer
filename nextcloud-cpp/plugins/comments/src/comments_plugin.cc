/**
 * @file comments_plugin.cc
 * @brief Comments on files: write, list and delete, for the owner of a file and for people it is
 * shared with. Counterpart of Nextcloud's `lib/public/Comments` and `apps/comments`. Access is
 * decided by the cloud plugin (`cloud.can_access`), so it follows shares.
 */
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <chrono>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr std::size_t MAX_LENGTH = 1'000;

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

Response failure(int status, std::string_view message)
{
    return nc::http::ocs(status, message, "{}");
}

class CommentsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "comments";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Comments on files";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"cloud", "db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        nc::db::Client{&host}.migrate(
            "comments",
            1,
            "CREATE TABLE nc_comments ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, path TEXT NOT NULL,"
            " author TEXT NOT NULL, ts INTEGER NOT NULL, message TEXT NOT NULL);"
            "CREATE INDEX nc_comments_object ON nc_comments (owner, path, id);"
        );
        host.add_service(
            "capabilities.comments",
            [](std::string_view)
            {
                return Response::json(200, R"({"enabled":true,"max_length":1000})");
            }
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/comments/api/v1/comments";
        host.add_route(
            "GET",
            BASE,
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto object =
                    access(request, request.query_value("owner"), request.query_value("path"));
                if (!object.first.empty()) {
                    return failure(object.second, object.first);
                }
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, author, ts, message FROM nc_comments WHERE owner = ? AND path "
                         "= ? ORDER BY id",
                         {owner_of(request), request.query_value("path")}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += R"({"id":)" + nc::db::value_of(row, "id") + R"(,"actor":)" +
                            json_string(nc::db::value_of(row, "author")) + R"(,"timestamp":)" +
                            nc::db::value_of(row, "ts") + R"(,"message":)" +
                            json_string(nc::db::value_of(row, "message")) + "}";
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );
        host.add_route(
            "POST",
            BASE,
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto form = nc::util::parse_form(request.get_body());
                std::string owner = nc::util::form_value(form, "owner");
                owner = owner.empty() ? request.get_user() : owner;
                const std::string path = nc::util::form_value(form, "path");
                const std::string message =
                    std::string{nc::util::trim(nc::util::form_value(form, "message"))};
                if (message.empty() || message.size() > MAX_LENGTH) {
                    return failure(400, "A comment has 1 to 1000 characters");
                }
                const auto object = access(request, owner, path);
                if (!object.first.empty()) {
                    return failure(object.second, object.first);
                }
                std::int64_t id = 0;
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_comments (owner, path, author, ts, message) VALUES (?, ?, ?, "
                    "?, ?)",
                    {owner, path, request.get_user(), std::to_string(now_seconds()), message},
                    &id
                );
                m_host->publish(
                    "comment.created",
                    nc::util::form_encode(
                        {{"id", std::to_string(id)},
                         {"owner", owner},
                         {"path", path},
                         {"author", request.get_user()}}
                    )
                );
                return nc::http::ocs(200, "OK", R"({"id":)" + std::to_string(id) + "}");
            }
        );
        host.add_route(
            "DELETE",
            std::string{BASE} + "/{id}",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const nc::db::Client db{m_host};
                const auto rows = db.query(
                    "SELECT owner, author FROM nc_comments WHERE id = ?",
                    {std::string{request.param("id")}}
                );
                if (rows.empty()) {
                    return failure(404, "No such comment");
                }
                // The author deletes their words, and the owner of the file cleans up their own
                // files.
                if (nc::db::value_of(rows.front(), "author") != request.get_user() &&
                    nc::db::value_of(rows.front(), "owner") != request.get_user()) {
                    return failure(403, "Forbidden");
                }
                db.exec("DELETE FROM nc_comments WHERE id = ?", {std::string{request.param("id")}});
                return nc::http::ocs(200, "OK", "{}");
            }
        );

        host.subscribe(
            "file.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                const std::string path = nc::util::form_value(form, "path");
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_comments WHERE owner = ? AND (path = ? OR path LIKE ? ESCAPE "
                    "'\\')",
                    {nc::util::form_value(form, "user"), path, escape_like(path) + "/%"}
                );
            }
        );
        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const std::string id = nc::util::form_value(nc::util::parse_form(payload), "id");
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_comments WHERE owner = ? OR author = ?",
                    {id, id}
                );
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

    [[nodiscard]] static std::string owner_of(const Request& request)
    {
        const std::string owner = request.query_value("owner");
        return owner.empty() ? request.get_user() : owner;
    }

    /// Empty message when the user may see the object; otherwise the reason and the status.
    [[nodiscard]] std::pair<std::string, int>
    access(const Request& request, std::string owner, const std::string& path) const
    {
        owner = owner.empty() ? request.get_user() : owner;
        const Response answer = m_host->call_service(
            "cloud.can_access",
            nc::util::form_encode({{"owner", owner}, {"path", path}, {"user", request.get_user()}})
        );
        if (answer.get_status() == 200) {
            return {};
        }
        // A file nobody can see and one that does not exist look the same.
        return {"No such file", 404};
    }

    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(CommentsPlugin)
