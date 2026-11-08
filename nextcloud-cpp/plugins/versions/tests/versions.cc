#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

namespace {

namespace fs = std::filesystem;
using nc::http::Request;

Request req(std::string method, std::string path, std::string query = {}, std::string body = {})
{
    Request request{
        std::move(method),
        std::move(path),
        std::move(query),
        std::move(body),
        std::string{},
        {},
        {}
    };
    request.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:alice password"));
    return request;
}

std::size_t count_files(const std::string& dir)
{
    std::size_t count = 0;
    if (fs::exists(dir)) {
        for ([[maybe_unused]] const auto& entry: fs::directory_iterator{dir}) {
            ++count;
        }
    }
    return count;
}

} // namespace

int main()
{
    const std::string dir =
        (fs::temp_directory_path() / ("nc-versions-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[versions]\nmax_versions = 3\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"versions", "cloud", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string files = "/remote.php/dav/files/alice";
    const std::string api = "/ocs/v2.php/apps/files_versions/api/v1/versions";

    // The first write has nothing to keep; every overwrite keeps the content it replaces.
    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/note.txt", "", "v1")).get_status(), 201);
    NC_CHECK_EQ(count_files(dir + "/alice/files_versions"), std::size_t{0});
    NC_CHECK_EQ(
        kernel.handle(req("PUT", files + "/note.txt", "", "version two")).get_status(),
        204
    );
    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/note.txt", "", "third")).get_status(), 204);
    NC_CHECK_EQ(count_files(dir + "/alice/files_versions"), std::size_t{2});
    const auto listing = kernel.handle(req("GET", api, "path=/note.txt")).get_body();
    NC_CHECK(
        listing.find("\"id\":2") != std::string::npos &&
        listing.find("\"id\":1") != std::string::npos
    );
    NC_CHECK(
        listing.find("\"size\":2") != std::string::npos &&
        listing.find("\"size\":11") != std::string::npos
    );
    NC_CHECK(
        kernel.handle(req("GET", api, "path=/other.txt")).get_body().find("\"id\"") ==
        std::string::npos
    );
    NC_CHECK_EQ(kernel.handle(Request{"GET", std::string{api}}).get_status(), 401);

    // Restore version 1: the file has the old content, and what was there becomes a version.
    NC_CHECK_EQ(kernel.handle(req("POST", api + "/1/restore")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("GET", files + "/note.txt")).get_body(), "v1");
    NC_CHECK_EQ(count_files(dir + "/alice/files_versions"), std::size_t{3});
    NC_CHECK_EQ(kernel.handle(req("POST", api + "/99/restore")).get_status(), 404);

    // Only the newest three are kept: the oldest goes from the records and from the disk.
    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/note.txt", "", "fourth")).get_status(), 204);
    NC_CHECK_EQ(count_files(dir + "/alice/files_versions"), std::size_t{3});
    NC_CHECK(
        kernel.handle(req("GET", api, "path=/note.txt")).get_body().find("\"id\":1,") ==
        std::string::npos
    );

    // A moved file takes its history along; the old name has none.
    NC_CHECK_EQ(kernel.handle(req("MKCOL", files + "/dir")).get_status(), 201);
    Request move{"MOVE", files + "/note.txt"};
    move.add_header("Destination", files + "/dir/renamed.txt");
    move.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:alice password"));
    NC_CHECK_EQ(kernel.handle(std::move(move)).get_status(), 201);
    NC_CHECK(
        kernel.handle(req("GET", api, "path=/dir/renamed.txt")).get_body().find("\"id\"") !=
        std::string::npos
    );
    NC_CHECK(
        kernel.handle(req("GET", api, "path=/note.txt")).get_body().find("\"id\"") ==
        std::string::npos
    );

    // Expiry removes old versions for good.
    NC_CHECK_EQ(
        kernel.get_services().call("db.exec", "sql=UPDATE+nc_versions+SET+ts+%3D+1").get_status(),
        200
    );
    NC_CHECK_EQ(kernel.run_command("versions:expire", {}, out), 0);
    NC_CHECK_EQ(out, "removed 3 version(s)\n");
    NC_CHECK_EQ(count_files(dir + "/alice/files_versions"), std::size_t{0});

    kernel.stop();
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
