/**
 * @file cloud_plugin.cc
 * @brief The cloud plugin: per-user file storage with WebDAV (`/remote.php/dav/files/{user}`),
 * shares by user and by public link (`/ocs/v2.php/apps/files_sharing/api/v1/shares`, `/s/{token}`),
 * and the `files:*` / `share:*` commands. Counterpart of Nextcloud's `apps/files`, `apps/dav` and
 * `apps/files_sharing`.
 */
#include "dav.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"
#include "share_store.h"
#include "storage.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <memory>
#include <span>

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
        static constexpr std::string_view REQUIRED[] = {"users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_data_dir = host.config("data_dir", "data");
        m_quota = std::strtoull(host.config("quota_bytes", "0").c_str(), nullptr, 10);
        m_public_url = host.config("overwrite_url", "");
        m_shares = std::make_unique<nc::cloud::ShareStore>(m_data_dir + "/shares.db");
        if (auto loaded = m_shares->load(); !loaded) {
            throw std::runtime_error(loaded.error());
        }
        m_host = &host;

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
        return Storage{std::filesystem::path{m_data_dir} / std::string{user} / "files", m_quota};
    }

    [[nodiscard]] Storage trash_for(std::string_view user) const
    {
        return Storage{std::filesystem::path{m_data_dir} / std::string{user} / "files_trashbin"};
    }

    [[nodiscard]] Storage versions_for(std::string_view user) const
    {
        return Storage{std::filesystem::path{m_data_dir} / std::string{user} / "files_versions"};
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

    /// Services for the trash bin and the versions plugin: they keep the records, this plugin keeps
    /// the bytes, so all file system access stays behind `Storage`.
    void add_storage_services(nc::Host& host)
    {
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
                         {"size", std::to_string(files.size_of(node->get_path()).value_or(0))},
                         {"dir", node->is_directory() ? "1" : "0"}}
                    )
                );
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

    /// One received share as the recipient sees it: a name in the top folder, and where it really
    /// is.
    struct Mount
    {
        Share share{};
        std::string name{};
        bool directory{false};
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
            mounts.push_back(Mount{share, name, node->is_directory()});
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
            auto node = storage_for(mount.share.get_owner()).stat(mount.share.get_path());
            if (!node) {
                continue;
            }
            node->set_path("/" + mount.name);
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

    /// Serves a request inside a mounted share: the owner's folder is the root, and the share's
    /// permissions (1 read, 2 update, 4 create, 8 delete) decide what is allowed.
    [[nodiscard]] Response serve_mount(
        const Request& request,
        const Mount& mount,
        const std::string& rest,
        const std::string& base
    ) const
    {
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
        Storage root = mount.directory ? Storage{std::filesystem::path{m_data_dir} / share.get_owner() / "files" / share.get_path().substr(1)}
                                       : Storage{std::filesystem::path{m_data_dir} / share.get_owner() / "files" / (parent.empty() ? "" : parent.substr(1))};
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
        const bool link = share.get_type() == nc::cloud::SHARE_TYPE_LINK;
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
                } else if (type == nc::cloud::SHARE_TYPE_LINK) {
                    share.set_permissions(1); // public links are read-only
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
                m_host->publish(
                    "share.created",
                    nc::util::form_encode(
                        {{"id", std::to_string(added->get_id())},
                         {"type", std::to_string(added->get_type())},
                         {"owner", added->get_owner()},
                         {"share_with", added->get_share_with()},
                         {"path", added->get_path()},
                         {"token",
                          added->get_type() == nc::cloud::SHARE_TYPE_LINK ? added->get_token()
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
                        {{"id", std::to_string(id)}, {"owner", share->get_owner()}}
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
    }

    [[nodiscard]] Response serve_public(const Request& request) const
    {
        const auto share = m_shares->find_by_token(request.param("token"));
        // One answer for "no such token" and "expired", so a token cannot be probed.
        if (!share || share->expired(now_seconds()) || !safe_user(share->get_owner())) {
            return Response::text(404, "Not Found");
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
    std::unique_ptr<nc::cloud::ShareStore> m_shares{};
    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(CloudPlugin)
