#pragma once

#include <string_view>

namespace nc::workflow {

/// @brief Shell-style matching of a whole text: `*` is any run of characters (also none, also `/`),
/// `?` is one character, everything else is itself. Case-sensitive. Linear in the product of the
/// two lengths at worst, never exponential.
[[nodiscard]] bool glob_matches(std::string_view pattern, std::string_view text) noexcept;

} // namespace nc::workflow
