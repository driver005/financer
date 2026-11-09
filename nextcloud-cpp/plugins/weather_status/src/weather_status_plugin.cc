/**
 * @file weather_status_plugin.cc
 * @brief The weather where a person is: each person stores a location, and the forecast for the
 * next hours comes from a weather service. Counterpart of Nextcloud's `apps/weather_status`. The
 * service is
 * `[weather_status] url` (default: the Open-Meteo forecast API, which needs no key) and is asked
 * for `latitude`, `longitude`, `hourly=temperature_2m,weathercode` and `forecast_days=2`. Answers
 * are kept for an hour per location, so the service is not asked more often than that.
 */
#include "http_client.h"
#include "nextcloud/db.h"
#include "nextcloud/plugin.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"

#include <chrono>
#include <cmath>
#include <map>
#include <mutex>

namespace {

using nc::http::Request;
using nc::http::Response;

constexpr std::int64_t CACHE_SECONDS = 3'600;
constexpr std::size_t MAX_CACHE = 500;

std::int64_t now_seconds()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

std::optional<double> number_in(const std::string& text, double low, double high)
{
    if (text.empty() || text.size() > 20) {
        return std::nullopt;
    }
    char* end = nullptr;
    const double value = std::strtod(text.c_str(), &end);
    if (end != text.c_str() + text.size() || !std::isfinite(value) || value < low || value > high) {
        return std::nullopt;
    }
    return value;
}

std::string format_coordinate(double value)
{
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%.4f", value);
    return buffer;
}

class WeatherStatusPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "weather_status";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "The weather where people are";
    }

    [[nodiscard]] std::span<const std::string_view> get_requires() const noexcept override
    {
        static constexpr std::string_view REQUIRED[] = {"db"};
        return REQUIRED;
    }

    void on_load(nc::Host& host) override
    {
        m_host = &host;
        m_url = host.config("url", "https://api.open-meteo.com/v1/forecast");
        m_client.set_allow_http(host.config("allow_http", "false") == "true");
        m_client.set_allow_local(host.config("allow_local", "false") == "true");
        m_client.set_timeout_seconds(std::atoi(host.config("timeout_seconds", "10").c_str()));
        m_client.set_max_response(1U << 20U);
        nc::db::Client{&host}.migrate(
            "weather_status",
            1,
            "CREATE TABLE nc_weather_location (uid TEXT PRIMARY KEY, lat TEXT NOT NULL, lon TEXT "
            "NOT NULL,"
            " address TEXT NOT NULL DEFAULT '');"
        );

        constexpr std::string_view BASE = "/ocs/v2.php/apps/weather_status/api/v1";
        host.add_route(
            "GET",
            std::string{BASE} + "/location",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto rows = nc::db::Client{m_host}.query(
                    "SELECT lat, lon, address FROM nc_weather_location WHERE uid = ?",
                    {request.get_user()}
                );
                if (rows.empty()) {
                    return nc::http::ocs(404, "No location set", "{}");
                }
                return nc::http::ocs(200, "OK", location_json(rows.front()));
            }
        );
        host.add_route(
            "PUT",
            std::string{BASE} + "/location",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto form = nc::util::parse_form(request.get_body());
                const auto lat = number_in(nc::util::form_value(form, "lat"), -90.0, 90.0);
                const auto lon = number_in(nc::util::form_value(form, "lon"), -180.0, 180.0);
                const std::string address = nc::util::form_value(form, "address");
                if (!lat || !lon || address.size() > 200 ||
                    address.find_first_of("\r\n") != std::string::npos) {
                    return nc::http::ocs(400, "Invalid location", "{}");
                }
                nc::db::Client{m_host}.exec(
                    "INSERT INTO nc_weather_location (uid, lat, lon, address) VALUES (?, ?, ?, ?) "
                    "ON "
                    "CONFLICT (uid) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, address "
                    "= "
                    "excluded.address",
                    {request.get_user(), format_coordinate(*lat), format_coordinate(*lon), address}
                );
                return nc::http::ocs(
                    200,
                    "OK",
                    R"({"lat":)" + format_coordinate(*lat) + R"(,"lon":)" +
                        format_coordinate(*lon) + R"(,"address":)" + json_string(address) + "}"
                );
            }
        );
        host.add_route(
            "DELETE",
            std::string{BASE} + "/location",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_weather_location WHERE uid = ?",
                    {request.get_user()}
                );
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        host.add_route(
            "GET",
            std::string{BASE} + "/forecast",
            [this](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto rows = nc::db::Client{m_host}.query(
                    "SELECT lat, lon FROM nc_weather_location WHERE uid = ?",
                    {request.get_user()}
                );
                if (rows.empty()) {
                    return nc::http::ocs(404, "No location set", "{}");
                }
                return forecast(
                    nc::db::value_of(rows.front(), "lat"),
                    nc::db::value_of(rows.front(), "lon")
                );
            }
        );
        host.subscribe(
            "user.deleted",
            [this](std::string_view, std::string_view payload)
            {
                nc::db::Client{m_host}.exec(
                    "DELETE FROM nc_weather_location WHERE uid = ?",
                    {nc::util::form_value(nc::util::parse_form(payload), "id")}
                );
            }
        );
    }

private:
    static std::string location_json(const nc::db::Row& row)
    {
        return R"({"lat":)" + nc::db::value_of(row, "lat") + R"(,"lon":)" +
               nc::db::value_of(row, "lon") + R"(,"address":)" +
               json_string(nc::db::value_of(row, "address")) + "}";
    }

    [[nodiscard]] Response forecast(const std::string& lat, const std::string& lon)
    {
        const std::string key = lat + "," + lon;
        {
            const std::lock_guard lock{m_mutex};
            const auto found = m_cache.find(key);
            if (found != m_cache.end() && now_seconds() - found->second.first < CACHE_SECONDS) {
                return nc::http::ocs(200, "OK", found->second.second);
            }
        }
        const std::string url = m_url + (m_url.find('?') == std::string::npos ? "?" : "&") +
                                "latitude=" + lat + "&longitude=" + lon +
                                "&hourly=temperature_2m,weathercode&forecast_days=2&timezone=UTC";
        const auto answer = nc::federation::request(m_client, "GET", url, {}, "");
        if (!answer || answer->get_status() != 200) {
            return nc::http::ocs(502, "The weather service is not available", "{}");
        }
        const auto json = nc::util::Json::parse(answer->get_body());
        const nc::util::Json& hourly = json ? (*json)["hourly"] : nc::util::Json{};
        const auto& times = hourly["time"].items();
        const auto& temperatures = hourly["temperature_2m"].items();
        const auto& codes = hourly["weathercode"].items();
        if (!json || times.empty() || times.size() != temperatures.size() || times.size() > 200) {
            return nc::http::ocs(502, "The weather service answered something unexpected", "{}");
        }
        std::string data = "[";
        for (std::size_t index = 0; index < times.size(); ++index) {
            if (!times[index].is_string() || !temperatures[index].is_number()) {
                return nc::http::ocs(
                    502,
                    "The weather service answered something unexpected",
                    "{}"
                );
            }
            data += (index == 0 ? "" : ",") + std::string{R"({"time":)"} +
                    json_string(times[index].string()) + R"(,"temperature":)" +
                    format_coordinate(temperatures[index].number()) + R"(,"weathercode":)" +
                    std::to_string(
                        index < codes.size() && codes[index].is_number()
                            ? static_cast<int>(codes[index].number())
                            : -1
                    ) +
                    "}";
        }
        data += "]";
        {
            const std::lock_guard lock{m_mutex};
            if (m_cache.size() >= MAX_CACHE) {
                m_cache.clear();
            }
            m_cache[key] = {now_seconds(), data};
        }
        return nc::http::ocs(200, "OK", data);
    }

    nc::federation::ClientSettings m_client{};
    std::string m_url{};
    std::mutex m_mutex{};
    std::map<std::string, std::pair<std::int64_t, std::string>> m_cache{};
    nc::Host* m_host{nullptr};
};

} // namespace

NC_PLUGIN(WeatherStatusPlugin)
