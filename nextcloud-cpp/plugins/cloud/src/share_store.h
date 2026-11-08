#pragma once

#include "nextcloud/util/expected.h"
#include "share.h"

#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace nc::cloud {

/// @brief The share database, the counterpart of `OC\Share20\Manager` + `oc_share`. One text file,
/// rewritten atomically on every change.
class ShareStore
{
public:
    using Error = std::string;
    template<typename Value> using Result = util::expected<Value, Error>;

    explicit ShareStore(std::string&& file) noexcept :
        m_file{std::move(file)}
    {
    }

    Result<void> load();

    /// @brief Adds a share; the id and, for links, the token are assigned here.
    Result<Share> add(Share&& share);
    Result<void> remove(std::uint64_t id);
    /// @brief Removes the shares of `owner` on `path` and everything below it; returns how many.
    std::size_t remove_under(std::string_view owner, std::string_view path);
    /// @brief Removes every share the user owns or received; returns how many.
    std::size_t remove_user(std::string_view user);
    /// @brief Moves the shares on `from` (and below) to `to`.
    void rename_under(std::string_view owner, std::string_view from, std::string_view to);
    std::size_t prune_expired(std::int64_t now);

    [[nodiscard]] std::optional<Share> find(std::uint64_t id) const;
    [[nodiscard]] std::optional<Share> find_by_token(std::string_view token) const;
    [[nodiscard]] std::vector<Share> owned_by(std::string_view owner) const;
    [[nodiscard]] std::vector<Share> shared_with(std::string_view user) const;
    [[nodiscard]] std::vector<Share> all() const;

private:
    [[nodiscard]] Result<void> save_locked() const;

    std::string m_file{};
    mutable std::mutex m_mutex{};
    std::vector<Share> m_shares{};
    std::uint64_t m_next_id{1};
};

} // namespace nc::cloud
