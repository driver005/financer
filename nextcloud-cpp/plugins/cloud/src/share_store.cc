#include "share_store.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <chrono>
#include <fstream>

namespace nc::cloud {

namespace {

    bool under(std::string_view path, std::string_view base) noexcept
    {
        return path == base || (path.size() > base.size() && path.substr(0, base.size()) == base &&
                                path[base.size()] == '/');
    }

} // namespace

ShareBackend::Result<std::vector<Share>> MemoryShareBackend::load()
{
    return m_state->shares;
}

ShareBackend::Result<void> MemoryShareBackend::insert(Share& share)
{
    if (share.get_id() == 0) {
        share.set_id(++m_state->last_id);
    } else {
        m_state->last_id = std::max(m_state->last_id, share.get_id());
    }
    m_state->shares.push_back(share);
    return {};
}

ShareBackend::Result<void>
MemoryShareBackend::update_path(std::uint64_t id, const std::string& path)
{
    for (Share& share: m_state->shares) {
        if (share.get_id() == id) {
            share.set_path(std::string{path});
        }
    }
    return {};
}

ShareBackend::Result<void> MemoryShareBackend::erase(std::uint64_t id)
{
    std::erase_if(
        m_state->shares,
        [id](const Share& share)
        {
            return share.get_id() == id;
        }
    );
    return {};
}

ShareStore::Result<std::vector<Share>> ShareStore::read_legacy_file(const std::string& file)
{
    std::vector<Share> shares;
    std::ifstream stream{file};
    if (!stream) {
        return shares;
    }
    std::string line;
    std::size_t number = 0;
    while (std::getline(stream, line)) {
        ++number;
        if (line.empty()) {
            continue;
        }
        const std::vector<std::string> parts = util::split(line, '\t');
        if (parts.size() == 2 && parts[0] == "#next_id") {
            continue;
        }
        if (parts.size() != 9 && parts.size() != 10) {
            return util::unexpected<Error>{
                file + ":" + std::to_string(number) + ": damaged share line"
            };
        }
        Share share{
            std::strtoull(parts[0].c_str(), nullptr, 10),
            std::string{parts[1]},
            std::atoi(parts[2].c_str()),
            std::string{parts[3]},
            std::string{parts[4]},
            std::string{parts[5]},
            std::atoi(parts[6].c_str()),
            std::strtoll(parts[7].c_str(), nullptr, 10),
            std::strtoll(parts[8].c_str(), nullptr, 10)
        };
        if (parts.size() == 10) {
            share.set_password(std::string{parts[9]});
        }
        shares.push_back(std::move(share));
    }
    return shares;
}

ShareStore::Result<void> ShareStore::load()
{
    const std::lock_guard lock{m_mutex};
    auto loaded = m_backend->load();
    if (!loaded) {
        return util::unexpected<Error>{loaded.error()};
    }
    m_shares = std::move(*loaded);
    return {};
}

ShareStore::Result<void> ShareStore::import_all(std::vector<Share>&& shares)
{
    const std::lock_guard lock{m_mutex};
    for (Share& share: shares) {
        if (auto stored = m_backend->insert(share); !stored) {
            return util::unexpected<Error>{stored.error()};
        }
        m_shares.push_back(std::move(share));
    }
    return {};
}

ShareStore::Result<Share> ShareStore::add(Share&& share)
{
    if (share.get_path().find_first_of("\t\n\r") != std::string::npos ||
        share.get_password().find_first_of("\t\n\r") != std::string::npos) {
        return util::unexpected<Error>{"the path contains characters that are not allowed"};
    }
    const std::lock_guard lock{m_mutex};
    share.set_id(0);
    share.set_created(std::chrono::duration_cast<std::chrono::seconds>(
                          std::chrono::system_clock::now().time_since_epoch()
    )
                          .count());
    // Every share gets a token (a user share simply never publishes it): 80 random bits.
    share.set_token(util::random_hex(10));
    if (auto stored = m_backend->insert(share); !stored) {
        return util::unexpected<Error>{stored.error()};
    }
    m_shares.push_back(share);
    return share;
}

ShareStore::Result<void> ShareStore::remove(std::uint64_t id)
{
    const std::lock_guard lock{m_mutex};
    const auto found = std::ranges::find_if(
        m_shares,
        [id](const Share& share)
        {
            return share.get_id() == id;
        }
    );
    if (found == m_shares.end()) {
        return util::unexpected<Error>{"no such share"};
    }
    if (auto erased = m_backend->erase(id); !erased) {
        return util::unexpected<Error>{erased.error()};
    }
    m_shares.erase(found);
    return {};
}

template<typename Predicate> std::size_t ShareStore::erase_matching(Predicate&& matches)
{
    std::size_t count = 0;
    for (auto it = m_shares.begin(); it != m_shares.end();) {
        if (matches(*it)) {
            (void)m_backend->erase(it->get_id());
            it = m_shares.erase(it);
            ++count;
        } else {
            ++it;
        }
    }
    return count;
}

std::size_t ShareStore::remove_under(std::string_view owner, std::string_view path)
{
    const std::lock_guard lock{m_mutex};
    return erase_matching(
        [&](const Share& share)
        {
            return share.get_owner() == owner && under(share.get_path(), path);
        }
    );
}

std::size_t ShareStore::remove_user(std::string_view user)
{
    const std::lock_guard lock{m_mutex};
    return erase_matching(
        [&](const Share& share)
        {
            return share.get_owner() == user ||
                   (share.get_type() == SHARE_TYPE_USER && share.get_share_with() == user);
        }
    );
}

void ShareStore::rename_under(std::string_view owner, std::string_view from, std::string_view to)
{
    const std::lock_guard lock{m_mutex};
    for (Share& share: m_shares) {
        if (share.get_owner() == owner && under(share.get_path(), from)) {
            share.set_path(std::string{to} + share.get_path().substr(from.size()));
            (void)m_backend->update_path(share.get_id(), share.get_path());
        }
    }
}

std::size_t ShareStore::prune_expired(std::int64_t now)
{
    const std::lock_guard lock{m_mutex};
    return erase_matching(
        [now](const Share& share)
        {
            return share.expired(now);
        }
    );
}

std::optional<Share> ShareStore::find(std::uint64_t id) const
{
    const std::lock_guard lock{m_mutex};
    const auto found = std::ranges::find_if(
        m_shares,
        [id](const Share& share)
        {
            return share.get_id() == id;
        }
    );
    return found == m_shares.end() ? std::nullopt : std::optional<Share>{*found};
}

std::optional<Share> ShareStore::find_by_token(std::string_view token) const
{
    const std::lock_guard lock{m_mutex};
    for (const Share& share: m_shares) {
        // Only link shares and shares with another server are reachable by token.
        if ((share.get_type() == SHARE_TYPE_LINK || share.get_type() == SHARE_TYPE_REMOTE) &&
            util::constant_time_equals(share.get_token(), token)) {
            return share;
        }
    }
    return std::nullopt;
}

std::vector<Share> ShareStore::owned_by(std::string_view owner) const
{
    const std::lock_guard lock{m_mutex};
    std::vector<Share> out;
    std::ranges::copy_if(
        m_shares,
        std::back_inserter(out),
        [owner](const Share& share)
        {
            return share.get_owner() == owner;
        }
    );
    return out;
}

std::vector<Share> ShareStore::shared_with(std::string_view user) const
{
    const std::lock_guard lock{m_mutex};
    std::vector<Share> out;
    std::ranges::copy_if(
        m_shares,
        std::back_inserter(out),
        [user](const Share& share)
        {
            return share.get_type() == SHARE_TYPE_USER && share.get_share_with() == user;
        }
    );
    return out;
}

std::vector<Share> ShareStore::all() const
{
    const std::lock_guard lock{m_mutex};
    return m_shares;
}

} // namespace nc::cloud
