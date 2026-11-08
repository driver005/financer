#pragma once

#include <chrono>
#include <string>

namespace nc::util {

/// @brief "Sun, 06 Nov 1994 08:49:37 GMT", the format of HTTP `Date` and DAV `getlastmodified`.
[[nodiscard]] std::string http_date(std::chrono::system_clock::time_point point);

/// @brief "Sun, 06 Nov 1994 08:49:37 +0000", the format of the mail `Date` header.
[[nodiscard]] std::string mail_date(std::chrono::system_clock::time_point point);

}  // namespace nc::util
