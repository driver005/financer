#include "color.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

int main()
{
    using nc::http::Request;
    using nc::http::Response;
    using nc::theming::parse_hex_color;

    NC_CHECK(parse_hex_color("#00679e").has_value());
    NC_CHECK_EQ(parse_hex_color("#fff")->red, 255);
    NC_CHECK(!parse_hex_color("00679e"));
    NC_CHECK(!parse_hex_color("#00679"));
    NC_CHECK(!parse_hex_color("#00679g"));
    NC_CHECK(!parse_hex_color("#00679e;x"));
    NC_CHECK_EQ(nc::theming::readable_text_color(*parse_hex_color("#ffffff")), "#000000");
    NC_CHECK_EQ(nc::theming::readable_text_color(*parse_hex_color("#000000")), "#ffffff");
    NC_CHECK_EQ(nc::theming::readable_text_color(*parse_hex_color("#00679e")), "#ffffff");
    NC_CHECK_EQ(nc::theming::readable_text_color(*parse_hex_color("#ffd800")), "#000000");
    NC_CHECK_EQ(nc::theming::to_hex(nc::theming::mix({0, 0, 0}, {255, 255, 255}, 0.5)), "#808080");

    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-theming-" + nc::util::random_hex(4)))
            .string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"theming", "settings", "users", "db"}) {
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
                          const std::string& body = {},
                          const std::string& if_none_match = {})
    {
        Request request{std::string{method}, std::string{path}, "", std::string{body}, "", {}, {}};
        if (!user.empty()) {
            request.add_header(
                "Authorization",
                "Basic " + nc::util::base64_encode(user + ":" + user + " password")
            );
        }
        if (!if_none_match.empty()) {
            request.add_header("If-None-Match", std::string{if_none_match});
        }
        return kernel.handle(std::move(request));
    };
    const auto contains = [](const Response& response, const std::string& text)
    {
        return response.get_body().find(text) != std::string::npos;
    };
    const std::string config = "/ocs/v2.php/apps/theming/api/v1/config";

    // Defaults, visible to everyone (also in the capabilities).
    NC_CHECK(contains(call("GET", config, ""), "\"name\":\"Nextcloud\""));
    NC_CHECK(contains(
        call("GET", "/ocs/v2.php/cloud/capabilities", ""),
        "\"theming\":{\"name\":\"Nextcloud\""
    ));

    // Only an administrator changes it, and the values are checked.
    NC_CHECK_EQ(call("PUT", config, "", "name=x").get_status(), 401);
    NC_CHECK_EQ(call("PUT", config, "bob", "name=x").get_status(), 403);
    NC_CHECK_EQ(call("PUT", config, "root", "color=red").get_status(), 400);
    NC_CHECK_EQ(call("PUT", config, "root", "color=%23ff0000%3B%7D").get_status(), 400);
    NC_CHECK_EQ(call("PUT", config, "root", "url=javascript%3Aalert(1)").get_status(), 400);
    NC_CHECK_EQ(call("PUT", config, "root", "name=" + std::string(51, 'x')).get_status(), 400);
    NC_CHECK_EQ(call("PUT", config, "root", "name=a%0Ab").get_status(), 400);
    NC_CHECK_EQ(call("PUT", config, "root", "logo=x").get_status(), 400);
    const Response changed =
        call("PUT", config, "root", "name=My+Cloud&color=%23ffd800&url=https%3A%2F%2Fexample.org");
    NC_CHECK_EQ(changed.get_status(), 200);
    NC_CHECK(contains(changed, "\"name\":\"My Cloud\""));
    NC_CHECK(contains(changed, "\"color-text\":\"#000000\""));
    NC_CHECK(contains(call("GET", "/ocs/v2.php/cloud/capabilities", ""), "\"name\":\"My Cloud\""));

    // The style sheet carries the colour, cached by content.
    const Response css = call("GET", "/index.php/apps/theming/theme/default.css", "");
    NC_CHECK_EQ(css.get_status(), 200);
    NC_CHECK(css.get_content_type().find("text/css") == 0);
    NC_CHECK(contains(css, "--color-primary: #ffd800;"));
    NC_CHECK(contains(css, "--color-primary-text: #000000;"));
    NC_CHECK_EQ(
        call(
            "GET",
            "/index.php/apps/theming/theme/default.css",
            "",
            "",
            std::string{css.header("ETag")}
        )
            .get_status(),
        304
    );
    NC_CHECK(contains(
        call("GET", "/index.php/apps/theming/theme/dark.css", ""),
        "--color-main-background: #171717;"
    ));

    // A dark colour is lifted on the dark theme; an empty value resets one setting.
    NC_CHECK_EQ(call("PUT", config, "root", "color=%23101010").get_status(), 200);
    NC_CHECK(contains(
        call("GET", "/index.php/apps/theming/theme/default.css", ""),
        "--color-primary: #101010;"
    ));
    NC_CHECK(!contains(
        call("GET", "/index.php/apps/theming/theme/dark.css", ""),
        "--color-primary: #101010;"
    ));
    NC_CHECK_EQ(call("PUT", config, "root", "name=").get_status(), 200);
    NC_CHECK(contains(call("GET", config, ""), "\"name\":\"Nextcloud\""));
    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
