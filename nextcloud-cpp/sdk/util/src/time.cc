#include "nextcloud/util/time.h"

#include <cstdio>
#include <ctime>

namespace nc::util {

namespace {

    std::string format(std::chrono::system_clock::time_point point, const char* pattern)
    {
        const std::time_t seconds = std::chrono::system_clock::to_time_t(point);
        std::tm parts{};
        gmtime_r(&seconds, &parts);
        char buffer[64];
        const std::size_t written = std::strftime(buffer, sizeof(buffer), pattern, &parts);
        return std::string(buffer, written);
    }

} // namespace

std::string http_date(std::chrono::system_clock::time_point point)
{
    return format(point, "%a, %d %b %Y %H:%M:%S GMT");
}

std::string mail_date(std::chrono::system_clock::time_point point)
{
    return format(point, "%a, %d %b %Y %H:%M:%S +0000");
}

namespace {

    /// Days from 1970-01-01 to the civil date (proleptic Gregorian), after Howard Hinnant.
    std::int64_t days_from_civil(std::int64_t year, unsigned month, unsigned day) noexcept
    {
        year -= month <= 2 ? 1 : 0;
        const std::int64_t era = (year >= 0 ? year : year - 399) / 400;
        const auto year_of_era = static_cast<unsigned>(year - era * 400);
        const unsigned day_of_year = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
        const unsigned day_of_era =
            year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
        return era * 146'097 + static_cast<std::int64_t>(day_of_era) - 719'468;
    }

    void
    civil_from_days(std::int64_t days, std::int64_t& year, unsigned& month, unsigned& day) noexcept
    {
        days += 719'468;
        const std::int64_t era = (days >= 0 ? days : days - 146'096) / 146'097;
        const auto day_of_era = static_cast<unsigned>(days - era * 146'097);
        const unsigned year_of_era =
            (day_of_era - day_of_era / 1'460 + day_of_era / 36'524 - day_of_era / 146'096) / 365;
        year = static_cast<std::int64_t>(year_of_era) + era * 400;
        const unsigned day_of_year =
            day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        const unsigned shifted = (5 * day_of_year + 2) / 153;
        day = day_of_year - (153 * shifted + 2) / 5 + 1;
        month = shifted < 10 ? shifted + 3 : shifted - 9;
        year += month <= 2 ? 1 : 0;
    }

    bool leap_year(std::int64_t year) noexcept
    {
        return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    }

    /// `count` digits at the start of `text`, removed from it; nullopt when they are not digits.
    std::optional<unsigned> digits(std::string_view& text, std::size_t count) noexcept
    {
        if (text.size() < count) {
            return std::nullopt;
        }
        unsigned value = 0;
        for (std::size_t index = 0; index < count; ++index) {
            if (text[index] < '0' || text[index] > '9') {
                return std::nullopt;
            }
            value = value * 10 + static_cast<unsigned>(text[index] - '0');
        }
        text.remove_prefix(count);
        return value;
    }

    bool take(std::string_view& text, char letter) noexcept
    {
        if (text.empty() || text.front() != letter) {
            return false;
        }
        text.remove_prefix(1);
        return true;
    }

} // namespace

std::optional<std::int64_t> parse_iso8601(std::string_view text)
{
    const auto year = digits(text, 4);
    if (!year || !take(text, '-')) {
        return std::nullopt;
    }
    const auto month = digits(text, 2);
    if (!month || !take(text, '-')) {
        return std::nullopt;
    }
    const auto day = digits(text, 2);
    if (!day || !(take(text, 'T') || take(text, 't') || take(text, ' '))) {
        return std::nullopt;
    }
    const auto hour = digits(text, 2);
    if (!hour || !take(text, ':')) {
        return std::nullopt;
    }
    const auto minute = digits(text, 2);
    if (!minute || !take(text, ':')) {
        return std::nullopt;
    }
    const auto second = digits(text, 2);
    if (!second) {
        return std::nullopt;
    }
    // Fractions of a second are accepted and dropped.
    if (take(text, '.')) {
        std::size_t used = 0;
        while (used < text.size() && text[used] >= '0' && text[used] <= '9') {
            ++used;
        }
        if (used == 0 || used > 9) {
            return std::nullopt;
        }
        text.remove_prefix(used);
    }
    std::int64_t offset = 0;
    if (!take(text, 'Z') && !take(text, 'z')) {
        const bool negative = !text.empty() && text.front() == '-';
        if (!take(text, '+') && !take(text, '-')) {
            return std::nullopt;
        }
        const auto offset_hours = digits(text, 2);
        take(text, ':');
        const auto offset_minutes = digits(text, 2);
        if (!offset_hours || !offset_minutes || *offset_hours > 23 || *offset_minutes > 59) {
            return std::nullopt;
        }
        offset = (static_cast<std::int64_t>(*offset_hours) * 60 + *offset_minutes) * 60;
        offset = negative ? -offset : offset;
    }
    if (!text.empty() || *month < 1 || *month > 12 || *day < 1 || *hour > 23 || *minute > 59 ||
        *second > 59) {
        return std::nullopt;
    }
    constexpr unsigned DAYS[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    const unsigned most = *month == 2 && leap_year(*year) ? 29 : DAYS[*month - 1];
    if (*day > most) {
        return std::nullopt;
    }
    return days_from_civil(*year, *month, *day) * 86'400 +
           static_cast<std::int64_t>(*hour) * 3'600 + static_cast<std::int64_t>(*minute) * 60 +
           *second - offset;
}

std::string format_atom(std::int64_t seconds)
{
    const std::int64_t days = seconds >= 0 ? seconds / 86'400 : -((-seconds + 86'399) / 86'400);
    const auto in_day = static_cast<unsigned>(seconds - days * 86'400);
    std::int64_t year = 0;
    unsigned month = 0;
    unsigned day = 0;
    civil_from_days(days, year, month, day);
    char text[40];
    std::snprintf(
        text,
        sizeof(text),
        "%04lld-%02u-%02uT%02u:%02u:%02u+00:00",
        static_cast<long long>(year),
        month,
        day,
        in_day / 3'600,
        in_day % 3'600 / 60,
        in_day % 60
    );
    return text;
}

} // namespace nc::util
