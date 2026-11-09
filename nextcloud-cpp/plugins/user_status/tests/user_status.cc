#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <chrono>
#include <cstdlib>
#include <filesystem>

int main()
{
    using nc::http::Request;
    using nc::http::Response;
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-status-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"user_status", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    for (const char* name: {"alice", "bob"}) {
        ::setenv("OC_PASS", (std::string{name} + " password").c_str(), 1);
        NC_CHECK_EQ(kernel.run_command("user:add", {name}, out), 0);
    }
    ::unsetenv("OC_PASS");
    const auto call = [&](const std::string& method,
                          const std::string& path,
                          const std::string& user,
                          const std::string& body = {})
    {
        Request request{std::string{method}, std::string{path}, "", std::string{body}, "", {}, {}};
        if (!user.empty()) {
            request.add_header("Authorization", "Basic " + nc::util::base64_encode(user + ":" + user + " password"));
        }
        return kernel.handle(std::move(request));
    };
    const std::string base = "/ocs/v2.php/apps/user_status/api/v1";
    const auto contains = [](const Response& response, const std::string& text)
    {
        return response.get_body().find(text) != std::string::npos;
    };

    NC_CHECK_EQ(call("GET", base + "/user_status", "").get_status(), 401);
    NC_CHECK_EQ(call("GET", base + "/user_status", "alice").get_status(), 404); // nothing said yet
    NC_CHECK_EQ(call("PUT", base + "/user_status/status", "alice", "statusType=bogus").get_status(), 400);
    NC_CHECK_EQ(call("PUT", base + "/user_status/status", "alice", "statusType=dnd").get_status(), 200);
    NC_CHECK(contains(call("GET", base + "/user_status", "alice"), "\"status\":\"dnd\""));

    // A message with an icon; bad input is refused.
    NC_CHECK_EQ(call("PUT", base + "/user_status/message/custom", "alice", "message=In+a+meeting&statusIcon=%F0%9F%93%85").get_status(), 200);
    NC_CHECK_EQ(call("PUT", base + "/user_status/message/custom", "alice", "message=").get_status(), 400);
    NC_CHECK_EQ(call("PUT", base + "/user_status/message/custom", "alice", "message=" + std::string(81, 'x')).get_status(), 400);
    NC_CHECK_EQ(call("PUT", base + "/user_status/message/custom", "alice", "message=a%0Ab").get_status(), 400);
    NC_CHECK_EQ(call("PUT", base + "/user_status/message/custom", "alice", "message=x&clearAt=1").get_status(), 400);
    const auto seen = call("GET", base + "/statuses/alice", "bob");
    NC_CHECK(contains(seen, "\"message\":\"In a meeting\""));
    NC_CHECK(contains(seen, "\"status\":\"dnd\""));

    // A message with an end time disappears after it.
    const auto soon = std::chrono::duration_cast<std::chrono::seconds>(
                          std::chrono::system_clock::now().time_since_epoch()
                      ).count() + 2;
    NC_CHECK_EQ(call("PUT", base + "/user_status/message/custom", "alice", "message=Back+soon&clearAt=" + std::to_string(soon)).get_status(), 200);
    NC_CHECK(contains(call("GET", base + "/user_status", "alice"), "Back soon"));
    (void)kernel.get_services().call("db.exec", "sql=UPDATE+nc_user_status+SET+clear_at+%3D+1+WHERE+uid+%3D+%27alice%27");
    NC_CHECK(!contains(call("GET", base + "/user_status", "alice"), "Back soon"));

    // Invisible reads as offline to others, and says nothing else.
    NC_CHECK_EQ(call("PUT", base + "/user_status/status", "alice", "statusType=invisible").get_status(), 200);
    NC_CHECK_EQ(call("PUT", base + "/user_status/message/custom", "alice", "message=Secret").get_status(), 200);
    const auto hidden = call("GET", base + "/statuses/alice", "bob");
    NC_CHECK(contains(hidden, "\"status\":\"offline\""));
    NC_CHECK(!contains(hidden, "Secret"));
    NC_CHECK(contains(call("GET", base + "/user_status", "alice"), "\"status\":\"invisible\""));
    NC_CHECK(!contains(call("GET", base + "/statuses", "bob"), "invisible"));

    NC_CHECK_EQ(call("DELETE", base + "/user_status/message", "alice").get_status(), 200);
    NC_CHECK(!contains(call("GET", base + "/user_status", "alice"), "Secret"));
    NC_CHECK_EQ(call("GET", base + "/statuses/nobody", "bob").get_status(), 404);

    // Deleted accounts leave nothing behind.
    kernel.get_events().publish("user.deleted", "id=alice");
    NC_CHECK_EQ(call("GET", base + "/statuses/alice", "bob").get_status(), 404);
    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
