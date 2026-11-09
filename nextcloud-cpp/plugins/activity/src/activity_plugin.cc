/**
 * @file activity_plugin.cc
 * @brief The activity stream: records what happens to a user's files and accounts (from the events
 * other plugins publish) and lists it through the API. Counterpart of Nextcloud's
 * `lib/public/Activity` and the `activity` app. A background job removes entries after
 * `retention_days`.
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

class ActivityPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "activity";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Activity stream of files, shares and accounts";
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
        m_retention_days = std::strtol(host.config("retention_days", "365").c_str(), nullptr, 10);
        nc::db::Client{&host}.migrate(
            "activity",
            1,
            "CREATE TABLE nc_activity ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, ts INTEGER NOT NULL,"
            " type TEXT NOT NULL, subject TEXT NOT NULL, path TEXT NOT NULL DEFAULT '');"
            "CREATE INDEX nc_activity_uid ON nc_activity (uid, id);"
        );

        for (const std::string_view topic:
             {"file.created", "file.updated", "file.deleted", "file.moved", "file.copied"}) {
            host.subscribe(
                topic,
                [this](std::string_view event, std::string_view payload)
                {
                    const auto form = nc::util::parse_form(payload);
                    const std::string verb{event.substr(5)};
                    record(
                        nc::util::form_value(form, "user"),
                        std::string{event},
                        "You " + verb + " " + nc::util::form_value(form, "path"),
                        nc::util::form_value(form, "path")
                    );
                }
            );
        }
        host.subscribe(
            "share.created",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                const std::string owner = nc::util::form_value(form, "owner");
                const std::string path = nc::util::form_value(form, "path");
                const std::string recipient = nc::util::form_value(form, "type") == "0"
                                                  ? nc::util::form_value(form, "share_with")
                                                  : std::string{};
                const std::string group = nc::util::form_value(form, "type") == "1"
                                              ? nc::util::form_value(form, "share_with")
                                              : std::string{};
                if (!group.empty()) {
                    record(
                        owner,
                        "share.created",
                        "You shared " + path + " with the group " + group,
                        path
                    );
                } else if (recipient.empty()) {
                    record(owner, "share.created", "You shared " + path + " by link", path);
                } else {
                    record(
                        owner,
                        "share.created",
                        "You shared " + path + " with " + recipient,
                        path
                    );
                    record(
                        recipient,
                        "share.received",
                        owner + " shared " + path + " with you",
                        path
                    );
                }
            }
        );
        host.subscribe(
            "user.created",
            [this](std::string_view, std::string_view payload)
            {
                const std::string id = nc::util::form_value(nc::util::parse_form(payload), "id");
                record(id, "user.created", "Your account was created", "");
            }
        );

        m_app->route(
            "GET",
            "/ocs/v2.php/apps/activity/api/v2/activity",
            USER,
            [this](const Request& request)
            {
                long limit = std::strtol(request.query_value("limit").c_str(), nullptr, 10);
                limit = limit <= 0 ? 50 : std::min(limit, 200L);
                const long since = std::strtol(request.query_value("since").c_str(), nullptr, 10);
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, ts, type, subject, path FROM nc_activity WHERE uid = ? AND id "
                         "> ? ORDER BY id DESC LIMIT ?",
                         {request.get_user(), std::to_string(since), std::to_string(limit)}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += R"({"activity_id":)" + nc::db::value_of(row, "id") +
                            R"(,"timestamp":)" + nc::db::value_of(row, "ts") + R"(,"type":)" +
                            json_string(nc::db::value_of(row, "type")) + R"(,"subject":)" +
                            json_string(nc::db::value_of(row, "subject")) + R"(,"object_name":)" +
                            json_string(nc::db::value_of(row, "path")) + "}";
                }
                return nc::http::ocs(200, "OK", data + "]");
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
            "activity:list",
            "Shows the activity of a user: activity:list <user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: activity:list <user>\n";
                    return 1;
                }
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT ts, subject FROM nc_activity WHERE uid = ? ORDER BY id DESC LIMIT "
                         "100",
                         {args[0]}
                     )) {
                    out += nc::db::value_of(row, "ts") + "\t" + nc::db::value_of(row, "subject") +
                           "\n";
                }
                return 0;
            }
        );
        host.add_command(
            "activity:prune",
            "Removes entries older than retention_days",
            [this](const std::vector<std::string>&, std::string& out)
            {
                out = "removed " + std::to_string(prune()) + " entr(ies)\n";
                return 0;
            }
        );
    }

private:
    void record(
        const std::string& user,
        const std::string& type,
        const std::string& subject,
        const std::string& path
    ) const
    {
        if (user.empty()) {
            return;
        }
        nc::db::Client{m_host}.exec(
            "INSERT INTO nc_activity (uid, ts, type, subject, path) VALUES (?, ?, ?, ?, ?)",
            {user, std::to_string(now_seconds()), type, subject, path}
        );
    }

    std::int64_t prune() const
    {
        if (m_retention_days <= 0) {
            return 0;
        }
        return nc::db::Client{m_host}.exec(
            "DELETE FROM nc_activity WHERE ts < ?",
            {std::to_string(now_seconds() - m_retention_days * 86'400)}
        );
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
    long m_retention_days{365};
};

} // namespace

NC_PLUGIN(ActivityPlugin)
