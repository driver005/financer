#include "nextcloud/runner/router.h"

#include <algorithm>

#include "nextcloud/util/text.h"

namespace nc {

std::vector<std::string> Router::path_segments(std::string_view path)
{
    std::vector<std::string> segments;
    for (std::string& part : util::split(path, '/')) {
        if (!part.empty()) {
            segments.push_back(std::move(part));
        }
    }
    return segments;
}

Result<void> Router::add(
    std::string_view method,
    std::string_view pattern,
    std::string_view owner,
    Handler&& handler
)
{
    Route route;
    route.method = std::string{method};
    route.pattern = std::string{pattern};
    route.owner = std::string{owner};
    route.handler = std::make_shared<const Handler>(std::move(handler));
    const std::vector<std::string> parts = path_segments(pattern);
    for (std::size_t index = 0; index < parts.size(); ++index) {
        const std::string& part = parts[index];
        if (part.size() >= 3 && part.front() == '{' && part.back() == '}') {
            const bool rest = part[1] == '*';
            if (rest && index + 1 != parts.size()) {
                return fail(ErrorCode::INVALID_ARGUMENT, "catch-all must be the last segment: " + route.pattern);
            }
            const std::string name = part.substr(rest ? 2 : 1, part.size() - (rest ? 3 : 2));
            if (name.empty()) {
                return fail(ErrorCode::INVALID_ARGUMENT, "empty parameter name: " + route.pattern);
            }
            route.segments.push_back(Segment{rest ? Segment::Kind::REST : Segment::Kind::PARAM, name});
        } else if (part.find('{') != std::string::npos || part.find('}') != std::string::npos) {
            return fail(ErrorCode::INVALID_ARGUMENT, "brace inside a literal segment: " + route.pattern);
        } else {
            route.segments.push_back(Segment{Segment::Kind::LITERAL, part});
            ++route.literals;
        }
    }
    const std::lock_guard lock{m_mutex};
    for (const Route& existing : m_routes) {
        if (existing.method == route.method && existing.pattern == route.pattern) {
            return fail(ErrorCode::ALREADY_EXISTS, route.method + " " + route.pattern + " is already routed by " + existing.owner);
        }
    }
    m_routes.push_back(std::move(route));
    return {};
}

void Router::remove_owner(std::string_view owner)
{
    const std::lock_guard lock{m_mutex};
    std::erase_if(m_routes, [owner](const Route& route) { return route.owner == owner; });
}

bool Router::try_match(
    const Route& route,
    const std::vector<std::string>& segments,
    std::vector<http::Header>& params
)
{
    params.clear();
    for (std::size_t index = 0; index < route.segments.size(); ++index) {
        const Segment& segment = route.segments[index];
        if (segment.kind == Segment::Kind::REST) {
            std::string rest;
            for (std::size_t tail = index; tail < segments.size(); ++tail) {
                rest += tail == index ? "" : "/";
                rest += segments[tail];
            }
            params.emplace_back(segment.text, std::move(rest));
            return true;
        }
        if (index >= segments.size()) {
            return false;
        }
        if (segment.kind == Segment::Kind::PARAM) {
            params.emplace_back(segment.text, segments[index]);
        } else if (segment.text != segments[index]) {
            return false;
        }
    }
    return route.segments.size() == segments.size();
}

Router::Match Router::match(std::string_view method, std::string_view path) const
{
    // Segments are matched decoded, so a `%2F` in a name cannot be told from a separator: a client that
    // needs a slash inside a name is not supported, which is also what keeps `..` out of file names.
    std::vector<std::string> segments = path_segments(path);
    for (std::string& segment : segments) {
        segment = util::url_decode(segment);
    }

    const std::lock_guard lock{m_mutex};
    const Route* best = nullptr;
    std::vector<http::Header> best_params;
    std::vector<std::string> allowed;
    std::vector<http::Header> params;
    for (const Route& route : m_routes) {
        if (!try_match(route, segments, params)) {
            continue;
        }
        if (route.method != "*" && route.method != method) {
            allowed.push_back(route.method);
            continue;
        }
        const bool has_rest = !route.segments.empty() && route.segments.back().kind == Segment::Kind::REST;
        const bool best_has_rest =
            best != nullptr && !best->segments.empty() && best->segments.back().kind == Segment::Kind::REST;
        if (best == nullptr || (best_has_rest && !has_rest) ||
            (best_has_rest == has_rest && route.literals > best->literals)) {
            best = &route;
            best_params = params;
        }
    }
    Match result;
    if (best != nullptr) {
        result.outcome = Outcome::FOUND;
        result.handler = best->handler;
        result.params = std::move(best_params);
    } else if (!allowed.empty()) {
        result.outcome = Outcome::METHOD_NOT_ALLOWED;
        result.allowed = std::move(allowed);
    }
    return result;
}

std::size_t Router::size() const noexcept
{
    const std::lock_guard lock{m_mutex};
    return m_routes.size();
}

}  // namespace nc
