#include "nextcloud/runner/http_server.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "nextcloud/util/time.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <memory>
#include <openssl/curve25519.h>
#include <string>

namespace {

namespace fs = std::filesystem;
using nc::http::Request;
using nc::http::Response;

/// One server: its own users, files and database, reachable over real HTTP on a free local port.
struct Server
{
    std::string dir{};
    std::unique_ptr<nc::Kernel> kernel{};
    std::unique_ptr<nc::HttpServer> http{};
    std::uint16_t port{0};

    explicit Server(const std::string& name, const std::string& extra = {})
    {
        dir = (fs::temp_directory_path() / ("nc-fed-" + name + "-" + nc::util::random_hex(4)))
                  .string();
        fs::create_directories(dir);
        kernel = std::make_unique<nc::Kernel>(
            nc::Config::parse(
                "data_dir = " + dir +
                "\n[users]\npbkdf2_iterations = 3\n"
                "[federation]\nallow_http = true\nallow_local = true\ntimeout_seconds = "
                "10\nhandshake_timeout_seconds = 1\n" +
                extra
            )
                .value()
        );
        kernel->get_logger().set_sink({});
        for (const char* plugin: {"cloud", "users", "db", "federation", "notifications"}) {
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

    ~Server()
    {
        http->stop();
        kernel->stop();
        fs::remove_all(dir);
    }

    [[nodiscard]] std::string address() const
    {
        return "127.0.0.1:" + std::to_string(port);
    }

    void add_user(const std::string& name)
    {
        std::string out;
        ::setenv("OC_PASS", (name + " password").c_str(), 1);
        NC_CHECK_EQ(kernel->run_command("user:add", {name}, out), 0);
        ::unsetenv("OC_PASS");
    }

    Response call(
        const std::string& method,
        const std::string& path,
        const std::string& user = {},
        const std::string& body = {},
        const std::vector<nc::http::Header>& headers = {}
    ) const
    {
        Request request{std::string{method}, std::string{path}, "", std::string{body}, "", {}, {}};
        request.add_header("Host", address());
        if (!user.empty()) {
            request.add_header(
                "Authorization",
                "Basic " + nc::util::base64_encode(user + ":" + user + " password")
            );
        }
        for (const auto& [key, value]: headers) {
            request.add_header(std::string{key}, std::string{value});
        }
        return kernel->handle(std::move(request));
    }
};

bool contains(const Response& response, const std::string& text)
{
    return response.get_body().find(text) != std::string::npos;
}

std::string first_id(const Response& response)
{
    const std::string body = response.get_body();
    const std::size_t at = body.find("\"id\":");
    if (at == std::string::npos) {
        return {};
    }
    std::string id = body.substr(at + 5, body.find(',', at) - at - 5);
    std::erase(id, '"'); // shares have a string id, remote shares a number
    return id;
}

/// The id of the first entry of an OCS answer's data.
std::string data_id(const Response& response)
{
    const std::string body = response.get_body();
    const std::size_t data = body.find("\"data\":");
    return data == std::string::npos ? std::string{}
                                     : first_id(Response::text(200, body.substr(data)));
}

const std::string SHARES = "/ocs/v2.php/apps/files_sharing/api/v1/shares";
const std::string REMOTE = "/ocs/v2.php/apps/files_sharing/api/v1/remote_shares";

void test_sharing_between_servers()
{
    Server a{"a"};
    Server b{"b"};
    a.add_user("alice");
    b.add_user("bob");
    NC_CHECK_EQ(a.call("MKCOL", "/remote.php/dav/files/alice/Docs", "alice").get_status(), 201);
    NC_CHECK_EQ(
        a.call("PUT", "/remote.php/dav/files/alice/Docs/a.txt", "alice", "remote hello")
            .get_status(),
        201
    );
    NC_CHECK_EQ(
        a.call("PUT", "/remote.php/dav/files/alice/single.txt", "alice", "one file").get_status(),
        201
    );
    NC_CHECK_EQ(
        a.call("PUT", "/remote.php/dav/files/alice/secret.txt", "alice", "not shared").get_status(),
        201
    );

    // Both servers say they take part, to anyone.
    const Response discovery = b.call("GET", "/ocm-provider/");
    NC_CHECK_EQ(discovery.get_status(), 200);
    NC_CHECK(contains(discovery, "\"enabled\":true"));
    NC_CHECK(contains(discovery, "\"endPoint\":\"http://" + b.address() + "/ocm\""));
    NC_CHECK_EQ(b.call("GET", "/.well-known/ocm").get_status(), 200);

    // Alice shares a folder with bob on the other server.
    const Response sent =
        a.call("POST", SHARES, "alice", "path=/Docs&shareType=6&shareWith=bob@" + b.address());
    NC_CHECK_EQ(sent.get_status(), 200);
    if (sent.get_status() != 200) {
        std::fprintf(stderr, "send: %s\n", sent.get_body().c_str());
    }
    const std::string share_id = first_id(sent);

    // It waits for bob: not mounted, a notification, and the owner's name is shown.
    const Response pending = b.call("GET", REMOTE + "/pending", "bob");
    NC_CHECK_EQ(pending.get_status(), 200);
    NC_CHECK(contains(pending, "\"name\":\"/Docs\""));
    NC_CHECK(contains(pending, "\"owner\":\"alice@" + a.address() + "\""));
    NC_CHECK(contains(pending, "\"accepted\":false"));
    NC_CHECK(!contains(pending, "sharedSecret"));
    NC_CHECK(b.call("GET", REMOTE, "bob").get_body().find("Docs") == std::string::npos);
    NC_CHECK(contains(
        b.call("GET", "/ocs/v2.php/apps/notifications/api/v2/notifications", "bob"),
        "wants to share"
    ));
    NC_CHECK_EQ(b.call("GET", "/remote.php/dav/files/bob/Docs/a.txt", "bob").get_status(), 404);
    const std::string incoming_id = data_id(pending);
    NC_CHECK(!incoming_id.empty());

    // Only the person it is for can answer.
    NC_CHECK_EQ(b.call("POST", REMOTE + "/pending/" + incoming_id, "").get_status(), 401);
    b.add_user("mallory");
    NC_CHECK_EQ(b.call("POST", REMOTE + "/pending/" + incoming_id, "mallory").get_status(), 404);
    NC_CHECK_EQ(b.call("POST", REMOTE + "/pending/" + incoming_id, "bob").get_status(), 200);
    NC_CHECK_EQ(
        b.call("POST", REMOTE + "/pending/" + incoming_id, "bob").get_status(),
        404
    ); // once

    // The owner hears about it, and bob reads the folder as part of his own.
    NC_CHECK(contains(
        a.call("GET", "/ocs/v2.php/apps/notifications/api/v2/notifications", "alice"),
        "accepted"
    ));
    const Response file = b.call("GET", "/remote.php/dav/files/bob/Docs/a.txt", "bob");
    NC_CHECK_EQ(file.get_status(), 200);
    NC_CHECK_EQ(file.get_body(), "remote hello");
    const Response top =
        b.call("PROPFIND", "/remote.php/dav/files/bob/", "bob", "", {{"Depth", "1"}});
    NC_CHECK_EQ(top.get_status(), 207);
    NC_CHECK(contains(top, "/remote.php/dav/files/bob/Docs"));
    const Response inside =
        b.call("PROPFIND", "/remote.php/dav/files/bob/Docs", "bob", "", {{"Depth", "1"}});
    NC_CHECK_EQ(inside.get_status(), 207);
    NC_CHECK(contains(inside, "/remote.php/dav/files/bob/Docs/a.txt"));
    NC_CHECK(!contains(inside, "public.php"));
    NC_CHECK(!contains(inside, "secret.txt"));
    NC_CHECK_EQ(
        b.call("GET", "/remote.php/dav/files/bob/Docs/missing.txt", "bob").get_status(),
        404
    );
    NC_CHECK_EQ(
        b.call("GET", "/remote.php/dav/files/bob/Docs/../x", "bob").get_status() >= 400,
        true
    );
    // Read-only here, whatever the permissions on the other side.
    NC_CHECK_EQ(
        b.call("PUT", "/remote.php/dav/files/bob/Docs/new.txt", "bob", "x").get_status(),
        403
    );
    NC_CHECK_EQ(b.call("DELETE", "/remote.php/dav/files/bob/Docs/a.txt", "bob").get_status(), 403);
    // Another user of the same server sees nothing of it.
    NC_CHECK_EQ(
        b.call("GET", "/remote.php/dav/files/mallory/Docs/a.txt", "mallory").get_status(),
        404
    );

    // The owner withdraws the share: it is gone for bob.
    NC_CHECK_EQ(a.call("DELETE", SHARES + "/" + share_id, "alice").get_status(), 200);
    NC_CHECK_EQ(b.call("GET", "/remote.php/dav/files/bob/Docs/a.txt", "bob").get_status(), 404);
    NC_CHECK(b.call("GET", REMOTE, "bob").get_body().find("Docs") == std::string::npos);

    // A share bob declines disappears for the owner too.
    const Response again = a.call(
        "POST",
        SHARES,
        "alice",
        "path=/single.txt&shareType=6&shareWith=bob@" + b.address()
    );
    NC_CHECK_EQ(again.get_status(), 200);
    NC_CHECK(contains(a.call("GET", SHARES, "alice"), "\"share_type\":6"));
    const Response pending_file = b.call("GET", REMOTE + "/pending", "bob");
    NC_CHECK(contains(pending_file, "\"type\":\"file\""));
    NC_CHECK_EQ(
        b.call("DELETE", REMOTE + "/pending/" + data_id(pending_file), "bob").get_status(),
        200
    );
    NC_CHECK(!contains(a.call("GET", SHARES, "alice"), "\"share_type\":6"));
    NC_CHECK(contains(
        a.call("GET", "/ocs/v2.php/apps/notifications/api/v2/notifications", "alice"),
        "declined"
    ));

    // A share that allows changes: bob reads parts, writes, overwrites, makes folders, deletes.
    NC_CHECK_EQ(a.call("MKCOL", "/remote.php/dav/files/alice/Shared", "alice").get_status(), 201);
    NC_CHECK_EQ(
        a.call("PUT", "/remote.php/dav/files/alice/Shared/one.txt", "alice", "0123456789")
            .get_status(),
        201
    );
    const Response shared_made = a.call(
        "POST",
        SHARES,
        "alice",
        "path=/Shared&shareType=6&permissions=31&shareWith=bob@" + b.address()
    );
    NC_CHECK_EQ(shared_made.get_status(), 200);
    const std::string shared_id = data_id(b.call("GET", REMOTE + "/pending", "bob"));
    NC_CHECK(!shared_id.empty());
    NC_CHECK_EQ(b.call("POST", REMOTE + "/pending/" + shared_id, "bob").get_status(), 200);
    const std::string mine = "/remote.php/dav/files/bob/Shared";
    const Response part = b.call("GET", mine + "/one.txt", "bob", "", {{"Range", "bytes=2-5"}});
    NC_CHECK_EQ(part.get_status(), 206);
    NC_CHECK_EQ(part.get_body(), "2345");
    NC_CHECK_EQ(part.header("Content-Range"), "bytes 2-5/10");
    NC_CHECK_EQ(b.call("PUT", mine + "/new.txt", "bob", "from bob").get_status(), 201);
    NC_CHECK_EQ(
        a.call("GET", "/remote.php/dav/files/alice/Shared/new.txt", "alice").get_body(),
        "from bob"
    );
    NC_CHECK_EQ(b.call("PUT", mine + "/one.txt", "bob", "replaced").get_status(), 204);
    NC_CHECK_EQ(
        a.call("GET", "/remote.php/dav/files/alice/Shared/one.txt", "alice").get_body(),
        "replaced"
    );
    NC_CHECK_EQ(b.call("MKCOL", mine + "/sub", "bob").get_status(), 201);
    NC_CHECK_EQ(b.call("PUT", mine + "/sub/deep.txt", "bob", "deep").get_status(), 201);
    NC_CHECK_EQ(b.call("DELETE", mine + "/new.txt", "bob").get_status(), 204);
    NC_CHECK_EQ(
        a.call("GET", "/remote.php/dav/files/alice/Shared/new.txt", "alice").get_status(),
        404
    );
    NC_CHECK(contains(b.call("PROPFIND", mine, "bob", "", {{"Depth", "1"}}), mine + "/sub/"));
    // The mount itself cannot be written over or deleted; other verbs are refused.
    NC_CHECK_EQ(b.call("DELETE", mine, "bob").get_status(), 403);
    NC_CHECK_EQ(b.call("MOVE", mine + "/one.txt", "bob").get_status(), 403);
    NC_CHECK_EQ(b.call("PUT", mine + "/../escape.txt", "bob", "x").get_status() >= 400, true);
    NC_CHECK_EQ(a.call("GET", "/remote.php/dav/files/alice/escape.txt", "alice").get_status(), 404);

    NC_CHECK_EQ(a.call("DELETE", SHARES + "/" + first_id(shared_made), "alice").get_status(), 200);
    NC_CHECK_EQ(b.call("GET", mine + "/one.txt", "bob").get_status(), 404);

    // A server that is not there, or is not a cloud, gets nothing and nothing is left behind.
    NC_CHECK_EQ(
        a.call("POST", SHARES, "alice", "path=/Docs&shareType=6&shareWith=bob@127.0.0.1:1")
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        a.call("POST", SHARES, "alice", "path=/Docs&shareType=6&shareWith=bob").get_status(),
        400
    );
    NC_CHECK(!contains(a.call("GET", SHARES, "alice"), "\"share_type\":6"));
}

void test_incoming_protocol_is_strict()
{
    Server a{"sender"};
    Server b{"receiver"};
    a.add_user("alice");
    b.add_user("bob");
    const auto offer = [&](const std::string& json)
    {
        return b.call("POST", "/ocm/shares", "", json, {{"Content-Type", "application/json"}});
    };
    const std::string good =
        R"({"shareWith":"bob@)" + b.address() + R"(","name":"x","providerId":"7","owner":"alice@)" +
        a.address() +
        R"(","shareType":"user","resourceType":"file","protocol":{"name":"webdav","options":{"sharedSecret":"abcdefgh1234","permissions":["read"]}}})";
    NC_CHECK_EQ(offer("not json").get_status(), 400);
    NC_CHECK_EQ(offer("{}").get_status(), 400);
    // Unknown user, bad secret, bad provider id, wrong share type: all the same answer.
    const auto replaced = [&](const std::string& from, const std::string& to)
    {
        std::string copy = good;
        copy.replace(copy.find(from), from.size(), to);
        return copy;
    };
    NC_CHECK_EQ(offer(replaced("bob@", "nobody@")).get_status(), 400);
    NC_CHECK_EQ(offer(replaced("abcdefgh1234", "short")).get_status(), 400);
    NC_CHECK_EQ(offer(replaced("abcdefgh1234", "has space in it")).get_status(), 400);
    NC_CHECK_EQ(offer(replaced("\"7\"", "\"../7\"")).get_status(), 400);
    NC_CHECK_EQ(offer(replaced("\"user\"", "\"group\"")).get_status(), 400);
    NC_CHECK_EQ(offer(replaced("webdav", "other")).get_status(), 400);
    // An owner whose server is not reachable (or not OCM) is not believed.
    NC_CHECK_EQ(offer(replaced("alice@" + a.address(), "alice@127.0.0.1:1")).get_status(), 400);
    NC_CHECK_EQ(
        b.call("GET", REMOTE + "/pending", "bob").get_body().find("\"name\"") == std::string::npos,
        true
    );

    NC_CHECK_EQ(offer(good).get_status(), 201);
    NC_CHECK_EQ(offer(good).get_status(), 400); // the same share twice
    NC_CHECK(contains(b.call("GET", REMOTE + "/pending", "bob"), "\"remote_id\":\"7\""));
    // Notifications need the secret of the share they talk about.
    const auto notify = [&](const std::string& json)
    {
        return b
            .call("POST", "/ocm/notifications", "", json, {{"Content-Type", "application/json"}});
    };
    const std::string unshare =
        R"({"notificationType":"SHARE_UNSHARED","resourceType":"file","providerId":"7","notification":{"sharedSecret":"WRONGSECRET1"}})";
    NC_CHECK_EQ(notify(unshare).get_status(), 201);
    NC_CHECK(contains(b.call("GET", REMOTE + "/pending", "bob"), "\"remote_id\":\"7\"")
    ); // still there
    NC_CHECK_EQ(notify("junk").get_status(), 400);
    NC_CHECK_EQ(
        notify(
            R"({"notificationType":"BOGUS","providerId":"7","notification":{"sharedSecret":"abcdefgh1234"}})"
        )
            .get_status(),
        400
    );
    std::string right = unshare;
    right.replace(right.find("WRONGSECRET1"), 12, "abcdefgh1234");
    NC_CHECK_EQ(notify(right).get_status(), 201);
    NC_CHECK(!contains(b.call("GET", REMOTE + "/pending", "bob"), "\"remote_id\":\"7\""));
    // A name cannot reach outside the folder or hide.
    std::string tricky = replaced("\"x\"", "\"../.hidden/a\"");
    tricky.replace(tricky.find("\"7\""), 3, "\"8\"");
    NC_CHECK_EQ(offer(tricky).get_status(), 201);
    NC_CHECK(contains(b.call("GET", REMOTE + "/pending", "bob"), "\"name\":\"/_.hidden_a\""));
    // Answers to shares this server never sent are refused.
    NC_CHECK_EQ(
        a.call(
             "POST",
             "/ocm/notifications",
             "",
             R"({"notificationType":"SHARE_DECLINED","providerId":"1","notification":{"sharedSecret":"abcdefgh1234"}})"
        )
            .get_status(),
        400
    );
}

std::string base64_of(const unsigned char* data, std::size_t size)
{
    return nc::util::base64_encode(std::string_view{reinterpret_cast<const char*>(data), size});
}

void test_signatures_and_trust()
{
    Server a{"signer"};
    Server b{"strict", "require_signatures = true\n"};
    a.add_user("alice");
    b.add_user("bob");
    NC_CHECK_EQ(a.call("PUT", "/remote.php/dav/files/alice/f.txt", "alice", "x").get_status(), 201);

    // Servers sign what they send, so a strict receiver takes it.
    const Response sent =
        a.call("POST", SHARES, "alice", "path=/f.txt&shareType=6&shareWith=bob@" + b.address());
    NC_CHECK_EQ(sent.get_status(), 200);
    NC_CHECK(contains(b.call("GET", REMOTE + "/pending", "bob"), "\"name\":\"/f.txt\""));
    // The discovery document carries the key that is used.
    NC_CHECK(contains(a.call("GET", "/ocm-provider/"), "\"publicKey\":\""));

    // Unsigned, forged, stale and altered requests are refused by a server that asks for
    // signatures.
    const std::string good =
        R"({"shareWith":"bob@)" + b.address() + R"(","name":"y","providerId":"9","owner":"alice@)" +
        a.address() +
        R"(","shareType":"user","resourceType":"file","protocol":{"name":"webdav","options":{"sharedSecret":"abcdefgh1234","permissions":["read"]}}})";
    const auto post = [&](const std::string& body, const std::vector<nc::http::Header>& headers)
    {
        std::vector<nc::http::Header> all = headers;
        all.emplace_back("Content-Type", "application/json");
        all.emplace_back("Host", b.address());
        return b.call("POST", "/ocm/shares", "", body, all);
    };
    NC_CHECK_EQ(post(good, {}).get_status(), 401);

    // Build a signature with alice's server's own key, the way a client would.
    const std::string private_hex = [&]
    {
        const Response row =
            a.kernel->get_services().call("db.query", "sql=SELECT+private+FROM+nc_fed_keys");
        const auto form = nc::util::parse_form(row.get_body());
        return std::string{nc::util::trim(nc::util::form_value(form, "private"))};
    }();
    const auto private_key = nc::util::from_hex(private_hex);
    NC_CHECK(private_key.has_value() && private_key->size() == ED25519_PRIVATE_KEY_LEN);
    if (!private_key) {
        return;
    }
    const auto signed_headers =
        [&](const std::string& body, const std::string& date, const std::string& key_server)
    {
        const std::string digest = "SHA-256=" + nc::util::base64_encode(nc::util::sha256(body));
        const std::string text = "(request-target): post /ocm/shares\nhost: " + b.address() +
                                 "\ndate: " + date + "\ndigest: " + digest;
        std::uint8_t signature[ED25519_SIGNATURE_LEN];
        ED25519_sign(
            signature,
            reinterpret_cast<const std::uint8_t*>(text.data()),
            text.size(),
            reinterpret_cast<const std::uint8_t*>(private_key->data())
        );
        return std::vector<nc::http::Header>{
            {"Date", date},
            {"Digest", digest},
            {"Signature",
             "keyId=\"http://" + key_server +
                 "#main-key\",algorithm=\"ed25519\",headers=\"(request-target) host date "
                 "digest\",signature=\"" +
                 base64_of(signature, sizeof(signature)) + "\""}
        };
    };
    const std::string now = nc::util::http_date(std::chrono::system_clock::now());
    NC_CHECK_EQ(
        post(good, signed_headers(good, now, a.address())).get_status(),
        201
    ); // a valid one is taken
    const std::string other = std::string{good}.replace(good.find("\"9\""), 3, "\"10\"");
    // The signature belongs to another body.
    auto wrong_body = signed_headers(good, now, a.address());
    NC_CHECK_EQ(post(other, wrong_body).get_status(), 401);
    // Too old.
    const std::string old_date =
        nc::util::http_date(std::chrono::system_clock::now() - std::chrono::minutes{20});
    NC_CHECK_EQ(post(other, signed_headers(other, old_date, a.address())).get_status(), 401);
    // Signed by a server that is not the one named as the owner.
    NC_CHECK_EQ(post(other, signed_headers(other, now, "attacker.example")).get_status(), 401);
    // A damaged signature.
    auto damaged = signed_headers(other, now, a.address());
    damaged.back().second.replace(damaged.back().second.find("signature=\"") + 11, 4, "AAAA");
    NC_CHECK_EQ(post(other, damaged).get_status(), 401);
    NC_CHECK_EQ(post(other, signed_headers(other, now, a.address())).get_status(), 201);

    // A server only talks to the servers it trusts.
    Server c{"careful"};
    Server d{"stranger"};
    Server e{"friend"};
    Server f{"limited", "trusted_servers = " + e.address() + "\n"};
    c.add_user("carol");
    f.add_user("frank");
    e.add_user("erin");
    d.add_user("dave");
    NC_CHECK_EQ(f.call("PUT", "/remote.php/dav/files/frank/t.txt", "frank", "x").get_status(), 201);
    NC_CHECK_EQ(
        f.call("POST", SHARES, "frank", "path=/t.txt&shareType=6&shareWith=dave@" + d.address())
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        f.call("POST", SHARES, "frank", "path=/t.txt&shareType=6&shareWith=erin@" + e.address())
            .get_status(),
        200
    );
    // Shares offered by a server that is not trusted are not taken.
    NC_CHECK_EQ(d.call("PUT", "/remote.php/dav/files/dave/u.txt", "dave", "x").get_status(), 201);
    NC_CHECK_EQ(
        d.call("POST", SHARES, "dave", "path=/u.txt&shareType=6&shareWith=frank@" + f.address())
            .get_status(),
        400
    );
    NC_CHECK(!contains(f.call("GET", REMOTE + "/pending", "frank"), "u.txt"));
}

} // namespace

int main()
{
    test_sharing_between_servers();
    test_incoming_protocol_is_strict();
    test_signatures_and_trust();
    return NC_TEST_RESULT();
}
