#include "share_store.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>

namespace nc::cloud {

namespace {

    bool under(std::string_view path, std::string_view base) noexcept
    {
        return path == base || (path.size() > base.size() && path.substr(0, base.size()) == base &&
                                path[base.size()] == '/');
    }

} // namespace

ShareStore::Result<void> ShareStore::load()
{
    const std::lock_guard lock{m_mutex};
    m_shares.clear();
    m_next_id = 1;
    std::ifstream stream{m_file};
    if (!stream) {
        return {};
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
            // Remembered across restarts, so the id of a deleted share is never handed out again.
            m_next_id =
                std::max<std::uint64_t>(m_next_id, std::strtoull(parts[1].c_str(), nullptr, 10));
            continue;
        }
        if (parts.size() != 9) {
            return util::unexpected<Error>{
                m_file + ":" + std::to_string(number) + ": damaged share line"
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
        m_next_id = std::max(m_next_id, share.get_id() + 1);
        m_shares.push_back(std::move(share));
    }
    return {};
}

ShareStore::Result<void> ShareStore::save_locked() const
{
    std::error_code error;
    const std::filesystem::path path{m_file};
    if (path.has_parent_path()) {
        std::filesystem::create_directories(path.parent_path(), error);
    }
    const std::string temporary = m_file + ".tmp";
    {
        std::ofstream stream{temporary, std::ios::trunc};
        stream << "#next_id\t" << m_next_id << '\n';
        for (const Share& share: m_shares) {
            stream << share.get_id() << '\t' << share.get_token() << '\t' << share.get_type()
                   << '\t' << share.get_owner() << '\t' << share.get_share_with() << '\t'
                   << share.get_path() << '\t' << share.get_permissions() << '\t'
                   << share.get_expires() << '\t' << share.get_created() << '\n';
        }
        stream.flush();
        if (!stream) {
            return util::unexpected<Error>{"cannot write " + temporary};
        }
    }
    std::filesystem::permissions(
        temporary,
        std::filesystem::perms::owner_read | std::filesystem::perms::owner_write,
        error
    );
    std::filesystem::rename(temporary, m_file, error);
    if (error) {
        return util::unexpected<Error>{"cannot replace " + m_file + ": " + error.message()};
    }
    return {};
}

ShareStore::Result<Share> ShareStore::add(Share&& share)
{
    if (share.get_path().find_first_of("\t\n\r") != std::string::npos) {
        return util::unexpected<Error>{"the path contains characters that are not allowed"};
    }
    const std::lock_guard lock{m_mutex};
    share.set_id(m_next_id++);
    share.set_created(std::chrono::duration_cast<std::chrono::seconds>(
                          std::chrono::system_clock::now().time_since_epoch()
    )
                          .count());
    // Every share gets a token (a user share simply never publishes it): 80 random bits.
    share.set_token(util::random_hex(10));
    m_shares.push_back(share);
    if (auto saved = save_locked(); !saved) {
        m_shares.pop_back();
        return util::unexpected<Error>{saved.error()};
    }
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
    m_shares.erase(found);
    return save_locked();
}

std::size_t ShareStore::remove_under(std::string_view owner, std::string_view path)
{
    const std::lock_guard lock{m_mutex};
    const std::size_t count = std::erase_if(
        m_shares,
        [&](const Share& share)
        {
            return share.get_owner() == owner && under(share.get_path(), path);
        }
    );
    if (count != 0) {
        (void)save_locked();
    }
    return count;
}

std::size_t ShareStore::remove_user(std::string_view user)
{
    const std::lock_guard lock{m_mutex};
    const std::size_t count = std::erase_if(
        m_shares,
        [&](const Share& share)
        {
            return share.get_owner() == user ||
                   (share.get_type() == SHARE_TYPE_USER && share.get_share_with() == user);
        }
    );
    if (count != 0) {
        (void)save_locked();
    }
    return count;
}

void ShareStore::rename_under(std::string_view owner, std::string_view from, std::string_view to)
{
    const std::lock_guard lock{m_mutex};
    bool changed = false;
    for (Share& share: m_shares) {
        if (share.get_owner() == owner && under(share.get_path(), from)) {
            share.set_path(std::string{to} + share.get_path().substr(from.size()));
            changed = true;
        }
    }
    if (changed) {
        (void)save_locked();
    }
}

std::size_t ShareStore::prune_expired(std::int64_t now)
{
    const std::lock_guard lock{m_mutex};
    const std::size_t count = std::erase_if(
        m_shares,
        [now](const Share& share)
        {
            return share.expired(now);
        }
    );
    if (count != 0) {
        (void)save_locked();
    }
    return count;
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
        // Only link shares are reachable by token.
        if (share.get_type() == SHARE_TYPE_LINK &&
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
