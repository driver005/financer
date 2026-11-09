/**
 * @file webhook_listeners_plugin.cc
 * @brief Tells other servers when something happens: an administrator registers a URL for an event
 * (`share.created`, `file.created`, ...) and the plugin POSTs a JSON document there, signed with
 * HMAC-SHA256 in `X-Nextcloud-Signature`. Counterpart of Nextcloud's `apps/webhook_listeners`.
 *
 * Events are queued in the database and delivered by a job, so a slow receiver never slows the
 * request that caused the event. A delivery that fails is tried again after a growing pause, up to
 * five times. Outgoing requests use the same client as federation: certificates are checked and
 * local addresses are refused unless `[webhook_listeners] allow_local` is set.
 */
#include "http_client.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <chrono>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr int MAX_ATTEMPTS = 5;

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

/// An event name or prefix ending in `*`: letters, digits and `._-` only.
bool event_pattern_ok(std::string_view event)
{
    if (event.empty() || event.size() > 100) {
        return false;
    }
    return std::ranges::all_of(
        event,
        [](char letter)
        {
            return std::isalnum(static_cast<unsigned char>(letter)) != 0 || letter == '.' ||
                   letter == '_' || letter == '-' || letter == '*';
        }
    );
}

class WebhookListenersPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "webhook_listeners";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Webhooks for events";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_client.set_allow_http(host.config("allow_http", "false") == "true");
        m_client.set_allow_local(host.config("allow_local", "false") == "true");
        m_client.set_timeout_seconds(std::atoi(host.config("timeout_seconds", "10").c_str()));
        m_client.set_max_response(1U << 20U);
        nc::db::Client{&host}.migrate(
            "webhook_listeners",
            1,
            "CREATE TABLE nc_webhooks ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, url TEXT NOT NULL,"
            " secret TEXT NOT NULL, created_by TEXT NOT NULL, created INTEGER NOT NULL);"
            "CREATE TABLE nc_webhook_queue ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, webhook INTEGER NOT NULL, event TEXT NOT NULL,"
            " body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL);"
            "CREATE INDEX nc_webhook_queue_due ON nc_webhook_queue (due);"
        );

        // Every event is looked at; only those a webhook asked for are queued.
        host.subscribe(
            "*",
            [this](std::string_view topic, std::string_view payload)
            {
                enqueue(std::string{topic}, payload);
            }
        );
        host.add_job(
            "deliver",
            5,
            [this]()
            {
                deliver_due();
            }
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks";
        host.add_route(
            "POST",
            BASE,
            [this](const Request& request)
            {
                if (!is_admin(request)) {
                    return request.get_user().empty() ? nc::http::unauthorized()
                                                      : nc::http::ocs(403, "Forbidden", "{}");
                }
                const auto form = nc::util::parse_form(request.get_body());
                const std::string event = nc::util::form_value(form, "event");
                const std::string url = nc::util::form_value(form, "uri");
                std::string secret = nc::util::form_value(form, "secret");
                if (!event_pattern_ok(event)) {
                    return nc::http::ocs(400, "Invalid event", "{}");
                }
                if (const auto parsed = nc::federation::parse_url(url);
                    !parsed || url.size() > 2'000) {
                    return nc::http::ocs(400, "Invalid uri", "{}");
                }
                if (secret.empty()) {
                    secret = nc::util::random_hex(24);
                }
                std::int64_t id = 0;
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_webhooks (event, url, secret, created_by, created) VALUES (?, "
                    "?, ?, ?, ?)",
                    {event, url, secret, request.get_user(), std::to_string(now_seconds())},
                    &id
                );
                // The secret is shown once, now.
                return nc::http::ocs(
                    200,
                    "OK",
                    R"({"id":)" + std::to_string(id) + R"(,"event":)" + json_string(event) +
                        R"(,"uri":)" + json_string(url) + R"(,"secret":)" + json_string(secret) +
                        "}"
                );
            }
        );
        host.add_route(
            "GET",
            BASE,
            [this](const Request& request)
            {
                if (!is_admin(request)) {
                    return request.get_user().empty() ? nc::http::unauthorized()
                                                      : nc::http::ocs(403, "Forbidden", "{}");
                }
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, event, url FROM nc_webhooks ORDER BY id"
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += R"({"id":)" + nc::db::value_of(row, "id") + R"(,"event":)" +
                            json_string(nc::db::value_of(row, "event")) + R"(,"uri":)" +
                            json_string(nc::db::value_of(row, "url")) + "}";
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );
        host.add_route(
            "DELETE",
            std::string{BASE} + "/{id}",
            [this](const Request& request)
            {
                if (!is_admin(request)) {
                    return request.get_user().empty() ? nc::http::unauthorized()
                                                      : nc::http::ocs(403, "Forbidden", "{}");
                }
                const std::string id{request.param("id")};
                const nc::db::Client db{m_host};
                db.exec("DELETE FROM nc_webhook_queue WHERE webhook = ?", {id});
                return db.exec("DELETE FROM nc_webhooks WHERE id = ?", {id}) == 0
                           ? nc::http::ocs(404, "No such webhook", "{}")
                           : nc::http::ocs(200, "OK", "{}");
            }
        );
    }

private:
    [[nodiscard]] bool is_admin(const Request& request) const
    {
        return !request.get_user().empty() &&
               m_host->call_service("users.is_admin", request.get_user()).get_status() == 200;
    }

    void enqueue(const std::string& topic, std::string_view payload) const
    {
        // Events of this plugin's own bookkeeping would only loop.
        if (nc::util::starts_with(topic, "webhook.")) {
            return;
        }
        const nc::db::Client db{m_host};
        std::string document;
        for (const nc::db::Row& hook: db.query("SELECT id, event FROM nc_webhooks")) {
            if (!nc::topic_matches(nc::db::value_of(hook, "event"), topic)) {
                continue;
            }
            if (document.empty()) {
                std::string data = "{";
                bool first = true;
                for (const auto& [key, value]: nc::util::parse_form(payload)) {
                    data += (first ? "" : ",") + json_string(key) + ":" + json_string(value);
                    first = false;
                }
                document = R"({"event":)" + json_string(topic) + R"(,"time":)" +
                           std::to_string(now_seconds()) + R"(,"data":)" + data + "}}";
            }
            db.exec(
                "INSERT INTO nc_webhook_queue (webhook, event, body, due) VALUES (?, ?, ?, ?)",
                {nc::db::value_of(hook, "id"), topic, document, std::to_string(now_seconds())}
            );
        }
    }

    void deliver_due() const
    {
        const nc::db::Client db{m_host};
        for (const nc::db::Row& item: db.query(
                 "SELECT q.id AS id, q.body AS body, q.attempts AS attempts, w.url AS url, "
                 "w.secret "
                 "AS secret FROM nc_webhook_queue q JOIN nc_webhooks w ON w.id = q.webhook WHERE "
                 "q.due <= ? ORDER BY q.id LIMIT 50",
                 {std::to_string(now_seconds())}
             )) {
            const std::string body = nc::db::value_of(item, "body");
            const auto answer = nc::federation::request(
                m_client,
                "POST",
                nc::db::value_of(item, "url"),
                {{"Content-Type", "application/json"},
                 {"X-Nextcloud-Signature",
                  "sha256=" +
                      nc::util::to_hex(nc::util::hmac_sha256(nc::db::value_of(item, "secret"), body)
                      )}},
                body
            );
            const int attempts = std::atoi(nc::db::value_of(item, "attempts").c_str()) + 1;
            if (answer && answer->get_status() >= 200 && answer->get_status() < 300) {
                db.exec(
                    "DELETE FROM nc_webhook_queue WHERE id = ?",
                    {nc::db::value_of(item, "id")}
                );
            } else if (attempts >= MAX_ATTEMPTS) {
                m_host->log(
                    nc::LogLevel::WARNING,
                    "giving up on a webhook delivery to " + nc::db::value_of(item, "url")
                );
                db.exec(
                    "DELETE FROM nc_webhook_queue WHERE id = ?",
                    {nc::db::value_of(item, "id")}
                );
            } else {
                // 30 s, 2 min, 8 min, 32 min.
                const std::int64_t pause = 30LL << (2 * (attempts - 1));
                db.exec(
                    "UPDATE nc_webhook_queue SET attempts = ?, due = ? WHERE id = ?",
                    {std::to_string(attempts),
                     std::to_string(now_seconds() + pause),
                     nc::db::value_of(item, "id")}
                );
            }
        }
    }

    nc::federation::ClientSettings m_client{};
    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(WebhookListenersPlugin)
