/**
 * @file cloud_plugin.cc
 * @brief The cloud plugin: per-user file storage with WebDAV (`/remote.php/dav/files/{user}`),
 * shares by user and by public link (`/ocs/v2.php/apps/files_sharing/api/v1/shares`, `/s/{token}`),
 * and the `files:*` / `share:*` commands. Counterpart of Nextcloud's `apps/files`, `apps/dav` and
 * `apps/files_sharing`.
 */
#include "dav.h"
#include "ftp.h"
#include "http_client.h"
#include "nextcloud/app.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "remote_files.h"
#include "s3.h"
#include "sftp.h"
#include "share_store.h"
#include "storage.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <sstream>

namespace {

using nc::cloud::Share;
using nc::cloud::Storage;
using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions USER{nc::app::Access::USER, nc::app::Format::OCS};

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
        m_db.migrate(
            "cloud",
            2,
            "ALTER TABLE nc_shares ADD COLUMN initiator TEXT NOT NULL DEFAULT '';"
        );
    }

    Result<std::vector<Share>> load() override
    {
        try {
            std::vector<Share> shares;
            for (const nc::db::Row& row: m_db.query(
                     "SELECT id, token, type, owner, share_with, path, permissions, expires, "
                     "created, password, initiator FROM nc_shares ORDER BY id"
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
                share.set_initiator(nc::db::value_of(row, "initiator"));
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
                      "expires, created, password, initiator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    : "INSERT INTO nc_shares (token, type, owner, share_with, path, permissions, "
                      "expires, created, password, initiator, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "
                      "?, ?, ?)",
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
            share.get_password(),
            share.get_initiator()
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
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        parse_external(host.config("external_mounts", ""));
        m_dav_client.set_allow_http(host.config("external_webdav_allow_http", "false") == "true");
        m_dav_client.set_allow_local(host.config("external_webdav_allow_local", "false") == "true");
        m_dav_client.set_ca_file(host.config("external_webdav_ca_file", ""));
        m_dav_client.set_timeout_seconds(
            std::atoi(host.config("external_webdav_timeout_seconds", "30").c_str())
        );
        m_dav_client.set_max_response(
            static_cast<std::size_t>(
                std::max(1, std::atoi(host.config("external_webdav_max_mb", "256").c_str()))
            ) *
            1'024U * 1'024U
        );
        parse_external_webdav(host.config("external_webdav", ""));
        m_s3_client.set_allow_http(host.config("external_s3_allow_http", "false") == "true");
        m_s3_client.set_allow_local(host.config("external_s3_allow_local", "false") == "true");
        m_s3_client.set_ca_file(host.config("external_s3_ca_file", ""));
        m_s3_client.set_timeout_seconds(
            std::atoi(host.config("external_s3_timeout_seconds", "30").c_str())
        );
        m_s3_client.set_max_response(
            static_cast<std::size_t>(
                std::max(1, std::atoi(host.config("external_s3_max_mb", "256").c_str()))
            ) *
            1'024U * 1'024U
        );
        parse_external_s3(host.config("external_s3", ""));
        m_ftp_settings.allow_local = host.config("external_ftp_allow_local", "false") == "true";
        m_ftp_settings.ca_file = host.config("external_ftp_ca_file", "");
        m_ftp_settings.timeout_seconds =
            std::max(1, std::atoi(host.config("external_ftp_timeout_seconds", "30").c_str()));
        m_ftp_settings.max_bytes =
            static_cast<std::size_t>(
                std::max(1, std::atoi(host.config("external_ftp_max_mb", "256").c_str()))
            ) *
            1'024U * 1'024U;
        parse_external_ftp(host.config("external_ftp", ""));
        m_max_upload =
            std::strtoull(host.config("max_upload_bytes", "2147483648").c_str(), nullptr, 10);
        m_archive_max_bytes =
            std::strtoull(host.config("archive_max_mb", "4096").c_str(), nullptr, 10) * 1'024U *
            1'024U;
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
        hooks.archive_max_bytes = m_archive_max_bytes;
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
                if (!share ||
                    (share->get_type() != nc::cloud::SHARE_TYPE_REMOTE &&
                     share->get_type() != nc::cloud::SHARE_TYPE_REMOTE_GROUP) ||
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
            "reshares",
            60,
            [this]()
            {
                (void)m_shares->prune_expired(now_seconds());
                remove_orphaned_reshares();
            }
        );
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

    struct MountedTarget
    {
        std::string owner{};
        std::string path{};
        int permissions{1};
    };

    /// A path inside a share the user received ("/Documents/sub") as the owner's path and the
    /// permissions the share gives. Nothing for an external storage or a share from another server.
    [[nodiscard]] std::optional<MountedTarget>
    resolve_mounted(const std::string& user, const std::string& normalized) const
    {
        const std::size_t slash = normalized.find('/', 1);
        const std::string first =
            normalized.substr(1, slash == std::string::npos ? std::string::npos : slash - 1);
        const std::string rest =
            slash == std::string::npos ? std::string{} : normalized.substr(slash);
        for (const Mount& mount: mounts_for(user)) {
            if (mount.name != first || mount.remote_id != 0 || !mount.external_root.empty()) {
                continue;
            }
            if (!mount.directory && !rest.empty()) {
                return std::nullopt;
            }
            const auto joined = Storage::normalize(mount.share.get_path() + rest);
            if (!joined) {
                return std::nullopt;
            }
            return MountedTarget{mount.share.get_owner(), *joined, mount.share.get_permissions()};
        }
        return std::nullopt;
    }

    /// A reshare lives as long as a share to its initiator that allows resharing: when the owner or
    /// the recipient removes (or lets expire) that one, the reshares below it go too.
    void remove_orphaned_reshares() const
    {
        for (bool changed = true; changed;) {
            changed = false;
            const std::vector<Share> all = m_shares->all();
            for (const Share& share: all) {
                if (share.get_initiator().empty()) {
                    continue;
                }
                const bool has_parent = std::ranges::any_of(
                    all,
                    [&](const Share& parent)
                    {
                        const auto covers = [](const std::string& base, const std::string& path)
                        {
                            return path == base || (path.size() > base.size() &&
                                                    path.compare(0, base.size(), base) == 0 &&
                                                    path[base.size()] == '/');
                        };
                        return parent.get_id() != share.get_id() &&
                               parent.get_owner() == share.get_owner() &&
                               !parent.expired(now_seconds()) && (parent.get_permissions() & 16) &&
                               covers(parent.get_path(), share.get_path()) &&
                               is_recipient(parent, share.get_initiator());
                    }
                );
                if (!has_parent) {
                    (void)m_shares->remove(share.get_id());
                    m_host->publish(
                        "share.deleted",
                        nc::util::form_encode(
                            {{"id", std::to_string(share.get_id())},
                             {"owner", share.get_owner()},
                             {"type", std::to_string(share.get_type())},
                             {"share_with", share.get_share_with()},
                             {"token", share.get_token()}}
                        )
                    );
                    changed = true;
                }
            }
        }
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

    struct ExternalDav
    {
        std::string name{};
        std::string url{}; // without trailing slash
        std::string user{};
        std::string password{};
        bool writable{false};
        std::string group{};
    };

    struct ExternalS3
    {
        std::string name{};
        std::string endpoint{}; // without trailing slash
        std::string host{};     // as it goes into the Host header
        std::string bucket{};
        std::string prefix{}; // "" or "dir/", where the storage starts inside the bucket
        nc::cloud::s3::Credentials credentials{};
        bool writable{false};
        std::string group{};
    };

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
        /// Set (to the index in `m_dav`) for an external storage that is a WebDAV server.
        int dav_index{-1};
        int dav_permissions{1};
        /// Set (to the index in `m_s3`) for an external storage that is an S3 bucket.
        int s3_index{-1};
        /// Set (to the index in `m_ftp`) for an external storage that is an FTP server.
        int ftp_index{-1};
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
            mounts.push_back(Mount{share, name, node->is_directory(), {}, 1, 0, -1, 1, -1, -1});
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
            mounts.push_back(
                Mount{Share{}, name, true, external.path, external.permissions, 0, -1, 1, -1, -1}
            );
        }
        // External storages that are WebDAV servers.
        for (std::size_t index = 0; index < m_dav.size(); ++index) {
            const ExternalDav& dav = m_dav[index];
            if (!dav.group.empty() &&
                m_host->call_service(
                          "groups.is_member",
                          nc::util::form_encode({{"group", dav.group}, {"user", user}})
                ).get_status() != 200) {
                continue;
            }
            std::string name = dav.name;
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
                name = dav.name + " (" + std::to_string(attempt) + ")";
            }
            mounts.push_back(Mount{
                Share{},
                name,
                true,
                {},
                1,
                0,
                static_cast<int>(index),
                dav.writable ? 31 : 1,
                -1,
                -1
            });
        }
        // External storages that are S3 buckets.
        for (std::size_t index = 0; index < m_s3.size(); ++index) {
            const ExternalS3& bucket = m_s3[index];
            if (!bucket.group.empty() &&
                m_host->call_service(
                          "groups.is_member",
                          nc::util::form_encode({{"group", bucket.group}, {"user", user}})
                ).get_status() != 200) {
                continue;
            }
            std::string name = bucket.name;
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
                name = bucket.name + " (" + std::to_string(attempt) + ")";
            }
            mounts.push_back(
                Mount{Share{}, name, true, {}, 1, 0, -1, 1, static_cast<int>(index), -1}
            );
        }
        // External storages that are FTP servers.
        for (std::size_t index = 0; index < m_ftp.size(); ++index) {
            const ExternalFtp& server = m_ftp[index];
            if (!server.group.empty() &&
                m_host->call_service(
                          "groups.is_member",
                          nc::util::form_encode({{"group", server.group}, {"user", user}})
                ).get_status() != 200) {
                continue;
            }
            std::string name = server.name;
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
                name = server.name + " (" + std::to_string(attempt) + ")";
            }
            mounts.push_back(
                Mount{Share{}, name, true, {}, 1, 0, -1, 1, -1, static_cast<int>(index)}
            );
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
                mounts.push_back(Mount{Share{}, name, directory, {}, 1, id, -1, 1, -1, -1});
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
            if (mount.remote_id != 0 || mount.dav_index >= 0 || mount.s3_index >= 0 ||
                mount.ftp_index >= 0) {
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
            if (node->is_directory() && mount.remote_id == 0 && mount.dav_index < 0 &&
                mount.s3_index < 0 && mount.ftp_index < 0) {
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

    /// `Name=ftp://host[:port][/folder]|user|/path/to/password-file[|rw][|group]`, several
    /// separated by
    /// `;`. Plain FTP: the password and the files cross the network unprotected, so this is for
    /// networks the administrator trusts.
    void parse_external_ftp(const std::string& text)
    {
        for (const std::string& entry: nc::util::split(text, ';')) {
            if (nc::util::trim(entry).empty()) {
                continue;
            }
            const std::size_t equals = entry.find('=');
            const std::vector<std::string> parts = nc::util::split(
                equals == std::string::npos ? std::string{} : entry.substr(equals + 1),
                '|'
            );
            const std::string name{nc::util::trim(entry.substr(0, equals))};
            std::string password;
            if (equals != std::string::npos && parts.size() >= 3) {
                std::ifstream file{std::string{nc::util::trim(parts[2])}};
                std::getline(file, password);
            }
            std::string address{parts.empty() ? std::string_view{} : nc::util::trim(parts[0])};
            ExternalFtp server;
            server.secure_shell = nc::util::starts_with(address, "sftp://");
            server.tls = nc::util::starts_with(address, "ftps://");
            bool good =
                server.secure_shell || server.tls || nc::util::starts_with(address, "ftp://");
            if (good) {
                server.port = server.secure_shell ? "22" : "21";
                address.erase(0, server.secure_shell ? 7 : (server.tls ? 7 : 6));
                const std::size_t slash = address.find('/');
                const std::string folder =
                    slash == std::string::npos ? std::string{} : address.substr(slash);
                address = address.substr(0, slash);
                const std::size_t colon = address.rfind(':');
                server.host = colon == std::string::npos ? address : address.substr(0, colon);
                if (colon != std::string::npos) {
                    server.port = address.substr(colon + 1);
                }
                const auto normalized = Storage::normalize(folder.empty() ? "/" : folder);
                good = !server.host.empty() &&
                       server.host.find_first_of(" \r\n/@") == std::string::npos &&
                       !server.port.empty() && server.port.size() <= 5 &&
                       server.port.find_first_not_of("0123456789") == std::string::npos &&
                       normalized.has_value();
                if (good) {
                    server.base = *normalized == "/" ? std::string{} : *normalized;
                }
            }
            const bool has_key = std::any_of(
                parts.begin() + std::min<std::size_t>(3, parts.size()),
                parts.end(),
                [](const std::string& option)
                {
                    return nc::util::starts_with(nc::util::trim(option), "key=");
                }
            );
            if (equals == std::string::npos || parts.size() < 3 || !good ||
                (password.empty() && !has_key) || name.empty() ||
                name.find('/') != std::string::npos || !Storage::normalize("/" + name) ||
                name == "." || name == ".." || nc::util::trim(parts[1]).empty() ||
                password.find_first_of("\r\n") != std::string::npos) {
                m_host->log(nc::LogLevel::WARNING, "ignoring external FTP storage: " + name);
                continue;
            }
            server.name = name;
            server.user = std::string{nc::util::trim(parts[1])};
            server.password = password;
            for (std::size_t index = 3; index < parts.size(); ++index) {
                const std::string_view option = nc::util::trim(parts[index]);
                if (option == "rw") {
                    server.writable = true;
                } else if (nc::util::starts_with(option, "hostkey=")) {
                    server.host_key = std::string{option.substr(8)};
                    if (server.host_key.rfind("SHA256:", 0) == 0) {
                        server.host_key.erase(0, 7);
                    }
                } else if (nc::util::starts_with(option, "key=")) {
                    server.private_key = std::string{option.substr(4)};
                } else if (option != "ro") {
                    server.group = std::string{option};
                }
            }
            if (!server.private_key.empty() && !server.secure_shell) {
                m_host->log(
                    nc::LogLevel::WARNING,
                    "ignoring external storage: key= is for sftp:// only: " + name
                );
                continue;
            }
            if (server.secure_shell && server.host_key.empty()) {
                m_host->log(
                    nc::LogLevel::WARNING,
                    "ignoring external SFTP storage without hostkey=: " + name
                );
                continue;
            }
            m_ftp.push_back(std::move(server));
        }
    }

    struct ExternalFtp;

    /// Opens a session on an external FTP or SFTP server.
    [[nodiscard]] nc::cloud::RemoteResult<std::unique_ptr<nc::cloud::RemoteFiles>>
    open_remote(const ExternalFtp& server) const
    {
        if (server.secure_shell) {
            nc::cloud::sftp::Session::Settings settings;
            settings.allow_local = m_ftp_settings.allow_local;
            settings.timeout_seconds = m_ftp_settings.timeout_seconds;
            settings.max_bytes = m_ftp_settings.max_bytes;
            auto opened = nc::cloud::sftp::Session::open(
                server.host,
                server.port,
                server.user,
                server.password,
                server.host_key,
                server.private_key,
                settings
            );
            if (!opened) {
                return nc::util::unexpected<std::string>{opened.error()};
            }
            return std::unique_ptr<nc::cloud::RemoteFiles>{
                std::make_unique<nc::cloud::RemoteSession<nc::cloud::sftp::Session>>(
                    std::move(*opened)
                )
            };
        }
        nc::cloud::ftp::Session::Settings ftp_settings = m_ftp_settings;
        ftp_settings.secure = server.tls;
        auto opened = nc::cloud::ftp::Session::open(
            server.host,
            server.port,
            server.user,
            server.password,
            ftp_settings
        );
        if (!opened) {
            return nc::util::unexpected<std::string>{opened.error()};
        }
        return std::unique_ptr<nc::cloud::RemoteFiles>{
            std::make_unique<nc::cloud::RemoteSession<nc::cloud::ftp::Session>>(std::move(*opened))
        };
    }

    /// A folder of an FTP or SFTP server shown as a WebDAV collection tree. One session per
    /// request.
    [[nodiscard]] Response serve_external_ftp(
        const Request& request,
        const Mount& mount,
        const std::string& rest,
        const std::string& base
    ) const
    {
        const ExternalFtp& server = m_ftp[static_cast<std::size_t>(mount.ftp_index)];
        const std::string& method = request.get_method();
        const bool writes = method == "PUT" || method == "MKCOL" || method == "DELETE" ||
                            method == "MOVE" || method == "COPY";
        if (!writes && method != "GET" && method != "PROPFIND") {
            return Response::text(405, "Method Not Allowed");
        }
        if (writes && (!server.writable || rest.empty())) {
            return Response::text(403, "This storage is read-only");
        }
        if (method == "PUT" && request.body_size() > m_max_upload) {
            return Response::text(413, "The file is larger than this server accepts");
        }
        const std::string mount_base = base + "/" + nc::util::url_encode_path(mount.name);
        auto opened_session = open_remote(server);
        if (!opened_session) {
            return Response::text(
                502,
                "The storage could not be reached: " + opened_session.error()
            );
        }
        const auto& session = *opened_session;
        const std::string path = rest == "/" ? std::string{} : rest;
        // The path on the server for one inside the storage; "/" for the storage's own root.
        const auto remote = [&](const std::string& inner)
        {
            const std::string full = server.base + inner;
            return full.empty() ? std::string{"/"} : full;
        };
        const auto folder_of = [&](const std::string& inner)
        {
            return remote(inner.substr(0, inner.rfind('/')));
        };
        const auto name_of = [](const std::string& inner)
        {
            return inner.substr(inner.rfind('/') + 1);
        };
        // The entry for a path inside the storage, found in its folder's listing.
        const auto find = [&](const std::string& inner) -> std::optional<nc::cloud::ftp::Entry>
        {
            const auto listing = session->list(folder_of(inner));
            if (!listing) {
                return std::nullopt;
            }
            for (const nc::cloud::ftp::Entry& entry: *listing) {
                if (entry.name == name_of(inner)) {
                    return entry;
                }
            }
            return std::nullopt;
        };
        const auto etag_of = [](const nc::cloud::ftp::Entry& entry)
        {
            return "\"" + std::to_string(entry.size) + "-" + std::to_string(entry.modified) + "\"";
        };
        const auto node_of = [&](const std::string& inner, const nc::cloud::ftp::Entry& entry)
        {
            return nc::cloud::Node{
                std::string{inner},
                entry.directory,
                entry.directory ? 0 : entry.size,
                entry.modified,
                etag_of(entry)
            };
        };

        if (method == "PROPFIND") {
            const bool deep = request.header("Depth") != "0";
            std::vector<nc::cloud::Node> nodes;
            std::optional<nc::cloud::ftp::Entry> self;
            if (!path.empty()) {
                self = find(path);
                if (!self) {
                    return Response::text(404, "Not Found");
                }
            }
            if (self && !self->directory) {
                nodes.push_back(node_of(path, *self));
            } else {
                nodes.emplace_back(path.empty() ? std::string{"/"} : std::string{path}, true);
                if (deep) {
                    const auto listing = session->list(remote(path));
                    if (!listing) {
                        return Response::text(
                            502,
                            "The folder could not be listed: " + listing.error()
                        );
                    }
                    for (const nc::cloud::ftp::Entry& entry: *listing) {
                        nodes.push_back(node_of(path + "/" + entry.name, entry));
                    }
                }
            }
            return Response::xml(
                207,
                nc::cloud::multistatus(
                    nodes,
                    mount_base,
                    "",
                    Storage{std::filesystem::path{"/nonexistent"}}
                )
            );
        }
        if (method == "GET") {
            const auto entry = path.empty() ? std::nullopt : find(path);
            if (!entry) {
                return Response::text(404, "Not Found");
            }
            if (entry->directory) {
                return Response::text(405, "A folder cannot be downloaded");
            }
            const nc::cloud::ByteRange range =
                nc::cloud::parse_range(request.header("Range"), entry->size);
            if (range.state == nc::cloud::ByteRange::State::UNSATISFIABLE) {
                Response refused = Response::text(416, "Range Not Satisfiable");
                refused.add_header("Content-Range", "bytes */" + std::to_string(entry->size));
                return refused;
            }
            const bool partial = range.state == nc::cloud::ByteRange::State::PARTIAL;
            const auto data = session->retrieve(
                remote(path),
                partial ? range.first : 0,
                partial ? range.last - range.first + 1 : 0
            );
            if (!data) {
                return Response::text(502, "The file could not be read: " + data.error());
            }
            const std::string name = name_of(path);
            std::string safe_name = name;
            std::ranges::replace(safe_name, '"', '_');
            Response out{
                partial ? 206 : 200,
                std::string{nc::util::mime_type_for(name)},
                std::string{*data},
                {{"Content-Disposition", "attachment; filename=\"" + safe_name + "\""},
                 {"X-Content-Type-Options", "nosniff"},
                 {"Accept-Ranges", "bytes"},
                 {"ETag", etag_of(*entry)}}
            };
            if (partial) {
                out.add_header(
                    "Content-Range",
                    "bytes " + std::to_string(range.first) + "-" + std::to_string(range.last) +
                        "/" + std::to_string(entry->size)
                );
            }
            return out;
        }
        if (method == "PUT") {
            const auto existing = find(path);
            if (existing && existing->directory) {
                return Response::text(405, "That is a folder");
            }
            const auto stored = session->store(remote(path), request.get_body());
            return stored ? Response{existing ? 204 : 201}
                          : Response::text(502, "The file could not be stored: " + stored.error());
        }
        if (method == "MKCOL") {
            if (find(path)) {
                return Response::text(405, "It already exists");
            }
            const auto made = session->make_directory(remote(path));
            return made ? Response{201} : Response::text(409, made.error());
        }
        const auto entry = find(path);
        if (!entry) {
            return Response::text(404, "Not Found");
        }
        if (method == "DELETE") {
            // A folder is emptied from the bottom: everything below it, then itself.
            std::size_t budget = 10'000;
            const std::function<bool(const std::string&)> remove_all = [&](const std::string& at
                                                                       ) -> bool
            {
                const auto listing = session->list(at);
                if (!listing || budget < listing->size()) {
                    return false;
                }
                budget -= listing->size();
                for (const nc::cloud::ftp::Entry& child: *listing) {
                    const std::string full = (at == "/" ? std::string{} : at) + "/" + child.name;
                    const bool removed =
                        child.directory
                            ? remove_all(full) && session->remove_directory(full).has_value()
                            : session->remove_file(full).has_value();
                    if (!removed) {
                        return false;
                    }
                }
                return true;
            };
            if (entry->directory) {
                if (!remove_all(remote(path)) || !session->remove_directory(remote(path))) {
                    return Response::text(502, "The folder could not be deleted");
                }
                return Response{204};
            }
            const auto removed = session->remove_file(remote(path));
            return removed ? Response{204} : Response::text(502, removed.error());
        }
        // MOVE and COPY
        const std::string inner =
            nc::cloud::destination_of(request.header("Destination"), mount_base);
        const auto target = Storage::normalize("/" + inner);
        if (inner.empty() || !target || *target == "/") {
            return Response::text(502, "A file cannot be moved out of its storage");
        }
        if (entry->directory && (*target + "/").rfind(path + "/", 0) == 0) {
            return Response::text(400, "A folder cannot go into itself");
        }
        if (method == "MOVE") {
            const auto moved = session->rename(remote(path), remote(*target));
            return moved ? Response{201} : Response::text(502, moved.error());
        }
        if (entry->directory) {
            return Response::text(501, "Folders cannot be copied on an FTP storage");
        }
        const auto data = session->retrieve(remote(path), 0, 0);
        if (!data) {
            return Response::text(502, "The file could not be read: " + data.error());
        }
        const auto copied = session->store(remote(*target), *data);
        return copied ? Response{201} : Response::text(502, copied.error());
    }

    /// `Name=https://s3.host|bucket|ACCESSKEY|/path/to/secret-file[|rw][|prefix=dir/][|region=eu-1][|group]`,
    /// several separated by `;`. Path-style addressing (`endpoint/bucket/key`), so it works with
    /// MinIO, Ceph and other S3-compatible servers as well as AWS.
    void parse_external_s3(const std::string& text)
    {
        for (const std::string& entry: nc::util::split(text, ';')) {
            if (nc::util::trim(entry).empty()) {
                continue;
            }
            const std::size_t equals = entry.find('=');
            const std::vector<std::string> parts = nc::util::split(
                equals == std::string::npos ? std::string{} : entry.substr(equals + 1),
                '|'
            );
            const std::string name{nc::util::trim(entry.substr(0, equals))};
            std::string secret;
            if (equals != std::string::npos && parts.size() >= 4) {
                std::ifstream file{std::string{nc::util::trim(parts[3])}};
                std::getline(file, secret);
            }
            const auto url =
                parts.empty()
                    ? nc::federation::Result<nc::federation::Url>{nc::util::unexpected<std::string>{
                          "no url"
                      }}
                    : nc::federation::parse_url(nc::util::trim(parts[0]));
            const std::string bucket_name{
                parts.size() > 1 ? nc::util::trim(parts[1]) : std::string_view{}
            };
            if (equals == std::string::npos || parts.size() < 4 || !url || secret.empty() ||
                name.empty() || name.find('/') != std::string::npos ||
                !Storage::normalize("/" + name) || name == "." || name == ".." ||
                bucket_name.empty() || bucket_name.find_first_of("/ ?#") != std::string::npos ||
                nc::util::trim(parts[2]).empty()) {
                m_host->log(nc::LogLevel::WARNING, "ignoring external S3 storage: " + name);
                continue;
            }
            std::string endpoint{nc::util::trim(parts[0])};
            while (!endpoint.empty() && endpoint.back() == '/') {
                endpoint.pop_back();
            }
            ExternalS3 bucket{
                name,
                endpoint,
                url->host +
                    (url->port == (url->scheme == "https" ? "443" : "80") ? "" : ":" + url->port),
                bucket_name,
                {},
                nc::cloud::s3::Credentials{
                    std::string{nc::util::trim(parts[2])},
                    secret,
                    "us-east-1"
                },
                false,
                {}
            };
            for (std::size_t index = 4; index < parts.size(); ++index) {
                const std::string_view option = nc::util::trim(parts[index]);
                if (option == "rw") {
                    bucket.writable = true;
                } else if (option == "ro") {
                    bucket.writable = false;
                } else if (nc::util::starts_with(option, "prefix=")) {
                    bucket.prefix = std::string{option.substr(7)};
                    while (!bucket.prefix.empty() && bucket.prefix.front() == '/') {
                        bucket.prefix.erase(bucket.prefix.begin());
                    }
                    if (!bucket.prefix.empty() && bucket.prefix.back() != '/') {
                        bucket.prefix += '/';
                    }
                } else if (nc::util::starts_with(option, "region=")) {
                    bucket.credentials.region = std::string{option.substr(7)};
                } else {
                    bucket.group = std::string{option};
                }
            }
            m_s3.push_back(std::move(bucket));
        }
    }

    /// One signed request to the bucket. `key` is the object (empty for the bucket itself), `query`
    /// the parameters (any order).
    [[nodiscard]] nc::federation::Result<nc::http::Response> s3_call(
        const ExternalS3& bucket,
        std::string_view method,
        const std::string& key,
        std::vector<std::pair<std::string, std::string>> query,
        const std::vector<nc::http::Header>& extra,
        const std::string& body
    ) const
    {
        std::ranges::sort(query);
        std::string canonical_query;
        for (const auto& [name, value]: query) {
            canonical_query += (canonical_query.empty() ? "" : "&") +
                               nc::cloud::s3::encode(name, false) + "=" +
                               nc::cloud::s3::encode(value, false);
        }
        const std::string uri =
            "/" + bucket.bucket + (key.empty() ? "" : "/" + nc::cloud::s3::encode(key, true));
        std::vector<nc::http::Header> headers = nc::cloud::s3::sign(
            bucket.credentials,
            method,
            bucket.host,
            uri,
            canonical_query,
            extra,
            body,
            nc::cloud::s3::amz_date(now_seconds())
        );
        for (const nc::http::Header& header: extra) {
            headers.push_back(header);
        }
        return nc::federation::request(
            m_s3_client,
            method,
            bucket.endpoint + uri + (canonical_query.empty() ? "" : "?" + canonical_query),
            headers,
            body
        );
    }

    /// Everything under a prefix (one level with `delimiter`), following the continuation tokens.
    [[nodiscard]] std::optional<nc::cloud::s3::Listing>
    s3_list(const ExternalS3& bucket, const std::string& prefix, bool delimiter, std::size_t limit)
        const
    {
        nc::cloud::s3::Listing all;
        all.valid = true;
        std::string token;
        for (int page = 0; page < 50; ++page) {
            std::vector<std::pair<std::string, std::string>> query{
                {"list-type", "2"},
                {"prefix", prefix}
            };
            if (delimiter) {
                query.emplace_back("delimiter", "/");
            }
            if (!token.empty()) {
                query.emplace_back("continuation-token", token);
            }
            const auto answer = s3_call(bucket, "GET", {}, query, {}, {});
            if (!answer || answer->get_status() != 200) {
                return std::nullopt;
            }
            auto listing = nc::cloud::s3::parse_listing(answer->get_body());
            if (!listing.valid) {
                return std::nullopt;
            }
            for (auto& file: listing.files) {
                all.files.push_back(std::move(file));
            }
            for (auto& folder: listing.folders) {
                all.folders.push_back(std::move(folder));
            }
            if (all.files.size() + all.folders.size() > limit) {
                return std::nullopt;
            }
            if (!listing.truncated || listing.next_token.empty()) {
                return all;
            }
            token = listing.next_token;
        }
        return std::nullopt;
    }

    /// A folder (or the root) of an S3 bucket shown as a WebDAV collection tree.
    [[nodiscard]] Response serve_external_s3(
        const Request& request,
        const Mount& mount,
        const std::string& rest,
        const std::string& base
    ) const
    {
        const ExternalS3& bucket = m_s3[static_cast<std::size_t>(mount.s3_index)];
        const std::string& method = request.get_method();
        const bool writes = method == "PUT" || method == "MKCOL" || method == "DELETE" ||
                            method == "MOVE" || method == "COPY";
        if (!writes && method != "GET" && method != "PROPFIND") {
            return Response::text(405, "Method Not Allowed");
        }
        if (writes && (!bucket.writable || rest.empty())) {
            return Response::text(403, "This storage is read-only");
        }
        if (method == "PUT" && request.body_size() > m_max_upload) {
            return Response::text(413, "The file is larger than this server accepts");
        }
        const std::string mount_base = base + "/" + nc::util::url_encode_path(mount.name);
        const std::string path = rest == "/" ? std::string{} : rest; // "" or "/a/b"
        const std::string key = bucket.prefix + (path.empty() ? "" : path.substr(1));
        const auto unreachable = [](const std::string& why)
        {
            return Response::text(502, "The storage could not be reached: " + why);
        };
        // Is there a file with this key? Its size and version.
        const auto head = [&](const std::string& object) -> std::optional<nc::http::Response>
        {
            const auto answer = s3_call(bucket, "HEAD", object, {}, {}, {});
            if (answer && answer->get_status() == 200) {
                return *answer;
            }
            return std::nullopt;
        };

        if (method == "GET") {
            if (path.empty() || key.back() == '/') {
                return Response::text(405, "A folder cannot be downloaded");
            }
            std::vector<nc::http::Header> extra;
            if (const std::string_view range = request.header("Range"); !range.empty()) {
                extra.emplace_back("range", std::string{range});
            }
            const auto answer = s3_call(bucket, "GET", key, {}, extra, {});
            if (!answer) {
                return unreachable(answer.error());
            }
            if (answer->get_status() == 404) {
                return Response::text(404, "Not Found");
            }
            if (answer->get_status() != 200 && answer->get_status() != 206) {
                return Response::text(502, "The storage refused the request");
            }
            const std::string name = path.substr(path.rfind('/') + 1);
            std::string safe_name = name;
            std::ranges::replace(safe_name, '"', '_');
            Response out{
                answer->get_status(),
                std::string{nc::util::mime_type_for(name)},
                std::string{answer->get_body()},
                {{"Content-Disposition", "attachment; filename=\"" + safe_name + "\""},
                 {"X-Content-Type-Options", "nosniff"}}
            };
            for (const std::string_view header:
                 {"Content-Range", "Accept-Ranges", "ETag", "Last-Modified"}) {
                if (const std::string_view value = answer->header(header); !value.empty()) {
                    out.add_header(std::string{header}, std::string{value});
                }
            }
            return out;
        }

        if (method == "PROPFIND") {
            const bool deep = request.header("Depth") != "0";
            std::vector<nc::cloud::Node> nodes;
            if (!path.empty()) {
                if (const auto file = head(key)) {
                    nodes.emplace_back(
                        std::string{path},
                        false,
                        std::strtoull(
                            std::string{file->header("Content-Length")}.c_str(),
                            nullptr,
                            10
                        ),
                        0,
                        std::string{file->header("ETag")}
                    );
                    return Response::xml(
                        207,
                        nc::cloud::multistatus(
                            nodes,
                            mount_base,
                            "",
                            Storage{std::filesystem::path{"/nonexistent"}}
                        )
                    );
                }
            }
            // The prefix of what is in this folder: the storage's own prefix for its root.
            const std::string folder_prefix = path.empty() ? bucket.prefix : key + "/";
            const auto listing = s3_list(bucket, folder_prefix, true, 10'000);
            if (!listing) {
                return unreachable("the listing failed");
            }
            const std::string& here = folder_prefix;
            if (!path.empty() && listing->files.empty() && listing->folders.empty()) {
                return Response::text(404, "Not Found");
            }
            nodes.emplace_back(path.empty() ? std::string{"/"} : std::string{path}, true);
            if (deep) {
                for (const std::string& folder: listing->folders) {
                    std::string name = folder.substr(here.size());
                    name.pop_back();
                    nodes.emplace_back(path + "/" + name, true);
                }
                for (const nc::cloud::s3::Entry& entry: listing->files) {
                    if (entry.key == here) {
                        continue; // the marker object that makes an empty folder exist
                    }
                    nodes.emplace_back(
                        path + "/" + entry.key.substr(here.size()),
                        false,
                        entry.size,
                        entry.modified,
                        std::string{entry.etag}
                    );
                }
            }
            return Response::xml(
                207,
                nc::cloud::multistatus(
                    nodes,
                    mount_base,
                    "",
                    Storage{std::filesystem::path{"/nonexistent"}}
                )
            );
        }

        if (method == "PUT") {
            if (key.back() == '/') {
                return Response::text(405, "Method Not Allowed");
            }
            const bool existed = head(key).has_value();
            std::vector<nc::http::Header> extra;
            if (const std::string_view type = request.header("Content-Type"); !type.empty()) {
                extra.emplace_back("content-type", std::string{type});
            }
            const auto answer = s3_call(bucket, "PUT", key, {}, extra, request.get_body());
            if (!answer) {
                return unreachable(answer.error());
            }
            return answer->get_status() == 200
                       ? Response{existed ? 204 : 201}
                       : Response::text(502, "The storage refused the file");
        }
        if (method == "MKCOL") {
            const auto existing = s3_list(bucket, key + "/", true, 1);
            if (head(key) ||
                (existing && (!existing->files.empty() || !existing->folders.empty()))) {
                return Response::text(405, "The folder already exists");
            }
            const auto answer = s3_call(bucket, "PUT", key + "/", {}, {}, {});
            if (!answer) {
                return unreachable(answer.error());
            }
            return answer->get_status() == 200
                       ? Response{201}
                       : Response::text(502, "The storage refused the folder");
        }

        // DELETE, COPY and MOVE work on a file or on everything under a folder.
        std::vector<std::string> keys;
        bool is_folder = false;
        if (head(key)) {
            keys.push_back(key);
        } else {
            const auto listing = s3_list(bucket, key + "/", false, 10'000);
            if (!listing || (listing->files.empty())) {
                return Response::text(404, "Not Found");
            }
            is_folder = true;
            for (const nc::cloud::s3::Entry& entry: listing->files) {
                keys.push_back(entry.key);
            }
        }
        if (method == "DELETE") {
            for (const std::string& object: keys) {
                const auto answer = s3_call(bucket, "DELETE", object, {}, {}, {});
                if (!answer) {
                    return unreachable(answer.error());
                }
            }
            return Response{204};
        }
        // COPY / MOVE
        const std::string inner =
            nc::cloud::destination_of(request.header("Destination"), mount_base);
        const auto target = Storage::normalize("/" + inner);
        if (inner.empty() || !target || *target == "/") {
            return Response::text(502, "A file cannot be moved out of its storage");
        }
        const std::string target_key = bucket.prefix + target->substr(1);
        if (is_folder && (target_key + "/").rfind(key + "/", 0) == 0) {
            return Response::text(400, "A folder cannot go into itself");
        }
        for (const std::string& object: keys) {
            const std::string destination =
                is_folder ? target_key + object.substr(key.size()) : target_key;
            const auto copied = s3_call(
                bucket,
                "PUT",
                destination,
                {},
                {{"x-amz-copy-source",
                  "/" + bucket.bucket + "/" + nc::cloud::s3::encode(object, true)}},
                {}
            );
            if (!copied) {
                return unreachable(copied.error());
            }
            if (copied->get_status() != 200) {
                return Response::text(502, "The storage refused the copy");
            }
        }
        if (method == "MOVE") {
            for (const std::string& object: keys) {
                (void)s3_call(bucket, "DELETE", object, {}, {}, {});
            }
        }
        return Response{201};
    }

    /// `Name=https://host/remote.php/webdav|user|/path/to/password-file[|rw][|group]`, several
    /// separated by `;`. The password is read from the file (never kept in the config). A bad entry
    /// is ignored and logged.
    void parse_external_webdav(const std::string& text)
    {
        for (const std::string& entry: nc::util::split(text, ';')) {
            if (nc::util::trim(entry).empty()) {
                continue;
            }
            const std::size_t equals = entry.find('=');
            const std::vector<std::string> parts = nc::util::split(
                equals == std::string::npos ? std::string{} : entry.substr(equals + 1),
                '|'
            );
            const std::string name{nc::util::trim(entry.substr(0, equals))};
            std::string password;
            if (equals != std::string::npos && parts.size() >= 3) {
                std::ifstream file{std::string{nc::util::trim(parts[2])}};
                std::getline(file, password);
            }
            const auto url =
                parts.empty()
                    ? nc::federation::Result<nc::federation::Url>{nc::util::unexpected<std::string>{
                          "no url"
                      }}
                    : nc::federation::parse_url(nc::util::trim(parts[0]));
            if (equals == std::string::npos || parts.size() < 3 || parts.size() > 5 || !url ||
                password.empty() || name.empty() || name.find('/') != std::string::npos ||
                !Storage::normalize("/" + name) || name == "." || name == ".." ||
                nc::util::trim(parts[1]).empty() ||
                nc::util::trim(parts[1]).find(':') != std::string::npos) {
                m_host->log(nc::LogLevel::WARNING, "ignoring external WebDAV storage: " + name);
                continue;
            }
            std::string base{nc::util::trim(parts[0])};
            while (!base.empty() && base.back() == '/') {
                base.pop_back();
            }
            ExternalDav dav{name, base, std::string{nc::util::trim(parts[1])}, password, false, {}};
            for (std::size_t index = 3; index < parts.size(); ++index) {
                const std::string_view option = nc::util::trim(parts[index]);
                if (option == "rw") {
                    dav.writable = true;
                } else if (option != "ro") {
                    dav.group = std::string{option};
                }
            }
            m_dav.push_back(std::move(dav));
        }
    }

    /// Hrefs of a multistatus answer that start with `remote_prefix` (a path, or a full URL of the
    /// same server) start with `local_prefix` instead; others are left alone.
    static std::string rewrite_dav_links(
        const std::string& xml,
        const std::string& remote_prefix,
        const std::string& local_prefix
    )
    {
        std::string out;
        std::size_t at = 0;
        while (true) {
            const std::size_t tag = xml.find("href>", at);
            if (tag == std::string::npos) {
                break;
            }
            const std::size_t start = tag + 5;
            const std::size_t end = xml.find('<', start);
            if (end == std::string::npos) {
                break;
            }
            out.append(xml, at, start - at);
            std::string link = xml.substr(start, end - start);
            if (const std::size_t scheme = link.find("://");
                scheme != std::string::npos && scheme < 6) {
                const std::size_t path = link.find('/', scheme + 3);
                link = path == std::string::npos ? std::string{"/"} : link.substr(path);
            }
            out += nc::util::starts_with(link, remote_prefix)
                       ? local_prefix + link.substr(remote_prefix.size())
                       : link;
            at = end;
        }
        out.append(xml, at, std::string::npos);
        return out;
    }

    /// A folder on a WebDAV server the administrator configured: every request inside it is passed
    /// on with the configured account, and the answer comes back with its links pointing into the
    /// mount.
    [[nodiscard]] Response serve_external_dav(
        const Request& request,
        const Mount& mount,
        const std::string& rest,
        const std::string& base
    ) const
    {
        const ExternalDav& dav = m_dav[static_cast<std::size_t>(mount.dav_index)];
        const std::string& method = request.get_method();
        const bool writes = method == "PUT" || method == "MKCOL" || method == "DELETE" ||
                            method == "MOVE" || method == "COPY";
        if (!writes && method != "GET" && method != "PROPFIND") {
            return Response::text(405, "Method Not Allowed");
        }
        if (writes && (!dav.writable || rest.empty())) {
            return Response::text(403, "This storage is read-only");
        }
        if (method == "PUT" && request.body_size() > m_max_upload) {
            return Response::text(413, "The file is larger than this server accepts");
        }
        const std::string mount_base = base + "/" + nc::util::url_encode_path(mount.name);
        std::vector<nc::http::Header> headers{
            {"Authorization", "Basic " + nc::util::base64_encode(dav.user + ":" + dav.password)}
        };
        for (const char* name:
             {"Depth", "Range", "Content-Type", "Overwrite", "If-Match", "If-None-Match"}) {
            if (const std::string_view value = request.header(name); !value.empty()) {
                headers.emplace_back(name, std::string{value});
            }
        }
        if (method == "MOVE" || method == "COPY") {
            const std::string inner =
                nc::cloud::destination_of(request.header("Destination"), mount_base);
            const auto target = Storage::normalize("/" + inner);
            if (inner.empty() || !target || *target == "/") {
                return Response::text(502, "A file cannot be moved out of its storage");
            }
            headers.emplace_back("Destination", dav.url + nc::util::url_encode_path(*target));
        }
        const auto answer = nc::federation::request(
            m_dav_client,
            method,
            dav.url + nc::util::url_encode_path(rest),
            headers,
            method == "PUT" || method == "PROPFIND" ? request.get_body() : std::string{}
        );
        if (!answer) {
            return Response::text(502, "The storage could not be reached: " + answer.error());
        }
        const auto parsed = nc::federation::parse_url(dav.url);
        std::string content = answer->get_body();
        if (answer->get_status() == 207 && parsed) {
            std::string remote_prefix = parsed->target;
            while (remote_prefix.size() > 1 && remote_prefix.back() == '/') {
                remote_prefix.pop_back();
            }
            content = rewrite_dav_links(
                content,
                remote_prefix == "/" ? std::string{} : remote_prefix,
                mount_base
            );
        }
        Response out{
            answer->get_status(),
            answer->get_content_type().empty() ? std::string{"application/octet-stream"}
                                               : std::string{answer->get_content_type()},
            std::move(content),
            {}
        };
        for (const std::string_view header:
             {"Content-Range", "Accept-Ranges", "ETag", "Last-Modified"}) {
            if (const std::string_view value = answer->header(header); !value.empty()) {
                out.add_header(std::string{header}, std::string{value});
            }
        }
        if (method == "GET" && out.get_status() < 300) {
            // Whatever the other server says the file is, a browser must not run it here.
            const std::string name = rest.empty() ? mount.name : rest.substr(rest.rfind('/') + 1);
            std::string safe_name = name;
            std::ranges::replace(safe_name, '"', '_');
            out.add_header("Content-Disposition", "attachment; filename=\"" + safe_name + "\"");
            out.add_header("X-Content-Type-Options", "nosniff");
        }
        return out;
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
        if (method != "GET" && method != "PROPFIND" && method != "PUT" && method != "MKCOL" &&
            method != "DELETE") {
            return Response::text(
                method == "MOVE" || method == "COPY" ? 403 : 405,
                "This is not possible in a share from another server"
            );
        }
        if (method == "PUT" && request.body_size() > m_max_upload) {
            return Response::text(413, "The file is larger than this server accepts");
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
                 {"range", std::string{request.header("Range")}},
                 {"content_type", std::string{request.header("Content-Type")}},
                 {"body", method == "PUT" ? request.get_body() : std::string{}},
                 {"href_base", mount.directory ? mount_base : base}}
            )
        );
        const int status = answer.get_status();
        if (method == "PROPFIND" && status == 207) {
            return Response{
                207,
                "application/xml; charset=utf-8",
                std::string{answer.get_body()},
                {}
            };
        }
        if (method != "GET") {
            // Writes: the owner's status says how it went.
            return Response::text(status, std::string{answer.get_body()});
        }
        if (status != 200 && status != 206) {
            return Response::text(status >= 400 ? status : 502, answer.get_body());
        }
        const std::string name = rest.empty() ? mount.name : rest.substr(rest.rfind('/') + 1);
        std::string safe_name = name;
        std::ranges::replace(safe_name, '"', '_');
        Response out{
            status,
            std::string{nc::util::mime_type_for(name)},
            answer.is_streamed() ? std::string{} : std::string{answer.get_body()},
            {{"Content-Disposition", "attachment; filename=\"" + safe_name + "\""},
             {"X-Content-Type-Options", "nosniff"}}
        };
        for (const std::string_view header:
             {"Content-Range", "Accept-Ranges", "ETag", "Last-Modified"}) {
            if (const std::string_view value = answer.header(header); !value.empty()) {
                out.add_header(std::string{header}, std::string{value});
            }
        }
        if (answer.is_streamed()) {
            // The owner's server sends a big file in pieces; it goes on to the client the same way.
            out.set_stream(
                answer.get_stream_length(),
                [reader = answer.get_stream()](char* buffer, std::size_t capacity)
                {
                    return (*reader)(buffer, capacity);
                }
            );
        }
        return out;
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
        if (mount.dav_index >= 0) {
            return serve_external_dav(request, mount, rest, base);
        }
        if (mount.s3_index >= 0) {
            return serve_external_s3(request, mount, rest, base);
        }
        if (mount.ftp_index >= 0) {
            return serve_external_ftp(request, mount, rest, base);
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
        json +=
            R"(,"uid_owner":)" + json_string(share.get_owner()) + R"(,"uid_initiator":)" +
            json_string(share.get_initiator().empty() ? share.get_owner() : share.get_initiator()) +
            R"(,"path":)" + json_string(share.get_path());
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

    void add_share_routes(nc::Host&)
    {
        constexpr std::string_view BASE = "/ocs/v2.php/apps/files_sharing/api/v1/shares";

        // Who a share can go to: people and groups of this server that match the text, and people
        // on other servers this one knows (or the address that was typed, when it looks like one).
        m_app->route(
            "GET",
            "/ocs/v2.php/apps/files_sharing/api/v1/sharees",
            USER,
            [this](const Request& request)
            {
                const std::string search = request.query_value("search");
                if (search.size() > 100) {
                    return failure(400, "The search text is too long");
                }
                std::string users = "[";
                std::string groups = "[";
                std::string remotes = "[";
                std::string exact_users = "[";
                std::string exact_groups = "[";
                std::string exact_remotes = "[";
                const auto entry = [](int type, const std::string& label, const std::string& with)
                {
                    return R"({"label":)" + json_string(label) + R"(,"value":{"shareType":)" +
                           std::to_string(type) + R"(,"shareWith":)" + json_string(with) + "}}";
                };
                const auto add = [](std::string& list, const std::string& item)
                {
                    list += (list.size() > 1 ? "," : "") + item;
                };
                const std::string lowered = nc::util::to_lower(search);
                for (const std::string& line: nc::util::split(
                         m_host->call_service("users.search", search).get_body(),
                         '\n'
                     )) {
                    const std::size_t tab = line.find('\t');
                    if (line.empty() || line.substr(0, tab) == request.get_user()) {
                        continue;
                    }
                    const std::string id = line.substr(0, tab);
                    const std::string label = tab == std::string::npos || line.size() == tab + 1
                                                  ? id
                                                  : line.substr(tab + 1);
                    const bool exact =
                        nc::util::to_lower(id) == lowered || nc::util::to_lower(label) == lowered;
                    add(exact ? exact_users : users, entry(nc::cloud::SHARE_TYPE_USER, label, id));
                }
                for (const std::string& group: nc::util::split(
                         m_host->call_service("groups.search", search).get_body(),
                         '\n'
                     )) {
                    if (!group.empty()) {
                        add(nc::util::to_lower(group) == lowered ? exact_groups : groups,
                            entry(nc::cloud::SHARE_TYPE_GROUP, group, group));
                    }
                }
                bool typed_is_known = false;
                for (const std::string& address: nc::util::split(
                         m_host->call_service("federation.remotes", "").get_body(),
                         '\n'
                     )) {
                    if (address.empty() ||
                        nc::util::to_lower(address).find(lowered) == std::string::npos) {
                        continue;
                    }
                    const bool exact = nc::util::to_lower(address) == lowered;
                    typed_is_known = typed_is_known || exact;
                    add(exact ? exact_remotes : remotes,
                        entry(nc::cloud::SHARE_TYPE_REMOTE, address, address));
                }
                // People other servers' directories know (if a lookup directory is configured).
                for (const std::string& line: nc::util::split(
                         m_host->call_service("lookup.search", search).get_body(),
                         '\n'
                     )) {
                    const std::size_t tab = line.find('\t');
                    if (line.empty()) {
                        continue;
                    }
                    const std::string address = line.substr(0, tab);
                    const std::string label = tab == std::string::npos || line.size() == tab + 1
                                                  ? address
                                                  : line.substr(tab + 1) + " (" + address + ")";
                    typed_is_known = typed_is_known || nc::util::to_lower(address) == lowered;
                    add(nc::util::to_lower(address) == lowered ? exact_remotes : remotes,
                        entry(nc::cloud::SHARE_TYPE_REMOTE, label, address));
                }
                // Something that looks like name@server can be shared with even if never seen
                // before.
                const std::size_t at = search.rfind('@');
                if (!typed_is_known && at != std::string::npos && at > 0 &&
                    at + 1 < search.size() && search.find_first_of(" \t/\\") == std::string::npos &&
                    m_host->call_service("federation.remotes", "").get_status() == 200) {
                    add(exact_remotes, entry(nc::cloud::SHARE_TYPE_REMOTE, search, search));
                }
                return ok(
                    R"({"exact":{"users":)" + exact_users + R"(],"groups":)" + exact_groups +
                    R"(],"remotes":)" + exact_remotes + R"(]},"users":)" + users +
                    R"(],"groups":)" + groups + R"(],"remotes":)" + remotes + "]}"
                );
            }
        );

        m_app->route(
            "POST",
            BASE,
            USER,
            [this](const Request& request)
            {
                const auto form = nc::util::parse_form(request.get_body());
                const auto field = [&](std::string_view name)
                {
                    std::string value = nc::util::form_value(form, name);
                    return value.empty() ? request.query_value(name) : value;
                };
                const std::string actor = request.get_user();
                std::string owner = actor;
                auto path = Storage::normalize(field("path"));
                if (!path || *path == "/") {
                    return failure(404, "Wrong path, file/folder does not exist");
                }
                // What the person may hand on: everything of their own, and of what was shared with
                // them only what the share's own permissions allow (resharing needs the "share"
                // bit).
                int cap = 31;
                bool reshare = false;
                if (!safe_user(actor)) {
                    return failure(404, "Wrong path, file/folder does not exist");
                }
                if (!storage_for(actor).stat(*path)) {
                    const auto mounted = resolve_mounted(actor, *path);
                    if (!mounted) {
                        return failure(404, "Wrong path, file/folder does not exist");
                    }
                    if (!(mounted->permissions & 16)) {
                        return failure(403, "Resharing is not allowed");
                    }
                    owner = mounted->owner;
                    path = mounted->path;
                    cap = mounted->permissions;
                    reshare = true;
                }
                if (!safe_user(owner) || !storage_for(owner).stat(*path)) {
                    return failure(404, "Wrong path, file/folder does not exist");
                }
                const int default_mask = reshare ? cap : 31;
                const std::string type_text = field("shareType");
                const int type =
                    type_text.empty() ? nc::cloud::SHARE_TYPE_USER : std::atoi(type_text.c_str());
                Share share{std::string{owner}, std::string{*path}};
                share.set_type(type);
                if (reshare) {
                    share.set_initiator(std::string{actor});
                }
                if (type == nc::cloud::SHARE_TYPE_USER) {
                    const std::string recipient = field("shareWith");
                    if (recipient == owner || recipient == actor) {
                        return failure(400, "Cannot share with yourself");
                    }
                    if (recipient.empty() ||
                        m_host->call_service("users.get", recipient).get_status() != 200) {
                        return failure(404, "Wrong share recipient");
                    }
                    share.set_share_with(std::string{recipient});
                    const std::string permissions = field("permissions");
                    const int mask =
                        permissions.empty() ? default_mask : std::atoi(permissions.c_str());
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
                    const int mask =
                        permissions.empty() ? default_mask : std::atoi(permissions.c_str());
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
                } else if (type == nc::cloud::SHARE_TYPE_REMOTE ||
                           type == nc::cloud::SHARE_TYPE_REMOTE_GROUP) {
                    // A user (or a group, for type 9) on another server: "name@host[:port]". The
                    // federation plugin tells that server; this share is what it will present the
                    // token for.
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
                if (reshare) {
                    if (type == nc::cloud::SHARE_TYPE_REMOTE ||
                        type == nc::cloud::SHARE_TYPE_REMOTE_GROUP) {
                        return failure(
                            403,
                            "A share from another person cannot go to another server"
                        );
                    }
                    // A link that takes uploads needs the right to create.
                    const bool link_like =
                        type == nc::cloud::SHARE_TYPE_LINK || type == nc::cloud::SHARE_TYPE_EMAIL;
                    const int wanted = link_like ? (share.get_permissions() == 1 ? 1 : (1 | 4))
                                                 : share.get_permissions();
                    if ((wanted & ~cap) != 0) {
                        return failure(403, "You cannot give more permissions than you have");
                    }
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
                if (type == nc::cloud::SHARE_TYPE_REMOTE ||
                    type == nc::cloud::SHARE_TYPE_REMOTE_GROUP) {
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
                             {"kind", type == nc::cloud::SHARE_TYPE_REMOTE_GROUP ? "group" : "user"
                             },
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
                         {"owner",
                          added->get_initiator().empty() ? added->get_owner()
                                                         : added->get_initiator()},
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

        m_app->route(
            "GET",
            BASE,
            USER,
            [this](const Request& request)
            {
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

        m_app->route(
            "GET",
            std::string{BASE} + "/{id}",
            USER,
            [this](const Request& request)
            {
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

        m_app->route(
            "DELETE",
            std::string{BASE} + "/{id}",
            USER,
            [this](const Request& request)
            {
                const std::uint64_t id =
                    std::strtoull(std::string{request.param("id")}.c_str(), nullptr, 10);
                const auto share = m_shares->find(id);
                if (!share || (share->get_owner() != request.get_user() &&
                               share->get_initiator() != request.get_user())) {
                    return failure(404, "Wrong share ID, share does not exist");
                }
                (void)m_shares->remove(id);
                remove_orphaned_reshares();
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
        if (request.body_size() > m_max_upload) {
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
        Response response{200, std::string{nc::util::mime_type_for(node->name())}, {}, {}};
        std::optional<nc::cloud::FileStream> stream;
        if (node->get_size() >= Storage::STREAM_THRESHOLD) {
            stream = storage.open_stream(inner);
        }
        if (stream) {
            response.set_stream(stream->size(), stream->reader(0, stream->size()));
        } else {
            auto data = storage.read(inner);
            if (!data) {
                return Response::text(404, "Not Found");
            }
            response.set_body(std::move(*data));
        }
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
            "encryption:rotate-key",
            "Switches a user's files to the key in the config: encryption:rotate-key <user> "
            "<file with the old key (64 hex digits)>. Run it for every user, then remove the old "
            "key.",
            [this](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 2 || !safe_user(args[0]) || m_encryption_key.empty()) {
                    out =
                        "usage: encryption:rotate-key <user> <old-key-file> (needs the new key in "
                        "the config)\n";
                    return 1;
                }
                std::ifstream file{args[1]};
                std::string line;
                std::getline(file, line);
                const auto old_key = nc::cloud::FileCipher::key_from_hex(nc::util::trim(line));
                if (!old_key) {
                    out = "the old key file must hold 64 hexadecimal digits\n";
                    return 1;
                }
                if (*old_key == m_encryption_key) {
                    out = "the old key is the key in the config; nothing to do\n";
                    return 1;
                }
                const nc::cloud::FileCipher old_cipher{std::string{*old_key}, std::string{args[0]}};
                std::size_t changed = 0;
                // Files, the trash and the versions all hold encrypted copies.
                for (const Storage& storage:
                     {storage_for(args[0]), trash_for(args[0]), versions_for(args[0])}) {
                    const auto rotated = storage.rotate_key(old_cipher);
                    if (!rotated) {
                        out = rotated.error().get_message() + "\n";
                        return 1;
                    }
                    changed += *rotated;
                }
                out = "re-encrypted " + std::to_string(changed) + " file(s)\n";
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
                remove_orphaned_reshares();
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
    std::uint64_t m_archive_max_bytes{4'096ULL * 1'024U * 1'024U};

    struct ExternalFtp
    {
        std::string name{};
        std::string host{};
        std::string port{"21"};
        std::string base{}; // "" or "/some/folder", where the storage starts on the server
        std::string user{};
        std::string password{};
        bool writable{false};
        std::string group{};
        bool secure_shell{false};  // sftp:// instead of ftp://
        bool tls{false};           // ftps://: FTP over explicit TLS
        std::string private_key{}; // sftp: file with the private key (password is its passphrase)
        std::string host_key{};    // SHA-256 of the server's host key (base64), required for sftp
    };

    struct External
    {
        std::string name{};
        std::filesystem::path path{};
        int permissions{1};
        std::string group{};
    };

    std::vector<External> m_external{};
    std::vector<ExternalDav> m_dav{};
    std::vector<ExternalS3> m_s3{};
    std::vector<ExternalFtp> m_ftp{};
    nc::cloud::ftp::Session::Settings m_ftp_settings{};
    nc::federation::ClientSettings m_s3_client{};
    nc::federation::ClientSettings m_dav_client{};
    std::unique_ptr<nc::cloud::ShareStore> m_shares{};
    std::unique_ptr<nc::app::App> m_app{};
    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(CloudPlugin)
