/**
 * @file abi.h
 * @brief The one binary interface between the runner and its plugins. Plain C, so a plugin can be
 * built with another compiler, another standard library or another language than the runner.
 *
 * Rules, same as congelado's plugin ABI:
 *  - Only C types cross the boundary. No exceptions, no std types, no ownership transfer.
 *  - Every struct starts with `struct_size`, so a field added later never breaks an older plugin.
 *  - Views (`NcView`) are borrowed. They stay valid until the call that received them returns,
 * unless stated otherwise.
 *  - Memory a plugin hands out in an `NcResponse` belongs to the plugin and stays valid until the
 * next call into the same plugin on the same thread.
 */
#ifndef NEXTCLOUD_ABI_H
#define NEXTCLOUD_ABI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C"
{
#endif

#define NC_ABI_VERSION 1u

#if defined(_WIN32)
    #define NC_EXPORT __declspec(dllexport)
#else
    #define NC_EXPORT __attribute__((visibility("default")))
#endif

    /** A borrowed, not NUL-terminated byte string. `data == NULL` means "not set". */
    typedef struct NcView
    {
        const char* data;
        size_t size;
    } NcView;

    typedef struct NcPair
    {
        NcView key;
        NcView value;
    } NcPair;

    typedef struct NcRequest
    {
        uint32_t struct_size;
        NcView method;
        NcView path;
        NcView query;
        NcView body;
        /** The authenticated user id, empty when the request is anonymous. */
        NcView user;
        const NcPair* headers;
        size_t header_count;
        /** Values of the `{name}` segments of the matched route pattern. */
        const NcPair* params;
        size_t param_count;
    } NcRequest;

    typedef struct NcResponse
    {
        uint32_t struct_size;
        int32_t status;
        NcView content_type;
        NcView body;
        const NcPair* headers;
        size_t header_count;
    } NcResponse;

    typedef enum NcLogLevel
    {
        NC_LOG_DEBUG = 0,
        NC_LOG_INFO = 1,
        NC_LOG_WARNING = 2,
        NC_LOG_ERROR = 3,
        NC_LOG_FATAL = 4
    } NcLogLevel;

    /** What the runner offers a plugin. Handed to `load`; the pointer stays valid until `unload`
     * returns. */
    typedef struct NcHost
    {
        uint32_t struct_size;
        uint32_t abi_version;
        void* ctx;

        void (*log)(void* ctx, int32_t level, NcView plugin, NcView message);

        /** Routes `method` + `pattern` to `handle_route(id)` of the calling plugin. 0 = ok. */
        int32_t (*register_route)(
            void* ctx,
            NcView plugin,
            NcView method,
            NcView pattern,
            uint32_t id
        );

        /** Publishes `call_service(id)` of the calling plugin under `name`. 0 = ok. */
        int32_t (*register_service)(void* ctx, NcView plugin, NcView name, uint32_t id);

        /** Calls a service of any loaded plugin. Returns its status; `out` is valid until the next
         * call. */
        int32_t (*call_service)(void* ctx, NcView name, NcView args, NcResponse* out);

        /** Delivers every event published under `topic` to `on_event` of the calling plugin. 0 =
         * ok. */
        int32_t (*subscribe)(void* ctx, NcView plugin, NcView topic);
        void (*publish)(void* ctx, NcView topic, NcView payload);

        /** Adds a command to the occ-style command line: `run_command(id)` of the calling plugin.
         */
        int32_t (*register_command)(
            void* ctx,
            NcView plugin,
            NcView name,
            NcView description,
            uint32_t id
        );

        /**
         * Config value: `[plugin] key` first, then the runner-wide `key`. `data == NULL` when
         * unset. Valid for the life of the runner.
         */
        NcView (*config_get)(void* ctx, NcView plugin, NcView key);
    } NcHost;

    typedef struct NcPluginApi
    {
        uint32_t struct_size;
        uint32_t abi_version;
        NcView name;
        NcView version;
        NcView description;
        /** Names of the plugins that must be loaded before this one. */
        const NcView* requires_plugins;
        size_t requires_count;

        void* (*create)(void);
        void (*destroy)(void* self);
        /** Registers routes, services, subscriptions and commands. Non-zero aborts the load. */
        int32_t (*load)(void* self, const NcHost* host);
        /** Once every plugin has loaded. */
        void (*ready)(void* self);
        void (*unload)(void* self);

        int32_t (*handle_route)(void* self, uint32_t id, const NcRequest* request, NcResponse* out);
        int32_t (*call_service)(void* self, uint32_t id, NcView args, NcResponse* out);
        void (*on_event)(void* self, NcView topic, NcView payload);
        int32_t (*run_command)(
            void* self,
            uint32_t id,
            const NcView* args,
            size_t arg_count,
            NcResponse* out
        );
    } NcPluginApi;

/** The one symbol a plugin shared object exports. */
#define NC_PLUGIN_SYMBOL "nc_plugin_api"
    typedef const NcPluginApi* (*NcPluginApiFn)(void);

#ifdef __cplusplus
}
#endif

#endif
