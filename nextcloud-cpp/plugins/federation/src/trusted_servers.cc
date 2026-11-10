#include "trusted_servers.h"

#include "nextcloud/db.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>

namespace nc::federation {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    TrustedServers::Server server_of_row(const nc::db::Row& row)
    {
        TrustedServers::Server out;
        out.id = std::atoll(nc::db::value_of(row, "id").c_str());
        out.server = nc::db::value_of(row, "server");
        out.url = nc::db::value_of(row, "url");
        out.status = std::atoi(nc::db::value_of(row, "status").c_str());
        out.token = nc::db::value_of(row, "token");
        out.secret = nc::db::value_of(row, "secret");
        out.created = std::atoll(nc::db::value_of(row, "created").c_str());
        return out;
    }

} // namespace

void TrustedServers::migrate() const
{
    nc::db::Client{m_host}.migrate(
        "federation_trusted",
        1,
        "CREATE TABLE nc_fed_trusted (id INTEGER PRIMARY KEY AUTOINCREMENT, server TEXT NOT NULL "
        "UNIQUE, url TEXT NOT NULL, status INTEGER NOT NULL, token TEXT NOT NULL, secret TEXT NOT "
        "NULL DEFAULT '', created INTEGER NOT NULL);"
        "CREATE TABLE nc_fed_handshake (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, "
        "server TEXT NOT NULL, token TEXT NOT NULL, own TEXT NOT NULL DEFAULT '', created INTEGER "
        "NOT "
        "NULL, attempt INTEGER NOT "
        "NULL DEFAULT 0, next_try INTEGER NOT NULL DEFAULT 0);"
    );
}

std::string TrustedServers::normalize(std::string_view url)
{
    std::string text{util::trim(url)};
    for (const std::string_view scheme: {"https://", "http://"}) {
        if (util::starts_with(util::to_lower(text.substr(0, scheme.size())), scheme)) {
            text.erase(0, scheme.size());
            break;
        }
    }
    while (!text.empty() && text.back() == '/') {
        text.pop_back();
    }
    // Only an address: no credentials, query, fragment, spaces or odd characters; the host in
    // lower case, a path (a server in a sub folder) as it is.
    if (text.empty() || text.size() > 255 ||
        text.find_first_of(" \t\r\n@?#\\") != std::string::npos ||
        text.find("//") != std::string::npos || text.find("..") != std::string::npos) {
        return {};
    }
    const std::size_t slash = text.find('/');
    const std::string host = util::to_lower(text.substr(0, slash));
    if (host.empty() ||
        host.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789.-:[]") != std::string::npos) {
        return {};
    }
    return host + (slash == std::string::npos ? std::string{} : text.substr(slash));
}

std::vector<TrustedServers::Server> TrustedServers::list() const
{
    std::vector<Server> out;
    for (const nc::db::Row& row:
         nc::db::Client{m_host}.query("SELECT * FROM nc_fed_trusted ORDER BY id")) {
        out.push_back(server_of_row(row));
    }
    return out;
}

std::optional<TrustedServers::Server> TrustedServers::find(std::string_view url) const
{
    const std::string server = normalize(url);
    if (server.empty()) {
        return std::nullopt;
    }
    const auto rows =
        nc::db::Client{m_host}.query("SELECT * FROM nc_fed_trusted WHERE server = ?", {server});
    if (rows.empty()) {
        return std::nullopt;
    }
    return server_of_row(rows.front());
}

util::expected<TrustedServers::Server, std::string>
TrustedServers::add(std::string_view url, std::string_view own, std::int64_t now) const
{
    const std::string server = normalize(url);
    if (server.empty()) {
        return failure("That is not the address of a server");
    }
    // The scheme as given (https unless the address says http), no trailing slash.
    std::string given{util::trim(url)};
    while (!given.empty() && given.back() == '/') {
        given.pop_back();
    }
    const bool plain = util::starts_with(util::to_lower(given.substr(0, 7)), "http://");
    const std::string full = std::string{plain ? "http://" : "https://"} + server;
    const nc::db::Client db{m_host};
    const std::string token = util::random_hex(16);
    if (db.exec(
            "INSERT OR IGNORE INTO nc_fed_trusted (server, url, status, token, secret, created) "
            "VALUES (?, ?, ?, ?, '', ?)",
            {server, full, std::to_string(PENDING), token, std::to_string(now)}
        ) == 0) {
        return failure("This server is trusted already");
    }
    queue("request", server, token, std::string{own}, now);
    return *find(server);
}

bool TrustedServers::remove(std::int64_t id) const
{
    const nc::db::Client db{m_host};
    const auto rows =
        db.query("SELECT server FROM nc_fed_trusted WHERE id = ?", {std::to_string(id)});
    if (rows.empty()) {
        return false;
    }
    db.exec(
        "DELETE FROM nc_fed_handshake WHERE server = ?",
        {nc::db::value_of(rows.front(), "server")}
    );
    db.exec("DELETE FROM nc_fed_trusted WHERE id = ?", {std::to_string(id)});
    return true;
}

void TrustedServers::set_status(std::string_view server, int status) const
{
    nc::db::Client{m_host}.exec(
        "UPDATE nc_fed_trusted SET status = ? WHERE server = ?",
        {std::to_string(status), normalize(server)}
    );
}

void TrustedServers::set_secret(std::string_view server, const std::string& secret) const
{
    nc::db::Client{m_host}.exec(
        "UPDATE nc_fed_trusted SET secret = ?, status = ? WHERE server = ?",
        {secret, std::to_string(OK), normalize(server)}
    );
}

bool TrustedServers::token_matches(std::string_view url, std::string_view token) const
{
    const auto known = find(url);
    return known && !token.empty() && !known->token.empty() &&
           util::constant_time_equals(known->token, token);
}

std::string TrustedServers::secret_of(std::string_view url) const
{
    const auto known = find(url);
    return known ? known->secret : std::string{};
}

bool TrustedServers::secret_matches(std::string_view url, std::string_view secret) const
{
    const std::string known = secret_of(url);
    return !known.empty() && !secret.empty() && util::constant_time_equals(known, secret);
}

void TrustedServers::queue(
    const std::string& kind,
    const std::string& server,
    const std::string& token,
    const std::string& own,
    std::int64_t created
) const
{
    const nc::db::Client db{m_host};
    // One waiting step of a kind per server; a newer one replaces it.
    db.exec("DELETE FROM nc_fed_handshake WHERE kind = ? AND server = ?", {kind, server});
    db.exec(
        "INSERT INTO nc_fed_handshake (kind, server, token, own, created, attempt, next_try) "
        "VALUES (?, ?, ?, ?, ?, 0, 0)",
        {kind, server, token, own, std::to_string(created)}
    );
}

std::vector<TrustedServers::Step> TrustedServers::due(std::int64_t now) const
{
    std::vector<Step> out;
    for (const nc::db::Row& row: nc::db::Client{m_host}.query(
             "SELECT * FROM nc_fed_handshake WHERE next_try <= ? ORDER BY id",
             {std::to_string(now)}
         )) {
        Step step;
        step.id = std::atoll(nc::db::value_of(row, "id").c_str());
        step.kind = nc::db::value_of(row, "kind");
        step.server = nc::db::value_of(row, "server");
        step.token = nc::db::value_of(row, "token");
        step.own = nc::db::value_of(row, "own");
        step.created = std::atoll(nc::db::value_of(row, "created").c_str());
        step.attempt = std::atoi(nc::db::value_of(row, "attempt").c_str());
        out.push_back(std::move(step));
    }
    return out;
}

void TrustedServers::finish(std::int64_t step) const
{
    nc::db::Client{m_host}.exec(
        "DELETE FROM nc_fed_handshake WHERE id = ?",
        {std::to_string(step)}
    );
}

void TrustedServers::retry(const Step& step, std::int64_t now) const
{
    // A minute more with every attempt, at most an hour.
    const std::int64_t wait = std::min<std::int64_t>(60 * (step.attempt + 1), 3'600);
    nc::db::Client{m_host}.exec(
        "UPDATE nc_fed_handshake SET attempt = attempt + 1, next_try = ? WHERE id = ?",
        {std::to_string(now + wait), std::to_string(step.id)}
    );
}

} // namespace nc::federation
