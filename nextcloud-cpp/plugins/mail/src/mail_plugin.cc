/**
 * @file mail_plugin.cc
 * @brief The mail plugin: the `mail.send` service, a send API, and notifications for events of
 * other plugins (a share was created, an account was created). Counterpart of Nextcloud's
 * `lib/private/Mail/Mailer` and the notification mails of `files_sharing` and `settings`.
 */
#include "mime.h"
#include "nextcloud/app.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"
#include "transport.h"

#include <cstdlib>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions USER{nc::app::Access::USER, nc::app::Format::OCS};
using nc::mail::MailMessage;

std::vector<std::string> addresses_from(std::string_view list)
{
    std::vector<std::string> out;
    for (const std::string& part: nc::util::split(list, ',')) {
        const std::string_view trimmed = nc::util::trim(part);
        if (!trimmed.empty()) {
            out.emplace_back(trimmed);
        }
    }
    return out;
}

class MailPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "mail";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Sends mail: a service for other plugins, an API, and notifications";
    }

    void on_load(nc::Host& host) override
    {
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        m_from = host.config("from_address", "no-reply@localhost.localdomain");
        m_from_name = host.config("from_name", "Nextcloud");
        m_max_recipients = std::strtoul(host.config("max_recipients", "50").c_str(), nullptr, 10);
        m_notify_shares = host.config("notify_shares", "true") == "true";
        m_welcome = host.config("welcome_mail", "true") == "true";
        if (!nc::util::is_valid_email(m_from)) {
            throw std::runtime_error("from_address is not a valid address: " + m_from);
        }

        const std::string mode = host.config("mode", "spool");
        if (mode == "spool") {
            m_transport = std::make_unique<nc::mail::SpoolTransport>(
                host.config("spool_dir", host.config("data_dir", "data") + "/mail-spool")
            );
        } else if (mode == "sendmail") {
            m_transport = std::make_unique<nc::mail::SendmailTransport>(
                host.config("sendmail_path", "/usr/sbin/sendmail")
            );
        } else if (mode == "smtp") {
            m_transport = std::make_unique<nc::mail::SmtpTransport>(
                host.config("smtp_host", "127.0.0.1"),
                host.config("smtp_port", "25"),
                host.config("smtp_helo", "localhost")
            );
        } else if (mode == "null") {
            m_transport = std::make_unique<nc::mail::NullTransport>();
        } else {
            throw std::runtime_error(
                "unknown mail mode \"" + mode + "\" (spool, sendmail, smtp or null)"
            );
        }
        host.log(nc::LogLevel::INFO, "mail mode: " + std::string(m_transport->name()));

        // Service for other plugins: args are a form: to, cc, bcc (comma lists), subject, body,
        // html, reply_to.
        host.add_service(
            "mail.send",
            [this](std::string_view args)
            {
                return send_from_form(nc::util::parse_form(args), {});
            }
        );
        host.add_service(
            "mail.validate",
            [](std::string_view args)
            {
                return nc::util::is_valid_email(args) ? Response::text(200, "ok")
                                                      : Response::text(400, "not a valid address");
            }
        );

        m_app->post(
            "/ocs/v2.php/apps/mail/api/v1/send",
            USER,
            [this, &host](const Request& request)
            {
                // The signed-in user's own address becomes the reply-to, so answers reach them.
                const Response email = host.call_service("users.email", request.get_user());
                Response result = send_from_form(
                    nc::util::parse_form(request.get_body()),
                    email.get_status() == 200 ? email.get_body() : std::string{}
                );
                return nc::http::ocs(
                    result.get_status() == 200 ? 200 : result.get_status(),
                    result.get_status() == 200 ? "OK" : result.get_body(),
                    result.get_status() == 200 ? R"({"sent":true})" : "{}"
                );
            }
        );

        host.add_command(
            "mail:send",
            "Sends a mail: mail:send <to> <subject> <body>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 3) {
                    out = "usage: mail:send <to> <subject> <body>\n";
                    return 1;
                }
                const Response result =
                    send_from_form({{"to", args[0]}, {"subject", args[1]}, {"body", args[2]}}, {});
                out = result.get_status() == 200 ? "sent " + result.get_body() + "\n"
                                                 : result.get_body() + "\n";
                return result.get_status() == 200 ? 0 : 1;
            }
        );

        host.add_command(
            "mail:test",
            "Sends a test mail: mail:test <to>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: mail:test <to>\n";
                    return 1;
                }
                const Response result = send_from_form(
                    {{"to", args[0]},
                     {"subject", "Test mail"},
                     {"body", "This mail checks the mail settings of your Nextcloud runner.\n"}},
                    {}
                );
                out = result.get_status() == 200
                          ? "sent via " + std::string(m_transport->name()) + "\n"
                          : result.get_body() + "\n";
                return result.get_status() == 200 ? 0 : 1;
            }
        );

        // Notifications for what other plugins announce on the event bus.
        host.subscribe(
            "share.created",
            [this, &host](std::string_view, std::string_view payload)
            {
                if (!m_notify_shares) {
                    return;
                }
                const auto share = nc::util::parse_form(payload);
                if (nc::util::form_value(share, "type") != "0") {
                    return; // link shares have no recipient to tell
                }
                const std::string recipient = nc::util::form_value(share, "share_with");
                const Response email = host.call_service("users.email", recipient);
                if (email.get_status() != 200 || email.get_body().empty()) {
                    return;
                }
                const std::string owner = nc::util::form_value(share, "owner");
                const std::string path = nc::util::form_value(share, "path");
                (void)send_from_form(
                    {{"to", email.get_body()},
                     {"subject", owner + " shared \"" + path + "\" with you"},
                     {"body",
                      "Hello " + recipient + ",\n\n" + owner + " shared \"" + path +
                          "\" with you.\n"}},
                    {}
                );
            }
        );

        host.subscribe(
            "user.created",
            [this](std::string_view, std::string_view payload)
            {
                if (!m_welcome) {
                    return;
                }
                const auto account = nc::util::parse_form(payload);
                const std::string email = nc::util::form_value(account, "email");
                if (email.empty()) {
                    return;
                }
                const std::string name = nc::util::form_value(account, "displayname");
                (void)send_from_form(
                    {{"to", email},
                     {"subject", "Welcome to Nextcloud"},
                     {"body",
                      "Hello " + name + ",\n\nYour account \"" +
                          nc::util::form_value(account, "id") + "\" is ready.\n"}},
                    {}
                );
            }
        );
    }

private:
    /// @brief Builds and sends one mail from form fields. 200 + the Message-ID, or 400/502 + the
    /// reason.
    Response send_from_form(
        const std::vector<std::pair<std::string, std::string>>& form,
        const std::string& reply_to
    ) const
    {
        const std::string asked_reply_to = nc::util::form_value(form, "reply_to");
        const MailMessage message =
            nc::mail::MailMessageBuilder{}
                .from(std::string{m_from})
                .from_name(std::string{m_from_name})
                .reply_to(std::string{asked_reply_to.empty() ? reply_to : asked_reply_to})
                .to(addresses_from(nc::util::form_value(form, "to")))
                .cc(addresses_from(nc::util::form_value(form, "cc")))
                .bcc(addresses_from(nc::util::form_value(form, "bcc")))
                .subject(nc::util::form_value(form, "subject"))
                .plain_body(nc::util::form_value(form, "body"))
                .html_body(nc::util::form_value(form, "html"))
                .build();

        const std::vector<std::string> everyone = message.recipients();
        if (everyone.size() > m_max_recipients) {
            return Response::text(
                400,
                "too many recipients (at most " + std::to_string(m_max_recipients) + ")"
            );
        }
        const auto built = nc::mail::build_message(message);
        if (!built) {
            return Response::text(400, built.error());
        }
        const nc::mail::Envelope envelope{std::string{m_from}, std::vector<std::string>(everyone)};
        const auto sent = m_transport->send(envelope, *built);
        if (!sent) {
            return Response::text(502, sent.error());
        }
        const std::size_t start = built->find("Message-ID: <") + 13;
        return Response::text(200, built->substr(start, built->find('>', start) - start));
    }

    std::string m_from{};
    std::string m_from_name{};
    std::size_t m_max_recipients{50};
    bool m_notify_shares{true};
    bool m_welcome{true};
    std::unique_ptr<nc::mail::Transport> m_transport{};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(MailPlugin)
