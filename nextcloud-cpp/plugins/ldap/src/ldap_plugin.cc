/**
 * @file ldap_plugin.cc
 * @brief Sign-in against an LDAP directory. Offers `auth.authenticate.ldap`, which the kernel tries
 * after the other authentication services; a person who signs in is created as an account
 * (`users.ensure`) so shares, groups and files work for them like for any other. Counterpart of
 * Nextcloud's `apps/user_ldap`, reduced to: simple bind, one user filter, display name and mail
 * attributes.
 *
 * How it checks a login: bind with the service account (or anonymously), search for exactly one
 * entry of the object class whose user attribute equals the name, then bind as that entry's DN with
 * the password. The search filter is built as a structure, so a name like `*)(uid=*` cannot widen
 * it.
 */
#include "ldap_client.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <chrono>
#include <map>
#include <mutex>

namespace {

using nc::http::Response;

class LdapPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "ldap";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Sign in with an LDAP directory";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_pepper = nc::util::random_hex(16);
        m_settings.set_host(host.config("host", ""));
        m_settings.set_port(host.config("port", "389"));
        m_settings.set_base_dn(host.config("base_dn", ""));
        m_settings.set_bind_dn(host.config("bind_dn", ""));
        m_settings.set_bind_password(host.config("bind_password", ""));
        m_settings.set_user_attribute(host.config("user_attribute", "uid"));
        m_settings.set_object_class(host.config("object_class", "person"));
        m_settings.set_display_attribute(host.config("display_attribute", "displayName"));
        m_settings.set_mail_attribute(host.config("mail_attribute", "mail"));
        if (m_settings.get_host().empty() || m_settings.get_base_dn().empty()) {
            throw std::runtime_error("set [ldap] host and base_dn");
        }
        host.add_service(
            "capabilities.ldap",
            [](std::string_view)
            {
                return Response::json(200, R"({"enabled":true})");
            }
        );

        // "user:password" -> the account id. Only a person the directory knows is accepted.
        host.add_service(
            "auth.authenticate.ldap",
            [this](std::string_view args)
            {
                const std::size_t colon = args.find(':');
                if (colon == std::string_view::npos) {
                    return Response::text(401, "");
                }
                const std::string name{args.substr(0, colon)};
                const std::string password{args.substr(colon + 1)};
                return check(name, password) ? Response::text(200, name) : Response::text(401, "");
            }
        );

        host.add_command(
            "ldap:search",
            "Shows what the directory knows about a user: ldap:search <name>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: ldap:search <name>\n";
                    return 1;
                }
                const auto entry = lookup(args[0]);
                if (!entry) {
                    out = entry.error() + "\n";
                    return 1;
                }
                out = "dn: " + entry->get_dn() +
                      "\ndisplay name: " + entry->first(m_settings.get_display_attribute()) +
                      "\nmail: " + entry->first(m_settings.get_mail_attribute()) + "\n";
                return 0;
            }
        );
    }

private:
    /// The entry for `name`, or why there is none (not found, several, directory not reachable).
    nc::ldap::Result<nc::ldap::Entry> lookup(const std::string& name) const
    {
        nc::ldap::Connection connection;
        if (auto opened = connection.open(m_settings.get_host(), m_settings.get_port()); !opened) {
            return nc::util::unexpected<std::string>{opened.error()};
        }
        if (auto bound = connection.bind(m_settings.get_bind_dn(), m_settings.get_bind_password());
            !bound) {
            return nc::util::unexpected<std::string>{"service account: " + bound.error()};
        }
        auto found = connection.find(
            m_settings.get_base_dn(),
            m_settings.get_object_class(),
            m_settings.get_user_attribute(),
            name,
            {m_settings.get_display_attribute(), m_settings.get_mail_attribute()}
        );
        if (!found) {
            return nc::util::unexpected<std::string>{found.error()};
        }
        if (found->empty()) {
            return nc::util::unexpected<std::string>{"no such user in the directory"};
        }
        if (found->size() > 1) {
            return nc::util::unexpected<std::string>{
                "more than one entry matches; the user attribute must be unique"
            };
        }
        return std::move(found->front());
    }

    bool check(const std::string& name, const std::string& password)
    {
        if (name.empty() || password.empty()) {
            return false;
        }
        const std::string key =
            nc::util::to_hex(nc::util::sha256(m_pepper + name + '\n' + password));
        {
            const std::lock_guard lock{m_mutex};
            const auto remembered = m_remembered.find(name);
            if (remembered != m_remembered.end() && remembered->second.first == key &&
                remembered->second.second > std::chrono::steady_clock::now()) {
                return true;
            }
        }
        const auto entry = lookup(name);
        if (!entry) {
            m_host->log(nc::LogLevel::INFO, "ldap: " + name + ": " + entry.error());
            return false;
        }
        nc::ldap::Connection user;
        if (!user.open(m_settings.get_host(), m_settings.get_port()) ||
            !user.bind(entry->get_dn(), password)) {
            return false;
        }
        // Make sure the person exists as an account; the account gets a password nobody knows.
        const Response ensured = m_host->call_service(
            "users.ensure",
            nc::util::form_encode(
                {{"id", name},
                 {"displayname", entry->first(m_settings.get_display_attribute())},
                 {"email", entry->first(m_settings.get_mail_attribute())}}
            )
        );
        if (ensured.get_status() != 200) {
            m_host->log(
                nc::LogLevel::WARNING,
                "ldap: cannot create the account for " + name + ": " + ensured.get_body()
            );
            return false;
        }
        const std::lock_guard lock{m_mutex};
        m_remembered[name] = {key, std::chrono::steady_clock::now() + std::chrono::seconds{60}};
        return true;
    }

    nc::Host* m_host{nullptr};
    nc::ldap::LdapSettings m_settings{};
    std::string m_pepper{};
    std::mutex m_mutex{};
    std::map<std::string, std::pair<std::string, std::chrono::steady_clock::time_point>>
        m_remembered{};
};

} // namespace

NC_PLUGIN(LdapPlugin)
