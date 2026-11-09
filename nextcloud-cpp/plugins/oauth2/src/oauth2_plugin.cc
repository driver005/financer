/**
 * @file oauth2_plugin.cc
 * @brief An OAuth 2.0 authorization server: other applications get access to an account without its
 * password. Authorization code flow (RFC 6749) with PKCE (RFC 7636) and rotating refresh tokens.
 * Counterpart of Nextcloud's `apps/oauth2`. Access tokens are accepted for `Authorization: Bearer
 * ...` through the `auth.bearer.oauth2` service.
 *
 * The person who authorizes signs in at `/index.php/apps/oauth2/authorize` the same way as at any
 * other URL (HTTP basic authentication here; there is no login page), and approving is implied by
 * arriving there. Codes, access tokens and refresh tokens are stored as SHA-256 digests; clients
 * are registered by an administrator on the command line, and a client can only be sent to the
 * exact redirect URI it was registered with.
 */
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <chrono>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr std::int64_t CODE_LIFETIME = 600;
constexpr std::int64_t ACCESS_LIFETIME = 3'600;

std::int64_t now_seconds()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

std::string digest(std::string_view secret)
{
    return nc::util::to_hex(nc::util::sha256(secret));
}

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

Response oauth_error(int status, std::string_view error, std::string_view description = {})
{
    return Response::json(
        status,
        R"({"error":)" + json_string(error) +
            (description.empty() ? "" : R"(,"error_description":)" + json_string(description)) + "}"
    );
}

std::string base64url(std::string_view bytes)
{
    std::string out = nc::util::base64_encode(bytes);
    for (char& letter: out) {
        letter = letter == '+' ? '-' : letter == '/' ? '_' : letter;
    }
    while (!out.empty() && out.back() == '=') {
        out.pop_back();
    }
    return out;
}

class OAuth2Plugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "oauth2";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "OAuth 2.0 authorization server";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        nc::db::Client{&host}.migrate(
            "oauth2",
            1,
            "CREATE TABLE nc_oauth_clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL, "
            "secret_digest TEXT NOT NULL, redirect_uri TEXT NOT NULL);"
            "CREATE TABLE nc_oauth_codes (digest TEXT PRIMARY KEY, client_id TEXT NOT NULL "
            "REFERENCES nc_oauth_clients(client_id) ON DELETE CASCADE,"
            " uid TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL DEFAULT '', "
            "expires INTEGER NOT NULL);"
            "CREATE TABLE nc_oauth_tokens (access_digest TEXT PRIMARY KEY, refresh_digest TEXT NOT "
            "NULL UNIQUE,"
            " client_id TEXT NOT NULL REFERENCES nc_oauth_clients(client_id) ON DELETE CASCADE, "
            "uid TEXT NOT NULL, expires INTEGER NOT NULL);"
        );
        host.add_service(
            "capabilities.oauth2",
            [](std::string_view)
            {
                return Response::json(200, R"({"authorization_code":true,"pkce":"S256"})");
            }
        );

        host.add_service(
            "auth.bearer.oauth2",
            [this](std::string_view token)
            {
                const auto rows = nc::db::Client{m_host}.query(
                    "SELECT uid FROM nc_oauth_tokens WHERE access_digest = ? AND expires > ?",
                    {digest(token), std::to_string(now_seconds())}
                );
                return rows.empty() ? Response::text(401, "")
                                    : Response::text(200, nc::db::value_of(rows.front(), "uid"));
            }
        );

        host.add_route(
            "GET",
            "/index.php/apps/oauth2/authorize",
            [this](const Request& request)
            {
                return authorize(request);
            }
        );
        host.add_route(
            "POST",
            "/index.php/apps/oauth2/api/v1/token",
            [this](const Request& request)
            {
                return token(request);
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const std::string id = nc::util::form_value(nc::util::parse_form(payload), "id");
                const nc::db::Client db{m_host};
                db.exec("DELETE FROM nc_oauth_tokens WHERE uid = ?", {id});
                db.exec("DELETE FROM nc_oauth_codes WHERE uid = ?", {id});
            }
        );
        host.add_job(
            "expire",
            600,
            [this]()
            {
                const nc::db::Client db{m_host};
                db.exec(
                    "DELETE FROM nc_oauth_codes WHERE expires < ?",
                    {std::to_string(now_seconds())}
                );
                db.exec(
                    "DELETE FROM nc_oauth_tokens WHERE expires < ?",
                    {std::to_string(now_seconds() - 30 * 86'400)}
                );
            }
        );

        host.add_command(
            "oauth2:add",
            "Registers a client: oauth2:add <name> <redirect-uri>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 2 || !valid_redirect(args[1])) {
                    out = "usage: oauth2:add <name> <redirect-uri> (an absolute http or https URI "
                          "without a fragment)\n";
                    return 1;
                }
                const std::string client_id = nc::util::random_hex(16);
                const std::string secret = nc::util::random_hex(32);
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_oauth_clients (client_id, name, secret_digest, redirect_uri) "
                    "VALUES (?, ?, ?, ?)",
                    {client_id, args[0], digest(secret), args[1]}
                );
                out = "client_id: " + client_id + "\nclient_secret: " + secret +
                      "\n"; // the secret is shown once
                return 0;
            }
        );
        host.add_command(
            "oauth2:list",
            "Lists the registered clients",
            [this](const std::vector<std::string>&, std::string& out)
            {
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT client_id, name, redirect_uri FROM nc_oauth_clients ORDER BY name"
                     )) {
                    out += nc::db::value_of(row, "client_id") + "\t" +
                           nc::db::value_of(row, "name") + "\t" +
                           nc::db::value_of(row, "redirect_uri") + "\n";
                }
                return 0;
            }
        );
        host.add_command(
            "oauth2:remove",
            "Removes a client and every token it was given: oauth2:remove <client_id>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                const bool removed =
                    args.size() == 1 && nc::db::Client{m_host}.exec(
                                            "DELETE FROM nc_oauth_clients WHERE client_id = ?",
                                            {args[0]}
                                        ) > 0;
                out = removed ? "removed\n" : "no such client\n";
                return removed ? 0 : 1;
            }
        );
    }

private:
    static bool valid_redirect(std::string_view uri) noexcept
    {
        return (nc::util::starts_with(uri, "https://") || nc::util::starts_with(uri, "http://")) &&
               uri.find('#') == std::string_view::npos &&
               uri.find_first_of(" \t\r\n") == std::string_view::npos && uri.size() <= 1'024;
    }

    static std::string field(
        const Request& request,
        const std::vector<std::pair<std::string, std::string>>& form,
        std::string_view name
    )
    {
        std::string value = nc::util::form_value(form, name);
        return value.empty() ? request.query_value(name) : value;
    }

    /// GET authorize: sends the signed-in person back to the client with a one-time code.
    [[nodiscard]] Response authorize(const Request& request) const
    {
        if (request.get_user().empty()) {
            return nc::http::unauthorized();
        }
        const std::string client_id = request.query_value("client_id");
        const std::string redirect = request.query_value("redirect_uri");
        const auto clients = nc::db::Client{m_host}.query(
            "SELECT redirect_uri FROM nc_oauth_clients WHERE client_id = ?",
            {client_id}
        );
        // An unknown client or a different redirect address is never answered with a redirect: that
        // would turn this server into a way to send people anywhere.
        if (clients.empty() || nc::db::value_of(clients.front(), "redirect_uri") != redirect) {
            return Response::text(400, "Unknown client or redirect address");
        }
        const std::string state = request.query_value("state");
        const auto back = [&](std::vector<std::pair<std::string, std::string>> extra)
        {
            if (!state.empty()) {
                extra.emplace_back("state", state);
            }
            Response response{302};
            response.add_header(
                "Location",
                redirect + (redirect.find('?') == std::string::npos ? "?" : "&") +
                    nc::util::form_encode(extra)
            );
            return response;
        };
        if (request.query_value("response_type") != "code") {
            return back({{"error", "unsupported_response_type"}});
        }
        const std::string challenge = request.query_value("code_challenge");
        if (!challenge.empty() && request.query_value("code_challenge_method") != "S256") {
            return back(
                {{"error", "invalid_request"}, {"error_description", "only S256 is supported"}}
            );
        }
        const std::string code = nc::util::random_hex(24);
        nc::db::Client{m_host}.exec(
            "INSERT INTO nc_oauth_codes (digest, client_id, uid, redirect_uri, challenge, expires) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            {digest(code),
             client_id,
             request.get_user(),
             redirect,
             challenge,
             std::to_string(now_seconds() + CODE_LIFETIME)}
        );
        return back({{"code", code}});
    }

    /// POST token: a code or a refresh token for a new pair of tokens. The client proves itself
    /// with its secret in the form (the Authorization header is the user's, so it cannot carry it
    /// here).
    [[nodiscard]] Response token(const Request& request) const
    {
        const auto form = nc::util::parse_form(request.get_body());
        const nc::db::Client db{m_host};
        const std::string client_id = field(request, form, "client_id");
        const auto clients =
            db.query("SELECT secret_digest FROM nc_oauth_clients WHERE client_id = ?", {client_id});
        if (clients.empty() || !nc::util::constant_time_equals(
                                   nc::db::value_of(clients.front(), "secret_digest"),
                                   digest(field(request, form, "client_secret"))
                               )) {
            return oauth_error(401, "invalid_client");
        }
        const std::string grant = field(request, form, "grant_type");
        std::string user;
        if (grant == "authorization_code") {
            const std::string code = field(request, form, "code");
            // Taking the code and deleting it is one statement, so two requests cannot both use it.
            const auto rows = db.query(
                "SELECT uid, redirect_uri, challenge, expires FROM nc_oauth_codes WHERE digest = ? "
                "AND client_id = ?",
                {digest(code), client_id}
            );
            if (rows.empty() ||
                db.exec("DELETE FROM nc_oauth_codes WHERE digest = ?", {digest(code)}) == 0) {
                return oauth_error(400, "invalid_grant");
            }
            const nc::db::Row& row = rows.front();
            if (std::strtoll(nc::db::value_of(row, "expires").c_str(), nullptr, 10) <
                    now_seconds() ||
                nc::db::value_of(row, "redirect_uri") != field(request, form, "redirect_uri")) {
                return oauth_error(400, "invalid_grant");
            }
            if (const std::string challenge = nc::db::value_of(row, "challenge");
                !challenge.empty()) {
                const std::string verifier = field(request, form, "code_verifier");
                if (verifier.empty() || base64url(nc::util::sha256(verifier)) != challenge) {
                    return oauth_error(400, "invalid_grant", "PKCE verification failed");
                }
            }
            user = nc::db::value_of(row, "uid");
        } else if (grant == "refresh_token") {
            const std::string refresh = field(request, form, "refresh_token");
            const auto rows = db.query(
                "SELECT uid FROM nc_oauth_tokens WHERE refresh_digest = ? AND client_id = ?",
                {digest(refresh), client_id}
            );
            // A refresh token works once: the old pair is gone as soon as the new one is made.
            if (rows.empty() || db.exec(
                                    "DELETE FROM nc_oauth_tokens WHERE refresh_digest = ?",
                                    {digest(refresh)}
                                ) == 0) {
                return oauth_error(400, "invalid_grant");
            }
            user = nc::db::value_of(rows.front(), "uid");
        } else {
            return oauth_error(400, "unsupported_grant_type");
        }
        const std::string access = nc::util::random_hex(32);
        const std::string refresh = nc::util::random_hex(32);
        db.exec(
            "INSERT INTO nc_oauth_tokens (access_digest, refresh_digest, client_id, uid, expires) "
            "VALUES (?, ?, ?, ?, ?)",
            {digest(access),
             digest(refresh),
             client_id,
             user,
             std::to_string(now_seconds() + ACCESS_LIFETIME)}
        );
        Response response = Response::json(
            200,
            R"({"access_token":)" + json_string(access) +
                R"(,"token_type":"Bearer","expires_in":)" + std::to_string(ACCESS_LIFETIME) +
                R"(,"refresh_token":)" + json_string(refresh) + R"(,"user_id":)" +
                json_string(user) + "}"
        );
        response.add_header("Cache-Control", "no-store");
        response.add_header("Pragma", "no-cache");
        return response;
    }

    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(OAuth2Plugin)
