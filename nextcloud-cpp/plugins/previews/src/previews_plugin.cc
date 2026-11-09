/**
 * @file previews_plugin.cc
 * @brief Thumbnails of pictures: `GET /index.php/core/preview.png?file=/Photos/a.jpg&x=64&y=64`.
 * Counterpart of Nextcloud's `lib/private/Preview`, reduced to PNG, JPEG, GIF, BMP and PNM
 * pictures, scaled to fit and returned as PNG. Results are cached on disk by file version (the
 * ETag), so a changed file gets a new preview.
 *
 * Pictures are the one place the server decodes data an attacker may have written, so: only four
 * formats are ever passed to the decoder (recognised by their first bytes), the size is read before
 * the pixels, files over 20 MiB and pictures over 8192 pixels a side or 40 megapixels are refused.
 */
#include "image.h"
#include "nextcloud/app.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions USER{nc::app::Access::USER, nc::app::Format::PLAIN};

constexpr std::uint64_t MAX_FILE = 20U * 1'024U * 1'024U;
constexpr int MAX_PREVIEW = 2'048;

int dimension(const std::string& text, int fallback)
{
    if (text.empty() || text.size() > 5 ||
        text.find_first_not_of("0123456789") != std::string::npos) {
        return fallback;
    }
    return std::clamp(std::atoi(text.c_str()), 1, MAX_PREVIEW);
}

class PreviewsPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "previews";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Thumbnails of pictures";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"cloud"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        m_cache = std::filesystem::path{host.config("data_dir", "data")} / "previews";
        host.add_service(
            "capabilities.previews",
            [](std::string_view)
            {
                return Response::json(
                    200,
                    R"({"formats":["png","jpeg","gif","bmp","pnm"],"max_size":2048})"
                );
            }
        );
        m_app->get(
            "/index.php/core/preview.png",
            USER,
            [this](const Request& request)
            {
                return preview(request);
            }
        );
        host.add_job(
            "expire",
            3'600,
            [this]()
            {
                expire(std::chrono::hours{24 * 30});
            }
        );
        host.add_command(
            "previews:clear",
            "Deletes all cached previews",
            [this](const std::vector<std::string>&, std::string& out)
            {
                std::error_code error;
                out = "removed " + std::to_string(std::filesystem::remove_all(m_cache, error)) +
                      " file(s)\n";
                return 0;
            }
        );
    }

private:
    [[nodiscard]] Response preview(const Request& request) const
    {
        const std::string path = request.query_value("file");
        std::string owner = request.query_value("owner");
        owner = owner.empty() ? request.get_user() : owner;
        const int width = dimension(request.query_value("x"), 64);
        const int height = dimension(request.query_value("y"), 64);

        // Who may see it is the cloud plugin's call; a file that is not there and one that is not
        // yours look alike.
        if (m_host
                ->call_service(
                    "cloud.can_access",
                    nc::util::form_encode(
                        {{"owner", owner}, {"path", path}, {"user", request.get_user()}}
                    )
                )
                .get_status() != 200) {
            return Response::text(404, "Not Found");
        }
        const Response stat = m_host->call_service(
            "cloud.stat",
            nc::util::form_encode({{"user", owner}, {"path", path}})
        );
        const auto info = nc::util::parse_form(stat.get_body());
        if (stat.get_status() != 200 || nc::util::form_value(info, "dir") == "1") {
            return Response::text(404, "Not Found");
        }
        if (std::strtoull(nc::util::form_value(info, "size").c_str(), nullptr, 10) > MAX_FILE) {
            return Response::text(413, "The file is too large to preview");
        }
        const std::string etag = nc::util::form_value(info, "etag");
        const std::string key =
            nc::util::to_hex(nc::util::sha256(
                                 owner + '\n' + nc::util::form_value(info, "path") + '\n' + etag +
                                 '\n' + std::to_string(width) + 'x' + std::to_string(height)
                             ))
                .substr(0, 40);
        const std::filesystem::path cached = m_cache / (key + ".png");

        std::string png;
        if (std::ifstream in{cached, std::ios::binary}) {
            std::ostringstream data;
            data << in.rdbuf();
            png = data.str();
        } else {
            const Response content = m_host->call_service(
                "cloud.read",
                nc::util::form_encode({{"user", owner}, {"path", path}})
            );
            if (content.get_status() != 200) {
                return Response::text(404, "Not Found");
            }
            auto decoded = nc::previews::decode(content.get_body());
            if (!decoded) {
                return Response::text(415, decoded.error());
            }
            png = nc::previews::encode_png(nc::previews::fit(*decoded, width, height));
            std::error_code error;
            std::filesystem::create_directories(m_cache, error);
            const std::filesystem::path temporary =
                m_cache / (key + ".tmp" + nc::util::random_hex(4));
            {
                std::ofstream out{temporary, std::ios::binary | std::ios::trunc};
                out.write(png.data(), static_cast<std::streamsize>(png.size()));
            }
            std::filesystem::rename(temporary, cached, error);
        }
        Response response{200, "image/png", std::move(png), {}};
        response.add_header("ETag", "\"" + key + "\"");
        response.add_header("Cache-Control", "private, max-age=3600");
        response.add_header("X-Content-Type-Options", "nosniff");
        return response;
    }

    void expire(std::chrono::hours age) const
    {
        std::error_code error;
        for (const auto& entry: std::filesystem::directory_iterator{m_cache, error}) {
            if (std::filesystem::file_time_type::clock::now() - entry.last_write_time(error) >
                age) {
                std::filesystem::remove(entry.path(), error);
            }
        }
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
    std::filesystem::path m_cache{};
};

} // namespace

NC_PLUGIN(PreviewsPlugin)
