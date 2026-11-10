#pragma once

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace nc::util {

/// @brief "Sun, 06 Nov 1994 08:49:37 GMT", the format of HTTP `Date` and DAV `getlastmodified`.
[[nodiscard]] std::string http_date(std::chrono::system_clock::time_point point);

/// @brief "Sun, 06 Nov 1994 08:49:37 +0000", the format of the mail `Date` header.
[[nodiscard]] std::string mail_date(std::chrono::system_clock::time_point point);

/// @brief A time as ISO 8601 / RFC 3339 writes it: `2026-11-12T10:30:00Z`,
/// `2026-11-12T10:30:00.5+01:00` (a space may stand for the `T`; `+0100` is read too). Seconds
/// since 1970 in UTC; nullopt for anything else, a date that does not exist (`02-30`) or a leap
/// second.
[[nodiscard]] std::optional<std::int64_t> parse_iso8601(std::string_view text);

/// @brief Seconds since 1970 as `2026-11-12T10:30:00+00:00` (PHP's `DATE_ATOM`).
[[nodiscard]] std::string format_atom(std::int64_t seconds);

} // namespace nc::util
