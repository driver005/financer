/**
 * @file contacts_plugin.cc
 * @brief CardDAV address books (RFC 6352 subset): address books and contacts per user, and
 * `/.well-known/carddav`. Counterpart of `apps/dav/lib/CardDAV`. The calendar plugin answers the
 * DAV root and the principal and lists this plugin's address book home through the `contacts.home`
 * service.
 */
#include "collection_server.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <memory>

namespace {

class ContactsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "contacts";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "CardDAV address books";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        const std::size_t max_size =
            std::strtoull(host.config("max_object_size", "1048576").c_str(), nullptr, 10);
        m_server = std::make_unique<nc::davobjects::CollectionServer>(
            nc::davobjects::Kind::addressbook(),
            &host,
            max_size
        );
        m_server->install(host);
        host.add_service(
            "contacts.home",
            [](std::string_view)
            {
                return nc::http::Response::text(200, "/remote.php/dav/addressbooks/users/");
            }
        );
        for (const char* method: {"GET", "PROPFIND"}) {
            host.add_route(
                method,
                "/.well-known/carddav",
                [](const nc::http::Request&)
                {
                    nc::http::Response response = nc::http::Response::text(301, "");
                    response.add_header("Location", "/remote.php/dav/");
                    return response;
                }
            );
        }
    }

private:
    std::unique_ptr<nc::davobjects::CollectionServer> m_server{};
};

} // namespace

NC_PLUGIN(ContactsPlugin)
