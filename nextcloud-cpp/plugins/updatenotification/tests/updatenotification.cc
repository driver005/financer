#include "nextcloud/plugin.h"
#include "nextcloud/runner/http_server.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "version.h"

#include <cstdlib>
#include <filesystem>
#include <mutex>

namespace {

using nc::http::Request;
using nc::http::Response;

std::mutex g_mutex;
std::string g_document = R"({"version":"36.0.0.1","url":"https://example.org/r"})";
int g_status = 200;

class UpdateServerPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "updateserver";
    }

    std::string_view get_version() const noexcept override
    {
        return "1.0";
    }

    void on_load(nc::Host& host) override
    {
        host.add_route(
            "GET",
            "/latest",
            [](const Request&)
            {
                const std::lock_guard lock{g_mutex};
                return Response::json(g_status, g_document);
            }
        );
    }
};

void set_answer(std::string document, int status = 200)
{
    const std::lock_guard lock{g_mutex};
    g_document = std::move(document);
    g_status = status;
}

} // namespace

int main()
{
    using nc::update::is_newer;
    using nc::update::parse_version;
    NC_CHECK(is_newer("36.0.1", "36.0.0.1"));
    NC_CHECK(is_newer("37", "36.9.9"));
    NC_CHECK(is_newer("36.0.0.2", "36.0.0.1"));
    NC_CHECK(!is_newer("36.0.0.1", "36.0.0.1"));
    NC_CHECK(!is_newer("36.0", "36.0.0.1"));
    NC_CHECK(!is_newer("35.9.9", "36.0.0.1"));
    NC_CHECK(!is_newer("36.0.1-beta", "36.0.0.1")); // not a plain version: ignored
    NC_CHECK(!parse_version("").has_value());
    NC_CHECK(!parse_version("1..2").has_value());
    NC_CHECK(!parse_version(".1").has_value());
    NC_CHECK(!parse_version("1.2.3.4.5").has_value());
    NC_CHECK(!parse_version("1234567.1").has_value());

    namespace fs = std::filesystem;
    nc::Kernel remote;
    remote.get_logger().set_sink({});
    NC_CHECK(remote.add_plugin_api(nc::detail::api_for<UpdateServerPlugin>()).has_value());
    NC_CHECK(remote.start().has_value());
    nc::HttpServer server{remote};
    const auto port = server.start("127.0.0.1", 0);
    NC_CHECK(port.has_value());
    if (!port) {
        return 1;
    }
    const std::string dir =
        (fs::temp_directory_path() / ("nc-update-" + nc::util::random_hex(4))).string();
    const auto boot = [&](const std::string& extra)
    {
        auto kernel = std::make_unique<nc::Kernel>(
            nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n" + extra)
                .value()
        );
        kernel->get_logger().set_sink({});
        for (const char* plugin: {"updatenotification", "notifications", "users", "db"}) {
            NC_CHECK(
                kernel
                    ->add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                    .has_value()
            );
        }
        NC_CHECK(kernel->start().has_value());
        return kernel;
    };

    // Without an address nothing is requested.
    {
        auto kernel = boot("");
        std::string out;
        NC_CHECK_EQ(kernel->run_command("update:check", {}, out), 0);
        NC_CHECK(out.find("no update address") != std::string::npos);
        kernel->stop();
    }

    auto kernel = boot(
        "[updatenotification]\nurl = http://127.0.0.1:" + std::to_string(*port) +
        "/latest\nallow_http = true\nallow_local = true\n"
    );
    std::string out;
    ::setenv("OC_PASS", "root password", 1);
    NC_CHECK_EQ(kernel->run_command("user:add", {"root", "--admin"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel->run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    const auto call = [&](const std::string& path, const std::string& user)
    {
        Request request{"GET", std::string{path}};
        request.add_header(
            "Authorization",
            "Basic " + nc::util::base64_encode(user + ":" + user + " password")
        );
        return kernel->handle(std::move(request));
    };
    const std::string notifications = "/ocs/v2.php/apps/notifications/api/v2/notifications";
    const auto has = [](const Response& response, const std::string& text)
    {
        return response.get_body().find(text) != std::string::npos;
    };

    // The running version is the newest: nothing to tell.
    NC_CHECK_EQ(kernel->run_command("update:check", {}, out), 0);
    NC_CHECK(out.find("up to date") != std::string::npos);
    NC_CHECK(!has(call(notifications, "root"), "is available"));

    // A newer one: administrators are told once, others never.
    set_answer(R"({"version":"36.0.1","url":"https://example.org/36.0.1"})");
    out.clear();
    NC_CHECK_EQ(kernel->run_command("update:check", {}, out), 0);
    NC_CHECK(out.find("version 36.0.1 is available") != std::string::npos);
    NC_CHECK(has(call(notifications, "root"), "Version 36.0.1 is available"));
    NC_CHECK(has(call(notifications, "root"), "https://example.org/36.0.1"));
    NC_CHECK(!has(call(notifications, "bob"), "is available"));
    out.clear();
    NC_CHECK_EQ(kernel->run_command("update:check", {}, out), 0);
    NC_CHECK(out.find("told before") != std::string::npos);
    const std::string once = call(notifications, "root").get_body();
    NC_CHECK_EQ(once.find("is available"), once.rfind("is available"));

    // What the server says is checked; a failing server is an error, not a notification.
    set_answer(R"j({"version":"99.0.0-evil","url":"javascript:alert(1)"})j");
    NC_CHECK_EQ(kernel->run_command("update:check", {}, out), 1);
    set_answer("not json");
    NC_CHECK_EQ(kernel->run_command("update:check", {}, out), 1);
    set_answer("{}", 500);
    NC_CHECK_EQ(kernel->run_command("update:check", {}, out), 1);
    set_answer(R"j({"version":"36.0.2","url":"javascript:alert(1)"})j");
    NC_CHECK_EQ(kernel->run_command("update:check", {}, out), 0);
    NC_CHECK(!has(call(notifications, "root"), "javascript"));

    // Administrators see the newest known version, others are refused.
    const Response applist = call("/ocs/v2.php/apps/updatenotification/api/v1/applist", "root");
    NC_CHECK(has(applist, "\"available\":\"36.0.2\""));
    NC_CHECK(has(applist, "\"installed\":\"36.0.0.1\""));
    NC_CHECK_EQ(
        call("/ocs/v2.php/apps/updatenotification/api/v1/applist", "bob").get_status(),
        403
    );
    kernel->stop();
    server.stop();
    remote.stop();
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
