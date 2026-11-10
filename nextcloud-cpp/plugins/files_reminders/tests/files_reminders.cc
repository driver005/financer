#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "nextcloud/util/time.h"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <thread>

namespace {

using nc::http::Request;
using nc::http::Response;

std::int64_t now()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

} // namespace

int main()
{
    namespace fs = std::filesystem;
    const std::string dir =
        (fs::temp_directory_path() / ("nc-reminders-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"files_reminders", "notifications", "cloud", "users", "db"}) {
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
                          const std::string& body = {},
                          const std::string& user = "alice")
    {
        Request request{std::string{method}, std::string{path}};
        request.set_body(std::string{body});
        request.add_header(
            "Authorization",
            "Basic " + nc::util::base64_encode(user + ":" + user + " password")
        );
        return kernel.handle(std::move(request));
    };
    const auto contains = [](const Response& response, const std::string& text)
    {
        return response.get_body().find(text) != std::string::npos;
    };
    const std::string files = "/remote.php/dav/files/alice";
    const std::string api = "/ocs/v2.php/apps/files_reminders/api/v1/";
    const std::string notifications = "/ocs/v2.php/apps/notifications/api/v2/notifications";

    // A file and its number, as WebDAV shows it.
    NC_CHECK_EQ(call("PUT", files + "/report.txt", "text").get_status(), 201);
    NC_CHECK_EQ(call("PUT", files + "/other.txt", "text").get_status(), 201);
    const auto number_of = [&](const std::string& name)
    {
        Request request{std::string{"PROPFIND"}, files + "/" + name};
        request.add_header("Depth", "0");
        request.add_header(
            "Authorization",
            "Basic " + nc::util::base64_encode("alice:alice password")
        );
        const std::string body = kernel.handle(std::move(request)).get_body();
        const std::size_t open = body.find("<oc:fileid>");
        return open == std::string::npos
                   ? std::string{}
                   : body.substr(open + 11, body.find("</oc:fileid>") - open - 11);
    };
    const std::string id = number_of("report.txt");
    const std::string other = number_of("other.txt");
    NC_CHECK(!id.empty() && !other.empty() && id != other);

    // Nothing is set yet; a file that does not exist has no reminder either.
    NC_CHECK(contains(call("GET", api + id), "\"dueDate\":null"));
    NC_CHECK(contains(call("GET", api + "99999"), "\"dueDate\":null"));
    NC_CHECK(contains(call("GET", api + "abc"), "\"dueDate\":null"));
    NC_CHECK_EQ(call("DELETE", api + id).get_status(), 404);
    // Only a time in the future, in ISO 8601, for a file that exists.
    const std::string in_two = nc::util::format_atom(now() + 2);
    const std::string in_an_hour = nc::util::format_atom(now() + 3'600);
    NC_CHECK_EQ(
        call("PUT", api + id, "dueDate=" + nc::util::form_encode({{"x", in_an_hour}}).substr(2))
            .get_status(),
        201
    );
    NC_CHECK_EQ(call("PUT", api + id, "dueDate=2001-01-01T00:00:00Z").get_status(), 400);
    NC_CHECK_EQ(call("PUT", api + id, "dueDate=tomorrow").get_status(), 400);
    NC_CHECK_EQ(call("PUT", api + id, "").get_status(), 400);
    NC_CHECK_EQ(call("PUT", api + "99999", "dueDate=2099-01-01T00:00:00Z").get_status(), 404);
    NC_CHECK_EQ(call("PUT", api + "x1", "dueDate=2099-01-01T00:00:00Z").get_status(), 400);
    // Changing it answers 200, and GET gives the time back; another account sees nothing of it,
    // and cannot set one on a file that is not its own.
    NC_CHECK_EQ(call("PUT", api + id, "dueDate=2099-01-01T00:00:00%2B01:00").get_status(), 200);
    NC_CHECK(contains(call("GET", api + id), "\"dueDate\":\"2098-12-31T23:00:00+00:00\""));
    NC_CHECK(contains(call("GET", api + id, {}, "bob"), "\"dueDate\":null"));
    NC_CHECK_EQ(call("PUT", api + id, "dueDate=2099-01-01T00:00:00Z", "bob").get_status(), 404);
    NC_CHECK_EQ(call("DELETE", api + id, {}, "bob").get_status(), 404);
    NC_CHECK_EQ(call("GET", api + id, {}, "nobody").get_status(), 401);
    // JSON bodies work too, and removing works once.
    NC_CHECK_EQ(
        call("PUT", api + other, R"({"dueDate":"2099-02-02T10:00:00Z"})").get_status(),
        201
    );
    NC_CHECK_EQ(call("DELETE", api + other).get_status(), 200);
    NC_CHECK_EQ(call("DELETE", api + other).get_status(), 404);

    // Due in two seconds: nothing is sent before, the notification comes once, after.
    NC_CHECK_EQ(call("PUT", api + id, "dueDate=" + in_two.substr(0, 19) + "Z").get_status(), 200);
    NC_CHECK_EQ(kernel.run_command("background:run", {}, out), 0);
    NC_CHECK(!contains(call("GET", notifications), "Reminder for report.txt"));
    std::this_thread::sleep_for(std::chrono::milliseconds{2'300});
    // The file was renamed meanwhile: the number still finds it.
    Request rename{std::string{"MOVE"}, files + "/report.txt"};
    rename.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:alice password"));
    rename.add_header("Destination", files + "/final.txt");
    NC_CHECK_EQ(kernel.handle(std::move(rename)).get_status(), 201);
    NC_CHECK_EQ(kernel.run_command("background:run", {}, out), 0);
    const Response sent = call("GET", notifications);
    NC_CHECK(contains(sent, "Reminder for final.txt"));
    NC_CHECK(contains(sent, "/index.php/f/" + id));
    NC_CHECK_EQ(kernel.run_command("background:run", {}, out), 0);
    {
        // Once only.
        const std::string body = call("GET", notifications).get_body();
        const std::size_t first = body.find("Reminder for final.txt");
        NC_CHECK(first != std::string::npos);
        NC_CHECK(body.find("Reminder for final.txt", first + 1) == std::string::npos);
    }
    NC_CHECK(!contains(call("GET", notifications, {}, "bob"), "Reminder for"));
    // A past reminder is not shown any more.
    NC_CHECK(contains(call("GET", api + id), "\"dueDate\":null"));

    // A file that is gone when the reminder is due sends nothing.
    NC_CHECK_EQ(call("PUT", files + "/short.txt", "x").get_status(), 201);
    const std::string short_id = number_of("short.txt");
    NC_CHECK_EQ(
        call(
            "PUT",
            api + short_id,
            "dueDate=" + nc::util::format_atom(now() + 2).substr(0, 19) + "Z"
        )
            .get_status(),
        201
    );
    NC_CHECK_EQ(call("DELETE", files + "/short.txt").get_status(), 204);
    std::this_thread::sleep_for(std::chrono::milliseconds{2'300});
    NC_CHECK_EQ(kernel.run_command("background:run", {}, out), 0);
    {
        // Nothing at all was sent for it: the one reminder notification is the one for final.txt.
        const std::string body = call("GET", notifications).get_body();
        const std::size_t first = body.find("Reminder for");
        NC_CHECK(first != std::string::npos);
        NC_CHECK(body.find("Reminder for", first + 1) == std::string::npos);
    }
    NC_CHECK_EQ(call("DELETE", api + short_id).get_status(), 404);

    // Two accounts with a reminder each see their own.
    NC_CHECK_EQ(call("PUT", "/remote.php/dav/files/bob/b.txt", "b", "bob").get_status(), 201);
    Request bob_listing{std::string{"PROPFIND"}, std::string{"/remote.php/dav/files/bob/b.txt"}};
    bob_listing.add_header("Depth", "0");
    bob_listing.add_header("Authorization", "Basic " + nc::util::base64_encode("bob:bob password"));
    const std::string bob_body = kernel.handle(std::move(bob_listing)).get_body();
    const std::size_t bob_open = bob_body.find("<oc:fileid>");
    NC_CHECK(bob_open != std::string::npos);
    const std::string bob_id =
        bob_body.substr(bob_open + 11, bob_body.find("</oc:fileid>") - bob_open - 11);
    NC_CHECK_EQ(call("PUT", api + other, "dueDate=2097-03-03T03:03:03Z").get_status(), 201);
    NC_CHECK_EQ(call("PUT", api + bob_id, "dueDate=2096-04-04T04:04:04Z", "bob").get_status(), 201);
    NC_CHECK(contains(call("GET", api + bob_id, {}, "bob"), "2096-04-04T04:04:04+00:00"));
    NC_CHECK(contains(call("GET", api + other), "2097-03-03T03:03:03+00:00"));
    NC_CHECK(!contains(call("GET", api + bob_id, {}, "bob"), "2097"));

    kernel.stop();
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
