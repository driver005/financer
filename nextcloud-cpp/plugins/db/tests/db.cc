#include "nextcloud/db.h"

#include "database.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <filesystem>

namespace {

void test_database()
{
    nc::db::Database db;
    NC_CHECK(db.open(":memory:").has_value());
    NC_CHECK(
        db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, note TEXT)", {}).has_value()
    );
    const auto inserted = db.exec(
        "INSERT INTO t (name, note) VALUES (?, ?)",
        {"it's \"quoted\"; DROP TABLE t;--", "line1\nline2\ttab"}
    );
    NC_CHECK(inserted.has_value());
    NC_CHECK_EQ(inserted->changes, std::int64_t{1});
    NC_CHECK_EQ(inserted->last_id, std::int64_t{1});
    NC_CHECK(db.exec("INSERT INTO t (name) VALUES (?)", {"second"}).has_value());

    // Parameters are bound, never pasted into the statement.
    const auto rows = db.query("SELECT id, name, note FROM t ORDER BY id", {});
    NC_CHECK(rows.has_value());
    NC_CHECK_EQ(rows->size(), std::size_t{2});
    NC_CHECK_EQ((*rows)[0][1].second, "it's \"quoted\"; DROP TABLE t;--");
    NC_CHECK_EQ((*rows)[0][2].second, "line1\nline2\ttab");
    NC_CHECK_EQ((*rows)[1].size(), std::size_t{2}); // the NULL note is left out
    NC_CHECK(db.query("SELECT * FROM t WHERE id = ?", {"1"})->size() == 1);

    NC_CHECK(!db.exec("INSERT INTO nope VALUES (1)", {}).has_value());
    NC_CHECK(!db.exec("INSERT INTO t (name) VALUES (?)", {}).has_value()); // too few parameters
    NC_CHECK(!db.exec("INSERT INTO t (name) VALUES (?)", {"a", "b"}).has_value()); // too many

    // Migrations run once, in a transaction.
    NC_CHECK(db.migrate("demo", 1, "CREATE TABLE m (x); INSERT INTO m VALUES (1);").value_or(false)
    );
    NC_CHECK(!db.migrate("demo", 1, "CREATE TABLE m (x);").value_or(true)); // already applied
    NC_CHECK(!db.migrate("demo", 2, "CREATE TABLE ok (x); CREATE TABLE ok (x);").has_value());
    NC_CHECK(
        db.query("SELECT * FROM ok", {}).has_value() == false
    ); // the failed migration was rolled back
    NC_CHECK(db.migrate("demo", 2, "CREATE TABLE ok (x);").value_or(false));
    NC_CHECK_EQ(db.migrations().size(), std::size_t{2});
}

void test_plugin()
{
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-db-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{nc::Config::parse("data_dir = " + dir + "\n").value()};
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_library("plugins/db/libdb.so").has_value());
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{1});

    NC_CHECK_EQ(
        kernel.get_services()
            .call(
                "db.migrate",
                "plugin=t&version=1&sql=CREATE+TABLE+a+%28id+INTEGER+PRIMARY+KEY%2C+v+TEXT%29"
            )
            .get_body(),
        "applied"
    );
    NC_CHECK_EQ(
        kernel.get_services()
            .call("db.exec", "sql=INSERT+INTO+a%28v%29+VALUES%28%3F%29&p=hello%20world")
            .get_status(),
        200
    );
    const auto answer = kernel.get_services().call("db.query", "sql=SELECT+id%2C+v+FROM+a");
    NC_CHECK_EQ(answer.get_body(), "id=1&v=hello%20world\n");
    NC_CHECK_EQ(
        kernel.get_services().call("db.query", "sql=SELECT+*+FROM+missing").get_status(),
        400
    );

    std::string out;
    NC_CHECK_EQ(kernel.run_command("db:query", {"SELECT v FROM a"}, out), 0);
    NC_CHECK_EQ(out, "hello world\n");
    NC_CHECK_EQ(kernel.run_command("db:migrations", {}, out), 0);
    NC_CHECK_EQ(out, "t 1\n");
    kernel.stop();

    // The data survives a restart of the runner.
    nc::Kernel again{nc::Config::parse("data_dir = " + dir + "\n").value()};
    again.get_logger().set_sink({});
    NC_CHECK(again.add_plugin_library("plugins/db/libdb.so").has_value());
    NC_CHECK(again.start().has_value());
    NC_CHECK_EQ(
        again.get_services().call("db.query", "sql=SELECT+v+FROM+a").get_body(),
        "v=hello%20world\n"
    );
    NC_CHECK_EQ(
        again.get_services().call("db.migrate", "plugin=t&version=1&sql=DROP+TABLE+a").get_body(),
        "current"
    );
    again.stop();
    std::filesystem::remove_all(dir);
}

} // namespace

int main()
{
    test_database();
    test_plugin();
    return NC_TEST_RESULT();
}
