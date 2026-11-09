/**
 * @file user_status_plugin.cc
 * @brief What people say about themselves: an online status (online, away, do not disturb,
 * invisible, offline) and a short message with an emoji, optionally cleared at a time. Counterpart
 * of Nextcloud's `apps/user_status`. Statuses come back as plain "offline" for invisible users when
 * others look.
 */
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <chrono>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr std::string_view STATUSES[] = {"online", "away", "dnd", "invisible", "offline"};
constexpr std::size_t MAX_MESSAGE = 80;
constexpr std::size_t MAX_ICON = 16;

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

/// No control characters, bounded length (counted in bytes).
bool plain_text(std::string_view text, std::size_t limit)
{
    return text.size() <= limit && std::ranges::none_of(
                                       text,
                                       [](char letter)
                                       {
                                           const auto byte = static_cast<unsigned char>(letter);
                                           return byte < 0x20 || byte == 0x7F;
                                       }
                                   );
}

class UserStatusPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "user_status";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Online status and status messages";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        nc::db::Client{&host}.migrate(
            "user_status",
            1,
            "CREATE TABLE nc_user_status ("
            " uid TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'online',"
            " message TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '',"
            " clear_at INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);"
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/user_status/api/v1";

        host.add_route(
            "GET",
            std::string{BASE} + "/user_status",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto row = find(request.get_user());
                return row ? nc::http::ocs(200, "OK", status_json(*row, true))
                           : nc::http::ocs(404, "No status", "{}");
            }
        );

        host.add_route(
            "PUT",
            std::string{BASE} + "/user_status/status",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const std::string status = field(request, "statusType");
                if (std::ranges::find(STATUSES, status) == std::end(STATUSES)) {
                    return nc::http::ocs(400, "Invalid status type", "{}");
                }
                upsert(request.get_user());
                nc::db::Client{m_host}.exec(
                    "UPDATE nc_user_status SET status = ?, updated = ? WHERE uid = ?",
                    {status, std::to_string(now_seconds()), request.get_user()}
                );
                return nc::http::ocs(200, "OK", status_json(*find(request.get_user()), true));
            }
        );

        host.add_route(
            "PUT",
            std::string{BASE} + "/user_status/message/custom",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const std::string message = field(request, "message");
                const std::string icon = field(request, "statusIcon");
                const std::string clear_text = field(request, "clearAt");
                std::int64_t clear_at = 0;
                if (!clear_text.empty()) {
                    clear_at = std::strtoll(clear_text.c_str(), nullptr, 10);
                    if (clear_at != 0 && clear_at <= now_seconds()) {
                        return nc::http::ocs(400, "clearAt is in the past", "{}");
                    }
                }
                if (message.empty() || !plain_text(message, MAX_MESSAGE) ||
                    !plain_text(icon, MAX_ICON)) {
                    return nc::http::ocs(400, "Invalid message or icon", "{}");
                }
                upsert(request.get_user());
                nc::db::Client{m_host}.exec(
                    "UPDATE nc_user_status SET message = ?, icon = ?, clear_at = ?, updated = ? "
                    "WHERE uid = ?",
                    {message,
                     icon,
                     std::to_string(clear_at),
                     std::to_string(now_seconds()),
                     request.get_user()}
                );
                return nc::http::ocs(200, "OK", status_json(*find(request.get_user()), true));
            }
        );

        host.add_route(
            "DELETE",
            std::string{BASE} + "/user_status/message",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                nc::db::Client{m_host}.exec(
                    "UPDATE nc_user_status SET message = '', icon = '', clear_at = 0 WHERE uid = ?",
                    {request.get_user()}
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );

        // What other people may see.
        host.add_route(
            "GET",
            std::string{BASE} + "/statuses/{user}",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto row = find(std::string{request.param("user")});
                return row ? nc::http::ocs(200, "OK", status_json(*row, false))
                           : nc::http::ocs(404, "No status", "{}");
            }
        );
        host.add_route(
            "GET",
            std::string{BASE} + "/statuses",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const std::size_t limit = std::clamp<std::size_t>(
                    std::strtoul(request.query_value("limit").c_str(), nullptr, 10),
                    1,
                    100
                );
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT uid, status, message, icon, clear_at FROM nc_user_status ORDER BY "
                         "uid LIMIT ?",
                         {std::to_string(limit)}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += status_json(visible(row), false);
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );

        host.add_service(
            "user_status.get",
            [this](std::string_view user)
            {
                const auto row = find(std::string{user});
                return row ? Response::text(200, status_json(*row, false))
                           : Response::text(404, "no status");
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const std::string user = nc::util::form_value(nc::util::parse_form(payload), "id");
                nc::db::Client{m_host}.exec("DELETE FROM nc_user_status WHERE uid = ?", {user});
            }
        );
    }

private:
    static std::string field(const Request& request, std::string_view name)
    {
        std::string value = nc::util::form_value(nc::util::parse_form(request.get_body()), name);
        return value.empty() ? request.query_value(name) : value;
    }

    void upsert(const std::string& user) const
    {
        nc::db::Client{m_host}.exec(
            "INSERT OR IGNORE INTO nc_user_status (uid, updated) VALUES (?, ?)",
            {user, std::to_string(now_seconds())}
        );
    }

    /// The status of a user, with an expired message already cleared.
    [[nodiscard]] std::optional<nc::db::Row> find(const std::string& user) const
    {
        const nc::db::Client db{m_host};
        db.exec(
            "UPDATE nc_user_status SET message = '', icon = '', clear_at = 0 WHERE uid = ? AND "
            "clear_at != 0 AND clear_at <= ?",
            {user, std::to_string(now_seconds())}
        );
        auto rows = db.query(
            "SELECT uid, status, message, icon, clear_at FROM nc_user_status WHERE uid = ?",
            {user}
        );
        if (rows.empty()) {
            return std::nullopt;
        }
        return std::move(rows.front());
    }

    /// Others never see "invisible": it reads as offline, and its message stays private.
    static nc::db::Row visible(nc::db::Row row)
    {
        for (auto& [name, value]: row) {
            if (name == "status" && value == "invisible") {
                value = "offline";
            }
        }
        return row;
    }

    static std::string status_json(const nc::db::Row& raw, bool own)
    {
        const nc::db::Row row = own ? raw : visible(raw);
        const bool hidden = !own && nc::db::value_of(raw, "status") == "invisible";
        const std::string clear = nc::db::value_of(row, "clear_at", "0");
        return R"({"userId":)" + json_string(nc::db::value_of(row, "uid")) + R"(,"status":)" +
               json_string(nc::db::value_of(row, "status", "online")) + R"(,"message":)" +
               (hidden ? "null" : json_string(nc::db::value_of(row, "message"))) + R"(,"icon":)" +
               (hidden ? "null" : json_string(nc::db::value_of(row, "icon"))) + R"(,"clearAt":)" +
               (clear == "0" ? std::string{"null"} : clear) + "}";
    }

    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(UserStatusPlugin)
