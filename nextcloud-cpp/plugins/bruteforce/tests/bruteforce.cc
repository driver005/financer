#include "nextcloud/runner/http_server.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <thread>

namespace {

using nc::http::Request;
using nc::http::Response;

void sleep_ms(int milliseconds)
{
    std::this_thread::sleep_for(std::chrono::milliseconds{milliseconds});
}

std::string curl(const std::string& command)
{
    std::string text;
    if (FILE* pipe = popen(command.c_str(), "r")) {
        char buffer[512];
        while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
            text += buffer;
        }
        pclose(pipe);
    }
    return text;
}

void test_remote_addresses()
{
    const std::vector<std::string> proxies{"10.0.0.1", "10.0.0.2"};
    // No trusted proxy in front: the header is not believed, the peer is the client.
    NC_CHECK_EQ(nc::resolve_remote("203.0.113.9", "1.2.3.4", {}), "203.0.113.9");
    NC_CHECK_EQ(nc::resolve_remote("203.0.113.9", "1.2.3.4", proxies), "203.0.113.9");
    // A trusted proxy: the address it saw; what the client put in front of it does not count.
    NC_CHECK_EQ(nc::resolve_remote("10.0.0.1", "198.51.100.7", proxies), "198.51.100.7");
    NC_CHECK_EQ(nc::resolve_remote("10.0.0.1", "6.6.6.6, 198.51.100.7", proxies), "198.51.100.7");
    NC_CHECK_EQ(nc::resolve_remote("10.0.0.1", "198.51.100.7, 10.0.0.2", proxies), "198.51.100.7");
    NC_CHECK_EQ(nc::resolve_remote("10.0.0.1", "", proxies), "10.0.0.1");
    NC_CHECK_EQ(nc::resolve_remote("10.0.0.1", "not an address, <script>", proxies), "10.0.0.1");
    NC_CHECK_EQ(nc::resolve_remote("10.0.0.1", "10.0.0.2", proxies), "10.0.0.2");
    NC_CHECK_EQ(nc::resolve_remote("::1", "2001:db8::7", {"::1"}), "2001:db8::7");
    // A header from the wire never survives; the connection's address is what the kernel sees.
    nc::RequestHead head;
    head.method = "GET";
    head.target = "/";
    head.headers = {{"X-NC-Remote-Addr", "1.2.3.4"}, {"x-nc-remote-addr", "5.6.7.8"}, {"A", "b"}};
    const Request request = nc::request_from_head(head, {}, "203.0.113.9");
    NC_CHECK_EQ(request.header("X-NC-Remote-Addr"), "203.0.113.9");
    NC_CHECK_EQ(request.header("A"), "b");
    NC_CHECK_EQ(nc::request_from_head(head, {}).header("X-NC-Remote-Addr"), "");
}

} // namespace

int main()
{
    namespace fs = std::filesystem;
    test_remote_addresses();

    const std::string dir =
        (fs::temp_directory_path() / ("nc-brute-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[bruteforce]\nmax_attempts = 3\n"
                          "window_seconds = 3\nwhitelist = 192.168.1.5, 10.0.0.0/8\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"bruteforce", "tokens", "users", "db"}) {
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
    const std::string path = "/ocs/v2.php/cloud/apppasswords";
    const auto attempt =
        [&](const std::string& address, const std::string& user, const std::string& password)
    {
        Request request{std::string{"GET"}, std::string{path}};
        request.add_header(
            "Authorization",
            "Basic " + nc::util::base64_encode(user + ":" + password)
        );
        if (!address.empty()) {
            request.add_header("X-NC-Remote-Addr", std::string{address});
        }
        return kernel.handle(std::move(request));
    };
    const auto good = [&](const std::string& address, const std::string& user)
    {
        return attempt(address, user, user + " password").get_status();
    };

    // Below the limit: wrong passwords are just refused, and a right one is let in.
    NC_CHECK_EQ(attempt("203.0.113.1", "alice", "guess 1").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.1", "alice", "guess 2").get_status(), 401);
    NC_CHECK_EQ(good("203.0.113.1", "alice"), 200);
    // The third wrong one reaches the limit: now the address waits, even with the right password.
    NC_CHECK_EQ(attempt("203.0.113.2", "alice", "guess 1").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.2", "alice", "guess 2").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.2", "alice", "guess 3").get_status(), 401);
    const Response held = attempt("203.0.113.2", "alice", "alice password");
    NC_CHECK_EQ(held.get_status(), 429);
    NC_CHECK(std::atoi(std::string{held.header("Retry-After")}.c_str()) >= 1);
    NC_CHECK_EQ(good("203.0.113.2", "bob"), 429);
    // Other addresses, and requests without credentials, are not affected.
    NC_CHECK_EQ(good("203.0.113.3", "alice"), 200);
    NC_CHECK_EQ(attempt("203.0.113.2", "", "").get_status() >= 400 ? 1 : 0, 1);
    {
        Request anonymous{std::string{"GET"}, std::string{"/status.php"}};
        anonymous.add_header("X-NC-Remote-Addr", "203.0.113.2");
        NC_CHECK(kernel.handle(std::move(anonymous)).get_status() != 429);
    }
    // After the wait (a quarter of a second for the first failure over the limit) the right
    // password works again, and clears the guesses at that account.
    sleep_ms(400);
    NC_CHECK_EQ(good("203.0.113.2", "alice"), 200);
    NC_CHECK_EQ(attempt("203.0.113.2", "alice", "guess 4").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.2", "alice", "guess 5").get_status(), 401);

    // The wait doubles with every failure over the limit: three failures again, then a fourth
    // costs half a second.
    NC_CHECK_EQ(attempt("203.0.113.4", "alice", "x").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.4", "alice", "x").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.4", "alice", "x").get_status(), 401);
    sleep_ms(400);
    NC_CHECK_EQ(attempt("203.0.113.4", "alice", "x").get_status(), 401); // 4th failure: 0.5 s
    sleep_ms(300);
    NC_CHECK_EQ(good("203.0.113.4", "alice"), 429);
    sleep_ms(400);
    NC_CHECK_EQ(good("203.0.113.4", "alice"), 200);

    // A good password clears the guesses at that account only: signing in as bob does not undo
    // the two wrong guesses at alice.
    NC_CHECK_EQ(attempt("203.0.113.5", "alice", "x").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.5", "alice", "x").get_status(), 401);
    NC_CHECK_EQ(good("203.0.113.5", "bob"), 200);
    NC_CHECK_EQ(
        attempt("203.0.113.5", "alice", "x").get_status(),
        401
    ); // the third: over the limit
    NC_CHECK_EQ(good("203.0.113.5", "bob"), 429);
    // Guesses at different accounts add up for the address.
    NC_CHECK_EQ(attempt("203.0.113.6", "alice", "x").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.6", "bob", "x").get_status(), 401);
    NC_CHECK_EQ(attempt("203.0.113.6", "nobody", "x").get_status(), 401);
    NC_CHECK_EQ(good("203.0.113.6", "alice"), 429);

    // Whitelisted addresses (exact and in a range) are never held.
    for (int index = 0; index < 8; ++index) {
        NC_CHECK_EQ(attempt("192.168.1.5", "alice", "x").get_status(), 401);
        NC_CHECK_EQ(attempt("10.20.30.40", "alice", "x").get_status(), 401);
    }
    NC_CHECK_EQ(good("192.168.1.5", "alice"), 200);
    NC_CHECK_EQ(good("10.20.30.40", "alice"), 200);
    NC_CHECK_EQ(good("192.168.1.6", "alice"), 200); // next to the whitelisted one, not in it
    // No address (a command line call, a test) is not throttled.
    for (int index = 0; index < 5; ++index) {
        NC_CHECK_EQ(attempt("", "alice", "x").get_status(), 401);
    }
    NC_CHECK_EQ(good("", "alice"), 200);

    // The window: old failures are forgotten (the window is three seconds here).
    NC_CHECK_EQ(good("203.0.113.6", "alice"), 429);
    sleep_ms(3'200);
    NC_CHECK_EQ(good("203.0.113.6", "alice"), 200);

    // A second factor that is missing counts as a failure too.
    // (No twofactor plugin here; the password check is what is counted.)

    // Through the real server: the client cannot pick its own address (not by the header the
    // kernel trusts, not by X-Forwarded-For), so a whitelisted address cannot be claimed.
    nc::HttpServer server{kernel};
    const auto port = server.start("127.0.0.1", 0);
    NC_CHECK(port.has_value());
    if (port) {
        const std::string base = "http://127.0.0.1:" + std::to_string(*port) + path;
        const auto status = [&](const std::string& password, const std::string& extra)
        {
            const std::string text = curl(
                "curl -s -o /dev/null -w '%{http_code}' --max-time 10 " + extra +
                " -u 'alice:" + password + "' " + base
            );
            return std::atoi(text.c_str());
        };
        const std::string spoof = "-H 'X-NC-Remote-Addr: 10.1.1.1' -H 'X-Forwarded-For: 10.2.2.2'";
        NC_CHECK_EQ(status("nope 1", spoof), 401);
        NC_CHECK_EQ(status("nope 2", spoof), 401);
        NC_CHECK_EQ(status("nope 3", spoof), 401);
        NC_CHECK_EQ(status("alice password", spoof), 429);
        NC_CHECK_EQ(status("alice password", ""), 429); // the same real address (127.0.0.1)
        sleep_ms(400);
        NC_CHECK_EQ(status("alice password", ""), 200);
        server.stop();
    }
    kernel.stop();
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
