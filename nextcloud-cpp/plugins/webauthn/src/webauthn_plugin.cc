/**
 * @file webauthn_plugin.cc
 * @brief Passkeys and security keys (WebAuthn), as Nextcloud's core offers them:
 *
 *   GET    /settings/api/personal/webauthn/registration       options to register a device
 *   POST   /settings/api/personal/webauthn/registration       name, data: the browser's answer
 *   DELETE /settings/api/personal/webauthn/registration/{id}  remove a device
 *   GET    /settings/api/personal/webauthn/registrations      the devices of the account
 *   POST   /login/webauthn/start                              loginName: options to sign in
 *   POST   /login/webauthn/finish                             data: the browser's answer
 *
 * A device that signs in gets an app password (`tokens.create`) that the answer carries once;
 * clients keep that instead of a password. The challenge replaces the session of the PHP original:
 * it is random, remembered for five minutes and used once, and the answer names it.
 *
 * Config: `rp_id` (the host name pages are served from; the `Host` header without its port when
 * unset), `origins` (comma separated, `https://<rp_id>` when unset), `rp_name` ("Nextcloud").
 */
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"
#include "webauthn.h"

#include <chrono>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;
namespace wa = nc::webauthn;

constexpr nc::app::RouteOptions USER{nc::app::Access::USER, nc::app::Format::PLAIN};
constexpr nc::app::RouteOptions OPEN{nc::app::Access::PUBLIC, nc::app::Format::PLAIN};

constexpr std::int64_t CHALLENGE_SECONDS = 300;
constexpr int MAX_PENDING = 10'000;
constexpr int MAX_DEVICES = 20;
const std::string SIGN_IN_TOKEN = "Passkey sign-in";

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

/// A request field from a JSON object or a form.
std::string field(const Request& request, std::string_view name)
{
    const std::string& body = request.get_body();
    if (!body.empty() && body.front() == '{') {
        const auto json = nc::util::Json::parse(body);
        if (json && json->is_object() && (*json)[name].is_string()) {
            return (*json)[name].string();
        }
        return {};
    }
    return nc::util::form_value(nc::util::parse_form(body), name);
}

Response failure(int status, std::string_view message)
{
    return Response::json(status, R"({"message":)" + json_string(message) + "}");
}

class WebAuthnPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "webauthn";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Sign in with passkeys and security keys (WebAuthn)";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db", "users", "tokens"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        m_rp_id = host.config("rp_id", "");
        m_rp_name = host.config("rp_name", "Nextcloud");
        for (const std::string& origin: nc::util::split(host.config("origins", ""), ',')) {
            if (!nc::util::trim(origin).empty()) {
                m_origins.emplace_back(nc::util::trim(origin));
            }
        }
        nc::db::Client{&host}.migrate(
            "webauthn",
            1,
            "CREATE TABLE nc_webauthn (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, "
            "name TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL, "
            "algorithm INTEGER NOT NULL, counter INTEGER NOT NULL, user_verified INTEGER NOT "
            "NULL, created INTEGER NOT NULL);"
            "CREATE INDEX nc_webauthn_uid ON nc_webauthn (uid);"
            "CREATE TABLE nc_webauthn_challenges (challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, "
            "uid TEXT NOT NULL, expires INTEGER NOT NULL);"
        );

        host.add_service(
            "capabilities.webauthn",
            [](std::string_view)
            {
                return Response::json(200, R"({"passwordless":true})");
            }
        );

        constexpr std::string_view BASE = "/settings/api/personal/webauthn/registration";
        m_app->route(
            "GET",
            BASE,
            USER,
            [this](const Request& request)
            {
                return start_registration(request);
            }
        );
        m_app->route(
            "POST",
            BASE,
            USER,
            [this](const Request& request)
            {
                return finish_registration(request);
            }
        );
        m_app->route(
            "DELETE",
            "/settings/api/personal/webauthn/registration/{id}",
            USER,
            [this](const Request& request)
            {
                const auto removed = nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_webauthn WHERE id = ? AND uid = ?",
                    {std::string{request.param("id")}, request.get_user()}
                );
                return removed == 0 ? failure(404, "No such device") : Response::json(200, "{}");
            }
        );
        m_app->route(
            "GET",
            "/settings/api/personal/webauthn/registrations",
            USER,
            [this](const Request& request)
            {
                std::string json = "[";
                bool first = true;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, name, created, user_verified FROM nc_webauthn WHERE uid = ? "
                         "ORDER BY id",
                         {request.get_user()}
                     )) {
                    json += first ? "" : ",";
                    first = false;
                    json += R"({"id":)" + nc::db::value_of(row, "id") + R"(,"name":)" +
                            json_string(nc::db::value_of(row, "name")) + R"(,"created":)" +
                            nc::db::value_of(row, "created") + R"(,"userVerified":)" +
                            (nc::db::value_of(row, "user_verified") == "1" ? "true" : "false") +
                            "}";
                }
                return Response::json(200, json + "]");
            }
        );
        m_app->route(
            "POST",
            "/login/webauthn/start",
            OPEN,
            [this](const Request& request)
            {
                return start_authentication(request);
            }
        );
        m_app->route(
            "POST",
            "/login/webauthn/finish",
            OPEN,
            [this](const Request& request)
            {
                return finish_authentication(request);
            }
        );

        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const std::string uid{nc::util::form_value(nc::util::parse_form(payload), "user")};
                if (!uid.empty()) {
                    nc::db::Client{m_host}.exec("DELETE FROM nc_webauthn WHERE uid = ?", {uid});
                }
            }
        );
    }

private:
    [[nodiscard]] wa::RelyingParty party(const Request& request) const
    {
        wa::RelyingParty out;
        out.id = m_rp_id;
        if (out.id.empty()) {
            std::string host{request.header("Host")};
            // Only the host name counts, not the port.
            if (!host.empty() && host.front() != '[') {
                host = host.substr(
                    0,
                    host.rfind(':') == std::string::npos ? host.size() : host.rfind(':')
                );
            }
            out.id = host;
        }
        out.origins = m_origins;
        if (out.origins.empty() && !out.id.empty()) {
            out.origins.push_back("https://" + out.id);
        }
        return out;
    }

    /// A fresh challenge, remembered for `kind` and the account.
    [[nodiscard]] std::string issue(const std::string& kind, const std::string& uid) const
    {
        const nc::db::Client db{m_host};
        const std::int64_t now = now_seconds();
        db.exec("DELETE FROM nc_webauthn_challenges WHERE expires < ?", {std::to_string(now)});
        const auto pending = db.query("SELECT COUNT(*) AS n FROM nc_webauthn_challenges");
        if (!pending.empty() &&
            std::atoi(nc::db::value_of(pending.front(), "n").c_str()) >= MAX_PENDING) {
            return {};
        }
        const std::string challenge = *nc::util::from_hex(nc::util::random_hex(32));
        db.exec(
            "INSERT INTO nc_webauthn_challenges (challenge, kind, uid, expires) VALUES (?, ?, ?, "
            "?)",
            {wa::base64url_encode(challenge), kind, uid, std::to_string(now + CHALLENGE_SECONDS)}
        );
        return challenge;
    }

    /// Takes the challenge back (once): the account it was issued for, or empty.
    [[nodiscard]] std::optional<std::string>
    redeem(const std::string& challenge, const std::string& kind) const
    {
        const nc::db::Client db{m_host};
        const std::string encoded = wa::base64url_encode(challenge);
        const auto rows = db.query(
            "SELECT uid, expires FROM nc_webauthn_challenges WHERE challenge = ? AND kind = ?",
            {encoded, kind}
        );
        // Used once, whatever the outcome.
        if (db.exec("DELETE FROM nc_webauthn_challenges WHERE challenge = ?", {encoded}) == 0 ||
            rows.empty() ||
            std::atoll(nc::db::value_of(rows.front(), "expires").c_str()) < now_seconds()) {
            return std::nullopt;
        }
        return nc::db::value_of(rows.front(), "uid");
    }

    [[nodiscard]] Response start_registration(const Request& request) const
    {
        const wa::RelyingParty rp = party(request);
        if (rp.id.empty()) {
            return failure(500, "The relying party is not known: set rp_id");
        }
        const nc::db::Client db{m_host};
        const auto devices =
            db.query("SELECT credential_id FROM nc_webauthn WHERE uid = ?", {request.get_user()});
        if (static_cast<int>(devices.size()) >= MAX_DEVICES) {
            return failure(409, "Too many devices are registered");
        }
        const std::string challenge = issue("create", request.get_user());
        if (challenge.empty()) {
            return failure(503, "Too many requests are waiting");
        }
        const Response user = m_host->call_service("users.get", request.get_user());
        const auto details = nc::util::Json::parse(user.get_body());
        const std::string shown = details && (*details)["displayname"].is_string() &&
                                          !(*details)["displayname"].string().empty()
                                      ? (*details)["displayname"].string()
                                      : request.get_user();
        std::string exclude;
        for (const nc::db::Row& row: devices) {
            exclude += exclude.empty() ? "" : ",";
            exclude += R"({"type":"public-key","id":)" +
                       json_string(nc::db::value_of(row, "credential_id")) + "}";
        }
        return Response::json(
            200,
            R"({"rp":{"name":)" + json_string(m_rp_name) + R"(,"id":)" + json_string(rp.id) +
                R"(},"user":{"id":)" + json_string(wa::base64url_encode(request.get_user())) +
                R"(,"name":)" + json_string(request.get_user()) + R"(,"displayName":)" +
                json_string(shown) + R"(},"challenge":)" +
                json_string(wa::base64url_encode(challenge)) +
                R"(,"pubKeyCredParams":[{"type":"public-key","alg":-7},{"type":"public-key","alg":-257},{"type":"public-key","alg":-8}],"timeout":60000,"excludeCredentials":[)" +
                exclude +
                R"(],"authenticatorSelection":{"userVerification":"preferred"},"attestation":"none"})"
        );
    }

    [[nodiscard]] Response finish_registration(const Request& request) const
    {
        std::string name{nc::util::trim(field(request, "name"))};
        const std::string data = field(request, "data");
        if (name.empty() || name.size() > 128) {
            return failure(400, "A device needs a name of up to 128 characters");
        }
        const auto response = wa::parse_client_response(data, true);
        if (!response) {
            return failure(400, "The credential is not valid");
        }
        const auto challenge = wa::challenge_of(response->client_data_json);
        if (!challenge) {
            return failure(400, "The credential is not valid");
        }
        const auto owner = redeem(*challenge, "create");
        if (!owner || *owner != request.get_user()) {
            return failure(400, "The registration was not asked for, or it took too long");
        }
        const auto credential =
            wa::verify_registration(party(request), *challenge, *response, false);
        if (!credential) {
            m_host->log(
                nc::LogLevel::WARNING,
                "WebAuthn registration refused: " + credential.error()
            );
            return failure(400, "The device could not be registered");
        }
        const nc::db::Client db{m_host};
        const bool added = db.exec(
                               "INSERT OR IGNORE INTO nc_webauthn (uid, name, credential_id, "
                               "public_key, algorithm, counter, user_verified, created) VALUES "
                               "(?, ?, ?, ?, ?, ?, ?, ?)",
                               {request.get_user(),
                                name,
                                wa::base64url_encode(credential->id),
                                nc::util::base64_encode(credential->public_key),
                                std::to_string(credential->algorithm),
                                std::to_string(credential->counter),
                                credential->user_verified ? "1" : "0",
                                std::to_string(now_seconds())}
                           ) > 0;
        if (!added) {
            return failure(409, "This device is already registered");
        }
        return Response::json(200, R"({"name":)" + json_string(name) + "}");
    }

    [[nodiscard]] Response start_authentication(const Request& request) const
    {
        const wa::RelyingParty rp = party(request);
        if (rp.id.empty()) {
            return failure(500, "The relying party is not known: set rp_id");
        }
        const std::string login = field(request, "loginName");
        // An account that does not exist (or has no device) gets options like any other, so the
        // answer does not tell which accounts exist.
        std::string uid;
        if (!login.empty() && login.size() <= 256) {
            const Response user = m_host->call_service("users.get", login);
            const auto details = nc::util::Json::parse(user.get_body());
            if (user.get_status() == 200 && details && (*details)["enabled"].boolean()) {
                uid = (*details)["id"].string();
            }
        }
        const std::string challenge = issue("get", uid);
        if (challenge.empty()) {
            return failure(503, "Too many requests are waiting");
        }
        std::string allowed;
        bool all_verified = !uid.empty();
        if (!uid.empty()) {
            for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                     "SELECT credential_id, user_verified FROM nc_webauthn WHERE uid = ?",
                     {uid}
                 )) {
                allowed += allowed.empty() ? "" : ",";
                allowed += R"({"type":"public-key","id":)" +
                           json_string(nc::db::value_of(row, "credential_id")) + "}";
                all_verified = all_verified && nc::db::value_of(row, "user_verified") == "1";
            }
        }
        return Response::json(
            200,
            R"({"challenge":)" + json_string(wa::base64url_encode(challenge)) + R"(,"rpId":)" +
                json_string(rp.id) + R"(,"timeout":60000,"allowCredentials":[)" + allowed +
                R"(],"userVerification":")" + (all_verified ? "required" : "discouraged") + R"("})"
        );
    }

    [[nodiscard]] Response finish_authentication(const Request& request) const
    {
        const auto response = wa::parse_client_response(field(request, "data"), false);
        if (!response) {
            return failure(400, "The credential is not valid");
        }
        const auto challenge = wa::challenge_of(response->client_data_json);
        if (!challenge) {
            return failure(400, "The credential is not valid");
        }
        // The challenge is used up now, whatever the outcome.
        const auto owner = redeem(*challenge, "get");
        const auto refuse = [&](const std::string& why)
        {
            m_host->log(nc::LogLevel::WARNING, "WebAuthn sign-in refused: " + why);
            return failure(401, "The sign-in was refused");
        };
        if (!owner || owner->empty()) {
            return refuse("no request was open for this challenge");
        }
        const nc::db::Client db{m_host};
        const auto rows = db.query(
            "SELECT id, public_key, algorithm, counter, user_verified FROM nc_webauthn WHERE uid = "
            "? AND credential_id = ?",
            {*owner, wa::base64url_encode(response->credential_id)}
        );
        if (rows.empty()) {
            return refuse("the device is not registered for the account");
        }
        const nc::db::Row& row = rows.front();
        const auto key = nc::util::base64_decode(nc::db::value_of(row, "public_key"));
        if (!key) {
            return refuse("the stored key is damaged");
        }
        wa::Credential stored;
        stored.id = response->credential_id;
        stored.public_key = *key;
        stored.algorithm = std::atoi(nc::db::value_of(row, "algorithm").c_str());
        stored.counter =
            static_cast<std::uint32_t>(std::atoll(nc::db::value_of(row, "counter").c_str()));
        stored.user_verified = nc::db::value_of(row, "user_verified") == "1";
        const auto assertion = wa::verify_assertion(
            party(request),
            stored,
            *challenge,
            *response,
            stored.user_verified
        );
        if (!assertion) {
            return refuse(assertion.error());
        }
        db.exec(
            "UPDATE nc_webauthn SET counter = ? WHERE id = ?",
            {std::to_string(assertion->counter), nc::db::value_of(row, "id")}
        );
        const Response token = m_host->call_service(
            "tokens.create",
            nc::util::form_encode({{"user", *owner}, {"name", SIGN_IN_TOKEN}})
        );
        if (token.get_status() != 200) {
            return failure(500, "No app password could be made");
        }
        return Response::json(
            200,
            R"({"user":)" + json_string(*owner) + R"(,"token":)" + json_string(token.get_body()) +
                "}"
        );
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
    std::string m_rp_id{};
    std::string m_rp_name{"Nextcloud"};
    std::vector<std::string> m_origins{};
};

} // namespace

NC_PLUGIN(WebAuthnPlugin)
