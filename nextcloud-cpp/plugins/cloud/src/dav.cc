#include "dav.h"

#include "folder_archive.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"
#include "nextcloud/util/time.h"
#include "nextcloud/util/xml.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <map>
#include <optional>

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

    /// `zip` or `tar` when the request asks for a folder as an archive: by `?accept=zip` (or
    /// `tar`, `application/zip`, `application/x-tar`, comma separated) or by the Accept header.
    std::optional<ArchiveWriter::Format> archive_format(const Request& request)
    {
        std::vector<std::string> accepted;
        const std::string parameter = request.query_value("accept");
        const std::string source =
            parameter.empty() ? std::string{request.header("Accept")} : parameter;
        for (const std::string& part: util::split(source, ',')) {
            std::string name{util::trim(part.substr(0, part.find(';')))};
            std::transform(
                name.begin(),
                name.end(),
                name.begin(),
                [](unsigned char letter)
                {
                    return static_cast<char>(std::tolower(letter));
                }
            );
            accepted.push_back(std::move(name));
        }
        const auto asks = [&](std::string_view a, std::string_view b)
        {
            return std::find(accepted.begin(), accepted.end(), a) != accepted.end() ||
                   std::find(accepted.begin(), accepted.end(), b) != accepted.end();
        };
        if (asks("application/zip", "zip")) {
            return ArchiveWriter::Format::ZIP;
        }
        if (asks("application/x-tar", "tar")) {
            return ArchiveWriter::Format::TAR;
        }
        return std::nullopt;
    }

    /// The names the client picked (`?files=["a","b"]` as JSON, or `X-NC-Files: a,b`); nullopt
    /// when the parameter is not usable.
    std::optional<std::vector<std::string>> archive_files(const Request& request)
    {
        std::vector<std::string> names;
        const std::string parameter = request.query_value("files");
        if (!parameter.empty()) {
            const auto json = util::Json::parse(parameter);
            if (!json) {
                return std::nullopt;
            }
            if (json->is_string()) {
                names.push_back(json->string());
            } else if (json->is_array()) {
                for (const util::Json& item: json->items()) {
                    if (!item.is_string()) {
                        return std::nullopt;
                    }
                    names.push_back(item.string());
                }
            } else {
                return std::nullopt;
            }
            return names;
        }
        for (const std::string& part: util::split(request.header("X-NC-Files"), ',')) {
            if (!util::trim(part).empty()) {
                names.emplace_back(util::trim(part));
            }
        }
        return names;
    }

    /// Writes `node` (and below it, for a folder) into the archive under `name`. What cannot be
    /// read is listed in `missing` with the reason; an error is for the archive itself.
    util::expected<void, std::string> archive_tree(
        ArchiveWriter& writer,
        const Storage& storage,
        const Node& node,
        const std::string& name,
        std::map<std::string, std::string>& missing,
        int depth
    )
    {
        if (node.is_directory()) {
            if (depth > 64) {
                missing[name] = "The folder is nested too deeply.";
                return {};
            }
            if (auto added = writer.add_directory(name, node.get_mtime()); !added) {
                return added;
            }
            auto children = storage.list(node.get_path());
            if (!children) {
                missing[name] = children.error().get_message();
                return {};
            }
            for (const Node& child: *children) {
                if (auto added = archive_tree(
                        writer,
                        storage,
                        child,
                        name + "/" + child.name(),
                        missing,
                        depth + 1
                    );
                    !added) {
                    return added;
                }
            }
            return {};
        }
        std::optional<FileStream> stream;
        std::string whole;
        ArchiveWriter::Source source;
        std::uint64_t size = node.get_size();
        if (size >= Storage::STREAM_THRESHOLD) {
            stream = storage.open_stream(node.get_path());
        }
        if (stream) {
            size = stream->size();
            source = stream->reader(0, size);
        } else {
            auto data = storage.read(node.get_path());
            if (!data) {
                missing[name] = data.error().get_message();
                return {};
            }
            whole = std::move(*data);
            size = whole.size();
            source = [&whole, offset = std::size_t{0}](char* buffer, std::size_t capacity) mutable
                -> std::int64_t
            {
                const std::size_t count = std::min(capacity, whole.size() - offset);
                std::copy_n(whole.data() + offset, count, buffer);
                offset += count;
                return static_cast<std::int64_t>(count);
            };
        }
        const auto added = writer.add_file(name, node.get_mtime(), size, source);
        if (!added) {
            return util::unexpected<std::string>{added.error()};
        }
        if (!*added) {
            missing[name] =
                "The file could not be read completely; the rest was filled with zeros.";
        }
        return {};
    }

    /// A folder as one zip or tar file (Nextcloud's `ZipFolderPlugin`): the whole folder, or the
    /// names in `files`. Files that cannot be read are listed in `missing_files.json` inside.
    Response archive_response(
        const Storage& storage,
        const Node& folder,
        const std::string& path,
        ArchiveWriter::Format format,
        const std::vector<std::string>& files,
        std::uint64_t max_bytes
    )
    {
        if (max_bytes == 0) {
            return Response::text(405, "Folders cannot be downloaded as archives here");
        }
        auto writer = ArchiveWriter::create(format, max_bytes);
        if (!writer) {
            return Response::text(500, writer.error());
        }
        // The top folder of the archive is the folder's name; for the root of the account it is
        // "download".
        const std::string archive_name = path == "/" ? "download" : folder.name();
        std::map<std::string, std::string> missing;
        std::vector<std::string> top_names;
        const auto fail = [](const std::string& message)
        {
            return Response::text(
                message.find("larger than an archive") != std::string::npos ? 413 : 500,
                message
            );
        };
        if (files.empty()) {
            if (auto added = archive_tree(*writer, storage, folder, archive_name, missing, 0);
                !added) {
                return fail(added.error());
            }
        } else {
            for (const std::string& file: files) {
                const auto inside = Storage::normalize((path == "/" ? "" : path) + "/" + file);
                if (!inside || file.empty() || file.find('/') != std::string::npos) {
                    return Response::text(400, "Invalid file name in the list");
                }
                auto node = storage.stat(*inside);
                if (!node) {
                    missing[file] = node.error().get_message();
                    continue;
                }
                top_names.push_back(file);
                if (auto added = archive_tree(*writer, storage, *node, file, missing, 0); !added) {
                    return fail(added.error());
                }
            }
        }
        if (!missing.empty()) {
            std::string name = "missing_files.json";
            for (int attempt = 1;
                 std::find(top_names.begin(), top_names.end(), name) != top_names.end();
                 ++attempt) {
                name = "missing_files (" + std::to_string(attempt) + ").json";
            }
            std::string json = "{\n";
            for (auto it = missing.begin(); it != missing.end(); ++it) {
                json += "    \"" + util::json_escape(it->first) + "\": \"" +
                        util::json_escape(it->second) + "\"" +
                        (std::next(it) == missing.end() ? "\n" : ",\n");
            }
            json += "}";
            // Next to the files in a list, inside the folder otherwise.
            const std::string where = files.empty() ? archive_name + "/" + name : name;
            if (auto added = writer->add_text(where, std::time(nullptr), json); !added) {
                return fail(added.error());
            }
        }
        auto finished = writer->finish();
        if (!finished) {
            return Response::text(500, finished.error());
        }
        const bool zip = format == ArchiveWriter::Format::ZIP;
        Response response{200, zip ? "application/zip" : "application/x-tar", std::string{}, {}};
        response.set_stream(finished->size, finished->reader());
        response.add_header(
            "Content-Disposition",
            "attachment; filename*=UTF-8''" + util::url_encode_path(archive_name) +
                (zip ? ".zip" : ".tar")
        );
        response.add_header("Cache-Control", "no-store");
        return response;
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

    /// The properties that only a user's own files have: the number, `oc:id` and the favorite mark.
    ExtraProps extra_props(const Hooks& hooks, const std::string& user)
    {
        if (!hooks.file_id) {
            return {};
        }
        return [&hooks, user](const Node& node)
        {
            const std::int64_t id = hooks.file_id(user, node.get_path());
            if (id <= 0) {
                return std::string{};
            }
            std::string digits = std::to_string(id);
            std::string out = "    <oc:fileid>" + digits + "</oc:fileid>\n";
            out += "    <oc:id>" + std::string(digits.size() < 8 ? 8 - digits.size() : 0, '0') +
                   digits + util::xml_escape(hooks.instance_id) + "</oc:id>\n";
            out += std::string{"    <oc:favorite>"} +
                   (hooks.is_favorite && hooks.is_favorite(user, node.get_path()) ? "1" : "0") +
                   "</oc:favorite>\n";
            return out;
        };
    }

    /// `PROPPATCH`: the only property a client may set here is the favorite mark. Every property
    /// gets its own answer, so a client that sets a time as well still hears about the mark.
    Response proppatch(
        const Request& request,
        const Storage& storage,
        const DavTarget& target,
        const std::string& path,
        const Hooks& hooks
    )
    {
        const auto node = storage.stat(path);
        if (!node) {
            return failure(node.error());
        }
        const auto body = util::Xml::parse(request.get_body());
        if (!body || body->name() != "propertyupdate") {
            return Response::text(400, "Not a propertyupdate");
        }
        std::string good;
        std::string refused;
        const auto handle = [&](const util::Xml& block, bool set)
        {
            for (const util::Xml* property: block.find_all("prop")) {
                for (const util::Xml& entry: property->children()) {
                    const std::string tag = "<" +
                                            std::string{entry.name() == "favorite" ? "oc:" : "d:"} +
                                            entry.name() + "/>";
                    if (entry.name() == "favorite" && hooks.set_favorite && hooks.file_id) {
                        hooks.set_favorite(target.get_user(), path, set && entry.text() == "1");
                        good += "    " + tag + "\n";
                    } else {
                        refused +=
                            "    <x:" + entry.name() + " xmlns:x=\"http://nextcloud.org/ns\"/>\n";
                    }
                }
            }
        };
        for (const util::Xml* block: body->find_all("set")) {
            handle(*block, true);
        }
        for (const util::Xml* block: body->find_all("remove")) {
            handle(*block, false);
        }
        std::string href = target.get_base_href() + util::url_encode_path(path == "/" ? "" : path) +
                           (node->is_directory() ? "/" : "");
        std::string xml =
            "<?xml version=\"1.0\"?>\n<d:multistatus xmlns:d=\"DAV:\" "
            "xmlns:oc=\"http://owncloud.org/ns\" xmlns:nc=\"http://nextcloud.org/ns\">\n"
            " <d:response>\n  <d:href>" +
            util::xml_escape(href) + "</d:href>\n";
        if (!good.empty()) {
            xml += "  <d:propstat>\n   <d:prop>\n" + good +
                   "   </d:prop>\n   <d:status>HTTP/1.1 200 OK</d:status>\n  </d:propstat>\n";
        }
        if (!refused.empty()) {
            xml +=
                "  <d:propstat>\n   <d:prop>\n" + refused +
                "   </d:prop>\n   <d:status>HTTP/1.1 403 Forbidden</d:status>\n  </d:propstat>\n";
        }
        return Response::xml(207, xml + " </d:response>\n</d:multistatus>\n");
    }

    /// `REPORT` `oc:filter-files` with the favorite rule: the user's favorites below the folder.
    Response filter_files(
        const Request& request,
        const Storage& storage,
        const DavTarget& target,
        const std::string& path,
        const Hooks& hooks
    )
    {
        const auto body = util::Xml::parse(request.get_body());
        if (!body || body->name() != "filter-files") {
            return Response::text(400, "Only filter-files reports are supported");
        }
        const util::Xml* rules = body->find("filter-rules");
        if (rules == nullptr || rules->children().size() != 1 ||
            rules->children().front().name() != "favorite" || !hooks.favorites || !hooks.file_id) {
            return Response::text(400, "Only the favorite rule is supported");
        }
        if (rules->children().front().text() != "1") {
            return Response::text(400, "Only favorite=1 is supported");
        }
        std::vector<Node> nodes;
        const std::string below = path == "/" ? "/" : path + "/";
        for (const std::string& favorite: hooks.favorites(target.get_user())) {
            if (!util::starts_with(favorite, below) && favorite != path) {
                continue;
            }
            if (auto node = storage.stat(favorite)) {
                nodes.push_back(std::move(*node));
            }
        }
        return Response::xml(
            207,
            multistatus(
                nodes,
                target.get_base_href(),
                target.get_user(),
                storage,
                extra_props(hooks, target.get_user())
            )
        );
    }

    Response propfind(
        const Request& request,
        const Storage& storage,
        const DavTarget& target,
        const std::string& path,
        const Hooks& hooks
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
            multistatus(
                nodes,
                target.get_base_href(),
                target.get_user(),
                storage,
                extra_props(hooks, target.get_user())
            )
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

ByteRange parse_range(std::string_view header, std::uint64_t size)
{
    ByteRange out;
    out.state = ByteRange::State::WHOLE;
    if (!util::starts_with(header, "bytes=") || header.find(',') != std::string_view::npos) {
        return out; // another unit, or several ranges: the whole file is a valid answer
    }
    const std::string_view spec = header.substr(6);
    const std::size_t dash = spec.find('-');
    if (dash == std::string_view::npos) {
        return out;
    }
    const std::string first_text{util::trim(spec.substr(0, dash))};
    const std::string last_text{util::trim(spec.substr(dash + 1))};
    const auto number = [](const std::string& text, std::uint64_t& value)
    {
        if (text.empty() || text.size() > 18 ||
            text.find_first_not_of("0123456789") != std::string::npos) {
            return false;
        }
        value = std::strtoull(text.c_str(), nullptr, 10);
        return true;
    };
    std::uint64_t first = 0;
    std::uint64_t last = 0;
    if (first_text.empty()) {
        // "-500": the last 500 bytes
        if (!number(last_text, last) || last == 0) {
            return out.state = ByteRange::State::UNSATISFIABLE, out;
        }
        if (size == 0) {
            return out.state = ByteRange::State::UNSATISFIABLE, out;
        }
        first = last >= size ? 0 : size - last;
        last = size - 1;
    } else {
        if (!number(first_text, first)) {
            return out;
        }
        if (last_text.empty()) {
            last = size == 0 ? 0 : size - 1;
        } else if (!number(last_text, last) || last < first) {
            return out; // a malformed range is ignored (RFC 9110, 14.1.2)
        }
        if (first >= size) {
            return out.state = ByteRange::State::UNSATISFIABLE, out;
        }
        last = std::min<std::uint64_t>(last, size - 1);
    }
    out.state = ByteRange::State::PARTIAL;
    out.first = first;
    out.last = last;
    return out;
}

std::string destination_of(std::string_view header, std::string_view base_href)
{
    return destination_path(header, base_href);
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
    const Storage& storage,
    const ExtraProps& extra
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
        // A folder that arrives with a size (a mounted share) keeps it; any other is measured.
        const std::uint64_t size = node.is_directory() && node.get_size() == 0
                                       ? storage.size_of(node.get_path()).value_or(0)
                                       : node.get_size();
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
        if (extra) {
            xml += extra(node);
        }
        xml += "   </d:prop>\n   <d:status>HTTP/1.1 200 OK</d:status>\n  </d:propstat>\n "
               "</d:response>\n";
    }
    return xml + "</d:multistatus>\n";
}

std::optional<Response> folder_archive_for(
    const Request& request,
    const Storage& storage,
    const Node& folder,
    const std::string& path,
    std::uint64_t max_bytes,
    bool default_zip
)
{
    auto format = archive_format(request);
    if (!format && default_zip) {
        format = ArchiveWriter::Format::ZIP;
    }
    if (!format) {
        return std::nullopt;
    }
    const auto files = archive_files(request);
    if (!files) {
        return Response::text(400, "The files parameter is not a list of names");
    }
    return archive_response(storage, folder, path, *format, *files, max_bytes);
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
        return propfind(request, storage, target, path, hooks);
    }

    if (method == "PROPPATCH") {
        return proppatch(request, storage, target, path, hooks);
    }

    if (method == "REPORT") {
        return filter_files(request, storage, target, path, hooks);
    }

    if (method == "GET") {
        auto node = storage.stat(path);
        if (!node) {
            return failure(node.error());
        }
        if (node->is_directory()) {
            // As a zip or tar file when the request asks for one.
            if (auto archive =
                    folder_archive_for(request, storage, *node, path, hooks.archive_max_bytes)) {
                return std::move(*archive);
            }
            return Response::text(405, "Cannot download a folder; use PROPFIND to list it");
        }
        // A client that already has this version only needs to hear so.
        const std::string_view none_match = request.header("If-None-Match");
        if (!none_match.empty() &&
            (none_match == "*" || none_match.find(node->get_etag()) != std::string_view::npos)) {
            Response not_modified{304};
            add_file_headers(not_modified, *node);
            return not_modified;
        }
        const std::string type{util::mime_type_for(node->name())};
        const std::string_view range_header = request.header("Range");

        // A big plain file goes out in pieces; everything else is read whole.
        std::optional<FileStream> stream;
        std::string whole;
        if (node->get_size() >= Storage::STREAM_THRESHOLD) {
            stream = storage.open_stream(path);
        }
        if (!stream) {
            auto data = storage.read(path);
            if (!data) {
                return failure(data.error());
            }
            whole = std::move(*data);
        }
        const std::uint64_t size = stream ? stream->size() : whole.size();
        if (!range_header.empty()) {
            const ByteRange range = parse_range(range_header, size);
            if (range.state == ByteRange::State::UNSATISFIABLE) {
                Response refused{416};
                refused.add_header("Content-Range", "bytes */" + std::to_string(size));
                return refused;
            }
            if (range.state == ByteRange::State::PARTIAL) {
                const std::uint64_t length = range.last - range.first + 1;
                Response partial{
                    206,
                    std::string{type},
                    stream ? std::string{} : whole.substr(range.first, length),
                    {}
                };
                if (stream) {
                    partial.set_stream(length, stream->reader(range.first, length));
                }
                add_download_headers(partial, *node);
                partial.add_header("Accept-Ranges", "bytes");
                partial.add_header(
                    "Content-Range",
                    "bytes " + std::to_string(range.first) + "-" + std::to_string(range.last) +
                        "/" + std::to_string(size)
                );
                return partial;
            }
        }
        Response response{200, std::string{type}, std::move(whole), {}};
        if (stream) {
            response.set_stream(size, stream->reader(0, size));
        }
        add_download_headers(response, *node);
        response.add_header("Accept-Ranges", "bytes");
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
        // A big upload that the server spooled to disk goes into the storage from that file; an
        // encrypting storage needs the whole content and reads it.
        auto created = !request.get_body_file().empty() && !storage.encrypts()
                           ? storage.write_from_file(path, request.get_body_file(), mtime)
                           : storage.write(path, request.get_body(), mtime);
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
            if (hooks.after_delete) {
                hooks.after_delete(user, path);
            }
            publish("file.deleted", event_payload(user, path));
            return Response{204};
        }
        auto removed = storage.remove(path);
        if (!removed) {
            return failure(removed.error());
        }
        if (hooks.after_delete) {
            hooks.after_delete(user, path);
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
        if (method == "MOVE" && hooks.after_move) {
            hooks.after_move(user, path, *target_path);
        } else if (method == "COPY" && hooks.after_delete && *done) {
            // The copy replaced what was at the target: that file's number is gone.
            hooks.after_delete(user, *target_path);
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
