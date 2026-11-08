#pragma once

#include <string>
#include <utility>
#include <vector>

namespace nc {

enum class PluginState
{
    /// Found, not started yet.
    DISCOVERED,
    /// Started; its routes, services and commands are live.
    RUNNING,
    /// `load` failed or the library is unusable; see the error.
    FAILED,
    /// Not started because it is disabled or something it requires is not running.
    SKIPPED,
    STOPPED
};

/// @brief What the runner knows about one plugin, for `occ plugin:list` and `status.php`.
class PluginInfo
{
public:
    PluginInfo() noexcept = default;

    PluginInfo(std::string&& name, std::string&& version) noexcept
        : m_name{std::move(name)},
          m_version{std::move(version)}
    {
    }

    PluginInfo(
        std::string&& name,
        std::string&& version,
        std::string&& description,
        std::string&& path,
        std::vector<std::string>&& requires_plugins,
        PluginState state,
        std::string&& error
    ) noexcept
        : m_name{std::move(name)},
          m_version{std::move(version)},
          m_description{std::move(description)},
          m_path{std::move(path)},
          m_requires{std::move(requires_plugins)},
          m_state{state},
          m_error{std::move(error)}
    {
    }

    PluginInfo& add_requires(std::string&& name)
    {
        m_requires.push_back(std::move(name));
        return *this;
    }

    void set_name(std::string&& name) noexcept { m_name = std::move(name); }
    void set_version(std::string&& version) noexcept { m_version = std::move(version); }
    void set_description(std::string&& description) noexcept { m_description = std::move(description); }
    void set_path(std::string&& path) noexcept { m_path = std::move(path); }
    void set_requires(std::vector<std::string>&& names) noexcept { m_requires = std::move(names); }
    void set_state(PluginState state) noexcept { m_state = state; }
    void set_error(std::string&& error) noexcept { m_error = std::move(error); }

    [[nodiscard]] std::string& get_name() noexcept { return m_name; }
    [[nodiscard]] const std::string& get_name() const noexcept { return m_name; }
    [[nodiscard]] std::string& get_version() noexcept { return m_version; }
    [[nodiscard]] const std::string& get_version() const noexcept { return m_version; }
    [[nodiscard]] std::string& get_description() noexcept { return m_description; }
    [[nodiscard]] const std::string& get_description() const noexcept { return m_description; }
    [[nodiscard]] std::string& get_path() noexcept { return m_path; }
    [[nodiscard]] const std::string& get_path() const noexcept { return m_path; }
    [[nodiscard]] std::vector<std::string>& get_requires() noexcept { return m_requires; }
    [[nodiscard]] const std::vector<std::string>& get_requires() const noexcept { return m_requires; }
    [[nodiscard]] PluginState get_state() const noexcept { return m_state; }
    [[nodiscard]] std::string& get_error() noexcept { return m_error; }
    [[nodiscard]] const std::string& get_error() const noexcept { return m_error; }

    [[nodiscard]] static const char* state_name(PluginState state) noexcept
    {
        switch (state) {
            case PluginState::DISCOVERED:
                return "discovered";
            case PluginState::RUNNING:
                return "running";
            case PluginState::FAILED:
                return "failed";
            case PluginState::SKIPPED:
                return "skipped";
            case PluginState::STOPPED:
                return "stopped";
        }
        return "unknown";
    }

private:
    std::string m_name{};
    std::string m_version{};
    std::string m_description{};
    std::string m_path{};
    std::vector<std::string> m_requires{};
    PluginState m_state{PluginState::DISCOVERED};
    std::string m_error{};
};

}  // namespace nc
