#pragma once

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>

#include "nextcloud/http.h"
#include "nextcloud/runner/error.h"

namespace nc {

/// @brief Named services plugins offer each other, the counterpart of Nextcloud's server container
/// (`OCP\IServerContainer`): a plugin asks for `users.authenticate`, it does not know who provides it.
class ServiceRegistry
{
public:
    using Handler = std::function<http::Response(std::string_view args)>;

    ServiceRegistry() noexcept = default;

    Result<void> add(std::string_view name, std::string_view owner, Handler&& handler);
    void remove_owner(std::string_view owner);

    /// @brief Calls the service; 404 when nobody offers `name`.
    [[nodiscard]] http::Response call(std::string_view name, std::string_view args) const;

    [[nodiscard]] bool contains(std::string_view name) const;
    [[nodiscard]] std::size_t size() const noexcept;

private:
    struct Entry
    {
        std::string owner{};
        std::shared_ptr<const Handler> handler{};
    };

    mutable std::mutex m_mutex{};
    std::map<std::string, Entry, std::less<>> m_entries{};
};

}  // namespace nc
