# Architecture

## The idea

Nextcloud is one PHP application with a core (`lib/`, `core/`) and apps (`apps/*`) that the core loads. Here
the core shrinks to a **runner** and everything else becomes a **plugin**:

```
                  HTTP                         occ (command line)
                    |                                  |
              +-----v----------------------------------v-----+
              |                    Kernel                      |
              |  Router   ServiceRegistry   EventBus   Commands|
              |  Config   Logger            PluginHost         |
              +--^----------^-------------^----------^--------+
                 | C ABI (sdk/plugin/abi.h)  one table per plugin
        +--------+--+  +----+------+  +----+------+
        |   users   |  |   cloud   |  |   mail    |   ...
        +-----------+  +-----------+  +-----------+
```

| Nextcloud | Here |
| --- | --- |
| `lib/private/Server.php`, the server container (`IServerContainer`) | `ServiceRegistry`: a plugin asks for `users.email`, it does not know who offers it |
| `lib/private/EventDispatcher` | `EventBus`, topics with a `*` suffix pattern |
| `lib/private/Route`, `routes.php` of every app | `Router`: `{name}` and `{*rest}` segments, the most specific route wins |
| `lib/private/App/AppManager`, `appinfo/info.xml` (`<dependencies>`) | `Kernel::start`: plugins state `get_requires()`, start in dependency order, a plugin with a missing or failed requirement is skipped |
| `occ`, `OC\Core\Command\*` | `CommandRegistry`, `nextcloud occ <group:action>` |
| `config/config.php` | `Config` (`key = value`, `[plugin]` sections) |
| `status.php` | built-in `GET /status.php`, with the plugin list |

## The plugin ABI

One header, `sdk/plugin/include/nextcloud/abi.h`, plain C. Same rules as congelado's plugin ABI:

* only C types cross the boundary (no exceptions, no `std::` types, no ownership transfer);
* every struct starts with `struct_size`, so fields can be added without breaking older plugins;
* a plugin exports one symbol, `nc_plugin_api`, returning a table with its name, version, requirements and
  function pointers (`create`, `load`, `ready`, `unload`, `handle_route`, `call_service`, `on_event`,
  `run_command`, `destroy`);
* the runner gives the plugin an `NcHost` table (log, register_route/service/command, subscribe, publish,
  call_service, config_get).

A plugin never touches these structs. `sdk/plugin/include/nextcloud/plugin.h` wraps them: derive from
`nc::Plugin`, register in `on_load(nc::Host&)`, export with `NC_PLUGIN(Class)`. Exceptions are caught at the
boundary: a throwing route becomes a 500, a throwing `on_load` marks the plugin failed and rolls back its
routes, services, subscriptions and commands.

Plugins talk to each other only through the kernel: `host.call_service("users.email", "alice")` and events
(`share.created`, `user.created`, `file.deleted`, ...). Service arguments and event payloads are
form-encoded strings (`a=1&b=two%20words`), so no plugin depends on another's types.

Threading: the HTTP server runs one thread per connection, so route handlers and services run
concurrently. Plugin state is guarded by the plugin (the stores use a mutex). Registrations happen while the
kernel starts and stops, not while it serves.

## The plugins

**users** (`lib/private/User`, `apps/provisioning_api`): accounts in one text file, passwords as
PBKDF2-HMAC-SHA-256 with a random salt. Offers `auth.authenticate`, which the kernel uses for HTTP basic
authentication, so *any* plugin can be the identity provider. A successful login is remembered for five
minutes by digest (the key derivation is slow on purpose). OCS provisioning API
(`/ocs/v2.php/cloud/users`) and `user:add|list|delete|resetpassword|enable|disable`.

**cloud** (`apps/files`, `apps/dav`, `apps/files_sharing`, `lib/private/Share20`): per-user storage under
`<data_dir>/<user>/files`, WebDAV at `/remote.php/dav/files/<user>/` (and the legacy `/remote.php/webdav/`)
with GET, PUT, MKCOL, DELETE, MOVE, COPY and PROPFIND; shares by user and by public link
(`/ocs/v2.php/apps/files_sharing/api/v1/shares`, `/s/<token>`). Paths are normalized (no `.`/`..`), symlinks
are never followed, writes are atomic, downloads carry `nosniff` and a sandboxing CSP. Quotas, ETags,
`X-OC-Mtime`. Keeps shares in step with files (`file.deleted`, `file.moved`) and accounts (`user.deleted`).

**mail** (`lib/private/Mail`): builds RFC 5322 messages (RFC 2047 headers, `multipart/alternative`, base64
bodies, header injection refused) and sends them through a transport: `spool` (files in a directory),
`sendmail` (started without a shell), `smtp` (RFC 5321 to a relay), `null`. Offers `mail.send`; listens for
`share.created` and `user.created` to notify people.

## Toolchain

congelado builds with clang 22, C++26 and **named modules** (`import std;`). This tree uses the same Bazel
setup but not the modules:

| congelado | here | why |
| --- | --- | --- |
| clang 22, `-std=gnu++26`, modules (`.cppm`, `cpp_modules` feature, patched `rules_cc`, dependency scanner wrapper) | clang >= 18, `-std=gnu++23`, headers | the machine this was written on has clang 18, which cannot do `import std` |
| `std::expected` | `nc::util::expected` (is `std::expected` when the library has it) | clang 18 reports `__cpp_concepts` too low for libstdc++ 13 to enable `<expected>` |
| `std::move_only_function` | `std::function` | handlers are copied by the event bus so it can publish without holding its lock; a move-only handler would need a `shared_ptr` there |
| `.clang-format` for clang 22 | same file; `tools/format.sh` skips options an older clang-format does not know | |
| hermetic third-party repos | none, the only dependencies are the standard library and POSIX | |

Everything else is taken over: Bazel 9.2 (`.bazelversion`), the hand-declared system clang toolchain
(`bazel/toolchain/system_cc`, needed because rules_cc's auto-detected one is broken under Bazel 9),
`.bazelrc` (flags, sanitizer configs in `bazel/ci.bazelrc`, `warnings.bazelrc`), the `build_defs.bzl` /
`copts.bzl` macro layout, `CODESTYLE.md`, `.clang-format`, `.clangd`. Moving to modules later means adding
congelado's module macros and `.cppm` interfaces on top of these headers; the C ABI does not change.

## Code style (CODESTYLE.md)

* value classes (`Request`, `Response`, `Error`, `PluginInfo`, `CommandInfo`, `User`, `Share`, `Node`,
  `MailMessage`, `Envelope`, `StorageError`, `DavTarget`) have: a default constructor, a plain one, one with
  all members taking rvalues that are moved in, `add_x(T&&)` returning `Class&`, `set_x(T&&)`, `get_x()`,
  `get_x() const`, member initializers `m_x{}`;
* `noexcept` where nothing can throw, `const` on every method that can be, `std::expected` (not exceptions)
  for failures that are expected;
* behaviour classes (`Router`, `EventBus`, `ServiceRegistry`, `Storage`, the stores, the transports) have
  `m_` members with initializers and const/noexcept methods, but no setters or adders where those make no
  sense;
* the **builder pattern** (rule 11) is not used anywhere: that rule says to ask first. The natural place is
  `MailMessage`; see the open question in `TASKS.md`.
