#include "nextcloud/runner/kernel.h"

#include "nextcloud/stream.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <dlfcn.h>
#include <filesystem>
#include <map>
#include <set>

namespace nc {

namespace {

    /// Keeps the memory behind an NcResponse alive until the next call on this thread.
    struct OutBuffer
    {
        std::string content_type{};
        std::string body{};
        std::vector<http::Header> headers{};
        std::vector<NcPair> pairs{};

        void fill(const http::Response& response, NcResponse* out)
        {
            content_type = response.get_content_type();
            body = response.get_body();
            headers = response.get_headers();
            pairs.clear();
            for (const http::Header& header: headers) {
                pairs.push_back(NcPair{
                    {header.first.data(), header.first.size()},
                    {header.second.data(), header.second.size()}
                });
            }
            out->status = response.get_status();
            out->content_type = {content_type.data(), content_type.size()};
            out->body = {body.data(), body.size()};
            out->headers = pairs.data();
            out->header_count = pairs.size();
            detail::stream_to_native(response, out);
        }
    };

    OutBuffer& out_buffer()
    {
        thread_local OutBuffer buffer;
        return buffer;
    }

    std::string_view text_of(NcView view) noexcept
    {
        return view.data == nullptr ? std::string_view{} : std::string_view{view.data, view.size};
    }

    NcView view_of(std::string_view text) noexcept
    {
        return NcView{text.data(), text.size()};
    }

    http::Response response_from(const NcResponse& out)
    {
        http::Response response{
            out.status,
            std::string{text_of(out.content_type)},
            std::string{text_of(out.body)},
            {}
        };
        for (std::size_t index = 0; index < out.header_count; ++index) {
            response.add_header(
                std::string{text_of(out.headers[index].key)},
                std::string{text_of(out.headers[index].value)}
            );
        }
        detail::stream_from_native(out, response);
        return response;
    }

    std::vector<NcPair> pairs_of(const std::vector<http::Header>& headers)
    {
        std::vector<NcPair> pairs;
        pairs.reserve(headers.size());
        for (const http::Header& header: headers) {
            pairs.push_back(NcPair{view_of(header.first), view_of(header.second)});
        }
        return pairs;
    }

    std::string json_string(std::string_view text)
    {
        return "\"" + util::json_escape(text) + "\"";
    }

} // namespace

/// One plugin as the kernel holds it: the library, its API table and its live instance.
class Kernel::Slot
{
public:
    PluginInfo info{};
    void* library{nullptr};
    const NcPluginApi* api{nullptr};
    void* instance{nullptr};
    /// Topic patterns the plugin subscribed to. The kernel puts one catch-all handler per plugin on
    /// the bus and filters here, so an event that matches two patterns still reaches the plugin
    /// once.
    std::vector<std::string> subscriptions{};

    [[nodiscard]] bool wants(std::string_view topic) const
    {
        return std::ranges::any_of(
            subscriptions,
            [topic](const std::string& pattern)
            {
                return EventBus::matches(pattern, topic);
            }
        );
    }

    [[nodiscard]] http::Response route(std::uint32_t id, const http::Request& request) const
    {
        const std::vector<NcPair> headers = pairs_of(request.get_headers());
        const std::vector<NcPair> params = pairs_of(request.get_params());
        NcRequest native{};
        native.struct_size = sizeof(NcRequest);
        native.method = view_of(request.get_method());
        native.path = view_of(request.get_path());
        native.query = view_of(request.get_query());
        native.body = view_of(request.get_inline_body());
        native.body_file = view_of(request.get_body_file());
        native.user = view_of(request.get_user());
        native.headers = headers.data();
        native.header_count = headers.size();
        native.params = params.data();
        native.param_count = params.size();
        NcResponse out{};
        out.struct_size = sizeof(NcResponse);
        out.status = 500;
        api->handle_route(instance, id, &native, &out);
        return response_from(out);
    }

    [[nodiscard]] http::Response service(std::uint32_t id, std::string_view args) const
    {
        NcResponse out{};
        out.struct_size = sizeof(NcResponse);
        out.status = 500;
        api->call_service(instance, id, view_of(args), &out);
        return response_from(out);
    }

    void event(std::string_view topic, std::string_view payload) const
    {
        api->on_event(instance, view_of(topic), view_of(payload));
    }

    [[nodiscard]] bool job(std::uint32_t id) const
    {
        return api->struct_size >= sizeof(NcPluginApi) && api->run_job != nullptr &&
               api->run_job(instance, id) == 0;
    }

    [[nodiscard]] int
    command(std::uint32_t id, const std::vector<std::string>& args, std::string& output) const
    {
        std::vector<NcView> views;
        views.reserve(args.size());
        for (const std::string& arg: args) {
            views.push_back(view_of(arg));
        }
        NcResponse out{};
        out.struct_size = sizeof(NcResponse);
        const std::int32_t code = api->run_command(instance, id, views.data(), views.size(), &out);
        output = std::string{text_of(out.body)};
        return code;
    }
};

Kernel::Kernel()
{
    m_native.struct_size = sizeof(NcHost);
    m_native.abi_version = NC_ABI_VERSION;
    m_native.ctx = this;
    m_native.log = &Kernel::host_log;
    m_native.register_route = &Kernel::host_register_route;
    m_native.register_service = &Kernel::host_register_service;
    m_native.call_service = &Kernel::host_call_service;
    m_native.subscribe = &Kernel::host_subscribe;
    m_native.publish = &Kernel::host_publish;
    m_native.register_command = &Kernel::host_register_command;
    m_native.config_get = &Kernel::host_config_get;
    m_native.register_job = &Kernel::host_register_job;
    install_builtins();
}

Kernel::Kernel(Config&& config) :
    Kernel()
{
    m_config = std::move(config);
    m_logger.set_level(Logger::parse_level(m_config.get("log_level", "info")));
}

Kernel::~Kernel()
{
    stop();
    for (const std::unique_ptr<Slot>& slot: m_slots) {
        if (slot->library != nullptr) {
            dlclose(slot->library);
        }
    }
}

// ---- plugin discovery ------------------------------------------------------------------------

Result<void> Kernel::add_plugin_api(const NcPluginApi* api, std::string path)
{
    if (api == nullptr || api->struct_size < sizeof(NcPluginApi)) {
        return fail(
            ErrorCode::ABI_MISMATCH,
            path + ": plugin API table is missing or older than this runner"
        );
    }
    if (api->abi_version != NC_ABI_VERSION) {
        return fail(
            ErrorCode::ABI_MISMATCH,
            path + ": ABI version " + std::to_string(api->abi_version) + ", runner speaks " +
                std::to_string(NC_ABI_VERSION)
        );
    }
    const std::string name{text_of(api->name)};
    if (name.empty()) {
        return fail(ErrorCode::INVALID_ARGUMENT, path + ": plugin has no name");
    }
    if (find_slot(name) != nullptr) {
        return fail(ErrorCode::ALREADY_EXISTS, "plugin " + name + " is already added");
    }
    auto slot = std::make_unique<Slot>();
    slot->api = api;
    slot->info.set_name(std::string{name});
    slot->info.set_version(std::string{text_of(api->version)});
    slot->info.set_description(std::string{text_of(api->description)});
    slot->info.set_path(std::move(path));
    for (std::size_t index = 0; index < api->requires_count; ++index) {
        slot->info.add_requires(std::string{text_of(api->requires_plugins[index])});
    }
    m_slots.push_back(std::move(slot));
    return {};
}

Result<void> Kernel::add_plugin_library(const std::string& path)
{
    void* library = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (library == nullptr) {
        return fail(ErrorCode::IO, std::string("cannot open plugin ") + path + ": " + dlerror());
    }
    void* symbol = dlsym(library, NC_PLUGIN_SYMBOL);
    if (symbol == nullptr) {
        dlclose(library);
        return fail(ErrorCode::ABI_MISMATCH, path + " does not export " + NC_PLUGIN_SYMBOL);
    }
    const auto entry = reinterpret_cast<NcPluginApiFn>(symbol);
    Result<void> added = add_plugin_api(entry(), path);
    if (!added) {
        dlclose(library);
        return added;
    }
    m_slots.back()->library = library;
    return {};
}

Result<std::size_t> Kernel::scan_directory(const std::string& directory)
{
    std::error_code error;
    std::filesystem::directory_iterator iterator{directory, error};
    if (error) {
        return fail(
            ErrorCode::IO,
            "cannot read plugin directory " + directory + ": " + error.message()
        );
    }
    std::vector<std::string> files;
    for (const auto& entry: iterator) {
        if (entry.is_regular_file() && entry.path().extension() == ".so") {
            files.push_back(entry.path().string());
        }
    }
    std::ranges::sort(files);
    std::size_t added = 0;
    for (const std::string& file: files) {
        Result<void> result = add_plugin_library(file);
        if (result) {
            ++added;
        } else {
            m_logger.log(LogLevel::WARNING, "kernel", result.error().get_message());
        }
    }
    return added;
}

Kernel::Slot* Kernel::find_slot(std::string_view name) const noexcept
{
    for (const std::unique_ptr<Slot>& slot: m_slots) {
        if (slot->info.get_name() == name) {
            return slot.get();
        }
    }
    return nullptr;
}

bool Kernel::enabled(std::string_view name) const
{
    const std::string* list = m_config.find({}, "plugins");
    if (list == nullptr || util::trim(*list).empty()) {
        return true;
    }
    for (const std::string& item: util::split(*list, ',')) {
        if (util::trim(item) == name) {
            return true;
        }
    }
    return false;
}

// ---- lifecycle ------------------------------------------------------------------------------

Result<void> Kernel::start()
{
    if (m_started) {
        return fail(ErrorCode::ALREADY_EXISTS, "the kernel is already started");
    }
    m_started = true;

    // Requirements first: depth-first, so a plugin comes after everything it requires.
    enum class Mark
    {
        NONE,
        VISITING,
        DONE
    };
    std::map<Slot*, Mark> marks;
    std::vector<Slot*> order;
    std::set<Slot*> cyclic;
    auto visit = [&](auto&& self, Slot* slot) -> void
    {
        Mark& mark = marks[slot];
        if (mark == Mark::DONE) {
            return;
        }
        if (mark == Mark::VISITING) {
            cyclic.insert(slot);
            return;
        }
        mark = Mark::VISITING;
        for (const std::string& required: slot->info.get_requires()) {
            Slot* dependency = find_slot(required);
            if (dependency != nullptr) {
                self(self, dependency);
            }
        }
        marks[slot] = Mark::DONE;
        order.push_back(slot);
    };
    for (const std::unique_ptr<Slot>& slot: m_slots) {
        visit(visit, slot.get());
    }

    for (Slot* slot: order) {
        PluginInfo& info = slot->info;
        if (!enabled(info.get_name())) {
            info.set_state(PluginState::SKIPPED);
            info.set_error("disabled by the plugins setting");
            continue;
        }
        if (cyclic.contains(slot)) {
            info.set_state(PluginState::FAILED);
            info.set_error("requirements form a cycle");
            continue;
        }
        std::string blocked;
        for (const std::string& required: info.get_requires()) {
            const Slot* dependency = find_slot(required);
            if (dependency == nullptr) {
                blocked = "requires " + required + ", which is not installed";
            } else if (dependency->info.get_state() != PluginState::RUNNING) {
                blocked = "requires " + required + ", which is not running";
            }
            if (!blocked.empty()) {
                break;
            }
        }
        if (!blocked.empty()) {
            info.set_state(PluginState::SKIPPED);
            info.set_error(std::string{blocked});
            m_logger.log(LogLevel::WARNING, info.get_name(), "skipped: " + blocked);
            continue;
        }
        slot->instance = slot->api->create();
        if (slot->instance == nullptr) {
            info.set_state(PluginState::FAILED);
            info.set_error("create returned no instance");
            continue;
        }
        if (slot->api->load(slot->instance, &m_native) != 0) {
            info.set_state(PluginState::FAILED);
            info.set_error("load failed");
            m_logger.log(LogLevel::ERROR, info.get_name(), "load failed");
            release(*slot);
            continue;
        }
        info.set_state(PluginState::RUNNING);
        m_start_order.push_back(slot);
        m_logger
            .log(LogLevel::INFO, "kernel", "started " + info.get_name() + " " + info.get_version());
    }
    for (Slot* slot: m_start_order) {
        slot->api->ready(slot->instance);
    }
    m_events.publish("kernel.ready", "");
    return {};
}

void Kernel::release(Slot& slot) noexcept
{
    const std::string& name = slot.info.get_name();
    slot.subscriptions.clear();
    m_events.remove_owner(name);
    m_router.remove_owner(name);
    m_services.remove_owner(name);
    m_commands.remove_owner(name);
    m_jobs.remove_owner(name);
    if (slot.instance != nullptr) {
        slot.api->destroy(slot.instance);
        slot.instance = nullptr;
    }
}

void Kernel::stop() noexcept
{
    if (!m_started) {
        return;
    }
    m_started = false;
    for (auto it = m_start_order.rbegin(); it != m_start_order.rend(); ++it) {
        Slot& slot = **it;
        slot.api->unload(slot.instance);
        release(slot);
        slot.info.set_state(PluginState::STOPPED);
    }
    m_start_order.clear();
}

std::vector<PluginInfo> Kernel::plugins() const
{
    std::vector<PluginInfo> infos;
    for (const std::unique_ptr<Slot>& slot: m_slots) {
        infos.push_back(slot->info);
    }
    return infos;
}

std::size_t Kernel::running_count() const noexcept
{
    return m_start_order.size();
}

// ---- requests -------------------------------------------------------------------------------

std::string
Kernel::authenticate(const http::Request& request, bool& rejected, bool& second_factor) const
{
    rejected = false;
    second_factor = false;
    // Under /public.php/ the Authorization header names a share (user name = token), not an
    // account; the plugin that serves it reads the header itself.
    if (util::starts_with(request.get_path(), "/public.php/")) {
        return {};
    }
    const std::string_view header = request.header("Authorization");
    if (header.size() >= 7 && util::equals_ignore_case(header.substr(0, 7), "Bearer ")) {
        // An access token (OAuth2): whoever offers `auth.bearer*` knows it. Like an app password it
        // stands for the whole sign-in and is not asked for a second factor.
        const std::string token{util::trim(header.substr(7))};
        for (const std::string& provider: m_services.names("auth.bearer")) {
            const http::Response answer = m_services.call(provider, token);
            if (answer.get_status() == 200 && !answer.get_body().empty()) {
                return answer.get_body();
            }
        }
        rejected = true;
        m_events.publish(
            "auth.failed",
            util::form_encode(
                {{"user", "(access token)"},
                 {"reason", "token"},
                 {"ip", std::string{request.header("X-NC-Remote-Addr")}}}
            )
        );
        return {};
    }
    if (header.size() < 6 || !util::equals_ignore_case(header.substr(0, 6), "Basic ")) {
        return {};
    }
    const auto decoded = util::base64_decode(util::trim(header.substr(6)));
    if (!decoded || decoded->find(':') == std::string::npos) {
        rejected = true;
        return {};
    }
    // Who tried (the login name only, never the password), for plugins that watch sign-ins.
    const auto failed = [&](std::string_view reason)
    {
        m_events.publish(
            "auth.failed",
            util::form_encode(
                {{"user", decoded->substr(0, decoded->find(':'))},
                 {"reason", std::string{reason}},
                 {"ip", std::string{request.header("X-NC-Remote-Addr")}}}
            )
        );
    };
    // 1. An app password (token) stands for the whole sign-in: it is what clients keep, and it is
    // not
    //    asked for a second factor.
    if (m_services.contains("auth.token")) {
        const http::Response token = m_services.call("auth.token", *decoded);
        if (token.get_status() == 200 && !token.get_body().empty()) {
            return token.get_body();
        }
    }
    // 2. The account password, or whatever else offers `auth.authenticate*` (a directory): the
    // first that
    //    knows the person wins.
    std::string user;
    for (const std::string& provider: m_services.names("auth.authenticate")) {
        const http::Response answer = m_services.call(provider, *decoded);
        if (answer.get_status() == 200 && !answer.get_body().empty()) {
            user = answer.get_body();
            break;
        }
    }
    if (user.empty()) {
        rejected = true;
        failed("password");
        return {};
    }
    // 3. The second factor, when a plugin offers one and the account uses it. The code comes in a
    // header.
    if (m_services.contains("auth.second_factor")) {
        const http::Response factor = m_services.call(
            "auth.second_factor",
            user + "\n" + std::string{request.header("X-NC-OTP")}
        );
        if (factor.get_status() != 200) {
            rejected = true;
            second_factor = true;
            failed("second factor");
            return {};
        }
    }
    // A good password clears what this address got wrong for this account (and only for it: a
    // sign-in to one's own account must not wipe the guesses at another).
    if (m_services.contains("auth.throttle_reset")) {
        (void)m_services.call(
            "auth.throttle_reset",
            std::string{request.header("X-NC-Remote-Addr")} + "\n" + user
        );
    }
    return user;
}

http::Response Kernel::handle(http::Request&& request) const
{
    // The user comes from authentication only, never from the wire.
    request.set_user(std::string{});
    // An address that has guessed too often waits, whatever it sends now. Only requests that carry
    // credentials are held back, and not the public share endpoints (their "password" is a token).
    if (!request.header("Authorization").empty() && !request.header("X-NC-Remote-Addr").empty() &&
        !util::starts_with(request.get_path(), "/public.php/") &&
        m_services.contains("auth.throttle")) {
        http::Response verdict =
            m_services.call("auth.throttle", std::string{request.header("X-NC-Remote-Addr")});
        if (verdict.get_status() == 429) {
            return verdict;
        }
    }
    bool rejected = false;
    bool second_factor = false;
    std::string user = authenticate(request, rejected, second_factor);
    if (rejected) {
        http::Response refused = http::unauthorized();
        if (second_factor) {
            // The password was right; tell the client it must send a code in `X-NC-OTP`.
            refused.add_header("X-NC-Two-Factor", "required");
        }
        return refused;
    }
    request.set_user(std::move(user));

    // HEAD is GET without the body: the handler sees a GET, the body is dropped below.
    const bool head = request.get_method() == "HEAD";
    if (head) {
        request.set_method("GET");
    }
    const std::string method = request.get_method();
    const std::string original_method = head ? "HEAD" : method;
    const Router::Match match = m_router.match(method, request.get_path());

    http::Response response;
    if (match.outcome == Router::Outcome::FOUND) {
        request.set_params(std::vector<http::Header>(match.params));
        try {
            response = (*match.handler)(request);
        } catch (const std::exception& error) {
            m_logger.log(
                LogLevel::ERROR,
                "kernel",
                original_method + " " + request.get_path() + " threw: " + error.what()
            );
            response = http::Response::text(500, "Internal Server Error");
        }
    } else if (match.outcome == Router::Outcome::METHOD_NOT_ALLOWED) {
        std::string allow = "OPTIONS";
        for (const std::string& allowed: match.allowed) {
            allow += ", " + allowed;
        }
        if (request.get_method() == "OPTIONS") {
            response = http::Response{200};
        } else {
            response = http::Response::text(405, "Method Not Allowed");
        }
        response.add_header("Allow", std::move(allow));
    } else {
        response = http::Response::text(404, "Not Found");
    }
    if (head) {
        response.add_header(
            "Content-Length",
            std::to_string(
                response.is_streamed() ? response.get_stream_length() : response.get_body().size()
            )
        );
        response.clear_stream();
        response.set_body(std::string{});
    }
    return response;
}

int Kernel::run_command(
    std::string_view name,
    const std::vector<std::string>& args,
    std::string& out
) const
{
    return m_commands.run(name, args, out);
}

// ---- C ABI callbacks ------------------------------------------------------------------------

void Kernel::host_log(void* ctx, std::int32_t level, NcView plugin, NcView message)
{
    static_cast<Kernel*>(ctx)
        ->m_logger.log(static_cast<LogLevel>(level), text_of(plugin), text_of(message));
}

std::int32_t Kernel::host_register_route(
    void* ctx,
    NcView plugin,
    NcView method,
    NcView pattern,
    std::uint32_t id
)
{
    auto* kernel = static_cast<Kernel*>(ctx);
    const Slot* slot = kernel->find_slot(text_of(plugin));
    if (slot == nullptr) {
        return -1;
    }
    Result<void> added = kernel->m_router.add(
        text_of(method),
        text_of(pattern),
        text_of(plugin),
        [slot, id](const http::Request& request)
        {
            return slot->route(id, request);
        }
    );
    if (!added) {
        kernel->m_logger.log(LogLevel::ERROR, text_of(plugin), added.error().get_message());
        return -1;
    }
    return 0;
}

std::int32_t Kernel::host_register_service(void* ctx, NcView plugin, NcView name, std::uint32_t id)
{
    auto* kernel = static_cast<Kernel*>(ctx);
    const Slot* slot = kernel->find_slot(text_of(plugin));
    if (slot == nullptr) {
        return -1;
    }
    Result<void> added = kernel->m_services.add(
        text_of(name),
        text_of(plugin),
        [slot, id](std::string_view args)
        {
            return slot->service(id, args);
        }
    );
    if (!added) {
        kernel->m_logger.log(LogLevel::ERROR, text_of(plugin), added.error().get_message());
        return -1;
    }
    return 0;
}

std::int32_t Kernel::host_call_service(void* ctx, NcView name, NcView args, NcResponse* out)
{
    const http::Response response =
        static_cast<Kernel*>(ctx)->m_services.call(text_of(name), text_of(args));
    out_buffer().fill(response, out);
    return out->status;
}

std::int32_t Kernel::host_subscribe(void* ctx, NcView plugin, NcView topic)
{
    auto* kernel = static_cast<Kernel*>(ctx);
    Slot* slot = kernel->find_slot(text_of(plugin));
    if (slot == nullptr) {
        return -1;
    }
    const bool first = slot->subscriptions.empty();
    slot->subscriptions.emplace_back(text_of(topic));
    if (first) {
        kernel->m_events.subscribe(
            "*",
            text_of(plugin),
            [slot](std::string_view event_topic, std::string_view payload)
            {
                if (slot->wants(event_topic)) {
                    slot->event(event_topic, payload);
                }
            }
        );
    }
    return 0;
}

void Kernel::host_publish(void* ctx, NcView topic, NcView payload)
{
    static_cast<Kernel*>(ctx)->m_events.publish(text_of(topic), text_of(payload));
}

std::int32_t Kernel::host_register_command(
    void* ctx,
    NcView plugin,
    NcView name,
    NcView description,
    std::uint32_t id
)
{
    auto* kernel = static_cast<Kernel*>(ctx);
    const Slot* slot = kernel->find_slot(text_of(plugin));
    if (slot == nullptr) {
        return -1;
    }
    Result<void> added = kernel->m_commands.add(
        CommandInfo{
            std::string{text_of(name)},
            std::string{text_of(description)},
            std::string{text_of(plugin)}
        },
        [slot, id](const std::vector<std::string>& args, std::string& output)
        {
            return slot->command(id, args, output);
        }
    );
    if (!added) {
        kernel->m_logger.log(LogLevel::ERROR, text_of(plugin), added.error().get_message());
        return -1;
    }
    return 0;
}

std::int32_t Kernel::host_register_job(
    void* ctx,
    NcView plugin,
    NcView name,
    std::uint32_t interval_seconds,
    std::uint32_t id
)
{
    auto* kernel = static_cast<Kernel*>(ctx);
    const Slot* slot = kernel->find_slot(text_of(plugin));
    if (slot == nullptr) {
        return -1;
    }
    kernel->m_jobs.add(
        text_of(name),
        text_of(plugin),
        std::chrono::seconds{interval_seconds},
        [slot, id]()
        {
            return slot->job(id);
        }
    );
    return 0;
}

NcView Kernel::host_config_get(void* ctx, NcView plugin, NcView key)
{
    // `[plugin] key` first, then the runner-wide `key` (so `data_dir` is set once for every
    // plugin).
    const Config& config = static_cast<Kernel*>(ctx)->m_config;
    const std::string* value = config.find(text_of(plugin), text_of(key));
    if (value == nullptr) {
        value = config.find({}, text_of(key));
    }
    return value == nullptr ? NcView{nullptr, 0} : view_of(*value);
}

// ---- built-in routes and commands ---------------------------------------------------------

void Kernel::install_builtins()
{
    // The version the runner reports, for plugins that compare it with another (update checks).
    (void)m_services.add(
        "core.version",
        "kernel",
        [](std::string_view)
        {
            return http::Response::text(200, std::string{VERSION});
        }
    );
    (void)m_router.add(
        "GET",
        "/status.php",
        "kernel",
        [this](const http::Request&)
        {
            std::string body =
                R"({"installed":true,"maintenance":false,"needsDbUpgrade":false,"version":)";
            body += json_string(VERSION) + R"(,"versionstring":)" + json_string(VERSION_STRING);
            body += R"(,"edition":"","productname":)" + json_string(PRODUCT) +
                    R"(,"extendedSupport":false,"plugins":[)";
            bool first = true;
            for (const PluginInfo& info: plugins()) {
                body += first ? "" : ",";
                first = false;
                body += R"({"name":)" + json_string(info.get_name()) + R"(,"version":)" +
                        json_string(info.get_version());
                body +=
                    R"(,"state":)" + json_string(PluginInfo::state_name(info.get_state())) + "}";
            }
            body += "]}";
            return http::Response::json(200, std::move(body));
        }
    );

    // What this server can do, as the clients ask for it. Every plugin that wants to be listed
    // offers a service `capabilities.<name>` that answers a JSON object (Nextcloud:
    // `OCP\Capabilities\ICapability`).
    (void)m_router.add(
        "GET",
        "/ocs/v2.php/cloud/capabilities",
        "kernel",
        [this](const http::Request&)
        {
            std::string data = R"({"version":{"string":)" + json_string(VERSION) +
                               R"(,"edition":"","productname":)" + json_string(PRODUCT) +
                               R"(},"capabilities":{)";
            bool first = true;
            for (const std::string& name: m_services.names("capabilities.")) {
                const http::Response answer = m_services.call(name, "");
                if (answer.get_status() != 200 || answer.get_body().empty()) {
                    continue;
                }
                data += first ? "" : ",";
                first = false;
                data += json_string(name.substr(13)) + ":" + answer.get_body();
            }
            return http::ocs(200, "OK", data + "}}");
        }
    );

    (void)m_router.add(
        "GET",
        "/ocs/v2.php/cloud/plugins",
        "kernel",
        [this](const http::Request&)
        {
            std::string data = "[";
            bool first = true;
            for (const PluginInfo& info: plugins()) {
                data += first ? "" : ",";
                first = false;
                data += R"({"id":)" + json_string(info.get_name()) + R"(,"version":)" +
                        json_string(info.get_version());
                data += R"(,"description":)" + json_string(info.get_description());
                data += R"(,"state":)" + json_string(PluginInfo::state_name(info.get_state()));
                data += R"(,"requires":[)";
                bool first_required = true;
                for (const std::string& required: info.get_requires()) {
                    data += first_required ? "" : ",";
                    first_required = false;
                    data += json_string(required);
                }
                data += "]}";
            }
            data += "]";
            return http::ocs(200, "OK", data);
        }
    );

    (void)m_commands.add(
        CommandInfo{"list", "Lists all commands", "kernel"},
        [this](const std::vector<std::string>&, std::string& out)
        {
            for (const CommandInfo& info: m_commands.list()) {
                out += info.get_name() + "\t" + info.get_description() + "\n";
            }
            return 0;
        }
    );

    (void)m_commands.add(
        CommandInfo{"status", "Shows the version and the running plugins", "kernel"},
        [this](const std::vector<std::string>&, std::string& out)
        {
            out += std::string(PRODUCT) + " " + std::string(VERSION_STRING) + "\n";
            out += "  plugins running: " + std::to_string(running_count()) + "\n";
            return 0;
        }
    );

    (void)m_commands.add(
        CommandInfo{"background:run", "Runs every background job once", "kernel"},
        [this](const std::vector<std::string>&, std::string& out)
        {
            const std::size_t ran = m_jobs.run_due(JobScheduler::Clock::now(), true);
            out = "ran " + std::to_string(ran) + " job(s)\n";
            return 0;
        }
    );

    (void)m_commands.add(
        CommandInfo{"background:list", "Lists the background jobs", "kernel"},
        [this](const std::vector<std::string>&, std::string& out)
        {
            for (const JobScheduler::Info& info: m_jobs.list()) {
                out += info.owner + "\t" + info.name + "\tevery " +
                       std::to_string(info.interval.count()) + "s\truns " +
                       std::to_string(info.runs) + "\tfailed " + std::to_string(info.failures) +
                       "\n";
            }
            return 0;
        }
    );

    (void)m_commands.add(
        CommandInfo{"plugin:list", "Lists the installed plugins and their state", "kernel"},
        [this](const std::vector<std::string>&, std::string& out)
        {
            for (const PluginInfo& info: plugins()) {
                out += info.get_name() + "\t" + info.get_version() + "\t" +
                       PluginInfo::state_name(info.get_state());
                out += info.get_error().empty() ? "" : "\t(" + info.get_error() + ")";
                out += "\n";
            }
            return 0;
        }
    );

    (void)m_commands.add(
        CommandInfo{"config:get", "Prints a config value: config:get <key>", "kernel"},
        [this](const std::vector<std::string>& args, std::string& out)
        {
            if (args.size() != 1) {
                out = "usage: config:get <key>\n";
                return 1;
            }
            const std::string* value = m_config.find({}, args[0]);
            if (value == nullptr) {
                out = "not set\n";
                return 1;
            }
            out = *value + "\n";
            return 0;
        }
    );
}

} // namespace nc
