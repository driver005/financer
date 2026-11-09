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
| Plugins | `plugins/*/**` (db, users, groups, tokens, twofactor, cloud, trashbin, versions, calendar, contacts, davobjects, mail, activity, notifications) |
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
- [x] CI workflow (plain, asan, ubsan, tsan; clang 22 / C++26 with -Werror).
- [x] Second tranche, to close the gaps of the first porting map: background jobs in the ABI, the `db` plugin
      (SQLite and migrations), groups, activity, notifications, app passwords, TOTP two-factor, trash bin,
      versions, CalDAV, CardDAV, tags, comments, the capabilities endpoint, external storage (local folders), encryption at rest, LDAP sign-in, HTTPS (BoringSSL), OAuth2 provider, previews, federation (OCM, mounts with read and write, signed requests, trusted servers), Range/304 downloads, chunked uploads, password and drop links, chunked request bodies, group shares and received shares in the recipient's tree.
- [ ] Still not ported (see `docs/porting-map.md`): SAML, other external storage backends, the lookup server,
      the web front end, C++26 modules.

## Acceptance criteria

1. `bazelisk test //...` passes, also with `--config=asan`, `--config=ubsan` and `--config=tsan`, and with
   clang 22 as `--define=std=26 --config=warnings`.
2. A plugin is a shared object: the kernel starts with whichever `.so` files are in `plugin_dir`, in
   dependency order, and a plugin that fails or lacks a requirement is skipped without stopping the others.
3. With `users`, `cloud` and `mail` loaded, a WebDAV client can sign in, upload, list, copy, move and delete
   files, create a public link, and download through it; sharing with a user sends a mail.
4. No path in a request can reach a file outside the user's directory (traversal, encoded traversal,
   symlinks, `Destination` header to another account).
5. Code follows `CODESTYLE.md` (see `docs/architecture.md`, "Code style") and `tools/format.sh --check`.

## Verification

* `bazelisk test //...` (13 targets) and the three sanitizer configs: done, all pass (clang 18).
* clang 22, C++26, `--config=warnings` (-Werror): done, all pass.
* `tools/smoke.sh`: done, the built binary with all plugins over curl.
* Not done: C++26 *modules*. The Bazel module rules and `import std;` of congelado need GCC 16's libstdc++
  (`bits/std.cc`); the headers-only tree is what builds today.

## Open questions for the owner

* **Builder pattern.** Approved for `MailMessage` (`MailMessageBuilder{}.from(..).to(..).subject(..).build()`, used by
  the mail plugin). Still to ask before using it on `Request`/`Response` or other classes.
* **Modules.** The tree already builds with clang 22 and C++26. Converting the headers to modules
  (`.cppm`, `import std;`) needs GCC 16's libstdc++ and congelado's patched `rules_cc`; say if you want it
  and on which machine, the C ABI would not change.
* **Next plugins.** Suggestions: SAML, calendar
  scheduling (iTIP), the lookup server, interoperable (RSA) OCM signatures.
