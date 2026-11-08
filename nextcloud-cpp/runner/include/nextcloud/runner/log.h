#pragma once

#include "nextcloud/plugin.h"

#include <functional>
#include <mutex>
#include <string>
#include <string_view>

namespace nc {

/// @brief The runner's log. Plugins log through the host, so every line carries its source.
class Logger
{
public:
    using Sink =
        std::function<void(LogLevel level, std::string_view source, std::string_view message)>;

    /// @brief Logs to stderr at INFO and above.
    Logger();

    /// @brief Replaces where lines go (tests capture them); an empty sink silences the log.
    void set_sink(Sink&& sink);
    void set_level(LogLevel level) noexcept;

    [[nodiscard]] LogLevel get_level() const noexcept;

    void log(LogLevel level, std::string_view source, std::string_view message) const;

    [[nodiscard]] static std::string_view level_name(LogLevel level) noexcept;
    [[nodiscard]] static LogLevel parse_level(std::string_view name) noexcept;

private:
    mutable std::mutex m_mutex{};
    LogLevel m_level{LogLevel::INFO};
    Sink m_sink{};
};

} // namespace nc
