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
| HTTP server (Apache/nginx + PHP-FPM) | Replaced | `HttpServer`: HTTP/1.1, one thread per connection, `Content-Length` and chunked bodies, `Expect: 100-continue`, **TLS 1.2+ with BoringSSL** (`tls_cert`, `tls_key`), no keep-alive, no HTTP/2, no certificate reload without a restart |
| `lib/private/AppFramework` (controllers, middleware, DI of controllers) | Not ported | plugins register handlers directly |
| `lib/private/Security`, CSP, rate limiting, brute force protection | Reduced | CSP and `nosniff` on downloads, constant time comparisons, uniform answers for bad tokens and unknown users, request smuggling shapes refused. No rate limiting or lockout |
| `lib/private/Template`, themes, JS front end (`core/`, `apps/*/src`) | Not ported | the runner serves APIs only |

## Plugins

| Nextcloud | Status | Plugin |
| --- | --- | --- |
| `lib/private/User`, `apps/provisioning_api` | Reduced | `users`: accounts, PBKDF2 passwords, first account is admin, basic auth, create/read/edit/delete/list. No LDAP, no user backends |
| `apps/user_ldap` | Reduced | `ldap`: sign in with a directory: bind (service account or anonymous), find exactly one entry of an object class by a user attribute (filter built as a structure, so names cannot inject terms), bind as that entry with the password; the person gets an account (`users.ensure`) with display name and mail from the directory. Plain TCP only (no LDAPS/StartTLS), no group sync, no paging, no user listing from the directory, no avatars. Any plugin can now offer `auth.authenticate*` and the kernel tries them in turn |
| `lib/private/Group` | Reduced | `groups`: groups, membership, OCS group API, `groups.*` services (used by group shares). No subadmins, no group backends |
| `lib/private/Authentication/Token` | Reduced | `tokens`: app passwords (create, list, revoke), stored as digests |
| `apps/twofactor_totp`-style, `apps/twofactor_backupcodes` | Reduced | `twofactor`: TOTP (RFC 6238) with replay protection, 10 backup codes. No U2F/WebAuthn, no per-session state |
| `lib/private/Files`, `apps/files` | Reduced | `cloud`: per-user storage, quota, ETags. No cache/index database, no file ids, no external storage, no encryption, no previews |
| `apps/dav` (files) | Reduced | `cloud`: GET, PUT, MKCOL, DELETE, MOVE, COPY, PROPFIND (fixed property set), `X-OC-Mtime`. Single byte ranges and `If-None-Match` on downloads; the chunked-upload API (`/remote.php/dav/uploads`, chunks joined by number, `OC-Total-Length`). No PROPPATCH on files, no REPORT/SEARCH, no locking, no bulk upload, no multi-range |
| `lib/private/Share20`, `apps/files_sharing` | Reduced | `cloud`: shares are rows of the `db` plugin (`nc_shares`; the text file of earlier versions is imported once and renamed `shares.db.imported`); shares with a user, with a group and by public link, permissions (read/update/create/delete), expiry, OCS create/list/get/delete, `/s/<token>`; **a received share appears in the recipient's top folder** (numbered when the name is taken) and is served from the owner's tree with the share's permissions, its changes recorded for the owner (activity, trash, versions); shares follow moved/deleted files and deleted accounts. Links can have a password (PBKDF2, header `X-NC-Share-Password`) and can be upload-only ("file drop", numbered names, no overwrite) or read+upload. What a recipient writes counts against the owner's quota, and a mounted folder shows its size in the top-level listing. Not ported: mail shares, resharing |
| `apps/files_trashbin` | Ported (core) | `trashbin`: deleted files and folders move to a trash with the original path, listed, restored (next to the original if the place is taken), removed, expired by a job. No trash of shared items |
| `apps/files_versions` | Ported (core) | `versions`: old content kept on overwrite, newest `max_versions` per file, restore, history follows a move, expiry job. No per-version labels, no versions of shared items |
| `apps/dav` (CalDAV) | Reduced | `calendar`: calendars, events/tasks, PROPFIND, REPORT (multiget, query with time range, sync-collection), MKCALENDAR, PROPPATCH of the display name, discovery. No scheduling (iTIP), no sharing of calendars, no subscriptions, no free/busy, no expansion of recurring events (they match every time range), no deletion tracking in sync |
| `apps/dav` (CardDAV) | Reduced | `contacts`: address books, vCards, PROPFIND, REPORT, discovery. No address book sharing, no system address book |
| `lib/private/Mail/Mailer`, `Message`, `Emailer` | Reduced | `mail`: plain/HTML/alternative messages, UTF-8 headers, spool, sendmail, SMTP (no TLS, no AUTH). No attachments, no email templates |
| `lib/public/Activity`, the `activity` app | Reduced | `activity`: stream of file, share and account events per user, API, retention job |
| `lib/public/Notification`, `apps/notifications` | Reduced | `notifications`: push by service, event or command; list/get/dismiss API; retention job. No push to devices |
| `apps/encryption` | Reduced | `cloud`: with `[cloud] encryption_key` (64 hex digits) or `encryption_key_file`, every file is stored as ChaCha20-Poly1305 with its own key (derived from the server key, the account and a random salt) and the account bound in as associated data; tampering and files moved between accounts are detected; plain files from before are still read, `occ encryption:encrypt-all <user>` converts them; sizes, ETags, shares, links and the trash and versions copies keep working. One server key only: no per-user keys, no key rotation, no recovery key, calendars and contacts (in the database) are not encrypted |
| `lib/private/Preview` | Reduced | `previews`: `GET /index.php/core/preview.png?file=&x=&y=` for PNG, JPEG, GIF and BMP pictures (formats recognised by their first bytes, size read before decoding, 20 MiB / 8192 px / 40 MP limits), scaled to fit and returned as PNG, cached by file version; access follows shares (`cloud.can_access`). No video, PDF, SVG, office or HEIC previews, no cropping modes, no mimetype icons |
| `apps/oauth2` | Reduced | `oauth2`: authorization server, authorization code flow with PKCE (S256), client secrets, one-time codes, rotating refresh tokens, Bearer tokens accepted by the kernel (`auth.bearer*`), clients registered with `occ oauth2:add`. Consent is implied by arriving signed in (no login or consent page), no scopes, no client credentials/implicit/password grants |
| `apps/files_external` (local backend) | Reduced | `cloud`: folders of the host an administrator lists in `[cloud] external_mounts = Name=/path:ro|rw[:group]; ...` appear in every (or the group's) top folder, read-only or read-write. No SMB/SFTP/S3/WebDAV backends, no per-user credentials, no trash or versions on them |
| `lib/public/SystemTag`, `apps/systemtags` | Reduced | `systemtags`: tags shared by everybody, put on a user's own files (by owner and path, no file ids), find by tag or by file, follow renames and deletes. No restricted/invisible tags, no tags on shared items |
| `lib/public/Comments`, `apps/comments` | Reduced | `comments`: comments on a file by its owner and by people it is shared with (access decided by `cloud.can_access`), delete by author or owner, the owner is notified. No threads, mentions, read markers |
| `lib/public/Capabilities` | Ported | `GET /ocs/v2.php/cloud/capabilities` merges every service named `capabilities.<name>` (cloud, trashbin, versions, calendar, twofactor, systemtags, comments) |
| `apps/federation`, `federatedfilesharing`, `cloud_federation_api` | Reduced | `federation`: Open Cloud Mesh sharing between two servers. Discovery (`/ocm-provider/`, `/.well-known/ocm`), `POST /ocm/shares`, `POST /ocm/notifications` (accepted, declined, unshared; every notification needs the share's secret), share type 6 in the OCS share API (`name@server`), the recipient's pending/accept/decline/leave API (`remote_shares`), the owner's files read through `/public.php/webdav` with the share token as user name. An accepted share is a **read-only** mount in the recipient's tree (whole answers in memory, no streaming/Range). Outgoing requests check the certificate and the host name, never follow redirects and refuse local addresses unless `allow_local` is set. Not ported: trusted-server lists, the lookup server, address book sync, group and re-shares, write access for remote recipients, signed requests (HTTP signatures) |
| other `files_external` backends, `settings`, `theming`, `viewer`, `updatenotification`, `workflowengine`, `webhook_listeners`, `user_status`, `weather_status`, ... | Not ported | |

## Verified

* `bazelisk test //...` (18 targets) passes with clang 18 (C++23), plain and under `--config=asan`,
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
