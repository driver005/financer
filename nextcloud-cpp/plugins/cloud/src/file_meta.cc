#include "file_meta.h"

#include "nextcloud/db.h"

namespace nc::cloud {

namespace {

    /// `like` pattern for everything below `path`, with the characters of LIKE escaped.
    std::string below(const std::string& path)
    {
        std::string out;
        for (const char letter: path == "/" ? std::string{} : path) {
            if (letter == '%' || letter == '_' || letter == '\\') {
                out.push_back('\\');
            }
            out.push_back(letter);
        }
        return out + "/%";
    }

} // namespace

void FileMeta::migrate() const
{
    nc::db::Client{m_host}.migrate(
        "cloud_meta",
        1,
        "CREATE TABLE nc_file_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, path "
        "TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0);"
        "CREATE UNIQUE INDEX nc_file_meta_path ON nc_file_meta (uid, path);"
    );
}

std::int64_t FileMeta::id_of(const std::string& user, const std::string& path) const
{
    const nc::db::Client db{m_host};
    db.exec("INSERT OR IGNORE INTO nc_file_meta (uid, path) VALUES (?, ?)", {user, path});
    const auto rows =
        db.query("SELECT id FROM nc_file_meta WHERE uid = ? AND path = ?", {user, path});
    return rows.empty() ? 0 : std::atoll(nc::db::value_of(rows.front(), "id").c_str());
}

void FileMeta::moved(const std::string& user, const std::string& from, const std::string& to) const
{
    if (from == to || from == "/") {
        return;
    }
    const nc::db::Client db{m_host};
    // What was at the target is replaced (its number goes with it).
    removed(user, to);
    db.exec("UPDATE nc_file_meta SET path = ? WHERE uid = ? AND path = ?", {to, user, from});
    // Below: the new prefix in place of the old one.
    db.exec(
        "UPDATE nc_file_meta SET path = ? || substr(path, ?) WHERE uid = ? AND path LIKE ? ESCAPE "
        "'\\'",
        {to, std::to_string(from.size() + 1), user, below(from)}
    );
}

void FileMeta::removed(const std::string& user, const std::string& path) const
{
    const nc::db::Client db{m_host};
    if (path != "/") {
        db.exec("DELETE FROM nc_file_meta WHERE uid = ? AND path = ?", {user, path});
    }
    db.exec(
        "DELETE FROM nc_file_meta WHERE uid = ? AND path LIKE ? ESCAPE '\\'",
        {user, below(path)}
    );
}

void FileMeta::forget(const std::string& user) const
{
    nc::db::Client{m_host}.exec("DELETE FROM nc_file_meta WHERE uid = ?", {user});
}

void FileMeta::set_favorite(const std::string& user, const std::string& path, bool favorite) const
{
    (void)id_of(user, path);
    nc::db::Client{m_host}.exec(
        "UPDATE nc_file_meta SET favorite = ? WHERE uid = ? AND path = ?",
        {favorite ? "1" : "0", user, path}
    );
}

bool FileMeta::is_favorite(const std::string& user, const std::string& path) const
{
    const auto rows = nc::db::Client{m_host}.query(
        "SELECT favorite FROM nc_file_meta WHERE uid = ? AND path = ?",
        {user, path}
    );
    return !rows.empty() && nc::db::value_of(rows.front(), "favorite") == "1";
}

std::string FileMeta::path_of(const std::string& user, std::int64_t id) const
{
    const auto rows = nc::db::Client{m_host}.query(
        "SELECT path FROM nc_file_meta WHERE uid = ? AND id = ?",
        {user, std::to_string(id)}
    );
    return rows.empty() ? std::string{} : nc::db::value_of(rows.front(), "path");
}

std::vector<std::string> FileMeta::favorites(const std::string& user) const
{
    std::vector<std::string> out;
    for (const nc::db::Row& row: nc::db::Client{m_host}.query(
             "SELECT path FROM nc_file_meta WHERE uid = ? AND favorite = 1 ORDER BY path",
             {user}
         )) {
        out.push_back(nc::db::value_of(row, "path"));
    }
    return out;
}

} // namespace nc::cloud
