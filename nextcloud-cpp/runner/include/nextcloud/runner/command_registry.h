#pragma once

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

#include "nextcloud/runner/error.h"

namespace nc {

/// @brief One `occ` command: its name, what it does, and who provides it.
class CommandInfo
{
public:
    CommandInfo() noexcept = default;

    CommandInfo(std::string&& name, std::string&& description) noexcept
        : m_name{std::move(name)},
          m_description{std::move(description)}
    {
    }

    CommandInfo(std::string&& name, std::string&& description, std::string&& owner) noexcept
        : m_name{std::move(name)},
          m_description{std::move(description)},
          m_owner{std::move(owner)}
    {
    }

    void set_name(std::string&& name) noexcept { m_name = std::move(name); }
    void set_description(std::string&& description) noexcept { m_description = std::move(description); }
    void set_owner(std::string&& owner) noexcept { m_owner = std::move(owner); }

    [[nodiscard]] std::string& get_name() noexcept { return m_name; }
    [[nodiscard]] const std::string& get_name() const noexcept { return m_name; }
    [[nodiscard]] std::string& get_description() noexcept { return m_description; }
    [[nodiscard]] const std::string& get_description() const noexcept { return m_description; }
    [[nodiscard]] std::string& get_owner() noexcept { return m_owner; }
    [[nodiscard]] const std::string& get_owner() const noexcept { return m_owner; }

private:
    std::string m_name{};
    std::string m_description{};
    std::string m_owner{};
};

/// @brief The command line of the runner, the counterpart of Nextcloud's `occ`. Commands are named
/// `group:action` (`user:add`) and are added by the runner itself and by plugins.
class CommandRegistry
{
public:
    /// Writes its output to `out` and returns the exit code.
    using Handler = std::function<int(const std::vector<std::string>& args, std::string& out)>;

    CommandRegistry() noexcept = default;

    Result<void> add(CommandInfo&& info, Handler&& handler);
    void remove_owner(std::string_view owner);

    /// @brief Runs `name`; exit code 127 and a message in `out` when the command is unknown.
    [[nodiscard]] int run(std::string_view name, const std::vector<std::string>& args, std::string& out) const;

    [[nodiscard]] std::vector<CommandInfo> list() const;

private:
    struct Entry
    {
        CommandInfo info{};
        std::shared_ptr<const Handler> handler{};
    };

    mutable std::mutex m_mutex{};
    std::map<std::string, Entry, std::less<>> m_entries{};
};

}  // namespace nc
