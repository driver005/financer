/**
 * @file admin_audit_plugin.cc
 * @brief The audit log of Nextcloud's `admin_audit` app: who did what that matters for security,
 * one JSON line per event in `<data_dir>/audit.log` (or `[admin_audit] logfile`):
 *
 *   failed sign-ins (the login name, never the password), files created, written, deleted,
 *   renamed and copied, shares made and removed, accounts and groups made and removed, accounts
 *   changed, and two-factor authentication switched off.
 *
 * The events are the ones the plugins publish on the bus, so what a plugin does not announce is not
 * in the log. The format is Nextcloud's log line (`reqId`, `level`, `time`, `app`, `user`,
 * `message`), so the same tools read it. Lines are appended under a lock and written at once.
 */
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <chrono>
#include <ctime>
#include <fstream>
#include <mutex>

namespace {

std::string iso_time()
{
    const std::time_t now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm moment{};
    gmtime_r(&now, &moment);
    char text[40];
    std::strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%S+00:00", &moment);
    return text;
}

std::string in_quotes(std::string_view text)
{
    return "\"" + std::string{text} + "\"";
}

class AdminAuditPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "admin_audit";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Audit log of sign-ins, files, shares, accounts and groups";
    }

    void on_load(nc::Host& host) override
    {
        m_file = host.config("logfile", "");
        if (m_file.empty()) {
            m_file = host.config("data_dir", "data") + "/audit.log";
        }
        for (const char* topic:
             {"auth.failed",
              "file.created",
              "file.updated",
              "file.deleted",
              "file.moved",
              "file.copied",
              "share.created",
              "share.deleted",
              "user.created",
              "user.updated",
              "user.deleted",
              "group.created",
              "group.deleted",
              "twofactor.disabled",
              "federation.secret_exchanged"}) {
            host.subscribe(
                topic,
                [this](std::string_view event, std::string_view payload)
                {
                    record(event, payload);
                }
            );
        }
    }

private:
    void record(std::string_view event, std::string_view payload)
    {
        const auto form = nc::util::parse_form(payload);
        const auto field = [&](std::string_view name)
        {
            return nc::util::form_value(form, name);
        };
        std::string user = field("user");
        std::string message;
        if (event == "auth.failed") {
            message = "Login failed: " + in_quotes(user) + " (" + field("reason") + ")";
            user = "--";
        } else if (event == "file.created") {
            message = "File created: " + in_quotes(field("path"));
        } else if (event == "file.updated") {
            message = "File written to: " + in_quotes(field("path"));
        } else if (event == "file.deleted") {
            message = "File deleted: " + in_quotes(field("path"));
        } else if (event == "file.moved") {
            message =
                "File renamed: " + in_quotes(field("path")) + " to " + in_quotes(field("target"));
        } else if (event == "file.copied") {
            message =
                "File copied: " + in_quotes(field("path")) + " to " + in_quotes(field("target"));
        } else if (event == "share.created" || event == "share.deleted") {
            const std::string kind = field("type") == "3"   ? "link"
                                     : field("type") == "1" ? "group"
                                     : field("type") == "6" ? "federated"
                                                            : "user";
            message =
                std::string{"Share "} + (event == "share.created" ? "created" : "removed") + ": " +
                in_quotes(field("path")) + " (" + kind + " share" +
                (field("share_with").empty() ? "" : " with " + in_quotes(field("share_with"))) +
                ", ID " + field("id") + ")";
            user = field("owner");
        } else if (event == "user.created" || event == "user.updated" || event == "user.deleted") {
            message = "Account " + std::string{event.substr(5)} + ": " + in_quotes(field("id"));
            user = "--";
        } else if (event == "group.created" || event == "group.deleted") {
            message = "Group " + std::string{event.substr(6)} + ": " + in_quotes(field("id"));
            user = "--";
        } else if (event == "federation.secret_exchanged") {
            message = "Shared secret with trusted server " + in_quotes(field("server")) +
                      " was exchanged";
            user = "--";
        } else if (event == "twofactor.disabled") {
            message = "Two-factor authentication was switched off for " + in_quotes(user);
        } else {
            return;
        }
        if (user.empty()) {
            user = "--";
        }
        const std::string line = R"({"reqId":"","level":1,"time":")" + iso_time() +
                                 R"(","app":"admin_audit","user":")" + nc::util::json_escape(user) +
                                 R"(","message":")" + nc::util::json_escape(message) + "\"}\n";
        const std::lock_guard lock{m_mutex};
        std::ofstream out{m_file, std::ios::app | std::ios::binary};
        out << line;
    }

    std::string m_file{};
    std::mutex m_mutex{};
};

} // namespace

NC_PLUGIN(AdminAuditPlugin)
