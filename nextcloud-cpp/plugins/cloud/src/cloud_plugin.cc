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
        return nc::cloud::dav_handle(
            request,
            storage_for(user),
            nc::cloud::DavTarget{
                std::string{user},
                std::move(base),
                std::string{request.param("path")}
            },
            publisher()
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
                for (const Share& share: received ? m_shares->shared_with(request.get_user())
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
