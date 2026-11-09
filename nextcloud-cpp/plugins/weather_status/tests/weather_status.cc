#include "nextcloud/plugin.h"
#include "nextcloud/runner/http_server.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <atomic>
#include <cstdlib>
#include <filesystem>
#include <mutex>

namespace {

using nc::http::Request;
using nc::http::Response;

std::atomic<int> g_requests{0};
std::mutex g_mutex;
std::string g_query;
std::string g_answer =
    R"({"hourly":{"time":["2026-11-09T08:00","2026-11-09T09:00"],"temperature_2m":[7.5,9.25],"weathercode":[3,61]}})";

class WeatherServerPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "weatherserver";
    }

    std::string_view get_version() const noexcept override
    {
        return "1.0";
    }

    void on_load(nc::Host& host) override
    {
        host.add_route(
            "GET",
            "/forecast",
            [](const Request& request)
            {
                ++g_requests;
                const std::lock_guard lock{g_mutex};
                g_query = std::string{request.get_query()};
                return Response::json(200, g_answer);
            }
        );
    }
};

} // namespace

int main()
{
    namespace fs = std::filesystem;
    nc::Kernel remote;
    remote.get_logger().set_sink({});
    NC_CHECK(remote.add_plugin_api(nc::detail::api_for<WeatherServerPlugin>()).has_value());
    NC_CHECK(remote.start().has_value());
    nc::HttpServer server{remote};
    const auto port = server.start("127.0.0.1", 0);
    NC_CHECK(port.has_value());
    if (!port) {
        return 1;
    }
    const std::string dir =
        (fs::temp_directory_path() / ("nc-weather-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse(
            "data_dir = " + dir +
            "\n[users]\npbkdf2_iterations = 3\n[weather_status]\nurl = http://127.0.0.1:" +
            std::to_string(*port) + "/forecast\nallow_http = true\nallow_local = true\n"
        )
            .value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"weather_status", "users", "db"}) {
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
            request.add_header(
                "Authorization",
                "Basic " + nc::util::base64_encode(user + ":" + user + " password")
            );
        }
        return kernel.handle(std::move(request));
    };
    const auto contains = [](const Response& response, const std::string& text)
    {
        return response.get_body().find(text) != std::string::npos;
    };
    const std::string base = "/ocs/v2.php/apps/weather_status/api/v1";

    NC_CHECK_EQ(call("GET", base + "/forecast", "").get_status(), 401);
    NC_CHECK_EQ(call("GET", base + "/forecast", "alice").get_status(), 404); // no location yet
    for (const char* bad:
         {"lat=91&lon=0",
          "lat=0&lon=181",
          "lat=abc&lon=1",
          "lat=&lon=1",
          "lat=nan&lon=1",
          "lat=1&lon=1&address=a%0Ab"}) {
        NC_CHECK_EQ(call("PUT", base + "/location", "alice", bad).get_status(), 400);
    }
    NC_CHECK_EQ(
        call("PUT", base + "/location", "alice", "lat=52.52&lon=13.405&address=Berlin")
            .get_status(),
        200
    );
    NC_CHECK(contains(call("GET", base + "/location", "alice"), "\"address\":\"Berlin\""));
    NC_CHECK_EQ(call("GET", base + "/location", "bob").get_status(), 404); // everyone has their own

    // The forecast is fetched with the stored position and kept for an hour.
    const Response forecast = call("GET", base + "/forecast", "alice");
    NC_CHECK_EQ(forecast.get_status(), 200);
    NC_CHECK(contains(forecast, "\"temperature\":7.5000"));
    NC_CHECK(contains(forecast, "\"weathercode\":61"));
    {
        const std::lock_guard lock{g_mutex};
        NC_CHECK(g_query.find("latitude=52.5200") != std::string::npos);
        NC_CHECK(g_query.find("longitude=13.4050") != std::string::npos);
    }
    NC_CHECK_EQ(call("GET", base + "/forecast", "alice").get_status(), 200);
    NC_CHECK_EQ(g_requests.load(), 1);
    // Another place is another request.
    NC_CHECK_EQ(call("PUT", base + "/location", "bob", "lat=48.14&lon=11.58").get_status(), 200);
    NC_CHECK_EQ(call("GET", base + "/forecast", "bob").get_status(), 200);
    NC_CHECK_EQ(g_requests.load(), 2);

    // An answer that is not what was asked for is an error, not data.
    {
        const std::lock_guard lock{g_mutex};
        g_answer = R"({"hourly":{"time":["a"],"temperature_2m":[]}})";
    }
    NC_CHECK_EQ(call("PUT", base + "/location", "bob", "lat=1&lon=2").get_status(), 200);
    NC_CHECK_EQ(call("GET", base + "/forecast", "bob").get_status(), 502);

    NC_CHECK_EQ(call("DELETE", base + "/location", "alice").get_status(), 200);
    NC_CHECK_EQ(call("GET", base + "/location", "alice").get_status(), 404);
    kernel.stop();
    server.stop();
    remote.stop();
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
