#include "collection_server.h"

#include "itip.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "nextcloud/util/time.h"

#include <algorithm>
#include <chrono>

namespace nc::davobjects {

namespace {

    using nc::http::Request;
    using nc::http::Response;

    constexpr std::size_t MAX_COLLECTIONS = 100;
    constexpr std::string_view SHARED_MARK = "_shared_by_";
    constexpr std::size_t MAX_OBJECTS = 10'000;

    constexpr std::string_view HEAD =
        "<?xml version=\"1.0\"?>\n"
        "<d:multistatus xmlns:d=\"DAV:\" xmlns:cal=\"urn:ietf:params:xml:ns:caldav\""
        " xmlns:card=\"urn:ietf:params:xml:ns:carddav\" "
        "xmlns:cs=\"http://calendarserver.org/ns/\">\n";

    std::string etag_of(std::string_view data)
    {
        return "\"" + util::to_hex(util::sha256(data)).substr(0, 32) + "\"";
    }

    std::int64_t now_seconds()
    {
        return std::chrono::duration_cast<std::chrono::seconds>(
                   std::chrono::system_clock::now().time_since_epoch()
        )
            .count();
    }

    std::string http_time(std::int64_t seconds)
    {
        return util::http_date(
            std::chrono::system_clock::from_time_t(static_cast<std::time_t>(seconds))
        );
    }

    /// The texts of every element whose local name is `name`, whatever prefix it has:
    /// `<d:href>x</d:href>`.
    std::vector<std::string> xml_values(std::string_view xml, std::string_view name)
    {
        std::vector<std::string> values;
        std::size_t at = 0;
        while ((at = xml.find('<', at)) != std::string_view::npos) {
            const std::size_t close = xml.find('>', at);
            if (close == std::string_view::npos) {
                break;
            }
            std::string_view tag = xml.substr(at + 1, close - at - 1);
            at = close + 1;
            if (tag.empty() || tag.front() == '/' || tag.front() == '?' || tag.back() == '/') {
                continue;
            }
            const std::size_t space = tag.find_first_of(" \t\r\n");
            tag = tag.substr(0, space);
            const std::size_t colon = tag.find(':');
            if (colon != std::string_view::npos) {
                tag.remove_prefix(colon + 1);
            }
            if (tag != name) {
                continue;
            }
            const std::size_t end = xml.find('<', at);
            if (end == std::string_view::npos) {
                break;
            }
            values.emplace_back(util::trim(xml.substr(at, end - at)));
        }
        return values;
    }

    /// The inner text of every element whose local name is `name`, nested tags included:
    /// `<cs:set><d:href>a</d:href><cs:read/></cs:set>` gives `<d:href>a</d:href><cs:read/>`.
    std::vector<std::string> xml_blocks(std::string_view xml, std::string_view name)
    {
        std::vector<std::string> blocks;
        std::size_t at = 0;
        while ((at = xml.find('<', at)) != std::string_view::npos) {
            const std::size_t close = xml.find('>', at);
            if (close == std::string_view::npos) {
                break;
            }
            std::string_view tag = xml.substr(at + 1, close - at - 1);
            const std::size_t content = close + 1;
            at = content;
            if (tag.empty() || tag.front() == '/' || tag.front() == '?' || tag.back() == '/') {
                continue;
            }
            tag = tag.substr(0, tag.find_first_of(" \t\r\n"));
            const std::size_t colon = tag.find(':');
            const std::string_view local =
                colon == std::string_view::npos ? tag : tag.substr(colon + 1);
            if (local != name) {
                continue;
            }
            const std::string closing = "</" + std::string{tag} + ">";
            const std::size_t end = xml.find(closing, content);
            if (end == std::string_view::npos) {
                break;
            }
            blocks.emplace_back(xml.substr(content, end - content));
            at = end + closing.size();
        }
        return blocks;
    }

    /// Value of an attribute of the first element with local name `element`: `<c:time-range
    /// start="...">`.
    std::string
    xml_attribute(std::string_view xml, std::string_view element, std::string_view attribute)
    {
        std::size_t at = 0;
        while ((at = xml.find('<', at)) != std::string_view::npos) {
            const std::size_t close = xml.find('>', at);
            if (close == std::string_view::npos) {
                break;
            }
            const std::string_view tag = xml.substr(at + 1, close - at - 1);
            at = close + 1;
            const std::size_t colon = tag.find(':');
            const std::size_t space = tag.find_first_of(" \t\r\n");
            const std::string_view local = tag.substr(
                colon != std::string_view::npos && colon < space ? colon + 1 : 0,
                space == std::string_view::npos
                    ? std::string_view::npos
                    : space - (colon != std::string_view::npos && colon < space ? colon + 1 : 0)
            );
            if (local != element || space == std::string_view::npos) {
                continue;
            }
            const std::string needle = std::string{attribute} + "=\"";
            const std::size_t found = tag.find(needle, space);
            if (found == std::string_view::npos) {
                return {};
            }
            const std::size_t begin = found + needle.size();
            return std::string{tag.substr(begin, tag.find('"', begin) - begin)};
        }
        return {};
    }

    Response multistatus(const std::string& body)
    {
        return Response::xml(207, std::string{HEAD} + body + "</d:multistatus>\n");
    }

    std::string response_xml(const std::string& href, const std::string& props)
    {
        return " <d:response>\n  <d:href>" + util::xml_escape(href) +
               "</d:href>\n  <d:propstat>\n   <d:prop>\n" + props +
               "   </d:prop>\n   <d:status>HTTP/1.1 200 OK</d:status>\n  </d:propstat>\n "
               "</d:response>\n";
    }

    std::string missing_xml(const std::string& href)
    {
        return " <d:response>\n  <d:href>" + util::xml_escape(href) +
               "</d:href>\n  <d:status>HTTP/1.1 404 Not Found</d:status>\n </d:response>\n";
    }

    bool starts_line(std::string_view text, std::size_t at) noexcept
    {
        return at == 0 || text[at - 1] == '\n';
    }

    /// "YYYYMMDDTHHMMSS" from a value like "20240102T100000Z" or a date "20240102".
    std::string normalize_time(std::string_view value)
    {
        std::string out;
        for (const char letter: value) {
            if ((letter >= '0' && letter <= '9') || letter == 'T') {
                out.push_back(letter);
            }
        }
        if (out.size() == 8) {
            out += "T000000";
        }
        return out.substr(0, 15);
    }

} // namespace

bool valid_uri(std::string_view uri) noexcept
{
    return !uri.empty() && uri.size() <= 255 && uri != "." && uri != ".." &&
           std::ranges::all_of(
               uri,
               [](unsigned char letter)
               {
                   return std::isalnum(letter) != 0 || letter == '.' || letter == '_' ||
                          letter == '-' || letter == '@' || letter == '~';
               }
           );
}

std::string first_start(std::string_view calendar)
{
    std::size_t at = 0;
    while ((at = calendar.find("DTSTART", at)) != std::string_view::npos) {
        if (starts_line(calendar, at)) {
            const std::size_t colon = calendar.find(':', at);
            const std::size_t eol = calendar.find_first_of("\r\n", at);
            if (colon != std::string_view::npos && colon < eol) {
                return normalize_time(calendar.substr(colon + 1, eol - colon - 1));
            }
        }
        at += 7;
    }
    return {};
}

std::string validate_object(const Kind& kind, std::string_view data, std::size_t max_size)
{
    if (data.size() > max_size) {
        return "the object is larger than " + std::to_string(max_size) + " bytes";
    }
    if (data.find('\0') != std::string_view::npos) {
        return "the object contains a NUL byte";
    }
    const std::string_view text = util::trim(data);
    const auto has_line = [&](std::string_view prefix)
    {
        std::size_t at = 0;
        while ((at = text.find(prefix, at)) != std::string_view::npos) {
            if (starts_line(text, at)) {
                return true;
            }
            at += prefix.size();
        }
        return false;
    };
    if (kind.is_calendar()) {
        if (!util::starts_with(text, "BEGIN:VCALENDAR") || !text.ends_with("END:VCALENDAR")) {
            return "not an iCalendar object (BEGIN:VCALENDAR ... END:VCALENDAR)";
        }
        if (!has_line("BEGIN:VEVENT") && !has_line("BEGIN:VTODO") && !has_line("BEGIN:VJOURNAL")) {
            return "the calendar object has no event, task or journal";
        }
        if (!has_line("UID:")) {
            return "the calendar object has no UID";
        }
        return {};
    }
    if (!util::starts_with(text, "BEGIN:VCARD") || !text.ends_with("END:VCARD")) {
        return "not a vCard (BEGIN:VCARD ... END:VCARD)";
    }
    if (!has_line("VERSION:") || !has_line("FN")) {
        return "the vCard needs VERSION and FN";
    }
    return {};
}

std::string CollectionServer::home_href(std::string_view user) const
{
    return m_kind.get_base() + "/" + std::string{user} + "/";
}

void CollectionServer::install(nc::Host& host)
{
    nc::db::Client{&host}.migrate(
        "davobjects",
        1,
        "CREATE TABLE nc_dav_collections ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, kind TEXT NOT NULL, uri TEXT "
        "NOT NULL,"
        " displayname TEXT NOT NULL, ctag TEXT NOT NULL, UNIQUE (uid, kind, uri));"
        "CREATE TABLE nc_dav_objects ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " collection_id INTEGER NOT NULL REFERENCES nc_dav_collections(id) ON DELETE CASCADE,"
        " uri TEXT NOT NULL, etag TEXT NOT NULL, data TEXT NOT NULL, lastmod INTEGER NOT NULL,"
        " UNIQUE (collection_id, uri));"
    );
    // Collections shared with other accounts: "read" or "write" (read and change the objects).
    nc::db::Client{&host}.migrate(
        "davobjects",
        2,
        "CREATE TABLE nc_dav_shares ("
        " collection_id INTEGER NOT NULL REFERENCES nc_dav_collections(id) ON DELETE CASCADE,"
        " sharee TEXT NOT NULL, access TEXT NOT NULL, PRIMARY KEY (collection_id, sharee));"
        "CREATE INDEX nc_dav_shares_sharee ON nc_dav_shares (sharee);"
    );
    std::vector<std::string_view>
        methods{"PROPFIND", "REPORT", "MKCOL", "PROPPATCH", "DELETE", "GET", "PUT", "POST"};
    if (m_kind.is_calendar()) {
        methods.push_back("MKCALENDAR");
    }
    for (const std::string_view method: methods) {
        for (const char* tail:
             {"/{user}", "/{user}/{collection}", "/{user}/{collection}/{object}"}) {
            host.add_route(
                method,
                m_kind.get_base() + tail,
                [this](const Request& request)
                {
                    return serve(request, 0);
                }
            );
        }
    }
    host.subscribe(
        "user.deleted",
        [this](std::string_view, std::string_view payload)
        {
            const std::string user = nc::util::form_value(nc::util::parse_form(payload), "id");
            nc::db::Client{m_host}.exec("DELETE FROM nc_dav_shares WHERE sharee = ?", {user});
            nc::db::Client{m_host}.exec(
                "DELETE FROM nc_dav_collections WHERE uid = ? AND kind = ?",
                {user, m_kind.get_name()}
            );
        }
    );
}

Response CollectionServer::serve(const Request& request, int) const
{
    if (request.get_user().empty()) {
        return nc::http::unauthorized();
    }
    const std::string user{request.param("user")};
    if (user != request.get_user()) {
        return Response::text(403, "You can only reach your own " + m_kind.get_name() + "s");
    }
    const std::string collection{request.param("collection")};
    const std::string object{request.param("object")};
    if ((!collection.empty() && !valid_uri(collection)) ||
        (!object.empty() && !valid_uri(object))) {
        return Response::text(400, "Bad name");
    }
    const std::string& method = request.get_method();
    const nc::db::Client db{m_host};
    const std::string base = home_href(user);

    // Everybody has a default collection ("personal", "contacts"), like a fresh Nextcloud account.
    db.exec(
        "INSERT OR IGNORE INTO nc_dav_collections (uid, kind, uri, displayname, ctag) VALUES (?, "
        "?, ?, ?, ?)",
        {user,
         m_kind.get_name(),
         m_kind.get_default_uri(),
         m_kind.get_default_name(),
         util::random_hex(8)}
    );

    // A collection of the user, or one shared with the user (listed as `<uri>_shared_by_<owner>`).
    // The row says who owns it and what the user may do: "owner", "write" or "read".
    const auto find_collection = [&](const std::string& uri)
    {
        auto own = db.query(
            "SELECT id, uri, displayname, ctag, uid AS owner, 'owner' AS access FROM "
            "nc_dav_collections "
            "WHERE uid = ? AND kind = ? AND uri = ?",
            {user, m_kind.get_name(), uri}
        );
        const std::size_t mark = uri.rfind(SHARED_MARK);
        if (!own.empty() || mark == std::string::npos) {
            return own;
        }
        return db.query(
            "SELECT c.id AS id, c.displayname AS displayname, c.ctag AS ctag, c.uid AS owner, "
            "s.access AS access FROM nc_dav_collections c JOIN nc_dav_shares s ON s.collection_id "
            "= c.id WHERE c.uid = ? AND c.kind = ? AND c.uri = ? AND s.sharee = ?",
            {uri.substr(mark + SHARED_MARK.size()), m_kind.get_name(), uri.substr(0, mark), user}
        );
    };
    const auto touch = [&](const std::string& id)
    {
        db.exec("UPDATE nc_dav_collections SET ctag = ? WHERE id = ?", {util::random_hex(8), id});
    };
    const auto collection_props = [&](const nc::db::Row& row)
    {
        std::string props = "    <d:displayname>" +
                            util::xml_escape(nc::db::value_of(row, "displayname")) +
                            "</d:displayname>\n";
        if (m_kind.is_calendar() && nc::db::value_of(row, "uri") == "inbox") {
            props += "    <d:resourcetype><d:collection/><cal:schedule-inbox/></d:resourcetype>\n";
        } else {
            props +=
                m_kind.is_calendar()
                    ? "    <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>\n"
                    : "    <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>\n";
        }
        const std::string access = nc::db::value_of(row, "access", "owner");
        props += "    <d:current-user-privilege-set><d:privilege><d:read/></d:privilege>" +
                 std::string{access == "read" ? "" : "<d:privilege><d:write/></d:privilege>"} +
                 "</d:current-user-privilege-set>\n";
        if (access != "owner") {
            props += "    <d:owner><d:href>/remote.php/dav/principals/users/" +
                     util::xml_escape(nc::db::value_of(row, "owner")) + "/</d:href></d:owner>\n";
        }
        props += "    <cs:getctag>" + nc::db::value_of(row, "ctag") + "</cs:getctag>\n";
        props += "    <d:sync-token>" + nc::db::value_of(row, "ctag") + "</d:sync-token>\n";
        if (m_kind.is_calendar()) {
            props +=
                "    <cal:supported-calendar-component-set><cal:comp name=\"VEVENT\"/><cal:comp "
                "name=\"VTODO\"/></cal:supported-calendar-component-set>\n";
        }
        return props;
    };
    const auto object_props = [&](const nc::db::Row& row, bool with_data)
    {
        std::string props =
            "    <d:getetag>" + util::xml_escape(nc::db::value_of(row, "etag")) + "</d:getetag>\n";
        props += "    <d:getcontenttype>" + m_kind.get_content_type() +
                 "; charset=utf-8</d:getcontenttype>\n";
        props += "    <d:resourcetype/>\n";
        if (!nc::db::value_of(row, "lastmod").empty()) {
            props +=
                "    <d:getlastmodified>" +
                http_time(std::strtoll(nc::db::value_of(row, "lastmod").c_str(), nullptr, 10)) +
                "</d:getlastmodified>\n";
        }
        if (with_data) {
            const std::string tag =
                m_kind.is_calendar() ? "cal:calendar-data" : "card:address-data";
            props += "    <" + tag + ">" + util::xml_escape(nc::db::value_of(row, "data")) + "</" +
                     tag + ">\n";
        }
        return props;
    };

    // ---- the home: /calendars/<user>/ ----------------------------------------------------------
    if (collection.empty()) {
        if (method != "PROPFIND") {
            return Response::text(405, "Method Not Allowed");
        }
        std::string body =
            response_xml(base, "    <d:resourcetype><d:collection/></d:resourcetype>\n");
        if (request.header("Depth") != "0") {
            for (const nc::db::Row& row: db.query(
                     "SELECT uri, displayname, ctag FROM nc_dav_collections WHERE uid = ? AND kind "
                     "= ? ORDER BY id",
                     {user, m_kind.get_name()}
                 )) {
                body +=
                    response_xml(base + nc::db::value_of(row, "uri") + "/", collection_props(row));
            }
            for (const nc::db::Row& row: db.query(
                     "SELECT c.uri AS uri, c.displayname AS displayname, c.ctag AS ctag, c.uid AS "
                     "owner, s.access AS access FROM nc_dav_shares s JOIN nc_dav_collections c ON "
                     "c.id = s.collection_id WHERE s.sharee = ? AND c.kind = ? ORDER BY c.id",
                     {user, m_kind.get_name()}
                 )) {
                body += response_xml(
                    base + nc::db::value_of(row, "uri") + std::string{SHARED_MARK} +
                        nc::db::value_of(row, "owner") + "/",
                    collection_props(row)
                );
            }
        }
        return multistatus(body);
    }

    // ---- creating a collection ------------------------------------------------------------------
    if (object.empty() && (method == "MKCOL" || method == "MKCALENDAR")) {
        if (collection.find(SHARED_MARK) != std::string::npos) {
            return Response::text(400, "That name is reserved for shared collections");
        }
        if (!find_collection(collection).empty()) {
            return Response::text(405, "The collection already exists");
        }
        const auto count = db.query(
            "SELECT COUNT(*) AS n FROM nc_dav_collections WHERE uid = ? AND kind = ?",
            {user, m_kind.get_name()}
        );
        if (std::strtoull(nc::db::value_of(count.front(), "n", "0").c_str(), nullptr, 10) >=
            MAX_COLLECTIONS) {
            return Response::text(507, "Too many collections");
        }
        const auto names = xml_values(request.get_body(), "displayname");
        db.exec(
            "INSERT INTO nc_dav_collections (uid, kind, uri, displayname, ctag) VALUES (?, ?, ?, "
            "?, ?)",
            {user,
             m_kind.get_name(),
             collection,
             names.empty() ? collection : names.front().substr(0, 128),
             util::random_hex(8)}
        );
        return Response{201};
    }

    const auto found = find_collection(collection);
    if (found.empty()) {
        return Response::text(object.empty() ? 404 : 409, "No such collection");
    }
    const std::string id = nc::db::value_of(found.front(), "id");
    const std::string href = base + collection + "/";
    const std::string access = nc::db::value_of(found.front(), "access", "owner");
    const std::string owner = nc::db::value_of(found.front(), "owner", user);
    const bool may_change_objects = access != "read";

    // ---- sharing: POST <cs:share> by the owner (draft-pot-webdav-resource-sharing) --------------
    if (object.empty() && method == "POST") {
        if (access != "owner") {
            return Response::text(403, "Only the owner shares a collection");
        }
        const std::string& xml = request.get_body();
        for (const std::string& block: xml_blocks(xml, "set")) {
            for (const std::string& ref: xml_values(block, "href")) {
                std::string who = util::url_decode(ref);
                while (!who.empty() && who.back() == '/') {
                    who.pop_back();
                }
                who = who.substr(who.rfind('/') + 1);
                if (const std::size_t colon = who.rfind(':'); colon != std::string::npos) {
                    who = who.substr(colon + 1);
                }
                if (!valid_uri(who) || who == user ||
                    m_host->call_service("users.get", who).get_status() != 200) {
                    return Response::text(400, "No such person to share with");
                }
                db.exec(
                    "INSERT INTO nc_dav_shares (collection_id, sharee, access) VALUES (?, ?, ?) ON "
                    "CONFLICT (collection_id, sharee) DO UPDATE SET access = excluded.access",
                    {id, who, block.find("read-write") != std::string::npos ? "write" : "read"}
                );
            }
        }
        for (const std::string& block: xml_blocks(xml, "remove")) {
            for (const std::string& ref: xml_values(block, "href")) {
                std::string who = util::url_decode(ref);
                while (!who.empty() && who.back() == '/') {
                    who.pop_back();
                }
                who = who.substr(who.rfind('/') + 1);
                if (const std::size_t colon = who.rfind(':'); colon != std::string::npos) {
                    who = who.substr(colon + 1);
                }
                db.exec(
                    "DELETE FROM nc_dav_shares WHERE collection_id = ? AND sharee = ?",
                    {id, who}
                );
            }
        }
        touch(id);
        return Response{200};
    }

    // ---- the collection
    // ---------------------------------------------------------------------------
    if (object.empty()) {
        if (method == "PROPFIND") {
            std::string body = response_xml(href, collection_props(found.front()));
            if (request.header("Depth") == "1") {
                for (const nc::db::Row& row: db.query(
                         "SELECT uri, etag, lastmod FROM nc_dav_objects WHERE collection_id = ? "
                         "ORDER BY uri",
                         {id}
                     )) {
                    body += response_xml(
                        href + util::url_encode_path(nc::db::value_of(row, "uri")),
                        object_props(row, false)
                    );
                }
            }
            return multistatus(body);
        }
        if (method == "DELETE") {
            if (access != "owner") {
                // A person a collection is shared with removes it from their own list only.
                db.exec(
                    "DELETE FROM nc_dav_shares WHERE collection_id = ? AND sharee = ?",
                    {id, user}
                );
            } else {
                db.exec("DELETE FROM nc_dav_collections WHERE id = ?", {id});
            }
            return Response{204};
        }
        if (method == "PROPPATCH") {
            if (access != "owner") {
                return Response::text(403, "Only the owner renames a collection");
            }
            const auto names = xml_values(request.get_body(), "displayname");
            if (!names.empty()) {
                db.exec(
                    "UPDATE nc_dav_collections SET displayname = ? WHERE id = ?",
                    {names.front().substr(0, 128), id}
                );
            }
            return multistatus(response_xml(href, "    <d:displayname/>\n"));
        }
        if (method == "REPORT") {
            const std::string& xml = request.get_body();
            std::string body;
            const auto emit = [&](const nc::db::Row& row)
            {
                body += response_xml(
                    href + util::url_encode_path(nc::db::value_of(row, "uri")),
                    object_props(row, true)
                );
            };
            if (xml.find("multiget") != std::string::npos) {
                for (const std::string& ref: xml_values(xml, "href")) {
                    const std::string decoded = util::url_decode(ref);
                    const std::string uri = decoded.substr(decoded.rfind('/') + 1);
                    const auto rows = db.query(
                        "SELECT uri, etag, data, lastmod FROM nc_dav_objects WHERE collection_id = "
                        "? AND uri = ?",
                        {id, uri}
                    );
                    if (rows.empty()) {
                        body += missing_xml(ref);
                    } else {
                        emit(rows.front());
                    }
                }
            } else if (xml.find("sync-collection") != std::string::npos) {
                // The token is the collection's ctag. Deletions are not tracked: a changed token
                // gets everything, and the client drops what it no longer sees.
                const auto tokens = xml_values(xml, "sync-token");
                if (tokens.empty() || tokens.front() != nc::db::value_of(found.front(), "ctag")) {
                    for (const nc::db::Row& row: db.query(
                             "SELECT uri, etag, data, lastmod FROM nc_dav_objects WHERE "
                             "collection_id = ? ORDER BY uri",
                             {id}
                         )) {
                        emit(row);
                    }
                }
                body += "";
                return Response::xml(
                    207,
                    std::string{HEAD} + body + " <d:sync-token>" +
                        nc::db::value_of(found.front(), "ctag") +
                        "</d:sync-token>\n</d:multistatus>\n"
                );
            } else {
                const std::string start = normalize_time(xml_attribute(xml, "time-range", "start"));
                const std::string end = normalize_time(xml_attribute(xml, "time-range", "end"));
                for (const nc::db::Row& row: db.query(
                         "SELECT uri, etag, data, lastmod FROM nc_dav_objects WHERE collection_id "
                         "= ? ORDER BY uri",
                         {id}
                     )) {
                    if (m_kind.is_calendar() && (!start.empty() || !end.empty())) {
                        const std::string data = nc::db::value_of(row, "data");
                        const std::string at = first_start(data);
                        const bool recurring = data.find("\nRRULE") != std::string::npos ||
                                               data.find("\r\nRRULE") != std::string::npos;
                        if (!recurring && !at.empty() &&
                            ((!start.empty() && at < start) || (!end.empty() && at >= end))) {
                            continue;
                        }
                    }
                    emit(row);
                }
            }
            return multistatus(body);
        }
        return Response::text(405, "Method Not Allowed");
    }

    // ---- an object
    // --------------------------------------------------------------------------------
    const auto existing = db.query(
        "SELECT etag, data, lastmod FROM nc_dav_objects WHERE collection_id = ? AND uri = ?",
        {id, object}
    );
    const std::string current_etag =
        existing.empty() ? std::string{} : nc::db::value_of(existing.front(), "etag");
    const auto publish = [&](std::string_view action)
    {
        m_host->publish(
            "dav.object_changed",
            nc::util::form_encode(
                {{"kind", m_kind.get_name()},
                 {"user", user},
                 {"owner", owner},
                 {"collection", collection},
                 {"uri", object},
                 {"action", std::string{action}}}
            )
        );
    };

    if (method == "GET") {
        if (existing.empty()) {
            return Response::text(404, "Not Found");
        }
        Response response{
            200,
            m_kind.get_content_type() + "; charset=utf-8",
            nc::db::value_of(existing.front(), "data"),
            {}
        };
        response.add_header("ETag", std::string{current_etag});
        return response;
    }
    if (method == "PROPFIND") {
        if (existing.empty()) {
            return Response::text(404, "Not Found");
        }
        nc::db::Row row = existing.front();
        return multistatus(
            response_xml(href + util::url_encode_path(object), object_props(row, false))
        );
    }
    if ((method == "PUT" || method == "DELETE") && !may_change_objects) {
        return Response::text(403, "This collection is shared read-only");
    }
    if (method == "PUT") {
        const std::string_view if_none_match = request.header("If-None-Match");
        const std::string_view if_match = request.header("If-Match");
        if ((if_none_match == "*" && !existing.empty()) ||
            (!if_match.empty() && if_match != "*" && if_match != current_etag) ||
            (!if_match.empty() && existing.empty())) {
            return Response::text(412, "Precondition Failed");
        }
        if (const std::string problem = validate_object(m_kind, request.get_body(), m_max_size);
            !problem.empty()) {
            return Response::text(415, problem);
        }
        if (existing.empty()) {
            const auto count =
                db.query("SELECT COUNT(*) AS n FROM nc_dav_objects WHERE collection_id = ?", {id});
            if (std::strtoull(nc::db::value_of(count.front(), "n", "0").c_str(), nullptr, 10) >=
                MAX_OBJECTS) {
                return Response::text(507, "Too many objects");
            }
        }
        const std::string etag = etag_of(request.get_body());
        db.exec(
            "INSERT INTO nc_dav_objects (collection_id, uri, etag, data, lastmod) VALUES (?, ?, ?, "
            "?, ?) "
            "ON CONFLICT(collection_id, uri) DO UPDATE SET etag = excluded.etag, data = "
            "excluded.data, lastmod = excluded.lastmod",
            {id, object, etag, request.get_body(), std::to_string(now_seconds())}
        );
        touch(id);
        publish(existing.empty() ? "created" : "updated");
        if (m_kind.is_calendar() && collection != "inbox") {
            schedule_after_put(
                user,
                existing.empty() ? std::string{} : nc::db::value_of(existing.front(), "data"),
                request.get_body()
            );
        }
        Response response{existing.empty() ? 201 : 204};
        response.add_header("ETag", std::string{etag});
        return response;
    }
    if (method == "DELETE") {
        const std::string_view if_match = request.header("If-Match");
        if (existing.empty()) {
            return Response::text(404, "Not Found");
        }
        if (!if_match.empty() && if_match != "*" && if_match != current_etag) {
            return Response::text(412, "Precondition Failed");
        }
        db.exec("DELETE FROM nc_dav_objects WHERE collection_id = ? AND uri = ?", {id, object});
        touch(id);
        publish("deleted");
        if (m_kind.is_calendar() && collection != "inbox") {
            schedule_after_delete(user, nc::db::value_of(existing.front(), "data"));
        }
        return Response{204};
    }
    return Response::text(405, "Method Not Allowed");
}

// ---- scheduling ---------------------------------------------------------------------------------

bool CollectionServer::deliver(
    const std::string& email,
    const std::string& method,
    const std::string& summary,
    const std::string& uid,
    const std::string& message,
    const std::string& tag
) const
{
    const nc::db::Client db{m_host};
    const nc::http::Response account = m_host->call_service("users.by_email", email);
    if (account.get_status() != 200) {
        // Not an account here: a mail says what it is about (the message itself stays out of it).
        const std::string subject = method == "REQUEST"  ? "Invitation: " + summary
                                    : method == "CANCEL" ? "Cancelled: " + summary
                                                         : "Reply: " + summary;
        (void)m_host->call_service(
            "mail.send",
            nc::util::form_encode(
                {{"to", email},
                 {"subject", subject},
                 {"body", subject + "\n\n(" + method + " for " + uid + ")\n"}}
            )
        );
        return false;
    }
    const std::string target = account.get_body();
    db.exec(
        "INSERT OR IGNORE INTO nc_dav_collections (uid, kind, uri, displayname, ctag) VALUES (?, "
        "'calendar', 'inbox', 'Inbox', ?)",
        {target, util::random_hex(8)}
    );
    const auto inbox = db.query(
        "SELECT id FROM nc_dav_collections WHERE uid = ? AND kind = 'calendar' AND uri = 'inbox'",
        {target}
    );
    if (inbox.empty()) {
        return false;
    }
    const std::string id = nc::db::value_of(inbox.front(), "id");
    db.exec(
        "INSERT INTO nc_dav_objects (collection_id, uri, etag, data, lastmod) VALUES (?, ?, ?, ?, "
        "?) ON CONFLICT(collection_id, uri) DO UPDATE SET etag = excluded.etag, data = "
        "excluded.data, lastmod = excluded.lastmod",
        {id,
         itip::uri_for(uid) + "-" + tag + ".ics",
         etag_of(message),
         message,
         std::to_string(now_seconds())}
    );
    db.exec("UPDATE nc_dav_collections SET ctag = ? WHERE id = ?", {util::random_hex(8), id});
    return true;
}

void CollectionServer::schedule_after_put(
    const std::string& actor,
    const std::string& previous,
    const std::string& data
) const
{
    const itip::Event event = itip::parse(data);
    if (!event.valid || event.uid.empty() || event.organizer.empty()) {
        return;
    }
    const nc::http::Response own_address = m_host->call_service("users.email", actor);
    const std::string actor_email =
        own_address.get_status() == 200 ? util::to_lower(own_address.get_body()) : std::string{};
    if (actor_email.empty()) {
        return;
    }
    const itip::Event before = previous.empty() ? itip::Event{} : itip::parse(previous);
    if (event.organizer == actor_email) {
        // The organizer invites everyone, and cancels for the ones who were dropped.
        const std::string request = itip::with_method(data, "REQUEST");
        for (const itip::Attendee& attendee: event.attendees) {
            if (attendee.email != actor_email) {
                (void
                )deliver(attendee.email, "REQUEST", event.summary, event.uid, request, "request");
            }
        }
        const std::string cancel = itip::with_method(previous, "CANCEL");
        for (const itip::Attendee& old: before.attendees) {
            const bool still = std::ranges::any_of(
                event.attendees,
                [&](const itip::Attendee& attendee)
                {
                    return attendee.email == old.email;
                }
            );
            if (!still && old.email != actor_email) {
                (void)deliver(old.email, "CANCEL", event.summary, event.uid, cancel, "cancel");
            }
        }
        return;
    }
    // An attendee who answered tells the organizer.
    const auto mine = std::ranges::find_if(
        event.attendees,
        [&](const itip::Attendee& attendee)
        {
            return attendee.email == actor_email;
        }
    );
    if (mine == event.attendees.end()) {
        return;
    }
    std::string earlier = "NEEDS-ACTION";
    for (const itip::Attendee& attendee: before.attendees) {
        if (attendee.email == actor_email) {
            earlier = attendee.partstat;
        }
    }
    if (mine->partstat == earlier || mine->partstat == "NEEDS-ACTION") {
        return;
    }
    const std::string reply = itip::reply_for(data, actor_email, mine->partstat);
    (void)deliver(
        event.organizer,
        "REPLY",
        event.summary,
        event.uid,
        reply,
        "reply-" + itip::uri_for(actor_email)
    );
    // The organizer's own copy shows the answer.
    const nc::http::Response organizer = m_host->call_service("users.by_email", event.organizer);
    if (organizer.get_status() != 200) {
        return;
    }
    const nc::db::Client db{m_host};
    for (const nc::db::Row& row: db.query(
             "SELECT o.id AS id, o.collection_id AS collection, o.data AS data FROM nc_dav_objects "
             "o "
             "JOIN nc_dav_collections c ON c.id = o.collection_id WHERE c.uid = ? AND c.kind = "
             "'calendar' AND c.uri != 'inbox' AND instr(o.data, ?) > 0",
             {organizer.get_body(), "UID:" + event.uid}
         )) {
        const std::string updated =
            itip::set_partstat(nc::db::value_of(row, "data"), actor_email, mine->partstat);
        db.exec(
            "UPDATE nc_dav_objects SET data = ?, etag = ?, lastmod = ? WHERE id = ?",
            {updated, etag_of(updated), std::to_string(now_seconds()), nc::db::value_of(row, "id")}
        );
        db.exec(
            "UPDATE nc_dav_collections SET ctag = ? WHERE id = ?",
            {util::random_hex(8), nc::db::value_of(row, "collection")}
        );
    }
}

void CollectionServer::schedule_after_delete(const std::string& actor, const std::string& previous)
    const
{
    const itip::Event event = itip::parse(previous);
    if (!event.valid || event.uid.empty() || event.organizer.empty()) {
        return;
    }
    const nc::http::Response own_address = m_host->call_service("users.email", actor);
    const std::string actor_email =
        own_address.get_status() == 200 ? util::to_lower(own_address.get_body()) : std::string{};
    if (actor_email.empty()) {
        return;
    }
    if (event.organizer == actor_email) {
        const std::string cancel = itip::with_method(previous, "CANCEL");
        for (const itip::Attendee& attendee: event.attendees) {
            if (attendee.email != actor_email) {
                (void)deliver(attendee.email, "CANCEL", event.summary, event.uid, cancel, "cancel");
            }
        }
        return;
    }
    const bool attends = std::ranges::any_of(
        event.attendees,
        [&](const itip::Attendee& attendee)
        {
            return attendee.email == actor_email;
        }
    );
    if (attends) {
        (void)deliver(
            event.organizer,
            "REPLY",
            event.summary,
            event.uid,
            itip::reply_for(previous, actor_email, "DECLINED"),
            "reply-" + itip::uri_for(actor_email)
        );
    }
}

} // namespace nc::davobjects
