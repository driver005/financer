#pragma once

#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

#include "nextcloud/http.h"
#include "nextcloud/runner/error.h"

namespace nc {

/// @brief Maps method + path to a handler, the counterpart of Nextcloud's routes.php / `OC\Route`.
///
/// Patterns are `/`-separated. A segment is a literal, `{name}` (one segment, captured) or `{*name}` (the
/// rest of the path, captured, last segment only). When several routes match, the one with more literal
/// segments wins, a catch-all loses to everything.
class Router
{
public:
    using Handler = std::function<http::Response(const http::Request&)>;

    enum class Outcome
    {
        FOUND,
        NOT_FOUND,
        METHOD_NOT_ALLOWED
    };

    struct Match
    {
        Outcome outcome{Outcome::NOT_FOUND};
        std::shared_ptr<const Handler> handler{};
        std::vector<http::Header> params{};
        /// Methods that exist for the path; filled when the outcome is METHOD_NOT_ALLOWED.
        std::vector<std::string> allowed{};
    };

    Router() noexcept = default;

    /// @brief Adds a route; `method` `*` matches every method. Fails for a malformed pattern or when the
    /// same method + pattern is taken.
    Result<void> add(
        std::string_view method,
        std::string_view pattern,
        std::string_view owner,
        Handler&& handler
    );

    void remove_owner(std::string_view owner);

    [[nodiscard]] Match match(std::string_view method, std::string_view path) const;

    [[nodiscard]] std::size_t size() const noexcept;

private:
    struct Segment
    {
        enum class Kind
        {
            LITERAL,
            PARAM,
            REST
        };
        Kind kind{Kind::LITERAL};
        std::string text{};
    };

    struct Route
    {
        std::string method{};
        std::string pattern{};
        std::string owner{};
        std::vector<Segment> segments{};
        std::size_t literals{0};
        std::shared_ptr<const Handler> handler{};
    };

    [[nodiscard]] static std::vector<std::string> path_segments(std::string_view path);
    [[nodiscard]] static bool try_match(
        const Route& route,
        const std::vector<std::string>& segments,
        std::vector<http::Header>& params
    );

    mutable std::mutex m_mutex{};
    std::vector<Route> m_routes{};
};

}  // namespace nc
