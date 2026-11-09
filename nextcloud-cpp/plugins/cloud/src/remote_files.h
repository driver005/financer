#pragma once

#include "ftp.h"
#include "nextcloud/util/expected.h"

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

/// The operations an external storage on another server needs, whatever the protocol (FTP, SFTP):
/// the cloud plugin serves both through this one interface.
namespace nc::cloud {

using RemoteEntry = ftp::Entry;
template<typename Value> using RemoteResult = util::expected<Value, std::string>;

class RemoteFiles
{
public:
    RemoteFiles() = default;
    virtual ~RemoteFiles() = default;
    RemoteFiles(const RemoteFiles&) = delete;
    RemoteFiles& operator=(const RemoteFiles&) = delete;
    RemoteFiles(RemoteFiles&&) = delete;
    RemoteFiles& operator=(RemoteFiles&&) = delete;

    [[nodiscard]] virtual RemoteResult<std::vector<RemoteEntry>> list(const std::string& path) = 0;
    /// `limit` bytes from `offset` (limit 0: to the end).
    [[nodiscard]] virtual RemoteResult<std::string>
    retrieve(const std::string& path, std::uint64_t offset, std::uint64_t limit) = 0;
    [[nodiscard]] virtual RemoteResult<void>
    store(const std::string& path, std::string_view data) = 0;
    [[nodiscard]] virtual RemoteResult<void> make_directory(const std::string& path) = 0;
    [[nodiscard]] virtual RemoteResult<void> remove_file(const std::string& path) = 0;
    [[nodiscard]] virtual RemoteResult<void> remove_directory(const std::string& path) = 0;
    [[nodiscard]] virtual RemoteResult<void>
    rename(const std::string& from, const std::string& to) = 0;
};

/// Wraps a session type with the FTP session's method names into the interface.
template<typename SessionType> class RemoteSession final : public RemoteFiles
{
public:
    explicit RemoteSession(SessionType&& session) :
        m_session{std::move(session)}
    {
    }

    RemoteResult<std::vector<RemoteEntry>> list(const std::string& path) override
    {
        return m_session.list(path);
    }

    RemoteResult<std::string>
    retrieve(const std::string& path, std::uint64_t offset, std::uint64_t limit) override
    {
        return m_session.retrieve(path, offset, limit);
    }

    RemoteResult<void> store(const std::string& path, std::string_view data) override
    {
        return m_session.store(path, data);
    }

    RemoteResult<void> make_directory(const std::string& path) override
    {
        return m_session.make_directory(path);
    }

    RemoteResult<void> remove_file(const std::string& path) override
    {
        return m_session.remove_file(path);
    }

    RemoteResult<void> remove_directory(const std::string& path) override
    {
        return m_session.remove_directory(path);
    }

    RemoteResult<void> rename(const std::string& from, const std::string& to) override
    {
        return m_session.rename(from, to);
    }

private:
    SessionType m_session;
};

} // namespace nc::cloud
