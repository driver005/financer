#include "dav.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "share_store.h"
#include "storage.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <unistd.h>

namespace {

namespace fs = std::filesystem;
using nc::cloud::Storage;
using nc::cloud::StorageCode;
using nc::http::Request;
using nc::http::Response;

std::string temp_dir(const std::string& name)
{
    const fs::path path =
        fs::temp_directory_path() / ("nc-cloud-" + name + "-" + nc::util::random_hex(4));
    fs::create_directories(path);
    return path.string();
}

std::string slurp(const fs::path& path)
{
    std::ifstream stream{path, std::ios::binary};
    std::ostringstream text;
    text << stream.rdbuf();
    return text.str();
}

// ---- storage -----------------------------------------------------------------------------------

void test_normalize()
{
    NC_CHECK_EQ(Storage::normalize("").value_or("?"), "/");
    NC_CHECK_EQ(Storage::normalize("//a///b/").value_or("?"), "/a/b");
    NC_CHECK(!Storage::normalize("/a/../b"));
    NC_CHECK(!Storage::normalize("/a/./b"));
    NC_CHECK(!Storage::normalize(".."));
    NC_CHECK(!Storage::normalize(std::string("/a\0b", 4)));
    NC_CHECK(!Storage::normalize("/a\\b"));
    NC_CHECK(!Storage::normalize("/.nc-part-123")); // the prefix of our own temporary files
    NC_CHECK(!Storage::normalize("/" + std::string(256, 'x')));
    NC_CHECK(Storage::normalize("/" + std::string(255, 'x')).has_value());
    NC_CHECK_EQ(Storage::normalize("/ü/ß.txt").value_or("?"), "/ü/ß.txt");
}

void test_storage()
{
    const std::string dir = temp_dir("storage");
    const Storage storage{dir + "/alice/files"};
    NC_CHECK(storage.ensure_root().has_value());

    NC_CHECK(storage.write("/a.txt", "hello").value_or(false));
    NC_CHECK(!storage.write("/a.txt", "hello again").value_or(true)); // false = it existed
    NC_CHECK_EQ(storage.read("/a.txt").value_or("?"), "hello again");
    NC_CHECK_EQ(storage.stat("/a.txt")->get_size(), std::uint64_t{11});
    NC_CHECK(!storage.write("/missing/b.txt", "x").has_value());
    NC_CHECK(
        storage.write("/missing/b.txt", "x").error().get_code() == StorageCode::PARENT_MISSING
    );
    NC_CHECK(storage.make_directory("/docs").has_value());
    NC_CHECK(storage.make_directory("/docs").error().get_code() == StorageCode::EXISTS);
    NC_CHECK(storage.make_directory("/x/y").error().get_code() == StorageCode::PARENT_MISSING);
    NC_CHECK(storage.write("/docs", "x").error().get_code() == StorageCode::IS_DIRECTORY);
    NC_CHECK(storage.read("/docs").error().get_code() == StorageCode::IS_DIRECTORY);
    NC_CHECK(storage.read("/nope").error().get_code() == StorageCode::NOT_FOUND);
    NC_CHECK(storage.write("/docs/b.txt", "bbb").has_value());

    // A change changes the ETag.
    const std::string etag = storage.stat("/a.txt")->get_etag();
    NC_CHECK(storage.write("/a.txt", "changed").has_value());
    NC_CHECK(storage.stat("/a.txt")->get_etag() != etag);

    // Listing: sorted, no temporary files.
    {
        std::ofstream{dir + "/alice/files/.nc-part-leftover"} << "tmp";
    }
    const auto nodes = storage.list("/").value();
    NC_CHECK_EQ(nodes.size(), std::size_t{2});
    NC_CHECK_EQ(nodes[0].get_path(), "/a.txt");
    NC_CHECK_EQ(nodes[1].get_path(), "/docs");
    NC_CHECK(nodes[1].is_directory());
    NC_CHECK_EQ(storage.size_of("/").value_or(0), std::uint64_t{7 + 3});
    NC_CHECK(storage.list("/a.txt").error().get_code() == StorageCode::NOT_DIRECTORY);

    // Move and copy, with and without overwrite; a folder never goes into itself.
    NC_CHECK(storage.copy("/docs", "/docs2", false).value_or(false));
    NC_CHECK_EQ(storage.read("/docs2/b.txt").value_or("?"), "bbb");
    NC_CHECK(storage.copy("/docs", "/docs2", false).error().get_code() == StorageCode::EXISTS);
    NC_CHECK(storage.copy("/docs", "/docs2", true).has_value());
    NC_CHECK(storage.move("/a.txt", "/moved.txt", false).value_or(false));
    NC_CHECK(storage.stat("/a.txt").error().get_code() == StorageCode::NOT_FOUND);
    NC_CHECK(
        storage.move("/docs", "/docs/inner", false).error().get_code() == StorageCode::INVALID_PATH
    );
    NC_CHECK(storage.move("/", "/x", false).error().get_code() == StorageCode::INVALID_PATH);
    NC_CHECK(storage.move("/nope", "/x", false).error().get_code() == StorageCode::NOT_FOUND);
    NC_CHECK(
        storage.move("/moved.txt", "/nodir/x", false).error().get_code() ==
        StorageCode::PARENT_MISSING
    );

    NC_CHECK(storage.remove("/docs2").has_value());
    NC_CHECK(storage.remove("/docs2").error().get_code() == StorageCode::NOT_FOUND);
    NC_CHECK(storage.remove("/").error().get_code() == StorageCode::INVALID_PATH);

    // A symbolic link planted in the tree is never followed.
    fs::create_directory_symlink("/etc", dir + "/alice/files/evil");
    NC_CHECK(!storage.read("/evil/passwd").has_value());
    NC_CHECK(!storage.list("/evil").has_value());
    NC_CHECK(!storage.write("/evil/x", "x").has_value());
    NC_CHECK(!fs::exists("/etc/x"));
    bool listed_link = false;
    // Bound to a name first: `for (x : f().value())` would iterate a destroyed temporary before
    // C++23.
    const auto top_level = storage.list("/").value();
    for (const auto& node: top_level) {
        listed_link = listed_link || node.get_path() == "/evil";
    }
    NC_CHECK(!listed_link);

    // The quota counts what is stored.
    const Storage small{dir + "/bob/files", 10};
    NC_CHECK(small.ensure_root().has_value());
    NC_CHECK(small.write("/a", "123456").has_value());
    NC_CHECK(small.write("/b", "12345").error().get_code() == StorageCode::QUOTA);
    NC_CHECK(small.write("/a", "1234567890").has_value()); // replacing counts the old size out
    NC_CHECK(small.copy("/a", "/c", false).error().get_code() == StorageCode::QUOTA);

    fs::remove_all(dir);
}

void test_share_store()
{
    const std::string dir = temp_dir("shares");
    nc::cloud::ShareStore store{dir + "/shares.db"};
    NC_CHECK(store.load().has_value());
    const auto link = store.add(nc::cloud::Share{"alice", "/docs"});
    NC_CHECK(link.has_value());
    NC_CHECK_EQ(link->get_token().size(), std::size_t{20});
    NC_CHECK_EQ(link->get_id(), std::uint64_t{1});
    nc::cloud::Share user_share{"alice", "/docs/b.txt"};
    user_share.set_type(nc::cloud::SHARE_TYPE_USER);
    user_share.set_share_with("bob");
    user_share.set_expires(1); // long expired
    NC_CHECK(store.add(std::move(user_share)).has_value());

    NC_CHECK(store.find_by_token(link->get_token()).has_value());
    NC_CHECK(!store.find_by_token("nope").has_value());
    NC_CHECK_EQ(store.shared_with("bob").size(), std::size_t{1});
    NC_CHECK(store.shared_with("bob")[0].expired(100));
    NC_CHECK_EQ(store.owned_by("alice").size(), std::size_t{2});

    store.rename_under("alice", "/docs", "/papers");
    NC_CHECK_EQ(store.find(1)->get_path(), "/papers");
    NC_CHECK_EQ(store.find(2)->get_path(), "/papers/b.txt");
    NC_CHECK_EQ(store.remove_under("alice", "/pap"), std::size_t{0}); // a prefix is not a parent
    NC_CHECK_EQ(store.prune_expired(1'000), std::size_t{1});

    nc::cloud::ShareStore reloaded{dir + "/shares.db"};
    NC_CHECK(reloaded.load().has_value());
    NC_CHECK_EQ(reloaded.all().size(), std::size_t{1});
    NC_CHECK_EQ(reloaded.remove_under("alice", "/papers"), std::size_t{1});
    NC_CHECK(reloaded.add(nc::cloud::Share{"alice", "/x"})->get_id() >= 3); // ids are never reused
    fs::remove_all(dir);
}

// ---- the plugins together ----------------------------------------------------------------------

Request req(std::string method, std::string path, std::string query = {}, std::string body = {})
{
    return Request{
        std::move(method),
        std::move(path),
        std::move(query),
        std::move(body),
        std::string{},
        {},
        {}
    };
}

Request as(Request request, const std::string& credentials)
{
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

const std::string ALICE = "alice:alice password";
const std::string BOB = "bob:bob password";

void test_plugins()
{
    const std::string dir = temp_dir("plugins");
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\noverwrite_url = https://cloud.example.org\n[users]\npbkdf2_iterations "
                          "= 3\n[mail]\nfrom_address = cloud@example.org\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_library("plugins/cloud/libcloud.so").has_value()
    ); // before its requirement on purpose
    NC_CHECK(kernel.add_plugin_library("plugins/mail/libmail.so").has_value());
    NC_CHECK(kernel.add_plugin_library("plugins/users/libusers.so").has_value());
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{3});

    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice", "--email=alice@example.org"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob", "--email=bob@example.org"}, out), 0);
    ::unsetenv("OC_PASS");

    const std::string root = "/remote.php/dav/files/alice";

    // Files need a sign-in, and only for your own tree.
    NC_CHECK_EQ(kernel.handle(Request{"PROPFIND", root + "/"}).get_status(), 401);
    NC_CHECK_EQ(kernel.handle(as(Request{"PROPFIND", root + "/"}, BOB)).get_status(), 403);
    NC_CHECK_EQ(kernel.handle(as(req("PUT", root + "/x.txt", "", "x"), BOB)).get_status(), 403);

    // PUT / GET / HEAD.
    Request put{"PUT", root + "/hello.txt", "", "Hello cloud", "", {}, {}};
    NC_CHECK_EQ(kernel.handle(as(put, ALICE)).get_status(), 201);
    const Response overwritten = kernel.handle(as(put, ALICE));
    NC_CHECK_EQ(overwritten.get_status(), 204);
    NC_CHECK(!overwritten.header("ETag").empty());
    const Response got = kernel.handle(as(Request{"GET", root + "/hello.txt"}, ALICE));
    NC_CHECK_EQ(got.get_status(), 200);
    NC_CHECK_EQ(got.get_body(), "Hello cloud");
    NC_CHECK_EQ(got.get_content_type(), "text/plain");
    NC_CHECK(
        std::string(got.header("Content-Security-Policy")).find("sandbox") != std::string::npos
    );
    NC_CHECK_EQ(std::string(got.header("X-Content-Type-Options")), "nosniff");
    NC_CHECK(std::string(got.header("Content-Disposition")).find("hello.txt") != std::string::npos);
    const Response head = kernel.handle(as(Request{"HEAD", root + "/hello.txt"}, ALICE));
    NC_CHECK(head.get_body().empty());
    NC_CHECK_EQ(std::string(head.header("Content-Length")), "11");
    NC_CHECK_EQ(kernel.handle(as(Request{"GET", root + "/missing.txt"}, ALICE)).get_status(), 404);

    // The stored file really is under the data directory, owned by the user.
    NC_CHECK_EQ(slurp(dir + "/alice/files/hello.txt"), "Hello cloud");

    // Folders, names with spaces and non-ASCII characters.
    NC_CHECK_EQ(kernel.handle(as(Request{"MKCOL", root + "/Documents"}, ALICE)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(as(Request{"MKCOL", root + "/Documents"}, ALICE)).get_status(), 405);
    NC_CHECK_EQ(kernel.handle(as(Request{"MKCOL", root + "/a/b/c"}, ALICE)).get_status(), 409);
    NC_CHECK_EQ(
        kernel
            .handle(as(req("PUT", root + "/Documents/Gr%C3%BC%C3%9Fe%20Welt.md", "", "# Hi"), ALICE)
            )
            .get_status(),
        201
    );
    NC_CHECK(fs::exists(dir + "/alice/files/Documents/Grüße Welt.md"));

    // PROPFIND: depth 0, depth 1, depth infinity, missing.
    const Response listing = kernel.handle(as(
        [&]
        {
            Request r{"PROPFIND", root + "/"};
            r.add_header("Depth", "1");
            return r;
        }(),
        ALICE
    ));
    NC_CHECK_EQ(listing.get_status(), 207);
    NC_CHECK(listing.get_content_type().find("xml") != std::string::npos);
    NC_CHECK(listing.get_body().find("<d:href>" + root + "/</d:href>") != std::string::npos);
    NC_CHECK(
        listing.get_body().find("<d:href>" + root + "/hello.txt</d:href>") != std::string::npos
    );
    NC_CHECK(
        listing.get_body().find("<d:href>" + root + "/Documents/</d:href>") != std::string::npos
    );
    NC_CHECK(listing.get_body().find("<d:collection/>") != std::string::npos);
    NC_CHECK(
        listing.get_body().find("<d:getcontentlength>11</d:getcontentlength>") != std::string::npos
    );
    NC_CHECK(
        listing.get_body().find("Gr%C3%BC%C3%9Fe") == std::string::npos
    ); // depth 1 does not go into Documents
    const Response only_self = kernel.handle(as(
        [&]
        {
            Request r{"PROPFIND", root + "/Documents"};
            r.add_header("Depth", "0");
            return r;
        }(),
        ALICE
    ));
    NC_CHECK(only_self.get_body().find("hello.txt") == std::string::npos);
    NC_CHECK(only_self.get_body().find("<oc:size>4</oc:size>") != std::string::npos);
    NC_CHECK_EQ(
        kernel
            .handle(as(
                [&]
                {
                    Request r{"PROPFIND", root + "/"};
                    r.add_header("Depth", "infinity");
                    return r;
                }(),
                ALICE
            ))
            .get_status(),
        403
    );
    NC_CHECK_EQ(kernel.handle(as(Request{"PROPFIND", root + "/nothing"}, ALICE)).get_status(), 404);

    // MOVE and COPY with a full URL as destination, Overwrite handling.
    Request copy{"COPY", root + "/hello.txt"};
    copy.add_header("Destination", "https://cloud.example.org" + root + "/Documents/copy.txt");
    NC_CHECK_EQ(kernel.handle(as(copy, ALICE)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(as(copy, ALICE)).get_status(), 204);
    Request no_overwrite = copy;
    no_overwrite.add_header("Overwrite", "F");
    NC_CHECK_EQ(kernel.handle(as(no_overwrite, ALICE)).get_status(), 412);
    Request move{"MOVE", root + "/Documents/copy.txt"};
    move.add_header("Destination", root + "/moved.txt");
    NC_CHECK_EQ(kernel.handle(as(move, ALICE)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(as(Request{"GET", root + "/Documents/copy.txt"}, ALICE)).get_status(),
        404
    );
    Request elsewhere{"MOVE", root + "/moved.txt"};
    elsewhere.add_header("Destination", "/remote.php/dav/files/bob/stolen.txt");
    NC_CHECK_EQ(kernel.handle(as(elsewhere, ALICE)).get_status(), 502);
    NC_CHECK(!fs::exists(dir + "/bob/files/stolen.txt"));
    Request into_self{"MOVE", root + "/Documents"};
    into_self.add_header("Destination", root + "/Documents/Documents");
    NC_CHECK_EQ(kernel.handle(as(into_self, ALICE)).get_status(), 400);

    // Path traversal in every spelling.
    for (const char* attack:
         {"/../bob/files/x",
          "/%2e%2e/bob/files/x",
          "/Documents/../../bob/x",
          "/Documents/%2e%2e%2f%2e%2e/x"}) {
        NC_CHECK_EQ(kernel.handle(as(req("PUT", root + attack, "", "x"), ALICE)).get_status(), 400);
        NC_CHECK_EQ(kernel.handle(as(Request{"GET", root + attack}, ALICE)).get_status(), 400);
    }
    NC_CHECK(!fs::exists(dir + "/bob/files/x"));
    NC_CHECK_EQ(
        kernel.handle(as(Request{"GET", "/remote.php/dav/files/..%2Fbob/x"}, ALICE)).get_status(),
        403
    );

    // Legacy WebDAV path.
    NC_CHECK_EQ(
        kernel.handle(as(Request{"GET", "/remote.php/webdav/hello.txt"}, ALICE)).get_body(),
        "Hello cloud"
    );
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/remote.php/webdav/hello.txt"}).get_status(), 401);

    // ---- sharing --------------------------------------------------------------------------------
    const std::string shares = "/ocs/v2.php/apps/files_sharing/api/v1/shares";
    Request link = req("POST", shares, "", "path=%2Fhello.txt&shareType=3");
    NC_CHECK_EQ(kernel.handle(Request{link}).get_status(), 401);
    const Response created = kernel.handle(as(link, ALICE));
    NC_CHECK_EQ(created.get_status(), 200);
    const std::string body = created.get_body();
    const std::size_t token_at = body.find("\"token\":\"") + 9;
    const std::string token = body.substr(token_at, body.find('"', token_at) - token_at);
    NC_CHECK_EQ(token.size(), std::size_t{20});
    NC_CHECK(
        body.find("\"url\":\"https://cloud.example.org/s/" + token + "\"") != std::string::npos
    );
    NC_CHECK(body.find("\"item_type\":\"file\"") != std::string::npos);

    NC_CHECK_EQ(
        kernel.handle(as(req("POST", shares, "", "path=%2Fnope&shareType=3"), ALICE)).get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(as(req("POST", shares, "", "path=%2F&shareType=3"), ALICE)).get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(as(req("POST", shares, "", "path=%2Fhello.txt&shareType=9"), ALICE))
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                as(req("POST", shares, "", "path=%2Fhello.txt&shareType=3&expireDate=2001-01-01"),
                   ALICE)
            )
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                as(req("POST", shares, "", "path=%2Fhello.txt&shareType=3&expireDate=2999-01-01"),
                   ALICE)
            )
            .get_status(),
        200
    );

    // A public link needs no sign-in, serves the file, and says nothing about anything else.
    const Response download = kernel.handle(Request{"GET", "/s/" + token});
    NC_CHECK_EQ(download.get_status(), 200);
    NC_CHECK_EQ(download.get_body(), "Hello cloud");
    NC_CHECK(!download.header("Content-Disposition").empty());
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + token + "/download"}).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + token + "/other"}).get_status(), 404);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + std::string(20, '0')}).get_status(), 404);

    // A folder link lists the folder, serves files inside it and cannot be escaped.
    const Response folder =
        kernel.handle(as(req("POST", shares, "", "path=%2FDocuments&shareType=3"), ALICE));
    const std::size_t folder_token_at = folder.get_body().find("\"token\":\"") + 9;
    const std::string folder_token = folder.get_body().substr(folder_token_at, 20);
    const Response index = kernel.handle(Request{"GET", "/s/" + folder_token});
    NC_CHECK_EQ(index.get_status(), 200);
    NC_CHECK(index.get_body().find(R"("name":"Documents")") != std::string::npos);
    NC_CHECK(index.get_body().find("Grüße Welt.md") != std::string::npos);
    NC_CHECK_EQ(
        kernel.handle(Request{"GET", "/s/" + folder_token + "/Gr%C3%BC%C3%9Fe%20Welt.md"})
            .get_body(),
        "# Hi"
    );
    NC_CHECK_EQ(
        kernel.handle(Request{"GET", "/s/" + folder_token + "/../hello.txt"}).get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(Request{"GET", "/s/" + folder_token + "/%2e%2e/hello.txt"}).get_status(),
        404
    );

    // A user share notifies the recipient by mail (cloud event -> mail plugin).
    const std::string spool = dir + "/mail-spool";
    std::size_t mails_before = 0;
    for ([[maybe_unused]] const auto& entry: fs::directory_iterator{spool}) {
        ++mails_before;
    }
    const Response to_bob = kernel.handle(
        as(req("POST", shares, "", "path=%2Fhello.txt&shareType=0&shareWith=bob"), ALICE)
    );
    NC_CHECK_EQ(to_bob.get_status(), 200);
    NC_CHECK(
        to_bob.get_body().find("\"token\"") == std::string::npos
    ); // a user share has no public token
    bool notified = false;
    for (const auto& entry: fs::directory_iterator{spool}) {
        if (entry.path().extension() == ".eml") {
            const std::string text = slurp(entry.path());
            notified =
                notified || (text.find("To: bob@example.org") != std::string::npos &&
                             text.find("shared \"/hello.txt\" with you") != std::string::npos);
        }
    }
    NC_CHECK(notified);
    NC_CHECK_EQ(
        kernel
            .handle(
                as(req("POST", shares, "", "path=%2Fhello.txt&shareType=0&shareWith=alice"), ALICE)
            )
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                as(req("POST", shares, "", "path=%2Fhello.txt&shareType=0&shareWith=ghost"), ALICE)
            )
            .get_status(),
        404
    );

    // Bob sees what was shared with him, alice sees what she shares; nobody else's shares.
    const Response bobs = kernel.handle(as(req("GET", shares, "shared_with_me=true", ""), BOB));
    NC_CHECK_EQ(bobs.get_status(), 200);
    NC_CHECK(bobs.get_body().find(R"("uid_owner":"alice")") != std::string::npos);
    NC_CHECK(
        kernel.handle(as(req("GET", shares, "", ""), BOB)).get_body().find("alice") ==
        std::string::npos
    );
    NC_CHECK_EQ(
        kernel.handle(as(Request{"DELETE", shares + "/1"}, BOB)).get_status(),
        404
    ); // not his to delete

    // Deleting a file removes the links to it; moving it keeps them pointing at it.
    NC_CHECK_EQ(kernel.handle(as(Request{"DELETE", root + "/hello.txt"}, ALICE)).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + token}).get_status(), 404);
    Request rename{"MOVE", root + "/Documents"};
    rename.add_header("Destination", root + "/Papers");
    NC_CHECK_EQ(kernel.handle(as(rename, ALICE)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(Request{"GET", "/s/" + folder_token + "/Gr%C3%BC%C3%9Fe%20Welt.md"})
            .get_body(),
        "# Hi"
    );

    // Commands.
    NC_CHECK_EQ(kernel.run_command("files:usage", {"alice"}, out), 0);
    NC_CHECK_EQ(out, "15\n"); // the 4 byte note and the 11 byte moved file
    NC_CHECK_EQ(kernel.run_command("files:usage", {"../bob"}, out), 1);
    NC_CHECK_EQ(kernel.run_command("share:list", {}, out), 0);
    NC_CHECK(out.find("link") != std::string::npos);

    // Deleting an account drops its shares.
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + folder_token}).get_status(), 200);
    NC_CHECK_EQ(kernel.run_command("user:delete", {"alice"}, out), 0);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + folder_token}).get_status(), 404);

    kernel.stop();
    fs::remove_all(dir);
}

void test_quota_through_dav()
{
    const std::string dir = temp_dir("quota");
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\nquota_bytes = 10\n[users]\npbkdf2_iterations = 3\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_library("plugins/users/libusers.so").has_value());
    NC_CHECK(kernel.add_plugin_library("plugins/cloud/libcloud.so").has_value());
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    NC_CHECK_EQ(
        kernel.handle(as(req("PUT", "/remote.php/dav/files/alice/small", "", "12345"), ALICE))
            .get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(as(req("PUT", "/remote.php/dav/files/alice/big", "", "123456"), ALICE))
            .get_status(),
        507
    );
    NC_CHECK(!fs::exists(dir + "/alice/files/big"));
    kernel.stop();
    fs::remove_all(dir);
}

void test_missing_requirement()
{
    nc::Kernel kernel;
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_library("plugins/cloud/libcloud.so").has_value());
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{0});
    const auto info = kernel.plugins().front();
    NC_CHECK(info.get_state() == nc::PluginState::SKIPPED);
    NC_CHECK(info.get_error().find("users") != std::string::npos);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/abc"}).get_status(), 404);
}

} // namespace

int main()
{
    test_normalize();
    test_storage();
    test_share_store();
    test_plugins();
    test_quota_through_dav();
    test_missing_requirement();
    return NC_TEST_RESULT();
}
