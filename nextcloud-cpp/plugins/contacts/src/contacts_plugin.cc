/**
 * @file contacts_plugin.cc
 * @brief CardDAV address books (RFC 6352 subset): address books and contacts per user, and
 * `/.well-known/carddav`. Counterpart of `apps/dav/lib/CardDAV`. The calendar plugin answers the
 * DAV root and the principal and lists this plugin's address book home through the `contacts.home`
 * service.
 */
#include "collection_server.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <memory>

namespace {

class ContactsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "contacts";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "CardDAV address books";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        const std::size_t max_size =
            std::strtoull(host.config("max_object_size", "1048576").c_str(), nullptr, 10);
        m_server = std::make_unique<nc::davobjects::CollectionServer>(
            nc::davobjects::Kind::addressbook(),
            &host,
            max_size
        );
        m_server->install(host);
        host.add_service(
            "contacts.home",
            [](std::string_view)
            {
                return nc::http::Response::text(200, "/remote.php/dav/addressbooks/users/");
            }
        );
        m_host = &host;
        // The system address book: everybody on this server (and the people on other servers it has
        // dealt with), read-only for everybody, kept up to date as accounts come and go.
        host.subscribe(
            "user.*",
            [this](std::string_view, std::string_view)
            {
                sync_system_address_book();
            }
        );
        host.add_job(
            "system-address-book",
            300,
            [this]()
            {
                sync_system_address_book();
            }
        );
        for (const char* method: {"GET", "PROPFIND"}) {
            host.add_route(
                method,
                "/.well-known/carddav",
                [](const nc::http::Request&)
                {
                    nc::http::Response response = nc::http::Response::text(301, "");
                    response.add_header("Location", "/remote.php/dav/");
                    return response;
                }
            );
        }
    }

private:
    static std::string vcard_escape(std::string_view text)
    {
        std::string out;
        for (const char letter: text) {
            if (letter == '\\' || letter == ',' || letter == ';') {
                out += '\\';
                out += letter;
            } else if (letter == '\n') {
                out += "\\n";
            } else if (letter != '\r') {
                out += letter;
            }
        }
        return out;
    }

    /// The vCards of the system address book are rewritten from the account list; people who left
    /// are removed. Everybody is a reader of the book, so it shows up in every address book home.
    void sync_system_address_book() const
    {
        const nc::http::Response directory = m_host->call_service("users.directory", "");
        if (directory.get_status() != 200) {
            return; // no accounts here (the users plugin is not loaded)
        }
        const nc::db::Client db{m_host};
        constexpr std::string_view OWNER = "nc-system";
        db.exec(
            "INSERT OR IGNORE INTO nc_dav_collections (uid, kind, uri, displayname, ctag) VALUES "
            "(?, 'addressbook', 'system', 'Accounts', ?)",
            {std::string{OWNER}, nc::util::random_hex(8)}
        );
        const auto book = db.query(
            "SELECT id FROM nc_dav_collections WHERE uid = ? AND kind = 'addressbook' AND uri = "
            "'system'",
            {std::string{OWNER}}
        );
        if (book.empty()) {
            return;
        }
        const std::string id = nc::db::value_of(book.front(), "id");
        std::vector<std::pair<std::string, std::string>> cards; // uri, vCard
        std::vector<std::string> people;
        for (const std::string& line: nc::util::split(directory.get_body(), '\n')) {
            const std::vector<std::string> parts = nc::util::split(line, '\t');
            if (parts.size() < 2 || parts[0].empty()) {
                continue;
            }
            people.push_back(parts[0]);
            std::string card = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:" + vcard_escape(parts[0]) +
                               "\r\nFN:" + vcard_escape(parts[1]) +
                               "\r\nN:" + vcard_escape(parts[1]) + ";;;;\r\n";
            if (parts.size() > 2 && !parts[2].empty()) {
                card += "EMAIL;TYPE=INTERNET:" + vcard_escape(parts[2]) + "\r\n";
            }
            cards.emplace_back(parts[0] + ".vcf", card + "CATEGORIES:Accounts\r\nEND:VCARD\r\n");
        }
        // People on other servers this one knows (shares exchanged with them).
        const nc::http::Response remotes = m_host->call_service("federation.remotes", "");
        if (remotes.get_status() == 200) {
            for (const std::string& address: nc::util::split(remotes.get_body(), '\n')) {
                if (address.empty() || address.size() > 320 ||
                    address.find_first_of(" \t\r\n/\\") != std::string::npos) {
                    continue;
                }
                std::string uri = address;
                std::ranges::replace_if(
                    uri,
                    [](char letter)
                    {
                        return letter == '@' || letter == ':';
                    },
                    '_'
                );
                cards.emplace_back(
                    uri + ".vcf",
                    "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:" + vcard_escape(address) +
                        "\r\nFN:" + vcard_escape(address) + "\r\nCLOUD:" + vcard_escape(address) +
                        "\r\nCATEGORIES:Remote\r\nEND:VCARD\r\n"
                );
            }
        }
        bool changed = false;
        std::vector<std::string> keep;
        for (const auto& [uri, card]: cards) {
            keep.push_back(uri);
            const std::string etag =
                "\"" + nc::util::to_hex(nc::util::sha256(card)).substr(0, 32) + "\"";
            const auto existing = db.query(
                "SELECT etag FROM nc_dav_objects WHERE collection_id = ? AND uri = ?",
                {id, uri}
            );
            if (!existing.empty() && nc::db::value_of(existing.front(), "etag") == etag) {
                continue;
            }
            db.exec(
                "INSERT INTO nc_dav_objects (collection_id, uri, etag, data, lastmod) VALUES (?, "
                "?, ?, ?, "
                "strftime('%s','now')) ON CONFLICT(collection_id, uri) DO UPDATE SET etag = "
                "excluded.etag, data = excluded.data, lastmod = excluded.lastmod",
                {id, uri, etag, card}
            );
            changed = true;
        }
        for (const nc::db::Row& row:
             db.query("SELECT uri FROM nc_dav_objects WHERE collection_id = ?", {id})) {
            if (std::ranges::find(keep, nc::db::value_of(row, "uri")) == keep.end()) {
                db.exec(
                    "DELETE FROM nc_dav_objects WHERE collection_id = ? AND uri = ?",
                    {id, nc::db::value_of(row, "uri")}
                );
                changed = true;
            }
        }
        for (const std::string& person: people) {
            db.exec(
                "INSERT OR IGNORE INTO nc_dav_shares (collection_id, sharee, access) VALUES (?, ?, "
                "'read')",
                {id, person}
            );
        }
        db.exec(
            "DELETE FROM nc_dav_shares WHERE collection_id = ? AND sharee NOT IN (SELECT value "
            "FROM "
            "json_each(?))",
            {id,
             [&]()
             {
                 std::string array = "[";
                 for (const std::string& person: people) {
                     array += (array.size() > 1 ? "," : "") + std::string{"\""} +
                              nc::util::json_escape(person) + "\"";
                 }
                 return array + "]";
             }()}
        );
        if (changed) {
            db.exec(
                "UPDATE nc_dav_collections SET ctag = ? WHERE id = ?",
                {nc::util::random_hex(8), id}
            );
        }
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::davobjects::CollectionServer> m_server{};
};

} // namespace

NC_PLUGIN(ContactsPlugin)
