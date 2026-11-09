/**
 * @file plugin.h
 * @brief The C++ side of writing a runner plugin. A plugin derives from `nc::Plugin`, registers
 * what it offers in `on_load` through the `nc::Host`, and exports itself with `NC_PLUGIN(Class)`.
 * Everything that crosses the C ABI (see abi.h) is converted here, so a plugin never touches an
 * `Nc*` struct.
 */
#pragma once

#include "nextcloud/abi.h"
#include "nextcloud/http.h"
#include "nextcloud/stream.h"

#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <memory>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace nc {

enum class LogLevel : std::int32_t
{
    DEBUG = NC_LOG_DEBUG,
    INFO = NC_LOG_INFO,
    WARNING = NC_LOG_WARNING,
    ERROR = NC_LOG_ERROR,
    FATAL = NC_LOG_FATAL
};

using RouteHandler = std::function<http::Response(const http::Request&)>;
/// A service takes an opaque argument string and answers with a status and a body.
using ServiceHandler = std::function<http::Response(std::string_view args)>;
/// A job returns normally when it went well; throwing marks the run as failed.
using JobHandler = std::function<void()>;
using EventHandler = std::function<void(std::string_view topic, std::string_view payload)>;
/// A command gets its arguments, writes to `out`, and returns the exit code.
using CommandHandler = std::function<int(const std::vector<std::string>& args, std::string& out)>;

namespace detail {

    inline NcView view_of(std::string_view text) noexcept
    {
        return NcView{text.data(), text.size()};
    }

    inline std::string_view string_of(NcView view) noexcept
    {
        return view.data == nullptr ? std::string_view{} : std::string_view{view.data, view.size};
    }

    /// What a response needs to stay alive after the trampoline returns: the next call into the
    /// plugin on this thread replaces it (the ABI says so).
    struct OutStorage
    {
        std::string content_type{};
        std::string body{};
        std::vector<std::pair<std::string, std::string>> headers{};
        std::vector<NcPair> pairs{};

        void fill(const http::Response& response, NcResponse* out)
        {
            content_type = response.get_content_type();
            body = response.get_body();
            headers = response.get_headers();
            pairs.clear();
            for (const auto& [key, value]: headers) {
                pairs.push_back(NcPair{view_of(key), view_of(value)});
            }
            out->status = response.get_status();
            out->content_type = view_of(content_type);
            out->body = view_of(body);
            out->headers = pairs.data();
            out->header_count = pairs.size();
            stream_to_native(response, out);
        }
    };

    inline OutStorage& out_storage()
    {
        thread_local OutStorage storage;
        return storage;
    }

} // namespace detail

/// @brief A subscription is an exact topic or a prefix ending in `*` (`share.*`).
[[nodiscard]] inline bool topic_matches(std::string_view pattern, std::string_view topic) noexcept
{
    if (!pattern.empty() && pattern.back() == '*') {
        pattern.remove_suffix(1);
        return topic.substr(0, pattern.size()) == pattern;
    }
    return pattern == topic;
}

/// @brief What the runner offers a plugin, with the handler tables the C trampolines dispatch into.
class Host
{
public:
    Host() noexcept = default;

    /// @brief Writes one log line, attributed to this plugin.
    void log(LogLevel level, std::string_view message) const noexcept
    {
        if (m_native.log != nullptr) {
            m_native.log(
                m_native.ctx,
                static_cast<std::int32_t>(level),
                detail::view_of(m_plugin),
                detail::view_of(message)
            );
        }
    }

    /// @brief Routes `method` + `pattern` (`/a/{name}/{*rest}`) to `handler`.
    void add_route(std::string_view method, std::string_view pattern, RouteHandler&& handler)
    {
        const auto id = static_cast<std::uint32_t>(m_routes.size());
        const std::int32_t status = m_native.register_route(
            m_native.ctx,
            detail::view_of(m_plugin),
            detail::view_of(method),
            detail::view_of(pattern),
            id
        );
        if (status != 0) {
            throw std::runtime_error(
                "route rejected: " + std::string(method) + " " + std::string(pattern)
            );
        }
        m_routes.push_back(std::move(handler));
    }

    /// @brief Publishes a service other plugins reach through `call_service`.
    void add_service(std::string_view name, ServiceHandler&& handler)
    {
        const auto id = static_cast<std::uint32_t>(m_services.size());
        if (m_native.register_service(
                m_native.ctx,
                detail::view_of(m_plugin),
                detail::view_of(name),
                id
            ) != 0) {
            throw std::runtime_error("service rejected: " + std::string(name));
        }
        m_services.push_back(std::move(handler));
    }

    /// @brief Calls a service of any loaded plugin; 404 when nobody offers `name`.
    [[nodiscard]] http::Response call_service(std::string_view name, std::string_view args) const
    {
        NcResponse out{};
        out.struct_size = sizeof(NcResponse);
        const std::int32_t status =
            m_native.call_service(m_native.ctx, detail::view_of(name), detail::view_of(args), &out);
        http::Response response{
            status,
            std::string{detail::string_of(out.content_type)},
            std::string{detail::string_of(out.body)},
            {}
        };
        for (std::size_t index = 0; index < out.header_count; ++index) {
            response.add_header(
                std::string{detail::string_of(out.headers[index].key)},
                std::string{detail::string_of(out.headers[index].value)}
            );
        }
        detail::stream_from_native(out, response);
        return response;
    }

    void subscribe(std::string_view topic, EventHandler&& handler)
    {
        if (m_native.subscribe(m_native.ctx, detail::view_of(m_plugin), detail::view_of(topic)) !=
            0) {
            throw std::runtime_error("subscription rejected: " + std::string(topic));
        }
        m_events.emplace_back(std::string{topic}, std::move(handler));
    }

    void publish(std::string_view topic, std::string_view payload) const noexcept
    {
        if (m_native.publish != nullptr) {
            m_native.publish(m_native.ctx, detail::view_of(topic), detail::view_of(payload));
        }
    }

    /// @brief Adds `occ <name>` to the command line.
    void add_command(std::string_view name, std::string_view description, CommandHandler&& handler)
    {
        const auto id = static_cast<std::uint32_t>(m_commands.size());
        if (m_native.register_command(
                m_native.ctx,
                detail::view_of(m_plugin),
                detail::view_of(name),
                detail::view_of(description),
                id
            ) != 0) {
            throw std::runtime_error("command rejected: " + std::string(name));
        }
        m_commands.push_back(std::move(handler));
    }

    /// @brief Runs `handler` every `interval_seconds` (at least 1) while the runner serves, and on
    /// `occ background:run`.
    void add_job(std::string_view name, std::uint32_t interval_seconds, JobHandler&& handler)
    {
        const auto id = static_cast<std::uint32_t>(m_jobs.size());
        if (m_native.struct_size < sizeof(NcHost) || m_native.register_job == nullptr ||
            m_native.register_job(
                m_native.ctx,
                detail::view_of(m_plugin),
                detail::view_of(name),
                interval_seconds,
                id
            ) != 0) {
            throw std::runtime_error("job rejected: " + std::string(name));
        }
        m_jobs.push_back(std::move(handler));
    }

    /// @brief This plugin's config value for `key`, or `fallback` when unset.
    [[nodiscard]] std::string config(std::string_view key, std::string_view fallback = {}) const
    {
        const NcView value =
            m_native.config_get(m_native.ctx, detail::view_of(m_plugin), detail::view_of(key));
        return value.data == nullptr ? std::string{fallback}
                                     : std::string{detail::string_of(value)};
    }

    void bind(const NcHost& native, std::string_view plugin)
    {
        m_native = native;
        m_plugin = std::string{plugin};
    }

    [[nodiscard]] const std::string& get_plugin_name() const noexcept
    {
        return m_plugin;
    }

    // Used by the trampolines.
    [[nodiscard]] http::Response
    dispatch_route(std::uint32_t id, const http::Request& request) const
    {
        return id < m_routes.size() ? m_routes[id](request) : http::Response::text(404, "no route");
    }

    [[nodiscard]] http::Response dispatch_service(std::uint32_t id, std::string_view args) const
    {
        return id < m_services.size() ? m_services[id](args)
                                      : http::Response::text(404, "no service");
    }

    void dispatch_event(std::string_view topic, std::string_view payload) const
    {
        for (const auto& [pattern, handler]: m_events) {
            if (topic_matches(pattern, topic)) {
                handler(topic, payload);
            }
        }
    }

    [[nodiscard]] bool dispatch_job(std::uint32_t id) const
    {
        if (id >= m_jobs.size()) {
            return false;
        }
        m_jobs[id]();
        return true;
    }

    [[nodiscard]] int
    dispatch_command(std::uint32_t id, const std::vector<std::string>& args, std::string& out) const
    {
        return id < m_commands.size() ? m_commands[id](args, out) : 1;
    }

private:
    NcHost m_native{};
    std::string m_plugin{};
    std::vector<RouteHandler> m_routes{};
    std::vector<ServiceHandler> m_services{};
    std::vector<std::pair<std::string, EventHandler>> m_events{};
    std::vector<CommandHandler> m_commands{};
    std::vector<JobHandler> m_jobs{};
};

/// @brief Base class of every plugin. One instance lives from `create` to `destroy`.
class Plugin
{
public:
    Plugin() noexcept = default;
    virtual ~Plugin() = default;
    Plugin(const Plugin&) = delete;
    Plugin& operator=(const Plugin&) = delete;
    Plugin(Plugin&&) = delete;
    Plugin& operator=(Plugin&&) = delete;

    [[nodiscard]] virtual std::string_view get_name() const noexcept = 0;
    [[nodiscard]] virtual std::string_view get_version() const noexcept = 0;

    [[nodiscard]] virtual std::string_view get_description() const noexcept
    {
        return {};
    }

    /// @brief Names of the plugins that must be loaded first. Must point at static storage.
    [[nodiscard]] virtual std::span<const std::string_view> get_requires() const noexcept
    {
        return {};
    }

    /// @brief Register routes, services, subscriptions and commands. May throw; the load is then
    /// aborted and the exception text goes to the log.
    virtual void on_load(Host& host) = 0;

    /// @brief Every plugin has loaded; services of other plugins can be called.
    virtual void on_ready(Host& /*host*/) noexcept {}

    /// @brief The plugin is about to be destroyed.
    virtual void on_unload(Host& /*host*/) noexcept {}
};

namespace detail {

    struct Instance
    {
        std::unique_ptr<Plugin> plugin{};
        Host host{};
    };

    inline http::Request request_from(const NcRequest& native)
    {
        http::Request request{
            std::string{string_of(native.method)},
            std::string{string_of(native.path)},
            std::string{string_of(native.query)},
            std::string{string_of(native.body)},
            std::string{string_of(native.user)},
            {},
            {}
        };
        for (std::size_t index = 0; index < native.header_count; ++index) {
            request.add_header(
                std::string{string_of(native.headers[index].key)},
                std::string{string_of(native.headers[index].value)}
            );
        }
        for (std::size_t index = 0; index < native.param_count; ++index) {
            request.add_param(
                std::string{string_of(native.params[index].key)},
                std::string{string_of(native.params[index].value)}
            );
        }
        if (native.struct_size >= offsetof(NcRequest, body_file) + sizeof(native.body_file) &&
            native.body_file.data != nullptr && native.body_file.size != 0) {
            request.set_body_file(std::string{string_of(native.body_file)});
        }
        return request;
    }

    template<typename PluginClass> const NcPluginApi* api_for()
    {
        struct Api
        {
            PluginClass meta{};
            std::vector<NcView> requires_views{};
            NcPluginApi api{};

            Api()
            {
                for (const std::string_view name: meta.get_requires()) {
                    requires_views.push_back(view_of(name));
                }
                api.struct_size = sizeof(NcPluginApi);
                api.abi_version = NC_ABI_VERSION;
                api.name = view_of(meta.get_name());
                api.version = view_of(meta.get_version());
                api.description = view_of(meta.get_description());
                api.requires_plugins = requires_views.data();
                api.requires_count = requires_views.size();
                api.create = []() -> void*
                {
                    try {
                        auto* instance = new Instance{};
                        instance->plugin = std::make_unique<PluginClass>();
                        return instance;
                    } catch (...) {
                        return nullptr;
                    }
                };
                api.destroy = [](void* self)
                {
                    delete static_cast<Instance*>(self);
                };
                api.load = [](void* self, const NcHost* host) -> std::int32_t
                {
                    auto* instance = static_cast<Instance*>(self);
                    try {
                        instance->host.bind(*host, instance->plugin->get_name());
                        instance->plugin->on_load(instance->host);
                        return 0;
                    } catch (const std::exception& error) {
                        instance->host.log(LogLevel::ERROR, error.what());
                    } catch (...) {
                        instance->host.log(LogLevel::ERROR, "unknown error while loading");
                    }
                    return -1;
                };
                api.ready = [](void* self)
                {
                    auto* instance = static_cast<Instance*>(self);
                    instance->plugin->on_ready(instance->host);
                };
                api.unload = [](void* self)
                {
                    auto* instance = static_cast<Instance*>(self);
                    instance->plugin->on_unload(instance->host);
                };
                api.handle_route =
                    [](void* self, std::uint32_t id, const NcRequest* request, NcResponse* out
                    ) -> std::int32_t
                {
                    auto* instance = static_cast<Instance*>(self);
                    try {
                        out_storage().fill(
                            instance->host.dispatch_route(id, request_from(*request)),
                            out
                        );
                    } catch (const std::exception& error) {
                        out_storage().fill(http::Response::text(500, error.what()), out);
                    } catch (...) {
                        out_storage().fill(http::Response::text(500, "internal error"), out);
                    }
                    return out->status;
                };
                api.call_service = [](void* self, std::uint32_t id, NcView args, NcResponse* out
                                   ) -> std::int32_t
                {
                    auto* instance = static_cast<Instance*>(self);
                    try {
                        out_storage().fill(
                            instance->host.dispatch_service(id, string_of(args)),
                            out
                        );
                    } catch (const std::exception& error) {
                        out_storage().fill(http::Response::text(500, error.what()), out);
                    } catch (...) {
                        out_storage().fill(http::Response::text(500, "internal error"), out);
                    }
                    return out->status;
                };
                api.on_event = [](void* self, NcView topic, NcView payload)
                {
                    auto* instance = static_cast<Instance*>(self);
                    try {
                        instance->host.dispatch_event(string_of(topic), string_of(payload));
                    } catch (const std::exception& error) {
                        instance->host.log(LogLevel::ERROR, error.what());
                    } catch (...) {
                        instance->host.log(LogLevel::ERROR, "unknown error in an event handler");
                    }
                };
                api.run_job = [](void* self, std::uint32_t id) -> std::int32_t
                {
                    auto* instance = static_cast<Instance*>(self);
                    try {
                        return instance->host.dispatch_job(id) ? 0 : 1;
                    } catch (const std::exception& error) {
                        instance->host.log(
                            LogLevel::ERROR,
                            std::string("job failed: ") + error.what()
                        );
                    } catch (...) {
                        instance->host.log(LogLevel::ERROR, "job failed");
                    }
                    return 1;
                };
                api.run_command = [](void* self,
                                     std::uint32_t id,
                                     const NcView* args,
                                     std::size_t count,
                                     NcResponse* out) -> std::int32_t
                {
                    auto* instance = static_cast<Instance*>(self);
                    std::vector<std::string> list;
                    for (std::size_t index = 0; index < count; ++index) {
                        list.emplace_back(string_of(args[index]));
                    }
                    std::string text;
                    int code = 1;
                    try {
                        code = instance->host.dispatch_command(id, list, text);
                    } catch (const std::exception& error) {
                        text = error.what();
                    }
                    http::Response response{code, "text/plain; charset=utf-8", std::move(text), {}};
                    out_storage().fill(response, out);
                    return code;
                };
            }
        };

        static const Api api;
        return &api.api;
    }

} // namespace detail
} // namespace nc

/// Exports `PluginClass` as the plugin of this shared object. `PluginClass` must be default
/// constructible.
#define NC_PLUGIN(PluginClass)                                                                     \
    extern "C" NC_EXPORT const NcPluginApi* nc_plugin_api(void)                                    \
    {                                                                                              \
        return ::nc::detail::api_for<PluginClass>();                                               \
    }
