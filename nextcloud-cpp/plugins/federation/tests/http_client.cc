#include "http_client.h"

#include "nextcloud/plugin.h"
#include "nextcloud/runner/http_server.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <filesystem>
#include <string>

namespace {

using nc::federation::ClientSettings;
using nc::http::Request;
using nc::http::Response;

class EchoPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "echo";
    }

    std::string_view get_version() const noexcept override
    {
        return "1.0";
    }

    void on_load(nc::Host& host) override
    {
        host.add_route(
            "POST",
            "/echo",
            [](const Request& request)
            {
                Response response = Response::text(201, std::string{request.get_body()});
                response.add_header("X-Seen", std::string{request.header("X-Test")});
                return response;
            }
        );
        host.add_route(
            "GET",
            "/big",
            [](const Request&)
            {
                return Response::text(200, std::string(100'000, 'b'));
            }
        );
        host.add_route(
            "GET",
            "/redirect",
            [](const Request&)
            {
                Response response = Response::text(302, "");
                response.add_header("Location", "http://127.0.0.1:1/");
                return response;
            }
        );
    }
};

void test_parse_url()
{
    using nc::federation::parse_url;
    const auto plain = parse_url("HTTP://Example.org/a/b?c=d");
    NC_CHECK(plain.has_value());
    if (plain) {
        NC_CHECK_EQ(plain->scheme, "http");
        NC_CHECK_EQ(plain->host, "Example.org");
        NC_CHECK_EQ(plain->port, "80");
        NC_CHECK_EQ(plain->target, "/a/b?c=d");
    }
    const auto port = parse_url("https://host:8443");
    NC_CHECK(port.has_value());
    if (port) {
        NC_CHECK_EQ(port->port, "8443");
        NC_CHECK_EQ(port->target, "/");
    }
    const auto v6 = parse_url("http://[::1]:81/x");
    NC_CHECK(v6.has_value());
    if (v6) {
        NC_CHECK_EQ(v6->host, "::1");
        NC_CHECK_EQ(v6->port, "81");
    }
    NC_CHECK(!parse_url("ftp://x/").has_value());
    NC_CHECK(!parse_url("http://user:pw@host/").has_value());
    NC_CHECK(!parse_url("http:///x").has_value());
    NC_CHECK(!parse_url("http://host:99999999/").has_value());
    NC_CHECK(!parse_url("http://host/a b").has_value());
    NC_CHECK(!parse_url("http://host/a#frag").has_value());
    NC_CHECK(!parse_url("nonsense").has_value());
}

void test_local_addresses()
{
    using nc::federation::is_local_address;
    for (const char* local:
         {"127.0.0.1",
          "10.1.2.3",
          "172.16.0.1",
          "172.31.255.255",
          "192.168.1.1",
          "169.254.1.1",
          "100.64.0.1",
          "0.0.0.0",
          "::1",
          "::",
          "fc00::1",
          "fe80::1",
          "::ffff:127.0.0.1",
          "garbage"}) {
        NC_CHECK(is_local_address(local));
    }
    for (const char* remote: {"8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"}) {
        NC_CHECK(!is_local_address(remote));
    }
}

void test_round_trip()
{
    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / ("nc-fed-" + nc::util::random_hex(4));
    fs::create_directories(dir);
    const std::string cert = (dir / "cert.pem").string();
    const std::string key = (dir / "key.pem").string();
    const std::string make =
        "openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost "
        "-addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout " +
        key + " -out " + cert + " >/dev/null 2>&1";
    NC_CHECK_EQ(std::system(make.c_str()), 0);

    nc::Kernel kernel;
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_api(nc::detail::api_for<EchoPlugin>()).has_value());
    NC_CHECK(kernel.start().has_value());

    nc::HttpServer plain{kernel};
    const auto plain_port = plain.start("127.0.0.1", 0);
    nc::HttpServer secure{kernel};
    NC_CHECK(secure.enable_tls(cert, key).has_value());
    const auto secure_port = secure.start("127.0.0.1", 0);
    NC_CHECK(plain_port.has_value() && secure_port.has_value());
    if (plain_port && secure_port) {
        ClientSettings local;
        local.set_allow_http(true);
        local.set_allow_local(true);
        const std::string plain_url = "http://127.0.0.1:" + std::to_string(*plain_port);

        const auto echoed = nc::federation::request(
            local,
            "POST",
            plain_url + "/echo",
            {{"X-Test", "yes"}},
            "payload"
        );
        NC_CHECK(echoed.has_value());
        if (echoed) {
            NC_CHECK_EQ(echoed->get_status(), 201);
            NC_CHECK_EQ(echoed->get_body(), "payload");
            NC_CHECK_EQ(echoed->header("X-Seen"), "yes");
        }
        const auto big = nc::federation::request(local, "GET", plain_url + "/big", {}, "");
        NC_CHECK(big.has_value());
        if (big) {
            NC_CHECK_EQ(big->get_body().size(), std::size_t{100'000});
        }
        // A big answer can be left on the connection and pulled piece by piece; the size limit is
        // for answers held in memory, not for streams.
        ClientSettings tight = local;
        tight.set_max_response(1'000);
        const auto pulled =
            nc::federation::request(tight, "GET", plain_url + "/big", {}, "", 50'000);
        NC_CHECK(pulled.has_value());
        if (pulled) {
            NC_CHECK_EQ(pulled->get_status(), 200);
            NC_CHECK(pulled->is_streamed());
            NC_CHECK_EQ(pulled->get_stream_length(), std::uint64_t{100'000});
            NC_CHECK(pulled->read_body() == std::string(100'000, 'b'));
        }
        // Below the threshold the answer is read whole as before.
        const auto inline_answer =
            nc::federation::request(local, "GET", plain_url + "/big", {}, "", 200'000);
        NC_CHECK(inline_answer.has_value());
        if (inline_answer) {
            NC_CHECK(!inline_answer->is_streamed());
            NC_CHECK_EQ(inline_answer->get_body().size(), std::size_t{100'000});
        }
        // A redirect is returned as it is, never followed.
        const auto redirect =
            nc::federation::request(local, "GET", plain_url + "/redirect", {}, "");
        NC_CHECK(redirect.has_value());
        if (redirect) {
            NC_CHECK_EQ(redirect->get_status(), 302);
        }
        // Larger than allowed.
        ClientSettings small = local;
        small.set_max_response(1'000);
        NC_CHECK(!nc::federation::request(small, "GET", plain_url + "/big", {}, "").has_value());
        // Header injection is refused before anything is sent.
        NC_CHECK(!nc::federation::request(
                      local,
                      "GET",
                      plain_url + "/big",
                      {{"X-Bad", "a\r\nX-Evil: 1"}},
                      ""
        )
                      .has_value());

        // The default settings refuse plain http and local addresses.
        const ClientSettings strict;
        NC_CHECK(!nc::federation::request(strict, "GET", plain_url + "/big", {}, "").has_value());
        ClientSettings http_only;
        http_only.set_allow_http(true);
        const auto refused = nc::federation::request(http_only, "GET", plain_url + "/big", {}, "");
        NC_CHECK(!refused.has_value());
        if (!refused) {
            NC_CHECK(refused.error().find("local address") != std::string::npos);
        }

        // HTTPS: trusted with the certificate as anchor, host name checked, untrusted otherwise.
        ClientSettings trusted;
        trusted.set_allow_local(true);
        trusted.set_ca_file(std::string{cert});
        const std::string secure_name = "https://localhost:" + std::to_string(*secure_port);
        const auto over_tls = nc::federation::request(
            trusted,
            "POST",
            secure_name + "/echo",
            {},
            std::string(300'000, 't')
        );
        NC_CHECK(over_tls.has_value());
        if (over_tls) {
            NC_CHECK_EQ(over_tls->get_body().size(), std::size_t{300'000});
        }
        // A streamed answer over TLS keeps the TLS session alive for the pull.
        const auto tls_pulled =
            nc::federation::request(trusted, "GET", secure_name + "/big", {}, "", 50'000);
        NC_CHECK(tls_pulled.has_value());
        if (tls_pulled) {
            NC_CHECK(tls_pulled->is_streamed());
            NC_CHECK(tls_pulled->read_body() == std::string(100'000, 'b'));
        }
        const auto by_address = nc::federation::request(
            trusted,
            "POST",
            "https://127.0.0.1:" + std::to_string(*secure_port) + "/echo",
            {},
            "x"
        );
        NC_CHECK(by_address.has_value());
        ClientSettings no_trust;
        no_trust.set_allow_local(true);
        no_trust.set_ca_file(std::string{(dir / "key.pem").string()}
        ); // a file with no certificate in it
        NC_CHECK(!nc::federation::request(no_trust, "GET", secure_name + "/big", {}, "").has_value()
        );
        // The certificate is for localhost and 127.0.0.1, not for this name.
        const auto wrong_name = nc::federation::request(
            trusted,
            "GET",
            "https://localtest.me:" + std::to_string(*secure_port) + "/big",
            {},
            ""
        );
        NC_CHECK(!wrong_name.has_value());
    }
    plain.stop();
    secure.stop();
    kernel.stop();
    fs::remove_all(dir);
}

} // namespace

int main()
{
    test_parse_url();
    test_local_addresses();
    test_round_trip();
    return nc::testing::failures() == 0 ? 0 : 1;
}
