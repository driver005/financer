#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <chrono>
#include <cstdlib>
#include <filesystem>

namespace {

using nc::http::Request;

Request
req(std::string method,
    std::string path,
    std::string body,
    const std::string& credentials,
    const std::string& otp = {})
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
    if (!otp.empty()) {
        request.add_header("X-NC-OTP", std::string{otp});
    }
    return request;
}

std::string between(const std::string& text, const std::string& begin, const std::string& end)
{
    const std::size_t start = text.find(begin) + begin.size();
    return text.substr(start, text.find(end, start) - start);
}

} // namespace

int main()
{
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-2fa-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"twofactor", "tokens", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{4});
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string alice = "alice:alice password";
    const std::string who = "/ocs/v2.php/cloud/user";

    // ---- app passwords
    // ----------------------------------------------------------------------------
    const std::string issued =
        kernel.handle(req("GET", "/ocs/v2.php/core/getapppassword", "", alice)).get_body();
    const std::string token = between(issued, "\"apppassword\":\"", "\"");
    NC_CHECK_EQ(token.size(), std::size_t{29}); // 5 x 5 characters and 4 dashes
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", "alice:" + token)).get_status(), 200);
    NC_CHECK_EQ(
        kernel.handle(req("GET", who, "", "bob:" + token)).get_status(),
        401
    ); // not another user's
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", "alice:" + token + "x")).get_status(), 401);
    NC_CHECK_EQ(
        kernel.handle(req("GET", "/ocs/v2.php/cloud/apppasswords", "", alice))
            .get_body()
            .find(token),
        std::string::npos
    ); // never listed again
    NC_CHECK(
        kernel.handle(req("GET", "/ocs/v2.php/cloud/apppasswords", "", alice))
            .get_body()
            .find("\"id\":1") != std::string::npos
    );
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", "/ocs/v2.php/cloud/apppasswords/1", "", "bob:bob password"))
            .get_status(),
        404
    ); // not bob's
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", "/ocs/v2.php/cloud/apppasswords/1", "", alice)).get_status(),
        200
    );
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", "alice:" + token)).get_status(), 401); // revoked
    NC_CHECK_EQ(kernel.run_command("token:create", {"alice", "cli"}, out), 0);
    const std::string cli_token = out.substr(0, out.size() - 1);
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", "alice:" + cli_token)).get_status(), 200);

    // ---- TOTP
    // -------------------------------------------------------------------------------------
    const std::string base = "/ocs/v2.php/apps/twofactor/api/v1/totp";
    NC_CHECK_EQ(kernel.handle(Request{"POST", std::string{base}}).get_status(), 401);
    const std::string started = kernel.handle(req("POST", base, "", alice)).get_body();
    const std::string secret_text = between(started, "\"secret\":\"", "\"");
    NC_CHECK(
        started.find("otpauth://totp/Nextcloud:alice?secret=" + secret_text) != std::string::npos
    );
    const std::string secret = nc::util::base32_decode(secret_text).value();
    const auto step = []()
    {
        return static_cast<std::uint64_t>(
            std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::system_clock::now().time_since_epoch()
            )
                .count() /
            30
        );
    };

    // Not on yet: signing in still works without a code, and a wrong code does not turn it on.
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", alice)).get_status(), 200);
    NC_CHECK_EQ(
        kernel.handle(req("POST", base + "/verify", "code=000000", alice)).get_status() == 400 ||
            nc::util::hotp(secret, step()) == "000000",
        true
    );
    const auto verified =
        kernel.handle(req("POST", base + "/verify", "code=" + nc::util::hotp(secret, step()), alice)
        );
    NC_CHECK_EQ(verified.get_status(), 200);
    const std::string backup = between(verified.get_body(), "\"backup_codes\":[\"", "\"");
    NC_CHECK_EQ(backup.size(), std::size_t{10});
    NC_CHECK_EQ(kernel.run_command("twofactor:state", {"alice"}, out), 0);
    NC_CHECK_EQ(out, "enabled\n");

    // On: the password alone is no longer enough, and the client is told why.
    const auto challenge = kernel.handle(req("GET", who, "", alice));
    NC_CHECK_EQ(challenge.get_status(), 401);
    NC_CHECK_EQ(std::string(challenge.header("X-NC-Two-Factor")), "required");
    NC_CHECK_EQ(
        kernel.handle(req("GET", who, "", alice, "123456")).get_status() == 401 ||
            nc::util::hotp(secret, step() + 1) == "123456",
        true
    );
    // The code that turned it on is used up; the next one (allowed by the clock window) works once.
    NC_CHECK_EQ(
        kernel.handle(req("GET", who, "", alice, nc::util::hotp(secret, step()))).get_status(),
        401
    );
    const std::string next = nc::util::hotp(secret, step() + 1);
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", alice, next)).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", alice, next)).get_status(), 401); // replay
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", "alice:wrong", next)).get_status(), 401);
    // A backup code works once.
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", alice, backup)).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", alice, backup)).get_status(), 401);
    // App passwords and other accounts are not affected.
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", "alice:" + cli_token)).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", "bob:bob password")).get_status(), 200);
    NC_CHECK(
        kernel.handle(req("GET", base, "", "alice:" + cli_token))
            .get_body()
            .find("\"enabled\":true,\"backup_codes_left\":9") != std::string::npos
    );

    // Turning it off (lost device).
    NC_CHECK_EQ(kernel.run_command("twofactor:disable", {"alice"}, out), 0);
    NC_CHECK_EQ(kernel.handle(req("GET", who, "", alice)).get_status(), 200);

    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
