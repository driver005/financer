#include "nextcloud/util/time.h"

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

} // namespace nc::util
