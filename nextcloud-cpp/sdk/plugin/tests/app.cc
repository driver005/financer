#include "nextcloud/app.h"

#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <memory>

namespace {

using nc::app::Access;
using nc::app::Format;
using nc::http::Request;
using nc::http::Response;

std::vector<std::string> g_trace;

/// Writes down when it is called, adds a header, and refuses what the request asks it to.
class TraceMiddleware final : public nc::app::Middleware
{
public:
    std::optional<Response>
    before_controller(const Request& request, const nc::app::RouteOptions&) override
    {
        g_trace.push_back("before");
        if (request.query_value("stop") == "1") {
            return Response::text(418, "stopped");
        }
        return std::nullopt;
    }

    Response
    after_controller(const Request&, const nc::app::RouteOptions&, Response&& response) override
    {
        g_trace.push_back("after");
        response.add_header("X-Traced", "yes");
        return std::move(response);
    }
};

class AppTestPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override
    {
        return "apptest";
    }

    std::string_view get_version() const noexcept override
    {
        return "1.0";
    }

    void on_load(nc::Host& host) override
    {
        // Stand in for the users plugin: "<name>:test" signs in, and root is an administrator.
        host.add_service(
            "auth.token",
            [](std::string_view credentials)
            {
                const std::size_t colon = credentials.find(':');
                return colon != std::string_view::npos && credentials.substr(colon + 1) == "test"
                           ? Response::text(200, std::string{credentials.substr(0, colon)})
                           : Response::text(404, "no");
            }
        );
        host.add_service(
            "users.is_admin",
            [](std::string_view user)
            {
                return user == "root" ? Response::text(200, "admin") : Response::text(404, "no");
            }
        );
        m_app = std::make_unique<nc::app::App>(host);
        m_app->use_defaults();
        m_app->use(std::make_unique<TraceMiddleware>());
        m_app->get(
            "/public",
            {Access::PUBLIC, Format::PLAIN},
            [](const Request&)
            {
                return Response::text(200, "open");
            }
        );
        m_app->get(
            "/user",
            {Access::USER, Format::PLAIN},
            [](const Request& request)
            {
                return Response::text(200, "hello " + request.get_user());
            }
        );
        m_app->get(
            "/admin",
            {Access::ADMIN, Format::OCS},
            [](const Request&)
            {
                return nc::http::ocs(200, "OK", "{}");
            }
        );
        m_app->get(
            "/missing",
            {Access::PUBLIC, Format::OCS},
            [](const Request&) -> Response
            {
                throw nc::app::HttpError{404, "no such thing"};
            }
        );
        m_app->get(
            "/plainfail",
            {Access::PUBLIC, Format::PLAIN},
            [](const Request&) -> Response
            {
                throw nc::app::HttpError{409, "clash"};
            }
        );
        m_app->post(
            "/boom",
            {Access::PUBLIC, Format::PLAIN},
            [](const Request&) -> Response
            {
                throw std::runtime_error("secret database path /var/x");
            }
        );
    }

private:
    std::unique_ptr<nc::app::App> m_app{};
};

} // namespace

int main()
{
    nc::Kernel kernel;
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_api(nc::detail::api_for<AppTestPlugin>()).has_value());
    NC_CHECK(kernel.start().has_value());
    const auto call = [&](const std::string& method,
                          const std::string& path,
                          const std::string& user = {},
                          const std::string& query = {})
    {
        Request request{std::string{method}, std::string{path}, std::string{query}, "", "", {}, {}};
        if (!user.empty()) {
            request.add_header("Authorization", "Basic " + nc::util::base64_encode(user + ":test"));
        }
        return kernel.handle(std::move(request));
    };

    NC_CHECK_EQ(call("GET", "/public").get_body(), "open");
    NC_CHECK_EQ(call("GET", "/user").get_status(), 401);
    NC_CHECK_EQ(call("GET", "/user", "bob").get_body(), "hello bob");
    NC_CHECK_EQ(call("GET", "/admin").get_status(), 401);
    NC_CHECK_EQ(call("GET", "/admin", "bob").get_status(), 403);
    NC_CHECK(
        call("GET", "/admin", "bob").get_body().find("\"statuscode\":403") != std::string::npos
    ); // OCS format
    NC_CHECK_EQ(call("GET", "/admin", "root").get_status(), 200);

    // An error a handler throws is written in the route's format.
    const Response missing = call("GET", "/missing");
    NC_CHECK_EQ(missing.get_status(), 404);
    NC_CHECK(missing.get_body().find("\"message\":\"no such thing\"") != std::string::npos);
    const Response clash = call("GET", "/plainfail");
    NC_CHECK_EQ(clash.get_status(), 409);
    NC_CHECK_EQ(clash.get_body(), "clash");
    // Anything else is a 500 that tells nothing.
    const Response boom = call("POST", "/boom");
    NC_CHECK_EQ(boom.get_status(), 500);
    NC_CHECK(boom.get_body().find("secret") == std::string::npos);

    // Middleware: called before and after, in order; one can answer instead of the handler.
    g_trace.clear();
    const Response traced = call("GET", "/public");
    NC_CHECK_EQ(traced.header("X-Traced"), "yes");
    NC_CHECK(g_trace == (std::vector<std::string>{"before", "after"}));
    g_trace.clear();
    const Response stopped = call("GET", "/public", {}, "stop=1");
    NC_CHECK_EQ(stopped.get_status(), 418);
    NC_CHECK_EQ(stopped.header("X-Traced"), "yes"); // its own after still ran
    NC_CHECK(g_trace == (std::vector<std::string>{"before", "after"}));
    // A request the session check refuses never reaches the later middleware.
    g_trace.clear();
    NC_CHECK_EQ(call("GET", "/user").get_status(), 401);
    NC_CHECK(g_trace.empty());
    kernel.stop();
    return NC_TEST_RESULT();
}
