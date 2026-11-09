#include "image.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

namespace {

namespace fs = std::filesystem;
using nc::http::Request;
using nc::http::Response;
using nc::previews::Format;
using nc::previews::Image;

Image gradient(int width, int height)
{
    std::vector<unsigned char> pixels;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            pixels.push_back(static_cast<unsigned char>(x * 255 / std::max(1, width - 1)));
            pixels.push_back(static_cast<unsigned char>(y * 255 / std::max(1, height - 1)));
            pixels.push_back(128);
            pixels.push_back(255);
        }
    }
    return Image{width, height, std::move(pixels)};
}

Request
req(std::string method,
    std::string path,
    std::string body,
    const std::string& credentials,
    std::string query = {})
{
    Request request{
        std::move(method),
        std::move(path),
        std::move(query),
        std::move(body),
        std::string{},
        {},
        {}
    };
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

void test_image()
{
    const Image picture = gradient(200, 100);
    const std::string png = nc::previews::encode_png(picture);
    const std::string jpeg = nc::previews::encode_jpeg(picture, 85);
    NC_CHECK(nc::previews::sniff(png) == Format::PNG);
    NC_CHECK(nc::previews::sniff(jpeg) == Format::JPEG);
    NC_CHECK(nc::previews::sniff("GIF89a....") == Format::GIF);
    NC_CHECK(nc::previews::sniff("BM......") == Format::BMP);
    NC_CHECK(nc::previews::sniff("P6\n2 1\n255\n......") == Format::PNM);
    NC_CHECK(nc::previews::sniff("P7\n") == Format::UNKNOWN); // PAM is not read
    NC_CHECK(nc::previews::sniff("P6") == Format::UNKNOWN);
    {
        const std::string ppm =
            std::string{"P6\n2 1\n255\n"} + std::string("\xff\x00\x00\x00\x00\xff", 6);
        const auto pixels = nc::previews::decode(ppm);
        NC_CHECK(pixels.has_value());
        if (pixels) {
            NC_CHECK_EQ(pixels->get_width(), 2);
            NC_CHECK_EQ(pixels->get_height(), 1);
            NC_CHECK_EQ(pixels->get_pixels()[0], static_cast<unsigned char>(255)); // red
            NC_CHECK_EQ(pixels->get_pixels()[6], static_cast<unsigned char>(255)); // blue
        }
        // A header that promises more than the file has, or a huge size, is refused before any big
        // allocation.
        NC_CHECK(!nc::previews::decode("P6\n2 1\n255\n\xff").has_value());
        NC_CHECK(!nc::previews::decode("P6\n99999 99999\n255\n").has_value());
    }
    NC_CHECK(nc::previews::sniff("%PDF-1.7") == Format::UNKNOWN);
    NC_CHECK(nc::previews::sniff("") == Format::UNKNOWN);

    // Round trip and scaling: the shape is kept and a picture is never enlarged.
    const auto decoded = nc::previews::decode(png);
    NC_CHECK(decoded.has_value());
    NC_CHECK_EQ(decoded->get_width(), 200);
    NC_CHECK_EQ(decoded->get_height(), 100);
    NC_CHECK_EQ(decoded->get_pixels()[0], static_cast<unsigned char>(0));
    const Image small = nc::previews::fit(*decoded, 64, 64);
    NC_CHECK_EQ(small.get_width(), 64);
    NC_CHECK_EQ(small.get_height(), 32);
    const Image tall = nc::previews::fit(*decoded, 1'000, 10);
    NC_CHECK_EQ(tall.get_height(), 10);
    NC_CHECK_EQ(tall.get_width(), 20);
    NC_CHECK_EQ(nc::previews::fit(*decoded, 400, 400).get_width(), 200);
    NC_CHECK(nc::previews::decode(jpeg).has_value());

    // Not a picture, or not a picture any more: refused with a reason, never a crash.
    NC_CHECK(!nc::previews::decode("just text").has_value());
    NC_CHECK(!nc::previews::decode(png.substr(0, 40)).has_value());
    NC_CHECK(!nc::previews::decode(std::string("\x89PNG\r\n\x1a\n", 8) + std::string(50, '\0'))
                  .has_value());
    // A small file that claims a gigantic picture is refused before anything is allocated.
    std::string bomb = png.substr(0, 33);                    // signature + IHDR
    bomb.replace(16, 4, std::string("\x00\x01\x86\xA0", 4)); // width 100000
    bomb.replace(20, 4, std::string("\x00\x01\x86\xA0", 4)); // height 100000
    NC_CHECK(!nc::previews::decode(bomb).has_value());
    // Damage: cut the pictures everywhere and flip single bytes; the decoder may fail but must not
    // fall over.
    for (const std::string* source: {&png, &jpeg}) {
        for (std::size_t cut = 0; cut < source->size();
             cut += std::max<std::size_t>(1, source->size() / 150)) {
            (void)nc::previews::decode(source->substr(0, cut));
        }
        for (std::size_t at = 0; at < source->size();
             at += std::max<std::size_t>(1, source->size() / 150)) {
            std::string damaged = *source;
            damaged[at] = static_cast<char>(damaged[at] ^ 0x5a);
            (void)nc::previews::decode(damaged);
        }
    }
}

} // namespace

int main()
{
    test_image();

    const std::string dir =
        (fs::temp_directory_path() / ("nc-previews-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"previews", "cloud", "users", "db"}) {
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
    const std::string files = "/remote.php/dav/files/alice";
    const std::string preview = "/index.php/core/preview.png";

    const std::string png = nc::previews::encode_png(gradient(200, 100));
    NC_CHECK_EQ(kernel.handle(req("MKCOL", files + "/Photos", "", alice)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(req("PUT", files + "/Photos/wide.png", png, alice)).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT",
                    files + "/Photos/shot.jpg",
                    nc::previews::encode_jpeg(gradient(120, 120), 80),
                    alice)
            )
            .get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(req("PUT", files + "/notes.txt", "not a picture", alice)).get_status(),
        201
    );

    const auto size_of = [](const Response& response)
    {
        const auto image = nc::previews::decode(response.get_body());
        return image ? std::make_pair(image->get_width(), image->get_height())
                     : std::make_pair(0, 0);
    };
    const Response small =
        kernel.handle(req("GET", preview, "", alice, "file=/Photos/wide.png&x=64&y=64"));
    NC_CHECK_EQ(small.get_status(), 200);
    NC_CHECK_EQ(small.get_content_type(), "image/png");
    NC_CHECK(size_of(small) == std::make_pair(64, 32));
    NC_CHECK_EQ(std::string(small.header("X-Content-Type-Options")), "nosniff");
    NC_CHECK(
        size_of(kernel.handle(req("GET", preview, "", alice, "file=/Photos/wide.png&x=1000&y=1000"))
        ) == std::make_pair(200, 100)
    );
    NC_CHECK(
        size_of(kernel.handle(req("GET", preview, "", alice, "file=/Photos/shot.jpg&x=32&y=32"))) ==
        std::make_pair(32, 32)
    );
    NC_CHECK(
        size_of(kernel.handle(req("GET", preview, "", alice, "file=/Photos/wide.png"))) ==
        std::make_pair(64, 32)
    ); // default size
    NC_CHECK(
        size_of(kernel.handle(req("GET", preview, "", alice, "file=/Photos/wide.png&x=999999&y=abc")
        )) == std::make_pair(64, 32)
    ); // nonsense sizes fall back to the default

    // The same request is answered from the cache (same ETag); a changed file gets a new preview.
    const std::string first{small.header("ETag")};
    NC_CHECK_EQ(
        std::string(kernel.handle(req("GET", preview, "", alice, "file=/Photos/wide.png&x=64&y=64"))
                        .header("ETag")),
        first
    );
    NC_CHECK(fs::exists(dir + "/previews"));
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT",
                    files + "/Photos/wide.png",
                    nc::previews::encode_png(gradient(100, 200)),
                    alice)
            )
            .get_status(),
        204
    );
    const Response changed =
        kernel.handle(req("GET", preview, "", alice, "file=/Photos/wide.png&x=64&y=64"));
    NC_CHECK(std::string(changed.header("ETag")) != first);
    NC_CHECK(size_of(changed) == std::make_pair(32, 64));

    // What is not a picture, not a file, or not yours.
    NC_CHECK_EQ(kernel.handle(req("GET", preview, "", alice, "file=/notes.txt")).get_status(), 415);
    NC_CHECK_EQ(kernel.handle(req("GET", preview, "", alice, "file=/Photos")).get_status(), 404);
    NC_CHECK_EQ(
        kernel.handle(req("GET", preview, "", alice, "file=/missing.png")).get_status(),
        404
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", preview, "", alice, "file=/../bob/files/x.png")).get_status(),
        404
    );
    NC_CHECK_EQ(kernel.handle(Request{"GET", std::string{preview}}).get_status(), 401);
    NC_CHECK_EQ(
        kernel.handle(req("GET", preview, "", bob, "file=/Photos/shot.jpg&owner=alice"))
            .get_status(),
        404
    ); // not shared with bob
    NC_CHECK_EQ(
        kernel.handle(req("GET", preview, "", bob, "file=/Photos/shot.jpg")).get_status(),
        404
    ); // bob has no such file
    NC_CHECK_EQ(
        kernel
            .handle(
                req("POST",
                    "/ocs/v2.php/apps/files_sharing/api/v1/shares",
                    "path=/Photos&shareType=0&shareWith=bob",
                    alice)
            )
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", preview, "", bob, "file=/Photos/shot.jpg&owner=alice"))
            .get_status(),
        200
    ); // now it is

    // A picture that lies about its size is refused, and a big file is not even read.
    std::string bomb = png.substr(0, 33);
    bomb.replace(16, 4, std::string("\x00\x01\x86\xA0", 4));
    bomb.replace(20, 4, std::string("\x00\x01\x86\xA0", 4));
    NC_CHECK_EQ(kernel.handle(req("PUT", files + "/bomb.png", bomb, alice)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("GET", preview, "", alice, "file=/bomb.png")).get_status(), 415);
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT", files + "/huge.png", png + std::string(21U * 1'024U * 1'024U, 'x'), alice
                )
            )
            .get_status(),
        201
    );
    NC_CHECK_EQ(kernel.handle(req("GET", preview, "", alice, "file=/huge.png")).get_status(), 413);

    NC_CHECK_EQ(kernel.run_command("previews:clear", {}, out), 0);
    NC_CHECK(!fs::exists(dir + "/previews"));

    kernel.stop();
    fs::remove_all(dir);
    return NC_TEST_RESULT();
}
