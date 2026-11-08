#include "ber.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <arpa/inet.h>
#include <atomic>
#include <cstdlib>
#include <filesystem>
#include <mutex>
#include <netinet/in.h>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>

namespace {

using nc::http::Request;
namespace ber = nc::ldap::ber;

const std::string BASE = "dc=example,dc=org";
const std::string ADMIN = "cn=admin," + BASE;
const std::string ALICE = "uid=alice,ou=people," + BASE;
const std::string BOB = "uid=bob,ou=people," + BASE;

/// A directory with three people and an administrator, speaking just enough LDAP v3.
class FakeDirectory
{
public:
    FakeDirectory()
    {
        m_listen = ::socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        ::bind(m_listen, reinterpret_cast<sockaddr*>(&address), sizeof(address));
        ::listen(m_listen, 16);
        socklen_t size = sizeof(address);
        ::getsockname(m_listen, reinterpret_cast<sockaddr*>(&address), &size);
        m_port = std::to_string(ntohs(address.sin_port));
        m_thread = std::thread{[this]
                               {
                                   accept_loop();
                               }};
    }

    ~FakeDirectory()
    {
        stop();
    }

    void stop()
    {
        if (m_listen >= 0) {
            ::shutdown(m_listen, SHUT_RDWR);
            ::close(m_listen);
            m_listen = -1;
            if (m_thread.joinable()) {
                m_thread.join();
            }
        }
    }

    [[nodiscard]] const std::string& port() const
    {
        return m_port;
    }

    [[nodiscard]] std::vector<std::string> seen_values() const
    {
        const std::lock_guard lock{m_mutex};
        return m_seen;
    }

    [[nodiscard]] int user_binds() const
    {
        return m_user_binds;
    }

private:
    static std::string result(unsigned char op, int code, std::string_view text = {})
    {
        return ber::element(
            op,
            ber::integer(code, ber::ENUMERATED) + ber::octets("") + ber::octets(text)
        );
    }

    static std::string message(std::int64_t id, const std::string& op)
    {
        return ber::element(ber::SEQUENCE, ber::integer(id) + op);
    }

    static std::string
    entry(const std::string& dn, const std::vector<std::pair<std::string, std::string>>& attributes)
    {
        std::string list;
        for (const auto& [name, value]: attributes) {
            list += ber::element(
                ber::SEQUENCE,
                ber::octets(name) + ber::element(ber::SET, ber::octets(value))
            );
        }
        return ber::element(ber::SEARCH_ENTRY, ber::octets(dn) + ber::element(ber::SEQUENCE, list));
    }

    void accept_loop()
    {
        while (true) {
            const int client = ::accept(m_listen, nullptr, nullptr);
            if (client < 0) {
                return;
            }
            serve(client);
            ::close(client);
        }
    }

    void serve(int client)
    {
        std::string buffer;
        bool admin = false;
        char chunk[4'096];
        while (true) {
            std::optional<std::size_t> length;
            while (!(length = ber::complete_length(buffer)) || *length == 0) {
                if (!length) {
                    return;
                }
                const ssize_t got = ::recv(client, chunk, sizeof(chunk), 0);
                if (got <= 0) {
                    return;
                }
                buffer.append(chunk, static_cast<std::size_t>(got));
            }
            std::string_view raw{buffer.data(), *length};
            const auto outer = ber::read(raw);
            std::string_view inner = outer->content;
            const std::int64_t id = ber::as_integer(*ber::read(inner)).value_or(0);
            const auto op = *ber::read(inner);
            std::string reply;
            if (op.tag == ber::UNBIND_REQUEST) {
                return;
            }
            if (op.tag == ber::BIND_REQUEST) {
                std::string_view parts = op.content;
                (void)ber::read(parts);
                const std::string name{ber::read(parts)->content};
                const std::string password{ber::read(parts)->content};
                const bool good = (name.empty() && password.empty()) ||
                                  (name == ADMIN && password == "adminpw") ||
                                  (name == ALICE && password == "alicepw") ||
                                  (name == BOB && password == "bobpw");
                admin = good && name == ADMIN;
                if (good && name != ADMIN && !name.empty()) {
                    ++m_user_binds;
                }
                reply = message(
                    id,
                    result(ber::BIND_RESPONSE, good ? 0 : 49, good ? "" : "invalid credentials")
                );
            } else if (op.tag == ber::SEARCH_REQUEST) {
                std::string_view parts = op.content;
                for (int skip = 0; skip < 6; ++skip) {
                    (void)ber::read(parts);
                }
                const auto filter = ber::read(parts);
                std::string uid;
                std::string_view terms = filter->content;
                while (!terms.empty()) {
                    const auto term = ber::read(terms);
                    std::string_view pair = term->content;
                    const std::string attribute{ber::read(pair)->content};
                    const std::string value{ber::read(pair)->content};
                    if (attribute == "uid") {
                        uid = value;
                    }
                }
                {
                    const std::lock_guard lock{m_mutex};
                    m_seen.push_back(uid);
                }
                if (!admin) {
                    reply = message(
                        id,
                        result(ber::SEARCH_DONE, 50, "bind first")
                    ); // anonymous reads are not allowed
                } else {
                    if (uid == "alice") {
                        reply += message(
                            id,
                            entry(
                                ALICE,
                                {{"displayName", "Alice Liddell"}, {"mail", "alice@example.org"}}
                            )
                        );
                    } else if (uid == "bob") {
                        reply += message(
                            id,
                            entry(BOB, {{"displayName", "Bob"}, {"mail", "not-an-address"}})
                        );
                    } else if (uid == "twin") {
                        reply += message(id, entry("uid=twin,ou=a," + BASE, {})) +
                                 message(id, entry("uid=twin,ou=b," + BASE, {}));
                    }
                    reply += message(id, result(ber::SEARCH_DONE, 0));
                }
            }
            buffer.erase(0, *length);
            ::send(client, reply.data(), reply.size(), MSG_NOSIGNAL);
        }
    }

    int m_listen{-1};
    std::string m_port{};
    std::thread m_thread{};
    mutable std::mutex m_mutex{};
    std::vector<std::string> m_seen{};
    std::atomic<int> m_user_binds{0};
};

Request as(std::string path, const std::string& credentials)
{
    Request request{"GET", std::move(path)};
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

void test_ber()
{
    NC_CHECK_EQ(ber::integer(0), std::string("\x02\x01\x00", 3));
    NC_CHECK_EQ(ber::integer(127), std::string("\x02\x01\x7f", 3));
    NC_CHECK_EQ(ber::integer(128), std::string("\x02\x02\x00\x80", 4));
    NC_CHECK_EQ(ber::integer(-1), std::string("\x02\x01\xff", 3));
    NC_CHECK_EQ(ber::integer(-129), std::string("\x02\x02\xff\x7f", 4));
    NC_CHECK_EQ(ber::integer(3, ber::ENUMERATED), std::string("\x0a\x01\x03", 3));
    NC_CHECK_EQ(ber::encode_length(5), std::string("\x05", 1));
    NC_CHECK_EQ(ber::encode_length(300), std::string("\x82\x01\x2c", 3));
    for (const std::int64_t value:
         {0, 1, 127, 128, 255, 256, 65'535, 100'000, -1, -128, -129, -70'000}) {
        std::string encoded = ber::integer(value);
        std::string_view view{encoded};
        NC_CHECK_EQ(ber::as_integer(*ber::read(view)).value_or(999'999), value);
    }
    // Long contents round trip, cut-off and malformed input is refused, never read past the end.
    const std::string big(70'000, 'x');
    std::string encoded = ber::octets(big);
    NC_CHECK_EQ(ber::complete_length(encoded).value_or(1), encoded.size());
    NC_CHECK_EQ(
        ber::complete_length(std::string_view{encoded}.substr(0, 100)).value_or(1),
        std::size_t{0}
    );
    std::string_view whole{encoded};
    NC_CHECK_EQ(ber::read(whole)->content.size(), big.size());
    std::string_view cut{encoded.data(), 1'000};
    NC_CHECK(!ber::read(cut).has_value());
    NC_CHECK(!ber::complete_length(std::string("\x04\x80", 2)).has_value()); // indefinite length
    NC_CHECK(!ber::complete_length(std::string("\x04\x85\x01\x02\x03\x04\x05", 7)).has_value()
    ); // length of 5 bytes
    std::string_view empty;
    NC_CHECK(!ber::read(empty).has_value());
}

} // namespace

int main()
{
    test_ber();
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-ldap-" + nc::util::random_hex(4))).string();
    FakeDirectory directory;
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[ldap]\nhost = 127.0.0.1\nport = " +
                          directory.port() + "\nbase_dn = " + BASE + "\nbind_dn = " + ADMIN +
                          "\nbind_password = adminpw\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"ldap", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{3});
    std::string out;
    ::setenv("OC_PASS", "carol password", 1);
    NC_CHECK_EQ(
        kernel.run_command("user:add", {"carol"}, out),
        0
    ); // a local account, not in the directory
    ::unsetenv("OC_PASS");
    const std::string who = "/ocs/v2.php/cloud/user";

    // A person in the directory signs in with the directory password and gets an account.
    const auto alice = kernel.handle(as(who, "alice:alicepw"));
    NC_CHECK_EQ(alice.get_status(), 200);
    NC_CHECK(alice.get_body().find("\"id\":\"alice\"") != std::string::npos);
    NC_CHECK(alice.get_body().find("\"displayname\":\"Alice Liddell\"") != std::string::npos);
    NC_CHECK(alice.get_body().find("\"email\":\"alice@example.org\"") != std::string::npos);
    NC_CHECK_EQ(kernel.get_services().call("users.email", "alice").get_body(), "alice@example.org");
    NC_CHECK_EQ(
        kernel.handle(as(who, "alice:alicepw")).get_status(),
        200
    ); // remembered: no second round trip
    NC_CHECK_EQ(directory.user_binds(), 1);

    // Wrong or empty passwords, strangers, ambiguous entries and filter tricks all fail.
    NC_CHECK_EQ(kernel.handle(as(who, "alice:wrong")).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(as(who, "alice:")).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(as(who, "nobody:alicepw")).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(as(who, "twin:whatever")).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(as(who, "*:alicepw")).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(as(who, "alice)(uid=*:alicepw")).get_status(), 401);
    const auto seen = directory.seen_values();
    NC_CHECK(
        std::find(seen.begin(), seen.end(), "alice)(uid=*") != seen.end()
    ); // sent as a plain value, not as filter syntax
    NC_CHECK(std::find(seen.begin(), seen.end(), "*") != seen.end());
    NC_CHECK_EQ(directory.user_binds(), 1); // none of those reached a user bind

    // A bad mail address in the directory does not stop the sign-in.
    const auto bob = kernel.handle(as(who, "bob:bobpw"));
    NC_CHECK_EQ(bob.get_status(), 200);
    NC_CHECK(bob.get_body().find("\"email\":\"\"") != std::string::npos);

    // Local accounts keep working beside the directory, and the directory account's own random
    // password is not a way in.
    NC_CHECK_EQ(kernel.handle(as(who, "carol:carol password")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(as(who, "alice:alicepw ")).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(as(who, "carol:alicepw")).get_status(), 401);

    NC_CHECK_EQ(kernel.run_command("ldap:search", {"alice"}, out), 0);
    NC_CHECK(
        out.find("dn: " + ALICE) != std::string::npos &&
        out.find("mail: alice@example.org") != std::string::npos
    );
    NC_CHECK_EQ(kernel.run_command("ldap:search", {"nobody"}, out), 1);

    // The directory goes away: people who just signed in still can, others cannot, local accounts
    // are fine.
    directory.stop();
    NC_CHECK_EQ(kernel.handle(as(who, "alice:alicepw")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(as(who, "dave:davepw")).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(as(who, "carol:carol password")).get_status(), 200);
    kernel.stop();

    // Without a directory configured the plugin refuses to start instead of silently doing nothing.
    nc::Kernel bare;
    bare.get_logger().set_sink({});
    NC_CHECK(bare.add_plugin_library("plugins/ldap/libldap.so").has_value());
    NC_CHECK(bare.add_plugin_library("plugins/users/libusers.so").has_value());
    NC_CHECK(bare.start().has_value());
    NC_CHECK_EQ(bare.running_count(), std::size_t{1});

    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
