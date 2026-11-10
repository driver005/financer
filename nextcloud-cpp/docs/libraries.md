# Nextcloud's dependencies and the C++ libraries that replace them

Nextcloud's PHP dependencies are in the `nextcloud/3rdparty` repository (`composer.json`), plus the PHP
extensions it requires. This table maps each one to what this tree uses or can use. "BCR" means the Bazel Central
Registry has a module for it (checked against the registry, 2026-11). A library that is not in the registry would
have to be vendored by hand (see `third_party/`).

## Replaced already

| Nextcloud uses | Here | Notes |
|---|---|---|
| `symfony/routing`, `symfony/http-foundation` | `runner/` Router, `sdk/plugin/http.h` | |
| `symfony/console`, `stecman/symfony-console-completion` | `CommandRegistry` (`occ`) | CLI11/cxxopts (BCR) not needed |
| `symfony/event-dispatcher`, `psr/event-dispatcher`, `psr/container`, `pimple/pimple` | `EventBus`, `ServiceRegistry` | |
| `doctrine/dbal`, `ext-pdo` | `db` plugin on SQLite (`sqlite3`, BCR) | no PostgreSQL/MySQL (see below) |
| `guzzlehttp/guzzle`, `psr/http-client`, `ext-curl` | `plugins/federation/src/http_client` (BoringSSL) | `curl` (BCR) would add redirects/HTTP2 |
| `phpseclib/phpseclib`, `ext-openssl` | BoringSSL (`boringssl`, BCR), mbedTLS via libssh2 | hashes, HMAC, PBKDF2, random bytes, base64 and the ChaCha20-Poly1305 of the at-rest encryption in `sdk/util` are BoringSSL calls too (the hand-written SHA-1/SHA-256 and the hand-written cipher are gone; the RFC 8439 example and the old digests of sealed data are tests) |
| `ext-json` | `nlohmann_json` (BCR, **in use**) | `util::Json` is built from its SAX events, with the depth and size limits; the hand-written parser is gone |
| `icewind/streams` | `http::Response` streams, spooled uploads | |
| `aws/aws-sdk-php` | own AWS SigV4 (`s3.cc`) | `aws-sdk-cpp` is not in BCR |
| `sabre/dav` | `cloud`, `calendar`, `contacts` plugins | request bodies are read with `util::Xml` (libxml2); the multistatus answers are still written as text |
| `psr/log`, `nextcloud/lognormalizer` | `Logger` | |
| `mlocati/ip-lib` | `is_local_address` | |
| `bantu/ini-get-wrapper`, `symfony/polyfill-*`, `laravel/serializable-closure`, `cweagans/composer-patches` | not needed | PHP specific |
| `ext-zlib` | `zlib` (BCR) where needed | |
| `ext-posix`, `ext-session`, `ext-apcu` | libc, own session/cache | |
| `icewind/smb` (SMB storage) | — | `libsmb2` is not in BCR |
| SFTP (`phpseclib`) | `libssh2` (BCR) with the mbedTLS backend; sign-in with a key is signed by BoringSSL (`ssh_key.cc`) because the mbedTLS backend reads RSA keys only | done |

## Looked at and kept hand-written

| Code | Library considered | Why it stays |
|---|---|---|
| `plugins/federation/src/http_client.cc` (HTTP/1.1 client), `plugins/cloud/src/ftp.cc` (FTP/FTPS), the SMTP part of `plugins/mail/src/transport.cc` | `curl` (BCR 8.22: HTTP, FTP, SMTP in one) | The BCR module depends on `mbedtls`, `nghttp2`, `openssl` 4 and a newer `boringssl` than the one this tree builds with, so the resolver would move BoringSSL for everything. The three clients are where the security rules live and are tested (no local addresses after name resolution, no redirects, certificate and host name checked, bodies streamed through the plugin interface, a password only over TLS); with curl each of those becomes a callback or an option to get right again. Worth doing only if curl is wanted for HTTP/2 or proxies |
| `runner/src/http_server.cc` (HTTP/1.1 server) | `civetweb`, `libmicrohttpd`, `boost.beast` | Streamed bodies in both directions, uploads spooled to a file, TLS on the same socket and the kernel's one-call-per-request model are what the server is for; none of the libraries gives that without the same amount of glue |
| `plugins/ldap/src/ber.cc`, `ldap_client.cc` | `openldap` | not in the registry |
| `plugins/mail/src/mime.cc` | `vmime`, `mimetic` | not in the registry |
| `plugins/cloud/src/ftp.cc` for SFTP-like needs | `libssh2` | already used for SFTP; FTP is another protocol |
| SMB storage | `libsmb2` | not in the registry, and it is LGPL: linking it statically is a licensing decision for the project, not a build detail |

## To use (in BCR)

| Nextcloud uses | C++ library (BCR) | For |
|---|---|---|
| `ext-gd`, previews | `lunasvg` (SVG, **in use**), `libwebp` (**in use**), `libtiff` (**in use**), `libheif` (HEIC, **in use**, with `libde265`), `libpng`, `libjpeg_turbo`, `giflib`, `freetype`, `harfbuzz` | previews of more formats; `stb` stays for what it covers |
| `ext-xml`, `ext-dom`, `ext-simplexml`, `ext-xmlreader`, `ext-xmlwriter` | `libxml2` (**in use**: `util::Xml` for DAV bodies and S3 listings, and SAML) | the hand-written tag scanners are gone (they did not decode entities, CDATA or comments); `libxml2` also has exclusive canonicalization, which SAML needs |
| SAML (`apps/user_saml`, external app) | `libxml2` (c14n) + BoringSSL + `zlib` (**in use**, `plugins/saml`) | XML signatures: no `xmlsec` in BCR, so the verification is written on top of these and tested against `xmlsec1` |
| `firebase/php-jwt` | `jwt-cpp` | OAuth2/OIDC tokens |
| `predis/predis` | `hiredis` | Redis cache and locking |
| `punic/punic`, `symfony/translation`, `symfony/string`, `symfony/polyfill-intl-*`, `ext-mbstring` | `icu`, `utf8proc`, `simdutf` | locale data, normalization, translations |
| `pear/archive_tar`, `deepdiver/zipstreamer`, `deepdiver1975/tarstreamer`, `ext-zip` | `libarchive` | download of a folder as zip/tar |
| `ext-fileinfo` | `libmagic` | content-based MIME types |
| `justinrainbow/json-schema` | `jsoncons` (jsonschema) | schema validation |
| `web-auth/webauthn-lib` | `jsoncons` (CBOR) + BoringSSL (COSE, ES256) | WebAuthn |
| `symfony/mailer` | `curl` (SMTP) | outgoing mail (the `mail` plugin has its own SMTP client) |
| `fusonic/opengraph` | `lexbor` (HTML parser) | link previews |
| `egulias/email-validator` | `re2` | address checks |
| `symfony/process` | `posix_spawn` (libc) | no library needed |
| user_ldap (`ext-ldap`) | — | `openldap` is not in BCR; the `ldap` plugin speaks BER itself |
| Databases other than SQLite | — | `libpq`, `libpqxx`, MariaDB connector are not in BCR |
| `giggsey/libphonenumber-for-php-lite` | — | `libphonenumber` is not in BCR |
| `kornrunner/blurhash` | — | small; vendor `blurhash` |
| `wapmorgan/mp3info` | — | `taglib` is not in BCR |
| `gapple/structured-fields`, `mexitek/phpcolors`, `icewind/searchdav` | — | small; written here |
