/**
 * @file cloud_plugin.cc
 * @brief The cloud plugin: per-user file storage with WebDAV (`/remote.php/dav/files/{user}`),
 * shares by user and by public link (`/ocs/v2.php/apps/files_sharing/api/v1/shares`, `/s/{token}`),
 * and the `files:*` / `share:*` commands. Counterpart of Nextcloud's `apps/files`, `apps/dav` and
 * `apps/files_sharing`.
 */
#include "dav.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "share_store.h"
#include "storage.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <memory>
#include <optional>
#include <span>
#include <sstream>

namespace {

using nc::cloud::Share;
using nc::cloud::Storage;
using nc::http::Request;
using nc::http::Response;

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

Response ok(std::string_view data = "{}")
{
    return nc::http::ocs(200, "OK", data);
}

Response failure(int status, std::string_view message)
{
    return nc::http::ocs(status, message, "{}");
}

std::int64_t now_seconds()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

/// "2031-04-09" to unix seconds at the end of that day (UTC); 0 when it is not a date.
std::int64_t parse_expire_date(std::string_view text)
{
    std::tm parts{};
    if (text.size() != 10 || strptime(std::string{text}.c_str(), "%Y-%m-%d", &parts) == nullptr) {
        return 0;
    }
    parts.tm_hour = 23;
    parts.tm_min = 59;
    parts.tm_sec = 59;
    return static_cast<std::int64_t>(timegm(&parts));
}

std::string format_time(std::int64_t seconds)
{
    const auto raw = static_cast<std::time_t>(seconds);
    std::tm parts{};
    gmtime_r(&raw, &parts);
    char buffer[32];
    const std::size_t written = std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &parts);
    return std::string(buffer, written);
}

/// Shares in the `db` plugin's database (table `nc_shares`).
class DbShareBackend final : public nc::cloud::ShareBackend
{
public:
    explicit DbShareBackend(const nc::Host* host) :
        m_db{host}
    {
        m_db.migrate(
            "cloud",
            1,
            "CREATE TABLE nc_shares ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, type INTEGER NOT NULL,"
            " owner TEXT NOT NULL, share_with TEXT NOT NULL DEFAULT '', path TEXT NOT NULL,"
            " permissions INTEGER NOT NULL, expires INTEGER NOT NULL DEFAULT 0,"
            " created INTEGER NOT NULL, password TEXT NOT NULL DEFAULT '');"
            "CREATE INDEX nc_shares_owner ON nc_shares (owner);"
            "CREATE INDEX nc_shares_token ON nc_shares (token);"
            "CREATE INDEX nc_shares_with ON nc_shares (share_with);"
        );
    }

    Result<std::vector<Share>> load() override
    {
        try {
            std::vector<Share> shares;
            for (const nc::db::Row& row: m_db.query(
                     "SELECT id, token, type, owner, share_with, path, permissions, expires, "
                     "created, password FROM nc_shares ORDER BY id"
                 )) {
                const auto number = [&](std::string_view column)
                {
                    return std::strtoll(nc::db::value_of(row, column).c_str(), nullptr, 10);
                };
                Share share{
                    static_cast<std::uint64_t>(number("id")),
                    nc::db::value_of(row, "token"),
                    static_cast<int>(number("type")),
                    nc::db::value_of(row, "owner"),
                    nc::db::value_of(row, "share_with"),
                    nc::db::value_of(row, "path"),
                    static_cast<int>(number("permissions")),
                    number("expires"),
                    number("created")
                };
                share.set_password(nc::db::value_of(row, "password"));
                shares.push_back(std::move(share));
            }
            return shares;
        } catch (const std::exception& error) {
            return nc::util::unexpected<Error>{error.what()};
        }
    }

    Result<void> insert(Share& share) override
    {
        try {
            std::int64_t id = 0;
            const std::string wanted =
                share.get_id() == 0 ? std::string{} : std::to_string(share.get_id());
            m_db.exec(
                wanted.empty()
                    ? "INSERT INTO nc_shares (token, type, owner, share_with, path, permissions, "
                      "expires, created, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    : "INSERT INTO nc_shares (token, type, owner, share_with, path, permissions, "
                      "expires, created, password, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                columns(share, wanted),
                &id
            );
            if (wanted.empty()) {
                share.set_id(static_cast<std::uint64_t>(id));
            }
            return {};
        } catch (const std::exception& error) {
            return nc::util::unexpected<Error>{error.what()};
        }
    }

    Result<void> update_path(std::uint64_t id, const std::string& path) override
    {
        try {
            m_db.exec("UPDATE nc_shares SET path = ? WHERE id = ?", {path, std::to_string(id)});
            return {};
        } catch (const std::exception& error) {
            return nc::util::unexpected<Error>{error.what()};
        }
    }

    Result<void> erase(std::uint64_t id) override
    {
        try {
            m_db.exec("DELETE FROM nc_shares WHERE id = ?", {std::to_string(id)});
            return {};
        } catch (const std::exception& error) {
            return nc::util::unexpected<Error>{error.what()};
        }
    }

private:
    static std::vector<std::string> columns(const Share& share, const std::string& id)
    {
        std::vector<std::string> out{
            share.get_token(),
            std::to_string(share.get_type()),
            share.get_owner(),
            share.get_share_with(),
            share.get_path(),
            std::to_string(share.get_permissions()),
            std::to_string(share.get_expires()),
            std::to_string(share.get_created()),
            share.get_password()
        };
        if (!id.empty()) {
            out.push_back(id);
        }
        return out;
    }

    nc::db::Client m_db;
};

/// A user id that can safely name a directory.
bool safe_user(std::string_view user) noexcept
{
    return !user.empty() && user != "." && user != ".." &&
           user.find_first_of("/\\") == std::string_view::npos;
}

class CloudPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "cloud";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "File storage, WebDAV and sharing";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"users", "db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_data_dir = host.config("data_dir", "data");
        m_quota = std::strtoull(host.config("quota_bytes", "0").c_str(), nullptr, 10);
        m_public_url = host.config("overwrite_url", "");
        m_host = &host;
        parse_external(host.config("external_mounts", ""));
        m_max_upload =
            std::strtoull(host.config("max_upload_bytes", "2147483648").c_str(), nullptr, 10);
        // Encryption at rest: a 64 hex digit key in the config, or in a file the administrator
        // keeps apart.
        std::string key_hex = host.config("encryption_key", "");
        if (const std::string key_file = host.config("encryption_key_file", "");
            key_hex.empty() && !key_file.empty()) {
            std::ifstream stream{key_file};
            std::getline(stream, key_hex);
            if (!stream && key_hex.empty()) {
                throw std::runtime_error("cannot read encryption_key_file " + key_file);
            }
        }
        if (!key_hex.empty()) {
            const auto key = nc::cloud::FileCipher::key_from_hex(nc::util::trim(key_hex));
            if (!key) {
                throw std::runtime_error("the encryption key must be 64 hexadecimal digits");
            }
            m_encryption_key = *key;
        }
        m_host = &host;
        m_shares = std::make_unique<nc::cloud::ShareStore>(std::make_unique<DbShareBackend>(&host));
        if (auto loaded = m_shares->load(); !loaded) {
            throw std::runtime_error(loaded.error());
        }
        import_legacy_shares();

        host.add_service(
            "capabilities.files",
            [this](std::string_view)
            {
                return Response::json(
                    200,
                    R"({"bigfilechunking":false,"quota_bytes":)" + std::to_string(m_quota) + "}"
                );
            }
        );
        add_storage_services(host);
        add_dav_routes(host);
        add_upload_routes(host);
        add_share_routes(host);
        add_public_routes(host);
        add_commands(host);

        // Keep shares consistent with what happens to files and accounts.
        host.subscribe(
            "file.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                m_shares->remove_under(
                    nc::util::form_value(form, "user"),
                    nc::util::form_value(form, "path")
                );
            }
        );
        host.subscribe(
            "file.moved",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                m_shares->rename_under(
                    nc::util::form_value(form, "user"),
                    nc::util::form_value(form, "path"),
                    nc::util::form_value(form, "target")
                );
            }
        );
        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                // The files stay on disk until an administrator removes them; the shares go at
                // once.
                const std::size_t removed =
                    m_shares->remove_user(nc::util::form_value(nc::util::parse_form(payload), "id")
                    );
                m_host->log(
                    nc::LogLevel::INFO,
                    "removed " + std::to_string(removed) + " share(s) of a deleted account"
                );
            }
        );
    }

private:
    [[nodiscard]] Storage storage_for(std::string_view user) const
    {
        return Storage{
            std::filesystem::path{m_data_dir} / std::string{user} / "files",
            m_quota,
            cipher_for(user)
        };
    }

    /// The cipher for one account's files, or none when no server key is configured.
    [[nodiscard]] std::shared_ptr<const nc::cloud::FileCipher> cipher_for(std::string_view user
    ) const
    {
        if (m_encryption_key.empty()) {
            return nullptr;
        }
        return std::make_shared<const nc::cloud::FileCipher>(
            std::string{m_encryption_key},
            std::string{user}
        );
    }

    [[nodiscard]] Storage trash_for(std::string_view user) const
    {
        return Storage{
            std::filesystem::path{m_data_dir} / std::string{user} / "files_trashbin",
            0,
            cipher_for(user)
        };
    }

    [[nodiscard]] Storage versions_for(std::string_view user) const
    {
        return Storage{
            std::filesystem::path{m_data_dir} / std::string{user} / "files_versions",
            0,
            cipher_for(user)
        };
    }

    /// Other plugins step in here: the trash bin takes a deleted file, the versions plugin keeps
    /// the old content of an overwritten one. Without them the files are simply deleted or
    /// overwritten.
    [[nodiscard]] nc::cloud::Hooks hooks() const
    {
        nc::cloud::Hooks hooks;
        hooks.before_delete = [this](const std::string& user, const std::string& path)
        {
            return m_host
                       ->call_service(
                           "trashbin.before_delete",
                           nc::util::form_encode({{"user", user}, {"path", path}})
                       )
                       .get_status() == 200;
        };
        hooks.before_overwrite = [this](const std::string& user, const std::string& path)
        {
            (void)m_host->call_service(
                "versions.before_write",
                nc::util::form_encode({{"user", user}, {"path", path}})
            );
        };
        return hooks;
    }

    /// Earlier versions kept the shares in `<data_dir>/shares.db`, a text file. The first start
    /// with the database takes them over (ids kept) and renames the file, so it is read once.
    void import_legacy_shares()
    {
        const std::string file = m_data_dir + "/shares.db";
        std::error_code ignored;
        if (!std::filesystem::exists(file, ignored)) {
            return;
        }
        auto old = nc::cloud::ShareStore::read_legacy_file(file);
        if (!old) {
            throw std::runtime_error(old.error());
        }
        if (m_shares->all().empty()) {
            if (auto imported = m_shares->import_all(std::move(*old)); !imported) {
                throw std::runtime_error(imported.error());
            }
        }
        std::filesystem::rename(file, file + ".imported", ignored);
    }

    /// Services for the trash bin and the versions plugin: they keep the records, this plugin keeps
    /// the bytes, so all file system access stays behind `Storage`.
    void add_storage_services(nc::Host& host)
    {
        // id, token: the other server declined or withdrew a share made with it. The token must
        // fit, so only the server that holds it can remove the share.
        host.add_service(
            "cloud.remove_remote_share",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const auto share = m_shares->find(
                    std::strtoull(nc::util::form_value(form, "id").c_str(), nullptr, 10)
                );
                if (!share || share->get_type() != nc::cloud::SHARE_TYPE_REMOTE ||
                    !nc::util::constant_time_equals(
                        share->get_token(),
                        nc::util::form_value(form, "token")
                    )) {
                    return Response::text(404, "no such share");
                }
                (void)m_shares->remove(share->get_id());
                return Response::text(200, "ok");
            }
        );
        // user, path: does it exist? Answers size and dir.
        host.add_service(
            "cloud.stat",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                if (!safe_user(user)) {
                    return Response::text(400, "bad user");
                }
                const Storage files = storage_for(user);
                const auto node = files.stat(nc::util::form_value(form, "path"));
                if (!node) {
                    return Response::text(404, "not found");
                }
                return Response::text(
                    200,
                    nc::util::form_encode(
                        {{"path", node->get_path()},
                         {"etag", node->get_etag()},
                         {"size", std::to_string(files.size_of(node->get_path()).value_or(0))},
                         {"dir", node->is_directory() ? "1" : "0"}}
                    )
                );
            }
        );
        // user, path: the content of a file (decrypted), at most 64 MiB. For plugins that derive
        // something from a file, such as previews.
        host.add_service(
            "cloud.read",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                if (!safe_user(user)) {
                    return Response::text(400, "bad user");
                }
                const Storage files = storage_for(user);
                const auto node = files.stat(nc::util::form_value(form, "path"));
                if (!node || node->is_directory()) {
                    return Response::text(404, "not a file");
                }
                if (node->get_size() > 64U * 1'024U * 1'024U) {
                    return Response::text(413, "too large");
                }
                auto data = files.read(node->get_path());
                return data ? Response{200, "application/octet-stream", std::move(*data), {}}
                            : Response::text(500, data.error().get_message());
            }
        );
        // owner, path, user: may `user` see the item of `owner` (as owner, or through a share of it
        // or of a folder above it)?
        host.add_service(
            "cloud.can_access",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string owner = nc::util::form_value(form, "owner");
                const std::string user = nc::util::form_value(form, "user");
                const auto path = Storage::normalize(nc::util::form_value(form, "path"));
                if (!path || !safe_user(owner) || !storage_for(owner).stat(*path)) {
                    return Response::text(404, "not found");
                }
                if (owner == user) {
                    return Response::text(200, "owner");
                }
                for (const Share& share: m_shares->owned_by(owner)) {
                    const bool covers =
                        *path == share.get_path() || share.get_path() == "/" ||
                        path->compare(0, share.get_path().size() + 1, share.get_path() + "/") == 0;
                    if (covers && !share.expired(now_seconds()) && is_recipient(share, user)) {
                        return Response::text(200, "share");
                    }
                }
                return Response::text(403, "no access");
            }
        );
        // user, path, name: move the file into the user's trash as `name`. Answers size and dir.
        host.add_service(
            "cloud.trash.put",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                if (!safe_user(user)) {
                    return Response::text(400, "bad user");
                }
                const Storage files = storage_for(user);
                const auto node = files.stat(nc::util::form_value(form, "path"));
                if (!node) {
                    return Response::text(404, "not found");
                }
                const std::uint64_t size = files.size_of(node->get_path()).value_or(0);
                const auto moved = files.move_to(
                    trash_for(user),
                    node->get_path(),
                    "/" + nc::util::form_value(form, "name")
                );
                if (!moved) {
                    return Response::text(500, moved.error().get_message());
                }
                return Response::text(
                    200,
                    nc::util::form_encode(
                        {{"size", std::to_string(size)}, {"dir", node->is_directory() ? "1" : "0"}}
                    )
                );
            }
        );
        // user, name, target: put it back; if the place is taken, next to it as "... (restored)".
        host.add_service(
            "cloud.trash.restore",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                if (!safe_user(user)) {
                    return Response::text(400, "bad user");
                }
                const auto target = Storage::normalize(nc::util::form_value(form, "target"));
                if (!target || *target == "/") {
                    return Response::text(400, "bad target");
                }
                const Storage files = storage_for(user);
                (void)files.ensure_root();
                std::string destination = *target;
                const std::size_t slash = destination.rfind('/');
                if (slash > 0 && !files.stat(destination.substr(0, slash))) {
                    destination =
                        "/" +
                        destination.substr(slash + 1); // the folder is gone: restore to the top
                }
                for (int attempt = 0; files.stat(destination) && attempt < 100; ++attempt) {
                    destination = *target + " (restored" +
                                  (attempt == 0 ? "" : " " + std::to_string(attempt + 1)) + ")";
                }
                const auto moved = trash_for(user).move_to(
                    files,
                    "/" + nc::util::form_value(form, "name"),
                    destination
                );
                if (!moved) {
                    return Response::text(
                        moved.error().get_code() == nc::cloud::StorageCode::NOT_FOUND ? 404 : 500,
                        moved.error().get_message()
                    );
                }
                return Response::text(200, destination);
            }
        );
        host.add_service(
            "cloud.trash.purge",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                if (!safe_user(user)) {
                    return Response::text(400, "bad user");
                }
                const auto removed =
                    trash_for(user).remove("/" + nc::util::form_value(form, "name"));
                return removed ? Response::text(200, "") : Response::text(404, "not found");
            }
        );
        // user, path, name: keep a copy of the current content of a file.
        host.add_service(
            "cloud.version.put",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                if (!safe_user(user)) {
                    return Response::text(400, "bad user");
                }
                const Storage files = storage_for(user);
                const std::string path = nc::util::form_value(form, "path");
                const auto node = files.stat(path);
                if (!node || node->is_directory()) {
                    return Response::text(404, "not a file");
                }
                const auto copied = files.copy_to(
                    versions_for(user),
                    path,
                    "/" + nc::util::form_value(form, "name")
                );
                return copied ? Response::text(200, std::to_string(node->get_size()))
                              : Response::text(500, copied.error().get_message());
            }
        );
        // user, name, path: write the kept content back as the file.
        host.add_service(
            "cloud.version.restore",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                if (!safe_user(user)) {
                    return Response::text(400, "bad user");
                }
                const auto data = versions_for(user).read("/" + nc::util::form_value(form, "name"));
                if (!data) {
                    return Response::text(404, "no such version");
                }
                const auto written =
                    storage_for(user).write(nc::util::form_value(form, "path"), *data);
                return written ? Response::text(200, "")
                               : Response::text(500, written.error().get_message());
            }
        );
        host.add_service(
            "cloud.version.purge",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string user = nc::util::form_value(form, "user");
                if (!safe_user(user)) {
                    return Response::text(400, "bad user");
                }
                return versions_for(user).remove("/" + nc::util::form_value(form, "name"))
                           ? Response::text(200, "")
                           : Response::text(404, "no such version");
            }
        );
    }

    [[nodiscard]] nc::cloud::Publish publisher() const
    {
        return [this](std::string_view topic, std::string_view payload)
        {
            m_host->publish(topic, payload);
        };
    }

    // ---- WebDAV ---------------------------------------------------------------------------------

    // ---- chunked uploads
    // --------------------------------------------------------------------------
    //
    // The sync clients cut big files into chunks: MKCOL /remote.php/dav/uploads/<user>/<id>, PUT
    // each chunk as .../<id>/<number>, then MOVE .../<id>/.file to the real path. Chunks wait
    // outside the user's files, the assembled file goes through the normal write (quota,
    // encryption, versions, events).

    [[nodiscard]] std::filesystem::path upload_dir(const std::string& user) const
    {
        return std::filesystem::path{m_data_dir} / user / "uploads";
    }

    [[nodiscard]] static bool valid_upload_name(std::string_view name) noexcept
    {
        return !name.empty() && name.size() <= 64 && name != "." && name != ".." &&
               std::ranges::all_of(
                   name,
                   [](unsigned char letter)
                   {
                       return std::isalnum(letter) != 0 || letter == '_' || letter == '-' ||
                              letter == '.';
                   }
               );
    }

    void add_upload_routes(nc::Host& host)
    {
        static constexpr std::string_view METHODS[] =
            {"MKCOL", "PUT", "MOVE", "DELETE", "PROPFIND"};
        for (const std::string_view method: METHODS) {
            host.add_route(
                method,
                "/remote.php/dav/uploads/{user}/{id}",
                [this](const Request& request)
                {
                    return serve_upload(request);
                }
            );
            host.add_route(
                method,
                "/remote.php/dav/uploads/{user}/{id}/{chunk}",
                [this](const Request& request)
                {
                    return serve_upload(request);
                }
            );
        }
        host.add_job(
            "expire-uploads",
            3'600,
            [this]()
            {
                // Half-finished uploads older than a day are removed.
                std::error_code error;
                for (const auto& user: std::filesystem::directory_iterator{m_data_dir, error}) {
                    const auto root = user.path() / "uploads";
                    for (const auto& upload: std::filesystem::directory_iterator{root, error}) {
                        const auto age = std::filesystem::file_time_type::clock::now() -
                                         upload.last_write_time(error);
                        if (!error && age > std::chrono::hours{24}) {
                            std::filesystem::remove_all(upload.path(), error);
                        }
                    }
                }
            }
        );
    }

    [[nodiscard]] Response serve_upload(const Request& request) const
    {
        const std::string& user = request.get_user();
        if (user.empty()) {
            return nc::http::unauthorized();
        }
        if (request.param("user") != user || !safe_user(user)) {
            return Response::text(403, "You can only use your own uploads");
        }
        const std::string id{request.param("id")};
        const std::string chunk{request.param("chunk")};
        if (!valid_upload_name(id) ||
            (!chunk.empty() && chunk != ".file" && !valid_upload_name(chunk))) {
            return Response::text(400, "Bad name");
        }
        namespace fs = std::filesystem;
        const fs::path dir = upload_dir(user) / id;
        const std::string& method = request.get_method();
        std::error_code error;

        if (chunk.empty()) {
            if (method == "MKCOL") {
                if (fs::exists(dir, error)) {
                    return Response::text(405, "The upload already exists");
                }
                fs::create_directories(dir, error);
                return error ? Response::text(500, "cannot create the upload") : Response{201};
            }
            if (method == "DELETE") {
                return fs::remove_all(dir, error) > 0 ? Response{204}
                                                      : Response::text(404, "No such upload");
            }
            if (method == "PROPFIND") {
                if (!fs::is_directory(dir, error)) {
                    return Response::text(404, "No such upload");
                }
                std::string body = "<?xml version=\"1.0\"?>\n<d:multistatus xmlns:d=\"DAV:\">\n";
                std::vector<std::string> names;
                for (const auto& entry: fs::directory_iterator{dir, error}) {
                    names.push_back(entry.path().filename().string());
                }
                std::ranges::sort(names);
                for (const std::string& name: names) {
                    body += " <d:response><d:href>/remote.php/dav/uploads/" +
                            nc::util::xml_escape(user) + "/" + nc::util::xml_escape(id) + "/" +
                            nc::util::xml_escape(name) +
                            "</d:href><d:propstat><d:prop><d:getcontentlength>" +
                            std::to_string(fs::file_size(dir / name, error)) +
                            "</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 "
                            "OK</d:status></d:propstat></d:response>\n";
                }
                return Response::xml(207, body + "</d:multistatus>\n");
            }
            return Response::text(405, "Method Not Allowed");
        }

        if (!fs::is_directory(dir, error)) {
            return Response::text(404, "No such upload");
        }
        if (method == "PUT" && chunk != ".file") {
            if (request.get_body().size() > m_max_chunk) {
                return Response::text(413, "The chunk is too large");
            }
            const bool existed = fs::exists(dir / chunk, error);
            std::ofstream out{dir / chunk, std::ios::binary | std::ios::trunc};
            out.write(
                request.get_body().data(),
                static_cast<std::streamsize>(request.get_body().size())
            );
            out.flush();
            return out ? Response{existed ? 204 : 201}
                       : Response::text(500, "cannot store the chunk");
        }
        if (method == "DELETE" && chunk != ".file") {
            return fs::remove(dir / chunk, error) ? Response{204}
                                                  : Response::text(404, "No such chunk");
        }
        if (method == "MOVE" && chunk == ".file") {
            const std::string base = "/remote.php/dav/files/" + user;
            const std::string target =
                nc::cloud::destination_of(request.header("Destination"), base);
            if (target.empty() || target == "/") {
                return Response::text(502, "The destination is not inside this account");
            }
            std::vector<std::string> names;
            for (const auto& entry: fs::directory_iterator{dir, error}) {
                names.push_back(entry.path().filename().string());
            }
            if (names.empty()) {
                return Response::text(409, "Nothing was uploaded");
            }
            // Chunk names are numbers in the clients ("00001"): order them as numbers, else as
            // text.
            const bool numeric = std::ranges::all_of(
                names,
                [](const std::string& name)
                {
                    return name.find_first_not_of("0123456789") == std::string::npos;
                }
            );
            std::ranges::sort(
                names,
                [numeric](const std::string& a, const std::string& b)
                {
                    return numeric ? (std::stoull(a) < std::stoull(b)) : a < b;
                }
            );
            std::string assembled;
            for (const std::string& name: names) {
                std::ifstream in{dir / name, std::ios::binary};
                std::ostringstream part;
                part << in.rdbuf();
                assembled += part.str();
                if (assembled.size() > m_max_upload) {
                    return Response::text(413, "The file is larger than this server accepts");
                }
            }
            const std::string_view total = request.header("OC-Total-Length");
            if (!total.empty() &&
                std::strtoull(std::string{total}.c_str(), nullptr, 10) != assembled.size()) {
                return Response::text(409, "The chunks do not add up to OC-Total-Length");
            }
            const Storage files = storage_for(user);
            (void)files.ensure_root();
            if (const auto existing = files.stat(target); existing && !existing->is_directory()) {
                (void)hooks().before_overwrite(user, target);
            }
            const auto written = files.write(target, assembled);
            if (!written) {
                return Response::text(
                    nc::cloud::http_status(written.error()),
                    written.error().get_message()
                );
            }
            fs::remove_all(dir, error);
            m_host->publish(
                *written ? "file.created" : "file.updated",
                nc::util::form_encode({{"user", user}, {"path", target}})
            );
            return Response{*written ? 201 : 204};
        }
        return Response::text(405, "Method Not Allowed");
    }

    void add_dav_routes(nc::Host& host)
    {
        static constexpr std::string_view METHODS[] =
            {"GET", "PUT", "DELETE", "MKCOL", "MOVE", "COPY", "PROPFIND"};
        for (const std::string_view method: METHODS) {
            host.add_route(
                method,
                "/remote.php/dav/files/{user}/{*path}",
                [this](const Request& request)
                {
                    return serve_dav(request, false);
                }
            );
            host.add_route(
                method,
                "/remote.php/webdav/{*path}",
                [this](const Request& request)
                {
                    return serve_dav(request, true);
                }
            );
        }
    }

    [[nodiscard]] Response serve_dav(const Request& request, bool legacy) const
    {
        const std::string& user = request.get_user();
        if (user.empty()) {
            return nc::http::unauthorized();
        }
        std::string base = "/remote.php/webdav";
        if (!legacy) {
            const std::string_view owner = request.param("user");
            if (owner != user) {
                return Response::text(403, "You can only reach your own files");
            }
            base = "/remote.php/dav/files/" + std::string{owner};
        }
        if (!safe_user(user)) {
            return Response::text(403, "Forbidden");
        }
        const std::string path{request.param("path")};
        const std::vector<Mount> mounts = mounts_for(user);
        if (!mounts.empty()) {
            const auto normalized = Storage::normalize("/" + path);
            if (normalized) {
                const std::size_t slash = normalized->find('/', 1);
                const std::string first = normalized->substr(
                    1,
                    slash == std::string::npos ? std::string::npos : slash - 1
                );
                for (const Mount& mount: mounts) {
                    if (mount.name == first) {
                        return serve_mount(
                            request,
                            mount,
                            slash == std::string::npos ? std::string{} : normalized->substr(slash),
                            base
                        );
                    }
                }
                if (*normalized == "/" && request.get_method() == "PROPFIND" &&
                    request.header("Depth") != "0") {
                    return with_mounts(
                        nc::cloud::dav_handle(
                            request,
                            storage_for(user),
                            nc::cloud::DavTarget{
                                std::string{user},
                                std::string{base},
                                std::string{path}
                            },
                            publisher(),
                            hooks()
                        ),
                        mounts,
                        base
                    );
                }
            }
        }
        return nc::cloud::dav_handle(
            request,
            storage_for(user),
            nc::cloud::DavTarget{std::string{user}, std::move(base), std::string{path}},
            publisher(),
            hooks()
        );
    }

    // ---- received shares appear in the recipient's tree
    // --------------------------------------------

    /// A share somebody made with `user` (directly or through a group), still valid.
    [[nodiscard]] bool is_recipient(const Share& share, const std::string& user) const
    {
        if (share.get_type() == nc::cloud::SHARE_TYPE_USER) {
            return share.get_share_with() == user;
        }
        return share.get_type() == nc::cloud::SHARE_TYPE_GROUP &&
               m_host->call_service(
                         "groups.is_member",
                         nc::util::form_encode({{"group", share.get_share_with()}, {"user", user}})
               ).get_status() == 200;
    }

    [[nodiscard]] std::vector<Share> received_shares(const std::string& user) const
    {
        std::vector<Share> out;
        for (const Share& share: m_shares->all()) {
            if (share.get_owner() != user && is_recipient(share, user)) {
                out.push_back(share);
            }
        }
        return out;
    }

    /// `Name=/host/path:ro` or `:rw`, optionally `:group`; several separated by `;`. A name must be
    /// a plain file name and the path an existing absolute folder, else the entry is ignored and
    /// logged.
    void parse_external(const std::string& text)
    {
        for (const std::string& entry: nc::util::split(text, ';')) {
            if (nc::util::trim(entry).empty()) {
                continue;
            }
            const std::size_t equals = entry.find('=');
            const std::vector<std::string> parts = nc::util::split(
                equals == std::string::npos ? std::string{} : entry.substr(equals + 1),
                ':'
            );
            const std::string name{nc::util::trim(entry.substr(0, equals))};
            std::error_code error;
            if (equals == std::string::npos || parts.size() < 2 || parts.size() > 3 ||
                !Storage::normalize("/" + name) || name.find('/') != std::string::npos ||
                name == "." || name == ".." || parts[0].empty() || parts[0].front() != '/' ||
                !std::filesystem::is_directory(parts[0], error) ||
                (parts[1] != "ro" && parts[1] != "rw")) {
                m_host->log(nc::LogLevel::WARNING, "ignoring external mount: " + entry);
                continue;
            }
            m_external.push_back(External{
                name,
                parts[0],
                nc::util::trim(parts[1]) == "rw" ? 31 : 1,
                parts.size() == 3 ? std::string{nc::util::trim(parts[2])} : std::string{}
            });
        }
    }

    /// One received share as the recipient sees it: a name in the top folder, and where it really
    /// is.
    struct Mount
    {
        Share share{};
        std::string name{};
        bool directory{false};
        /// Set for an external storage (a folder of the host an administrator configured): then
        /// `share` is unused.
        std::filesystem::path external_root{};
        int external_permissions{1};
        /// Set for a share from another server (federation): the id the federation plugin knows it
        /// by. Then `share` is unused too.
        std::uint64_t remote_id{0};
    };

    [[nodiscard]] std::vector<Mount> mounts_for(const std::string& user) const
    {
        std::vector<Mount> mounts;
        const Storage own = storage_for(user);
        for (const Share& share: received_shares(user)) {
            if (share.expired(now_seconds()) || !safe_user(share.get_owner())) {
                continue;
            }
            const auto node = storage_for(share.get_owner()).stat(share.get_path());
            if (!node) {
                continue;
            }
            // The name is the shared item's name; a clash with the user's own entries or another
            // share gets a number, like "report (2).txt".
            const std::string base_name = node->name();
            const std::size_t dot = node->is_directory() ? std::string::npos : base_name.rfind('.');
            std::string name = base_name;
            for (int attempt = 2; attempt < 1'000; ++attempt) {
                const bool taken =
                    own.stat("/" + name).has_value() || std::ranges::any_of(
                                                            mounts,
                                                            [&](const Mount& other)
                                                            {
                                                                return other.name == name;
                                                            }
                                                        );
                if (!taken) {
                    break;
                }
                name = dot == std::string::npos || dot == 0
                           ? base_name + " (" + std::to_string(attempt) + ")"
                           : base_name.substr(0, dot) + " (" + std::to_string(attempt) + ")" +
                                 base_name.substr(dot);
            }
            mounts.push_back(Mount{share, name, node->is_directory(), {}, 1, 0});
        }
        for (const External& external: m_external) {
            if (!external.group.empty() &&
                m_host->call_service(
                          "groups.is_member",
                          nc::util::form_encode({{"group", external.group}, {"user", user}})
                ).get_status() != 200) {
                continue;
            }
            std::string name = external.name;
            for (int attempt = 2; attempt < 1'000; ++attempt) {
                const bool taken =
                    own.stat("/" + name).has_value() || std::ranges::any_of(
                                                            mounts,
                                                            [&](const Mount& other)
                                                            {
                                                                return other.name == name;
                                                            }
                                                        );
                if (!taken) {
                    break;
                }
                name = external.name + " (" + std::to_string(attempt) + ")";
            }
            mounts.push_back(Mount{Share{}, name, true, external.path, external.permissions, 0});
        }
        // Shares from other servers the user accepted.
        const Response remote =
            m_host->call_service("federation.mounts", nc::util::form_encode({{"user", user}}));
        if (remote.get_status() == 200) {
            for (const std::string& line: nc::util::split(remote.get_body(), '\n')) {
                const auto form = nc::util::parse_form(line);
                const std::uint64_t id =
                    std::strtoull(nc::util::form_value(form, "id").c_str(), nullptr, 10);
                const std::string base_name = nc::util::form_value(form, "name");
                if (id == 0 || !Storage::normalize("/" + base_name) || base_name.empty()) {
                    continue;
                }
                const bool directory = nc::util::form_value(form, "directory") == "1";
                const std::size_t dot = directory ? std::string::npos : base_name.rfind('.');
                std::string name = base_name;
                for (int attempt = 2; attempt < 1'000; ++attempt) {
                    const bool taken =
                        own.stat("/" + name).has_value() || std::ranges::any_of(
                                                                mounts,
                                                                [&](const Mount& other)
                                                                {
                                                                    return other.name == name;
                                                                }
                                                            );
                    if (!taken) {
                        break;
                    }
                    name = dot == std::string::npos || dot == 0
                               ? base_name + " (" + std::to_string(attempt) + ")"
                               : base_name.substr(0, dot) + " (" + std::to_string(attempt) + ")" +
                                     base_name.substr(dot);
                }
                mounts.push_back(Mount{Share{}, name, directory, {}, 1, id});
            }
        }
        return mounts;
    }

    /// The listing of the top folder plus one entry per mount.
    [[nodiscard]] Response
    with_mounts(Response listing, const std::vector<Mount>& mounts, const std::string& base) const
    {
        if (listing.get_status() != 207) {
            return listing;
        }
        std::vector<nc::cloud::Node> nodes;
        for (const Mount& mount: mounts) {
            // A share from another server has no file here; its entry is made up.
            std::optional<nc::cloud::Node> node;
            if (mount.remote_id != 0) {
                node = nc::cloud::Node{"/" + mount.name, mount.directory};
            } else if (auto found =
                           mount.external_root.empty()
                               ? storage_for(mount.share.get_owner()).stat(mount.share.get_path())
                               : Storage{mount.external_root}.stat("/")) {
                node = std::move(*found);
            }
            if (!node) {
                continue;
            }
            node->set_path("/" + mount.name);
            if (node->is_directory() && mount.remote_id == 0) {
                // The size of what is inside, so the top-level listing shows it.
                node->set_size(
                    mount.external_root.empty()
                        ? storage_for(mount.share.get_owner())
                              .size_of(mount.share.get_path())
                              .value_or(0)
                        : Storage{mount.external_root}.size_of("/").value_or(0)
                );
            }
            nodes.push_back(*node);
        }
        std::string extra;
        for (const nc::cloud::Node& node: nodes) {
            const Mount& mount = *std::ranges::find_if(
                mounts,
                [&](const Mount& m)
                {
                    return "/" + m.name == node.get_path();
                }
            );
            std::string one = nc::cloud::multistatus(
                {node},
                base,
                mount.share.get_owner(),
                Storage{std::filesystem::path{"/nonexistent"}}
            );
            // multistatus() wraps its answer; keep only the <d:response> elements. (The size of a
            // mounted folder is not worked out here: it reads 0 in the listing of the top folder.)
            const std::size_t begin = one.find(" <d:response>");
            const std::size_t end = one.rfind("</d:multistatus>");
            if (begin != std::string::npos && end != std::string::npos) {
                extra += one.substr(begin, end - begin);
            }
        }
        std::string body = listing.get_body();
        const std::size_t close = body.rfind("</d:multistatus>");
        if (close != std::string::npos) {
            body.insert(close, extra);
        }
        listing.set_body(std::move(body));
        return listing;
    }

    /// Serves a request inside an external storage: the configured host folder is the root,
    /// read-only or read-write for everybody who can see it. Nothing is recorded in a trash bin or
    /// versions.
    [[nodiscard]] Response serve_external(
        const Request& request,
        const Mount& mount,
        const std::string& rest,
        const std::string& base
    ) const
    {
        const std::string& method = request.get_method();
        const bool writable = mount.external_permissions > 1;
        if (method == "PUT" || method == "MKCOL" || method == "DELETE" || method == "MOVE" ||
            method == "COPY") {
            if (!writable || rest.empty()) {
                return Response::text(403, "This storage is read-only");
            }
        } else if (method != "GET" && method != "PROPFIND") {
            return Response::text(405, "Method Not Allowed");
        }
        const std::string user = request.get_user();
        const std::string name = mount.name;
        nc::cloud::Publish publish =
            [this, user, name](std::string_view topic, std::string_view payload)
        {
            auto form = nc::util::parse_form(payload);
            for (auto& [key, value]: form) {
                if (key == "user") {
                    value = user;
                } else if (key == "path" || key == "target") {
                    value = "/" + name + (value == "/" ? "" : value);
                }
            }
            m_host->publish(topic, nc::util::form_encode(form));
        };
        return nc::cloud::dav_handle(
            request,
            Storage{mount.external_root},
            nc::cloud::DavTarget{
                std::string{user},
                base + "/" + nc::util::url_encode_path(mount.name),
                std::string{rest}
            },
            publish
        );
    }

    /// Serves a request inside a share from another server: only reading, through the federation
    /// plugin, which asks the owner's server. The answer is held in memory, so it has the size
    /// limit of that plugin's client.
    [[nodiscard]] Response serve_remote(
        const Request& request,
        const Mount& mount,
        const std::string& rest,
        const std::string& base
    ) const
    {
        const std::string& method = request.get_method();
        if (method != "GET" && method != "PROPFIND") {
            return Response::text(
                method == "PUT" || method == "MKCOL" || method == "DELETE" || method == "MOVE" ||
                        method == "COPY"
                    ? 403
                    : 405,
                "A share from another server is read-only here"
            );
        }
        const std::string mount_base = base + "/" + nc::util::url_encode_path(mount.name);
        Response answer = m_host->call_service(
            "federation.fetch",
            nc::util::form_encode(
                {{"id", std::to_string(mount.remote_id)},
                 {"user", request.get_user()},
                 {"method", method},
                 {"path", rest},
                 {"depth", std::string{request.header("Depth")}},
                 {"href_base", mount.directory ? mount_base : base}}
            )
        );
        const int status = answer.get_status();
        if (status != 200 && status != 207) {
            return Response::text(status >= 400 ? status : 502, answer.get_body());
        }
        if (method == "PROPFIND") {
            return Response{
                207,
                "application/xml; charset=utf-8",
                std::string{answer.get_body()},
                {}
            };
        }
        const std::string name = rest.empty() ? mount.name : rest.substr(rest.rfind('/') + 1);
        std::string safe_name = name;
        std::ranges::replace(safe_name, '"', '_');
        return Response{
            200,
            std::string{nc::util::mime_type_for(name)},
            std::string{answer.get_body()},
            {{"Content-Disposition", "attachment; filename=\"" + safe_name + "\""},
             {"X-Content-Type-Options", "nosniff"}}
        };
    }

    /// Serves a request inside a mounted share: the owner's folder is the root, and the share's
    /// permissions (1 read, 2 update, 4 create, 8 delete) decide what is allowed.
    [[nodiscard]] Response serve_mount(
        const Request& request,
        const Mount& mount,
        const std::string& rest,
        const std::string& base
    ) const
    {
        if (!mount.external_root.empty()) {
            return serve_external(request, mount, rest, base);
        }
        if (mount.remote_id != 0) {
            return serve_remote(request, mount, rest, base);
        }
        const Share& share = mount.share;
        const std::string& method = request.get_method();
        const int permissions = share.get_permissions();
        const Storage owner_files = storage_for(share.get_owner());
        const auto denied = []
        {
            return Response::text(403, "The share does not allow this");
        };

        // A shared file is a mount of one file: read it, or replace it with update permission.
        const std::string parent = share.get_path().substr(0, share.get_path().rfind('/'));
        const std::string mount_base = base + "/" + nc::util::url_encode_path(mount.name);
        // What a recipient writes counts against the owner's quota, measured over the owner's whole
        // tree.
        const std::filesystem::path owner_root =
            std::filesystem::path{m_data_dir} / share.get_owner() / "files";
        Storage root{
            mount.directory ? owner_root / share.get_path().substr(1)
                            : owner_root / (parent.empty() ? "" : parent.substr(1)),
            m_quota,
            cipher_for(share.get_owner())
        };
        root.set_quota_root(owner_root);
        std::string inner = rest;
        std::string href_base = mount_base;
        if (!mount.directory) {
            if (!rest.empty()) {
                return Response::text(404, "Not Found");
            }
            inner = "/" + share.get_path().substr(share.get_path().rfind('/') + 1);
            href_base = base; // the single node is reported as /<base>/<name> by the storage path
        }

        // What the method needs.
        if (method == "PUT") {
            const bool exists = root.stat(mount.directory ? inner : inner).has_value();
            if (!(permissions & (exists ? 2 : 4)) || (!mount.directory && !exists)) {
                return denied();
            }
        } else if (method == "MKCOL") {
            if (!(permissions & 4) || !mount.directory || inner.empty()) {
                return denied();
            }
        } else if (method == "DELETE") {
            if (!(permissions & 8) || !mount.directory || inner.empty()) {
                return denied();
            }
        } else if (method == "MOVE" || method == "COPY") {
            if (!mount.directory || inner.empty() || !(permissions & 4) ||
                (method == "MOVE" && !(permissions & 8))) {
                return denied();
            }
        } else if (method != "GET" && method != "PROPFIND") {
            return Response::text(405, "Method Not Allowed");
        }

        // Changes belong to the owner's tree: events, trash and versions use the owner and the
        // owner's path.
        const std::string prefix = mount.directory ? share.get_path() : parent;
        nc::cloud::Publish publish = [this,
                                      owner = share.get_owner(),
                                      prefix](std::string_view topic, std::string_view payload)
        {
            auto form = nc::util::parse_form(payload);
            for (auto& [key, value]: form) {
                if (key == "user") {
                    value = owner;
                } else if (key == "path" || key == "target") {
                    value = prefix + (value == "/" ? "" : value);
                }
            }
            m_host->publish(topic, nc::util::form_encode(form));
        };
        nc::cloud::Hooks hooks = this->hooks();
        hooks.before_delete =
            [this, owner = share.get_owner(), prefix](const std::string&, const std::string& path)
        {
            return m_host
                       ->call_service(
                           "trashbin.before_delete",
                           nc::util::form_encode({{"user", owner}, {"path", prefix + path}})
                       )
                       .get_status() == 200;
        };
        hooks.before_overwrite =
            [this, owner = share.get_owner(), prefix](const std::string&, const std::string& path)
        {
            (void)m_host->call_service(
                "versions.before_write",
                nc::util::form_encode({{"user", owner}, {"path", prefix + path}})
            );
        };
        return nc::cloud::dav_handle(
            request,
            root,
            nc::cloud::DavTarget{
                std::string{request.get_user()},
                std::move(href_base),
                std::move(inner)
            },
            publish,
            hooks
        );
    }

    // ---- shares ---------------------------------------------------------------------------------

    [[nodiscard]] std::string base_url(const Request& request) const
    {
        if (!m_public_url.empty()) {
            return m_public_url;
        }
        const std::string_view host_header = request.header("Host");
        return host_header.empty() ? std::string{} : "http://" + std::string{host_header};
    }

    [[nodiscard]] std::string share_json(const Share& share, const Request& request) const
    {
        const auto node = storage_for(share.get_owner()).stat(share.get_path());
        const bool link = share.get_type() == nc::cloud::SHARE_TYPE_LINK ||
                          share.get_type() == nc::cloud::SHARE_TYPE_EMAIL;
        std::string json = R"({"id":")" + std::to_string(share.get_id()) + R"(","share_type":)" +
                           std::to_string(share.get_type());
        json += R"(,"uid_owner":)" + json_string(share.get_owner()) + R"(,"path":)" +
                json_string(share.get_path());
        json += R"(,"item_type":")" +
                std::string{node && node->is_directory() ? "folder" : "file"} +
                R"(","permissions":)" + std::to_string(share.get_permissions());
        json += R"(,"share_with":)" +
                (link ? std::string{"null"} : json_string(share.get_share_with()));
        if (link) {
            json += R"(,"token":)" + json_string(share.get_token()) + R"(,"url":)" +
                    json_string(base_url(request) + "/s/" + share.get_token());
        }
        json += std::string{R"(,"password_protected":)"} +
                (share.get_password().empty() ? "false" : "true");
        json += R"(,"expiration":)" + (share.get_expires() == 0
                                           ? std::string{"null"}
                                           : json_string(format_time(share.get_expires())));
        json += R"(,"stime":)" + std::to_string(share.get_created()) + "}";
        return json;
    }

    void add_share_routes(nc::Host& host)
    {
        constexpr std::string_view BASE = "/ocs/v2.php/apps/files_sharing/api/v1/shares";

        host.add_route(
            "POST",
            BASE,
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto form = nc::util::parse_form(request.get_body());
                const auto field = [&](std::string_view name)
                {
                    std::string value = nc::util::form_value(form, name);
                    return value.empty() ? request.query_value(name) : value;
                };
                const std::string owner = request.get_user();
                const auto path = Storage::normalize(field("path"));
                if (!path || *path == "/") {
                    return failure(404, "Wrong path, file/folder does not exist");
                }
                if (!safe_user(owner) || !storage_for(owner).stat(*path)) {
                    return failure(404, "Wrong path, file/folder does not exist");
                }
                const std::string type_text = field("shareType");
                const int type =
                    type_text.empty() ? nc::cloud::SHARE_TYPE_USER : std::atoi(type_text.c_str());
                Share share{std::string{owner}, std::string{*path}};
                share.set_type(type);
                if (type == nc::cloud::SHARE_TYPE_USER) {
                    const std::string recipient = field("shareWith");
                    if (recipient == owner) {
                        return failure(400, "Cannot share with yourself");
                    }
                    if (recipient.empty() ||
                        m_host->call_service("users.get", recipient).get_status() != 200) {
                        return failure(404, "Wrong share recipient");
                    }
                    share.set_share_with(std::string{recipient});
                    const std::string permissions = field("permissions");
                    const int mask = permissions.empty() ? 31 : std::atoi(permissions.c_str());
                    if (mask < 1 || mask > 31) {
                        return failure(400, "Invalid permissions");
                    }
                    share.set_permissions(mask);
                } else if (type == nc::cloud::SHARE_TYPE_GROUP) {
                    const std::string group = field("shareWith");
                    if (group.empty() ||
                        m_host->call_service("groups.exists", group).get_status() != 200) {
                        return failure(404, "Wrong share recipient");
                    }
                    share.set_share_with(std::string{group});
                    const std::string permissions = field("permissions");
                    const int mask = permissions.empty() ? 31 : std::atoi(permissions.c_str());
                    if (mask < 1 || mask > 31) {
                        return failure(400, "Invalid permissions");
                    }
                    share.set_permissions(mask);
                } else if (type == nc::cloud::SHARE_TYPE_LINK ||
                           type == nc::cloud::SHARE_TYPE_EMAIL) {
                    if (type == nc::cloud::SHARE_TYPE_EMAIL) {
                        // The link goes to this address only; it is mailed once the share exists.
                        const std::string address = field("shareWith");
                        const int valid =
                            m_host->call_service("mail.validate", address).get_status();
                        if (valid == 404) {
                            return failure(501, "Sharing by mail is not enabled");
                        }
                        if (valid != 200) {
                            return failure(400, "Use a valid email address to share by mail");
                        }
                        share.set_share_with(std::string{address});
                    }
                    // 1 read only (default), 4 upload only ("file drop"), 5 read and upload; the
                    // last two need a folder.
                    const std::string permissions = field("permissions");
                    const int mask = permissions.empty() ? 1 : std::atoi(permissions.c_str());
                    const auto shared = storage_for(owner).stat(*path);
                    if ((mask != 1 && mask != 4 && mask != 5) ||
                        (mask != 1 && !(shared && shared->is_directory()))) {
                        return failure(400, "Invalid permissions for a link");
                    }
                    share.set_permissions(mask);
                    if (const std::string password = field("password"); !password.empty()) {
                        if (password.size() < 8 || password.size() > 256 ||
                            password.find_first_of("\t\r\n") != std::string::npos) {
                            return failure(400, "The password needs at least 8 characters");
                        }
                        const std::string salt = nc::util::random_hex(16);
                        share.set_password(
                            "10000$" + salt + "$" +
                            nc::util::to_hex(nc::util::pbkdf2_sha256(password, salt, 10'000))
                        );
                    }
                } else if (type == nc::cloud::SHARE_TYPE_REMOTE) {
                    // A user on another server: "name@host[:port]". The federation plugin tells
                    // that server; this share is what it will present the token for.
                    const std::string recipient = field("shareWith");
                    const std::size_t at = recipient.rfind('@');
                    if (at == std::string::npos || at == 0 || at + 1 >= recipient.size() ||
                        recipient.size() > 320 ||
                        recipient.find_first_of(" \t\r\n/\\") != std::string::npos) {
                        return failure(400, "Use name@server to share with another server");
                    }
                    share.set_share_with(std::string{recipient});
                    const std::string permissions = field("permissions");
                    const int mask = permissions.empty() ? 1 : std::atoi(permissions.c_str());
                    if (mask < 1 || mask > 31) {
                        return failure(400, "Invalid permissions");
                    }
                    share.set_permissions(mask);
                } else {
                    return failure(400, "Unknown share type");
                }
                const std::string expire = field("expireDate");
                if (!expire.empty()) {
                    const std::int64_t until = parse_expire_date(expire);
                    if (until == 0 || until <= now_seconds()) {
                        return failure(400, "The expiration date is invalid or in the past");
                    }
                    share.set_expires(until);
                }
                auto added = m_shares->add(std::move(share));
                if (!added) {
                    return failure(500, added.error());
                }
                if (type == nc::cloud::SHARE_TYPE_EMAIL) {
                    const Response mailed = m_host->call_service(
                        "mail.send",
                        nc::util::form_encode(
                            {{"to", added->get_share_with()},
                             {"subject", owner + " shared \"" + added->get_path() + "\" with you"},
                             {"body",
                              owner + " shared \"" + added->get_path() + "\" with you.\n\n" +
                                  base_url(request) + "/s/" + added->get_token() + "\n" +
                                  (added->get_password().empty()
                                       ? ""
                                       : "\nThe link is protected by a password; ask " + owner +
                                             " for it.\n")}}
                        )
                    );
                    if (mailed.get_status() != 200) {
                        (void)m_shares->remove(added->get_id());
                        return failure(
                            mailed.get_status() == 404 ? 501 : 400,
                            mailed.get_status() == 404
                                ? "Sharing by mail is not enabled"
                                : "The mail could not be sent: " + mailed.get_body()
                        );
                    }
                }
                if (type == nc::cloud::SHARE_TYPE_REMOTE) {
                    const auto node = storage_for(owner).stat(added->get_path());
                    const Response sent = m_host->call_service(
                        "federation.send",
                        nc::util::form_encode(
                            {{"id", std::to_string(added->get_id())},
                             {"owner", owner},
                             {"path", added->get_path()},
                             {"name", node ? node->name() : std::string{"share"}},
                             {"directory", node && node->is_directory() ? "1" : "0"},
                             {"token", added->get_token()},
                             {"share_with", added->get_share_with()},
                             {"permissions", std::to_string(added->get_permissions())},
                             {"base_url", base_url(request)}}
                        )
                    );
                    if (sent.get_status() != 200) {
                        (void)m_shares->remove(added->get_id());
                        return failure(
                            sent.get_status() == 404 ? 501 : 400,
                            sent.get_status() == 404 ? "Sharing with other servers is not enabled"
                                                     : sent.get_body()
                        );
                    }
                }
                m_host->publish(
                    "share.created",
                    nc::util::form_encode(
                        {{"id", std::to_string(added->get_id())},
                         {"type", std::to_string(added->get_type())},
                         {"owner", added->get_owner()},
                         {"share_with", added->get_share_with()},
                         {"path", added->get_path()},
                         {"token",
                          added->get_type() == nc::cloud::SHARE_TYPE_LINK ||
                                  added->get_type() == nc::cloud::SHARE_TYPE_EMAIL
                              ? added->get_token()
                              : std::string{}}}
                    )
                );
                return ok(share_json(*added, request));
            }
        );

        host.add_route(
            "GET",
            BASE,
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const bool received = request.query_value("shared_with_me") == "true";
                const std::string path_filter = request.query_value("path");
                std::string data = "[";
                bool first = true;
                for (const Share& share: received ? received_shares(request.get_user())
                                                  : m_shares->owned_by(request.get_user())) {
                    if (share.expired(now_seconds()) ||
                        (!path_filter.empty() && share.get_path() != path_filter)) {
                        continue;
                    }
                    data += first ? "" : ",";
                    first = false;
                    data += share_json(share, request);
                }
                return ok(data + "]");
            }
        );

        host.add_route(
            "GET",
            std::string{BASE} + "/{id}",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto share = m_shares->find(
                    std::strtoull(std::string{request.param("id")}.c_str(), nullptr, 10)
                );
                if (!share || share->expired(now_seconds()) ||
                    (share->get_owner() != request.get_user() &&
                     share->get_share_with() != request.get_user())) {
                    return failure(404, "Wrong share ID, share does not exist");
                }
                return ok("[" + share_json(*share, request) + "]");
            }
        );

        host.add_route(
            "DELETE",
            std::string{BASE} + "/{id}",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const std::uint64_t id =
                    std::strtoull(std::string{request.param("id")}.c_str(), nullptr, 10);
                const auto share = m_shares->find(id);
                if (!share || share->get_owner() != request.get_user()) {
                    return failure(404, "Wrong share ID, share does not exist");
                }
                (void)m_shares->remove(id);
                m_host->publish(
                    "share.deleted",
                    nc::util::form_encode(
                        {{"id", std::to_string(id)},
                         {"owner", share->get_owner()},
                         {"type", std::to_string(share->get_type())},
                         {"share_with", share->get_share_with()},
                         {"token", share->get_token()}}
                    )
                );
                return ok();
            }
        );
    }

    // ---- public links ---------------------------------------------------------------------------

    void add_public_routes(nc::Host& host)
    {
        host.add_route(
            "GET",
            "/s/{token}",
            [this](const Request& request)
            {
                return serve_public(request);
            }
        );
        host.add_route(
            "GET",
            "/s/{token}/{*path}",
            [this](const Request& request)
            {
                return serve_public(request);
            }
        );
        host.add_route(
            "PUT",
            "/s/{token}/{*path}",
            [this](const Request& request)
            {
                return public_upload(request);
            }
        );
        // The same shares as WebDAV, the way another server (federation) and the sync clients reach
        // them: the user name is the token, the password is the share's password if it has one.
        static constexpr std::string_view METHODS[] = {"GET", "PUT", "MKCOL", "DELETE", "PROPFIND"};
        for (const std::string_view method: METHODS) {
            host.add_route(
                method,
                "/public.php/webdav/{*path}",
                [this](const Request& request)
                {
                    return serve_public_dav(request);
                }
            );
        }
    }

    [[nodiscard]] Response serve_public_dav(const Request& request) const
    {
        const auto challenge = [](Response response)
        {
            response.add_header("WWW-Authenticate", R"(Basic realm="share", charset="UTF-8")");
            return response;
        };
        const std::string_view header = request.header("Authorization");
        std::string token;
        std::string password;
        if (header.size() > 6 && nc::util::equals_ignore_case(header.substr(0, 6), "Basic ")) {
            if (const auto decoded = nc::util::base64_decode(nc::util::trim(header.substr(6)))) {
                const std::size_t colon = decoded->find(':');
                token = decoded->substr(0, colon);
                password = colon == std::string::npos ? std::string{} : decoded->substr(colon + 1);
            }
        }
        if (token.empty()) {
            return challenge(Response::text(401, "Unauthorized"));
        }
        Response refusal;
        const auto share = open_token(token, password, refusal);
        if (!share) {
            return refusal.get_status() == 401 ? challenge(std::move(refusal)) : refusal;
        }
        const std::string& method = request.get_method();
        if ((method == "GET" || method == "PROPFIND") && !(share->get_permissions() & 1)) {
            return Response::text(403, "This share only accepts uploads");
        }
        const auto root = storage_for(share->get_owner()).stat(share->get_path());
        const auto normalized = Storage::normalize("/" + std::string{request.param("path")});
        if (!root || !normalized) {
            return Response::text(404, "Not Found");
        }
        Mount mount;
        mount.share = *share;
        mount.name = "webdav";
        mount.directory = root->is_directory();
        return serve_mount(
            request,
            mount,
            *normalized == "/" ? std::string{} : *normalized,
            "/public.php"
        );
    }

    /// The share behind a link, if the link is valid and the password (header
    /// `X-NC-Share-Password`, or
    /// `?password=`) fits. One status for every reason it is not, apart from "needs a password"
    /// (401).
    [[nodiscard]] std::optional<Share> open_link(const Request& request, Response& refusal) const
    {
        std::string given{request.header("X-NC-Share-Password")};
        if (given.empty()) {
            given = request.query_value("password");
        }
        return open_token(request.param("token"), given, refusal);
    }

    [[nodiscard]] std::optional<Share>
    open_token(std::string_view token, const std::string& given, Response& refusal) const
    {
        auto share = m_shares->find_by_token(token);
        if (!share || share->expired(now_seconds()) || !safe_user(share->get_owner())) {
            refusal = Response::text(404, "Not Found");
            return std::nullopt;
        }
        if (!share->get_password().empty()) {
            const std::vector<std::string> parts = nc::util::split(share->get_password(), '$');
            const bool good =
                parts.size() == 3 && !given.empty() &&
                nc::util::constant_time_equals(
                    nc::util::to_hex(nc::util::pbkdf2_sha256(
                        given,
                        parts[1],
                        static_cast<std::uint32_t>(std::strtoul(parts[0].c_str(), nullptr, 10))
                    )),
                    parts[2]
                );
            if (!good) {
                refusal = Response::json(401, R"({"password":"required"})");
                return std::nullopt;
            }
        }
        return share;
    }

    /// `PUT /s/<token>/<name>` into a folder shared with upload permission. An existing name is
    /// never replaced: the new file is numbered ("report (2).pdf").
    [[nodiscard]] Response public_upload(const Request& request) const
    {
        Response refusal;
        const auto share = open_link(request, refusal);
        if (!share) {
            return refusal;
        }
        if (!(share->get_permissions() & 4)) {
            return Response::text(403, "This link does not accept uploads");
        }
        if (request.get_body().size() > m_max_upload) {
            return Response::text(413, "The file is larger than this server accepts");
        }
        const Storage storage = storage_for(share->get_owner());
        (void)storage.ensure_root();
        const auto target =
            Storage::normalize(share->get_path() + "/" + std::string{request.param("path")});
        const auto folder = storage.stat(share->get_path());
        if (!target || !folder || !folder->is_directory() || *target == share->get_path()) {
            return Response::text(400, "Bad name");
        }
        std::string name = *target;
        const std::size_t dot = name.rfind('.');
        const std::size_t slash = name.rfind('/');
        for (int attempt = 2; storage.stat(name) && attempt < 1'000; ++attempt) {
            name = dot != std::string::npos && dot > slash + 1
                       ? target->substr(0, dot) + " (" + std::to_string(attempt) + ")" +
                             target->substr(dot)
                       : *target + " (" + std::to_string(attempt) + ")";
        }
        const auto written = storage.write(name, request.get_body());
        if (!written) {
            return Response::text(
                nc::cloud::http_status(written.error()),
                written.error().get_message()
            );
        }
        m_host->publish(
            "file.created",
            nc::util::form_encode({{"user", share->get_owner()}, {"path", name}})
        );
        return Response{201};
    }

    [[nodiscard]] Response serve_public(const Request& request) const
    {
        Response refusal;
        // One answer for "no such token" and "expired", so a token cannot be probed.
        const auto share = open_link(request, refusal);
        if (!share) {
            return refusal;
        }
        if (!(share->get_permissions() & 1)) {
            return Response::text(403, "This link only accepts uploads");
        }
        const Storage storage = storage_for(share->get_owner());
        const auto root = storage.stat(share->get_path());
        if (!root) {
            return Response::text(404, "Not Found");
        }
        std::string inner = share->get_path();
        const std::string_view rest = request.param("path");
        if (root->is_directory()) {
            if (!rest.empty()) {
                const auto joined = Storage::normalize(share->get_path() + "/" + std::string{rest});
                if (!joined) {
                    return Response::text(404, "Not Found");
                }
                inner = *joined;
            }
        } else if (!rest.empty() && rest != "download") {
            return Response::text(404, "Not Found");
        }
        const auto node = storage.stat(inner);
        if (!node) {
            return Response::text(404, "Not Found");
        }
        if (node->is_directory()) {
            auto children = storage.list(inner);
            if (!children) {
                return Response::text(404, "Not Found");
            }
            std::string json = R"({"name":)" +
                               json_string(node->name().empty() ? std::string{"/"} : node->name()) +
                               R"(,"files":[)";
            bool first = true;
            for (const nc::cloud::Node& child: *children) {
                json += first ? "" : ",";
                first = false;
                json += R"({"name":)" + json_string(child.name()) + R"(,"type":")" +
                        (child.is_directory() ? "folder" : "file") + R"(","size":)" +
                        std::to_string(child.is_directory() ? 0 : child.get_size()) + "}";
            }
            return Response::json(200, json + "]}");
        }
        auto data = storage.read(inner);
        if (!data) {
            return Response::text(404, "Not Found");
        }
        Response
            response{200, std::string{nc::util::mime_type_for(node->name())}, std::move(*data), {}};
        nc::cloud::add_download_headers(response, *node);
        return response;
    }

    // ---- commands -------------------------------------------------------------------------------

    void add_commands(nc::Host& host)
    {
        host.add_command(
            "files:usage",
            "Shows the bytes a user stores: files:usage <user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1 || !safe_user(args[0])) {
                    out = "usage: files:usage <user>\n";
                    return 1;
                }
                out = std::to_string(storage_for(args[0]).used_bytes()) + "\n";
                return 0;
            }
        );

        host.add_command(
            "encryption:status",
            "Says whether files are encrypted when stored",
            [this](const std::vector<std::string>&, std::string& out)
            {
                out = m_encryption_key.empty() ? "disabled\n"
                                               : "enabled (ChaCha20-Poly1305, one key per file)\n";
                return 0;
            }
        );
        host.add_command(
            "encryption:encrypt-all",
            "Encrypts the files a user already has: encryption:encrypt-all <user>",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1 || !safe_user(args[0]) || m_encryption_key.empty()) {
                    out = "usage: encryption:encrypt-all <user> (needs an encryption key in the "
                          "config)\n";
                    return 1;
                }
                const auto changed = storage_for(args[0]).encrypt_existing();
                if (!changed) {
                    out = changed.error().get_message() + "\n";
                    return 1;
                }
                out = "encrypted " + std::to_string(*changed) + " file(s)\n";
                return 0;
            }
        );
        host.add_command(
            "share:list",
            "Lists all shares",
            [this](const std::vector<std::string>&, std::string& out)
            {
                for (const Share& share: m_shares->all()) {
                    out += std::to_string(share.get_id()) + "\t" + share.get_owner() + "\t" +
                           share.get_path() + "\t" +
                           (share.get_type() == nc::cloud::SHARE_TYPE_LINK
                                ? "link"
                                : "user:" + share.get_share_with()) +
                           (share.expired(now_seconds()) ? "\texpired" : "") + "\n";
                }
                return 0;
            }
        );

        host.add_command(
            "share:prune",
            "Removes expired shares",
            [this](const std::vector<std::string>&, std::string& out)
            {
                out = "removed " + std::to_string(m_shares->prune_expired(now_seconds())) +
                      " expired share(s)\n";
                return 0;
            }
        );
    }

    std::string m_data_dir{"data"};
    std::uint64_t m_quota{0};
    std::string m_public_url{};
    std::string m_encryption_key{};
    std::size_t m_max_chunk{512U * 1'024U * 1'024U};
    std::size_t m_max_upload{2'048U * 1'024U * 1'024U};

    struct External
    {
        std::string name{};
        std::filesystem::path path{};
        int permissions{1};
        std::string group{};
    };

    std::vector<External> m_external{};
    std::unique_ptr<nc::cloud::ShareStore> m_shares{};
    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(CloudPlugin)
