#include "nextcloud/runner/log.h"

#include "nextcloud/util/text.h"

#include <chrono>
#include <cstdio>
#include <ctime>

namespace nc {

Logger::Logger() :
    m_sink{[](LogLevel level, std::string_view source, std::string_view message)
           {
               const std::time_t now =
                   std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
               std::tm parts{};
               gmtime_r(&now, &parts);
               char stamp[32];
               std::strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &parts);
               std::fprintf(
                   stderr,
                   "%s [%s] %.*s: %.*s\n",
                   stamp,
                   std::string(level_name(level)).c_str(),
                   static_cast<int>(source.size()),
                   source.data(),
                   static_cast<int>(message.size()),
                   message.data()
               );
           }}
{
}

void Logger::set_sink(Sink&& sink)
{
    const std::lock_guard lock{m_mutex};
    m_sink = std::move(sink);
}

void Logger::set_level(LogLevel level) noexcept
{
    const std::lock_guard lock{m_mutex};
    m_level = level;
}

LogLevel Logger::get_level() const noexcept
{
    const std::lock_guard lock{m_mutex};
    return m_level;
}

void Logger::log(LogLevel level, std::string_view source, std::string_view message) const
{
    const std::lock_guard lock{m_mutex};
    if (static_cast<int>(level) < static_cast<int>(m_level) || !m_sink) {
        return;
    }
    m_sink(level, source, message);
}

std::string_view Logger::level_name(LogLevel level) noexcept
{
    switch (level) {
        case LogLevel::DEBUG:
            return "debug";
        case LogLevel::INFO:
            return "info";
        case LogLevel::WARNING:
            return "warning";
        case LogLevel::ERROR:
            return "error";
        case LogLevel::FATAL:
            return "fatal";
    }
    return "info";
}

LogLevel Logger::parse_level(std::string_view name) noexcept
{
    for (const LogLevel level:
         {LogLevel::DEBUG, LogLevel::INFO, LogLevel::WARNING, LogLevel::ERROR, LogLevel::FATAL}) {
        if (util::equals_ignore_case(name, level_name(level))) {
            return level;
        }
    }
    return LogLevel::INFO;
}

} // namespace nc
