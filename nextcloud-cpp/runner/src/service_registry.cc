#include "nextcloud/runner/service_registry.h"

namespace nc {

Result<void> ServiceRegistry::add(std::string_view name, std::string_view owner, Handler&& handler)
{
    const std::lock_guard lock{m_mutex};
    const auto found = m_entries.find(name);
    if (found != m_entries.end()) {
        return fail(ErrorCode::ALREADY_EXISTS, "service " + std::string(name) + " is already offered by " + found->second.owner);
    }
    m_entries.emplace(
        std::string{name},
        Entry{std::string{owner}, std::make_shared<const Handler>(std::move(handler))}
    );
    return {};
}

void ServiceRegistry::remove_owner(std::string_view owner)
{
    const std::lock_guard lock{m_mutex};
    std::erase_if(m_entries, [owner](const auto& item) { return item.second.owner == owner; });
}

http::Response ServiceRegistry::call(std::string_view name, std::string_view args) const
{
    std::shared_ptr<const Handler> handler;
    {
        const std::lock_guard lock{m_mutex};
        const auto found = m_entries.find(name);
        if (found == m_entries.end()) {
            return http::Response::text(404, "no service " + std::string(name));
        }
        handler = found->second.handler;
    }
    try {
        return (*handler)(args);
    } catch (const std::exception& error) {
        return http::Response::text(500, error.what());
    }
}

bool ServiceRegistry::contains(std::string_view name) const
{
    const std::lock_guard lock{m_mutex};
    return m_entries.find(name) != m_entries.end();
}

std::size_t ServiceRegistry::size() const noexcept
{
    const std::lock_guard lock{m_mutex};
    return m_entries.size();
}

}  // namespace nc
