#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace nc::util {

/// @brief Lower-cases ASCII letters; the rest is copied untouched.
[[nodiscard]] std::string to_lower(std::string_view text);

/// @brief Case-insensitive ASCII comparison.
[[nodiscard]] bool equals_ignore_case(std::string_view left, std::string_view right) noexcept;

/// @brief Splits on `separator`; keeps empty parts so "a//b" gives three parts.
[[nodiscard]] std::vector<std::string> split(std::string_view text, char separator);

/// @brief Removes leading and trailing ASCII whitespace.
[[nodiscard]] std::string_view trim(std::string_view text) noexcept;

[[nodiscard]] bool starts_with(std::string_view text, std::string_view prefix) noexcept;

/// @brief Percent-decodes (`%20`, and `+` as space when `plus_is_space`). Bad escapes are kept as is.
[[nodiscard]] std::string url_decode(std::string_view text, bool plus_is_space = false);

/// @brief Percent-encodes everything except unreserved characters and `/`.
[[nodiscard]] std::string url_encode_path(std::string_view text);

/// @brief Escapes the five XML special characters.
[[nodiscard]] std::string xml_escape(std::string_view text);

/// @brief Escapes a string for use inside a JSON string literal (no surrounding quotes).
[[nodiscard]] std::string json_escape(std::string_view text);

}  // namespace nc::util
