# nextcloud-cpp

Nextcloud as a **plugin runner** in C++. The runner is a small kernel that loads plugins, wires them together
and serves HTTP. What Nextcloud calls the server (files, sharing, accounts, mail, ...) is not in the kernel:
each of those is a plugin, a shared object the runner loads at start-up.

The Nextcloud sources this was ported from are the submodule [`docs/nextcloud-server`](../docs/nextcloud-server)
(`git submodule update --init --depth 1 docs/nextcloud-server`). The build setup and the code style are
congelado's ([driver005/congelado](https://github.com/driver005/congelado)), see
[`docs/architecture.md`](docs/architecture.md) for what was kept and what was changed.

```
runner/            the kernel: config, log, events, router, services, commands, jobs, plugin loader, HTTP server
sdk/plugin/        the C ABI (abi.h), the request/response types, the C++ base class for plugins, db client
sdk/util/          text, URL, XML, base64, SHA-1/256, PBKDF2, TOTP, time, expected (no dependencies)
sdk/testing/       the test harness (a test is a plain `int main`)
plugins/db/        SQLite and migrations, as services
plugins/users/     accounts, sign-in, the provisioning API, user:* commands
plugins/ldap/      sign in with an LDAP directory
plugins/groups/    groups and membership
plugins/tokens/    app passwords
plugins/twofactor/ TOTP second factor with backup codes
plugins/cloud/     file storage, WebDAV, shares by user and public link
plugins/trashbin/  deleted files can be restored
plugins/versions/  older versions of files
plugins/calendar/  CalDAV, plus the DAV root and principals
plugins/contacts/  CardDAV
plugins/mail/      the mail service, a send API, notifications (spool, sendmail or SMTP)
plugins/activity/  activity stream
plugins/notifications/ notifications for people
plugins/systemtags/ tags on files
plugins/comments/  comments on files
plugins/davobjects/    the CalDAV/CardDAV server both DAV plugins link
bazel/             build macros, copts, the system clang toolchain (from congelado)
tools/             format.sh, smoke.sh
```

## Build, test, run

Bazel 9.2 (through bazelisk), clang and lld are needed. Dependencies come from the Bazel registry: `rules_cc`
and SQLite (for the `db` plugin).

```sh
bazelisk test //...                 # 16 test targets
bazelisk test //... --config=asan   # also ubsan, tsan
bazelisk test //... --define=std=26 --config=warnings   # C++26, warnings as errors (clang 22 in CI)
tools/smoke.sh                      # starts the real binary with the built plugins and uses it through curl
tools/format.sh [--check]           # clang-format with the congelado style
```

Run it by hand:

```sh
bazelisk build //runner:nextcloud //plugins/...   # or only the plugins you want
mkdir -p plugins && cp bazel-bin/plugins/*/lib*.so plugins/
cat > config.conf <<'CONF'
data_dir = data
port = 8080
[mail]
from_address = cloud@example.org
CONF
OC_PASS='a long password' bazel-bin/runner/nextcloud --config config.conf user:add alice --email=alice@example.org
bazel-bin/runner/nextcloud --config config.conf serve
curl -u alice:'a long password' -T notes.md http://127.0.0.1:8080/remote.php/dav/files/alice/notes.md
```

`nextcloud occ list` (or just `nextcloud list`) shows every command the loaded plugins add.

## Configuration

A text file, `key = value` and `[plugin]` sections (see `runner/include/nextcloud/runner/config.h`). A plugin
reads `[its-name] key` first and the top level `key` second.

| key | meaning | default |
| --- | --- | --- |
| `plugin_dir` | where the `*.so` plugins are | `plugins` |
| `plugins` | comma list of plugins to start; empty means all | all |
| `listen`, `port` | HTTP address | `127.0.0.1`, `8080` |
| `log_level` | debug, info, warning, error, fatal | `info` (`warning` for commands) |
| `data_dir` | accounts, shares, files, mail spool | `data` |
| `[users] pbkdf2_iterations`, `min_password_length` | password hashing | `10000`, `8` |
| `[cloud] quota_bytes`, `overwrite_url` | per-user quota, public URL for share links | unlimited, from `Host` |
| `[cloud] encryption_key` or `encryption_key_file` | 64 hex digits: files are stored encrypted | off |
| `[cloud] external_mounts` | host folders shown to everyone: `Name=/path:ro\|rw[:group]; ...` | none |
| `[mail] mode` | `spool`, `sendmail`, `smtp`, `null` | `spool` |
| `[mail] from_address`, `from_name`, `spool_dir`, `sendmail_path`, `smtp_host`, `smtp_port`, `max_recipients` | | |
| `[ldap] host`, `port`, `base_dn`, `bind_dn`, `bind_password`, `user_attribute`, `object_class`, `display_attribute`, `mail_attribute` | directory sign-in | none (plugin stays off) |
| `[db] file` | SQLite file | `<data_dir>/nextcloud.db` |
| `[twofactor] issuer` | name shown in authenticator apps | `Nextcloud` |
| `[trashbin] retention_days`, `[versions] max_versions`, `retention_days`, `[activity] retention_days` | how long things are kept | 30; 10, 365; 365 |
| `[calendar] max_object_size`, `[contacts] max_object_size` | bytes per event or contact | 1048576 |

## Writing a plugin

```cpp
#include "nextcloud/plugin.h"

class HelloPlugin final : public nc::Plugin
{
public:
    std::string_view get_name() const noexcept override { return "hello"; }
    std::string_view get_version() const noexcept override { return "1.0.0"; }

    void on_load(nc::Host& host) override
    {
        host.add_route("GET", "/hello/{name}", [](const nc::http::Request& request)
        {
            return nc::http::Response::text(200, "hello " + std::string(request.param("name")));
        });
    }
};

NC_PLUGIN(HelloPlugin)
```

```starlark
load("//bazel:build_defs.bzl", "nc_plugin")
nc_plugin(name = "hello", srcs = ["hello.cc"])   # builds libhello.so
```

A plugin can add routes, services (`host.add_service`, called by others with `host.call_service`), event
subscriptions (`host.subscribe`, `host.publish`), commands (`host.add_command`) and background jobs
(`host.add_job`). `nextcloud/db.h` is the client for the `db` plugin. It states what it needs
with `get_requires()`; the runner starts it after those and skips it when one is missing.

## Status

What is ported, what is replaced and what is not: [`docs/porting-map.md`](docs/porting-map.md). The plan and
its acceptance criteria: [`TASKS.md`](TASKS.md).
