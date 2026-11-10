#pragma once

#include "nextcloud/util/expected.h"

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <string_view>

/// Folders downloaded as one zip or tar file (what Nextcloud's `ZipFolderPlugin` does), written by
/// libarchive into a temporary file that nobody else can see (it is unlinked when it is made), then
/// handed out in pieces.
namespace nc::cloud {

class ArchiveWriter
{
public:
    enum class Format
    {
        ZIP,
        TAR
    };

    /// @brief Produces the next piece of a file: writes at most `capacity` bytes into `buffer` and
    /// returns how many (0 at the end, negative when the source cannot be read).
    using Source = std::function<std::int64_t(char* buffer, std::size_t capacity)>;

    /// @brief The finished archive: an open (and already unlinked) file and its size.
    struct Finished
    {
        std::shared_ptr<int> descriptor{};
        std::uint64_t size{0};

        /// A reader for `Response::set_stream`: the archive from its start.
        [[nodiscard]] std::function<std::int64_t(char*, std::size_t)> reader() const;
    };

    ArchiveWriter(ArchiveWriter&&) noexcept;
    ArchiveWriter& operator=(ArchiveWriter&&) noexcept;
    ArchiveWriter(const ArchiveWriter&) = delete;
    ArchiveWriter& operator=(const ArchiveWriter&) = delete;
    ~ArchiveWriter();

    /// @param max_bytes what the files in it may add up to (the archive is a bit larger)
    [[nodiscard]] static util::expected<ArchiveWriter, std::string>
    create(Format format, std::uint64_t max_bytes);

    [[nodiscard]] util::expected<void, std::string>
    add_directory(std::string_view name, std::int64_t mtime);

    /// @brief Adds a file of `size` bytes taken from `source`. A source that ends early or fails is
    /// filled up with zeros (the entry has to be as long as it says); the result is false then, and
    /// the caller reports the file as damaged. An error is for the archive itself (too large,
    /// cannot be written).
    [[nodiscard]] util::expected<bool, std::string>
    add_file(std::string_view name, std::int64_t mtime, std::uint64_t size, const Source& source);

    /// @brief Adds a small file given whole.
    [[nodiscard]] util::expected<void, std::string>
    add_text(std::string_view name, std::int64_t mtime, std::string_view content);

    [[nodiscard]] util::expected<Finished, std::string> finish();

private:
    struct Impl;
    explicit ArchiveWriter(std::unique_ptr<Impl> impl) noexcept;
    std::unique_ptr<Impl> m_impl;
};

} // namespace nc::cloud
