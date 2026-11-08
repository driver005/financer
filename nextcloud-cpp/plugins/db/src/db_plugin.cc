/**
 * @file db_plugin.cc
 * @brief The database plugin: SQLite behind the services `db.exec`, `db.query` and `db.migrate`, so
 * no other plugin links a database. Counterpart of Nextcloud's `lib/private/DB` and
 * `lib/private/Migration`.
 */
#include "database.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <memory>

namespace {

using nc::http::Response;

std::vector<std::string> params_of(const std::vector<std::pair<std::string, std::string>>& form)
{
    std::vector<std::string> params;
    for (const auto& [name, value]: form) {
        if (name == "p") {
            params.push_back(value);
        }
    }
    return params;
}

class DbPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "db";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "SQLite database and migrations for the other plugins";
    }

    void on_load(nc::Host& host) override
    {
        m_database = std::make_unique<nc::db::Database>();
        if (auto opened = m_database->open(
                host.config("file", host.config("data_dir", "data") + "/nextcloud.db")
            );
            !opened) {
            throw std::runtime_error(opened.error());
        }
        nc::db::Database& database = *m_database;

        host.add_service(
            "db.exec",
            [&database](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const auto done = database.exec(nc::util::form_value(form, "sql"), params_of(form));
                if (!done) {
                    return Response::text(400, done.error());
                }
                return Response::text(
                    200,
                    nc::util::form_encode(
                        {{"changes", std::to_string(done->changes)},
                         {"last_id", std::to_string(done->last_id)}}
                    )
                );
            }
        );

        host.add_service(
            "db.query",
            [&database](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const auto rows =
                    database.query(nc::util::form_value(form, "sql"), params_of(form));
                if (!rows) {
                    return Response::text(400, rows.error());
                }
                std::string body;
                for (const nc::db::Row& row: *rows) {
                    body += nc::util::form_encode(row) + "\n";
                }
                return Response::text(200, std::move(body));
            }
        );

        host.add_service(
            "db.migrate",
            [&database](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const auto applied = database.migrate(
                    nc::util::form_value(form, "plugin"),
                    std::atoi(nc::util::form_value(form, "version").c_str()),
                    nc::util::form_value(form, "sql")
                );
                if (!applied) {
                    return Response::text(400, applied.error());
                }
                return Response::text(200, *applied ? "applied" : "current");
            }
        );

        host.add_command(
            "db:query",
            "Runs a read-only query: db:query \"SELECT ...\"",
            [&database](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: db:query \"SELECT ...\"\n";
                    return 1;
                }
                const auto rows = database.query(args[0], {});
                if (!rows) {
                    out = rows.error() + "\n";
                    return 1;
                }
                for (const nc::db::Row& row: *rows) {
                    for (std::size_t index = 0; index < row.size(); ++index) {
                        out += (index == 0 ? "" : "\t") + row[index].second;
                    }
                    out += "\n";
                }
                return 0;
            }
        );

        host.add_command(
            "db:migrations",
            "Lists the applied migrations",
            [&database](const std::vector<std::string>&, std::string& out)
            {
                for (const std::string& line: database.migrations()) {
                    out += line + "\n";
                }
                return 0;
            }
        );
    }

private:
    std::unique_ptr<nc::db::Database> m_database{};
};

} // namespace

NC_PLUGIN(DbPlugin)
