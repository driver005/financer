#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace {

namespace fs = std::filesystem;
using nc::http::Request;

Request req(std::string method, std::string path, std::string body = {})
{
    Request request{
        std::move(method),
        std::move(path),
        std::string{},
        std::move(body),
        std::string{},
        {},
        {}
    };
    request.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:alice password"));
    return request;
}

std::string slurp(const fs::path& path)
{
    std::ifstream stream{path, std::ios::binary};
    std::ostringstream text;
    text << stream.rdbuf();
    return text.str();
}

} // namespace

int main()
{
    const std::string dir =
        (fs::temp_directory_path() / ("nc-trash-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"trashbin", "cloud", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{4});
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string files = "/remote.php/dav/files/alice";
    const std::string trash = "/ocs/v2.php/apps/files_trashbin/api/v1/trash";

    NC_CHECK_EQ(kernel.handle(req("MKCOL", files + "/docs")).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/docs/a.txt", "AAA")).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/b.txt", "BBBB")).get_status(), 201);

    // Delete: the file is gone from the tree but not from the disk, and it is listed.
    NC_CHECK_EQ(kernel.handle(req("DELETE", files + "/b.txt")).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(req("GET", files + "/b.txt")).get_status(), 404);
    NC_CHECK(!fs::exists(dir + "/alice/files/b.txt"));
    NC_CHECK_EQ(kernel.handle(req("DELETE", files + "/docs")).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(req("DELETE", files + "/nothing")).get_status(), 404);
    const auto listing = kernel.handle(req("GET", trash)).get_body();
    NC_CHECK(listing.find(R"("original_path":"/b.txt")") != std::string::npos);
    NC_CHECK(listing.find(R"("original_path":"/docs")") != std::string::npos);
    NC_CHECK(listing.find(R"("type":"folder")") != std::string::npos);
    NC_CHECK_EQ(kernel.handle(Request{"GET", std::string{trash}}).get_status(), 401);
    NC_CHECK_EQ(kernel.run_command("trash:list", {"alice"}, out), 0);
    NC_CHECK_EQ(out, "1\t/b.txt\t4\n2\t/docs\t3\n");

    // Restore a file, and a folder with its content.
    NC_CHECK_EQ(kernel.handle(req("POST", trash + "/1/restore")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("GET", files + "/b.txt")).get_body(), "BBBB");
    NC_CHECK_EQ(
        kernel.handle(req("POST", trash + "/1/restore")).get_status(),
        404
    ); // no longer in the trash
    NC_CHECK_EQ(kernel.handle(req("POST", trash + "/2/restore")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("GET", files + "/docs/a.txt")).get_body(), "AAA");

    // The place is taken: the restored file comes back next to it, nothing is overwritten.
    NC_CHECK_EQ(kernel.handle(req("DELETE", files + "/b.txt")).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/b.txt", "NEW")).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("POST", trash + "/3/restore")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("GET", files + "/b.txt")).get_body(), "NEW");
    NC_CHECK_EQ(kernel.handle(req("GET", files + "/b.txt (restored)")).get_body(), "BBBB");

    // Removing for good takes the bytes off the disk; "empty" does it for everything.
    NC_CHECK_EQ(kernel.handle(req("DELETE", files + "/b.txt")).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(req("DELETE", files + "/docs")).get_status(), 204);
    std::size_t in_trash = 0;
    for ([[maybe_unused]] const auto& entry:
         fs::directory_iterator{dir + "/alice/files_trashbin"}) {
        ++in_trash;
    }
    NC_CHECK_EQ(in_trash, std::size_t{2});
    NC_CHECK_EQ(kernel.handle(req("DELETE", trash + "/4")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("DELETE", trash + "/4")).get_status(), 404);
    NC_CHECK_EQ(kernel.handle(req("DELETE", trash)).get_status(), 200);
    in_trash = 0;
    for ([[maybe_unused]] const auto& entry:
         fs::directory_iterator{dir + "/alice/files_trashbin"}) {
        ++in_trash;
    }
    NC_CHECK_EQ(in_trash, std::size_t{0});

    // Expiry: an item older than retention_days is removed for good.
    NC_CHECK_EQ(kernel.handle(req("DELETE", files + "/b.txt (restored)")).get_status(), 204);
    NC_CHECK_EQ(
        kernel.get_services()
            .call("db.exec", "sql=UPDATE+nc_trash+SET+deleted_at+%3D+1")
            .get_status(),
        200
    );
    NC_CHECK_EQ(kernel.run_command("trash:expire", {}, out), 0);
    NC_CHECK_EQ(out, "removed 1 item(s)\n");
    NC_CHECK(
        kernel.handle(req("GET", trash)).get_body().find("original_path") == std::string::npos
    );

    // Without the trash bin plugin the cloud plugin deletes for good.
    kernel.stop();
    nc::Kernel plain{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    plain.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "users"}) {
        NC_CHECK(plain
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(plain.start().has_value());
    NC_CHECK_EQ(plain.handle(req("PUT", files + "/c.txt", "CC")).get_status(), 201);
    NC_CHECK_EQ(plain.handle(req("DELETE", files + "/c.txt")).get_status(), 204);
    NC_CHECK(!fs::exists(dir + "/alice/files_trashbin/c.txt"));
    NC_CHECK(!fs::exists(dir + "/alice/files/c.txt"));
    plain.stop();
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
