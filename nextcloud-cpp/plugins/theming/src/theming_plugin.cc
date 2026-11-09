/**
 * @file theming_plugin.cc
 * @brief The look an administrator gives the server: its name, slogan, address, primary colour and
 * the legal links. Served as the capabilities entry `theming` and as a style sheet of CSS variables
 * that a front end includes. Counterpart of Nextcloud's `apps/theming` (without logos and
 * backgrounds: those are files, and this plugin keeps text only). Values live in the `settings`
 * plugin under the app name `theming`.
 */
#include "color.h"
#include "nextcloud/app.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <array>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr nc::app::RouteOptions ADMIN{nc::app::Access::ADMIN, nc::app::Format::OCS};
constexpr nc::app::RouteOptions OPEN{nc::app::Access::PUBLIC, nc::app::Format::OCS};

constexpr std::string_view DEFAULT_NAME = "Nextcloud";
constexpr std::string_view DEFAULT_COLOR = "#00679e";

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

bool plain_text(std::string_view text, std::size_t limit)
{
    return !text.empty() && text.size() <= limit &&
           std::ranges::none_of(
               text,
               [](char letter)
               {
                   const auto byte = static_cast<unsigned char>(letter);
                   return byte < 0x20 || byte == 0x7F;
               }
           );
}

bool web_address(std::string_view text)
{
    return plain_text(text, 500) &&
           (nc::util::starts_with(text, "https://") || nc::util::starts_with(text, "http://")) &&
           text.find_first_of(" \"'<>\\") == std::string_view::npos;
}

class ThemingPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "theming";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Name, colour and links of this server";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"settings", "users"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        host.add_service(
            "capabilities.theming",
            [this](std::string_view)
            {
                return Response::json(200, capabilities_json());
            }
        );

        constexpr std::string_view CONFIG = "/ocs/v2.php/apps/theming/api/v1/config";
        m_app->get(
            CONFIG,
            OPEN,
            [this](const Request&)
            {
                return nc::http::ocs(200, "OK", capabilities_json());
            }
        );
        // name, slogan, url, color, imprintUrl, privacyUrl: any of them. An empty value resets one.
        m_app->put(
            CONFIG,
            ADMIN,
            [this](const Request& request)
            {
                const auto form = nc::util::parse_form(request.get_body());
                for (const auto& [key, value]: form) {
                    if (std::ranges::find(KEYS, key) == KEYS.end()) {
                        return nc::http::ocs(400, "Unknown setting " + key, "{}");
                    }
                    if (!value.empty() && !valid(key, value)) {
                        return nc::http::ocs(400, "Invalid value for " + key, "{}");
                    }
                }
                for (const auto& [key, value]: form) {
                    store(key, value);
                }
                return nc::http::ocs(200, "OK", capabilities_json());
            }
        );

        for (const std::string_view theme: {"default", "light", "dark"}) {
            m_app->get(
                "/index.php/apps/theming/theme/" + std::string{theme} + ".css",
                OPEN,
                [this, theme](const Request& request)
                {
                    Response response = Response::text(200, css(theme));
                    response.set_content_type("text/css; charset=utf-8");
                    const std::string etag =
                        "\"" +
                        nc::util::to_hex(nc::util::sha256(response.get_body())).substr(0, 24) +
                        "\"";
                    if (request.header("If-None-Match") == etag) {
                        return Response{304};
                    }
                    response.add_header("ETag", std::string{etag});
                    response.add_header("Cache-Control", "no-cache");
                    return response;
                }
            );
        }
    }

private:
    static constexpr std::array<std::string_view, 6> KEYS =
        {"name", "slogan", "url", "color", "imprintUrl", "privacyUrl"};

    static bool valid(std::string_view key, std::string_view value)
    {
        if (key == "color") {
            return nc::theming::parse_hex_color(value).has_value();
        }
        if (key == "url" || key == "imprintUrl" || key == "privacyUrl") {
            return web_address(value);
        }
        return plain_text(value, key == "name" ? 50 : 200);
    }

    [[nodiscard]] std::string get(std::string_view key, std::string_view fallback) const
    {
        const Response value = m_host->call_service(
            "settings.get_app",
            nc::util::form_encode({{"app", "theming"}, {"key", std::string{key}}})
        );
        return value.get_status() == 200 && !value.get_body().empty() ? value.get_body()
                                                                      : std::string{fallback};
    }

    void store(const std::string& key, const std::string& value) const
    {
        (void)m_host->call_service(
            "settings.set_app",
            nc::util::form_encode({{"app", "theming"}, {"key", key}, {"value", value}})
        );
    }

    [[nodiscard]] nc::theming::Rgb primary() const
    {
        return nc::theming::parse_hex_color(get("color", DEFAULT_COLOR))
            .value_or(*nc::theming::parse_hex_color(DEFAULT_COLOR));
    }

    [[nodiscard]] std::string capabilities_json() const
    {
        const nc::theming::Rgb color = primary();
        return R"({"name":)" + json_string(get("name", DEFAULT_NAME)) + R"(,"slogan":)" +
               json_string(get("slogan", "a safe home for all your data")) + R"(,"url":)" +
               json_string(get("url", "https://nextcloud.com")) + R"(,"imprintUrl":)" +
               json_string(get("imprintUrl", "")) + R"(,"privacyUrl":)" +
               json_string(get("privacyUrl", "")) + R"(,"color":)" +
               json_string(nc::theming::to_hex(color)) + R"(,"color-text":)" +
               json_string(nc::theming::readable_text_color(color)) + "}";
    }

    [[nodiscard]] std::string css(std::string_view theme) const
    {
        const nc::theming::Rgb color = primary();
        // On a dark page a dark primary colour is lifted so it stays visible.
        const nc::theming::Rgb shown =
            theme == "dark" && nc::theming::relative_luminance(color) < 0.2
                ? nc::theming::mix(color, nc::theming::Rgb{255, 255, 255}, 0.4)
                : color;
        const bool dark = theme == "dark";
        return std::string{":root {\n"} + "  --color-primary: " + nc::theming::to_hex(shown) +
               ";\n  --color-primary-text: " + nc::theming::readable_text_color(shown) +
               ";\n  --color-primary-hover: " +
               nc::theming::to_hex(nc::theming::mix(
                   shown,
                   nc::theming::Rgb{dark ? 255 : 0, dark ? 255 : 0, dark ? 255 : 0},
                   0.15
               )) +
               ";\n  --color-main-background: " + (dark ? "#171717" : "#ffffff") +
               ";\n  --color-main-text: " + (dark ? "#ebebeb" : "#222222") + ";\n}\n";
    }

    nc::Host* m_host{nullptr};
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

NC_PLUGIN(ThemingPlugin)
