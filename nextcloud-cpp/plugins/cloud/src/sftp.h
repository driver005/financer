#pragma once

#include "ftp.h"
#include "nextcloud/util/expected.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

/// An SFTP client (libssh2 with the mbedTLS backend) for an external storage. The server is
/// identified by the SHA-256 fingerprint of its host key, which the administrator pins in the
/// configuration: a server with another key is refused, so nobody can sit in the middle. One
/// session per request, closed when it goes out of scope.
namespace nc::cloud::sftp {

using Entry = ftp::Entry;
template<typename Value> using Result = util::expected<Value, std::string>;

class Session
{
public:
    struct Settings
    {
        int timeout_seconds{30};
        bool allow_local{false};
        std::size_t max_bytes{256U * 1'024U * 1'024U};
    };

    Session() noexcept = default;
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;
    Session(Session&& other) noexcept;
    Session& operator=(Session&& other) noexcept;

    /// @brief Connects, checks the host key against `host_key_sha256` (base64 as `ssh-keygen -lf`
    /// prints it, without the "SHA256:" prefix, padding optional) and signs in with a
    /// password, or with a private key when `private_key_file` is given (`password` is then the
    /// key's passphrase, which may be empty).
    [[nodiscard]] static Result<Session> open(
        const std::string& host,
        const std::string& port,
        const std::string& user,
        const std::string& password,
        const std::string& host_key_sha256,
        const std::string& private_key_file,
        const Settings& settings
    );

    [[nodiscard]] Result<std::vector<Entry>> list(const std::string& path);
    /// @brief `limit` bytes from `offset` of a file (limit 0: to the end).
    [[nodiscard]] Result<std::string>
    retrieve(const std::string& path, std::uint64_t offset, std::uint64_t limit);
    [[nodiscard]] Result<void> store(const std::string& path, std::string_view data);
    [[nodiscard]] Result<void> make_directory(const std::string& path);
    [[nodiscard]] Result<void> remove_file(const std::string& path);
    [[nodiscard]] Result<void> remove_directory(const std::string& path);
    [[nodiscard]] Result<void> rename(const std::string& from, const std::string& to);

private:
    void close() noexcept;

    int m_socket{-1};
    void* m_session{nullptr}; // LIBSSH2_SESSION*
    void* m_sftp{nullptr};    // LIBSSH2_SFTP*
    Settings m_settings{};
};

} // namespace nc::cloud::sftp
