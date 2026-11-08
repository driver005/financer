#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

int main()
{
    using nc::http::Request;
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-activity-" + nc::util::random_hex(4)))
            .string();
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[activity]\nretention_days = 30\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"activity", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");

    // Events of other plugins become entries for the people they concern.
    kernel.get_events().publish("file.created", "user=alice&path=%2Fa.txt");
    kernel.get_events().publish("file.moved", "user=alice&path=%2Fa.txt&target=%2Fb.txt");
    kernel.get_events().publish("share.created", "type=0&owner=alice&share_with=bob&path=%2Fb.txt");
    kernel.get_events().publish("share.created", "type=3&owner=alice&path=%2Fb.txt");

    const auto signed_in = [](std::string path, const std::string& credentials)
    {
        const std::size_t question = path.find('?');
        Request request{"GET", path.substr(0, question)};
        if (question != std::string::npos) {
            request.set_query(path.substr(question + 1));
        }
        request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
        return request;
    };
    NC_CHECK_EQ(
        kernel.handle(Request{"GET", "/ocs/v2.php/apps/activity/api/v2/activity"}).get_status(),
        401
    );
    const auto alice =
        kernel
            .handle(signed_in("/ocs/v2.php/apps/activity/api/v2/activity", "alice:alice password"))
            .get_body();
    NC_CHECK(alice.find("You created /a.txt") != std::string::npos);
    NC_CHECK(alice.find("You moved /a.txt") != std::string::npos);
    NC_CHECK(alice.find("You shared /b.txt with bob") != std::string::npos);
    NC_CHECK(alice.find("You shared /b.txt by link") != std::string::npos);
    NC_CHECK(
        alice.find("Your account was created") != std::string::npos
    ); // user.created from the users plugin
    const auto bob =
        kernel.handle(signed_in("/ocs/v2.php/apps/activity/api/v2/activity", "bob:bob password"))
            .get_body();
    NC_CHECK(bob.find("alice shared /b.txt with you") != std::string::npos);
    NC_CHECK(bob.find("You created") == std::string::npos); // nobody sees another's entries

    // Newest first, limit and since.
    NC_CHECK(alice.find("by link") < alice.find("with bob"));
    const auto one = kernel
                         .handle(signed_in(
                             "/ocs/v2.php/apps/activity/api/v2/activity?limit=1",
                             "alice:alice password"
                         ))
                         .get_body();
    NC_CHECK(one.find("by link") != std::string::npos && one.find("with bob") == std::string::npos);

    // Retention: old rows go, new ones stay (the job and the command do the same).
    NC_CHECK_EQ(
        kernel.get_services()
            .call(
                "db.exec",
                "sql=INSERT+INTO+nc_activity%28uid%2Cts%2Ctype%2Csubject%29+VALUES%28%27alice%27%"
                "2C1%2C%27x%27%2C%27ancient%27%29"
            )
            .get_status(),
        200
    );
    NC_CHECK_EQ(kernel.run_command("activity:prune", {}, out), 0);
    NC_CHECK_EQ(out, "removed 1 entr(ies)\n");
    NC_CHECK_EQ(kernel.run_command("activity:list", {"alice"}, out), 0);
    NC_CHECK(
        out.find("ancient") == std::string::npos &&
        out.find("You created /a.txt") != std::string::npos
    );
    NC_CHECK_EQ(kernel.get_jobs().list().size(), std::size_t{1});

    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
