#include "nextcloud/runner/http_server.h"
#include "nextcloud/runner/kernel.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <filesystem>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

namespace {

std::atomic<bool> g_stop{false};

void on_signal(int /*signal*/)
{
    g_stop = true;
}

void usage()
{
    std::puts("usage: nextcloud [--config FILE] [--plugins DIR] <command> [args]\n"
              "\n"
              "  serve [--listen ADDRESS] [--port N]   run the HTTP server\n"
              "  occ <command> [args]                  run a command (try: occ list)\n"
              "  <command> [args]                      same as occ <command>\n");
}

} // namespace

int main(int argc, char** argv)
{
    std::vector<std::string> args(argv + 1, argv + argc);
    std::string config_path = "config/config.conf";
    std::string plugin_dir;
    std::vector<std::string> rest;
    for (std::size_t index = 0; index < args.size(); ++index) {
        if (args[index] == "--config" && index + 1 < args.size()) {
            config_path = args[++index];
        } else if (args[index] == "--plugins" && index + 1 < args.size()) {
            plugin_dir = args[++index];
        } else if (args[index] == "--help" || args[index] == "-h") {
            usage();
            return 0;
        } else {
            rest.push_back(args[index]);
        }
    }
    if (rest.empty()) {
        usage();
        return 2;
    }

    nc::Config config;
    if (std::filesystem::exists(config_path)) {
        nc::Result<nc::Config> loaded = nc::Config::load_file(config_path);
        if (!loaded) {
            std::fprintf(
                stderr,
                "%s: %s\n",
                config_path.c_str(),
                loaded.error().get_message().c_str()
            );
            return 2;
        }
        config = std::move(*loaded);
    }
    nc::Kernel kernel{std::move(config)};
    // A command line call prints its result, not the start-up of every plugin; `log_level`
    // overrides.
    if (rest.front() != "serve" && kernel.get_config().find({}, "log_level") == nullptr) {
        kernel.get_logger().set_level(nc::LogLevel::WARNING);
    }
    if (plugin_dir.empty()) {
        plugin_dir = kernel.get_config().get("plugin_dir", "plugins");
    }
    if (std::filesystem::is_directory(plugin_dir)) {
        const nc::Result<std::size_t> scanned = kernel.scan_directory(plugin_dir);
        if (!scanned) {
            std::fprintf(stderr, "%s\n", scanned.error().get_message().c_str());
            return 2;
        }
    }
    if (const nc::Result<void> started = kernel.start(); !started) {
        std::fprintf(stderr, "%s\n", started.error().get_message().c_str());
        return 2;
    }

    const bool occ = rest.front() == "occ";
    if (occ && rest.size() == 1) {
        usage();
        return 2;
    }
    const std::string command = occ ? rest[1] : rest[0];
    const std::vector<std::string> command_args(rest.begin() + (occ ? 2 : 1), rest.end());

    if (occ || command != "serve") {
        std::string out;
        const int code = kernel.run_command(command, command_args, out);
        std::fputs(out.c_str(), code == 0 ? stdout : stderr);
        kernel.stop();
        return code;
    }

    std::string listen = kernel.get_config().get("listen", "127.0.0.1");
    long port = kernel.get_config().get_integer("port", 8'080);
    for (std::size_t index = 0; index < command_args.size(); ++index) {
        if (command_args[index] == "--listen" && index + 1 < command_args.size()) {
            listen = command_args[++index];
        } else if (command_args[index] == "--port" && index + 1 < command_args.size()) {
            port = std::stol(command_args[++index]);
        }
    }
    nc::HttpServer server{kernel};
    const std::string tls_cert = kernel.get_config().get("tls_cert", "");
    const std::string tls_key = kernel.get_config().get("tls_key", "");
    if (!tls_cert.empty() || !tls_key.empty()) {
        if (const nc::Result<void> secured = server.enable_tls(tls_cert, tls_key); !secured) {
            std::fprintf(stderr, "tls: %s\n", secured.error().get_message().c_str());
            kernel.stop();
            return 1;
        }
    }
    const nc::Result<std::uint16_t> bound = server.start(listen, static_cast<std::uint16_t>(port));
    if (!bound) {
        std::fprintf(stderr, "%s\n", bound.error().get_message().c_str());
        kernel.stop();
        return 1;
    }
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);
    std::fprintf(
        stderr,
        "listening on %s://%s:%u with %zu plugin(s)\n",
        tls_cert.empty() ? "http" : "https",
        listen.c_str(),
        static_cast<unsigned>(*bound),
        kernel.running_count()
    );
    // The jobs of the plugins run here, once a second, while the server serves (Nextcloud:
    // cron.php).
    auto last_jobs = std::chrono::steady_clock::now();
    while (!g_stop) {
        std::this_thread::sleep_for(std::chrono::milliseconds{100});
        if (std::chrono::steady_clock::now() - last_jobs >= std::chrono::seconds{1}) {
            kernel.get_jobs().run_due();
            last_jobs = std::chrono::steady_clock::now();
        }
    }
    server.stop();
    kernel.stop();
    return 0;
}
