#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

namespace {

using nc::http::Request;

Request req(std::string method, std::string path, std::string body, const std::string& credentials)
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
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

} // namespace

int main()
{
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-groups-" + nc::util::random_hex(4)))
            .string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"groups", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{3});

    std::string out;
    ::setenv("OC_PASS", "admin password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"admin"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string admin = "admin:admin password";
    const std::string bob = "bob:bob password";

    // Creating: admin only, valid names, no duplicates.
    NC_CHECK_EQ(
        kernel.handle(req("POST", "/ocs/v2.php/cloud/groups", "groupid=staff", bob)).get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", "/ocs/v2.php/cloud/groups", "groupid=staff", admin)).get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", "/ocs/v2.php/cloud/groups", "groupid=staff", admin)).get_status(),
        409
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", "/ocs/v2.php/cloud/groups", "groupid=bad%2Fname", admin))
            .get_status(),
        400
    );
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/ocs/v2.php/cloud/groups"}).get_status(), 401);

    // Members: services answer for other plugins.
    NC_CHECK_EQ(
        kernel.handle(req("POST", "/ocs/v2.php/cloud/users/bob/groups", "groupid=staff", admin))
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", "/ocs/v2.php/cloud/users/bob/groups", "groupid=staff", admin))
            .get_status(),
        409
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", "/ocs/v2.php/cloud/users/ghost/groups", "groupid=staff", admin))
            .get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", "/ocs/v2.php/cloud/users/bob/groups", "groupid=nope", admin))
            .get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.get_services().call("groups.is_member", "group=staff&user=bob").get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.get_services().call("groups.is_member", "group=staff&user=admin").get_status(),
        404
    );
    NC_CHECK_EQ(kernel.get_services().call("groups.of", "bob").get_body(), "staff\n");
    NC_CHECK_EQ(kernel.get_services().call("groups.exists", "staff").get_status(), 200);

    // A user sees their own groups, not other people's.
    NC_CHECK(
        kernel.handle(req("GET", "/ocs/v2.php/cloud/users/bob/groups", "", bob))
            .get_body()
            .find(R"("staff")") != std::string::npos
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", "/ocs/v2.php/cloud/users/admin/groups", "", bob)).get_status(),
        403
    );
    NC_CHECK(
        kernel.handle(req("GET", "/ocs/v2.php/cloud/groups/staff/users", "", admin))
            .get_body()
            .find(R"("bob")") != std::string::npos
    );

    // Commands.
    NC_CHECK_EQ(kernel.run_command("group:add", {"ops"}, out), 0);
    NC_CHECK_EQ(kernel.run_command("group:adduser", {"ops", "admin"}, out), 0);
    NC_CHECK_EQ(kernel.run_command("group:list", {}, out), 0);
    NC_CHECK_EQ(out, "ops: admin\nstaff: bob\n");

    // Removing and deleting: memberships follow.
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", "/ocs/v2.php/cloud/users/bob/groups", "groupid=staff", admin))
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", "/ocs/v2.php/cloud/users/bob/groups", "groupid=staff", admin))
            .get_status(),
        404
    );
    NC_CHECK_EQ(kernel.run_command("group:delete", {"ops"}, out), 0);
    NC_CHECK_EQ(kernel.get_services().call("groups.exists", "ops").get_status(), 404);
    NC_CHECK_EQ(kernel.get_services().call("groups.of", "admin").get_body(), "");

    // Deleting an account removes it from its groups (event from the users plugin).
    NC_CHECK_EQ(kernel.run_command("group:adduser", {"staff", "bob"}, out), 0);
    NC_CHECK_EQ(kernel.run_command("user:delete", {"bob"}, out), 0);
    NC_CHECK_EQ(kernel.get_services().call("groups.members", "staff").get_body(), "");

    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
