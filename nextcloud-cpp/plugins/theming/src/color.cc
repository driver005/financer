#include "color.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace nc::theming {

namespace {

    int hex_digit(char letter) noexcept
    {
        if (letter >= '0' && letter <= '9') {
            return letter - '0';
        }
        if (letter >= 'a' && letter <= 'f') {
            return letter - 'a' + 10;
        }
        if (letter >= 'A' && letter <= 'F') {
            return letter - 'A' + 10;
        }
        return -1;
    }

    double linear(int channel) noexcept
    {
        const double value = channel / 255.0;
        return value <= 0.03928 ? value / 12.92 : std::pow((value + 0.055) / 1.055, 2.4);
    }

} // namespace

std::optional<Rgb> parse_hex_color(std::string_view text) noexcept
{
    if ((text.size() != 7 && text.size() != 4) || text.front() != '#') {
        return std::nullopt;
    }
    text.remove_prefix(1);
    int digits[6] = {};
    for (std::size_t index = 0; index < text.size(); ++index) {
        digits[index] = hex_digit(text[index]);
        if (digits[index] < 0) {
            return std::nullopt;
        }
    }
    if (text.size() == 3) {
        return Rgb{digits[0] * 17, digits[1] * 17, digits[2] * 17};
    }
    return Rgb{digits[0] * 16 + digits[1], digits[2] * 16 + digits[3], digits[4] * 16 + digits[5]};
}

std::string to_hex(const Rgb& color)
{
    char buffer[8];
    std::snprintf(buffer, sizeof(buffer), "#%02x%02x%02x", color.red, color.green, color.blue);
    return buffer;
}

double relative_luminance(const Rgb& color) noexcept
{
    return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue);
}

std::string readable_text_color(const Rgb& background)
{
    // Contrast against white is (1.05) / (L + 0.05); against black it is (L + 0.05) / 0.05.
    const double luminance = relative_luminance(background);
    return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#000000";
}

Rgb mix(const Rgb& color, const Rgb& other, double amount) noexcept
{
    amount = std::clamp(amount, 0.0, 1.0);
    const auto channel = [&](int from, int to)
    {
        return static_cast<int>(std::lround(from + (to - from) * amount));
    };
    return Rgb{
        channel(color.red, other.red),
        channel(color.green, other.green),
        channel(color.blue, other.blue)
    };
}

} // namespace nc::theming
