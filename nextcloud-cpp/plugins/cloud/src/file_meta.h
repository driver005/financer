#pragma once

#include "nextcloud/plugin.h"

#include <cstdint>
#include <string>
#include <vector>

/// What a client wants to know about a file besides its bytes and that a path cannot say: a number
/// that stays the same when the file is renamed or moved (`oc:fileid`, which sync clients use to
/// tell a move from a delete and a new file), and whether the person marked it as a favorite.
/// Numbers are made the first time they are asked for, so files that arrived any other way (the
/// command line, another plugin) get one too; a rename or delete done through WebDAV is followed.
/// Only a user's own files have them (not a received share, not an external storage).
namespace nc::cloud {

class FileMeta
{
public:
    explicit FileMeta(nc::Host* host) noexcept :
        m_host{host}
    {
    }

    void migrate() const;

    /// @brief The number of `path` (normalized, "/" for the root), made on first use.
    [[nodiscard]] std::int64_t id_of(const std::string& user, const std::string& path) const;

    /// @brief `from` (and everything below it) is now `to`; whatever was at `to` is gone.
    void moved(const std::string& user, const std::string& from, const std::string& to) const;

    /// @brief `path` (and everything below it) is gone.
    void removed(const std::string& user, const std::string& path) const;

    /// @brief Forgets a user.
    void forget(const std::string& user) const;

    void set_favorite(const std::string& user, const std::string& path, bool favorite) const;
    [[nodiscard]] bool is_favorite(const std::string& user, const std::string& path) const;

    /// @brief The path with this number, empty when there is none.
    [[nodiscard]] std::string path_of(const std::string& user, std::int64_t id) const;

    /// @brief Keeps the checksum a client sent with an upload (`SHA1:<hex>`), for the file as it
    /// was then (size and modification time). An empty `checksum` forgets it.
    void set_checksum(
        const std::string& user,
        const std::string& path,
        const std::string& checksum,
        std::uint64_t size,
        std::int64_t mtime
    ) const;

    /// @brief The kept checksum, but only while the file still has that size and modification
    /// time (a file changed some other way has none); empty when there is none.
    [[nodiscard]] std::string checksum_of(
        const std::string& user,
        const std::string& path,
        std::uint64_t size,
        std::int64_t mtime
    ) const;

    /// @brief The favorite paths of a user.
    [[nodiscard]] std::vector<std::string> favorites(const std::string& user) const;

private:
    nc::Host* m_host;
};

} // namespace nc::cloud
