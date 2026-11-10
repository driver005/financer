#pragma once

#include "nextcloud/plugin.h"

#include <cstdint>
#include <string>
#include <vector>

/// WebDAV write locks (RFC 4918): what `LOCK` hands out so that desktop clients (Finder, Office,
/// davfs) can keep others from changing a file they have open. Only exclusive write locks exist.
namespace nc::cloud {

struct DavLock
{
    std::string token{};
    /// Normalized path of the locked file or folder.
    std::string path{};
    /// What the client said about itself, shown to others.
    std::string owner{};
    /// A folder lock reaches everything below it.
    bool infinite{false};
    /// Seconds since the epoch.
    std::int64_t expires{0};
};

class DavLocks
{
public:
    explicit DavLocks(nc::Host* host) noexcept :
        m_host{host}
    {
    }

    void migrate() const;

    /// @brief The locks of a user's files that have not run out.
    [[nodiscard]] std::vector<DavLock> of(const std::string& user, std::int64_t now) const;

    void add(const std::string& user, const DavLock& lock) const;

    /// @brief Gives a lock more time; false when this user has no such lock.
    [[nodiscard]] bool refresh(
        const std::string& user,
        const std::string& token,
        std::int64_t expires,
        std::int64_t now
    ) const;

    /// @brief Ends a lock; false when this user has no such lock.
    [[nodiscard]] bool remove(const std::string& user, const std::string& token) const;

    /// @brief The locks on `path` and below it are gone with it.
    void removed(const std::string& user, const std::string& path) const;

    void forget(const std::string& user) const;

private:
    nc::Host* m_host;
};

} // namespace nc::cloud
