#pragma once

#include <functional>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

#include "nextcloud/runner/log.h"

namespace nc {

/// @brief Synchronous publish/subscribe between plugins, the counterpart of Nextcloud's
/// `OCP\EventDispatcher\IEventDispatcher`. A subscription is an exact topic (`share.created`) or a
/// prefix ending in `*` (`share.*`). A handler that throws is logged and does not stop the others.
class EventBus
{
public:
    using Handler = std::function<void(std::string_view topic, std::string_view payload)>;

    explicit EventBus(const Logger* logger = nullptr) noexcept
        : m_logger{logger}
    {
    }

    /// @brief `owner` is the plugin name; `remove_owner` drops all its subscriptions on unload.
    void subscribe(std::string_view topic, std::string_view owner, Handler&& handler);
    void remove_owner(std::string_view owner);

    /// @brief Calls every matching handler in subscription order; returns how many ran.
    std::size_t publish(std::string_view topic, std::string_view payload) const;

    [[nodiscard]] std::size_t size() const noexcept;

    [[nodiscard]] static bool matches(std::string_view pattern, std::string_view topic) noexcept;

private:
    struct Subscription
    {
        std::string topic{};
        std::string owner{};
        Handler handler{};
    };

    const Logger* m_logger{nullptr};
    mutable std::mutex m_mutex{};
    std::vector<Subscription> m_subscriptions{};
};

}  // namespace nc
