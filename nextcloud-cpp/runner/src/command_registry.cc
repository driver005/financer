#include "nextcloud/runner/command_registry.h"

namespace nc {

Result<void> CommandRegistry::add(CommandInfo&& info, Handler&& handler)
{
    const std::lock_guard lock{m_mutex};
    const std::string name = info.get_name();
    if (m_entries.find(name) != m_entries.end()) {
        return fail(ErrorCode::ALREADY_EXISTS, "command " + name + " already exists");
    }
    m_entries.emplace(name, Entry{std::move(info), std::make_shared<const Handler>(std::move(handler))});
    return {};
}

void CommandRegistry::remove_owner(std::string_view owner)
{
    const std::lock_guard lock{m_mutex};
    std::erase_if(m_entries, [owner](const auto& item) { return item.second.info.get_owner() == owner; });
}

int CommandRegistry::run(std::string_view name, const std::vector<std::string>& args, std::string& out) const
{
    std::shared_ptr<const Handler> handler;
    {
        const std::lock_guard lock{m_mutex};
        const auto found = m_entries.find(name);
        if (found == m_entries.end()) {
            out = "Command \"" + std::string(name) + "\" is not defined.\n";
            return 127;
        }
        handler = found->second.handler;
    }
    try {
        return (*handler)(args, out);
    } catch (const std::exception& error) {
        out += std::string("error: ") + error.what() + "\n";
        return 1;
    }
}

std::vector<CommandInfo> CommandRegistry::list() const
{
    const std::lock_guard lock{m_mutex};
    std::vector<CommandInfo> infos;
    for (const auto& [name, entry] : m_entries) {
        infos.push_back(entry.info);
    }
    return infos;
}

}  // namespace nc
