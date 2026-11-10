#pragma once

#include "nextcloud/http.h"
#include "storage.h"

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace nc::cloud {

/// How the DAV layer announces changes (`file.created`, ...); the plugin forwards them to the event
/// bus.
using Publish = std::function<void(std::string_view topic, std::string_view payload)>;

/// @brief Points where other plugins may step in before the files change; both are optional.
struct Hooks
{
    /// Called before a delete. Returning true means the thing was taken care of (moved to the
    /// trash), so the storage must not delete it.
    std::function<bool(const std::string& user, const std::string& path)> before_delete{};
    /// Called before an existing file is overwritten (to keep a version of it).
    std::function<void(const std::string& user, const std::string& path)> before_overwrite{};
    /// What the files of one downloaded archive (a folder as zip or tar) may add up to; 0 turns
    /// archives off.
    std::uint64_t archive_max_bytes{4ULL * 1'024U * 1'024U * 1'024U};
    /// File numbers and favorites (a user's own files only; unset: no such properties). The number
    /// of a path, made on first ask; `0` means none.
    std::function<std::int64_t(const std::string& user, const std::string& path)> file_id{};
    std::function<bool(const std::string& user, const std::string& path)> is_favorite{};
    std::function<void(const std::string& user, const std::string& path, bool favorite)>
        set_favorite{};
    std::function<std::vector<std::string>(const std::string& user)> favorites{};
    /// Told after a rename or delete through WebDAV, so the numbers follow.
    std::function<void(const std::string& user, const std::string& from, const std::string& to)>
        after_move{};
    std::function<void(const std::string& user, const std::string& path)> after_delete{};
    /// This server's id, the tail of `oc:id`.
    std::string instance_id{};
    /// The user's own shares as (path, share type) pairs, for `oc:share-types`; unset: none shown.
    std::function<std::vector<std::pair<std::string, int>>(const std::string& user)> share_types{};
    /// The name to show for a user, for `oc:owner-display-name`.
    std::function<std::string(const std::string& user)> display_name{};
};

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
    const Publish& publish,
    const Hooks& hooks = {}
);

/// @brief A folder as a zip or tar file when the request asks for one (`?accept=zip|tar`, the
/// `Accept` header; with `default_zip` a request without either gets a zip), else nothing.
/// `?files=[...]` / `X-NC-Files` pick names inside the folder. `path` is the folder's path in the
/// storage; the files may add up to `max_bytes` (0: archives are off).
[[nodiscard]] std::optional<nc::http::Response> folder_archive_for(
    const nc::http::Request& request,
    const Storage& storage,
    const Node& folder,
    const std::string& path,
    std::uint64_t max_bytes,
    bool default_zip = false
);

/// @brief One property of a node: `prefix` is `d` (DAV:), `oc` (owncloud.org/ns) or `nc`
/// (nextcloud.org/ns), `value` the XML inside the element.
struct Prop
{
    std::string prefix{};
    std::string name{};
    std::string value{};
};

/// @brief What a PROPFIND asked for: everything (`allprop`, or no body), the names only
/// (`propname`), or a list of properties; those a node does not have come back in a 404 part.
struct PropRequest
{
    enum class Kind
    {
        ALL,
        NAMES,
        LIST
    };

    struct Name
    {
        std::string ns{};
        std::string name{};
    };

    Kind kind{Kind::ALL};
    std::vector<Name> list{};

    /// @brief True when this property was asked for by name (a list), so that properties that
    /// cost something are worked out only then.
    [[nodiscard]] bool asked(std::string_view ns, std::string_view name) const;
};

/// @brief More properties for a node (the ones only some files have, like the number); the request
/// says which were asked for, so that what costs something is worked out only then.
using ExtraProps = std::function<std::vector<Prop>(const Node& node, const PropRequest& wanted)>;

/// @brief Reads the body of a PROPFIND; nullopt when it is not one.
[[nodiscard]] std::optional<PropRequest> parse_prop_request(std::string_view body);

/// @brief The namespace URI of a property prefix (`d`, `oc`, `nc`).
[[nodiscard]] std::string_view namespace_of(std::string_view prefix) noexcept;

/// @brief The `207 Multi-Status` XML for a PROPFIND answer. The quota properties
/// (`quota-used-bytes`, `quota-available-bytes`) are worked out only when asked for by name.
[[nodiscard]] std::string multistatus(
    const std::vector<Node>& nodes,
    std::string_view base_href,
    std::string_view owner,
    const Storage& storage,
    const ExtraProps& extra = {},
    const PropRequest& wanted = {}
);

/// @brief ETag, Last-Modified and the headers that make a browser download the file instead of
/// running it.
void add_download_headers(nc::http::Response& response, const Node& node);

/// @brief What a `Range: bytes=...` header asks for, against a file of `size` bytes.
struct ByteRange
{
    enum class State
    {
        WHOLE,        // no range, or one to ignore: send the whole file
        PARTIAL,      // send first..last (inclusive)
        UNSATISFIABLE // 416
    };
    State state{State::WHOLE};
    std::uint64_t first{0};
    std::uint64_t last{0};
};

/// @brief One range only (`a-b`, `a-`, `-n`); several ranges, other units and malformed headers
/// give WHOLE.
[[nodiscard]] ByteRange parse_range(std::string_view header, std::uint64_t size);

/// @brief The path inside the user's files that a `Destination` header names (decoded), or empty
/// when it points somewhere else than below `base_href`.
[[nodiscard]] std::string destination_of(std::string_view header, std::string_view base_href);

[[nodiscard]] int http_status(const StorageError& error) noexcept;

} // namespace nc::cloud
