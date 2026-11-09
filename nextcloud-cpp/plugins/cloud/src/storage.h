#pragma once

#include "file_cipher.h"
#include "nextcloud/util/expected.h"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace nc::cloud {

enum class StorageCode
{
    NOT_FOUND,
    EXISTS,
    PARENT_MISSING,
    IS_DIRECTORY,
    NOT_DIRECTORY,
    INVALID_PATH,
    QUOTA,
    IO
};

class StorageError
{
public:
    StorageError() noexcept = default;

    explicit StorageError(StorageCode code) noexcept :
        m_code{code}
    {
    }

    StorageError(StorageCode code, std::string&& message) noexcept :
        m_code{code},
        m_message{std::move(message)}
    {
    }

    void set_code(StorageCode code) noexcept
    {
        m_code = code;
    }

    void set_message(std::string&& message) noexcept
    {
        m_message = std::move(message);
    }

    [[nodiscard]] StorageCode get_code() const noexcept
    {
        return m_code;
    }

    [[nodiscard]] std::string& get_message() noexcept
    {
        return m_message;
    }

    [[nodiscard]] const std::string& get_message() const noexcept
    {
        return m_message;
    }

private:
    StorageCode m_code{StorageCode::IO};
    std::string m_message{};
};

template<typename Value> using Result = util::expected<Value, StorageError>;

[[nodiscard]] inline util::unexpected<StorageError> fail(StorageCode code, std::string message = {})
{
    return util::unexpected<StorageError>{StorageError{code, std::move(message)}};
}

/// @brief A file or folder as the storage reports it.
class Node
{
public:
    Node() noexcept = default;

    Node(std::string&& path, bool directory) noexcept :
        m_path{std::move(path)},
        m_directory{directory}
    {
    }

    Node(
        std::string&& path,
        bool directory,
        std::uint64_t size,
        std::int64_t mtime,
        std::string&& etag
    ) noexcept :
        m_path{std::move(path)},
        m_directory{directory},
        m_size{size},
        m_mtime{mtime},
        m_etag{std::move(etag)}
    {
    }

    void set_path(std::string&& path) noexcept
    {
        m_path = std::move(path);
    }

    void set_directory(bool directory) noexcept
    {
        m_directory = directory;
    }

    void set_size(std::uint64_t size) noexcept
    {
        m_size = size;
    }

    void set_mtime(std::int64_t mtime) noexcept
    {
        m_mtime = mtime;
    }

    void set_etag(std::string&& etag) noexcept
    {
        m_etag = std::move(etag);
    }

    [[nodiscard]] std::string& get_path() noexcept
    {
        return m_path;
    }

    [[nodiscard]] const std::string& get_path() const noexcept
    {
        return m_path;
    }

    [[nodiscard]] bool is_directory() const noexcept
    {
        return m_directory;
    }

    [[nodiscard]] std::uint64_t get_size() const noexcept
    {
        return m_size;
    }

    [[nodiscard]] std::int64_t get_mtime() const noexcept
    {
        return m_mtime;
    }

    [[nodiscard]] std::string& get_etag() noexcept
    {
        return m_etag;
    }

    [[nodiscard]] const std::string& get_etag() const noexcept
    {
        return m_etag;
    }

    /// @brief The last path segment ("" for the root).
    [[nodiscard]] std::string name() const
    {
        const std::size_t slash = m_path.rfind('/');
        return slash == std::string::npos ? m_path : m_path.substr(slash + 1);
    }

private:
    std::string m_path{"/"};
    bool m_directory{false};
    std::uint64_t m_size{0};
    std::int64_t m_mtime{0};
    std::string m_etag{};
};

/// @brief One user's file tree on disk, the counterpart of `OC\Files\Storage\Local` +
/// `OC\Files\View`.
///
/// Every path a caller gives is a virtual path ("/Photos/a.jpg") that `normalize` first turns into
/// a canonical one: no `.`/`..` segments, no empty or over-long names, no control characters. A
/// real path is built only from a canonical one, and a symbolic link anywhere on it is refused, so
/// nothing can reach outside the root.
/// @brief A plain file opened for reading in pieces, so a download never holds it in memory whole.
class FileStream
{
public:
    FileStream(std::shared_ptr<std::ifstream> file, std::uint64_t size) :
        m_file{std::move(file)},
        m_size{size}
    {
    }

    /// @brief The file's size when it was opened.
    [[nodiscard]] std::uint64_t size() const noexcept
    {
        return m_size;
    }

    /// @brief Reads `length` bytes from `first`: each call fills the buffer with the next piece
    /// and returns how many bytes it wrote (0 at the end, negative when the file cannot be read).
    [[nodiscard]] std::function<std::int64_t(char*, std::size_t)>
    reader(std::uint64_t first, std::uint64_t length) const;

private:
    std::shared_ptr<std::ifstream> m_file{};
    std::uint64_t m_size{0};
};

class Storage
{
public:
    /// @param root the directory that is "/"
    /// @param quota_bytes 0 means unlimited
    /// @param cipher when set, files are encrypted on write and decrypted on read (sizes are
    /// reported for the plain content)
    explicit Storage(
        std::filesystem::path root,
        std::uint64_t quota_bytes = 0,
        std::shared_ptr<const FileCipher> cipher = nullptr
    ) :
        m_root{std::move(root)},
        m_quota{quota_bytes},
        m_cipher{std::move(cipher)}
    {
    }

    /// @brief Encrypts the plain files that are already there (after the key was switched on);
    /// returns how many it changed. Does nothing without a cipher.
    [[nodiscard]] Result<std::size_t> encrypt_existing() const;

    /// @brief Key rotation: every file that `old_cipher` decrypts is written again with this
    /// storage's cipher (plain files are encrypted too). Stops at the first file that does not
    /// verify, leaving everything before it converted; running it again finishes the job (files
    /// that already use the new key are left alone). Returns how many files changed.
    [[nodiscard]] Result<std::size_t> rotate_key(const class FileCipher& old_cipher) const;

    [[nodiscard]] static Result<std::string> normalize(std::string_view path);

    /// @brief Creates the root folder if it is missing.
    [[nodiscard]] Result<void> ensure_root() const;

    [[nodiscard]] Result<Node> stat(std::string_view path) const;
    [[nodiscard]] Result<std::vector<Node>> list(std::string_view path) const;
    [[nodiscard]] Result<std::string> read(std::string_view path) const;

    /// @brief Files from this size on are streamed instead of read into memory.
    static constexpr std::uint64_t STREAM_THRESHOLD = 1U << 20U;

    /// @brief Opens a file for streaming. Empty when it cannot be streamed: an encrypted file is
    /// only readable as a whole (it is authenticated as a whole), so the caller falls back to
    /// `read`.
    [[nodiscard]] std::optional<FileStream> open_stream(std::string_view path) const;

    /// @brief Writes a file atomically; true when it did not exist before. Parent must exist.
    [[nodiscard]] Result<bool>
    write(std::string_view path, std::string_view data, std::int64_t mtime = 0) const;
    [[nodiscard]] Result<void> make_directory(std::string_view path) const;
    [[nodiscard]] Result<void> remove(std::string_view path) const;

    /// @brief Moves or copies; true when the target did not exist before. Without `overwrite` an
    /// existing target is an EXISTS error. A folder cannot go into itself.
    [[nodiscard]] Result<bool>
    move(std::string_view from, std::string_view to, bool overwrite) const;
    [[nodiscard]] Result<bool>
    copy(std::string_view from, std::string_view to, bool overwrite) const;

    /// @brief Moves `from` into another storage (the trash, the versions) as `to`; it must not
    /// exist.
    [[nodiscard]] Result<void>
    move_to(const Storage& target, std::string_view from, std::string_view to) const;
    /// @brief Copies a file into another storage as `to`; it must not exist.
    [[nodiscard]] Result<void>
    copy_to(const Storage& target, std::string_view from, std::string_view to) const;

    /// @brief Bytes under a path (a file's size, or the sum for a folder).
    [[nodiscard]] Result<std::uint64_t> size_of(std::string_view path) const;
    [[nodiscard]] std::uint64_t used_bytes() const;

    [[nodiscard]] std::uint64_t get_quota() const noexcept
    {
        return m_quota;
    }

    /// @brief Counts what is stored under `root` (the owner's whole tree) against the quota,
    /// instead of this storage's own root. A shared folder is a storage of its own, but what is
    /// written into it belongs to the owner's quota.
    void set_quota_root(std::filesystem::path root)
    {
        m_quota_root = std::move(root);
    }

private:
    [[nodiscard]] Result<std::filesystem::path> resolve(std::string_view normalized) const;
    [[nodiscard]] Result<Node>
    node_at(const std::string& normalized, const std::filesystem::path& real) const;
    [[nodiscard]] Result<bool>
    transfer(std::string_view from, std::string_view to, bool overwrite, bool keep_source) const;

    std::filesystem::path m_root{};
    [[nodiscard]] std::uint64_t plain_size(const std::filesystem::path& real) const;

    std::uint64_t m_quota{0};
    std::filesystem::path m_quota_root{};
    std::shared_ptr<const FileCipher> m_cipher{};
};

} // namespace nc::cloud
