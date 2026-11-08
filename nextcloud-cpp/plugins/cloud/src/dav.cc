#include "dav.h"

#include "nextcloud/util/text.h"
#include "nextcloud/util/time.h"

#include <chrono>

namespace nc::cloud {

namespace {

    using nc::http::Request;
    using nc::http::Response;

    std::string quote(std::string_view etag)
    {
        return "\"" + std::string{etag} + "\"";
    }

    std::string event_payload(std::string_view user, std::string_view path)
    {
        return util::form_encode({{"user", std::string{user}}, {"path", std::string{path}}});
    }

    Response failure(const StorageError& error)
    {
        return Response::text(http_status(error), error.get_message());
    }

    void add_file_headers(Response& response, const Node& node)
    {
        response.add_header("ETag", quote(node.get_etag()));
        response.add_header("OC-ETag", quote(node.get_etag()));
        response.add_header(
            "Last-Modified",
            util::http_date(
                std::chrono::system_clock::from_time_t(static_cast<std::time_t>(node.get_mtime()))
            )
        );
    }

    /// The path part of a `Destination` header, decoded; empty when it points to another place.
    std::string destination_path(std::string_view header, std::string_view base_href)
    {
        std::string_view rest = header;
        if (const std::size_t scheme = rest.find("://"); scheme != std::string_view::npos) {
            const std::size_t slash = rest.find('/', scheme + 3);
            rest = slash == std::string_view::npos ? std::string_view{} : rest.substr(slash);
        }
        const std::string decoded = util::url_decode(rest);
        if (decoded == base_href) {
            return "/";
        }
        if (!util::starts_with(decoded, std::string{base_href} + "/")) {
            return {};
        }
        return decoded.substr(base_href.size());
    }

    Response propfind(
        const Request& request,
        const Storage& storage,
        const DavTarget& target,
        const std::string& path
    )
    {
        const std::string_view depth = request.header("Depth");
        if (depth == "infinity") {
            return Response::text(403, "Depth infinity is not supported");
        }
        auto node = storage.stat(path);
        if (!node) {
            return failure(node.error());
        }
        std::vector<Node> nodes{*node};
        if (node->is_directory() && depth != "0") {
            auto children = storage.list(path);
            if (!children) {
                return failure(children.error());
            }
            nodes.insert(nodes.end(), children->begin(), children->end());
        }
        return Response::xml(
            207,
            multistatus(nodes, target.get_base_href(), target.get_user(), storage)
        );
    }

} // namespace

void add_download_headers(nc::http::Response& response, const Node& node)
{
    add_file_headers(response, node);
    // Files are user content: never let a browser run it as part of this origin.
    response.add_header(
        "Content-Disposition",
        "attachment; filename*=UTF-8''" + util::url_encode_path(node.name())
    );
    response.add_header("X-Content-Type-Options", "nosniff");
    response.add_header("Content-Security-Policy", "default-src 'none'; sandbox");
}

int http_status(const StorageError& error) noexcept
{
    switch (error.get_code()) {
        case StorageCode::NOT_FOUND:
            return 404;
        case StorageCode::EXISTS:
            return 412;
        case StorageCode::PARENT_MISSING:
            return 409;
        case StorageCode::IS_DIRECTORY:
            return 405;
        case StorageCode::NOT_DIRECTORY:
            return 409;
        case StorageCode::INVALID_PATH:
            return 400;
        case StorageCode::QUOTA:
            return 507;
        case StorageCode::IO:
            return 500;
    }
    return 500;
}

std::string multistatus(
    const std::vector<Node>& nodes,
    std::string_view base_href,
    std::string_view owner,
    const Storage& storage
)
{
    std::string xml = "<?xml version=\"1.0\"?>\n"
                      "<d:multistatus xmlns:d=\"DAV:\" xmlns:oc=\"http://owncloud.org/ns\" "
                      "xmlns:nc=\"http://nextcloud.org/ns\">\n";
    for (const Node& node: nodes) {
        std::string href = std::string{base_href} +
                           util::url_encode_path(node.get_path() == "/" ? "" : node.get_path());
        if (node.is_directory()) {
            href += "/";
        }
        const std::uint64_t size =
            node.is_directory() ? storage.size_of(node.get_path()).value_or(0) : node.get_size();
        xml += " <d:response>\n  <d:href>" + util::xml_escape(href) +
               "</d:href>\n  <d:propstat>\n   <d:prop>\n";
        xml +=
            "    <d:getlastmodified>" +
            util::http_date(
                std::chrono::system_clock::from_time_t(static_cast<std::time_t>(node.get_mtime()))
            ) +
            "</d:getlastmodified>\n";
        xml += node.is_directory() ? "    <d:resourcetype><d:collection/></d:resourcetype>\n"
                                   : "    <d:resourcetype/>\n";
        if (!node.is_directory()) {
            xml += "    <d:getcontentlength>" + std::to_string(node.get_size()) +
                   "</d:getcontentlength>\n";
            xml += "    <d:getcontenttype>" + util::xml_escape(util::mime_type_for(node.name())) +
                   "</d:getcontenttype>\n";
        }
        xml += "    <d:getetag>" + util::xml_escape(quote(node.get_etag())) + "</d:getetag>\n";
        xml += "    <oc:size>" + std::to_string(size) + "</oc:size>\n";
        xml += std::string{"    <oc:permissions>"} + (node.is_directory() ? "RGDNVCK" : "RGDNVW") +
               "</oc:permissions>\n";
        xml += "    <oc:owner-id>" + util::xml_escape(owner) + "</oc:owner-id>\n";
        xml += "   </d:prop>\n   <d:status>HTTP/1.1 200 OK</d:status>\n  </d:propstat>\n "
               "</d:response>\n";
    }
    return xml + "</d:multistatus>\n";
}

Response dav_handle(
    const Request& request,
    const Storage& storage,
    const DavTarget& target,
    const Publish& publish,
    const Hooks& hooks
)
{
    const auto normalized = Storage::normalize("/" + target.get_path());
    if (!normalized) {
        return failure(normalized.error());
    }
    const std::string& path = *normalized;
    const std::string& method = request.get_method();
    const std::string& user = target.get_user();

    if (auto root = storage.ensure_root(); !root) {
        return failure(root.error());
    }

    if (method == "PROPFIND") {
        return propfind(request, storage, target, path);
    }

    if (method == "GET") {
        auto node = storage.stat(path);
        if (!node) {
            return failure(node.error());
        }
        if (node->is_directory()) {
            return Response::text(405, "Cannot download a folder; use PROPFIND to list it");
        }
        auto data = storage.read(path);
        if (!data) {
            return failure(data.error());
        }
        Response
            response{200, std::string{util::mime_type_for(node->name())}, std::move(*data), {}};
        add_download_headers(response, *node);
        return response;
    }

    if (method == "PUT") {
        std::int64_t mtime = 0;
        const std::string_view asked = request.header("X-OC-Mtime");
        if (!asked.empty()) {
            mtime = std::strtoll(std::string{asked}.c_str(), nullptr, 10);
        }
        if (hooks.before_overwrite) {
            const auto existing = storage.stat(path);
            if (existing && !existing->is_directory()) {
                hooks.before_overwrite(user, path);
            }
        }
        auto created = storage.write(path, request.get_body(), mtime);
        if (!created) {
            return failure(created.error());
        }
        publish(*created ? "file.created" : "file.updated", event_payload(user, path));
        Response response{*created ? 201 : 204};
        if (auto node = storage.stat(path)) {
            add_file_headers(response, *node);
        }
        if (mtime > 0) {
            response.add_header("X-OC-Mtime", "accepted");
        }
        return response;
    }

    if (method == "MKCOL") {
        auto made = storage.make_directory(path);
        if (!made) {
            // For MKCOL an existing target is "method not allowed" (RFC 4918, 9.3.1).
            return made.error().get_code() == StorageCode::EXISTS
                       ? Response::text(405, "The folder already exists")
                       : failure(made.error());
        }
        publish("file.created", event_payload(user, path));
        return Response{201};
    }

    if (method == "DELETE") {
        if (hooks.before_delete && storage.stat(path) && hooks.before_delete(user, path)) {
            publish("file.deleted", event_payload(user, path));
            return Response{204};
        }
        auto removed = storage.remove(path);
        if (!removed) {
            return failure(removed.error());
        }
        publish("file.deleted", event_payload(user, path));
        return Response{204};
    }

    if (method == "MOVE" || method == "COPY") {
        const std::string destination =
            destination_path(request.header("Destination"), target.get_base_href());
        if (destination.empty()) {
            return Response::text(502, "The destination is not inside this account");
        }
        const auto target_path = Storage::normalize(destination);
        if (!target_path) {
            return failure(target_path.error());
        }
        const bool overwrite = request.header("Overwrite") != "F";
        auto done = method == "MOVE" ? storage.move(path, *target_path, overwrite)
                                     : storage.copy(path, *target_path, overwrite);
        if (!done) {
            return failure(done.error());
        }
        publish(
            method == "MOVE" ? "file.moved" : "file.copied",
            util::form_encode({{"user", user}, {"path", path}, {"target", *target_path}})
        );
        return Response{*done ? 201 : 204};
    }

    return Response::text(405, "Method Not Allowed");
}

} // namespace nc::cloud
