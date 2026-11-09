/**
 * @file notifications_plugin.cc
 * @brief Notifications for people: the `notifications.push` service, the notifications API, and a
 * notification for the recipient of a share. Counterpart of Nextcloud's `lib/public/Notification`
 * and `apps/notifications`. Dismissed notifications are deleted; a job removes old ones.
 */
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
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

std::string notification_json(const nc::db::Row& row)
{
    return R"({"notification_id":)" + nc::db::value_of(row, "id") + R"(,"datetime":)" +
           nc::db::value_of(row, "ts") + R"(,"subject":)" +
           json_string(nc::db::value_of(row, "subject")) + R"(,"message":)" +
           json_string(nc::db::value_of(row, "message")) + R"(,"link":)" +
           json_string(nc::db::value_of(row, "link")) + "}";
}

class NotificationsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "notifications";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Notifications for people";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        nc::db::Client{&host}.migrate(
            "notifications",
            1,
            "CREATE TABLE nc_notifications ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, ts INTEGER NOT NULL,"
            " subject TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT "
            "'');"
            "CREATE INDEX nc_notifications_uid ON nc_notifications (uid, id);"
        );

        // Form: user, subject, message (optional), link (optional). Answers with the notification
        // id.
        host.add_service(
            "notifications.push",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                const std::string subject = nc::util::form_value(form, "subject");
                if (user.empty() || subject.empty()) {
                    return Response::text(400, "user and subject are required");
                }
                return Response::text(
                    200,
                    std::to_string(push(
                        user,
                        subject,
                        nc::util::form_value(form, "message"),
                        nc::util::form_value(form, "link")
                    ))
                );
            }
        );

        host.subscribe(
            "share.created",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                const std::string recipient = nc::util::form_value(form, "type") == "0"
                                                  ? nc::util::form_value(form, "share_with")
                                                  : std::string{};
                if (!recipient.empty()) {
                    push(
                        recipient,
                        nc::util::form_value(form, "owner") + " shared \"" +
                            nc::util::form_value(form, "path") + "\" with you",
                        "",
                        ""
                    );
                }
            }
        );

        host.subscribe(
            "comment.created",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                const std::string owner = nc::util::form_value(form, "owner");
                const std::string author = nc::util::form_value(form, "author");
                if (owner != author) {
                    push(
                        owner,
                        author + " commented on \"" + nc::util::form_value(form, "path") + "\"",
                        "",
                        ""
                    );
                }
            }
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/notifications/api/v2/notifications";
        m_app->route(
            "GET",
            BASE,
            USER,
            [this](const Request& request)
            {
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, ts, subject, message, link FROM nc_notifications WHERE uid = "
                         "? ORDER BY id DESC",
                         {request.get_user()}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += notification_json(row);
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );
        m_app->route(
            "GET",
            std::string{BASE} + "/{id}",
            USER,
            [this](const Request& request)
            {
                const auto rows = nc::db::Client{m_host}.query(
                    "SELECT id, ts, subject, message, link FROM nc_notifications WHERE uid = ? AND "
                    "id = ?",
                    {request.get_user(), std::string{request.param("id")}}
                );
                return rows.empty() ? nc::http::ocs(404, "Notification not found", "{}")
                                    : nc::http::ocs(200, "OK", notification_json(rows.front()));
            }
        );
        m_app->route(
            "DELETE",
            std::string{BASE} + "/{id}",
            USER,
            [this](const Request& request)
            {
                const auto removed = nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_notifications WHERE uid = ? AND id = ?",
                    {request.get_user(), std::string{request.param("id")}}
                );
                return removed == 0 ? nc::http::ocs(404, "Notification not found", "{}")
                                    : nc::http::ocs(200, "OK", "{}");
            }
        );
        m_app->route(
            "DELETE",
            BASE,
            USER,
            [this](const Request& request)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_notifications WHERE uid = ?",
                    {request.get_user()}
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );

        host.add_job(
            "prune",
            3'600,
            [this]()
            {
                prune();
            }
        );
        host.add_command(
            "notification:generate",
            "Sends a notification: notification:generate <user> <subject> [message]",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() < 2) {
                    out = "usage: notification:generate <user> <subject> [message]\n";
                    return 1;
                }
                out = "created " +
                      std::to_string(
                          push(args[0], args[1], args.size() > 2 ? args[2] : std::string{}, "")
                      ) +
                      "\n";
                return 0;
            }
        );
    }

private:
    std::int64_t push(
        const std::string& user,
        const std::string& subject,
        const std::string& message,
        const std::string& link
    ) const
    {
        std::int64_t id = 0;
        nc::db::Client{m_host}.exec(
            "INSERT INTO nc_notifications (uid, ts, subject, message, link) VALUES (?, ?, ?, ?, ?)",
            {user, std::to_string(now_seconds()), subject, message, link},
            &id
        );
        m_host->publish(
            "notification.created",
            nc::util::form_encode({{"user", user}, {"id", std::to_string(id)}})
        );
        return id;
    }

    void prune() const
    {
        nc::db::Client{m_host}.exec(
            "DELETE FROM nc_notifications WHERE ts < ?",
            {std::to_string(now_seconds() - 90 * 86'400)}
        );
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(NotificationsPlugin)
