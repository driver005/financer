#include "dav.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "share_store.h"
#include "storage.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
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
    auto memory = std::make_unique<nc::cloud::MemoryShareBackend>();
    auto restarted = memory->share_with();
    nc::cloud::ShareStore store{std::move(memory)};
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

    nc::cloud::ShareStore reloaded{std::move(restarted)};
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
    NC_CHECK(kernel.add_plugin_library("plugins/db/libdb.so").has_value());
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{4});

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

Request
user_req(std::string method, std::string path, std::string body, const std::string& credentials)
{
    Request request{
        std::move(method),
        std::move(path),
        std::string{},
        std::move(body),
        std::string{},
        {},
        {}
    };
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

void test_ranges()
{
    using nc::cloud::ByteRange;
    using State = ByteRange::State;
    const auto check = [](const char* header,
                          std::uint64_t size,
                          State state,
                          std::uint64_t first = 0,
                          std::uint64_t last = 0)
    {
        const ByteRange range = nc::cloud::parse_range(header, size);
        NC_CHECK(range.state == state);
        if (state == State::PARTIAL) {
            NC_CHECK_EQ(range.first, first);
            NC_CHECK_EQ(range.last, last);
        }
    };
    check("bytes=0-4", 10, State::PARTIAL, 0, 4);
    check("bytes=5-", 10, State::PARTIAL, 5, 9);
    check("bytes=-3", 10, State::PARTIAL, 7, 9);
    check("bytes=-100", 10, State::PARTIAL, 0, 9);  // more than the file: all of it
    check("bytes=8-100", 10, State::PARTIAL, 8, 9); // clipped to the end
    check("bytes=10-12", 10, State::UNSATISFIABLE);
    check("bytes=-0", 10, State::UNSATISFIABLE);
    check("bytes=0-0", 0, State::UNSATISFIABLE);
    check("bytes=5-2", 10, State::WHOLE); // malformed: ignored
    check("bytes=a-b", 10, State::WHOLE);
    check("bytes=0-1,4-5", 10, State::WHOLE); // several ranges: whole file is allowed
    check("items=0-1", 10, State::WHOLE);
    check("bytes=99999999999999999999-", 10, State::WHOLE);

    const std::string dir = temp_dir("ranges");
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_library("plugins/users/libusers.so").has_value());
    NC_CHECK(kernel.add_plugin_library("plugins/cloud/libcloud.so").has_value());
    NC_CHECK(kernel.add_plugin_library("plugins/db/libdb.so").has_value());
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string alice = "alice:alice password";
    const std::string url = "/remote.php/dav/files/alice/digits.txt";
    NC_CHECK_EQ(kernel.handle(user_req("PUT", url, "0123456789", alice)).get_status(), 201);

    const auto ranged = [&](const std::string& header)
    {
        Request request = user_req("GET", url, "", alice);
        request.add_header("Range", std::string{header});
        return kernel.handle(std::move(request));
    };
    const Response part = ranged("bytes=2-5");
    NC_CHECK_EQ(part.get_status(), 206);
    NC_CHECK_EQ(part.get_body(), "2345");
    NC_CHECK_EQ(std::string(part.header("Content-Range")), "bytes 2-5/10");
    NC_CHECK_EQ(ranged("bytes=-3").get_body(), "789");
    NC_CHECK_EQ(ranged("bytes=4-").get_body(), "456789");
    const Response beyond = ranged("bytes=20-30");
    NC_CHECK_EQ(beyond.get_status(), 416);
    NC_CHECK_EQ(std::string(beyond.header("Content-Range")), "bytes */10");
    NC_CHECK_EQ(ranged("bytes=0-1,3-4").get_status(), 200);
    const Response whole = kernel.handle(user_req("GET", url, "", alice));
    NC_CHECK_EQ(whole.get_status(), 200);
    NC_CHECK_EQ(std::string(whole.header("Accept-Ranges")), "bytes");

    // A client that has the current version is told so; a changed file is sent again.
    const std::string etag{whole.header("ETag")};
    Request cached = user_req("GET", url, "", alice);
    cached.add_header("If-None-Match", std::string{etag});
    const Response unchanged = kernel.handle(std::move(cached));
    NC_CHECK_EQ(unchanged.get_status(), 304);
    NC_CHECK(unchanged.get_body().empty());
    NC_CHECK_EQ(kernel.handle(user_req("PUT", url, "0123456789!", alice)).get_status(), 204);
    Request stale = user_req("GET", url, "", alice);
    stale.add_header("If-None-Match", std::string{etag});
    NC_CHECK_EQ(kernel.handle(std::move(stale)).get_status(), 200);

    kernel.stop();
    fs::remove_all(dir);
}

void test_chunked_uploads()
{
    const std::string dir = temp_dir("uploads");
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[cloud]\nmax_upload_bytes = "
                          "100\nquota_bytes = 1000\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "users", "db"}) {
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
    const std::string alice = "alice:alice password";
    const std::string bob = "bob:bob password";
    const std::string up = "/remote.php/dav/uploads/alice/transfer-1";
    const std::string files = "/remote.php/dav/files/alice";
    const auto finish =
        [&](const std::string& id, const std::string& target, const std::string& total = {})
    {
        Request move =
            user_req("MOVE", "/remote.php/dav/uploads/alice/" + id + "/.file", "", alice);
        move.add_header("Destination", "https://cloud.example.org" + files + target);
        if (!total.empty()) {
            move.add_header("OC-Total-Length", std::string{total});
        }
        return kernel.handle(std::move(move));
    };

    // The three steps the sync clients take; chunks may arrive in any order and are joined by
    // number.
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", up, "", alice)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", up, "", alice)).get_status(), 405);
    NC_CHECK_EQ(kernel.handle(user_req("PUT", up + "/00002", "BBBB", alice)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(user_req("PUT", up + "/00001", "AAAA", alice)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", up + "/00010", "CC", alice)).get_status(),
        201
    ); // 10 after 2, not after 1
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", up + "/00001", "aaaa", alice)).get_status(),
        204
    ); // a retry replaces
    const auto listed = kernel.handle(user_req("PROPFIND", up, "", alice)).get_body();
    NC_CHECK(
        listed.find("00001") != std::string::npos && listed.find("00010") != std::string::npos
    );
    NC_CHECK_EQ(finish("transfer-1", "/big.bin", "10").get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", files + "/big.bin", "", alice)).get_body(),
        "aaaaBBBBCC"
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PROPFIND", up, "", alice)).get_status(),
        404
    ); // the staging area is gone

    // Wrong total, missing destination folder, a destination in another account, nothing uploaded.
    NC_CHECK_EQ(
        kernel.handle(user_req("MKCOL", "/remote.php/dav/uploads/alice/t2", "", alice))
            .get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", "/remote.php/dav/uploads/alice/t2/1", "xyz", alice))
            .get_status(),
        201
    );
    NC_CHECK_EQ(finish("t2", "/x.bin", "99").get_status(), 409);
    NC_CHECK_EQ(finish("t2", "/missing/x.bin").get_status(), 409);
    Request elsewhere = user_req("MOVE", "/remote.php/dav/uploads/alice/t2/.file", "", alice);
    elsewhere.add_header("Destination", "/remote.php/dav/files/bob/x.bin");
    NC_CHECK_EQ(kernel.handle(std::move(elsewhere)).get_status(), 502);
    NC_CHECK_EQ(finish("t2", "/x.bin").get_status(), 201); // the staging area survived the failures
    NC_CHECK_EQ(
        kernel.handle(user_req("MKCOL", "/remote.php/dav/uploads/alice/t3", "", alice))
            .get_status(),
        201
    );
    NC_CHECK_EQ(finish("t3", "/empty.bin").get_status(), 409);

    // Replacing an existing file works, limits hold, and strangers stay out.
    NC_CHECK_EQ(
        kernel.handle(user_req("MKCOL", "/remote.php/dav/uploads/alice/t4", "", alice))
            .get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", "/remote.php/dav/uploads/alice/t4/1", "new", alice))
            .get_status(),
        201
    );
    NC_CHECK_EQ(finish("t4", "/x.bin").get_status(), 204);
    NC_CHECK_EQ(kernel.handle(user_req("GET", files + "/x.bin", "", alice)).get_body(), "new");
    NC_CHECK_EQ(
        kernel.handle(user_req("MKCOL", "/remote.php/dav/uploads/alice/t5", "", alice))
            .get_status(),
        201
    );
    for (int index = 1; index <= 3; ++index) {
        NC_CHECK_EQ(
            kernel
                .handle(user_req(
                    "PUT",
                    "/remote.php/dav/uploads/alice/t5/" + std::to_string(index),
                    std::string(40, 'z'),
                    alice
                ))
                .get_status(),
            201
        );
    }
    NC_CHECK_EQ(finish("t5", "/toobig.bin").get_status(), 413); // 120 bytes, the limit is 100
    NC_CHECK_EQ(
        kernel.handle(user_req("MKCOL", "/remote.php/dav/uploads/alice/..", "", alice))
            .get_status(),
        400
    );
    NC_CHECK_EQ(kernel.handle(user_req("PUT", up + "/..%2Fx", "x", alice)).get_status(), 400);
    NC_CHECK_EQ(
        kernel.handle(user_req("MKCOL", "/remote.php/dav/uploads/alice/t6", "", bob)).get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(Request{"MKCOL", "/remote.php/dav/uploads/alice/t6"}).get_status(),
        401
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("DELETE", "/remote.php/dav/uploads/alice/t5", "", alice))
            .get_status(),
        204
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("DELETE", "/remote.php/dav/uploads/alice/t5", "", alice))
            .get_status(),
        404
    );

    kernel.stop();
    fs::remove_all(dir);
}

void test_link_options()
{
    const std::string dir = temp_dir("links");
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[cloud]\nmax_upload_bytes = 50\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string alice = "alice:alice password";
    const std::string files = "/remote.php/dav/files/alice";
    const std::string shares = "/ocs/v2.php/apps/files_sharing/api/v1/shares";
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", files + "/Inbox", "", alice)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", files + "/Inbox/secret.txt", "private", alice)).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", files + "/single.txt", "one file", alice)).get_status(),
        201
    );
    const auto token_of = [](const Response& created)
    {
        const std::string body = created.get_body();
        return body.substr(body.find("\"token\":\"") + 9, 20);
    };
    const auto with_password = [&](std::string path, const std::string& password)
    {
        Request request{"GET", std::move(path)};
        request.add_header("X-NC-Share-Password", std::string{password});
        return request;
    };

    // A link with a password: nothing without it, nothing with a wrong one.
    const Response locked = kernel.handle(
        user_req("POST", shares, "path=/single.txt&shareType=3&password=correct+horse", alice)
    );
    NC_CHECK_EQ(locked.get_status(), 200);
    NC_CHECK(locked.get_body().find("\"password_protected\":true") != std::string::npos);
    NC_CHECK(locked.get_body().find("correct") == std::string::npos); // never echoed
    const std::string locked_token = token_of(locked);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + locked_token}).get_status(), 401);
    NC_CHECK_EQ(
        kernel.handle(with_password("/s/" + locked_token, "wrong password")).get_status(),
        401
    );
    NC_CHECK_EQ(kernel.handle(with_password("/s/" + locked_token, "")).get_status(), 401);
    NC_CHECK_EQ(
        kernel.handle(with_password("/s/" + locked_token, "correct horse")).get_body(),
        "one file"
    );
    Request by_query{"GET", "/s/" + locked_token};
    by_query.set_query("password=correct%20horse");
    NC_CHECK_EQ(kernel.handle(std::move(by_query)).get_body(), "one file");
    NC_CHECK_EQ(
        kernel
            .handle(user_req("POST", shares, "path=/single.txt&shareType=3&password=short", alice))
            .get_status(),
        400
    );
    // The password is stored hashed, not as text.
    // (the database may still hold recent writes in its write-ahead log)
    const std::string stored = slurp(dir + "/nextcloud.db") + slurp(dir + "/nextcloud.db-wal");
    NC_CHECK(stored.find("correct horse") == std::string::npos);
    NC_CHECK(stored.find("10000$") != std::string::npos);

    // A drop box: people can put files in and cannot see or read anything.
    NC_CHECK_EQ(
        kernel.handle(user_req("POST", shares, "path=/single.txt&shareType=3&permissions=4", alice))
            .get_status(),
        400
    ); // needs a folder
    NC_CHECK_EQ(
        kernel.handle(user_req("POST", shares, "path=/Inbox&shareType=3&permissions=2", alice))
            .get_status(),
        400
    );
    const std::string drop = token_of(
        kernel.handle(user_req("POST", shares, "path=/Inbox&shareType=3&permissions=4", alice))
    );
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + drop}).get_status(), 403);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + drop + "/secret.txt"}).get_status(), 403);
    NC_CHECK_EQ(
        kernel.handle(Request{"PUT", "/s/" + drop + "/hello.txt", "", "hi there", "", {}, {}}
        ).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", files + "/Inbox/hello.txt", "", alice)).get_body(),
        "hi there"
    );
    // An existing name is never replaced, the new file is numbered.
    NC_CHECK_EQ(
        kernel.handle(Request{"PUT", "/s/" + drop + "/hello.txt", "", "second", "", {}, {}}
        ).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(Request{"PUT", "/s/" + drop + "/secret.txt", "", "overwrite?", "", {}, {}}
        ).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", files + "/Inbox/hello (2).txt", "", alice)).get_body(),
        "second"
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", files + "/Inbox/secret.txt", "", alice)).get_body(),
        "private"
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", files + "/Inbox/secret (2).txt", "", alice)).get_body(),
        "overwrite?"
    );
    // Not outside the folder, not too big, and a read-only link takes no uploads.
    NC_CHECK_EQ(
        kernel.handle(Request{"PUT", "/s/" + drop + "/../escape.txt", "", "x", "", {}, {}}
        ).get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel
            .handle(Request{"PUT", "/s/" + drop + "/big.bin", "", std::string(51, 'x'), "", {}, {}})
            .get_status(),
        413
    );
    NC_CHECK_EQ(
        kernel.handle(Request{"PUT", "/s/" + drop + "/no/such/dir.txt", "", "x", "", {}, {}}
        ).get_status(),
        409
    );
    const std::string read_only =
        token_of(kernel.handle(user_req("POST", shares, "path=/Inbox&shareType=3", alice)));
    NC_CHECK_EQ(
        kernel.handle(Request{"PUT", "/s/" + read_only + "/x.txt", "", "x", "", {}, {}}
        ).get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(Request{"PUT", "/s/" + std::string(20, 'a') + "/x.txt", "", "x", "", {}, {}}
        ).get_status(),
        404
    );

    // Read and upload together.
    const std::string both = token_of(kernel.handle(user_req(
        "POST",
        shares,
        "path=/Inbox&shareType=3&permissions=5&password=open+sesame",
        alice
    )));
    Request listing = with_password("/s/" + both, "open sesame");
    NC_CHECK(kernel.handle(std::move(listing)).get_body().find("secret.txt") != std::string::npos);
    Request upload{"PUT", "/s/" + both + "/both.txt", "", "ok", "", {}, {}};
    NC_CHECK_EQ(
        kernel.handle(Request{upload}).get_status(),
        401
    ); // the password applies to uploads too
    upload.add_header("X-NC-Share-Password", "open sesame");
    NC_CHECK_EQ(kernel.handle(std::move(upload)).get_status(), 201);

    kernel.stop();
    fs::remove_all(dir);
}

void test_public_webdav()
{
    const std::string dir = temp_dir("publicdav");
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string alice = "alice:alice password";
    const std::string files = "/remote.php/dav/files/alice";
    const std::string shares = "/ocs/v2.php/apps/files_sharing/api/v1/shares";
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", files + "/Docs", "", alice)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", files + "/Docs/a.txt", "inside", alice)).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", files + "/private.txt", "mine", alice)).get_status(),
        201
    );
    const auto token_of = [](const Response& created)
    {
        const std::string body = created.get_body();
        return body.substr(body.find("\"token\":\"") + 9, 20);
    };
    const std::string token = token_of(kernel.handle(
        user_req("POST", shares, "path=/Docs&shareType=3&permissions=5&password=open+sesame", alice)
    ));
    const auto dav = [&](const std::string& method,
                         const std::string& path,
                         const std::string& credentials,
                         const std::string& body = {})
    {
        Request request{std::string{method}, std::string{path}, "", std::string{body}, "", {}, {}};
        if (!credentials.empty()) {
            request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
        }
        return kernel.handle(std::move(request));
    };

    // The user name is the token; no account is involved.
    const Response none = dav("GET", "/public.php/webdav/a.txt", "");
    NC_CHECK_EQ(none.get_status(), 401);
    NC_CHECK(!none.header("WWW-Authenticate").empty());
    NC_CHECK_EQ(dav("GET", "/public.php/webdav/a.txt", token + ":wrong").get_status(), 401);
    NC_CHECK_EQ(dav("GET", "/public.php/webdav/a.txt", token + ":").get_status(), 401);
    NC_CHECK_EQ(
        dav("GET", "/public.php/webdav/a.txt", std::string(20, '0') + ":open sesame").get_status(),
        404
    );
    NC_CHECK_EQ(
        dav("GET", "/public.php/webdav/a.txt", "alice:alice password").get_status(),
        404
    ); // an account is not a token
    const std::string good = token + ":open sesame";
    NC_CHECK_EQ(dav("GET", "/public.php/webdav/a.txt", good).get_body(), "inside");
    const Response listing = dav("PROPFIND", "/public.php/webdav", good);
    NC_CHECK_EQ(listing.get_status(), 207);
    NC_CHECK(listing.get_body().find("/public.php/webdav/a.txt") != std::string::npos);
    NC_CHECK(
        listing.get_body().find("/Docs") == std::string::npos
    ); // the owner's layout stays hidden
    // Not outside the shared folder.
    NC_CHECK_EQ(dav("GET", "/public.php/webdav/../private.txt", good).get_status() >= 400, true);
    NC_CHECK_EQ(
        dav("GET", "/public.php/webdav/%2e%2e/private.txt", good).get_status() >= 400,
        true
    );
    // Permission 5: read and create, no update, no delete.
    NC_CHECK_EQ(dav("PUT", "/public.php/webdav/new.txt", good, "fresh").get_status(), 201);
    NC_CHECK_EQ(dav("GET", files + "/Docs/new.txt", "").get_status(), 401);
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", files + "/Docs/new.txt", "", alice)).get_body(),
        "fresh"
    );
    NC_CHECK_EQ(dav("PUT", "/public.php/webdav/a.txt", good, "changed").get_status(), 403);
    NC_CHECK_EQ(dav("DELETE", "/public.php/webdav/a.txt", good).get_status(), 403);
    NC_CHECK_EQ(dav("POST", "/public.php/webdav/a.txt", good).get_status() >= 400, true);

    // Sharing with another server needs the federation plugin; without it nothing is left behind.
    const Response remote = kernel.handle(
        user_req("POST", shares, "path=/Docs&shareType=6&shareWith=bob@cloud.example", alice)
    );
    NC_CHECK_EQ(remote.get_status(), 501);
    NC_CHECK_EQ(
        kernel.handle(user_req("POST", shares, "path=/Docs&shareType=6&shareWith=nobody", alice))
            .get_status(),
        400
    );
    const Response mine = kernel.handle(user_req("GET", shares, "", alice));
    NC_CHECK(mine.get_body().find("\"share_type\":6") == std::string::npos);

    kernel.stop();
    fs::remove_all(dir);
}

void test_legacy_share_file()
{
    // Earlier versions kept the shares in a text file; the first start with the database takes them
    // over.
    const std::string dir = temp_dir("legacy");
    {
        std::ofstream legacy{dir + "/shares.db"};
        legacy << "#next_id\t9\n"
               << "7\tabcdefabcdefabcdef12\t3\talice\t\t/Docs\t1\t0\t100\n";
    }
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    NC_CHECK(!fs::exists(dir + "/shares.db"));
    NC_CHECK(fs::exists(dir + "/shares.db.imported"));
    const std::string alice = "alice:alice password";
    NC_CHECK_EQ(
        kernel.handle(user_req("MKCOL", "/remote.php/dav/files/alice/Docs", "", alice))
            .get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", "/remote.php/dav/files/alice/Docs/a.txt", "old link", alice))
            .get_status(),
        201
    );
    // The old link still works, and a new share does not reuse its id.
    NC_CHECK(
        kernel.handle(Request{"GET", "/s/abcdefabcdefabcdef12"}).get_body().find("a.txt") !=
        std::string::npos
    );
    const Response added = kernel.handle(user_req(
        "POST",
        "/ocs/v2.php/apps/files_sharing/api/v1/shares",
        "path=/Docs&shareType=3",
        alice
    ));
    NC_CHECK_EQ(added.get_status(), 200);
    NC_CHECK(added.get_body().find("\"id\":\"8\"") != std::string::npos);
    kernel.stop();

    // A restart keeps both shares, and a leftover file is not read again.
    {
        std::ofstream again{dir + "/shares.db"};
        again << "9\tffffffffffffffffffff\t3\talice\t\t/Docs\t1\t0\t100\n";
    }
    nc::Kernel restarted{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    restarted.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "users", "db"}) {
        NC_CHECK(restarted
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(restarted.start().has_value());
    NC_CHECK_EQ(restarted.handle(Request{"GET", "/s/abcdefabcdefabcdef12"}).get_status(), 200);
    NC_CHECK_EQ(restarted.handle(Request{"GET", "/s/ffffffffffffffffffff"}).get_status(), 404);
    restarted.stop();
    fs::remove_all(dir);
}

void test_shared_folder_quota_and_size()
{
    const std::string dir = temp_dir("sharequota");
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\nquota_bytes = 30\n[users]\npbkdf2_iterations = 3\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "users", "db"}) {
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
    const std::string alice = "alice:alice password";
    const std::string bob = "bob:bob password";
    const std::string a = "/remote.php/dav/files/alice";
    const std::string b = "/remote.php/dav/files/bob";
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", a + "/Shared", "", alice)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", a + "/Shared/one.txt", "1234567890", alice)).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", a + "/mine.txt", "12345678901234", alice)).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel
            .handle(user_req(
                "POST",
                "/ocs/v2.php/apps/files_sharing/api/v1/shares",
                "path=/Shared&shareType=0&shareWith=bob&permissions=31",
                alice
            ))
            .get_status(),
        200
    );
    // The folder shows how big it is, not 0.
    const auto top = kernel.handle(user_req("PROPFIND", b + "/", "", bob)).get_body();
    const std::size_t entry = top.find("<d:href>" + b + "/Shared/</d:href>");
    NC_CHECK(entry != std::string::npos);
    NC_CHECK(top.find("<oc:size>10</oc:size>", entry) != std::string::npos);
    // Alice already uses 24 of 30 bytes: 6 more fit, 7 do not, whatever bob's own quota says.
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", b + "/Shared/two.txt", "123456", bob)).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", b + "/Shared/three.txt", "1", bob)).get_status(),
        507
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/Shared/two.txt", "", alice)).get_body(),
        "123456"
    );
    kernel.stop();
    fs::remove_all(dir);
}

void test_received_shares()
{
    const std::string dir = temp_dir("mounts");
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "groups", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    for (const char* name: {"alice", "bob", "carol"}) {
        ::setenv("OC_PASS", (std::string{name} + " password").c_str(), 1);
        NC_CHECK_EQ(kernel.run_command("user:add", {name}, out), 0);
    }
    ::unsetenv("OC_PASS");
    NC_CHECK_EQ(kernel.run_command("group:add", {"team"}, out), 0);
    NC_CHECK_EQ(kernel.run_command("group:adduser", {"team", "bob"}, out), 0);
    const std::string alice = "alice:alice password";
    const std::string bob = "bob:bob password";
    const std::string carol = "carol:carol password";
    const std::string a = "/remote.php/dav/files/alice";
    const std::string b = "/remote.php/dav/files/bob";
    const std::string shares = "/ocs/v2.php/apps/files_sharing/api/v1/shares";

    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", a + "/Documents", "", alice)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", a + "/Documents/a.txt", "AAA", alice)).get_status(),
        201
    );
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", a + "/Team", "", alice)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(user_req("PUT", a + "/note.txt", "NOTE", alice)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(user_req("PUT", b + "/note.txt", "BOBS", bob)).get_status(), 201);

    // Before anything is shared, bob sees only his own tree.
    NC_CHECK(
        kernel.handle(user_req("PROPFIND", b + "/", "", bob)).get_body().find("Documents") ==
        std::string::npos
    );

    // A read-only user share: it appears in bob's top folder and can be read, not changed.
    NC_CHECK_EQ(
        kernel
            .handle(user_req(
                "POST",
                shares,
                "path=%2FDocuments&shareType=0&shareWith=bob&permissions=1",
                alice
            ))
            .get_status(),
        200
    );
    const auto top = kernel.handle(user_req("PROPFIND", b + "/", "", bob)).get_body();
    NC_CHECK(top.find("<d:href>" + b + "/Documents/</d:href>") != std::string::npos);
    NC_CHECK(top.find("<d:href>" + b + "/note.txt</d:href>") != std::string::npos);
    NC_CHECK_EQ(kernel.handle(user_req("GET", b + "/Documents/a.txt", "", bob)).get_body(), "AAA");
    const auto inside = kernel.handle(user_req("PROPFIND", b + "/Documents", "", bob)).get_body();
    NC_CHECK(inside.find("<d:href>" + b + "/Documents/a.txt</d:href>") != std::string::npos);
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", b + "/Documents/b.txt", "no", bob)).get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", b + "/Documents/a.txt", "no", bob)).get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("DELETE", b + "/Documents/a.txt", "", bob)).get_status(),
        403
    );
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", b + "/Documents/sub", "", bob)).get_status(), 403);
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/Documents/a.txt", "", alice)).get_body(),
        "AAA"
    ); // untouched
    // Nobody else sees it, and the path cannot leave the share.
    NC_CHECK(
        kernel.handle(user_req("PROPFIND", "/remote.php/dav/files/carol/", "", carol))
            .get_body()
            .find("Documents") == std::string::npos
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", "/remote.php/dav/files/carol/Documents/a.txt", "", carol))
            .get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", b + "/Documents/..%2f..%2fnote.txt", "", bob)).get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", b + "/Documents/../note.txt", "", bob)).get_status(),
        400
    );

    // A group share with every permission: members write into the owner's folder.
    NC_CHECK_EQ(
        kernel.handle(user_req("POST", shares, "path=%2FTeam&shareType=1&shareWith=nogroup", alice))
            .get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("POST", shares, "path=%2FTeam&shareType=1&shareWith=team", alice))
            .get_status(),
        200
    );
    NC_CHECK(
        kernel.handle(user_req("PROPFIND", b + "/", "", bob))
            .get_body()
            .find("<d:href>" + b + "/Team/</d:href>") != std::string::npos
    );
    NC_CHECK(
        kernel.handle(user_req("PROPFIND", "/remote.php/dav/files/carol/", "", carol))
            .get_body()
            .find("Team") == std::string::npos
    ); // not a member
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", b + "/Team/new.txt", "from bob", bob)).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/Team/new.txt", "", alice)).get_body(),
        "from bob"
    ); // it is in alice's tree
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", b + "/Team/new.txt", "edited", bob)).get_status(),
        204
    );
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", b + "/Team/sub", "", bob)).get_status(), 201);
    Request move = user_req("MOVE", b + "/Team/new.txt", "", bob);
    move.add_header("Destination", b + "/Team/sub/moved.txt");
    NC_CHECK_EQ(kernel.handle(std::move(move)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/Team/sub/moved.txt", "", alice)).get_body(),
        "edited"
    );
    Request leave =
        user_req("MOVE", b + "/Team/sub/moved.txt", "", bob); // out of the share: refused
    leave.add_header("Destination", b + "/stolen.txt");
    NC_CHECK_EQ(kernel.handle(std::move(leave)).get_status(), 502);
    NC_CHECK_EQ(
        kernel.handle(user_req("DELETE", b + "/Team/sub/moved.txt", "", bob)).get_status(),
        204
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/Team/sub/moved.txt", "", alice)).get_status(),
        404
    );

    // A shared file whose name is taken in bob's folder gets a number; update permission lets him
    // replace it.
    NC_CHECK_EQ(
        kernel
            .handle(user_req(
                "POST",
                shares,
                "path=%2Fnote.txt&shareType=0&shareWith=bob&permissions=3",
                alice
            ))
            .get_status(),
        200
    );
    NC_CHECK_EQ(kernel.handle(user_req("GET", b + "/note.txt", "", bob)).get_body(), "BOBS");
    NC_CHECK_EQ(kernel.handle(user_req("GET", b + "/note%20(2).txt", "", bob)).get_body(), "NOTE");
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", b + "/note%20(2).txt", "NOTE v2", bob)).get_status(),
        204
    );
    NC_CHECK_EQ(kernel.handle(user_req("GET", a + "/note.txt", "", alice)).get_body(), "NOTE v2");
    NC_CHECK_EQ(
        kernel.handle(user_req("DELETE", b + "/note%20(2).txt", "", bob)).get_status(),
        403
    );
    NC_CHECK(
        kernel.handle(user_req("PROPFIND", b + "/", "", bob))
            .get_body()
            .find("note%20%282%29.txt") != std::string::npos
    );

    // The sharing API lists what bob received, directly and through the group.
    Request received{"GET", std::string{shares}};
    received.set_query("shared_with_me=true");
    received.add_header("Authorization", "Basic " + nc::util::base64_encode(bob));
    const auto listing = kernel.handle(std::move(received)).get_body();
    NC_CHECK(listing.find("\"path\":\"/Documents\"") != std::string::npos);
    NC_CHECK(listing.find("\"path\":\"/Team\"") != std::string::npos);
    NC_CHECK(listing.find("\"path\":\"/note.txt\"") != std::string::npos);

    // Leaving the group takes the share away; deleting the share does too.
    NC_CHECK_EQ(kernel.run_command("group:removeuser", {"team", "bob"}, out), 0);
    NC_CHECK_EQ(kernel.handle(user_req("GET", b + "/Team/sub", "", bob)).get_status(), 404);
    NC_CHECK_EQ(kernel.handle(user_req("DELETE", shares + "/1", "", alice)).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(user_req("GET", b + "/Documents/a.txt", "", bob)).get_status(), 404);

    kernel.stop();
    fs::remove_all(dir);
}

void test_external_storage()
{
    const std::string dir = temp_dir("external");
    const std::string archive = dir + "-archive";
    const std::string scans = dir + "-scans";
    fs::create_directories(archive + "/2023");
    fs::create_directories(scans);
    {
        std::ofstream{archive + "/2023/report.txt"} << "old report";
    }
    fs::create_directories(dir + "/bob/files/Archive"); // bob already has a folder of that name
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[cloud]\nexternal_mounts = Archive=" +
                          archive + ":ro; Scans=" + scans +
                          ":rw:team ; Gone=/does/not/exist:rw; Odd/Name=" + archive +
                          ":rw; Bad=relative:rw\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "groups", "users", "db"}) {
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
    NC_CHECK_EQ(kernel.run_command("group:add", {"team"}, out), 0);
    NC_CHECK_EQ(kernel.run_command("group:adduser", {"team", "bob"}, out), 0);
    const std::string alice = "alice:alice password";
    const std::string bob = "bob:bob password";
    const std::string a = "/remote.php/dav/files/alice";
    const std::string b = "/remote.php/dav/files/bob";

    // Everybody sees Archive, only the group sees Scans, and the broken entries are not there.
    const auto alice_top = kernel.handle(user_req("PROPFIND", a + "/", "", alice)).get_body();
    NC_CHECK(alice_top.find("<d:href>" + a + "/Archive/</d:href>") != std::string::npos);
    NC_CHECK(
        alice_top.find("Scans") == std::string::npos &&
        alice_top.find("Gone") == std::string::npos && alice_top.find("Odd") == std::string::npos
    );
    const auto bob_top = kernel.handle(user_req("PROPFIND", b + "/", "", bob)).get_body();
    NC_CHECK(
        bob_top.find("/Archive/") != std::string::npos &&           // his own folder keeps the name
        bob_top.find("/Archive%20%282%29/") != std::string::npos && // the mount is numbered
        bob_top.find("/Scans/") != std::string::npos
    );

    // Read-only: readable, listable, not changeable.
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/Archive/2023/report.txt", "", alice)).get_body(),
        "old report"
    );
    NC_CHECK(
        kernel.handle(user_req("PROPFIND", a + "/Archive/2023", "", alice))
            .get_body()
            .find(a + "/Archive/2023/report.txt") != std::string::npos
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", a + "/Archive/new.txt", "x", alice)).get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("DELETE", a + "/Archive/2023/report.txt", "", alice)).get_status(),
        403
    );
    NC_CHECK(fs::exists(archive + "/2023/report.txt"));
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/Archive/../../etc/passwd", "", alice)).get_status(),
        400
    );

    // Read-write for the group, and the bytes land in the host folder; a clash with an own name is
    // numbered.
    NC_CHECK_EQ(kernel.handle(user_req("GET", a + "/Scans/x", "", alice)).get_status(), 404);
    NC_CHECK_EQ(
        kernel.handle(user_req("PUT", b + "/Scans/scan1.pdf", "PDF", bob)).get_status(),
        201
    );
    NC_CHECK(fs::exists(scans + "/scan1.pdf"));
    NC_CHECK_EQ(kernel.handle(user_req("MKCOL", b + "/Scans/box", "", bob)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(user_req("DELETE", b + "/Scans/scan1.pdf", "", bob)).get_status(),
        204
    );
    NC_CHECK(!fs::exists(scans + "/scan1.pdf"));
    const auto renamed = kernel.handle(user_req("PROPFIND", b + "/", "", bob)).get_body();
    NC_CHECK(renamed.find("Archive%20%282%29") != std::string::npos);
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", b + "/Archive%20(2)/2023/report.txt", "", bob)).get_body(),
        "old report"
    );

    kernel.stop();
    fs::remove_all(dir);
    fs::remove_all(archive);
    fs::remove_all(scans);
}

void test_encryption()
{
    const std::string dir = temp_dir("encryption");
    const std::string key(64, 'a'); // 32 bytes of 0xaa
    // A file that exists before encryption is switched on.
    fs::create_directories(dir + "/alice/files");
    {
        std::ofstream{dir + "/alice/files/old.txt"} << "written before the key existed";
    }
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[cloud]\nencryption_key = " + key +
                          "\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"cloud", "users", "db"}) {
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
    const std::string alice = "alice:alice password";
    const std::string bob = "bob:bob password";
    const std::string a = "/remote.php/dav/files/alice";
    NC_CHECK_EQ(kernel.run_command("encryption:status", {}, out), 0);
    NC_CHECK(out.starts_with("enabled"));

    const std::string secret = "the launch code is 0000";
    NC_CHECK_EQ(kernel.handle(user_req("PUT", a + "/plan.txt", secret, alice)).get_status(), 201);
    // On disk there is no readable text, and the file is longer by the fixed overhead.
    const std::string stored = slurp(dir + "/alice/files/plan.txt");
    NC_CHECK(stored.starts_with("NCENC1"));
    NC_CHECK(stored.find("launch") == std::string::npos);
    NC_CHECK_EQ(stored.size(), secret.size() + 50);
    // Through the server everything looks normal: content, size, copies, moves, links.
    NC_CHECK_EQ(kernel.handle(user_req("GET", a + "/plan.txt", "", alice)).get_body(), secret);
    NC_CHECK(
        kernel.handle(user_req("PROPFIND", a + "/plan.txt", "", alice))
            .get_body()
            .find("<d:getcontentlength>" + std::to_string(secret.size()) + "<") != std::string::npos
    );
    Request copy = user_req("COPY", a + "/plan.txt", "", alice);
    copy.add_header("Destination", a + "/copy.txt");
    NC_CHECK_EQ(kernel.handle(std::move(copy)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(user_req("GET", a + "/copy.txt", "", alice)).get_body(), secret);
    const auto link = kernel
                          .handle(user_req(
                              "POST",
                              "/ocs/v2.php/apps/files_sharing/api/v1/shares",
                              "path=/plan.txt&shareType=3",
                              alice
                          ))
                          .get_body();
    const std::string token = link.substr(link.find("\"token\":\"") + 9, 20);
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/s/" + token}).get_body(), secret);
    // Shared with a user, the recipient reads the plain content too.
    NC_CHECK_EQ(
        kernel
            .handle(user_req(
                "POST",
                "/ocs/v2.php/apps/files_sharing/api/v1/shares",
                "path=/plan.txt&shareType=0&shareWith=bob",
                alice
            ))
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", "/remote.php/dav/files/bob/plan.txt", "", bob)).get_body(),
        secret
    );
    // Two writes of the same content never give the same bytes (new salt and nonce each time).
    NC_CHECK_EQ(kernel.handle(user_req("PUT", a + "/plan.txt", secret, alice)).get_status(), 204);
    NC_CHECK(slurp(dir + "/alice/files/plan.txt") != stored);
    // An empty file works too.
    NC_CHECK_EQ(kernel.handle(user_req("PUT", a + "/empty.txt", "", alice)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(user_req("GET", a + "/empty.txt", "", alice)).get_body(), "");

    // The file from before is read as it is, and `encrypt-all` converts it.
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/old.txt", "", alice)).get_body(),
        "written before the key existed"
    );
    NC_CHECK_EQ(kernel.run_command("encryption:encrypt-all", {"alice"}, out), 0);
    NC_CHECK_EQ(out, "encrypted 1 file(s)\n");
    NC_CHECK(slurp(dir + "/alice/files/old.txt").starts_with("NCENC1"));
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", a + "/old.txt", "", alice)).get_body(),
        "written before the key existed"
    );
    NC_CHECK_EQ(kernel.run_command("encryption:encrypt-all", {"alice"}, out), 0);
    NC_CHECK_EQ(out, "encrypted 0 file(s)\n");

    // Tampering is noticed, and so is a file moved into another account's folder.
    std::string damaged = slurp(dir + "/alice/files/plan.txt");
    damaged[damaged.size() / 2] = static_cast<char>(damaged[damaged.size() / 2] ^ 0x01);
    {
        std::ofstream{dir + "/alice/files/plan.txt", std::ios::binary | std::ios::trunc} << damaged;
    }
    NC_CHECK_EQ(kernel.handle(user_req("GET", a + "/plan.txt", "", alice)).get_status(), 500);
    fs::create_directories(dir + "/bob/files");
    fs::copy_file(dir + "/alice/files/copy.txt", dir + "/bob/files/stolen.txt");
    NC_CHECK_EQ(
        kernel.handle(user_req("GET", "/remote.php/dav/files/bob/stolen.txt", "", bob))
            .get_status(),
        500
    );

    kernel.stop();
    // A key that is not 64 hex digits stops the plugin instead of storing files unprotected.
    nc::Kernel bad{
        nc::Config::parse("data_dir = " + dir + "\n[cloud]\nencryption_key = nothex\n").value()
    };
    bad.get_logger().set_sink({});
    NC_CHECK(bad.add_plugin_library("plugins/cloud/libcloud.so").has_value());
    NC_CHECK(bad.add_plugin_library("plugins/users/libusers.so").has_value());
    NC_CHECK(bad.add_plugin_library("plugins/db/libdb.so").has_value());
    NC_CHECK(bad.start().has_value());
    bool cloud_failed = false;
    for (const nc::PluginInfo& info: bad.plugins()) {
        cloud_failed = cloud_failed ||
                       (info.get_name() == "cloud" && info.get_state() == nc::PluginState::FAILED);
    }
    NC_CHECK(cloud_failed);
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
    NC_CHECK(kernel.add_plugin_library("plugins/db/libdb.so").has_value());
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
    test_ranges();
    test_link_options();
    test_public_webdav();
    test_legacy_share_file();
    test_shared_folder_quota_and_size();
    test_chunked_uploads();
    test_received_shares();
    test_external_storage();
    test_encryption();
    test_quota_through_dav();
    test_missing_requirement();
    return NC_TEST_RESULT();
}
