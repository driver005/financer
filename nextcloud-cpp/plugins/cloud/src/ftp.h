#pragma once

#include "nextcloud/util/expected.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

/// A small FTP client (RFC 959 with passive mode, MLSD from RFC 3659) for an external storage.
/// Plain FTP: the password travels unprotected, so it is for networks the administrator trusts. One
/// session per request, closed when it goes out of scope.
namespace nc::cloud::ftp {

struct Entry
{
    std::string name{};
    bool directory{false};
    std::uint64_t size{0};
    std::int64_t modified{0};
};

template<typename Value> using Result = util::expected<Value, std::string>;

/// @brief One line of a `LIST` answer in the usual Unix format ("-rw-r--r-- 1 u g 12 Jan 02 12:34
/// name"); nullopt for a line that is not an entry (such as "total 4").
[[nodiscard]] Result<Entry> parse_list_line(std::string_view line);

/// @brief One line of an `MLSD` answer ("type=file;size=12;modify=20240102030405; name").
[[nodiscard]] Result<Entry> parse_mlsd_line(std::string_view line);

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

    /// @brief Connects and signs in. Addresses on this machine or a private network are refused
    /// unless `allow_local`.
    [[nodiscard]] static Result<Session> open(
        const std::string& host,
        const std::string& port,
        const std::string& user,
        const std::string& password,
        const Settings& settings
    );

    /// @brief The entries of a folder.
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
    struct Reply
    {
        int code{0};
        std::string text{};
    };

    [[nodiscard]] Result<Reply> read_reply();
    [[nodiscard]] Result<Reply> command(const std::string& line);
    [[nodiscard]] Result<int> open_data_connection();
    [[nodiscard]] Result<std::string>
    read_data(int data, std::size_t limit, std::uint64_t stop_after);
    void close();

    int m_control{-1};
    std::string m_peer{}; // the numeric address of the server: data connections go there only
    std::string m_buffer{};
    Settings m_settings{};
    bool m_mlsd{true};
};

} // namespace nc::cloud::ftp
