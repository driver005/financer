#include "dav_locks.h"

#include "nextcloud/db.h"

namespace nc::cloud {

void DavLocks::migrate() const
{
    nc::db::Client{m_host}.migrate(
        "cloud_locks",
        1,
        "CREATE TABLE nc_dav_locks (token TEXT PRIMARY KEY, uid TEXT NOT NULL, path TEXT NOT NULL, "
        "owner TEXT NOT NULL, infinite INTEGER NOT NULL, expires INTEGER NOT NULL);"
        "CREATE INDEX nc_dav_locks_uid ON nc_dav_locks (uid);"
    );
}

std::vector<DavLock> DavLocks::of(const std::string& user, std::int64_t now) const
{
    const nc::db::Client db{m_host};
    db.exec("DELETE FROM nc_dav_locks WHERE expires <= ?", {std::to_string(now)});
    std::vector<DavLock> out;
    for (const nc::db::Row& row: db.query(
             "SELECT token, path, owner, infinite, expires FROM nc_dav_locks WHERE uid = ? ORDER "
             "BY path",
             {user}
         )) {
        DavLock lock;
        lock.token = nc::db::value_of(row, "token");
        lock.path = nc::db::value_of(row, "path");
        lock.owner = nc::db::value_of(row, "owner");
        lock.infinite = nc::db::value_of(row, "infinite") == "1";
        lock.expires = std::atoll(nc::db::value_of(row, "expires").c_str());
        out.push_back(std::move(lock));
    }
    return out;
}

void DavLocks::add(const std::string& user, const DavLock& lock) const
{
    nc::db::Client{m_host}.exec(
        "INSERT OR REPLACE INTO nc_dav_locks (token, uid, path, owner, infinite, expires) VALUES "
        "(?, ?, ?, ?, ?, ?)",
        {lock.token,
         user,
         lock.path,
         lock.owner,
         lock.infinite ? "1" : "0",
         std::to_string(lock.expires)}
    );
}

bool DavLocks::refresh(
    const std::string& user,
    const std::string& token,
    std::int64_t expires,
    std::int64_t now
) const
{
    const nc::db::Client db{m_host};
    if (db.query(
              "SELECT 1 AS x FROM nc_dav_locks WHERE token = ? AND uid = ? AND expires > ?",
              {token, user, std::to_string(now)}
        )
            .empty()) {
        return false;
    }
    db.exec(
        "UPDATE nc_dav_locks SET expires = ? WHERE token = ? AND uid = ?",
        {std::to_string(expires), token, user}
    );
    return true;
}

bool DavLocks::remove(const std::string& user, const std::string& token) const
{
    const nc::db::Client db{m_host};
    if (db.query("SELECT 1 AS x FROM nc_dav_locks WHERE token = ? AND uid = ?", {token, user})
            .empty()) {
        return false;
    }
    db.exec("DELETE FROM nc_dav_locks WHERE token = ? AND uid = ?", {token, user});
    return true;
}

void DavLocks::removed(const std::string& user, const std::string& path) const
{
    std::string like;
    for (const char letter: path == "/" ? std::string{} : path) {
        if (letter == '%' || letter == '_' || letter == '\\') {
            like.push_back('\\');
        }
        like.push_back(letter);
    }
    const nc::db::Client db{m_host};
    db.exec("DELETE FROM nc_dav_locks WHERE uid = ? AND path = ?", {user, path});
    db.exec(
        "DELETE FROM nc_dav_locks WHERE uid = ? AND path LIKE ? ESCAPE '\\'",
        {user, like + "/%"}
    );
}

void DavLocks::forget(const std::string& user) const
{
    nc::db::Client{m_host}.exec("DELETE FROM nc_dav_locks WHERE uid = ?", {user});
}

} // namespace nc::cloud
