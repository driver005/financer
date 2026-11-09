/**
 * @file app.h
 * @brief The layer between a plugin and its routes: who may call a route, what happens before and
 * after it, and what an error becomes. The counterpart of Nextcloud's AppFramework
 * (`OCP\AppFramework` controllers, `OCP\AppFramework\Middleware`, `@NoAdminRequired` /
 * `@PublicPage` annotations and `OCSException`), in C++ terms: a route is registered with
 * `RouteOptions` instead of a doc comment, and a handler may throw `HttpError` instead of building
 * an error response.
 *
 *     class MyPlugin : public nc::Plugin {
 *         void on_load(nc::Host& host) override {
 *             m_app.use_defaults();
 *             m_app.get("/ocs/v2.php/apps/my/api/v1/items", {nc::app::Access::USER,
 * nc::app::Format::OCS},
 *                       [](const nc::http::Request& request) { ... throw nc::app::HttpError{404,
 * "no"}; });
 *         }
 *         nc::app::App m_app{...};   // built from the host in on_load: App(host)
 *     };
 *
 * Order of work for one request: every middleware's `before_controller` (in registration order; one
 * may answer instead of the handler), the handler, `after_exception` when it threw, then every
 * `after_controller` of the middleware that ran, in reverse order.
 */
#pragma once

#include "nextcloud/plugin.h"

#include <exception>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace nc::app {

/// Who may call a route.
enum class Access
{
    PUBLIC, // anyone (`@PublicPage`)
    USER,   // a signed-in account
    ADMIN   // a signed-in administrator
};

/// How an error is written: plain text, or the OCS envelope of `/ocs/v2.php`.
enum class Format
{
    PLAIN,
    OCS
};

struct RouteOptions
{
    Access access{Access::USER};
    Format format{Format::PLAIN};
};

/// @brief An error a handler wants to answer with: the status and a message that is safe to show.
class HttpError : public std::runtime_error
{
public:
    HttpError(int status, const std::string& message) :
        std::runtime_error{message},
        m_status{status}
    {
    }

    [[nodiscard]] int get_status() const noexcept
    {
        return m_status;
    }

private:
    int m_status{500};
};

/// @brief An error as the response for `options.format`.
[[nodiscard]] inline http::Response
error_response(const RouteOptions& options, int status, std::string_view message)
{
    return options.format == Format::OCS ? http::ocs(status, message, "{}")
                                         : http::Response::text(status, std::string{message});
}

class Middleware
{
public:
    Middleware() noexcept = default;
    virtual ~Middleware() = default;
    Middleware(const Middleware&) = delete;
    Middleware& operator=(const Middleware&) = delete;
    Middleware(Middleware&&) = delete;
    Middleware& operator=(Middleware&&) = delete;

    /// @brief Return a response to answer without calling the handler (or the later middleware).
    virtual std::optional<http::Response>
    before_controller(const http::Request&, const RouteOptions&)
    {
        return std::nullopt;
    }

    /// @brief See and change the response, whoever made it.
    virtual http::Response
    after_controller(const http::Request&, const RouteOptions&, http::Response&& response)
    {
        return std::move(response);
    }

    /// @brief Turn an exception of the handler into a response; the first middleware that does
    /// wins.
    virtual std::optional<http::Response>
    after_exception(const http::Request&, const RouteOptions&, const std::exception&)
    {
        return std::nullopt;
    }
};

/// @brief 401 for a route that needs an account and gets none.
class SessionMiddleware final : public Middleware
{
public:
    std::optional<http::Response>
    before_controller(const http::Request& request, const RouteOptions& options) override
    {
        if (options.access != Access::PUBLIC && request.get_user().empty()) {
            return http::unauthorized();
        }
        return std::nullopt;
    }
};

/// @brief 403 for an administrator route called by someone else (asks the `users.is_admin`
/// service).
class AdminMiddleware final : public Middleware
{
public:
    explicit AdminMiddleware(const Host& host) noexcept :
        m_host{&host}
    {
    }

    std::optional<http::Response>
    before_controller(const http::Request& request, const RouteOptions& options) override
    {
        if (options.access == Access::ADMIN &&
            m_host->call_service("users.is_admin", request.get_user()).get_status() != 200) {
            return error_response(options, 403, "Forbidden");
        }
        return std::nullopt;
    }

private:
    const Host* m_host{nullptr};
};

/// @brief `HttpError` becomes its status and message; any other exception becomes a 500 that says
/// nothing about the cause (it is logged).
class ErrorMiddleware final : public Middleware
{
public:
    explicit ErrorMiddleware(const Host& host) noexcept :
        m_host{&host}
    {
    }

    std::optional<http::Response> after_exception(
        const http::Request& request,
        const RouteOptions& options,
        const std::exception& error
    ) override
    {
        if (const auto* http_error = dynamic_cast<const HttpError*>(&error)) {
            return error_response(options, http_error->get_status(), http_error->what());
        }
        m_host->log(
            LogLevel::ERROR,
            request.get_method() + " " + request.get_path() + " failed: " + error.what()
        );
        return error_response(options, 500, "Internal Server Error");
    }

private:
    const Host* m_host{nullptr};
};

/// @brief The routes of one plugin and the middleware they pass through.
class App
{
public:
    using Handler = RouteHandler;

    explicit App(Host& host) noexcept :
        m_host{&host}
    {
    }

    App(const App&) = delete;
    App& operator=(const App&) = delete;
    App(App&&) = delete;
    App& operator=(App&&) = delete;

    App& use(std::unique_ptr<Middleware>&& middleware)
    {
        m_middleware.push_back(std::move(middleware));
        return *this;
    }

    /// @brief Session check, administrator check, error mapping: what almost every plugin wants.
    App& use_defaults()
    {
        use(std::make_unique<SessionMiddleware>());
        use(std::make_unique<AdminMiddleware>(*m_host));
        use(std::make_unique<ErrorMiddleware>(*m_host));
        return *this;
    }

    App& route(
        std::string_view method,
        std::string_view pattern,
        const RouteOptions& options,
        Handler&& handler
    )
    {
        m_host->add_route(
            method,
            pattern,
            [this, options, handler = std::move(handler)](const http::Request& request)
            {
                return run(request, options, handler);
            }
        );
        return *this;
    }

    App& get(std::string_view pattern, const RouteOptions& options, Handler&& handler)
    {
        return route("GET", pattern, options, std::move(handler));
    }

    App& post(std::string_view pattern, const RouteOptions& options, Handler&& handler)
    {
        return route("POST", pattern, options, std::move(handler));
    }

    App& put(std::string_view pattern, const RouteOptions& options, Handler&& handler)
    {
        return route("PUT", pattern, options, std::move(handler));
    }

    App& del(std::string_view pattern, const RouteOptions& options, Handler&& handler)
    {
        return route("DELETE", pattern, options, std::move(handler));
    }

private:
    [[nodiscard]] http::Response
    run(const http::Request& request, const RouteOptions& options, const Handler& handler) const
    {
        std::size_t ran = 0;
        http::Response response;
        bool answered = false;
        for (const std::unique_ptr<Middleware>& middleware: m_middleware) {
            ++ran;
            if (auto early = middleware->before_controller(request, options)) {
                response = std::move(*early);
                answered = true;
                break;
            }
        }
        if (!answered) {
            try {
                response = handler(request);
            } catch (const std::exception& error) {
                bool handled = false;
                for (const std::unique_ptr<Middleware>& middleware: m_middleware) {
                    if (auto replaced = middleware->after_exception(request, options, error)) {
                        response = std::move(*replaced);
                        handled = true;
                        break;
                    }
                }
                if (!handled) {
                    throw;
                }
            }
        }
        for (std::size_t index = ran; index > 0; --index) {
            response =
                m_middleware[index - 1]->after_controller(request, options, std::move(response));
        }
        return response;
    }

    Host* m_host{nullptr};
    std::vector<std::unique_ptr<Middleware>> m_middleware{};
};

} // namespace nc::app
