#pragma once

#include "nextcloud/http.h"
#include "storage.h"

#include <functional>
#include <string>
#include <string_view>

namespace nc::cloud {

/// How the DAV layer announces changes (`file.created`, ...); the plugin forwards them to the event
/// bus.
using Publish = std::function<void(std::string_view topic, std::string_view payload)>;

/// @brief Where a DAV request lands: whose files, under which URL, and which path inside them.
class DavTarget
{
public:
    DavTarget() noexcept = default;

    DavTarget(std::string&& user, std::string&& base_href, std::string&& path) noexcept :
        m_user{std::move(user)},
        m_base_href{std::move(base_href)},
        m_path{std::move(path)}
    {
    }

    void set_user(std::string&& user) noexcept
    {
        m_user = std::move(user);
    }

    void set_base_href(std::string&& base_href) noexcept
    {
        m_base_href = std::move(base_href);
    }

    void set_path(std::string&& path) noexcept
    {
        m_path = std::move(path);
    }

    [[nodiscard]] std::string& get_user() noexcept
    {
        return m_user;
    }

    [[nodiscard]] const std::string& get_user() const noexcept
    {
        return m_user;
    }

    /// The URL of the user's root, without trailing slash: `/remote.php/dav/files/alice`.
    [[nodiscard]] std::string& get_base_href() noexcept
    {
        return m_base_href;
    }

    [[nodiscard]] const std::string& get_base_href() const noexcept
    {
        return m_base_href;
    }

    /// The path inside the user's files, as sent by the client (not yet normalized).
    [[nodiscard]] std::string& get_path() noexcept
    {
        return m_path;
    }

    [[nodiscard]] const std::string& get_path() const noexcept
    {
        return m_path;
    }

private:
    std::string m_user{};
    std::string m_base_href{};
    std::string m_path{};
};

/// @brief Serves one WebDAV request (GET, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND) on a user's
/// files.
///
/// Counterpart of Nextcloud's `apps/dav` file tree (`OCA\DAV\Files`) for the verbs the sync clients
/// use. Every PROPFIND answers with the same property set, whatever the request body asks for.
[[nodiscard]] nc::http::Response dav_handle(
    const nc::http::Request& request,
    const Storage& storage,
    const DavTarget& target,
    const Publish& publish
);

/// @brief The `207 Multi-Status` XML for a PROPFIND answer.
[[nodiscard]] std::string multistatus(
    const std::vector<Node>& nodes,
    std::string_view base_href,
    std::string_view owner,
    const Storage& storage
);

/// @brief ETag, Last-Modified and the headers that make a browser download the file instead of
/// running it.
void add_download_headers(nc::http::Response& response, const Node& node);

[[nodiscard]] int http_status(const StorageError& error) noexcept;

} // namespace nc::cloud
