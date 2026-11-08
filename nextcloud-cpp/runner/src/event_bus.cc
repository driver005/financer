#include "nextcloud/runner/event_bus.h"

#include <algorithm>

namespace nc {

bool EventBus::matches(std::string_view pattern, std::string_view topic) noexcept
{
    if (!pattern.empty() && pattern.back() == '*') {
        pattern.remove_suffix(1);
        return topic.substr(0, pattern.size()) == pattern;
    }
    return pattern == topic;
}

void EventBus::subscribe(std::string_view topic, std::string_view owner, Handler&& handler)
{
    const std::lock_guard lock{m_mutex};
    m_subscriptions.push_back(Subscription{std::string{topic}, std::string{owner}, std::move(handler)});
}

void EventBus::remove_owner(std::string_view owner)
{
    const std::lock_guard lock{m_mutex};
    std::erase_if(m_subscriptions, [owner](const Subscription& subscription) {
        return subscription.owner == owner;
    });
}

std::size_t EventBus::publish(std::string_view topic, std::string_view payload) const
{
    // Copy the matching handlers first: a handler may subscribe or publish without deadlocking.
    std::vector<std::pair<std::string, Handler>> matching;
    {
        const std::lock_guard lock{m_mutex};
        for (const Subscription& subscription : m_subscriptions) {
            if (matches(subscription.topic, topic)) {
                matching.emplace_back(subscription.owner, subscription.handler);
            }
        }
    }
    for (const auto& [owner, handler] : matching) {
        try {
            handler(topic, payload);
        } catch (const std::exception& error) {
            if (m_logger != nullptr) {
                m_logger->log(LogLevel::ERROR, owner, "event handler for " + std::string(topic) + " threw: " + error.what());
            }
        } catch (...) {
            if (m_logger != nullptr) {
                m_logger->log(LogLevel::ERROR, owner, "event handler for " + std::string(topic) + " threw");
            }
        }
    }
    return matching.size();
}

std::size_t EventBus::size() const noexcept
{
    const std::lock_guard lock{m_mutex};
    return m_subscriptions.size();
}

}  // namespace nc
