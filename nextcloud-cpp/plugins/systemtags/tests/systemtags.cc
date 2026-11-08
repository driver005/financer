#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

namespace {

using nc::http::Request;

Request
req(std::string method,
    std::string path,
    std::string body,
    const std::string& credentials,
    std::string query = {})
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
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

} // namespace

int main()
{
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-tags-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"systemtags", "cloud", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(
        kernel.run_command("user:add", {"alice"}, out),
        0
    ); // the first account is the administrator
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string alice = "alice:alice password";
    const std::string bob = "bob:bob password";
    const std::string api = "/ocs/v2.php/apps/systemtags/api/v1";
    const std::string files = "/remote.php/dav/files/alice";

    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/report.pdf", "x", alice)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("MKCOL", files + "/docs", "", alice)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/docs/a.txt", "x", alice)).get_status(), 201);

    // Tags are shared by everybody: anyone makes one, names are unique.
    NC_CHECK_EQ(kernel.handle(Request{"GET", api + "/tags"}).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(req("POST", api + "/tags", "name=Important", bob)).get_status(), 200);
    NC_CHECK_EQ(
        kernel.handle(req("POST", api + "/tags", "name=Important", alice)).get_status(),
        409
    );
    NC_CHECK_EQ(kernel.handle(req("POST", api + "/tags", "name=", alice)).get_status(), 400);
    NC_CHECK_EQ(kernel.run_command("tag:add", {"Draft"}, out), 0);
    const auto tags = kernel.handle(req("GET", api + "/tags", "", alice)).get_body();
    NC_CHECK(
        tags.find("\"name\":\"Draft\"") != std::string::npos &&
        tags.find("\"name\":\"Important\"") != std::string::npos
    );

    // Tagging a file: yours only, and it has to exist.
    NC_CHECK_EQ(
        kernel.handle(req("POST", api + "/objects", "path=/report.pdf&tag=1", alice)).get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", api + "/objects", "path=/report.pdf&tag=1", alice)).get_status(),
        200
    ); // again: no harm
    NC_CHECK_EQ(
        kernel.handle(req("POST", api + "/objects", "path=/missing&tag=1", alice)).get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", api + "/objects", "path=/report.pdf&tag=99", alice)).get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", api + "/objects", "path=/report.pdf&tag=1", bob)).get_status(),
        404
    ); // not bob's file
    NC_CHECK_EQ(
        kernel.handle(req("POST", api + "/objects", "path=/docs&tag=2", alice)).get_status(),
        200
    );
    NC_CHECK(
        kernel.handle(req("GET", api + "/objects", "", alice, "path=/report.pdf"))
            .get_body()
            .find("Important") != std::string::npos
    );
    NC_CHECK(
        kernel.handle(req("GET", api + "/objects", "", alice, "tag=2"))
            .get_body()
            .find("\"/docs\"") != std::string::npos
    );
    NC_CHECK(
        kernel.handle(req("GET", api + "/objects", "", bob, "tag=1")).get_body().find("report") ==
        std::string::npos
    );

    // The tags follow a rename (also of a folder above), and go with a deleted file.
    Request rename{"MOVE", files + "/docs"};
    rename.add_header("Destination", files + "/papers");
    rename.add_header("Authorization", "Basic " + nc::util::base64_encode(alice));
    NC_CHECK_EQ(kernel.handle(std::move(rename)).get_status(), 201);
    NC_CHECK(
        kernel.handle(req("GET", api + "/objects", "", alice, "tag=2"))
            .get_body()
            .find("\"/papers\"") != std::string::npos
    );
    NC_CHECK_EQ(kernel.handle(req("DELETE", files + "/report.pdf", "", alice)).get_status(), 204);
    NC_CHECK(
        kernel.handle(req("GET", api + "/objects", "", alice, "tag=1")).get_body().find("report") ==
        std::string::npos
    );

    // Untagging, and deleting a tag (administrator only) takes it off everything.
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", api + "/objects", "path=/papers&tag=2", alice)).get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", api + "/objects", "path=/papers&tag=2", alice)).get_status(),
        404
    );
    NC_CHECK_EQ(kernel.handle(req("DELETE", api + "/tags/1", "", bob)).get_status(), 403);
    NC_CHECK_EQ(kernel.handle(req("DELETE", api + "/tags/1", "", alice)).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("DELETE", api + "/tags/1", "", alice)).get_status(), 404);

    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
