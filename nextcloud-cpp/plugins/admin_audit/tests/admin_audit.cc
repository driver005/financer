#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace {

using nc::http::Request;
using nc::http::Response;

std::string slurp(const std::string& file)
{
    std::ifstream stream{file};
    std::ostringstream text;
    text << stream.rdbuf();
    return text.str();
}

} // namespace

int main()
{
    namespace fs = std::filesystem;
    const std::string dir =
        (fs::temp_directory_path() / ("nc-audit-" + nc::util::random_hex(4))).string();
    const std::string log = dir + "/audit.log";
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"admin_audit", "cloud", "groups", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    NC_CHECK_EQ(kernel.run_command("group:add", {"staff"}, out), 0);

    const auto call = [&](const std::string& method,
                          const std::string& path,
                          const std::string& body = {},
                          const std::string& credentials = "alice:alice password")
    {
        Request request{std::string{method}, std::string{path}};
        request.set_body(std::string{body});
        request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
        return kernel.handle(std::move(request));
    };
    const std::string files = "/remote.php/dav/files/alice";

    // A failed sign-in is logged with the name, never with the password.
    NC_CHECK_EQ(call("GET", files + "/", {}, "alice:guess-123456").get_status(), 401);
    NC_CHECK_EQ(call("GET", files + "/", {}, "mallory:hunter2-hunter2").get_status(), 401);
    // Files.
    NC_CHECK_EQ(call("PUT", files + "/a.txt", "one").get_status(), 201);
    NC_CHECK_EQ(call("PUT", files + "/a.txt", "two").get_status(), 204);
    Request moved{"MOVE", files + "/a.txt"};
    moved.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:alice password"));
    moved.add_header("Destination", files + "/b.txt");
    NC_CHECK_EQ(kernel.handle(std::move(moved)).get_status(), 201);
    Request copied{"COPY", files + "/b.txt"};
    copied.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:alice password"));
    copied.add_header("Destination", files + "/c.txt");
    NC_CHECK_EQ(kernel.handle(std::move(copied)).get_status(), 201);
    NC_CHECK_EQ(call("DELETE", files + "/b.txt").get_status(), 204);
    // A share.
    NC_CHECK_EQ(
        call("POST", "/ocs/v2.php/apps/files_sharing/api/v1/shares", "path=/c.txt&shareType=3")
            .get_status(),
        200
    );
    // An account and a group go away.
    NC_CHECK_EQ(kernel.run_command("group:delete", {"staff"}, out), 0);
    NC_CHECK_EQ(kernel.run_command("user:delete", {"alice"}, out), 0);
    kernel.stop();

    const std::string text = slurp(log);
    const auto has = [&](const std::string& piece)
    {
        const bool found = text.find(piece) != std::string::npos;
        if (!found) {
            std::fprintf(stderr, "missing in the audit log: %s\n", piece.c_str());
        }
        return found;
    };
    NC_CHECK(has("Login failed: \\\"alice\\\" (password)"));
    NC_CHECK(has("Login failed: \\\"mallory\\\" (password)"));
    NC_CHECK(has("Account created: \\\"alice\\\""));
    NC_CHECK(has("Group created: \\\"staff\\\""));
    NC_CHECK(has("File created: \\\"/a.txt\\\""));
    NC_CHECK(has("File written to: \\\"/a.txt\\\""));
    NC_CHECK(has("File renamed: \\\"/a.txt\\\" to \\\"/b.txt\\\""));
    NC_CHECK(has("File copied: \\\"/b.txt\\\" to \\\"/c.txt\\\""));
    NC_CHECK(has("File deleted: \\\"/b.txt\\\""));
    NC_CHECK(has("Share created: \\\"/c.txt\\\" (link share"));
    NC_CHECK(has("Group deleted: \\\"staff\\\""));
    NC_CHECK(has("Account deleted: \\\"alice\\\""));
    // No password anywhere.
    NC_CHECK(text.find("guess-123456") == std::string::npos);
    NC_CHECK(text.find("hunter2") == std::string::npos);
    NC_CHECK(text.find("alice password") == std::string::npos);
    // Every line is a JSON object with the fields of Nextcloud's log line, and names the person.
    std::istringstream lines{text};
    std::string line;
    int count = 0;
    bool wrote_for_alice = false;
    while (std::getline(lines, line)) {
        ++count;
        const auto json = nc::util::Json::parse(line);
        NC_CHECK(json.has_value());
        if (!json) {
            continue;
        }
        NC_CHECK_EQ((*json)["app"].string(), "admin_audit");
        NC_CHECK(!(*json)["time"].string().empty());
        NC_CHECK(!(*json)["message"].string().empty());
        NC_CHECK(!(*json)["user"].string().empty());
        wrote_for_alice = wrote_for_alice || ((*json)["user"].string() == "alice" &&
                                              (*json)["message"].string().rfind("File ", 0) == 0);
    }
    NC_CHECK(count >= 12);
    NC_CHECK(wrote_for_alice);
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
