/**
 * @file saml_plugin.cc
 * @brief Single sign-on with SAML 2.0 (Web browser SSO, SP-initiated, HTTP-Redirect out and
 * HTTP-POST in). Counterpart of Nextcloud's `user_saml` app, reduced to one identity provider.
 *
 *   GET  /index.php/apps/user_saml/saml/metadata   the service provider's metadata
 *   GET  /index.php/apps/user_saml/saml/login      sends the browser to the identity provider
 *   POST /index.php/apps/user_saml/saml/acs        where the identity provider posts the response
 *
 * A person who signs in is created as an account (`users.ensure`) and gets an app password
 * (`tokens.create`) that the page shows once: clients keep that instead of a password. Every login
 * answers a request this server made (it is remembered for ten minutes and used once), and an
 * assertion is accepted once (replays are refused until it expires).
 */
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "saml.h"

#include <chrono>
#include <fstream>
#include <memory>
#include <sstream>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions OPEN{nc::app::Access::PUBLIC, nc::app::Format::PLAIN};

std::int64_t now_seconds()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

Response page(int status, const std::string& title, const std::string& body)
{
    Response response = Response::text(
        status,
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + nc::util::xml_escape(title) +
            "</title></head><body><h1>" + nc::util::xml_escape(title) + "</h1>" + body +
            "</body></html>"
    );
    response.set_content_type("text/html; charset=utf-8");
    response.add_header("Cache-Control", "no-store");
    response.add_header("X-Content-Type-Options", "nosniff");
    return response;
}

/// Account names the rest of the server accepts.
bool good_uid(std::string_view uid)
{
    return !uid.empty() && uid.size() <= 64 &&
           uid.find_first_not_of(
               "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.@-"
           ) == std::string_view::npos &&
           uid.front() != '.';
}

class SamlPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "saml";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Single sign-on with SAML 2.0";
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
        std::string base = host.config("url", "");
        while (!base.empty() && base.back() == '/') {
            base.pop_back();
        }
        m_base = base;
        m_settings.sp_entity_id =
            host.config("sp_entity_id", base + "/index.php/apps/user_saml/saml/metadata");
        m_settings.acs_url = base + "/index.php/apps/user_saml/saml/acs";
        m_settings.idp_entity_id = host.config("idp_entity_id", "");
        m_sso_url = host.config("idp_sso_url", "");
        m_uid_attribute = host.config("uid_attribute", "");
        m_name_attribute = host.config("displayname_attribute", "");
        m_mail_attribute = host.config("email_attribute", "");
        std::ifstream certificate{host.config("idp_certificate_file", "")};
        std::ostringstream pem;
        pem << certificate.rdbuf();
        m_settings.idp_certificate_pem = pem.str();
        // Without all of this nobody could sign in, and nothing half configured should answer.
        m_ready = !base.empty() && !m_settings.idp_entity_id.empty() && !m_sso_url.empty() &&
                  m_settings.idp_certificate_pem.rfind("-----BEGIN", 0) != std::string::npos;
        if (!m_ready) {
            host.log(
                nc::LogLevel::WARNING,
                "SAML is not configured (url, idp_entity_id, idp_sso_url, idp_certificate_file)"
            );
        }

        nc::db::Client{&host}.migrate(
            "saml",
            1,
            "CREATE TABLE nc_saml_requests (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);"
            "CREATE TABLE nc_saml_seen (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);"
        );

        m_app->route(
            "GET",
            "/index.php/apps/user_saml/saml/metadata",
            OPEN,
            [this](const Request&)
            {
                if (!m_ready) {
                    return Response::text(404, "SAML is not configured");
                }
                return Response::xml(200, nc::saml::metadata(m_settings));
            }
        );
        m_app->route(
            "GET",
            "/index.php/apps/user_saml/saml/login",
            OPEN,
            [this](const Request&)
            {
                if (!m_ready) {
                    return Response::text(404, "SAML is not configured");
                }
                const std::string id = "_" + nc::util::random_hex(16);
                const nc::db::Client db{m_host};
                db.exec(
                    "DELETE FROM nc_saml_requests WHERE expires < ?",
                    {std::to_string(now_seconds())}
                );
                db.exec(
                    "INSERT INTO nc_saml_requests (id, expires) VALUES (?, ?)",
                    {id, std::to_string(now_seconds() + 600)}
                );
                const std::string xml =
                    nc::saml::build_authn_request(m_settings, id, m_sso_url, now_seconds());
                Response redirect{302};
                redirect.add_header("Location", nc::saml::redirect_url(m_sso_url, xml, ""));
                redirect.add_header("Cache-Control", "no-store");
                return redirect;
            }
        );
        m_app->route(
            "POST",
            "/index.php/apps/user_saml/saml/acs",
            OPEN,
            [this](const Request& request)
            {
                return assert_consumer(request);
            }
        );
    }

private:
    [[nodiscard]] Response assert_consumer(const Request& request) const
    {
        if (!m_ready) {
            return Response::text(404, "SAML is not configured");
        }
        const auto form = nc::util::parse_form(request.get_body());
        const auto xml = nc::util::base64_decode(nc::util::form_value(form, "SAMLResponse"));
        if (!xml) {
            return page(400, "Sign-in failed", "<p>The response is not valid.</p>");
        }
        const nc::db::Client db{m_host};
        const std::int64_t now = now_seconds();
        db.exec("DELETE FROM nc_saml_requests WHERE expires < ?", {std::to_string(now)});
        db.exec("DELETE FROM nc_saml_seen WHERE expires < ?", {std::to_string(now)});
        // The response names the request it answers; only one of ours counts, and only once.
        const std::string in_response_to = response_id(*xml);
        if (in_response_to.empty() ||
            db.exec(
                "DELETE FROM nc_saml_requests WHERE id = ? AND expires >= ?",
                {in_response_to, std::to_string(now)}
            ) == 0) {
            return page(
                400,
                "Sign-in failed",
                "<p>The sign-in was not started here, or took too long.</p>"
            );
        }
        const auto assertion = nc::saml::validate_response(*xml, m_settings, in_response_to, now);
        if (!assertion) {
            m_host->log(nc::LogLevel::WARNING, "SAML response refused: " + assertion.error());
            return page(
                403,
                "Sign-in failed",
                "<p>The identity provider's answer was refused.</p>"
            );
        }
        // An assertion works once.
        if (db.exec(
                "INSERT OR IGNORE INTO nc_saml_seen (id, expires) VALUES (?, ?)",
                {assertion->id, std::to_string(std::max(assertion->not_on_or_after, now) + 300)}
            ) == 0) {
            return page(403, "Sign-in failed", "<p>This assertion was used before.</p>");
        }
        const auto attribute = [&](const std::string& name) -> std::string
        {
            const auto found = assertion->attributes.find(name);
            return name.empty() || found == assertion->attributes.end() || found->second.empty()
                       ? std::string{}
                       : found->second.front();
        };
        const std::string uid =
            m_uid_attribute.empty() ? assertion->name_id : attribute(m_uid_attribute);
        if (!good_uid(uid)) {
            return page(
                403,
                "Sign-in failed",
                "<p>The identity provider sent no usable account name.</p>"
            );
        }
        const Response ensured = m_host->call_service(
            "users.ensure",
            nc::util::form_encode(
                {{"id", uid},
                 {"displayname", attribute(m_name_attribute)},
                 {"email", attribute(m_mail_attribute)}}
            )
        );
        if (ensured.get_status() != 200) {
            return page(403, "Sign-in failed", "<p>The account could not be set up.</p>");
        }
        const Response token = m_host->call_service(
            "tokens.create",
            nc::util::form_encode({{"user", uid}, {"name", "Single sign-on"}})
        );
        if (token.get_status() != 200) {
            return page(500, "Sign-in failed", "<p>No app password could be made.</p>");
        }
        return page(
            200,
            "Signed in",
            "<p>You are signed in as <b>" + nc::util::xml_escape(uid) +
                "</b>.</p><p>Use this app password in your clients (it is shown once):</p>"
                "<p><code>" +
                nc::util::xml_escape(token.get_body()) + "</code></p>"
        );
    }

    /// The `InResponseTo` of the (not yet trusted) response, only to look up our own request.
    [[nodiscard]] static std::string response_id(std::string_view xml)
    {
        const std::size_t at = xml.find("InResponseTo=\"");
        if (at == std::string_view::npos) {
            return {};
        }
        const std::size_t start = at + 14;
        const std::size_t end = xml.find('"', start);
        const std::string_view id =
            xml.substr(start, end == std::string_view::npos ? 0 : end - start);
        return id.size() > 8 && id.size() < 100 &&
                       id.find_first_not_of("_0123456789abcdef") == std::string_view::npos
                   ? std::string{id}
                   : std::string{};
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
    nc::saml::Settings m_settings{};
    std::string m_base{};
    std::string m_sso_url{};
    std::string m_uid_attribute{};
    std::string m_name_attribute{};
    std::string m_mail_attribute{};
    bool m_ready{false};
};

} // namespace

NC_PLUGIN(SamlPlugin)
