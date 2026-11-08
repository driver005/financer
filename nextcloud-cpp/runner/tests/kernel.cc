#include "nextcloud/runner/kernel.h"

#include "nextcloud/plugin.h"
#include "nextcloud/runner/http_server.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <atomic>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>
#include <thread>
#include <vector>

namespace {

using nc::http::Request;
using nc::http::Response;

// ---- test plugins, going through the real C ABI (they are only linked in, not dlopen'd) ---------

std::vector<std::string> g_events;
std::vector<std::string> g_order;
int g_ticks = 0;

class AlphaPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "alpha";
    }

    std::string_view get_version() const noexcept override
    {
        return "1.0";
    }

    void on_load(nc::Host& host) override
    {
        g_order.push_back("alpha");
        host.add_route(
            "GET",
            "/alpha/{name}",
            [](const Request& request)
            {
                return Response::text(
                    200,
                    "hello " + std::string(request.param("name")) + " as [" + request.get_user() +
                        "]"
                );
            }
        );
        host.add_route(
            "GET",
            "/alpha/special",
            [](const Request&)
            {
                return Response::text(200, "special");
            }
        );
        host.add_route(
            "POST",
            "/alpha/{name}",
            [](const Request& request)
            {
                return Response::text(201, request.get_body());
            }
        );
        host.add_route(
            "GET",
            "/boom",
            [](const Request&) -> Response
            {
                throw std::runtime_error("kaboom");
            }
        );
        host.add_service(
            "auth.authenticate",
            [](std::string_view args)
            {
                return args == "alice:secret" ? Response::text(200, "alice")
                                              : Response::text(401, "");
            }
        );
        host.add_service(
            "alpha.echo",
            [](std::string_view args)
            {
                return Response::text(200, std::string(args));
            }
        );
        host.add_command(
            "alpha:say",
            "says something",
            [](const std::vector<std::string>& args, std::string& out)
            {
                out = args.empty() ? "nothing\n" : args[0] + "\n";
                return args.empty() ? 1 : 0;
            }
        );
        host.add_job(
            "tick",
            3'600,
            []()
            {
                ++g_ticks;
            }
        );
        host.add_job(
            "broken",
            3'600,
            []()
            {
                throw std::runtime_error("job failed");
            }
        );
        host.subscribe(
            "thing.*",
            [](std::string_view topic, std::string_view payload)
            {
                g_events.push_back("alpha:" + std::string(topic) + "=" + std::string(payload));
            }
        );
    }
};

class BetaPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "beta";
    }

    std::string_view get_version() const noexcept override
    {
        return "2.0";
    }

    std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"alpha"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        g_order.push_back("beta");
        host.add_route(
            "GET",
            "/beta",
            [&host](const Request&)
            {
                // Calls the service of another plugin through the kernel.
                return host.call_service("alpha.echo", "from beta");
            }
        );
        host.subscribe(
            "thing.made",
            [](std::string_view, std::string_view payload)
            {
                g_events.push_back("beta:" + std::string(payload));
            }
        );
        mode = host.config("mode", "default");
    }

    void on_ready(nc::Host& host) noexcept override
    {
        host.publish("thing.made", "ready-" + mode);
    }

    std::string mode{};
};

class OrphanPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "orphan";
    }

    std::string_view get_version() const noexcept override
    {
        return "1";
    }

    std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"missing"};
        return REQUIRED;
    }

    void on_load(nc::Host&) override
    {
        g_order.push_back("orphan");
    }
};

class BrokenPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "broken";
    }

    std::string_view get_version() const noexcept override
    {
        return "1";
    }

    void on_load(nc::Host& host) override
    {
        host.add_route(
            "GET",
            "/broken",
            [](const Request&)
            {
                return Response::text(200, "x");
            }
        );
        throw std::runtime_error("cannot start");
    }
};

class DependentOfBroken final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "dependent";
    }

    std::string_view get_version() const noexcept override
    {
        return "1";
    }

    std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"broken"};
        return REQUIRED;
    }

    void on_load(nc::Host&) override
    {
        g_order.push_back("dependent");
    }
};

template<typename PluginClass> void add(nc::Kernel& kernel)
{
    const auto result = kernel.add_plugin_api(nc::detail::api_for<PluginClass>());
    NC_CHECK(result.has_value());
}

nc::Config config_of(const std::string& text)
{
    return nc::Config::parse(text).value();
}

std::string basic(const std::string& credentials)
{
    return "Basic " + nc::util::base64_encode(credentials);
}

// ---- unit tests -------------------------------------------------------------------------------

void test_router()
{
    nc::Router router;
    NC_CHECK(router.add(
        "GET",
        "/files/{user}/{*path}",
        "t",
        [](const Request&)
        {
            return Response::text(200, "rest");
        }
    ));
    NC_CHECK(router.add(
        "GET",
        "/files/{user}/special",
        "t",
        [](const Request&)
        {
            return Response::text(200, "lit");
        }
    ));
    NC_CHECK(router.add(
        "PUT",
        "/files/{user}/{*path}",
        "t",
        [](const Request&)
        {
            return Response::text(200, "put");
        }
    ));
    NC_CHECK(!router.add(
        "GET",
        "/files/{user}/{*path}",
        "t",
        [](const Request&)
        {
            return Response{};
        }
    ));
    NC_CHECK(!router.add(
        "GET",
        "/a/{*rest}/b",
        "t",
        [](const Request&)
        {
            return Response{};
        }
    ));
    NC_CHECK(!router.add(
        "GET",
        "/a/x{y}",
        "t",
        [](const Request&)
        {
            return Response{};
        }
    ));

    auto found = router.match("GET", "/files/bob/docs/a%20b.txt");
    NC_CHECK(found.outcome == nc::Router::Outcome::FOUND);
    NC_CHECK_EQ(found.params.size(), std::size_t{2});
    NC_CHECK_EQ(found.params[0].second, "bob");
    NC_CHECK_EQ(found.params[1].second, "docs/a b.txt");
    NC_CHECK_EQ((*found.handler)(Request{}).get_body(), "rest");

    // A literal segment beats a catch-all.
    found = router.match("GET", "/files/bob/special");
    NC_CHECK_EQ((*found.handler)(Request{}).get_body(), "lit");
    // Trailing and doubled slashes do not matter.
    NC_CHECK(router.match("GET", "//files//bob/x/").outcome == nc::Router::Outcome::FOUND);
    // The rest may be empty.
    NC_CHECK(router.match("PUT", "/files/bob").outcome == nc::Router::Outcome::FOUND);
    // Known path, wrong method.
    const auto wrong = router.match("DELETE", "/files/bob/x");
    NC_CHECK(wrong.outcome == nc::Router::Outcome::METHOD_NOT_ALLOWED);
    NC_CHECK_EQ(wrong.allowed.size(), std::size_t{2});
    NC_CHECK(router.match("GET", "/nothing").outcome == nc::Router::Outcome::NOT_FOUND);

    router.remove_owner("t");
    NC_CHECK_EQ(router.size(), std::size_t{0});
}

void test_config()
{
    const nc::Config config = config_of("# comment\nport = 9000\nplugins = a, b\n\n[mail]\nspool = "
                                        "/tmp/x # no inline comments\n[cloud]\nquota=5\n");
    NC_CHECK_EQ(config.get_integer("port", 1), 9'000L);
    NC_CHECK_EQ(config.get_integer("nope", 7), 7L);
    NC_CHECK_EQ(config.get_plugin("mail", "spool"), "/tmp/x # no inline comments");
    NC_CHECK_EQ(config.get_plugin("cloud", "quota"), "5");
    NC_CHECK(config.find("cloud", "other") == nullptr);
    NC_CHECK(!nc::Config::parse("just text").has_value());
    NC_CHECK(!nc::Config::parse("[open\nk=v").has_value());
    NC_CHECK(!nc::Config::parse("=v").has_value());
}

void test_events_and_services()
{
    nc::EventBus bus;
    std::vector<std::string> seen;
    bus.subscribe(
        "a.*",
        "one",
        [&](std::string_view topic, std::string_view)
        {
            seen.push_back("one:" + std::string(topic));
        }
    );
    bus.subscribe(
        "a.b",
        "two",
        [&](std::string_view, std::string_view)
        {
            throw std::runtime_error("handler failure");
        }
    );
    bus.subscribe(
        "a.b",
        "three",
        [&](std::string_view, std::string_view payload)
        {
            seen.push_back("three:" + std::string(payload));
        }
    );
    NC_CHECK_EQ(bus.publish("a.b", "p"), std::size_t{3});
    NC_CHECK_EQ(seen.size(), std::size_t{2});
    NC_CHECK_EQ(bus.publish("x.y", ""), std::size_t{0});
    bus.remove_owner("one");
    NC_CHECK_EQ(bus.size(), std::size_t{2});

    nc::ServiceRegistry services;
    NC_CHECK(services.add(
        "s",
        "o",
        [](std::string_view args)
        {
            return Response::text(200, std::string(args));
        }
    ));
    NC_CHECK(!services.add(
        "s",
        "p",
        [](std::string_view)
        {
            return Response{};
        }
    ));
    NC_CHECK_EQ(services.call("s", "hi").get_body(), "hi");
    NC_CHECK_EQ(services.call("missing", "").get_status(), 404);
    NC_CHECK(services.add(
        "t",
        "o",
        [](std::string_view) -> Response
        {
            throw std::runtime_error("bad");
        }
    ));
    NC_CHECK_EQ(services.call("t", "").get_status(), 500);
}

void test_http_wire()
{
    const std::string raw = "PUT /remote.php/dav/files/alice/a%20b.txt?x=1&y=two%20words "
                            "HTTP/1.1\r\nHost: h\r\ncontent-length: 5\r\nX-A:  v \r\n\r\nhello";
    const auto head = nc::parse_request_head(raw);
    NC_CHECK(head.has_value());
    NC_CHECK_EQ(head->method, "PUT");
    NC_CHECK_EQ(head->content_length, std::size_t{5});
    NC_CHECK_EQ(head->head_size, raw.size() - 5);
    const Request request = nc::request_from_head(*head, raw.substr(head->head_size));
    NC_CHECK_EQ(request.get_path(), "/remote.php/dav/files/alice/a%20b.txt");
    NC_CHECK_EQ(request.query_value("y"), "two words");
    NC_CHECK_EQ(std::string(request.header("X-A")), "v");
    NC_CHECK_EQ(request.get_body(), "hello");

    NC_CHECK(!nc::parse_request_head("GET / HTTP/1.1\r\nHost: h").has_value());
    NC_CHECK(!nc::parse_request_head("GARBAGE\r\n\r\n").has_value());
    NC_CHECK(
        nc::parse_request_head("POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n")->chunked
    );
    NC_CHECK(!nc::parse_request_head("POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n").has_value());
    // Request smuggling shapes: two ways to say where the body ends, or an encoding we do not
    // decode.
    NC_CHECK(!nc::parse_request_head(
                  "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n"
    )
                  .has_value());
    NC_CHECK(!nc::parse_request_head("POST / HTTP/1.1\r\nTransfer-Encoding: gzip, chunked\r\n\r\n")
                  .has_value());

    const std::string wire = nc::serialize_response(Response::json(200, "{}"));
    NC_CHECK(wire.starts_with("HTTP/1.1 200 OK\r\n"));
    NC_CHECK(wire.find("Content-Length: 2\r\n") != std::string::npos);
    NC_CHECK(wire.ends_with("\r\n\r\n{}"));
}

// ---- the kernel with real ABI plugins --------------------------------------------------------

void test_kernel()
{
    g_events.clear();
    g_order.clear();
    nc::Kernel kernel{config_of("[beta]\nmode = fast\n")};
    kernel.get_logger().set_sink({});
    // Added in an order that is wrong on purpose: beta needs alpha, dependent needs broken.
    add<DependentOfBroken>(kernel);
    add<OrphanPlugin>(kernel);
    add<BetaPlugin>(kernel);
    add<BrokenPlugin>(kernel);
    add<AlphaPlugin>(kernel);
    NC_CHECK(!kernel.add_plugin_api(nc::detail::api_for<AlphaPlugin>()).has_value()); // duplicate

    NC_CHECK(kernel.start().has_value());
    NC_CHECK(!kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{2});
    NC_CHECK(g_order == (std::vector<std::string>{"alpha", "beta"}));

    std::map<std::string, nc::PluginInfo> by_name;
    for (const nc::PluginInfo& info: kernel.plugins()) {
        by_name[info.get_name()] = info;
    }
    NC_CHECK(by_name["alpha"].get_state() == nc::PluginState::RUNNING);
    NC_CHECK(by_name["beta"].get_state() == nc::PluginState::RUNNING);
    NC_CHECK(by_name["orphan"].get_state() == nc::PluginState::SKIPPED);
    NC_CHECK(by_name["orphan"].get_error().find("missing") != std::string::npos);
    NC_CHECK(by_name["broken"].get_state() == nc::PluginState::FAILED);
    NC_CHECK(by_name["dependent"].get_state() == nc::PluginState::SKIPPED);

    // on_ready ran after everything loaded, and the config of the plugin reached it.
    NC_CHECK(
        g_events == (std::vector<std::string>{"beta:ready-fast", "alpha:thing.made=ready-fast"}) ||
        g_events == (std::vector<std::string>{"alpha:thing.made=ready-fast", "beta:ready-fast"})
    );

    // Routing: params, the more specific route, bodies, failures.
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/alpha/world"}).get_body(), "hello world as []");
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/alpha/special"}).get_body(), "special");
    const Response created = kernel.handle(Request{"POST", "/alpha/x", "", "payload", "", {}, {}});
    NC_CHECK_EQ(created.get_status(), 201);
    NC_CHECK_EQ(created.get_body(), "payload");
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/nope"}).get_status(), 404);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/boom"}).get_status(), 500);
    NC_CHECK_EQ(
        kernel.handle(Request{"GET", "/broken"}).get_status(),
        404
    ); // its routes were rolled back
    const Response not_allowed = kernel.handle(Request{"DELETE", "/alpha/x"});
    NC_CHECK_EQ(not_allowed.get_status(), 405);
    NC_CHECK(std::string(not_allowed.header("Allow")).find("GET") != std::string::npos);
    NC_CHECK_EQ(kernel.handle(Request{"OPTIONS", "/alpha/x"}).get_status(), 200);
    const Response head = kernel.handle(Request{"HEAD", "/alpha/special"});
    NC_CHECK(head.get_body().empty());
    NC_CHECK_EQ(std::string(head.header("Content-Length")), "7");

    // A plugin calling a service of another plugin.
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/beta"}).get_body(), "from beta");

    // Authentication goes through whoever offers auth.authenticate, and the client cannot set the
    // user.
    Request signed_in{"GET", "/alpha/me"};
    signed_in.add_header("Authorization", basic("alice:secret"));
    NC_CHECK_EQ(kernel.handle(std::move(signed_in)).get_body(), "hello me as [alice]");
    Request wrong{"GET", "/alpha/me"};
    wrong.add_header("Authorization", basic("alice:wrong"));
    const Response refused = kernel.handle(std::move(wrong));
    NC_CHECK_EQ(refused.get_status(), 401);
    NC_CHECK(!refused.header("WWW-Authenticate").empty());
    Request spoofed{"GET", "/alpha/me"};
    spoofed.set_user("root");
    NC_CHECK_EQ(kernel.handle(std::move(spoofed)).get_body(), "hello me as []");

    // Built-ins.
    const Response status = kernel.handle(Request{"GET", "/status.php"});
    NC_CHECK_EQ(status.get_status(), 200);
    NC_CHECK(status.get_body().find(R"("installed":true)") != std::string::npos);
    NC_CHECK(status.get_body().find(R"("name":"alpha")") != std::string::npos);
    const Response listing = kernel.handle(Request{"GET", "/ocs/v2.php/cloud/plugins"});
    NC_CHECK(listing.get_body().find(R"("statuscode":200)") != std::string::npos);
    NC_CHECK(listing.get_body().find(R"("requires":["alpha"])") != std::string::npos);

    // Commands: the kernel's and a plugin's.
    std::string out;
    NC_CHECK_EQ(kernel.run_command("alpha:say", {"hi"}, out), 0);
    NC_CHECK_EQ(out, "hi\n");
    NC_CHECK_EQ(kernel.run_command("alpha:say", {}, out), 1);
    NC_CHECK_EQ(kernel.run_command("plugin:list", {}, out), 0);
    NC_CHECK(out.find("orphan\t1\tskipped") != std::string::npos);
    NC_CHECK_EQ(kernel.run_command("no:such", {}, out), 127);

    kernel.stop();
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/alpha/world"}).get_status(), 404);
    NC_CHECK(!kernel.get_services().contains("alpha.echo"));
}

void test_jobs()
{
    g_ticks = 0;
    nc::Kernel kernel;
    kernel.get_logger().set_sink({});
    add<AlphaPlugin>(kernel);
    NC_CHECK(kernel.start().has_value());

    // Nothing is due yet; an hour later both are; one failing job does not stop the other.
    NC_CHECK_EQ(kernel.get_jobs().run_due(), std::size_t{0});
    NC_CHECK_EQ(
        kernel.get_jobs().run_due(nc::JobScheduler::Clock::now() + std::chrono::hours{2}),
        std::size_t{2}
    );
    NC_CHECK_EQ(g_ticks, 1);
    std::string out;
    NC_CHECK_EQ(kernel.run_command("background:run", {}, out), 0);
    NC_CHECK_EQ(out, "ran 2 job(s)\n");
    NC_CHECK_EQ(g_ticks, 2);
    NC_CHECK_EQ(kernel.run_command("background:list", {}, out), 0);
    NC_CHECK(out.find("alpha\ttick\tevery 3600s\truns 2\tfailed 0") != std::string::npos);
    NC_CHECK(out.find("alpha\tbroken\tevery 3600s\truns 2\tfailed 2") != std::string::npos);

    kernel.stop();
    NC_CHECK_EQ(kernel.get_jobs().list().size(), std::size_t{0});
}

void test_enabled_filter()
{
    g_order.clear();
    nc::Kernel kernel{config_of("plugins = alpha\n")};
    kernel.get_logger().set_sink({});
    add<AlphaPlugin>(kernel);
    add<BetaPlugin>(kernel);
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{1});
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/beta"}).get_status(), 404);
}

// Many connections reach the same plugins at once: routes, a plugin calling another plugin's
// service, and a command, all from several threads. Meant to be run under --config=tsan as well.
void test_concurrency()
{
    nc::Kernel kernel;
    kernel.get_logger().set_sink({});
    add<AlphaPlugin>(kernel);
    add<BetaPlugin>(kernel);
    NC_CHECK(kernel.start().has_value());

    std::atomic<int> wrong{0};
    std::vector<std::thread> threads;
    for (int thread = 0; thread < 8; ++thread) {
        threads.emplace_back(
            [&kernel, &wrong, thread]
            {
                for (int round = 0; round < 200; ++round) {
                    const std::string name =
                        "t" + std::to_string(thread) + "r" + std::to_string(round);
                    Request signed_in{"GET", "/alpha/" + name};
                    signed_in.add_header(
                        "Authorization",
                        "Basic " + nc::util::base64_encode("alice:secret")
                    );
                    if (kernel.handle(std::move(signed_in)).get_body() !=
                        "hello " + name + " as [alice]") {
                        ++wrong;
                    }
                    if (kernel.handle(Request{"GET", "/beta"}).get_body() != "from beta") {
                        ++wrong;
                    }
                    std::string out;
                    if (kernel.run_command("alpha:say", {name}, out) != 0 || out != name + "\n") {
                        ++wrong;
                    }
                }
            }
        );
    }
    for (std::thread& thread: threads) {
        thread.join();
    }
    NC_CHECK_EQ(wrong.load(), 0);
}

void test_chunked()
{
    using State = nc::ChunkedDecoder::State;
    // Whole message at once, with an extension, a trailer and bytes after the end.
    nc::ChunkedDecoder whole{1'000};
    NC_CHECK(
        whole.feed("5;ext=1\r\nhello\r\n6\r\n world\r\n0\r\nX-Trailer: v\r\n\r\n") == State::DONE
    );
    NC_CHECK_EQ(whole.body(), "hello world");

    // The same bytes one at a time: decoding must not depend on how the network cuts them.
    const std::string wire = "3\r\nabc\r\nA\r\n0123456789\r\n0\r\n\r\n";
    nc::ChunkedDecoder slow{1'000};
    State state = State::NEED_MORE;
    for (std::size_t index = 0; index < wire.size(); ++index) {
        NC_CHECK(state == State::NEED_MORE);
        state = slow.feed(std::string_view{wire}.substr(index, 1));
    }
    NC_CHECK(state == State::DONE);
    NC_CHECK_EQ(slow.body(), "abc0123456789");

    nc::ChunkedDecoder small{4};
    NC_CHECK(small.feed("5\r\nhello\r\n0\r\n\r\n") == State::TOO_LARGE);
    nc::ChunkedDecoder total{8};
    NC_CHECK(total.feed("4\r\nabcd\r\n") == State::NEED_MORE);
    NC_CHECK(total.feed("5\r\nefghi\r\n") == State::TOO_LARGE); // each chunk fits, the sum does not
    nc::ChunkedDecoder bad_size{100};
    NC_CHECK(bad_size.feed("xyz\r\n") == State::INVALID);
    nc::ChunkedDecoder huge_size{100};
    NC_CHECK(huge_size.feed("ffffffffffffffffff\r\n") == State::INVALID);
    nc::ChunkedDecoder no_crlf{100};
    NC_CHECK(no_crlf.feed("2\r\nabXX") == State::INVALID);
    nc::ChunkedDecoder unfinished{100};
    NC_CHECK(unfinished.feed("5\r\nhel") == State::NEED_MORE);
}

void test_tls()
{
    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / ("nc-tls-" + nc::util::random_hex(4));
    fs::create_directories(dir);
    const std::string cert = (dir / "cert.pem").string();
    const std::string key = (dir / "key.pem").string();
    const std::string other_key = (dir / "other.pem").string();
    const std::string make = "openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "
                             "/CN=localhost -addext subjectAltName=IP:127.0.0.1 -keyout " +
                             key + " -out " + cert + " >/dev/null 2>&1 && openssl genrsa -out " +
                             other_key + " 2048 >/dev/null 2>&1";
    NC_CHECK_EQ(std::system(make.c_str()), 0);

    nc::Kernel kernel;
    kernel.get_logger().set_sink({});
    add<AlphaPlugin>(kernel);
    NC_CHECK(kernel.start().has_value());
    nc::HttpServer server{kernel};
    // Missing files, a key of another certificate and plain nonsense are refused before anything
    // listens.
    NC_CHECK(!server.enable_tls((dir / "none.pem").string(), key).has_value());
    NC_CHECK(!server.enable_tls(cert, (dir / "none.pem").string()).has_value());
    NC_CHECK(!server.enable_tls(cert, other_key).has_value());
    NC_CHECK(server.enable_tls(cert, key).has_value());
    const auto port = server.start("127.0.0.1", 0);
    NC_CHECK(port.has_value());
    if (port) {
        const auto run = [](const std::string& command)
        {
            std::string output;
            if (FILE* pipe = popen(command.c_str(), "r")) {
                char buffer[512];
                while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
                    output += buffer;
                }
                pclose(pipe);
            }
            return output;
        };
        const std::string base = "127.0.0.1:" + std::to_string(*port);
        // With the certificate as trust anchor the request works, including a body.
        const std::string secure =
            run("curl -s -i --max-time 10 --cacert " + cert + " -X POST -d 'over tls' https://" +
                base + "/alpha/z");
        NC_CHECK(secure.starts_with("HTTP/1.1 201 Created"));
        NC_CHECK(secure.ends_with("over tls"));
        // A big body crosses several TLS records.
        const std::string big(300'000, 'x');
        {
            std::ofstream{(dir / "big.txt").string()} << big;
        }
        const std::string upload =
            run("curl -s --max-time 20 --cacert " + cert + " -X POST --data-binary @" +
                (dir / "big.txt").string() + " https://" + base + "/alpha/z");
        NC_CHECK_EQ(upload.size(), big.size());
        // Without trusting the certificate curl refuses (exit code 60), and plain HTTP gets
        // nothing.
        NC_CHECK_EQ(
            std::system(
                ("curl -s --max-time 10 -o /dev/null https://" + base + "/status.php").c_str()
            ) != 0,
            true
        );
        NC_CHECK(run("curl -s -i --max-time 5 http://" + base + "/status.php").empty());
        // Old protocol versions are not offered.
        NC_CHECK(run("curl -s -i --max-time 10 --cacert " + cert + " --tls-max 1.1 https://" +
                     base + "/status.php")
                     .empty());
    }
    server.stop();
    kernel.stop();
    fs::remove_all(dir);
}

void test_http_server()
{
    nc::Kernel kernel;
    kernel.get_logger().set_sink({});
    add<AlphaPlugin>(kernel);
    NC_CHECK(kernel.start().has_value());
    nc::HttpServer server{kernel};
    const auto port = server.start("127.0.0.1", 0);
    NC_CHECK(port.has_value());
    if (port) {
        const std::string url = "http://127.0.0.1:" + std::to_string(*port);
        const std::string command = "curl -s -i --max-time 10 -X POST -d 'abc' " + url + "/alpha/z";
        std::string output;
        if (FILE* pipe = popen(command.c_str(), "r")) {
            char buffer[512];
            while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
                output += buffer;
            }
            pclose(pipe);
        }
        NC_CHECK(output.starts_with("HTTP/1.1 201 Created"));
        NC_CHECK(output.ends_with("abc"));

        // A chunked upload (what `curl -T -` and streaming clients send) arrives whole.
        std::string chunked;
        const std::string streamed =
            "curl -s -i --max-time 10 -X POST -H 'Transfer-Encoding: chunked' --data-binary @- " +
            url + "/alpha/z";
        if (FILE* pipe = popen(("printf 'streamed body' | " + streamed).c_str(), "r")) {
            char buffer[512];
            while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
                chunked += buffer;
            }
            pclose(pipe);
        }
        NC_CHECK(chunked.starts_with("HTTP/1.1 201 Created"));
        NC_CHECK(chunked.ends_with("streamed body"));
    }
    server.stop();
    kernel.stop();
}

} // namespace

int main()
{
    test_router();
    test_config();
    test_events_and_services();
    test_http_wire();
    test_kernel();
    test_jobs();
    test_enabled_filter();
    test_concurrency();
    test_chunked();
    test_tls();
    test_http_server();
    return NC_TEST_RESULT();
}
