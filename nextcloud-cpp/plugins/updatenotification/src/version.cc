#include "version.h"

#include <algorithm>

namespace nc::update {

std::optional<std::vector<unsigned long>> parse_version(std::string_view text)
{
    if (text.empty() || text.size() > 40) {
        return std::nullopt;
    }
    std::vector<unsigned long> parts;
    unsigned long current = 0;
    std::size_t digits = 0;
    for (const char letter: text) {
        if (letter >= '0' && letter <= '9') {
            current = current * 10 + static_cast<unsigned long>(letter - '0');
            if (++digits > 6) {
                return std::nullopt;
            }
        } else if (letter == '.' && digits > 0) {
            parts.push_back(current);
            current = 0;
            digits = 0;
        } else {
            return std::nullopt;
        }
    }
    if (digits == 0 || parts.size() >= 4) {
        return std::nullopt;
    }
    parts.push_back(current);
    return parts;
}

bool is_newer(std::string_view candidate, std::string_view current)
{
    const auto left = parse_version(candidate);
    const auto right = parse_version(current);
    if (!left || !right) {
        return false;
    }
    const std::size_t count = std::max(left->size(), right->size());
    for (std::size_t index = 0; index < count; ++index) {
        const unsigned long a = index < left->size() ? (*left)[index] : 0;
        const unsigned long b = index < right->size() ? (*right)[index] : 0;
        if (a != b) {
            return a > b;
        }
    }
    return false;
}

} // namespace nc::update
