#include "storage.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <chrono>
#include <fstream>
#include <sstream>
#include <system_error>

namespace nc::cloud {

namespace {

    namespace fs = std::filesystem;

    constexpr std::string_view TEMP_PREFIX = ".nc-part-";

    bool hidden_name(std::string_view name) noexcept
    {
        return name.starts_with(TEMP_PREFIX);
    }

    std::int64_t to_unix(fs::file_time_type time) noexcept
    {
        const auto system = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
            time - fs::file_time_type::clock::now() + std::chrono::system_clock::now()
        );
        return std::chrono::duration_cast<std::chrono::seconds>(system.time_since_epoch()).count();
    }

    StorageError from_error(const std::error_code& error, std::string_view what)
    {
        const StorageCode code = error == std::errc::no_such_file_or_directory
                                     ? StorageCode::NOT_FOUND
                                 : error == std::errc::file_exists     ? StorageCode::EXISTS
                                 : error == std::errc::not_a_directory ? StorageCode::NOT_DIRECTORY
                                 : error == std::errc::is_a_directory  ? StorageCode::IS_DIRECTORY
                                                                       : StorageCode::IO;
        return StorageError{code, std::string{what} + ": " + error.message()};
    }

} // namespace

Result<std::string> Storage::normalize(std::string_view path)
{
    std::string out;
    for (const std::string& segment: util::split(path, '/')) {
        if (segment.empty()) {
            continue;
        }
        if (segment == "." || segment == "..") {
            return fail(StorageCode::INVALID_PATH, "relative segments are not allowed");
        }
        if (segment.size() > 255) {
            return fail(StorageCode::INVALID_PATH, "a name is longer than 255 bytes");
        }
        if (hidden_name(segment) || std::ranges::any_of(
                                        segment,
                                        [](char letter)
                                        {
                                            return static_cast<unsigned char>(letter) < 0x20 ||
                                                   letter == 0x7f || letter == '\\';
                                        }
                                    )) {
            return fail(
                StorageCode::INVALID_PATH,
                "the name contains characters that are not allowed"
            );
        }
        out += "/" + segment;
    }
    return out.empty() ? std::string{"/"} : out;
}

Result<fs::path> Storage::resolve(std::string_view normalized) const
{
    fs::path real = m_root;
    for (const std::string& segment: util::split(normalized, '/')) {
        if (segment.empty()) {
            continue;
        }
        real /= segment;
        std::error_code error;
        const fs::file_status status = fs::symlink_status(real, error);
        if (!error && status.type() == fs::file_type::symlink) {
            return fail(StorageCode::INVALID_PATH, "symbolic links are not followed");
        }
    }
    return real;
}

Result<void> Storage::ensure_root() const
{
    std::error_code error;
    fs::create_directories(m_root, error);
    if (error) {
        return util::unexpected<StorageError>{from_error(error, "cannot create " + m_root.string())
        };
    }
    return {};
}

Result<Node> Storage::node_at(const std::string& normalized, const fs::path& real) const
{
    std::error_code error;
    const fs::file_status status = fs::status(real, error);
    if (error || !fs::exists(status)) {
        return fail(StorageCode::NOT_FOUND, normalized);
    }
    const bool directory = fs::is_directory(status);
    const auto time = fs::last_write_time(real, error);
    const std::int64_t mtime = error ? 0 : to_unix(time);
    std::uint64_t size = 0;
    if (!directory) {
        size = static_cast<std::uint64_t>(fs::file_size(real, error));
    } else {
        // A folder changes when anything directly in it appears or disappears; its mtime moves with
        // that.
        size = 0;
    }
    const std::string etag = util::to_hex(util::sha256(
                                              normalized + "|" + std::to_string(size) + "|" +
                                              std::to_string(time.time_since_epoch().count())
                                          ))
                                 .substr(0, 32);
    return Node{std::string{normalized}, directory, size, mtime, std::string{etag}};
}

Result<Node> Storage::stat(std::string_view path) const
{
    const auto normalized = normalize(path);
    if (!normalized) {
        return util::unexpected<StorageError>{normalized.error()};
    }
    const auto real = resolve(*normalized);
    if (!real) {
        return util::unexpected<StorageError>{real.error()};
    }
    return node_at(*normalized, *real);
}

Result<std::vector<Node>> Storage::list(std::string_view path) const
{
    const auto normalized = normalize(path);
    if (!normalized) {
        return util::unexpected<StorageError>{normalized.error()};
    }
    const auto real = resolve(*normalized);
    if (!real) {
        return util::unexpected<StorageError>{real.error()};
    }
    std::error_code error;
    if (!fs::is_directory(*real, error)) {
        return fail(
            fs::exists(*real) ? StorageCode::NOT_DIRECTORY : StorageCode::NOT_FOUND,
            *normalized
        );
    }
    std::vector<Node> nodes;
    for (const auto& entry: fs::directory_iterator{*real, error}) {
        const std::string name = entry.path().filename().string();
        if (hidden_name(name) || entry.is_symlink()) {
            continue;
        }
        auto node =
            node_at(*normalized == "/" ? "/" + name : *normalized + "/" + name, entry.path());
        if (node) {
            nodes.push_back(std::move(*node));
        }
    }
    std::ranges::sort(
        nodes,
        [](const Node& a, const Node& b)
        {
            return a.get_path() < b.get_path();
        }
    );
    return nodes;
}

Result<std::string> Storage::read(std::string_view path) const
{
    const auto normalized = normalize(path);
    if (!normalized) {
        return util::unexpected<StorageError>{normalized.error()};
    }
    const auto real = resolve(*normalized);
    if (!real) {
        return util::unexpected<StorageError>{real.error()};
    }
    std::error_code error;
    if (fs::is_directory(*real, error)) {
        return fail(StorageCode::IS_DIRECTORY, *normalized);
    }
    std::ifstream stream{*real, std::ios::binary};
    if (!stream) {
        return fail(StorageCode::NOT_FOUND, *normalized);
    }
    std::ostringstream data;
    data << stream.rdbuf();
    return data.str();
}

Result<bool> Storage::write(std::string_view path, std::string_view data, std::int64_t mtime) const
{
    const auto normalized = normalize(path);
    if (!normalized) {
        return util::unexpected<StorageError>{normalized.error()};
    }
    if (*normalized == "/") {
        return fail(StorageCode::IS_DIRECTORY, "/");
    }
    const auto real = resolve(*normalized);
    if (!real) {
        return util::unexpected<StorageError>{real.error()};
    }
    std::error_code error;
    if (!fs::is_directory(real->parent_path(), error)) {
        return fail(StorageCode::PARENT_MISSING, *normalized);
    }
    if (fs::is_directory(*real, error)) {
        return fail(StorageCode::IS_DIRECTORY, *normalized);
    }
    const bool existed = fs::exists(*real, error);
    if (m_quota != 0) {
        const std::uint64_t old_size =
            existed ? static_cast<std::uint64_t>(fs::file_size(*real, error)) : 0;
        if (used_bytes() - old_size + data.size() > m_quota) {
            return fail(StorageCode::QUOTA, "the storage is full");
        }
    }
    const fs::path temporary =
        real->parent_path() / (std::string(TEMP_PREFIX) + util::random_hex(6));
    {
        std::ofstream stream{temporary, std::ios::binary | std::ios::trunc};
        stream.write(data.data(), static_cast<std::streamsize>(data.size()));
        stream.flush();
        if (!stream) {
            fs::remove(temporary, error);
            return fail(StorageCode::IO, "cannot write " + *normalized);
        }
    }
    if (mtime > 0) {
        fs::last_write_time(
            temporary,
            fs::file_time_type::clock::now() -
                (std::chrono::system_clock::now() -
                 std::chrono::system_clock::from_time_t(static_cast<std::time_t>(mtime))),
            error
        );
    }
    fs::rename(temporary, *real, error);
    if (error) {
        fs::remove(temporary, error);
        return util::unexpected<StorageError>{from_error(error, "cannot store " + *normalized)};
    }
    return !existed;
}

Result<void> Storage::make_directory(std::string_view path) const
{
    const auto normalized = normalize(path);
    if (!normalized) {
        return util::unexpected<StorageError>{normalized.error()};
    }
    const auto real = resolve(*normalized);
    if (!real) {
        return util::unexpected<StorageError>{real.error()};
    }
    std::error_code error;
    if (fs::exists(*real, error)) {
        return fail(StorageCode::EXISTS, *normalized);
    }
    if (!fs::is_directory(real->parent_path(), error)) {
        return fail(StorageCode::PARENT_MISSING, *normalized);
    }
    if (!fs::create_directory(*real, error) || error) {
        return util::unexpected<StorageError>{from_error(error, "cannot create " + *normalized)};
    }
    return {};
}

Result<void> Storage::remove(std::string_view path) const
{
    const auto normalized = normalize(path);
    if (!normalized) {
        return util::unexpected<StorageError>{normalized.error()};
    }
    if (*normalized == "/") {
        return fail(StorageCode::INVALID_PATH, "the root cannot be removed");
    }
    const auto real = resolve(*normalized);
    if (!real) {
        return util::unexpected<StorageError>{real.error()};
    }
    std::error_code error;
    if (!fs::exists(*real, error)) {
        return fail(StorageCode::NOT_FOUND, *normalized);
    }
    fs::remove_all(*real, error);
    if (error) {
        return util::unexpected<StorageError>{from_error(error, "cannot remove " + *normalized)};
    }
    return {};
}

Result<bool>
Storage::transfer(std::string_view from, std::string_view to, bool overwrite, bool keep_source)
    const
{
    const auto source = normalize(from);
    const auto target = normalize(to);
    if (!source) {
        return util::unexpected<StorageError>{source.error()};
    }
    if (!target) {
        return util::unexpected<StorageError>{target.error()};
    }
    if (*source == "/" || *target == "/") {
        return fail(StorageCode::INVALID_PATH, "the root cannot be moved or replaced");
    }
    if (*source == *target || target->starts_with(*source + "/")) {
        return fail(StorageCode::INVALID_PATH, "a folder cannot be moved or copied into itself");
    }
    const auto real_source = resolve(*source);
    const auto real_target = resolve(*target);
    if (!real_source) {
        return util::unexpected<StorageError>{real_source.error()};
    }
    if (!real_target) {
        return util::unexpected<StorageError>{real_target.error()};
    }
    std::error_code error;
    if (!fs::exists(*real_source, error)) {
        return fail(StorageCode::NOT_FOUND, *source);
    }
    if (!fs::is_directory(real_target->parent_path(), error)) {
        return fail(StorageCode::PARENT_MISSING, *target);
    }
    const bool existed = fs::exists(*real_target, error);
    if (existed && !overwrite) {
        return fail(StorageCode::EXISTS, *target);
    }
    if (m_quota != 0 && keep_source) {
        const auto needed = size_of(*source);
        if (needed && used_bytes() + *needed > m_quota) {
            return fail(StorageCode::QUOTA, "the storage is full");
        }
    }
    if (existed) {
        fs::remove_all(*real_target, error);
    }
    if (keep_source) {
        fs::copy(
            *real_source,
            *real_target,
            fs::copy_options::recursive | fs::copy_options::copy_symlinks,
            error
        );
    } else {
        fs::rename(*real_source, *real_target, error);
    }
    if (error) {
        return util::unexpected<StorageError>{from_error(error, "cannot transfer " + *source)};
    }
    return !existed;
}

Result<bool> Storage::move(std::string_view from, std::string_view to, bool overwrite) const
{
    return transfer(from, to, overwrite, false);
}

Result<bool> Storage::copy(std::string_view from, std::string_view to, bool overwrite) const
{
    return transfer(from, to, overwrite, true);
}

Result<std::uint64_t> Storage::size_of(std::string_view path) const
{
    const auto normalized = normalize(path);
    if (!normalized) {
        return util::unexpected<StorageError>{normalized.error()};
    }
    const auto real = resolve(*normalized);
    if (!real) {
        return util::unexpected<StorageError>{real.error()};
    }
    std::error_code error;
    if (!fs::exists(*real, error)) {
        return fail(StorageCode::NOT_FOUND, *normalized);
    }
    if (!fs::is_directory(*real, error)) {
        return static_cast<std::uint64_t>(fs::file_size(*real, error));
    }
    std::uint64_t total = 0;
    for (const auto& entry: fs::recursive_directory_iterator{*real, error}) {
        if (entry.is_regular_file(error) && !hidden_name(entry.path().filename().string())) {
            total += static_cast<std::uint64_t>(entry.file_size(error));
        }
    }
    return total;
}

std::uint64_t Storage::used_bytes() const
{
    return size_of("/").value_or(0);
}

} // namespace nc::cloud
