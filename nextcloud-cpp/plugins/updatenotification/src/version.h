#pragma once

#include <optional>
#include <string_view>
#include <vector>

namespace nc::update {

/// @brief `major.minor.patch[.build]`, numbers only (a suffix such as `-beta1` is refused).
[[nodiscard]] std::optional<std::vector<unsigned long>> parse_version(std::string_view text);

/// @brief True when `candidate` is newer than `current`; missing parts count as 0.
[[nodiscard]] bool is_newer(std::string_view candidate, std::string_view current);

} // namespace nc::update
