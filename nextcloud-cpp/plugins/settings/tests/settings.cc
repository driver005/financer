#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

int main()
{
    using nc::http::Request;
    using nc::http::Response;
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-settings-" + nc::util::random_hex(4)))
            .string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"settings", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "root password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"root", "--admin"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    const auto call = [&](const std::string& method,
                          const std::string& path,
                          const std::string& user,
                          const std::string& body = {})
    {
        Request request{std::string{method}, std::string{path}, "", std::string{body}, "", {}, {}};
        if (!user.empty()) {
            request.add_header(
                "Authorization",
                "Basic " + nc::util::base64_encode(user + ":" + user + " password")
            );
        }
        return kernel.handle(std::move(request));
    };
    const std::string apps = "/ocs/v2.php/apps/provisioning_api/api/v1/config/apps";
    const std::string users = "/ocs/v2.php/apps/provisioning_api/api/v1/config/users";
    const auto contains = [](const Response& response, const std::string& text)
    {
        return response.get_body().find(text) != std::string::npos;
    };

    // App values: administrators only.
    NC_CHECK_EQ(call("GET", apps + "/core/x", "").get_status(), 401);
    NC_CHECK_EQ(call("POST", apps + "/core/motd", "bob", "value=hi").get_status(), 403);
    NC_CHECK_EQ(call("GET", apps + "/core/motd", "bob").get_status(), 403);
    NC_CHECK_EQ(call("GET", apps + "/core/motd", "root").get_status(), 404);
    NC_CHECK_EQ(call("POST", apps + "/core/motd", "root", "value=Welcome+here").get_status(), 200);
    NC_CHECK(contains(call("GET", apps + "/core/motd", "root"), "\"data\":\"Welcome here\""));
    NC_CHECK_EQ(
        call("POST", apps + "/core/motd", "root", "value=Changed").get_status(),
        200
    ); // overwrites
    NC_CHECK(contains(call("GET", apps + "/core", "root"), "\"motd\""));
    NC_CHECK_EQ(call("POST", apps + "/bad%20app/k", "root", "value=x").get_status(), 400);
    NC_CHECK_EQ(
        call("POST", apps + "/core/k", "root", "value=" + std::string(70'000, 'x')).get_status(),
        400
    );

    // Other plugins read them through the services.
    NC_CHECK_EQ(
        kernel.get_services().call("settings.get_app", "app=core&key=motd").get_body(),
        "Changed"
    );
    NC_CHECK_EQ(
        kernel.get_services().call("settings.get_app", "app=core&key=none").get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.get_services()
            .call("settings.set_app", "app=theming&key=name&value=My+Cloud")
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.get_services().call("settings.get_app", "app=theming&key=name").get_body(),
        "My Cloud"
    );

    // Preferences: each person has their own.
    NC_CHECK_EQ(call("POST", users + "/files/sort", "bob", "value=name").get_status(), 200);
    NC_CHECK(contains(call("GET", users + "/files/sort", "bob"), "\"data\":\"name\""));
    NC_CHECK_EQ(call("GET", users + "/files/sort", "root").get_status(), 404);
    NC_CHECK_EQ(
        kernel.get_services().call("settings.get_user", "user=bob&app=files&key=sort").get_body(),
        "name"
    );
    NC_CHECK_EQ(call("DELETE", users + "/files/sort", "bob").get_status(), 200);
    NC_CHECK_EQ(call("GET", users + "/files/sort", "bob").get_status(), 404);

    NC_CHECK_EQ(call("POST", users + "/files/sort", "bob", "value=name").get_status(), 200);
    kernel.get_events().publish("user.deleted", "id=bob");
    NC_CHECK_EQ(
        kernel.get_services().call("settings.get_user", "user=bob&app=files&key=sort").get_status(),
        404
    );

    // Values survive a restart.
    kernel.stop();
    nc::Kernel again{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    again.get_logger().set_sink({});
    for (const char* plugin: {"settings", "users", "db"}) {
        NC_CHECK(again
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(again.start().has_value());
    NC_CHECK_EQ(
        again.get_services().call("settings.get_app", "app=core&key=motd").get_body(),
        "Changed"
    );
    again.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
