#pragma once

#include <string>
#include <string_view>
#include <vector>

/// iTIP (RFC 5546) as far as the calendar server needs it: reading who organizes and who attends an
/// event, and writing the messages (REQUEST, CANCEL, REPLY) that go between them.
namespace nc::davobjects::itip {

struct Attendee
{
    std::string email{};    // lower case, without "mailto:"
    std::string partstat{}; // NEEDS-ACTION, ACCEPTED, DECLINED, TENTATIVE, ... (upper case)
};

struct Event
{
    bool valid{false};
    std::string uid{};
    std::string summary{};
    std::string organizer{}; // lower case e-mail address, empty when the event has no organizer
    std::vector<Attendee> attendees{};
    std::string sequence{"0"};
};

/// @brief RFC 5545 line folding undone, line ends normalized to CRLF.
[[nodiscard]] std::string unfold(std::string_view text);

/// @brief What the first VEVENT says about itself.
[[nodiscard]] Event parse(std::string_view calendar);

/// @brief The calendar with `METHOD:<method>` (an existing METHOD is replaced).
[[nodiscard]] std::string with_method(std::string_view calendar, std::string_view method);

/// @brief The calendar with `email`'s PARTSTAT changed (other attendees untouched).
[[nodiscard]] std::string
set_partstat(std::string_view calendar, std::string_view email, std::string_view partstat);

/// @brief The `METHOD:REPLY` an attendee sends: the event's identity, the organizer and that one
/// attendee with the new PARTSTAT.
[[nodiscard]] std::string
reply_for(std::string_view calendar, std::string_view email, std::string_view partstat);

/// @brief A name safe to use as an object URI, made from an event UID.
[[nodiscard]] std::string uri_for(std::string_view uid);

} // namespace nc::davobjects::itip
