#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

int main()
{
    using nc::http::Request;
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-notif-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"notifications", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    const auto as = [](std::string method, std::string path, const std::string& credentials)
    {
        Request request{std::move(method), std::move(path)};
        request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
        return request;
    };
    const std::string base = "/ocs/v2.php/apps/notifications/api/v2/notifications";

    // Pushed by service, by event and by command; everyone sees only their own.
    NC_CHECK_EQ(
        kernel.get_services()
            .call("notifications.push", "user=bob&subject=Hello&message=First+one&link=%2Fx")
            .get_status(),
        200
    );
    NC_CHECK_EQ(kernel.get_services().call("notifications.push", "user=bob").get_status(), 400);
    kernel.get_events().publish(
        "share.created",
        "type=0&owner=alice&share_with=bob&path=%2Fplan.txt"
    );
    NC_CHECK_EQ(
        kernel.run_command("notification:generate", {"alice", "From the command line"}, out),
        0
    );

    NC_CHECK_EQ(kernel.handle(Request{"GET", std::string{base}}).get_status(), 401);
    const auto bob = kernel.handle(as("GET", base, "bob:bob password")).get_body();
    NC_CHECK(bob.find("alice shared \\\"/plan.txt\\\" with you") != std::string::npos);
    NC_CHECK(bob.find("\"message\":\"First one\"") != std::string::npos);
    NC_CHECK(bob.find("From the command line") == std::string::npos);
    const auto alice = kernel.handle(as("GET", base, "alice:alice password")).get_body();
    NC_CHECK(alice.find("From the command line") != std::string::npos);

    // Dismissing: only your own, then it is gone.
    NC_CHECK_EQ(kernel.handle(as("GET", base + "/1", "bob:bob password")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(as("GET", base + "/1", "alice:alice password")).get_status(), 404);
    NC_CHECK_EQ(kernel.handle(as("DELETE", base + "/1", "alice:alice password")).get_status(), 404);
    NC_CHECK_EQ(kernel.handle(as("DELETE", base + "/1", "bob:bob password")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(as("GET", base + "/1", "bob:bob password")).get_status(), 404);
    NC_CHECK_EQ(kernel.handle(as("DELETE", base, "bob:bob password")).get_status(), 200);
    NC_CHECK(
        kernel.handle(as("GET", base, "bob:bob password")).get_body().find("notification_id") ==
        std::string::npos
    );

    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
