/**
 * @file db.h
 * @brief How a plugin uses the database plugin (`plugins/db`) without linking SQLite: three
 * services, `db.exec`, `db.query` and `db.migrate`, with form-encoded arguments. The counterpart of
 * Nextcloud's `OCP\IDBConnection` and `OCP\Migration`.
 */
#pragma once

#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace nc::db {

/// One result row: column name and value, in column order. A NULL column is left out.
using Row = std::vector<std::pair<std::string, std::string>>;

[[nodiscard]] inline std::string
value_of(const Row& row, std::string_view column, std::string_view fallback = {})
{
    for (const auto& [name, value]: row) {
        if (name == column) {
            return value;
        }
    }
    return std::string{fallback};
}

class Client
{
public:
    explicit Client(const nc::Host* host) noexcept :
        m_host{host}
    {
    }

    /// @brief Runs one statement with `?` parameters. Throws std::runtime_error with SQLite's
    /// message. Returns the number of rows changed; `last_insert_id` (when given) receives the new
    /// row id.
    std::int64_t exec(
        std::string_view sql,
        const std::vector<std::string>& params = {},
        std::int64_t* last_insert_id = nullptr
    ) const
    {
        const nc::http::Response answer = m_host->call_service("db.exec", encode(sql, params));
        if (answer.get_status() != 200) {
            throw std::runtime_error("db.exec: " + answer.get_body());
        }
        const auto form = util::parse_form(answer.get_body());
        if (last_insert_id != nullptr) {
            *last_insert_id = std::strtoll(util::form_value(form, "last_id").c_str(), nullptr, 10);
        }
        return std::strtoll(util::form_value(form, "changes").c_str(), nullptr, 10);
    }

    [[nodiscard]] std::vector<Row>
    query(std::string_view sql, const std::vector<std::string>& params = {}) const
    {
        const nc::http::Response answer = m_host->call_service("db.query", encode(sql, params));
        if (answer.get_status() != 200) {
            throw std::runtime_error("db.query: " + answer.get_body());
        }
        std::vector<Row> rows;
        for (const std::string& line: util::split(answer.get_body(), '\n')) {
            if (!line.empty()) {
                rows.push_back(util::parse_form(line));
            }
        }
        return rows;
    }

    /// @brief Applies `sql` (several statements allowed) once for this `plugin` and `version`; a
    /// version that was applied before is skipped. Versions must only ever grow.
    void migrate(std::string_view plugin, int version, std::string_view sql) const
    {
        const nc::http::Response answer = m_host->call_service(
            "db.migrate",
            util::form_encode(
                {{"plugin", std::string{plugin}},
                 {"version", std::to_string(version)},
                 {"sql", std::string{sql}}}
            )
        );
        if (answer.get_status() != 200) {
            throw std::runtime_error("db.migrate: " + answer.get_body());
        }
    }

private:
    static std::string encode(std::string_view sql, const std::vector<std::string>& params)
    {
        std::vector<std::pair<std::string, std::string>> form{{"sql", std::string{sql}}};
        for (const std::string& param: params) {
            form.emplace_back("p", param);
        }
        return util::form_encode(form);
    }

    const nc::Host* m_host{nullptr};
};

} // namespace nc::db
