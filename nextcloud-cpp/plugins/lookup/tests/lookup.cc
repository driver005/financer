#include "nextcloud/runner/http_server.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>
#include <memory>

namespace {

namespace fs = std::filesystem;
using nc::http::Request;
using nc::http::Response;

struct Node
{
    std::string dir{};
    std::unique_ptr<nc::Kernel> kernel{};
    std::unique_ptr<nc::HttpServer> http{};
    std::uint16_t port{0};

    Node(
        const std::string& name,
        const std::string& extra,
        std::initializer_list<const char*> plugins
    )
    {
        dir = (fs::temp_directory_path() / ("nc-lookup-" + name + "-" + nc::util::random_hex(4)))
                  .string();
        fs::create_directories(dir);
        kernel = std::make_unique<nc::Kernel>(
            nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n" + extra)
                .value()
        );
        kernel->get_logger().set_sink({});
        for (const char* plugin: plugins) {
            NC_CHECK(
                kernel
                    ->add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                    .has_value()
            );
        }
        http = std::make_unique<nc::HttpServer>(*kernel);
        const auto started = http->start("127.0.0.1", 0);
        NC_CHECK(started.has_value());
        port = started ? *started : 0;
        NC_CHECK(kernel->start().has_value());
    }

    ~Node()
    {
        http->stop();
        kernel->stop();
        fs::remove_all(dir);
    }

    void add_user(const std::string& name, const std::string& email = {})
    {
        std::string out;
        ::setenv("OC_PASS", (name + " password").c_str(), 1);
        std::vector<std::string> args{name};
        if (!email.empty()) {
            args.push_back("--email=" + email);
        }
        NC_CHECK_EQ(kernel->run_command("user:add", args, out), 0);
        ::unsetenv("OC_PASS");
    }

    Response call(
        const std::string& method,
        const std::string& path,
        const std::string& user = {},
        const std::string& body = {}
    ) const
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
        request.add_header("Host", "127.0.0.1:" + std::to_string(port));
        if (!user.empty()) {
            request.add_header(
                "Authorization",
                "Basic " + nc::util::base64_encode(user + ":" + user + " password")
            );
        }
        return kernel->handle(std::move(request));
    }
};

bool contains(const Response& response, const std::string& text)
{
    return response.get_body().find(text) != std::string::npos;
}

} // namespace

int main()
{
    // The directory: a server whose people published themselves.
    Node directory{"directory", "", {"lookup", "users", "db"}};
    directory.add_user("dora", "dora@example.org");
    directory.add_user("dave");
    directory.add_user("hidden");
    const std::string publish = "/ocs/v2.php/apps/lookup/api/v1/publish";
    NC_CHECK_EQ(directory.call("POST", publish).get_status(), 401);
    NC_CHECK_EQ(directory.call("POST", publish, "dora", "email=true").get_status(), 200);
    NC_CHECK_EQ(directory.call("POST", publish, "dave").get_status(), 200);

    const std::string base = "/index.php/lookup/users?search=";
    // Public, but short searches and unlisted people give nothing.
    NC_CHECK_EQ(directory.call("GET", base + "do").get_status(), 400);
    NC_CHECK_EQ(directory.call("GET", base + std::string(101, 'x')).get_status(), 400);
    const Response found = directory.call("GET", base + "dor");
    NC_CHECK_EQ(found.get_status(), 200);
    NC_CHECK(contains(
        found,
        "\"federationId\":\"dora@127.0.0.1:" + std::to_string(directory.port) + "\""
    ));
    NC_CHECK(contains(found, "\"email\":\"dora@example.org\"")); // she chose to show it
    NC_CHECK(contains(directory.call("GET", base + "dora%40example"), "dora@127.0.0.1")
    ); // by e-mail address
    NC_CHECK(!contains(directory.call("GET", base + "hid"), "hidden"));
    NC_CHECK(contains(directory.call("GET", base + "dav"), "\"email\":\"\"")
    ); // dave kept it private
    NC_CHECK(!contains(directory.call("GET", base + "example"), "dave"));
    NC_CHECK(!contains(directory.call("GET", base + "ora"), "dora")
    ); // the start of a word, not any part

    // Withdrawing removes the entry; deleting an account does too.
    NC_CHECK_EQ(directory.call("DELETE", publish, "dave").get_status(), 200);
    NC_CHECK(!contains(directory.call("GET", base + "dav"), "dave"));
    NC_CHECK_EQ(directory.call("POST", publish, "dave").get_status(), 200);
    directory.kernel->get_events().publish("user.deleted", "id=dave");
    NC_CHECK(!contains(directory.call("GET", base + "dav"), "dave"));

    // Another server asks that directory and offers what it finds when somebody shares.
    Node client{
        "client",
        "[lookup]\nserver = http://127.0.0.1:" + std::to_string(directory.port) +
            "\nallow_http = true\nallow_local = true\n",
        {"cloud", "lookup", "users", "db"}
    };
    client.add_user("carol");
    const std::string address = "dora@127.0.0.1:" + std::to_string(directory.port);
    NC_CHECK_EQ(
        client.kernel->get_services().call("lookup.search", "do").get_body(),
        ""
    ); // too short
    NC_CHECK(client.kernel->get_services()
                 .call("lookup.search", "dora")
                 .get_body()
                 .starts_with(address + "\t"));
    const Response suggestions =
        client.call("GET", "/ocs/v2.php/apps/files_sharing/api/v1/sharees?search=dora", "carol");
    NC_CHECK_EQ(suggestions.get_status(), 200);
    NC_CHECK(contains(suggestions, "\"shareWith\":\"" + address + "\""));
    NC_CHECK(contains(suggestions, "\"shareType\":6"));
    // Without a directory the service says so, and the share dialog still works.
    Node alone{"alone", "", {"cloud", "lookup", "users", "db"}};
    NC_CHECK_EQ(alone.kernel->get_services().call("lookup.search", "dora").get_status(), 404);
    // A directory that is down is an error for the service, not a crash.
    directory.http->stop();
    NC_CHECK_EQ(client.kernel->get_services().call("lookup.search", "dora").get_status(), 502);
    return NC_TEST_RESULT();
}
