#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "user_store.h"

#include <cstdlib>
#include <filesystem>

namespace {

using nc::http::Request;
using nc::http::Response;

std::string temp_dir(const std::string& name)
{
    const std::filesystem::path path = std::filesystem::temp_directory_path() /
                                       ("nc-users-" + name + "-" + nc::util::random_hex(4));
    std::filesystem::create_directories(path);
    return path.string();
}

void test_store()
{
    const std::string dir = temp_dir("store");
    {
        nc::users::UserStore store{dir + "/users.db", 5, 8};
        NC_CHECK(store.load().has_value());
        NC_CHECK(store.create("alice", "correct horse", "Alice A", "alice@example.com", false)
                     .has_value());
        NC_CHECK(store.find("alice")->is_admin()); // the first account is the administrator
        NC_CHECK(store.create("bob", "battery staple", "", "", false).has_value());
        NC_CHECK(!store.find("bob")->is_admin());
        NC_CHECK(!store.create("bob", "another one", "", "", false).has_value());
        NC_CHECK(!store.create("../etc", "abcdefgh", "", "", false).has_value());
        NC_CHECK(!store.create("carol", "short", "", "", false).has_value());
        NC_CHECK(!store.create("carol", "abcdefgh", "", "not-an-email", false).has_value());
        NC_CHECK(!store.create("carol", "abcdefgh", "tab\there", "", false).has_value());

        NC_CHECK_EQ(store.authenticate("alice", "correct horse").value_or("-"), "alice");
        NC_CHECK_EQ(
            store.authenticate("alice", "correct horse").value_or("-"),
            "alice"
        ); // remembered
        NC_CHECK(!store.authenticate("alice", "wrong").has_value());
        NC_CHECK(!store.authenticate("nobody", "correct horse").has_value());
        NC_CHECK(store.find("alice")->get_hash().size() == 64);
        NC_CHECK(store.find("alice")->get_hash() != store.find("bob")->get_hash());

        // A new password invalidates the remembered login at once, and so does disabling the
        // account.
        NC_CHECK(store.set_password("alice", "brand new pass").has_value());
        NC_CHECK(!store.authenticate("alice", "correct horse").has_value());
        NC_CHECK(store.authenticate("alice", "brand new pass").has_value());
        NC_CHECK(store.set_enabled("alice", false).has_value());
        NC_CHECK(!store.authenticate("alice", "brand new pass").has_value());
        NC_CHECK(store.set_enabled("alice", true).has_value());
    }
    // Everything survives a restart.
    nc::users::UserStore reloaded{dir + "/users.db", 5, 8};
    NC_CHECK(reloaded.load().has_value());
    NC_CHECK_EQ(reloaded.size(), std::size_t{2});
    NC_CHECK_EQ(reloaded.find("alice")->get_email(), "alice@example.com");
    NC_CHECK(reloaded.authenticate("alice", "brand new pass").has_value());
    NC_CHECK(reloaded.remove("bob").has_value());
    NC_CHECK(!reloaded.remove("bob").has_value());
    NC_CHECK(!reloaded.authenticate("bob", "battery staple").has_value());

    NC_CHECK(nc::users::UserStore::valid_email("a.b@example.org"));
    NC_CHECK(!nc::users::UserStore::valid_email("a@b"));
    NC_CHECK(!nc::users::UserStore::valid_email("a b@example.org"));
    NC_CHECK(!nc::users::UserStore::valid_email("a@@example.org"));
    NC_CHECK(!nc::users::UserStore::valid_email("a@example.org\r\nBcc: x@y.z"));
    std::filesystem::remove_all(dir);
}

Request with_auth(Request request, const std::string& credentials)
{
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

void test_plugin()
{
    const std::string dir = temp_dir("plugin");
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 5\n").value()
    };
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_library("plugins/users/libusers.so").has_value());
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{1});

    std::string out;
    ::setenv("OC_PASS", "admin password", 1);
    NC_CHECK_EQ(
        kernel.run_command(
            "user:add",
            {"admin", "--display-name=The Admin", "--email=admin@example.org"},
            out
        ),
        0
    );
    NC_CHECK_EQ(kernel.run_command("user:add", {"admin"}, out), 1); // exists
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    NC_CHECK_EQ(kernel.run_command("user:add", {"eve"}, out), 1); // no password given
    NC_CHECK_EQ(kernel.run_command("user:list", {}, out), 0);
    NC_CHECK(out.find("admin\tThe Admin\tadmin@example.org\tadmin") != std::string::npos);

    // Anonymous requests are asked to sign in; wrong passwords are refused.
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/ocs/v2.php/cloud/user"}).get_status(), 401);
    NC_CHECK_EQ(
        kernel.handle(with_auth(Request{"GET", "/ocs/v2.php/cloud/user"}, "admin:wrong"))
            .get_status(),
        401
    );

    const Response me =
        kernel.handle(with_auth(Request{"GET", "/ocs/v2.php/cloud/user"}, "admin:admin password"));
    NC_CHECK_EQ(me.get_status(), 200);
    NC_CHECK(me.get_body().find(R"("id":"admin")") != std::string::npos);
    NC_CHECK(me.get_body().find(R"("displayname":"The Admin")") != std::string::npos);

    // Only an administrator lists and creates accounts.
    NC_CHECK_EQ(
        kernel.handle(with_auth(Request{"GET", "/ocs/v2.php/cloud/users"}, "bob:bob password"))
            .get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(with_auth(Request{"GET", "/ocs/v2.php/cloud/users"}, "admin:admin password"))
            .get_status(),
        200
    );
    Request create{
        "POST",
        "/ocs/v2.php/cloud/users",
        "",
        "userid=carol&password=carol+password&email=carol%40example.org",
        "",
        {},
        {}
    };
    NC_CHECK_EQ(kernel.handle(with_auth(create, "admin:admin password")).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(with_auth(create, "admin:admin password")).get_status(), 409);
    NC_CHECK_EQ(kernel.handle(with_auth(create, "bob:bob password")).get_status(), 403);
    NC_CHECK(
        kernel.get_services().call("auth.authenticate", "carol:carol password").get_status() == 200
    );
    NC_CHECK_EQ(kernel.get_services().call("users.email", "carol").get_body(), "carol@example.org");

    // Self service: your own record and your own email, not somebody else's.
    NC_CHECK_EQ(
        kernel.handle(with_auth(Request{"GET", "/ocs/v2.php/cloud/users/bob"}, "bob:bob password"))
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel
            .handle(with_auth(Request{"GET", "/ocs/v2.php/cloud/users/admin"}, "bob:bob password"))
            .get_status(),
        403
    );
    Request edit{
        "PUT",
        "/ocs/v2.php/cloud/users/bob",
        "",
        "key=email&value=bob%40example.org",
        "",
        {},
        {}
    };
    NC_CHECK_EQ(kernel.handle(with_auth(edit, "bob:bob password")).get_status(), 200);
    NC_CHECK_EQ(kernel.get_services().call("users.email", "bob").get_body(), "bob@example.org");
    Request bad_edit{"PUT", "/ocs/v2.php/cloud/users/bob", "", "key=email&value=nope", "", {}, {}};
    NC_CHECK_EQ(kernel.handle(with_auth(bad_edit, "bob:bob password")).get_status(), 400);
    Request self_disable{
        "PUT",
        "/ocs/v2.php/cloud/users/bob",
        "",
        "key=enabled&value=false",
        "",
        {},
        {}
    };
    NC_CHECK_EQ(kernel.handle(with_auth(self_disable, "bob:bob password")).get_status(), 400);

    // Delete: not yourself, not as a normal user.
    NC_CHECK_EQ(
        kernel
            .handle(with_auth(
                Request{"DELETE", "/ocs/v2.php/cloud/users/admin"},
                "admin:admin password"
            ))
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                with_auth(Request{"DELETE", "/ocs/v2.php/cloud/users/carol"}, "bob:bob password")
            )
            .get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel
            .handle(with_auth(
                Request{"DELETE", "/ocs/v2.php/cloud/users/carol"},
                "admin:admin password"
            ))
            .get_status(),
        200
    );
    NC_CHECK_EQ(kernel.get_services().call("users.get", "carol").get_status(), 404);

    kernel.stop();
    std::filesystem::remove_all(dir);
}

} // namespace

int main()
{
    test_store();
    test_plugin();
    return NC_TEST_RESULT();
}
