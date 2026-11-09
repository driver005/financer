#include "glob.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

int main()
{
    using nc::http::Request;
    using nc::http::Response;
    using nc::workflow::glob_matches;

    NC_CHECK(glob_matches("*.pdf", "/Invoices/2024/a.pdf"));
    NC_CHECK(!glob_matches("*.pdf", "/a.pdf.txt"));
    NC_CHECK(glob_matches("/Docs/*", "/Docs/x/y"));
    NC_CHECK(glob_matches("/a?c", "/abc"));
    NC_CHECK(!glob_matches("/a?c", "/ac"));
    NC_CHECK(glob_matches("", ""));
    NC_CHECK(!glob_matches("", "x"));
    NC_CHECK(glob_matches("**a*", "bba"));
    NC_CHECK(!glob_matches("a*b", "acd"));
    // Many stars on a long text must not blow up.
    NC_CHECK(!glob_matches("*a*a*a*a*a*a*a*a*a*a*b", std::string(5'000, 'a')));

    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-flow-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin:
         {"workflowengine", "cloud", "systemtags", "notifications", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "root password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"root", "--admin"}, out), 0);
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    const auto call = [&](const std::string& method,
                          const std::string& path,
                          const std::string& user,
                          const std::string& body = {})
    {
        const std::size_t question = path.find('?');
        Request request{
            std::string{method},
            path.substr(0, question),
            question == std::string::npos ? std::string{} : path.substr(question + 1),
            std::string{body},
            "",
            {},
            {}
        };
        if (!user.empty()) {
            request.add_header(
                "Authorization",
                "Basic " + nc::util::base64_encode(user + ":" + user + " password")
            );
        }
        return kernel.handle(std::move(request));
    };
    const std::string flows = "/ocs/v2.php/apps/workflowengine/api/v1/flows";
    const auto contains = [](const Response& response, const std::string& text)
    {
        return response.get_body().find(text) != std::string::npos;
    };

    NC_CHECK_EQ(
        call("POST", flows, "alice", "name=x&event=file.created&action=tag&target=t").get_status(),
        403
    );
    NC_CHECK_EQ(call("GET", flows, "").get_status(), 401);
    NC_CHECK_EQ(
        call("POST", flows, "root", "name=x&event=file.created&action=delete&target=t")
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        call("POST", flows, "root", "name=x&event=file.created&action=notify&target=nobody")
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        call(
            "POST",
            flows,
            "root",
            "name=Invoice&event=file.created&path=*.pdf&action=tag&target=invoice"
        )
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        call(
            "POST",
            flows,
            "root",
            "name=Watch&event=file.*&path=%2FSecret%2F*&action=notify&target=root&message=%7Buser%"
            "7D+touched+%7Bpath%7D"
        )
            .get_status(),
        200
    );
    NC_CHECK(contains(call("GET", flows, "root"), "\"name\":\"Invoice\""));

    // Files made through WebDAV set the rules off.
    const std::string files = "/remote.php/dav/files/alice";
    NC_CHECK_EQ(call("MKCOL", files + "/Secret", "alice").get_status(), 201);
    NC_CHECK_EQ(call("PUT", files + "/bill.pdf", "alice", "pdf").get_status(), 201);
    NC_CHECK_EQ(call("PUT", files + "/note.txt", "alice", "text").get_status(), 201);
    NC_CHECK_EQ(call("PUT", files + "/Secret/plan.txt", "alice", "plan").get_status(), 201);
    const Response tagged =
        call("GET", "/ocs/v2.php/apps/systemtags/api/v1/objects?path=%2Fbill.pdf", "alice");
    NC_CHECK(contains(tagged, "invoice"));
    NC_CHECK(!contains(
        call("GET", "/ocs/v2.php/apps/systemtags/api/v1/objects?path=%2Fnote.txt", "alice"),
        "invoice"
    ));
    const Response notes =
        call("GET", "/ocs/v2.php/apps/notifications/api/v2/notifications", "root");
    NC_CHECK(contains(notes, "Watch: alice touched /Secret/plan.txt"));
    NC_CHECK(!contains(notes, "note.txt"));

    // A removed flow no longer reacts.
    NC_CHECK_EQ(call("DELETE", flows + "/1", "root").get_status(), 200);
    NC_CHECK_EQ(call("DELETE", flows + "/1", "root").get_status(), 404);
    NC_CHECK_EQ(call("PUT", files + "/other.pdf", "alice", "pdf").get_status(), 201);
    NC_CHECK(!contains(
        call("GET", "/ocs/v2.php/apps/systemtags/api/v1/objects?path=%2Fother.pdf", "alice"),
        "invoice"
    ));
    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
