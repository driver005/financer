# TASKS

Plan for converting Nextcloud to C++ as a plugin runner, following congelado's protocol
(DISCOVER, PLAN, IMPLEMENT, VERIFY).

## Objective

Convert the Nextcloud server (`docs/nextcloud-server`) to C++. Nextcloud is not a cloud here but a *runner
for plugins*; the cloud, the mail and the rest are plugins. Use congelado's Bazel configuration and its code
style (`CODESTYLE.md`).

## Decisions

* The kernel owns no feature: config, log, event bus, router, service registry, command registry, plugin
  loader, HTTP server. Everything Nextcloud does for users is in `plugins/`.
* One C ABI between kernel and plugins (`sdk/plugin/include/nextcloud/abi.h`), like congelado's: plugins can
  be built separately and replaced without rebuilding the kernel.
* Plugins talk through the kernel (services and events with form-encoded string payloads), never to each
  other directly.
* Plain headers and C++23 now, because the available compiler is clang 18; congelado's modules/C++26 setup
  is described in `docs/architecture.md` as the upgrade path.
* No database yet (flat files). Documented as *Replaced* in `docs/porting-map.md`.

## Affected files

| Area | Files |
| --- | --- |
| Bazel / style (from congelado) | `.bazelversion`, `.bazelrc`, `warnings.bazelrc`, `bazel/**`, `MODULE.bazel`, `third_party/extension.bzl`, `.clang-format`, `.clangd`, `.editorconfig`, `CODESTYLE.md` |
| Kernel | `runner/**` |
| SDK | `sdk/plugin/**`, `sdk/util/**`, `sdk/testing/**` |
| Plugins | `plugins/users/**`, `plugins/cloud/**`, `plugins/mail/**` |
| Reference | `docs/nextcloud-server` (submodule, read only) |
| CI | `.github/workflows/nextcloud-cpp.yml` |

## Steps

- [x] DISCOVER: read congelado (`GEMINI.md`, `CODESTYLE.md`, `.bazelrc`, `MODULE.bazel`, plugin ABI) and the
      Nextcloud structure (`lib/`, `apps/`, `occ`, `remote.php`).
- [x] Bazel 9.2 builds with the ported system clang toolchain; macros `nc_cc_library|binary|test`, `nc_plugin`.
- [x] SDK: C ABI, request/response types, plugin base class, `NC_PLUGIN`; utilities (text, URL, XML, base64,
      SHA-256, HMAC, PBKDF2, time, `expected`).
- [x] Kernel: config, log, event bus, router, service registry, command registry, plugin loading with
      dependency order and failure isolation, request pipeline with authentication, HTTP/1.1 server, `occ`.
- [x] Plugin `users`.
- [x] Plugin `cloud`: storage, WebDAV, shares, public links.
- [x] Plugin `mail`: message building, spool/sendmail/SMTP, notifications.
- [x] Docs: `README.md`, `docs/architecture.md`, `docs/porting-map.md`.
- [x] CI workflow.

## Acceptance criteria

1. `bazelisk test //...` passes, also with `--config=asan`, `--config=ubsan` and `--config=tsan`.
2. A plugin is a shared object: the kernel starts with whichever `.so` files are in `plugin_dir`, in
   dependency order, and a plugin that fails or lacks a requirement is skipped without stopping the others.
3. With `users`, `cloud` and `mail` loaded, a WebDAV client can sign in, upload, list, copy, move and delete
   files, create a public link, and download through it; sharing with a user sends a mail.
4. No path in a request can reach a file outside the user's directory (traversal, encoded traversal,
   symlinks, `Destination` header to another account).
5. Code follows `CODESTYLE.md` (see `docs/architecture.md`, "Code style") and `tools/format.sh --check`.

## Verification

* `bazelisk test //...` and the three sanitizer configs: done, all pass (clang 18).
* `tools/smoke.sh`: done, the built binary with the three built plugins over curl.
* Not done: building with clang 22 and C++26 modules; running the CI workflow on GitHub (see the pull
  request for its result).

## Open questions for the owner

* **Builder pattern** (CODESTYLE rule 11 says to ask before using it). `MailMessage` is the natural first
  candidate (`MailMessage::builder().from(..).to(..).subject(..).build()`), then `Request`/`Response`.
  Not used until you say so.
* **Modules.** Should the headers become C++26 modules (`.cppm`, `import std;`) once the clang 22 toolchain
  is available? The C ABI would not change.
* **Next plugins.** Suggestions in order of how much they unlock: `database` (SQLite, then replace the flat
  files), `calendar` and `contacts` (CalDAV/CardDAV from `apps/dav`), `trashbin`/`versions`, `activity`,
  `notifications`, `ldap`.
