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

## Request pipeline

`Kernel::handle` for every request: (1) the `user` field is cleared (it never comes from the wire);
(2) with an `Authorization: Basic` header, authentication runs through *services*, so whichever plugins are
loaded decide: `auth.token` (an app password, which also skips the second factor), else `auth.authenticate`
(the account password), then `auth.second_factor` (a TOTP or backup code in `X-NC-OTP`); a refusal is a 401,
with `X-NC-Two-Factor: required` when only the code is missing; (3) the router picks the handler, 404 / 405
(with `Allow`) / `OPTIONS` / `HEAD` are answered here; (4) a throwing handler becomes a 500. Without an
authentication service loaded, a request that carries credentials is refused, never treated as anonymous.

Background jobs: plugins call `host.add_job(name, seconds, fn)`; `serve` runs the due jobs once a second,
`occ background:run` runs them all once. A job that throws is logged and counted, the others still run.

## The plugins

Every plugin is a separate shared object with its own `requires` list; the runner starts them in
dependency order. Records live in SQLite behind the `db` plugin (`nextcloud/db.h`), bytes on disk behind
`cloud`; plugins never open a database or a user's files themselves.

```
db  <- users  <- cloud  <- trashbin, versions
    <- groups, tokens, twofactor (also need users)
    <- activity, notifications, calendar, contacts, mail (mail needs nothing)
```

**db**: SQLite, one connection behind a mutex, WAL. Services `db.exec`, `db.query` (rows as form-encoded
lines), `db.migrate` (a script applied once per plugin and version, in a transaction). Parameters are
always bound, never pasted.

**users** (`lib/private/User`, `apps/provisioning_api`): accounts in one text file, passwords as
PBKDF2-HMAC-SHA-256 with a random salt. Offers `auth.authenticate`. A successful login is remembered for
five minutes by digest (the key derivation is slow on purpose). OCS provisioning API
(`/ocs/v2.php/cloud/users`) and `user:add|list|delete|resetpassword|enable|disable`.

**groups**, **tokens**, **twofactor**: groups and membership (`groups.*` services, OCS group API);
app passwords (125 random bits, only a digest stored, `auth.token`); TOTP with the RFC 6238 test vectors,
the same code never accepted twice, 10 one-time backup codes (`auth.second_factor`).

**cloud** (`apps/files`, `apps/dav`, `apps/files_sharing`, `lib/private/Share20`): per-user storage under
`<data_dir>/<user>/files`, WebDAV at `/remote.php/dav/files/<user>/` (and the legacy `/remote.php/webdav/`)
with GET, PUT, MKCOL, DELETE, MOVE, COPY and PROPFIND; shares by user and by public link
(`/ocs/v2.php/apps/files_sharing/api/v1/shares`, `/s/<token>`). Paths are normalized (no `.`/`..`), symlinks
are never followed, writes are atomic, downloads carry `nosniff` and a sandboxing CSP. Quotas, ETags,
`X-OC-Mtime`. Before a delete it asks `trashbin.before_delete`, before an overwrite
`versions.before_write`; it offers `cloud.trash.*` and `cloud.version.*` so those plugins never touch the
disk.

**trashbin**, **versions**: the records (original path, time, size; version list) in the database, with
restore, purge and expiry jobs; the bytes stay in `<user>/files_trashbin` and `<user>/files_versions`,
moved and copied by `cloud`.

**calendar**, **contacts** (`apps/dav/lib/CalDAV`, `CardDAV`): one shared collection server
(`plugins/davobjects`) linked into both: collections and objects in two tables, validation of iCalendar
and vCard, ETags with `If-Match` / `If-None-Match`, REPORT multiget / query (with time ranges) /
sync-collection, discovery through `/.well-known/caldav|carddav`, `/remote.php/dav` and principals.

**mail** (`lib/private/Mail`): builds RFC 5322 messages (RFC 2047 headers, `multipart/alternative`, base64
bodies, header injection refused) and sends them through a transport: `spool` (files in a directory),
`sendmail` (started without a shell), `smtp` (RFC 5321 to a relay), `null`. Offers `mail.send`; listens for
`share.created` and `user.created` to notify people.

**activity**, **notifications**: what happened to a user, and what a user should look at, built only from
the events other plugins publish (`file.*`, `share.created`, `user.created`, ...).

## Toolchain

congelado builds with clang 22, C++26 and **named modules** (`import std;`). This tree uses the same Bazel
setup but not the modules:

| congelado | here | why |
| --- | --- | --- |
| clang 22, `-std=gnu++26`, modules (`.cppm`, `cpp_modules` feature, patched `rules_cc`, dependency scanner wrapper, `import std;` from GCC 16's `bits/std.cc`) | clang >= 18, `-std=gnu++23` by default and `-std=gnu++26` with `--define=std=26`, plain headers | the port was written where only clang 18 and GCC 13 are installed; the tree builds and passes its tests with clang 18/C++23 and with clang 22/C++26 (CI runs both), but is not converted to modules, which needs libstdc++ 16 for `import std;` |
| `std::expected` | `nc::util::expected` (is `std::expected` when the library has it; with clang 22 it is) | clang 18 reports `__cpp_concepts` too low for libstdc++ 13 to enable `<expected>` |
| `std::move_only_function` | `std::function` | handlers are copied by the event bus so it can publish without holding its lock; a move-only handler would need a `shared_ptr` there |
| `.clang-format` for clang 22 | same file; `tools/format.sh` skips options an older clang-format does not know | |
| hermetic third-party repos (`third_party/*`) | `rules_cc` and SQLite from the Bazel registry; the system clang toolchain from `bazel/toolchain/system_cc` | no `import std` source and no other libraries to fetch |

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
