#include "nextcloud/plugin.h"
#include "nextcloud/runner/http_server.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <mutex>

namespace {

using nc::http::Request;
using nc::http::Response;

/// The receiving side: remembers what it was sent, and answers with a status the test can change.
struct Received
{
    std::mutex mutex{};
    std::vector<std::pair<std::string, std::string>> deliveries{}; // body, signature
    int answer{200};
};

Received g_received;

class ReceiverPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override { return "receiver"; }
    std::string_view get_version() const noexcept override { return "1.0"; }

    void on_load(nc::Host& host) override
    {
        host.add_route("POST", "/hook", [](const Request& request) {
            const std::lock_guard lock{g_received.mutex};
            g_received.deliveries.emplace_back(request.get_body(), std::string{request.header("X-Nextcloud-Signature")});
            return Response::text(g_received.answer, "");
        });
    }
};

} // namespace

int main()
{
    namespace fs = std::filesystem;
    const std::string dir =
        (fs::temp_directory_path() / ("nc-webhook-" + nc::util::random_hex(4))).string();

    nc::Kernel receiver;
    receiver.get_logger().set_sink({});
    NC_CHECK(receiver.add_plugin_api(nc::detail::api_for<ReceiverPlugin>()).has_value());
    NC_CHECK(receiver.start().has_value());
    nc::HttpServer server{receiver};
    const auto port = server.start("127.0.0.1", 0);
    NC_CHECK(port.has_value());
    if (!port) {
        return 1;
    }
    const std::string hook_url = "http://127.0.0.1:" + std::to_string(*port) + "/hook";

    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n"
                          "[webhook_listeners]\nallow_http = true\nallow_local = true\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"webhook_listeners", "users", "db"}) {
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
    const auto call = [&](const std::string& method, const std::string& path, const std::string& user, const std::string& body = {}) {
        Request request{std::string{method}, std::string{path}, "", std::string{body}, "", {}, {}};
        if (!user.empty()) {
            request.add_header("Authorization", "Basic " + nc::util::base64_encode(user + ":" + user + " password"));
        }
        return kernel.handle(std::move(request));
    };
    const std::string base = "/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks";

    // Only an administrator manages webhooks; the input is checked.
    NC_CHECK_EQ(call("POST", base, "", "event=x").get_status(), 401);
    NC_CHECK_EQ(call("POST", base, "bob", "event=share.created&uri=" + hook_url).get_status(), 403);
    NC_CHECK_EQ(call("GET", base, "bob").get_status(), 403);
    NC_CHECK_EQ(call("POST", base, "root", "event=bad%20name&uri=" + hook_url).get_status(), 400);
    NC_CHECK_EQ(call("POST", base, "root", "event=share.created&uri=ftp%3A%2F%2Fx").get_status(), 400);
    const Response created = call("POST", base, "root", "event=share.*&secret=topsecretvalue&uri=" + hook_url);
    NC_CHECK_EQ(created.get_status(), 200);
    NC_CHECK(created.get_body().find("\"secret\":\"topsecretvalue\"") != std::string::npos);
    NC_CHECK(call("GET", base, "root").get_body().find("topsecretvalue") == std::string::npos); // shown once

    // An event is queued and delivered by the job, signed with the secret.
    kernel.get_events().publish("share.created", "owner=alice&path=%2Fa+b.txt");
    kernel.get_events().publish("file.created", "path=%2Fnot-asked-for");
    {
        const std::lock_guard lock{g_received.mutex};
        NC_CHECK(g_received.deliveries.empty()); // nothing is sent inside the request that caused it
    }
    NC_CHECK(kernel.get_jobs().run_due(nc::JobScheduler::Clock::now() + std::chrono::seconds{10}, true) >= 1);
    {
        const std::lock_guard lock{g_received.mutex};
        NC_CHECK_EQ(g_received.deliveries.size(), std::size_t{1});
        if (!g_received.deliveries.empty()) {
            const auto& [body, signature] = g_received.deliveries.front();
            NC_CHECK(body.find("\"event\":\"share.created\"") != std::string::npos);
            NC_CHECK(body.find("\"path\":\"/a b.txt\"") != std::string::npos);
            NC_CHECK_EQ(signature, "sha256=" + nc::util::to_hex(nc::util::hmac_sha256("topsecretvalue", body)));
        }
        g_received.deliveries.clear();
        g_received.answer = 500;
    }

    // A receiver that fails is tried again later, not at once.
    kernel.get_events().publish("share.deleted", "id=3");
    (void)kernel.get_jobs().run_due(nc::JobScheduler::Clock::now() + std::chrono::seconds{10}, true);
    {
        const std::lock_guard lock{g_received.mutex};
        NC_CHECK_EQ(g_received.deliveries.size(), std::size_t{1});
        g_received.answer = 200;
    }
    (void)kernel.get_jobs().run_due(nc::JobScheduler::Clock::now() + std::chrono::seconds{10}, true);
    {
        const std::lock_guard lock{g_received.mutex};
        NC_CHECK_EQ(g_received.deliveries.size(), std::size_t{1}); // the pause has not passed
    }
    // (run_due only asks the job to run; the queue holds the item until its own time)
    const auto rows = kernel.get_services().call("db.query", "sql=SELECT+attempts+FROM+nc_webhook_queue");
    NC_CHECK(rows.get_body().find("attempts=1") != std::string::npos);

    // A removed webhook stops and its queue goes with it.
    NC_CHECK_EQ(call("DELETE", base + "/1", "root").get_status(), 200);
    NC_CHECK_EQ(call("DELETE", base + "/1", "root").get_status(), 404);
    NC_CHECK(kernel.get_services().call("db.query", "sql=SELECT+id+FROM+nc_webhook_queue").get_body().empty());
    kernel.stop();
    server.stop();
    receiver.stop();
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
