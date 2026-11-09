/**
 * @file twofactor_plugin.cc
 * @brief Two-factor authentication with TOTP (RFC 6238) and one-time backup codes. Offers
 * `auth.second_factor`, which the kernel calls after a correct password: an account without TOTP
 * passes, an account with it needs a valid code (or an unused backup code) in the `X-NC-OTP`
 * header, unless it signs in with an app password. Counterpart of Nextcloud's `twofactor_totp` and
 * `apps/twofactor_backupcodes`.
 *
 * A code is accepted once: the time step of the last accepted code is stored and must be exceeded.
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

constexpr std::int64_t STEP_SECONDS = 30;

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

std::string backup_digest(std::string_view code)
{
    return nc::util::to_hex(nc::util::sha256(code));
}

class TwoFactorPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "twofactor";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "TOTP second factor with backup codes";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users"};
        return REQUIRED;
    }

    /// For tests: the clock the codes are checked against.
    static std::int64_t now_seconds()
    {
        return std::chrono::duration_cast<std::chrono::seconds>(
                   std::chrono::system_clock::now().time_since_epoch()
        )
            .count();
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        m_issuer = host.config("issuer", "Nextcloud");
        nc::db::Client{&host}.migrate(
            "twofactor",
            1,
            "CREATE TABLE nc_totp (uid TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled INTEGER NOT "
            "NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT 0);"
            "CREATE TABLE nc_backup_codes (uid TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY "
            "(uid, digest));"
        );

        host.add_service(
            "capabilities.twofactor",
            [](std::string_view)
            {
                return Response::json(200, R"({"totp":true,"backup_codes":true})");
            }
        );
        // "user\notp" -> 200 when the account needs no second factor or the code is right.
        host.add_service(
            "auth.second_factor",
            [this](std::string_view args)
            {
                const std::size_t newline = args.find('\n');
                const std::string user{args.substr(0, newline)};
                const std::string code{nc::util::trim(
                    newline == std::string_view::npos ? std::string_view{}
                                                      : args.substr(newline + 1)
                )};
                return check(user, code) ? Response::text(200, "") : Response::text(401, "");
            }
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/twofactor/api/v1/totp";
        // Step 1: a new secret (not active yet). Shown once, as text and as an otpauth:// link.
        m_app->route(
            "POST",
            BASE,
            USER,
            [this](const Request& request)
            {
                if (enabled(request.get_user())) {
                    return nc::http::ocs(409, "Two-factor authentication is already on", "{}");
                }
                const std::string secret = nc::util::base32_encode(random_bytes(20));
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_totp (uid, secret, enabled, last_step) VALUES (?, ?, 0, 0) "
                    "ON CONFLICT(uid) DO UPDATE SET secret = excluded.secret, enabled = 0, "
                    "last_step = 0",
                    {request.get_user(), secret}
                );
                const std::string uri = "otpauth://totp/" + nc::util::url_encode_path(m_issuer) +
                                        ":" + nc::util::url_encode_path(request.get_user()) +
                                        "?secret=" + secret +
                                        "&issuer=" + nc::util::url_encode_path(m_issuer);
                return nc::http::ocs(
                    200,
                    "OK",
                    R"({"secret":)" + json_string(secret) + R"(,"uri":)" + json_string(uri) + "}"
                );
            }
        );
        // Step 2: prove the app works with a code; this turns it on and returns the backup codes
        // (once).
        m_app->route(
            "POST",
            std::string{BASE} + "/verify",
            USER,
            [this](const Request& request)
            {
                std::string code =
                    nc::util::form_value(nc::util::parse_form(request.get_body()), "code");
                if (code.empty()) {
                    code = request.query_value("code");
                }
                const auto rows = nc::db::Client{m_host}.query(
                    "SELECT secret, enabled FROM nc_totp WHERE uid = ?",
                    {request.get_user()}
                );
                if (rows.empty() || nc::db::value_of(rows.front(), "enabled") == "1") {
                    return nc::http::ocs(400, "Start with POST /totp, or it is already on", "{}");
                }
                if (!accept(
                        request.get_user(),
                        nc::db::value_of(rows.front(), "secret"),
                        code,
                        0
                    )) {
                    return nc::http::ocs(400, "The code is wrong", "{}");
                }
                nc::db::Client{m_host}.exec(
                    "UPDATE nc_totp SET enabled = 1 WHERE uid = ?",
                    {request.get_user()}
                );
                std::string data = R"({"backup_codes":[)";
                const nc::db::Client db{m_host};
                db.exec("DELETE FROM nc_backup_codes WHERE uid = ?", {request.get_user()});
                for (int index = 0; index < 10; ++index) {
                    const std::string backup = nc::util::random_hex(5);
                    db.exec(
                        "INSERT INTO nc_backup_codes (uid, digest) VALUES (?, ?)",
                        {request.get_user(), backup_digest(backup)}
                    );
                    data += (index == 0 ? "" : ",") + json_string(backup);
                }
                m_host->publish(
                    "twofactor.enabled",
                    nc::util::form_encode({{"user", request.get_user()}})
                );
                return nc::http::ocs(200, "OK", data + "]}");
            }
        );
        m_app->route(
            "DELETE",
            BASE,
            USER,
            [this](const Request& request)
            {
                disable(request.get_user());
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        m_app->route(
            "GET",
            BASE,
            USER,
            [this](const Request& request)
            {
                const auto left = nc::db::Client{m_host}.query(
                    "SELECT COUNT(*) AS n FROM nc_backup_codes WHERE uid = ?",
                    {request.get_user()}
                );
                return nc::http::ocs(
                    200,
                    "OK",
                    std::string{R"({"enabled":)"} +
                        (enabled(request.get_user()) ? "true" : "false") +
                        R"(,"backup_codes_left":)" + nc::db::value_of(left.front(), "n", "0") + "}"
                );
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                disable(nc::util::form_value(nc::util::parse_form(payload), "id"));
            }
        );
        host.add_command(
            "twofactor:state",
            "Shows whether a user uses two-factor authentication: twofactor:state <user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: twofactor:state <user>\n";
                    return 1;
                }
                out = enabled(args[0]) ? "enabled\n" : "disabled\n";
                return 0;
            }
        );
        host.add_command(
            "twofactor:disable",
            "Turns two-factor authentication off for a user (lost device): twofactor:disable "
            "<user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: twofactor:disable <user>\n";
                    return 1;
                }
                disable(args[0]);
                out = "done\n";
                return 0;
            }
        );
    }

private:
    [[nodiscard]] static std::string random_bytes(std::size_t count)
    {
        std::string bytes;
        const std::string hex = nc::util::random_hex(count);
        for (std::size_t index = 0; index < count; ++index) {
            bytes.push_back(static_cast<char>(std::stoul(hex.substr(index * 2, 2), nullptr, 16)));
        }
        return bytes;
    }

    [[nodiscard]] bool enabled(const std::string& user) const
    {
        const auto rows =
            nc::db::Client{m_host}.query("SELECT enabled FROM nc_totp WHERE uid = ?", {user});
        return !rows.empty() && nc::db::value_of(rows.front(), "enabled") == "1";
    }

    void disable(const std::string& user) const
    {
        const nc::db::Client db{m_host};
        db.exec("DELETE FROM nc_totp WHERE uid = ?", {user});
        db.exec("DELETE FROM nc_backup_codes WHERE uid = ?", {user});
        m_host->publish("twofactor.disabled", nc::util::form_encode({{"user", user}}));
    }

    /// True when `code` is the TOTP of one of the steps around now that is newer than the last
    /// accepted one; remembers that step so the same code cannot be used twice.
    [[nodiscard]] bool accept(
        const std::string& user,
        const std::string& base32,
        const std::string& code,
        std::int64_t last_step
    ) const
    {
        const auto secret = nc::util::base32_decode(base32);
        if (!secret || code.size() != 6) {
            return false;
        }
        const std::int64_t current = now_seconds() / STEP_SECONDS;
        for (std::int64_t step = current - 1; step <= current + 1; ++step) {
            if (step > last_step && nc::util::constant_time_equals(
                                        nc::util::hotp(*secret, static_cast<std::uint64_t>(step)),
                                        code
                                    )) {
                nc::db::Client{m_host}.exec(
                    "UPDATE nc_totp SET last_step = ? WHERE uid = ?",
                    {std::to_string(step), user}
                );
                return true;
            }
        }
        return false;
    }

    [[nodiscard]] bool check(const std::string& user, const std::string& code) const
    {
        const auto rows = nc::db::Client{m_host}.query(
            "SELECT secret, enabled, last_step FROM nc_totp WHERE uid = ?",
            {user}
        );
        if (rows.empty() || nc::db::value_of(rows.front(), "enabled") != "1") {
            return true; // no second factor for this account
        }
        if (accept(
                user,
                nc::db::value_of(rows.front(), "secret"),
                code,
                std::strtoll(nc::db::value_of(rows.front(), "last_step", "0").c_str(), nullptr, 10)
            )) {
            return true;
        }
        // A backup code works once.
        return !code.empty() && nc::db::Client{m_host}.exec(
                                    "DELETE FROM nc_backup_codes WHERE uid = ? AND digest = ?",
                                    {user, backup_digest(code)}
                                ) > 0;
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
    std::string m_issuer{"Nextcloud"};
};

} // namespace

NC_PLUGIN(TwoFactorPlugin)
