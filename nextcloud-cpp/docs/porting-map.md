# What is ported

Paths are relative to the Nextcloud tree in `docs/nextcloud-server`. **Ported** means the behaviour exists
here and is tested; **Reduced** means a deliberate subset (stated); **Replaced** means done differently;
**Not ported** means it does not exist here.

## Kernel

| Nextcloud | Status | Here |
| --- | --- | --- |
| `lib/private/Server.php`, `lib/public/IContainer.php`, `IServerContainer` | Replaced | `ServiceRegistry`: named services with string arguments instead of a typed DI container |
| `lib/private/EventDispatcher`, `lib/public/EventDispatcher` | Reduced | `EventBus`: synchronous, string topics with a `*` suffix pattern, string payloads, failing handlers isolated |
| `lib/private/Route`, `lib/public/Route`, every `appinfo/routes.php` | Reduced | `Router`: method + pattern, `{name}`, `{*rest}`, 404/405/OPTIONS/HEAD. No route requirements (regex), no URL generation |
| `lib/private/App/AppManager.php`, `appinfo/info.xml` | Replaced | `Kernel` + the plugin table in the ABI: name, version, description, requirements, ordering, skip on failure. Enabling is the `plugins` setting. No app store, no per-user app enablement, no `info.xml` |
| `lib/private/Config.php`, `config/config.sample.php`, `AppConfig` | Reduced | `Config`: one text file with `[plugin]` sections, read-only at run time |
| `lib/private/Log`, `lib/public/ILogger.php` | Reduced | `Logger`: levels, stderr sink, per-plugin source |
| `occ`, `core/Command` | Reduced | `CommandRegistry` + `nextcloud occ`: `list`, `status`, `plugin:list`, `config:get`, `background:run|list`, plus what plugins add. No interactive prompts: secrets come from `OC_PASS` |
| `lib/private/BackgroundJob`, `cron.php` | Reduced | `JobScheduler`: interval jobs added by plugins (`host.add_job`), run once a second while serving and by `occ background:run`. No job queue with arguments, no persistence of the last run |
| `lib/private/Authentication` (login chain) | Reduced | the request pipeline: app password (`auth.token`), then password (`auth.authenticate`), then second factor (`auth.second_factor`, `X-NC-OTP`). Basic auth only: no sessions, cookies, CSRF tokens, OAuth, SAML |
| `lib/private/DB`, `lib/public/IDBConnection.php`, `lib/private/Migration` | Reduced | the `db` plugin: SQLite, `db.exec|query|migrate`, migrations applied once per plugin and version in a transaction. No Doctrine/query builder, no other database engine |
| `status.php` | Ported | `GET /status.php` (adds the plugin list) |
| `ocs/`, `lib/private/OCS` | Reduced | `nc::http::ocs()` builds the OCS v2 JSON envelope; no XML format, no `format=` negotiation |
| `remote.php`, `public.php`, `index.php` | Replaced | one router; the URLs `/remote.php/dav/...` and `/s/<token>` are kept so clients work |
| HTTP server (Apache/nginx + PHP-FPM) | Replaced | `HttpServer`: HTTP/1.1, one thread per connection, `Content-Length` and chunked bodies, `Expect: 100-continue`, no TLS (put a reverse proxy in front), no keep-alive |
| `lib/private/AppFramework` (controllers, middleware, DI of controllers) | Not ported | plugins register handlers directly |
| `lib/private/Security`, CSP, rate limiting, brute force protection | Reduced | CSP and `nosniff` on downloads, constant time comparisons, uniform answers for bad tokens and unknown users, request smuggling shapes refused. No rate limiting or lockout |
| `lib/private/Template`, themes, JS front end (`core/`, `apps/*/src`) | Not ported | the runner serves APIs only |

## Plugins

| Nextcloud | Status | Plugin |
| --- | --- | --- |
| `lib/private/User`, `apps/provisioning_api` | Reduced | `users`: accounts, PBKDF2 passwords, first account is admin, basic auth, create/read/edit/delete/list. No LDAP, no user backends |
| `lib/private/Group` | Reduced | `groups`: groups, membership, OCS group API, `groups.*` services. No subadmins, no group backends. Group shares are not implemented in `cloud` yet |
| `lib/private/Authentication/Token` | Reduced | `tokens`: app passwords (create, list, revoke), stored as digests |
| `apps/twofactor_totp`-style, `apps/twofactor_backupcodes` | Reduced | `twofactor`: TOTP (RFC 6238) with replay protection, 10 backup codes. No U2F/WebAuthn, no per-session state |
| `lib/private/Files`, `apps/files` | Reduced | `cloud`: per-user storage, quota, ETags. No cache/index database, no file ids, no external storage, no encryption, no previews |
| `apps/dav` (files) | Reduced | `cloud`: GET, PUT, MKCOL, DELETE, MOVE, COPY, PROPFIND (fixed property set), `X-OC-Mtime`. No PROPPATCH on files, no REPORT/SEARCH, no locking, no ranges, no chunked-upload API (`/uploads`), no bulk upload |
| `lib/private/Share20`, `apps/files_sharing` | Reduced | `cloud`: share with a user or by public link, expiry, OCS create/list/get/delete, `/s/<token>`; kept in step with moved/deleted files and deleted accounts. Not ported: password-protected links, upload-only links, group/federated/mail shares, **showing a received share inside the recipient's file tree** |
| `apps/files_trashbin` | Ported (core) | `trashbin`: deleted files and folders move to a trash with the original path, listed, restored (next to the original if the place is taken), removed, expired by a job. No trash of shared items |
| `apps/files_versions` | Ported (core) | `versions`: old content kept on overwrite, newest `max_versions` per file, restore, history follows a move, expiry job. No per-version labels, no versions of shared items |
| `apps/dav` (CalDAV) | Reduced | `calendar`: calendars, events/tasks, PROPFIND, REPORT (multiget, query with time range, sync-collection), MKCALENDAR, PROPPATCH of the display name, discovery. No scheduling (iTIP), no sharing of calendars, no subscriptions, no free/busy, no expansion of recurring events (they match every time range), no deletion tracking in sync |
| `apps/dav` (CardDAV) | Reduced | `contacts`: address books, vCards, PROPFIND, REPORT, discovery. No address book sharing, no system address book |
| `lib/private/Mail/Mailer`, `Message`, `Emailer` | Reduced | `mail`: plain/HTML/alternative messages, UTF-8 headers, spool, sendmail, SMTP (no TLS, no AUTH). No attachments, no email templates |
| `lib/public/Activity`, the `activity` app | Reduced | `activity`: stream of file, share and account events per user, API, retention job |
| `lib/public/Notification`, `apps/notifications` | Reduced | `notifications`: push by service, event or command; list/get/dismiss API; retention job. No push to devices |
| `apps/federation`, `federatedfilesharing`, `lookup_server_connector`, `cloud_federation_api` | Not ported | |
| `apps/user_ldap`, `oauth2`, `encryption`, `files_external`, `systemtags`, `comments`, `settings`, `theming`, `viewer`, `updatenotification`, `workflowengine`, `webhook_listeners`, `user_status`, `weather_status`, ... | Not ported | |

## Verified

* `bazelisk test //...` (13 targets) passes with clang 18 (C++23), plain and under `--config=asan`,
  `--config=ubsan` and `--config=tsan`.
* It also passes with clang 22 (C++26, `--define=std=26`) and with congelado's `-Werror` profile
  (`--config=warnings`).
* `tools/smoke.sh` starts the real binary with all plugins and goes through upload, share link, trash and
  restore, a calendar event, the activity stream and the mail spool with curl.
* `.github/workflows/nextcloud-cpp.yml` runs the plain, asan, ubsan and tsan builds and a clang 22 / C++26
  job; its results are on the pull request.

Not done: C++26 *modules* (`import std;`). congelado's module build needs a libstdc++ 16 `bits/std.cc` and its
patched `rules_cc`; neither is available on the machines used for this port. Everything else of its Bazel
setup is in use.
