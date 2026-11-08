# What is ported

Paths are relative to the Nextcloud tree in `docs/nextcloud-server`. **Ported** means the behaviour exists
here and is tested; **Reduced** means a deliberate subset (stated); **Replaced** means done differently;
**Not ported** means it does not exist here yet.

## Kernel

| Nextcloud | Status | Here |
| --- | --- | --- |
| `lib/private/Server.php`, `lib/public/IContainer.php`, `IServerContainer` | Replaced | `ServiceRegistry`: named services with string arguments instead of a typed DI container |
| `lib/private/EventDispatcher`, `lib/public/EventDispatcher` | Reduced | `EventBus`: synchronous, string topics with a `*` suffix pattern, string payloads, failing handlers isolated |
| `lib/private/Route`, `lib/public/Route`, every `appinfo/routes.php` | Reduced | `Router`: method + pattern, `{name}`, `{*rest}`, 404/405/OPTIONS/HEAD. No route requirements (regex), no URL generation |
| `lib/private/App/AppManager.php`, `appinfo/info.xml` | Replaced | `Kernel` + the plugin table in the ABI: name, version, description, requirements, ordering, skip on failure. Enabling is the `plugins` setting. No app store, no per-user app enablement, no `info.xml` |
| `lib/private/Config.php`, `config/config.sample.php`, `AppConfig` | Reduced | `Config`: one text file with `[plugin]` sections, read-only at run time |
| `lib/private/Log`, `lib/public/ILogger.php` | Reduced | `Logger`: levels, stderr sink, per-plugin source |
| `occ`, `core/Command` | Reduced | `CommandRegistry` + `nextcloud occ`: `list`, `status`, `plugin:list`, `config:get`, plus what plugins add. No interactive prompts: secrets come from `OC_PASS` |
| `status.php` | Ported | `GET /status.php` (adds the plugin list) |
| `ocs/`, `lib/private/OCS` | Reduced | `nc::http::ocs()` builds the OCS v2 JSON envelope; no XML format, no `format=` negotiation |
| `remote.php`, `public.php`, `index.php` | Replaced | one router; the URLs `/remote.php/dav/...` and `/s/<token>` are kept so clients work |
| `lib/private/DB`, `lib/public/IDBConnection.php`, Doctrine, migrations | **Replaced** | no database: accounts and shares are text files, files are on disk. A database plugin is the obvious next plugin |
| `lib/private/AppFramework` (controllers, middleware, DI of controllers) | Not ported | plugins register handlers directly |
| `lib/private/BackgroundJob`, cron | Not ported | `share:prune` is run by hand |
| `lib/private/Security`, CSP, rate limiting, brute force protection | Reduced | CSP and `nosniff` on downloads, constant time comparisons, uniform answers for bad tokens and unknown users. No rate limiting or lockout |
| `lib/private/Template`, themes, JS front end (`core/`, `apps/*/src`) | Not ported | the runner serves APIs only |

## Plugins

| Nextcloud | Status | Plugin |
| --- | --- | --- |
| `lib/private/User`, `lib/private/Authentication` (basic auth) | Reduced | `users`: accounts, PBKDF2 passwords, first account is admin, basic auth. No groups, no app passwords/tokens, no sessions, no 2FA, no LDAP |
| `apps/provisioning_api` | Reduced | `users`: create, read, edit (email, display name, password, enabled), delete, list |
| `lib/private/Files`, `apps/files` | Reduced | `cloud`: per-user storage, quota, ETags. No cache/index database, no file ids, no external storage, no encryption, no trash, no versions, no previews |
| `apps/dav` (files) | Reduced | `cloud`: GET, PUT, MKCOL, DELETE, MOVE, COPY, PROPFIND (fixed property set), `X-OC-Mtime`. No PROPPATCH, no REPORT/SEARCH, no locking, no ranges, no chunked upload, no bulk upload |
| `apps/dav` (CalDAV, CardDAV) | Not ported | candidates for their own plugins (`calendar`, `contacts`) |
| `lib/private/Share20`, `apps/files_sharing` | Reduced | `cloud`: share with a user or by public link, expiry, OCS create/list/get/delete, `/s/<token>`. Shares are kept up to date when files move or are deleted and when accounts are deleted. Not ported: password-protected links, upload-only links, groups, federation, and **showing a received share inside the recipient's file tree** (a recipient is told by mail and can list the share, but cannot open it through WebDAV yet) |
| `lib/private/Mail/Mailer`, `Message`, `Emailer` | Reduced | `mail`: plain/HTML/alternative messages, UTF-8 headers, spool, sendmail, SMTP (no TLS, no AUTH). No attachments, no email templates |
| notifications for new accounts and shares | Ported | `mail` listens to `user.created` and `share.created` |
| `apps/federation`, `federatedfilesharing`, `lookup_server_connector`, `cloud_federation_api` | Not ported | |
| `apps/user_ldap`, `oauth2`, `twofactor_backupcodes`, `encryption` | Not ported | |
| `apps/activity`-style apps, `files_trashbin`, `files_versions`, `systemtags`, `settings`, `theming`, `viewer`, `updatenotification`, ... | Not ported | |

## Verified

`bazelisk test //...` (5 targets) passes plain, under `--config=asan`, `--config=ubsan` and `--config=tsan`
(clang 18). `tools/smoke.sh` runs the built binary with the three built plugins over real HTTP. Not
verified: clang 22 / C++26 modules (congelado's toolchain), macOS, anything on GitHub-hosted runners other
than what `.github/workflows/nextcloud-cpp.yml` reports.
