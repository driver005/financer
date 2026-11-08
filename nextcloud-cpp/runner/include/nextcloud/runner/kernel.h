/**
 * @file kernel.h
 * @brief The runner. It owns no feature: it loads plugins, wires them together (routes, services,
 * events, commands, config, log) and dispatches requests. Nextcloud's "server" (files, sharing,
 * mail, users, ...) is what the plugins are.
 */
#pragma once

#include "nextcloud/abi.h"
#include "nextcloud/http.h"
#include "nextcloud/runner/command_registry.h"
#include "nextcloud/runner/config.h"
#include "nextcloud/runner/error.h"
#include "nextcloud/runner/event_bus.h"
#include "nextcloud/runner/job_scheduler.h"
#include "nextcloud/runner/log.h"
#include "nextcloud/runner/plugin_info.h"
#include "nextcloud/runner/router.h"
#include "nextcloud/runner/service_registry.h"

#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace nc {

class Kernel
{
public:
    /// @brief A kernel with an empty config. Registers the built-in routes and commands.
    Kernel();

    explicit Kernel(Config&& config);

    ~Kernel();
    Kernel(const Kernel&) = delete;
    Kernel& operator=(const Kernel&) = delete;
    Kernel(Kernel&&) = delete;
    Kernel& operator=(Kernel&&) = delete;

    /// @brief Opens a plugin shared object and records it; nothing runs until `start`.
    Result<void> add_plugin_library(const std::string& path);

    /// @brief Records a plugin that lives in this process (tests, or a plugin linked into the
    /// binary).
    Result<void> add_plugin_api(const NcPluginApi* api, std::string path = "<builtin>");

    /// @brief Opens every `*.so` in `directory`; returns how many were added. A file that is not a
    /// plugin is logged and skipped.
    Result<std::size_t> scan_directory(const std::string& directory);

    /// @brief Starts the enabled plugins, requirements first, then tells them all that the kernel
    /// is ready. A plugin that fails is marked and skipped; the others still run.
    Result<void> start();

    /// @brief Unloads the plugins in reverse start order.
    void stop() noexcept;

    /// @brief The whole request pipeline: authentication, routing, the handler, error mapping.
    [[nodiscard]] http::Response handle(http::Request&& request) const;

    /// @brief Runs an occ command line (`user:add alice`).
    [[nodiscard]] int
    run_command(std::string_view name, const std::vector<std::string>& args, std::string& out)
        const;

    [[nodiscard]] std::vector<PluginInfo> plugins() const;
    [[nodiscard]] std::size_t running_count() const noexcept;

    [[nodiscard]] Config& get_config() noexcept
    {
        return m_config;
    }

    [[nodiscard]] const Config& get_config() const noexcept
    {
        return m_config;
    }

    [[nodiscard]] Logger& get_logger() noexcept
    {
        return m_logger;
    }

    [[nodiscard]] const Logger& get_logger() const noexcept
    {
        return m_logger;
    }

    [[nodiscard]] Router& get_router() noexcept
    {
        return m_router;
    }

    [[nodiscard]] const Router& get_router() const noexcept
    {
        return m_router;
    }

    [[nodiscard]] EventBus& get_events() noexcept
    {
        return m_events;
    }

    [[nodiscard]] const EventBus& get_events() const noexcept
    {
        return m_events;
    }

    [[nodiscard]] ServiceRegistry& get_services() noexcept
    {
        return m_services;
    }

    [[nodiscard]] const ServiceRegistry& get_services() const noexcept
    {
        return m_services;
    }

    [[nodiscard]] JobScheduler& get_jobs() noexcept
    {
        return m_jobs;
    }

    [[nodiscard]] const JobScheduler& get_jobs() const noexcept
    {
        return m_jobs;
    }

    [[nodiscard]] CommandRegistry& get_commands() noexcept
    {
        return m_commands;
    }

    [[nodiscard]] const CommandRegistry& get_commands() const noexcept
    {
        return m_commands;
    }

    /// The product name and version `status.php` reports; the numbers follow the Nextcloud tree
    /// this was ported from.
    static constexpr std::string_view PRODUCT = "Nextcloud";
    static constexpr std::string_view VERSION = "36.0.0.1";
    static constexpr std::string_view VERSION_STRING = "36.0.0 dev (plugin runner)";

private:
    class Slot;

    void install_builtins();
    [[nodiscard]] std::string authenticate(const http::Request& request, bool& rejected) const;
    [[nodiscard]] bool enabled(std::string_view name) const;
    [[nodiscard]] Slot* find_slot(std::string_view name) const noexcept;
    void release(Slot& slot) noexcept;

    // The C ABI callbacks handed to plugins (see abi.h).
    static void host_log(void* ctx, std::int32_t level, NcView plugin, NcView message);
    static std::int32_t
    host_register_route(void* ctx, NcView plugin, NcView method, NcView pattern, std::uint32_t id);
    static std::int32_t
    host_register_service(void* ctx, NcView plugin, NcView name, std::uint32_t id);
    static std::int32_t host_call_service(void* ctx, NcView name, NcView args, NcResponse* out);
    static std::int32_t host_subscribe(void* ctx, NcView plugin, NcView topic);
    static void host_publish(void* ctx, NcView topic, NcView payload);
    static std::int32_t host_register_command(
        void* ctx,
        NcView plugin,
        NcView name,
        NcView description,
        std::uint32_t id
    );
    static NcView host_config_get(void* ctx, NcView plugin, NcView key);
    static std::int32_t host_register_job(
        void* ctx,
        NcView plugin,
        NcView name,
        std::uint32_t interval_seconds,
        std::uint32_t id
    );

    Config m_config{};
    Logger m_logger{};
    Router m_router{};
    EventBus m_events{&m_logger};
    ServiceRegistry m_services{};
    CommandRegistry m_commands{};
    JobScheduler m_jobs{&m_logger};
    NcHost m_native{};
    std::vector<std::unique_ptr<Slot>> m_slots{};
    std::vector<Slot*> m_start_order{};
    bool m_started{false};
};

} // namespace nc
