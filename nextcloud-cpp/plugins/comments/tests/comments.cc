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
        (std::filesystem::temp_directory_path() / ("nc-comments-" + nc::util::random_hex(4)))
            .string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"comments", "notifications", "cloud", "groups", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    for (const char* name: {"alice", "bob", "carol"}) {
        ::setenv("OC_PASS", (std::string{name} + " password").c_str(), 1);
        NC_CHECK_EQ(kernel.run_command("user:add", {name}, out), 0);
    }
    ::unsetenv("OC_PASS");
    const std::string alice = "alice:alice password";
    const std::string bob = "bob:bob password";
    const std::string carol = "carol:carol password";
    const std::string api = "/ocs/v2.php/apps/comments/api/v1/comments";
    const std::string files = "/remote.php/dav/files/alice";

    NC_CHECK_EQ(kernel.handle(req("MKCOL", files + "/Project", "", alice)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(req("PUT", files + "/Project/plan.txt", "x", alice)).get_status(),
        201
    );

    // The owner comments on their own file.
    NC_CHECK_EQ(kernel.handle(Request{"GET", std::string{api}}).get_status(), 401);
    NC_CHECK_EQ(
        kernel.handle(req("POST", api, "path=/Project/plan.txt&message=Draft+is+ready", alice))
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", api, "path=/Project/plan.txt&message=", alice)).get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                req("POST", api, "path=/Project/plan.txt&message=" + std::string(1'001, 'x'), alice)
            )
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", api, "path=/nothing&message=hi", alice)).get_status(),
        404
    );

    // Nobody else sees the file or its comments, until it is shared with them (the folder above is
    // enough).
    NC_CHECK_EQ(
        kernel.handle(req("GET", api, "", bob, "owner=alice&path=/Project/plan.txt")).get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", api, "owner=alice&path=/Project/plan.txt&message=let+me+in", bob))
            .get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                req("POST",
                    "/ocs/v2.php/apps/files_sharing/api/v1/shares",
                    "path=/Project&shareType=0&shareWith=bob",
                    alice)
            )
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel
            .handle(req("POST", api, "owner=alice&path=/Project/plan.txt&message=Looks+good", bob))
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", api, "", carol, "owner=alice&path=/Project/plan.txt"))
            .get_status(),
        404
    );

    const auto listing =
        kernel.handle(req("GET", api, "", bob, "owner=alice&path=/Project/plan.txt")).get_body();
    NC_CHECK(
        listing.find("\"actor\":\"alice\"") != std::string::npos &&
        listing.find("Draft is ready") != std::string::npos
    );
    NC_CHECK(
        listing.find("\"actor\":\"bob\"") != std::string::npos &&
        listing.find("Looks good") != std::string::npos
    );
    NC_CHECK(listing.find("Draft is ready") < listing.find("Looks good")); // oldest first

    // The file's owner is told about somebody else's comment.
    NC_CHECK(
        kernel.handle(req("GET", "/ocs/v2.php/apps/notifications/api/v2/notifications", "", alice))
            .get_body()
            .find("bob commented on") != std::string::npos
    );

    // Deleting: your own words, or anything on your own file; not a stranger's.
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", api + "/1", "", bob)).get_status(),
        403
    ); // alice's comment, bob's cannot touch it
    NC_CHECK_EQ(kernel.handle(req("DELETE", api + "/2", "", bob)).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("DELETE", api + "/2", "", bob)).get_status(), 404);
    NC_CHECK_EQ(
        kernel.handle(req("POST", api, "owner=alice&path=/Project/plan.txt&message=again", bob))
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", api + "/3", "", alice)).get_status(),
        200
    ); // the owner cleans up

    // A deleted file takes its comments along.
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", files + "/Project/plan.txt", "", alice)).get_status(),
        204
    );
    NC_CHECK_EQ(
        kernel.get_services()
            .call("db.query", "sql=SELECT+COUNT%28*%29+AS+n+FROM+nc_comments")
            .get_body(),
        "n=0\n"
    );

    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
