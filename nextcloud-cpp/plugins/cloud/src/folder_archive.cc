#include "folder_archive.h"

#include <archive.h>
#include <archive_entry.h>
#include <array>
#include <cstdlib>
#include <filesystem>
#include <locale.h>
#include <sys/stat.h>
#include <unistd.h>

namespace nc::cloud {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    struct ArchiveDeleter
    {
        void operator()(archive* handle) const noexcept
        {
            archive_write_free(handle);
        }
    };

    struct EntryDeleter
    {
        void operator()(archive_entry* entry) const noexcept
        {
            archive_entry_free(entry);
        }
    };

    /// An unnamed file: made, opened and removed at once, so nothing is left behind whatever
    /// happens.
    int make_temporary_file()
    {
        std::error_code ignored;
        std::string pattern =
            (std::filesystem::temp_directory_path(ignored) / "nc-archive-XXXXXX").string();
        const int descriptor = ::mkstemp(pattern.data());
        if (descriptor >= 0) {
            ::unlink(pattern.c_str());
        }
        return descriptor;
    }

    /// libarchive turns names between UTF-8 and the locale's character set, and with the plain "C"
    /// locale it cannot for anything but ASCII (the zip writer then does not mark the names as
    /// UTF-8). While this object lives the calling thread uses a UTF-8 locale; other threads are
    /// not touched.
    class Utf8Locale
    {
    public:
        Utf8Locale() noexcept
        {
            static const locale_t UTF8 = newlocale(LC_CTYPE_MASK, "C.UTF-8", locale_t{});
            m_previous = UTF8 == locale_t{} ? locale_t{} : uselocale(UTF8);
        }

        Utf8Locale(const Utf8Locale&) = delete;
        Utf8Locale& operator=(const Utf8Locale&) = delete;

        ~Utf8Locale()
        {
            if (m_previous != locale_t{}) {
                uselocale(m_previous);
            }
        }

    private:
        locale_t m_previous{};
    };

    /// The name of an entry. UTF-8 when the conversion works; otherwise the bytes as they are
    /// (an entry without a name would crash the writer).
    void set_name(archive_entry* entry, const std::string& name)
    {
        archive_entry_set_pathname_utf8(entry, name.c_str());
        if (archive_entry_pathname(entry) == nullptr) {
            archive_entry_copy_pathname(entry, name.c_str());
        }
    }

    void close_descriptor(int* descriptor)
    {
        if (*descriptor >= 0) {
            ::close(*descriptor);
        }
        delete descriptor;
    }

} // namespace

struct ArchiveWriter::Impl
{
    std::unique_ptr<archive, ArchiveDeleter> handle;
    std::shared_ptr<int> descriptor;
    std::uint64_t budget{0};
    std::uint64_t used{0};
    bool closed{false};
};

ArchiveWriter::ArchiveWriter(std::unique_ptr<Impl> impl) noexcept :
    m_impl{std::move(impl)}
{
}

ArchiveWriter::ArchiveWriter(ArchiveWriter&&) noexcept = default;
ArchiveWriter& ArchiveWriter::operator=(ArchiveWriter&&) noexcept = default;
ArchiveWriter::~ArchiveWriter() = default;

util::expected<ArchiveWriter, std::string>
ArchiveWriter::create(Format format, std::uint64_t max_bytes)
{
    const Utf8Locale locale;
    auto impl = std::make_unique<Impl>();
    impl->budget = max_bytes;
    impl->descriptor = std::shared_ptr<int>{new int{make_temporary_file()}, &close_descriptor};
    if (*impl->descriptor < 0) {
        return failure("cannot make a temporary file for the archive");
    }
    impl->handle.reset(archive_write_new());
    archive* handle = impl->handle.get();
    if (handle == nullptr) {
        return failure("cannot start the archive");
    }
    if (format == Format::ZIP) {
        // Stored, not compressed: the downloaded files are mostly compressed already, and a sync
        // client wants the bytes quickly.
        if (archive_write_set_format_zip(handle) != ARCHIVE_OK ||
            archive_write_zip_set_compression_store(handle) != ARCHIVE_OK) {
            return failure("cannot start the zip archive");
        }
    } else if (archive_write_set_format_pax_restricted(handle) != ARCHIVE_OK) {
        return failure("cannot start the tar archive");
    }
    archive_write_set_bytes_in_last_block(handle, 1);
    if (archive_write_open_fd(handle, *impl->descriptor) != ARCHIVE_OK) {
        return failure("cannot write the archive");
    }
    return ArchiveWriter{std::move(impl)};
}

util::expected<void, std::string>
ArchiveWriter::add_directory(std::string_view name, std::int64_t mtime)
{
    const std::unique_ptr<archive_entry, EntryDeleter> entry{archive_entry_new()};
    std::string directory{name};
    if (directory.empty() || directory.back() != '/') {
        directory += '/';
    }
    const Utf8Locale locale;
    set_name(entry.get(), directory);
    archive_entry_set_filetype(entry.get(), AE_IFDIR);
    archive_entry_set_perm(entry.get(), 0755);
    archive_entry_set_mtime(entry.get(), static_cast<time_t>(mtime), 0);
    archive_entry_set_size(entry.get(), 0);
    if (archive_write_header(m_impl->handle.get(), entry.get()) != ARCHIVE_OK) {
        return failure(archive_error_string(m_impl->handle.get()));
    }
    return {};
}

util::expected<bool, std::string> ArchiveWriter::add_file(
    std::string_view name,
    std::int64_t mtime,
    std::uint64_t size,
    const Source& source
)
{
    if (size > m_impl->budget - std::min(m_impl->used, m_impl->budget)) {
        return failure("the files are larger than an archive may be");
    }
    m_impl->used += size;
    const std::unique_ptr<archive_entry, EntryDeleter> entry{archive_entry_new()};
    const Utf8Locale locale;
    set_name(entry.get(), std::string{name});
    archive_entry_set_filetype(entry.get(), AE_IFREG);
    archive_entry_set_perm(entry.get(), 0644);
    archive_entry_set_mtime(entry.get(), static_cast<time_t>(mtime), 0);
    archive_entry_set_size(entry.get(), static_cast<la_int64_t>(size));
    archive* handle = m_impl->handle.get();
    if (archive_write_header(handle, entry.get()) != ARCHIVE_OK) {
        return failure(archive_error_string(handle));
    }
    std::array<char, 65'536> buffer{};
    std::uint64_t written = 0;
    bool complete = true;
    while (written < size) {
        const std::size_t want =
            static_cast<std::size_t>(std::min<std::uint64_t>(buffer.size(), size - written));
        std::int64_t got = complete ? source(buffer.data(), want) : 0;
        if (got <= 0) {
            // The entry says how long it is: what cannot be read is replaced by zeros.
            complete = false;
            std::fill_n(buffer.data(), want, '\0');
            got = static_cast<std::int64_t>(want);
        }
        if (archive_write_data(handle, buffer.data(), static_cast<std::size_t>(got)) < 0) {
            return failure(archive_error_string(handle));
        }
        written += static_cast<std::uint64_t>(got);
    }
    // A source that has more than it announced is not read further than the announced size.
    return complete;
}

util::expected<void, std::string>
ArchiveWriter::add_text(std::string_view name, std::int64_t mtime, std::string_view content)
{
    std::size_t offset = 0;
    const auto added = add_file(
        name,
        mtime,
        content.size(),
        [&](char* buffer, std::size_t capacity) -> std::int64_t
        {
            const std::size_t count = std::min(capacity, content.size() - offset);
            std::copy_n(content.data() + offset, count, buffer);
            offset += count;
            return static_cast<std::int64_t>(count);
        }
    );
    if (!added) {
        return failure(added.error());
    }
    return {};
}

util::expected<ArchiveWriter::Finished, std::string> ArchiveWriter::finish()
{
    const Utf8Locale locale;
    if (archive_write_close(m_impl->handle.get()) != ARCHIVE_OK) {
        return failure(archive_error_string(m_impl->handle.get()));
    }
    m_impl->closed = true;

    struct stat info
    {};

    if (::fstat(*m_impl->descriptor, &info) != 0) {
        return failure("cannot read the archive");
    }
    return Finished{m_impl->descriptor, static_cast<std::uint64_t>(info.st_size)};
}

std::function<std::int64_t(char*, std::size_t)> ArchiveWriter::Finished::reader() const
{
    // The offset lives in the closure; the descriptor is shared and read with pread, so the
    // reader can be copied without the copies disturbing each other.
    return [descriptor = descriptor,
            offset = std::uint64_t{0}](char* buffer, std::size_t capacity) mutable -> std::int64_t
    {
        const ssize_t got = ::pread(*descriptor, buffer, capacity, static_cast<off_t>(offset));
        if (got > 0) {
            offset += static_cast<std::uint64_t>(got);
        }
        return got;
    };
}

} // namespace nc::cloud
