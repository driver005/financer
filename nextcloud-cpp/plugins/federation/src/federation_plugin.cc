/**
 * @file federation_plugin.cc
 * @brief Sharing between servers, after the Open Cloud Mesh protocol (Nextcloud's `apps/federation`
 * and `apps/federatedfilesharing`).
 *
 * Sending: the cloud plugin makes a share of type 6 and calls `federation.send`; this plugin finds
 * the other server (`/ocm-provider/`), and posts the share (`POST <endPoint>/shares`) with a
 * secret. The other server reads the files through `/public.php/webdav` with that secret as user
 * name.
 *
 * Receiving: `POST /ocm/shares` stores the share as pending for a local user; the user accepts or
 * declines it (`/ocs/v2.php/apps/files_sharing/api/v1/remote_shares`), and the sender is told
 * (`POST /ocm/notifications`). An accepted share is a read-only mount in the user's files: the
 * cloud plugin asks `federation.mounts` what to mount and `federation.fetch` for every request
 * inside it.
 *
 * Every request to another server goes through `http_client` (certificate and name checked, local
 * addresses refused unless the administrator allows them).
 */
#include "http_client.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <optional>

namespace {

using nc::http::Request;
using nc::http::Response;
using nc::util::Json;

constexpr std::string_view PUBLIC_DAV = "/public.php/webdav";

std::int64_t now_seconds()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

/// `name@server` split at the last '@'.
struct Address
{
    std::string user{};
    std::string server{};
};

/// True for `host`, `host:port` and `[v6]:port` with nothing else in it.
bool plausible_server(std::string_view server)
{
    if (server.empty() || server.size() > 255) {
        return false;
    }
    const auto parsed = nc::federation::parse_url("https://" + std::string{server});
    return parsed.has_value() && parsed->target == "/" &&
           server.find('/') == std::string_view::npos;
}

std::optional<Address> split_address(std::string_view text)
{
    const std::size_t at = text.rfind('@');
    if (at == std::string_view::npos || at == 0 || at + 1 >= text.size() || text.size() > 320) {
        return std::nullopt;
    }
    Address address{std::string{text.substr(0, at)}, std::string{text.substr(at + 1)}};
    if (address.user.find_first_of(" \t\r\n/\\") != std::string::npos ||
        !plausible_server(address.server)) {
        return std::nullopt;
    }
    return address;
}

/// A name fit to be a folder entry: no separators, no control characters, not hidden, bounded.
std::string clean_name(std::string_view text)
{
    std::string name;
    for (const char letter: text) {
        const auto byte = static_cast<unsigned char>(letter);
        name += (letter == '/' || letter == '\\' || byte < 0x20 || byte == 0x7F) ? '_' : letter;
    }
    name = std::string{nc::util::trim(name)};
    while (!name.empty() && name.front() == '.') {
        name.erase(name.begin());
    }
    if (name.size() > 200) {
        name.resize(200);
    }
    return name.empty() ? std::string{"share"} : name;
}

bool secret_ok(std::string_view secret)
{
    return secret.size() >= 8 && secret.size() <= 255 &&
           std::ranges::all_of(
               secret,
               [](char letter)
               {
                   return std::isalnum(static_cast<unsigned char>(letter)) != 0 || letter == '-' ||
                          letter == '_';
               }
           );
}

bool id_ok(std::string_view id)
{
    return !id.empty() && id.size() <= 64 &&
           std::ranges::all_of(
               id,
               [](char letter)
               {
                   return std::isalnum(static_cast<unsigned char>(letter)) != 0 || letter == '-' ||
                          letter == '_';
               }
           );
}

/// The share permissions (1 read, 2 update, 4 create, 8 delete, 16 share) in the OCM list form.
std::string permissions_json(int mask)
{
    std::string out = "[";
    if (mask & 1) {
        out += "\"read\"";
    }
    if (mask & (2 | 4 | 8)) {
        out += std::string{out.size() > 1 ? "," : ""} + "\"write\"";
    }
    if (mask & 16) {
        out += std::string{out.size() > 1 ? "," : ""} + "\"share\"";
    }
    return out + "]";
}

int permissions_of(const Json& value)
{
    if (value.is_number()) {
        const int mask = static_cast<int>(value.number());
        return mask >= 1 && mask <= 31 ? mask : 1;
    }
    int mask = 0;
    for (const Json& item: value.items()) {
        if (item.string() == "read") {
            mask |= 1;
        } else if (item.string() == "write") {
            mask |= 2 | 4 | 8;
        } else if (item.string() == "share") {
            mask |= 16;
        }
    }
    return mask == 0 ? 1 : mask;
}

class FederationPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "federation";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Sharing with users on other servers (Open Cloud Mesh)";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_public_url = host.config("url", "");
        while (!m_public_url.empty() && m_public_url.back() == '/') {
            m_public_url.pop_back();
        }
        m_client.set_allow_http(host.config("allow_http", "false") == "true");
        m_client.set_allow_local(host.config("allow_local", "false") == "true");
        m_client.set_ca_file(host.config("ca_file", ""));
        m_client.set_timeout_seconds(std::atoi(host.config("timeout_seconds", "15").c_str()));
        m_client.set_handshake_timeout_seconds(
            std::atoi(host.config("handshake_timeout_seconds", "5").c_str())
        );
        m_max_pending = static_cast<std::size_t>(
            std::max(1, std::atoi(host.config("max_pending_per_user", "100").c_str()))
        );

        nc::db::Client{&host}.migrate(
            "federation",
            1,
            "CREATE TABLE nc_fed_incoming ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, owner TEXT NOT NULL,"
            " base TEXT NOT NULL, name TEXT NOT NULL, directory INTEGER NOT NULL,"
            " permissions INTEGER NOT NULL, token TEXT NOT NULL, remote_id TEXT NOT NULL,"
            " state INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);"
            "CREATE UNIQUE INDEX nc_fed_incoming_remote ON nc_fed_incoming (uid, base, remote_id);"
            "CREATE TABLE nc_fed_outgoing ("
            " share_id INTEGER PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,"
            " remote_user TEXT NOT NULL, base TEXT NOT NULL, token TEXT NOT NULL);"
        );

        add_services(host);
        add_protocol_routes(host);
        add_user_routes(host);

        host.subscribe(
            "share.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                if (nc::util::form_value(form, "type") == "6") {
                    withdraw(nc::util::form_value(form, "id"));
                }
            }
        );
        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                const std::string user = nc::util::form_value(form, "id");
                if (!user.empty()) {
                    nc::db::Client{m_host}.exec(
                        "DELETE FROM nc_fed_incoming WHERE uid = ?",
                        {user}
                    );
                }
            }
        );
    }

private:
    // ---- talking to other servers -----------------------------------------------------------

    /// Another server as found: where it lives and where its OCM endpoint is.
    struct Provider
    {
        std::string base{};
        std::string end_point{};
    };

    [[nodiscard]] nc::federation::ClientSettings discovery_settings() const
    {
        nc::federation::ClientSettings settings = m_client;
        settings.set_max_response(1U << 20U);
        return settings;
    }

    /// The server at `server` ("host[:port]"): https first, plain http only when the administrator
    /// allows it. nullopt when it is not reachable or does not offer OCM.
    [[nodiscard]] std::optional<Provider> discover(const std::string& server) const
    {
        std::vector<std::string> schemes{"https"};
        if (m_client.allow_http()) {
            schemes.emplace_back("http");
        }
        for (const std::string& scheme: schemes) {
            const std::string base = scheme + "://" + server;
            const auto answer = nc::federation::request(
                discovery_settings(),
                "GET",
                base + "/ocm-provider/",
                {},
                ""
            );
            if (!answer || answer->get_status() != 200) {
                continue;
            }
            const auto json = Json::parse(answer->get_body());
            if (!json || !json->is_object() ||
                ((*json)["enabled"].is_bool() && !(*json)["enabled"].boolean())) {
                continue;
            }
            Provider provider{base, base + "/ocm"};
            // The server names its own endpoint; one on another host is not followed.
            if (const std::string& named = (*json)["endPoint"].string();
                nc::util::starts_with(named, base + "/") && named.size() < 512) {
                provider.end_point = named;
                while (provider.end_point.back() == '/') {
                    provider.end_point.pop_back();
                }
            }
            return provider;
        }
        return std::nullopt;
    }

    [[nodiscard]] std::string own_base(const Request& request) const
    {
        if (!m_public_url.empty()) {
            return m_public_url;
        }
        const std::string_view host_header = request.header("Host");
        return host_header.empty() ? std::string{}
                                   : std::string{m_client.allow_http() ? "http" : "https"} + "://" +
                                         std::string{host_header};
    }

    static std::string server_of(std::string_view base)
    {
        const std::size_t scheme = base.find("://");
        return std::string{scheme == std::string_view::npos ? base : base.substr(scheme + 3)};
    }

    /// Empty when the other server took it, else why not.
    [[nodiscard]] std::string post_json(const std::string& url, const std::string& body) const
    {
        const auto answer = nc::federation::request(
            discovery_settings(),
            "POST",
            url,
            {{"Content-Type", "application/json"}},
            body
        );
        if (!answer) {
            return answer.error();
        }
        if (answer->get_status() < 200 || answer->get_status() >= 300) {
            return "answered " + std::to_string(answer->get_status());
        }
        return {};
    }

    // ---- sending ----------------------------------------------------------------------------

    void add_services(nc::Host& host)
    {
        // Form: id, owner, path, name, directory, token, share_with, permissions, base_url. Tells
        // the other server about a share the cloud plugin made. 200 when it took it.
        host.add_service(
            "federation.send",
            [this](std::string_view args)
            {
                return send(nc::util::parse_form(args));
            }
        );

        // Form: user. One line per accepted share: id, name, directory, permissions.
        host.add_service(
            "federation.mounts",
            [this](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                std::string out;
                for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                         "SELECT id, name, directory, permissions FROM nc_fed_incoming WHERE uid = "
                         "? AND state = 1 ORDER BY id",
                         {nc::util::form_value(form, "user")}
                     )) {
                    out += nc::util::form_encode(
                               {{"id", nc::db::value_of(row, "id")},
                                {"name", nc::db::value_of(row, "name")},
                                {"directory", nc::db::value_of(row, "directory")},
                                {"permissions", nc::db::value_of(row, "permissions")}}
                           ) +
                           "\n";
                }
                return Response::text(200, out);
            }
        );

        // Form: id, user, method (GET or PROPFIND), path, depth, href_base. Asks the owner's server
        // and answers with its status and body; the links of a PROPFIND answer are rewritten to
        // `href_base`.
        host.add_service(
            "federation.fetch",
            [this](std::string_view args)
            {
                return fetch(nc::util::parse_form(args));
            }
        );
    }

    [[nodiscard]] Response send(const std::vector<std::pair<std::string, std::string>>& form)
    {
        const auto field = [&](std::string_view name)
        {
            return nc::util::form_value(form, name);
        };
        const auto recipient = split_address(field("share_with"));
        std::string base = !m_public_url.empty() ? m_public_url : field("base_url");
        if (!recipient) {
            return Response::text(400, "Use name@server to share with another server");
        }
        if (base.empty() || !plausible_server(server_of(base))) {
            return Response::text(
                400,
                "The address of this server is not known (set [federation] url)"
            );
        }
        const auto provider = discover(recipient->server);
        if (!provider) {
            return Response::text(
                400,
                recipient->server + " could not be reached or does not accept shares"
            );
        }
        const std::string owner_address = field("owner") + "@" + server_of(base);
        const int permissions = std::atoi(field("permissions").c_str());
        const std::string body =
            R"({"shareWith":)" + json_string(recipient->user + "@" + recipient->server) +
            R"(,"name":)" + json_string(field("name")) + R"(,"providerId":)" +
            json_string(field("id")) + R"(,"owner":)" + json_string(owner_address) +
            R"(,"ownerDisplayName":)" + json_string(field("owner")) + R"(,"sender":)" +
            json_string(owner_address) + R"(,"senderDisplayName":)" + json_string(field("owner")) +
            R"(,"shareType":"user","resourceType":")" +
            std::string{field("directory") == "1" ? "folder" : "file"} +
            R"(","protocol":{"name":"webdav","options":{"sharedSecret":)" +
            json_string(field("token")) + R"(,"permissions":)" + permissions_json(permissions) +
            "}}}";
        if (const std::string reason = post_json(provider->end_point + "/shares", body);
            !reason.empty()) {
            return Response::text(400, recipient->server + " did not accept the share: " + reason);
        }
        nc::db::Client{m_host}.exec(
            "INSERT OR REPLACE INTO nc_fed_outgoing (share_id, owner, name, remote_user, base, "
            "token) VALUES (?, ?, ?, ?, ?, ?)",
            {field("id"),
             field("owner"),
             field("name"),
             recipient->user + "@" + recipient->server,
             provider->base,
             field("token")}
        );
        return Response::text(200, "sent");
    }

    /// The owner removed a share with another server: tell it, so the mount goes away there.
    void withdraw(const std::string& share_id)
    {
        const nc::db::Client db{m_host};
        const auto rows =
            db.query("SELECT base, token FROM nc_fed_outgoing WHERE share_id = ?", {share_id});
        if (rows.empty()) {
            return;
        }
        db.exec("DELETE FROM nc_fed_outgoing WHERE share_id = ?", {share_id});
        const std::string base = nc::db::value_of(rows.front(), "base");
        (void)post_json(
            base + "/ocm/notifications",
            notification_json("SHARE_UNSHARED", share_id, nc::db::value_of(rows.front(), "token"))
        );
    }

    static std::string
    notification_json(std::string_view type, std::string_view provider_id, std::string_view secret)
    {
        return R"({"notificationType":)" + json_string(type) +
               R"(,"resourceType":"file","providerId":)" + json_string(provider_id) +
               R"(,"notification":{"sharedSecret":)" + json_string(secret) + "}}";
    }

    // ---- reading what another server shares --------------------------------------------------

    [[nodiscard]] Response fetch(const std::vector<std::pair<std::string, std::string>>& form)
    {
        const auto field = [&](std::string_view name)
        {
            return nc::util::form_value(form, name);
        };
        const std::string method = field("method");
        if (method != "GET" && method != "PROPFIND") {
            return Response::text(405, "Remote shares are read-only here");
        }
        const auto rows = nc::db::Client{m_host}.query(
            "SELECT base, token, directory FROM nc_fed_incoming WHERE id = ? AND uid = ? AND "
            "state = 1",
            {field("id"), field("user")}
        );
        if (rows.empty()) {
            return Response::text(404, "no such share");
        }
        const std::string base = nc::db::value_of(rows.front(), "base");
        const std::string token = nc::db::value_of(rows.front(), "token");
        const std::string path = field("path");
        if (nc::db::value_of(rows.front(), "directory") != "1" && !path.empty()) {
            return Response::text(404, "not found");
        }
        std::vector<nc::http::Header> headers{
            {"Authorization", "Basic " + nc::util::base64_encode(token + ":")}
        };
        std::string body;
        if (method == "PROPFIND") {
            headers.emplace_back("Depth", field("depth") == "0" ? "0" : "1");
            headers.emplace_back("Content-Type", "application/xml");
            body = R"(<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>)";
        }
        const auto answer = nc::federation::request(
            m_client,
            method,
            base + std::string{PUBLIC_DAV} + nc::util::url_encode_path(path),
            headers,
            body
        );
        if (!answer) {
            return Response::text(502, answer.error());
        }
        const int status = answer->get_status();
        if (status == 401 || status == 403) {
            return Response::text(502, "the owner's server no longer accepts this share");
        }
        std::string content = answer->get_body();
        if (status == 207) {
            content = rewrite_links(content, field("href_base"));
        }
        return Response::text(status, std::move(content));
    }

    /// Every `<..href>` of a multistatus answer that points into `/public.php/webdav` points into
    /// `href_base` instead.
    static std::string rewrite_links(const std::string& xml, const std::string& href_base)
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
            const std::string link = xml.substr(start, end - start);
            const std::size_t marker = link.find(PUBLIC_DAV);
            out += marker == std::string::npos
                       ? link
                       : href_base + link.substr(marker + PUBLIC_DAV.size());
            at = end;
        }
        out.append(xml, at, std::string::npos);
        return out;
    }

    // ---- what other servers call ----------------------------------------------------------------

    void add_protocol_routes(nc::Host& host)
    {
        for (const std::string_view path: {"/ocm-provider", "/.well-known/ocm"}) {
            host.add_route(
                "GET",
                path,
                [this](const Request& request)
                {
                    const std::string base = own_base(request);
                    return Response::json(
                        200,
                        R"({"enabled":true,"apiVersion":"1.0-proposal1","endPoint":)" +
                            json_string(base + "/ocm") +
                            R"(,"resourceTypes":[{"name":"file","shareTypes":["user"],)"
                            R"("protocols":{"webdav":"/public.php/webdav/"}}]})"
                    );
                }
            );
        }
        host.add_route(
            "POST",
            "/ocm/shares",
            [this](const Request& request)
            {
                return receive_share(request);
            }
        );
        host.add_route(
            "POST",
            "/ocm/notifications",
            [this](const Request& request)
            {
                return receive_notification(request);
            }
        );
    }

    [[nodiscard]] Response receive_share(const Request& request)
    {
        // One answer for every reason, so the endpoint tells nothing about who has an account here.
        const auto refuse = []
        {
            return Response::json(400, R"({"message":"invalid share"})");
        };
        const auto json = Json::parse(request.get_body());
        if (!json || !json->is_object()) {
            return refuse();
        }
        const auto recipient = split_address((*json)["shareWith"].string());
        const auto owner = split_address((*json)["owner"].string());
        const Json& protocol = (*json)["protocol"];
        const std::string& secret = protocol["options"]["sharedSecret"].string();
        const std::string provider_id =
            (*json)["providerId"].is_number()
                ? std::to_string(static_cast<long long>((*json)["providerId"].number()))
                : (*json)["providerId"].string();
        if (!recipient || !owner || protocol["name"].string() != "webdav" || !secret_ok(secret) ||
            !id_ok(provider_id) || (*json)["shareType"].string() != "user" ||
            (*json)["name"].string().empty()) {
            return refuse();
        }
        const std::string& user = recipient->user;
        if (m_host->call_service("users.get", user).get_status() != 200) {
            return refuse();
        }
        const nc::db::Client db{m_host};
        const auto pending = db.query(
            "SELECT COUNT(*) AS n FROM nc_fed_incoming WHERE uid = ? AND state = 0",
            {user}
        );
        if (!pending.empty() &&
            static_cast<std::size_t>(
                std::strtoull(nc::db::value_of(pending.front(), "n").c_str(), nullptr, 10)
            ) >= m_max_pending) {
            return Response::json(429, R"({"message":"too many pending shares"})");
        }
        // The sender must be a server that speaks OCM: that is also how the scheme is learned.
        const auto provider = discover(owner->server);
        if (!provider) {
            return refuse();
        }
        const bool directory = (*json)["resourceType"].string() == "folder";
        const std::string name = clean_name((*json)["name"].string());
        try {
            db.exec(
                "INSERT INTO nc_fed_incoming (uid, owner, base, name, directory, permissions, "
                "token, remote_id, state, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
                {user,
                 owner->user + "@" + owner->server,
                 provider->base,
                 name,
                 directory ? "1" : "0",
                 std::to_string(permissions_of(protocol["options"]["permissions"])),
                 secret,
                 provider_id,
                 std::to_string(now_seconds())}
            );
        } catch (const std::exception&) {
            return refuse(); // the same share twice
        }
        (void)m_host->call_service(
            "notifications.push",
            nc::util::form_encode(
                {{"user", user},
                 {"subject",
                  owner->user + "@" + owner->server + " wants to share \"" + name + "\" with you"},
                 {"message", ""},
                 {"link", ""}}
            )
        );
        return Response::json(201, "{}");
    }

    [[nodiscard]] Response receive_notification(const Request& request)
    {
        const auto json = Json::parse(request.get_body());
        if (!json || !json->is_object()) {
            return Response::json(400, R"({"message":"invalid notification"})");
        }
        const std::string& type = (*json)["notificationType"].string();
        const std::string provider_id =
            (*json)["providerId"].is_number()
                ? std::to_string(static_cast<long long>((*json)["providerId"].number()))
                : (*json)["providerId"].string();
        const std::string& secret = (*json)["notification"]["sharedSecret"].string();
        const nc::db::Client db{m_host};
        if (!id_ok(provider_id) || !secret_ok(secret)) {
            return Response::json(400, R"({"message":"invalid notification"})");
        }
        // Whoever knows the secret of a share may talk about it.
        if (type == "SHARE_UNSHARED") {
            // The owner withdrew a share this server received.
            const auto rows = db.query(
                "SELECT id, token FROM nc_fed_incoming WHERE remote_id = ?",
                {provider_id}
            );
            for (const nc::db::Row& row: rows) {
                if (nc::util::constant_time_equals(nc::db::value_of(row, "token"), secret)) {
                    db.exec(
                        "DELETE FROM nc_fed_incoming WHERE id = ?",
                        {nc::db::value_of(row, "id")}
                    );
                }
            }
            return Response::json(201, "{}");
        }
        if (type == "SHARE_ACCEPTED" || type == "SHARE_DECLINED") {
            // The recipient answered a share this server sent.
            const auto rows = db.query(
                "SELECT owner, name, remote_user, token FROM nc_fed_outgoing WHERE share_id = ?",
                {provider_id}
            );
            if (rows.empty() ||
                !nc::util::constant_time_equals(nc::db::value_of(rows.front(), "token"), secret)) {
                return Response::json(400, R"({"message":"invalid notification"})");
            }
            const std::string owner = nc::db::value_of(rows.front(), "owner");
            const bool accepted = type == "SHARE_ACCEPTED";
            (void)m_host->call_service(
                "notifications.push",
                nc::util::form_encode(
                    {{"user", owner},
                     {"subject",
                      nc::db::value_of(rows.front(), "remote_user") +
                          (accepted ? " accepted \"" : " declined \"") +
                          nc::db::value_of(rows.front(), "name") + "\""},
                     {"message", ""},
                     {"link", ""}}
                )
            );
            if (!accepted) {
                (void)m_host->call_service(
                    "cloud.remove_remote_share",
                    nc::util::form_encode({{"id", provider_id}, {"token", secret}})
                );
                db.exec("DELETE FROM nc_fed_outgoing WHERE share_id = ?", {provider_id});
            }
            return Response::json(201, "{}");
        }
        return Response::json(400, R"({"message":"unknown notification type"})");
    }

    // ---- what the recipient does ------------------------------------------------------------

    [[nodiscard]] std::string incoming_json(const nc::db::Row& row) const
    {
        const bool directory = nc::db::value_of(row, "directory") == "1";
        return R"({"id":)" + nc::db::value_of(row, "id") + R"(,"remote":)" +
               json_string(nc::db::value_of(row, "base")) + R"(,"remote_id":)" +
               json_string(nc::db::value_of(row, "remote_id")) + R"(,"name":)" +
               json_string("/" + nc::db::value_of(row, "name")) + R"(,"owner":)" +
               json_string(nc::db::value_of(row, "owner")) + R"(,"permissions":)" +
               nc::db::value_of(row, "permissions") + R"(,"mountpoint":)" +
               json_string("/" + nc::db::value_of(row, "name")) + R"(,"accepted":)" +
               (nc::db::value_of(row, "state") == "1" ? "true" : "false") + R"(,"type":")" +
               (directory ? "dir" : "file") + "\"}";
    }

    [[nodiscard]] Response list_incoming(const Request& request, int state) const
    {
        std::string data = "[";
        bool first = true;
        for (const nc::db::Row& row: nc::db::Client{m_host}.query(
                 "SELECT id, owner, base, name, directory, permissions, remote_id, state FROM "
                 "nc_fed_incoming WHERE uid = ? AND state = ? ORDER BY id",
                 {request.get_user(), std::to_string(state)}
             )) {
            data += first ? "" : ",";
            first = false;
            data += incoming_json(row);
        }
        return nc::http::ocs(200, "OK", data + "]");
    }

    /// Tells the sender what became of its share. Failures are not the user's problem: the share
    /// stays as the user decided.
    void answer_sender(const nc::db::Row& row, std::string_view type)
    {
        (void)post_json(
            nc::db::value_of(row, "base") + "/ocm/notifications",
            notification_json(
                type,
                nc::db::value_of(row, "remote_id"),
                nc::db::value_of(row, "token")
            )
        );
    }

    void add_user_routes(nc::Host& host)
    {
        constexpr std::string_view BASE = "/ocs/v2.php/apps/files_sharing/api/v1/remote_shares";
        host.add_route(
            "GET",
            BASE,
            [this](const Request& request)
            {
                return request.get_user().empty() ? nc::http::unauthorized()
                                                  : list_incoming(request, 1);
            }
        );
        host.add_route(
            "GET",
            std::string{BASE} + "/pending",
            [this](const Request& request)
            {
                return request.get_user().empty() ? nc::http::unauthorized()
                                                  : list_incoming(request, 0);
            }
        );
        host.add_route(
            "POST",
            std::string{BASE} + "/pending/{id}",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const nc::db::Client db{m_host};
                const auto rows = db.query(
                    "SELECT id, base, remote_id, token FROM nc_fed_incoming WHERE id = ? AND uid = "
                    "? AND state = 0",
                    {std::string{request.param("id")}, request.get_user()}
                );
                if (rows.empty()) {
                    return nc::http::ocs(404, "Wrong share ID, share does not exist", "{}");
                }
                db.exec(
                    "UPDATE nc_fed_incoming SET state = 1 WHERE id = ?",
                    {nc::db::value_of(rows.front(), "id")}
                );
                answer_sender(rows.front(), "SHARE_ACCEPTED");
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        // Declining a pending share, or leaving an accepted one.
        for (const std::string& path:
             {std::string{BASE} + "/pending/{id}", std::string{BASE} + "/{id}"}) {
            host.add_route(
                "DELETE",
                path,
                [this](const Request& request)
                {
                    if (request.get_user().empty()) {
                        return nc::http::unauthorized();
                    }
                    const nc::db::Client db{m_host};
                    const auto rows = db.query(
                        "SELECT id, base, remote_id, token, state FROM nc_fed_incoming WHERE id = "
                        "? AND uid = ?",
                        {std::string{request.param("id")}, request.get_user()}
                    );
                    if (rows.empty()) {
                        return nc::http::ocs(404, "Wrong share ID, share does not exist", "{}");
                    }
                    db.exec(
                        "DELETE FROM nc_fed_incoming WHERE id = ?",
                        {nc::db::value_of(rows.front(), "id")}
                    );
                    answer_sender(rows.front(), "SHARE_DECLINED");
                    return nc::http::ocs(200, "OK", "{}");
                }
            );
        }
    }

    nc::federation::ClientSettings m_client{};
    std::string m_public_url{};
    std::size_t m_max_pending{100};
    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(FederationPlugin)
