#pragma once

#include "nextcloud/util/expected.h"
#include "share.h"

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace nc::cloud {

/// @brief Where shares are kept. The cloud plugin stores them through the `db` plugin; tests use
/// `MemoryShareBackend`. Ids are assigned by the backend and never handed out twice.
class ShareBackend
{
public:
    using Error = std::string;
    template<typename Value> using Result = util::expected<Value, Error>;

    ShareBackend() noexcept = default;
    virtual ~ShareBackend() = default;
    ShareBackend(const ShareBackend&) = delete;
    ShareBackend& operator=(const ShareBackend&) = delete;
    ShareBackend(ShareBackend&&) = delete;
    ShareBackend& operator=(ShareBackend&&) = delete;

    virtual Result<std::vector<Share>> load() = 0;
    /// @brief Stores the share. With id 0 the backend assigns one and sets it; otherwise the id is
    /// kept (importing).
    virtual Result<void> insert(Share& share) = 0;
    virtual Result<void> update_path(std::uint64_t id, const std::string& path) = 0;
    virtual Result<void> erase(std::uint64_t id) = 0;
};

/// @brief Shares kept in memory. Copies made with `share_with` see the same data, which is how a
/// test restarts a store.
class MemoryShareBackend final : public ShareBackend
{
public:
    MemoryShareBackend() :
        m_state{std::make_shared<State>()}
    {
    }

    /// @brief Another backend over the same shares.
    [[nodiscard]] std::unique_ptr<MemoryShareBackend> share_with() const
    {
        auto other = std::make_unique<MemoryShareBackend>();
        other->m_state = m_state;
        return other;
    }

    Result<std::vector<Share>> load() override;
    Result<void> insert(Share& share) override;
    Result<void> update_path(std::uint64_t id, const std::string& path) override;
    Result<void> erase(std::uint64_t id) override;

private:
    struct State
    {
        std::vector<Share> shares{};
        std::uint64_t last_id{0};
    };

    std::shared_ptr<State> m_state{};
};

/// @brief The share database, the counterpart of `OC\Share20\Manager` + `oc_share`: every share in
/// memory for lookups, every change written through to the backend.
class ShareStore
{
public:
    using Error = std::string;
    template<typename Value> using Result = util::expected<Value, Error>;

    explicit ShareStore(std::unique_ptr<ShareBackend> backend) noexcept :
        m_backend{std::move(backend)}
    {
    }

    /// @brief Reads the old flat file `shares.db` of earlier versions: the shares in it, in file
    /// order.
    [[nodiscard]] static Result<std::vector<Share>> read_legacy_file(const std::string& file);

    /// @brief Takes shares over from another place (the legacy file), keeping their ids.
    Result<void> import_all(std::vector<Share>&& shares);

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
    /// Removes the shares `matches` accepts (the lock is held), from memory and the backend.
    template<typename Predicate> std::size_t erase_matching(Predicate&& matches);

    std::unique_ptr<ShareBackend> m_backend{};
    mutable std::mutex m_mutex{};
    std::vector<Share> m_shares{};
};

} // namespace nc::cloud
