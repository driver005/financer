#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace nc::theming {

struct Rgb
{
    int red{0};
    int green{0};
    int blue{0};
};

/// @brief `#rrggbb` (or `#rgb`), nothing else.
[[nodiscard]] std::optional<Rgb> parse_hex_color(std::string_view text) noexcept;

[[nodiscard]] std::string to_hex(const Rgb& color);

/// @brief WCAG relative luminance, 0 (black) to 1 (white).
[[nodiscard]] double relative_luminance(const Rgb& color) noexcept;

/// @brief The text colour with the better contrast on `background`: `#ffffff` or `#000000`.
[[nodiscard]] std::string readable_text_color(const Rgb& background);

/// @brief `color` mixed with `other` by `amount` (0 keeps `color`, 1 gives `other`).
[[nodiscard]] Rgb mix(const Rgb& color, const Rgb& other, double amount) noexcept;

} // namespace nc::theming
