/**
 * @file files_reminders_plugin.cc
 * @brief Reminders for files (Nextcloud's `files_reminders` app): a person asks to be reminded of
 * a file at a time, and a notification "Reminder for <file>" arrives then.
 *
 *   GET    /ocs/v2.php/apps/files_reminders/api/v1/{fileId}   {"dueDate":
 * "2026-11-12T10:30:00+00:00"} or null PUT    /ocs/v2.php/apps/files_reminders/api/v1/{fileId}
 * dueDate=<ISO 8601, in the future>: 201 new, 200 changed DELETE
 * /ocs/v2.php/apps/files_reminders/api/v1/{fileId}   200, 404 when there is none
 *
 * The file is named by the number WebDAV shows as `oc:fileid`; it is looked up when the reminder is
 * set and again when it is due, so a file that was renamed in between is still found, and one that
 * is gone sends nothing. A job sends what is due once a minute, another forgets the sent ones after
 * a day.
 */
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"
#include "nextcloud/util/time.h"

#include <chrono>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions USER{nc::app::Access::USER, nc::app::Format::OCS};
constexpr std::int64_t KEEP_SENT_SECONDS = 24 * 3'600;

std::int64_t now_seconds()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

class FilesRemindersPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "files_reminders";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Reminders for files";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "cloud", "notifications"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        nc::db::Client{&host}.migrate(
            "files_reminders",
            1,
            "CREATE TABLE nc_file_reminders (uid TEXT NOT NULL, file_id INTEGER NOT NULL, due "
            "INTEGER NOT NULL, notified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (uid, file_id));"
            "CREATE INDEX nc_file_reminders_due ON nc_file_reminders (due);"
        );
        constexpr std::string_view ONE = "/ocs/v2.php/apps/files_reminders/api/v1/{fileId}";
        m_app->route(
            "GET",
            ONE,
            USER,
            [this](const Request& request)
            {
                return get(request);
            }
        );
        m_app->route(
            "PUT",
            ONE,
            USER,
            [this](const Request& request)
            {
                return set(request);
            }
        );
        m_app->route(
            "DELETE",
            ONE,
            USER,
            [this](const Request& request)
            {
                return remove(request);
            }
        );
        host.add_job(
            "send",
            60,
            [this]()
            {
                send_due();
            }
        );
        host.add_job(
            "clean_up",
            3'600,
            [this]()
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_file_reminders WHERE notified = 1 AND due < ?",
                    {std::to_string(now_seconds() - KEEP_SENT_SECONDS)}
                );
            }
        );
        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_file_reminders WHERE uid = ?",
                    {nc::util::form_value(nc::util::parse_form(payload), "id")}
                );
            }
        );
    }

private:
    /// The file's path while it exists; empty otherwise.
    [[nodiscard]] std::string path_of(const std::string& user, const std::string& id) const
    {
        const Response answer = m_host->call_service("files.path_of", user + "\n" + id);
        return answer.get_status() == 200 ? answer.get_body() : std::string{};
    }

    static bool plausible_id(std::string_view id)
    {
        return !id.empty() && id.size() <= 18 &&
               id.find_first_not_of("0123456789") == std::string_view::npos;
    }

    [[nodiscard]] Response get(const Request& request) const
    {
        const std::string id{request.param("fileId")};
        const std::string null_answer = R"({"dueDate":null})";
        if (!plausible_id(id) || path_of(request.get_user(), id).empty()) {
            return nc::http::ocs(200, "OK", null_answer);
        }
        const auto rows = nc::db::Client{m_host}.query(
            "SELECT due FROM nc_file_reminders WHERE uid = ? AND file_id = ?",
            {request.get_user(), id}
        );
        // A reminder that is due now or past is not shown (it has been or is about to be sent).
        if (rows.empty() ||
            std::atoll(nc::db::value_of(rows.front(), "due").c_str()) <= now_seconds()) {
            return nc::http::ocs(200, "OK", null_answer);
        }
        return nc::http::ocs(
            200,
            "OK",
            R"({"dueDate":")" +
                nc::util::format_atom(std::atoll(nc::db::value_of(rows.front(), "due").c_str())) +
                "\"}"
        );
    }

    [[nodiscard]] Response set(const Request& request) const
    {
        const std::string id{request.param("fileId")};
        std::string text =
            nc::util::form_value(nc::util::parse_form(request.get_body()), "dueDate");
        if (text.empty()) {
            text = request.query_value("dueDate");
        }
        if (text.empty() && !request.get_body().empty() && request.get_body().front() == '{') {
            if (const auto json = nc::util::Json::parse(request.get_body())) {
                text = (*json)["dueDate"].string();
            }
        }
        const auto due = nc::util::parse_iso8601(text);
        if (!due || *due <= now_seconds() || !plausible_id(id)) {
            return nc::http::ocs(400, "Bad Request", "{}");
        }
        if (path_of(request.get_user(), id).empty()) {
            return nc::http::ocs(404, "Not Found", "{}");
        }
        const nc::db::Client db{m_host};
        const bool existed = !db.query(
                                    "SELECT 1 FROM nc_file_reminders WHERE uid = ? AND file_id = ?",
                                    {request.get_user(), id}
        )
                                  .empty();
        db.exec(
            "INSERT INTO nc_file_reminders (uid, file_id, due, notified) VALUES (?, ?, ?, 0) ON "
            "CONFLICT(uid, file_id) DO UPDATE SET due = excluded.due, notified = 0",
            {request.get_user(), id, std::to_string(*due)}
        );
        return existed ? nc::http::ocs(200, "OK", "{}") : nc::http::ocs(201, "Created", "{}");
    }

    [[nodiscard]] Response remove(const Request& request) const
    {
        const std::string id{request.param("fileId")};
        if (!plausible_id(id) || path_of(request.get_user(), id).empty() ||
            nc::db::Client{m_host}.exec(
                "DELETE FROM nc_file_reminders WHERE uid = ? AND file_id = ?",
                {request.get_user(), id}
            ) == 0) {
            return nc::http::ocs(404, "Not Found", "{}");
        }
        return nc::http::ocs(200, "OK", "{}");
    }

    /// Notifies each reminder that is due, once. A file that is gone ends its reminder quietly.
    void send_due() const
    {
        const nc::db::Client db{m_host};
        for (const nc::db::Row& row: db.query(
                 "SELECT uid, file_id FROM nc_file_reminders WHERE notified = 0 AND due <= ?",
                 {std::to_string(now_seconds())}
             )) {
            const std::string user = nc::db::value_of(row, "uid");
            const std::string id = nc::db::value_of(row, "file_id");
            // Marked first: a failure to notify must not repeat for ever.
            db.exec(
                "UPDATE nc_file_reminders SET notified = 1 WHERE uid = ? AND file_id = ?",
                {user, id}
            );
            const std::string path = path_of(user, id);
            if (path.empty()) {
                db.exec("DELETE FROM nc_file_reminders WHERE uid = ? AND file_id = ?", {user, id});
                continue;
            }
            const std::string name = path.substr(path.rfind('/') + 1);
            (void)m_host->call_service(
                "notifications.push",
                nc::util::form_encode(
                    {{"user", user},
                     {"subject", "Reminder for " + name},
                     {"message", ""},
                     {"link", "/index.php/f/" + id}}
                )
            );
        }
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(FilesRemindersPlugin)
