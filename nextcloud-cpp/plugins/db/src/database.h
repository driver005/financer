#pragma once

#include "nextcloud/util/expected.h"

#include <cstdint>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

struct sqlite3;

namespace nc::db {

/// One row as column name and text value; NULL columns are left out.
using Row = std::vector<std::pair<std::string, std::string>>;

/// @brief One SQLite connection behind a mutex: every statement runs alone, so plugins on different
/// connection threads cannot interleave a transaction. WAL journal and a busy timeout so other
/// processes (a backup, `sqlite3`) can read at the same time.
class Database
{
public:
    using Error = std::string;
    template<typename Value> using Result = util::expected<Value, Error>;

    Database() noexcept = default;
    ~Database();
    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;
    Database(Database&&) = delete;
    Database& operator=(Database&&) = delete;

    /// @brief Opens (creating it) the file, or ":memory:".
    Result<void> open(const std::string& file);

    struct ExecResult
    {
        std::int64_t changes{0};
        std::int64_t last_id{0};
    };

    Result<ExecResult> exec(std::string_view sql, const std::vector<std::string>& params);
    Result<std::vector<Row>> query(std::string_view sql, const std::vector<std::string>& params);

    /// @brief Applies a migration script once per (plugin, version), in one transaction.
    Result<bool> migrate(std::string_view plugin, int version, std::string_view script);

    [[nodiscard]] std::vector<std::string> migrations();

private:
    Result<void> script_locked(std::string_view sql);

    std::mutex m_mutex{};
    sqlite3* m_db{nullptr};
};

} // namespace nc::db
