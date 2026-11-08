#include "database.h"

#include <filesystem>
#include <memory>
#include <sqlite3.h>

namespace nc::db {

namespace {

    util::unexpected<std::string> failure(sqlite3* db, std::string_view what)
    {
        return util::unexpected<std::string>{std::string{what} + ": " + sqlite3_errmsg(db)};
    }

    struct Statement
    {
        sqlite3_stmt* stmt{nullptr};

        ~Statement()
        {
            sqlite3_finalize(stmt);
        }
    };

} // namespace

Database::~Database()
{
    if (m_db != nullptr) {
        sqlite3_close(m_db);
    }
}

Database::Result<void> Database::open(const std::string& file)
{
    const std::lock_guard lock{m_mutex};
    if (file != ":memory:") {
        std::error_code error;
        const std::filesystem::path path{file};
        if (path.has_parent_path()) {
            std::filesystem::create_directories(path.parent_path(), error);
        }
    }
    if (sqlite3_open_v2(
            file.c_str(),
            &m_db,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
            nullptr
        ) != SQLITE_OK) {
        const std::string message = m_db != nullptr ? sqlite3_errmsg(m_db) : "out of memory";
        sqlite3_close(m_db);
        m_db = nullptr;
        return util::unexpected<std::string>{"cannot open " + file + ": " + message};
    }
    sqlite3_busy_timeout(m_db, 5'000);
    if (auto done = script_locked(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;"
            "CREATE TABLE IF NOT EXISTS nc_migrations ("
            " plugin TEXT NOT NULL, version INTEGER NOT NULL, applied INTEGER NOT NULL,"
            " PRIMARY KEY (plugin, version));"
        );
        !done) {
        return done;
    }
    return {};
}

Database::Result<void> Database::script_locked(std::string_view sql)
{
    char* message = nullptr;
    const std::string text{sql};
    if (sqlite3_exec(m_db, text.c_str(), nullptr, nullptr, &message) != SQLITE_OK) {
        std::string error = message != nullptr ? message : "SQLite error";
        sqlite3_free(message);
        return util::unexpected<std::string>{error};
    }
    return {};
}

namespace {

    /// Prepares `sql` (one statement) and binds the text parameters.
    bool prepare(
        sqlite3* db,
        std::string_view sql,
        const std::vector<std::string>& params,
        Statement& statement,
        std::string& error
    )
    {
        if (sqlite3_prepare_v2(
                db,
                sql.data(),
                static_cast<int>(sql.size()),
                &statement.stmt,
                nullptr
            ) != SQLITE_OK) {
            error = sqlite3_errmsg(db);
            return false;
        }
        const int expected = sqlite3_bind_parameter_count(statement.stmt);
        if (static_cast<std::size_t>(expected) != params.size()) {
            error = "the statement has " + std::to_string(expected) + " parameter(s), " +
                    std::to_string(params.size()) + " given";
            return false;
        }
        for (std::size_t index = 0; index < params.size(); ++index) {
            sqlite3_bind_text(
                statement.stmt,
                static_cast<int>(index + 1),
                params[index].data(),
                static_cast<int>(params[index].size()),
                SQLITE_TRANSIENT
            );
        }
        return true;
    }

} // namespace

Database::Result<Database::ExecResult>
Database::exec(std::string_view sql, const std::vector<std::string>& params)
{
    const std::lock_guard lock{m_mutex};
    Statement statement;
    std::string error;
    if (!prepare(m_db, sql, params, statement, error)) {
        return util::unexpected<std::string>{error};
    }
    int code = sqlite3_step(statement.stmt);
    while (code == SQLITE_ROW) {
        code = sqlite3_step(statement.stmt);
    }
    if (code != SQLITE_DONE) {
        return failure(m_db, "statement failed");
    }
    return ExecResult{sqlite3_changes64(m_db), sqlite3_last_insert_rowid(m_db)};
}

Database::Result<std::vector<Row>>
Database::query(std::string_view sql, const std::vector<std::string>& params)
{
    const std::lock_guard lock{m_mutex};
    Statement statement;
    std::string error;
    if (!prepare(m_db, sql, params, statement, error)) {
        return util::unexpected<std::string>{error};
    }
    std::vector<Row> rows;
    const int columns = sqlite3_column_count(statement.stmt);
    int code = 0;
    while ((code = sqlite3_step(statement.stmt)) == SQLITE_ROW) {
        Row row;
        for (int column = 0; column < columns; ++column) {
            if (sqlite3_column_type(statement.stmt, column) == SQLITE_NULL) {
                continue;
            }
            const auto* text =
                reinterpret_cast<const char*>(sqlite3_column_text(statement.stmt, column));
            const int size = sqlite3_column_bytes(statement.stmt, column);
            row.emplace_back(
                sqlite3_column_name(statement.stmt, column),
                std::string(text != nullptr ? text : "", static_cast<std::size_t>(size))
            );
        }
        rows.push_back(std::move(row));
    }
    if (code != SQLITE_DONE) {
        return failure(m_db, "query failed");
    }
    return rows;
}

Database::Result<bool>
Database::migrate(std::string_view plugin, int version, std::string_view script)
{
    const std::lock_guard lock{m_mutex};
    {
        Statement statement;
        std::string error;
        if (!prepare(
                m_db,
                "SELECT 1 FROM nc_migrations WHERE plugin = ?1 AND version = ?2",
                {std::string{plugin}, std::to_string(version)},
                statement,
                error
            )) {
            return util::unexpected<std::string>{error};
        }
        if (sqlite3_step(statement.stmt) == SQLITE_ROW) {
            return false; // applied before
        }
    }
    if (auto begun = script_locked("BEGIN IMMEDIATE"); !begun) {
        return util::unexpected<std::string>{begun.error()};
    }
    auto applied = script_locked(script);
    if (applied) {
        Statement statement;
        std::string error;
        if (!prepare(
                m_db,
                "INSERT INTO nc_migrations (plugin, version, applied) VALUES (?1, ?2, "
                "strftime('%s','now'))",
                {std::string{plugin}, std::to_string(version)},
                statement,
                error
            ) ||
            sqlite3_step(statement.stmt) != SQLITE_DONE) {
            applied = util::unexpected<std::string>{error.empty() ? sqlite3_errmsg(m_db) : error};
        }
    }
    if (!applied) {
        (void)script_locked("ROLLBACK");
        return util::unexpected<std::string>{
            "migration " + std::string{plugin} + " " + std::to_string(version) + ": " +
            applied.error()
        };
    }
    if (auto committed = script_locked("COMMIT"); !committed) {
        return util::unexpected<std::string>{committed.error()};
    }
    return true;
}

std::vector<std::string> Database::migrations()
{
    const std::lock_guard lock{m_mutex};
    std::vector<std::string> out;
    Statement statement;
    std::string error;
    if (!prepare(
            m_db,
            "SELECT plugin, version FROM nc_migrations ORDER BY plugin, version",
            {},
            statement,
            error
        )) {
        return out;
    }
    while (sqlite3_step(statement.stmt) == SQLITE_ROW) {
        out.push_back(
            std::string(reinterpret_cast<const char*>(sqlite3_column_text(statement.stmt, 0))) +
            " " + std::to_string(sqlite3_column_int(statement.stmt, 1))
        );
    }
    return out;
}

} // namespace nc::db
