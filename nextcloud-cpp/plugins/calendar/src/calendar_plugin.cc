/**
 * @file calendar_plugin.cc
 * @brief CalDAV calendars (RFC 4791 subset): calendars and events/tasks per user, discovery
 * (`/.well-known/caldav`, `/remote.php/dav`, principals) and the shared collection server.
 * Counterpart of `apps/dav/lib/CalDAV`. This plugin also answers the DAV root and the principal,
 * and names the address book home when the contacts plugin is loaded.
 */
#include "collection_server.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;

std::string principal_response(const std::string& href, const std::string& props)
{
    return " <d:response>\n  <d:href>" + nc::util::xml_escape(href) +
           "</d:href>\n  <d:propstat>\n   <d:prop>\n" + props +
           "   </d:prop>\n   <d:status>HTTP/1.1 200 OK</d:status>\n  </d:propstat>\n "
           "</d:response>\n";
}

Response discovery(std::string body)
{
    return Response::xml(
        207,
        "<?xml version=\"1.0\"?>\n<d:multistatus xmlns:d=\"DAV:\" "
        "xmlns:cal=\"urn:ietf:params:xml:ns:caldav\" "
        "xmlns:card=\"urn:ietf:params:xml:ns:carddav\">\n" +
            body + "</d:multistatus>\n"
    );
}

class CalendarPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "calendar";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "CalDAV calendars";
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
            nc::davobjects::Kind::calendar(),
            &host,
            max_size
        );
        m_server->install(host);

        // The entry points clients try first.
        for (const char* method: {"GET", "PROPFIND"}) {
            host.add_route(
                method,
                "/.well-known/caldav",
                [](const Request&)
                {
                    Response response = Response::text(301, "");
                    response.add_header("Location", "/remote.php/dav/");
                    return response;
                }
            );
        }
        host.add_route(
            "PROPFIND",
            "/remote.php/dav",
            [](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                return discovery(principal_response(
                    "/remote.php/dav/",
                    "    <d:current-user-principal><d:href>/remote.php/dav/principals/users/" +
                        nc::util::xml_escape(request.get_user()) +
                        "/</d:href></d:current-user-principal>\n"
                ));
            }
        );
        host.add_route(
            "PROPFIND",
            "/remote.php/dav/principals/users/{user}",
            [&host](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                if (request.param("user") != request.get_user()) {
                    return Response::text(403, "Forbidden");
                }
                const std::string user = nc::util::xml_escape(request.get_user());
                std::string props =
                    "    <d:resourcetype><d:principal/></d:resourcetype>\n    <d:displayname>" +
                    user + "</d:displayname>\n";
                props += "    <cal:calendar-home-set><d:href>/remote.php/dav/calendars/" + user +
                         "/</d:href></cal:calendar-home-set>\n";
                if (host.call_service("contacts.home", "").get_status() == 200) {
                    props +=
                        "    "
                        "<card:addressbook-home-set><d:href>/remote.php/dav/addressbooks/users/" +
                        user + "/</d:href></card:addressbook-home-set>\n";
                }
                return discovery(
                    principal_response("/remote.php/dav/principals/users/" + user + "/", props)
                );
            }
        );
    }

private:
    std::unique_ptr<nc::davobjects::CollectionServer> m_server{};
};

} // namespace

NC_PLUGIN(CalendarPlugin)
