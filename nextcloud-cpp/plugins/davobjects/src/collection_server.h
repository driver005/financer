#pragma once

#include "nextcloud/db.h"
#include "nextcloud/plugin.h"

#include <string>
#include <string_view>

namespace nc::davobjects {

/// @brief What differs between CalDAV and CardDAV: the URL space, the file type, the XML names.
class Kind
{
public:
    Kind() noexcept = default;

    Kind(
        std::string&& name,
        std::string&& base,
        std::string&& content_type,
        std::string&& extension,
        std::string&& default_uri,
        std::string&& default_name
    ) noexcept :
        m_name{std::move(name)},
        m_base{std::move(base)},
        m_content_type{std::move(content_type)},
        m_extension{std::move(extension)},
        m_default_uri{std::move(default_uri)},
        m_default_name{std::move(default_name)}
    {
    }

    void set_name(std::string&& name) noexcept
    {
        m_name = std::move(name);
    }

    void set_base(std::string&& base) noexcept
    {
        m_base = std::move(base);
    }

    void set_content_type(std::string&& content_type) noexcept
    {
        m_content_type = std::move(content_type);
    }

    void set_extension(std::string&& extension) noexcept
    {
        m_extension = std::move(extension);
    }

    void set_default_uri(std::string&& uri) noexcept
    {
        m_default_uri = std::move(uri);
    }

    void set_default_name(std::string&& name) noexcept
    {
        m_default_name = std::move(name);
    }

    [[nodiscard]] std::string& get_name() noexcept
    {
        return m_name;
    }

    [[nodiscard]] const std::string& get_name() const noexcept
    {
        return m_name;
    }

    /// "/remote.php/dav/calendars" or "/remote.php/dav/addressbooks/users"
    [[nodiscard]] std::string& get_base() noexcept
    {
        return m_base;
    }

    [[nodiscard]] const std::string& get_base() const noexcept
    {
        return m_base;
    }

    [[nodiscard]] std::string& get_content_type() noexcept
    {
        return m_content_type;
    }

    [[nodiscard]] const std::string& get_content_type() const noexcept
    {
        return m_content_type;
    }

    [[nodiscard]] std::string& get_extension() noexcept
    {
        return m_extension;
    }

    [[nodiscard]] const std::string& get_extension() const noexcept
    {
        return m_extension;
    }

    [[nodiscard]] std::string& get_default_uri() noexcept
    {
        return m_default_uri;
    }

    [[nodiscard]] const std::string& get_default_uri() const noexcept
    {
        return m_default_uri;
    }

    [[nodiscard]] std::string& get_default_name() noexcept
    {
        return m_default_name;
    }

    [[nodiscard]] const std::string& get_default_name() const noexcept
    {
        return m_default_name;
    }

    [[nodiscard]] bool is_calendar() const noexcept
    {
        return m_name == "calendar";
    }

    [[nodiscard]] static Kind calendar()
    {
        return Kind{
            "calendar",
            "/remote.php/dav/calendars",
            "text/calendar",
            ".ics",
            "personal",
            "Personal"
        };
    }

    [[nodiscard]] static Kind addressbook()
    {
        return Kind{
            "addressbook",
            "/remote.php/dav/addressbooks/users",
            "text/vcard",
            ".vcf",
            "contacts",
            "Contacts"
        };
    }

private:
    std::string m_name{};
    std::string m_base{};
    std::string m_content_type{};
    std::string m_extension{};
    std::string m_default_uri{};
    std::string m_default_name{};
};

/// @brief Checks the text of a calendar object (iCalendar, RFC 5545) or a contact (vCard, RFC 6350)
/// well enough to refuse what would break a client; returns the reason, empty when fine.
[[nodiscard]] std::string
validate_object(const Kind& kind, std::string_view data, std::size_t max_size);

/// @brief True for a name that can be a collection or object URI.
[[nodiscard]] bool valid_uri(std::string_view uri) noexcept;

/// @brief The `DTSTART` of the first component as `YYYYMMDDTHHMMSS` (UTC letters are dropped),
/// empty when there is none. For the time range filter of calendar queries.
[[nodiscard]] std::string first_start(std::string_view calendar);

/// @brief The CalDAV/CardDAV server for one kind, over the database plugin: collections and objects
/// in two tables, WebDAV verbs PROPFIND, REPORT (multiget and query), MKCOL/MKCALENDAR, PUT, GET,
/// DELETE, PROPPATCH (display name). Counterpart of `apps/dav/lib/CalDAV` and
/// `apps/dav/lib/CardDAV`.
class CollectionServer
{
public:
    CollectionServer(Kind kind, nc::Host* host, std::size_t max_size) noexcept :
        m_kind{std::move(kind)},
        m_host{host},
        m_max_size{max_size}
    {
    }

    /// @brief Creates the tables (shared by both kinds) and registers the routes.
    void install(nc::Host& host);

    [[nodiscard]] const Kind& get_kind() const noexcept
    {
        return m_kind;
    }

private:
    [[nodiscard]] nc::http::Response
    serve(const nc::http::Request& request, int depth_of_path) const;
    [[nodiscard]] std::string home_href(std::string_view user) const;

    // ---- scheduling (calendars only)
    // -------------------------------------------------------------
    /// After `actor` stored `data` (replacing `previous`, empty when new): invitations to the
    /// attendees when the actor organizes the event, a reply to the organizer when the actor is an
    /// attendee who changed their answer.
    void schedule_after_put(
        const std::string& actor,
        const std::string& previous,
        const std::string& data
    ) const;
    /// After `actor` deleted the event `previous`: cancellations, or a decline.
    void schedule_after_delete(const std::string& actor, const std::string& previous) const;
    /// Puts an iTIP message in the inbox of the account with this address, or mails it to an
    /// address that is not an account here. True when it reached an account.
    bool deliver(
        const std::string& email,
        const std::string& method,
        const std::string& summary,
        const std::string& uid,
        const std::string& message,
        const std::string& tag
    ) const;

    Kind m_kind{};
    nc::Host* m_host{nullptr};
    std::size_t m_max_size{1'048'576};
};

} // namespace nc::davobjects
