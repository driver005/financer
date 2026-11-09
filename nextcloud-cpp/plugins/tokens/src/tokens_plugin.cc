/**
 * @file tokens_plugin.cc
 * @brief App passwords: long random passwords a client keeps instead of the account password, each
 * one named and revocable. They sign in through `auth.token`, which the kernel tries first, and
 * they are not asked for a second factor. Counterpart of Nextcloud's
 * `lib/private/Authentication/Token`.
 *
 * Only a SHA-256 digest of a token is stored (the token has 125 random bits, so no slow hash is
 * needed).
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

/// "xxxxx-xxxxx-xxxxx-xxxxx-xxxxx": 25 characters from a 32 letter alphabet, 125 bits.
std::string new_token()
{
    static constexpr std::string_view ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789A";
    const std::string random =
        nc::util::random_hex(25); // 25 bytes, hex: use each pair as one index
    std::string token;
    for (std::size_t index = 0; index < 25; ++index) {
        const auto value =
            static_cast<unsigned>(std::stoul(random.substr(index * 2, 2), nullptr, 16));
        token.push_back(ALPHABET[value % 32U]);
        if (index % 5 == 4 && index != 24) {
            token.push_back('-');
        }
    }
    return token;
}

std::string digest(std::string_view token)
{
    return nc::util::to_hex(nc::util::sha256(token));
}

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

class TokensPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "tokens";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "App passwords";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        nc::db::Client{&host}.migrate(
            "tokens",
            1,
            "CREATE TABLE nc_tokens ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, name TEXT NOT NULL,"
            " digest TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, last_used INTEGER NOT NULL "
            "DEFAULT 0);"
            "CREATE INDEX nc_tokens_uid ON nc_tokens (uid);"
        );

        // "user:token" -> the user id. 401 for anything else, including a token of another user.
        host.add_service(
            "auth.token",
            [this](std::string_view args)
            {
                const std::size_t colon = args.find(':');
                if (colon == std::string_view::npos) {
                    return Response::text(401, "");
                }
                const std::string user{args.substr(0, colon)};
                const nc::db::Client db{m_host};
                const auto rows = db.query(
                    "SELECT id FROM nc_tokens WHERE uid = ? AND digest = ?",
                    {user, digest(args.substr(colon + 1))}
                );
                if (rows.empty()) {
                    return Response::text(401, "");
                }
                db.exec(
                    "UPDATE nc_tokens SET last_used = ? WHERE id = ?",
                    {std::to_string(now_seconds()), nc::db::value_of(rows.front(), "id")}
                );
                return Response::text(200, user);
            }
        );

        m_app->route(
            "GET",
            "/ocs/v2.php/core/getapppassword",
            USER,
            [this](const Request& request)
            {
                std::string name = request.query_value("name");
                if (name.empty()) {
                    name = std::string{request.header("User-Agent")};
                }
                if (name.empty()) {
                    name = "Unnamed client";
                }
                return nc::http::ocs(
                    200,
                    "OK",
                    R"({"apppassword":)" +
                        json_string(create(request.get_user(), name.substr(0, 128))) + "}"
                );
            }
        );
        m_app->route(
            "GET",
            "/ocs/v2.php/cloud/apppasswords",
            USER,
            [this](const Request& request)
            {
                std::string data = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, name, created, last_used FROM nc_tokens WHERE uid = ? ORDER "
                         "BY id",
                         {request.get_user()}
                     )) {
                    data += first ? "" : ",";
                    first = false;
                    data += R"({"id":)" + nc::db::value_of(row, "id") + R"(,"name":)" +
                            json_string(nc::db::value_of(row, "name")) + R"(,"created":)" +
                            nc::db::value_of(row, "created") + R"(,"last_used":)" +
                            nc::db::value_of(row, "last_used") + "}";
                }
                return nc::http::ocs(200, "OK", data + "]");
            }
        );
        m_app->route(
            "DELETE",
            "/ocs/v2.php/cloud/apppasswords/{id}",
            USER,
            [this](const Request& request)
            {
                const auto removed = nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_tokens WHERE id = ? AND uid = ?",
                    {std::string{request.param("id")}, request.get_user()}
                );
                return removed == 0 ? nc::http::ocs(404, "No such app password", "{}")
                                    : nc::http::ocs(200, "OK", "{}");
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_tokens WHERE uid = ?",
                    {nc::util::form_value(nc::util::parse_form(payload), "id")}
                );
            }
        );

        host.add_command(
            "token:create",
            "Creates an app password: token:create <user> <name>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 2 ||
                    m_host->call_service("users.get", args[0]).get_status() != 200) {
                    out = "usage: token:create <user> <name> (the user must exist)\n";
                    return 1;
                }
                out = create(args[0], args[1]) + "\n";
                return 0;
            }
        );
        host.add_command(
            "token:list",
            "Lists the app passwords of a user: token:list <user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: token:list <user>\n";
                    return 1;
                }
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, name FROM nc_tokens WHERE uid = ? ORDER BY id",
                         {args[0]}
                     )) {
                    out +=
                        nc::db::value_of(row, "id") + "\t" + nc::db::value_of(row, "name") + "\n";
                }
                return 0;
            }
        );
        host.add_command(
            "token:delete",
            "Revokes an app password: token:delete <user> <id>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                const bool removed =
                    args.size() == 2 && nc::db::Client{m_host}.exec(
                                            "DELETE FROM nc_tokens WHERE uid = ? AND id = ?",
                                            {args[0], args[1]}
                                        ) > 0;
                out = removed ? "done\n" : "no such app password\n";
                return removed ? 0 : 1;
            }
        );
    }

private:
    [[nodiscard]] std::string create(const std::string& user, const std::string& name) const
    {
        const std::string token = new_token();
        nc::db::Client{m_host}.exec(
            "INSERT INTO nc_tokens (uid, name, digest, created) VALUES (?, ?, ?, ?)",
            {user, name, digest(token), std::to_string(now_seconds())}
        );
        return token;
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(TokensPlugin)
