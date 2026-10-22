# Configuration

The hosted server (`financer-server`) is configured with environment variables, an optional
`financer.toml` file, **and the app itself** (Settings > Server settings, see
[Changing the configuration from the app](#changing-the-configuration-from-the-app)), plus a few
settings stored in its database (payday, habit mode, LLM model; those are changed elsewhere in the
app and are not part of this page).

**The on-phone (embedded) backend does not read `financer.toml` or any `FINANCER_*` variable.** It
has no server process to configure; its settings are in the app (see `docs/EMBEDDED.md`). Bank
connections from the file, and `[[stores]]` aliases, therefore exist only for the hosted server.

## Where the file is looked up

In this order; the first one that applies is used:

1. `--config <path>` on the command line
2. the environment variable `FINANCER_CONFIG`
3. `./financer.toml` in the working directory
4. none: the environment variables and defaults alone, exactly as before the file existed

A file named with `--config` or `FINANCER_CONFIG` must exist. `./financer.toml` is optional. A blank
`FINANCER_CONFIG` counts as not set.

Start from [`financer.example.toml`](../financer.example.toml): every option is in it, commented out.

## Precedence

For every setting: **environment variable, then what was set in the app, then the file, then the
default.** A variable that is set but blank counts as not set (docker compose passes unset
variables through as empty strings). Settings that only make sense in the file
(`[[bank.accounts]]`, `[[stores]]`) have no variable.

Relative paths written in the file (`web_dir`, `api_token_file`, `sources_file`) are relative to the
folder of the file. A path given by environment variable is relative to the working directory. The
database URL is passed on as written (a relative SQLite path is relative to the working directory).

## Secrets

- Any **string** value may refer to the environment: `${NAME}`. It is an error if `NAME` is not set
  or blank, unless the reference has a default: `${NAME:-fallback}`. Write `$$` for a literal `$`.
  References work in every string of the file (not in numbers).
- Prefer references for secrets, so the file itself holds none. If the file holds a secret as plain
  text (`api_token`, an API key, `fints_product_id`), the server logs a warning, and on Linux and
  macOS an additional warning when other users can read the file (`chmod 600 financer.toml`).
- The bank **PIN is never in the file** and never stored. A bank account names an environment
  variable (`pin_env`) or you type the PIN in the app.
- Secrets are never printed: the warnings, `--print-config`, debug output and the API all leave
  them out.

## Checking a file

```sh
financer-server --check-config     # validate; prints "config ok" and exits 0, or the problems and exits 1
financer-server --print-config     # the effective configuration, secrets hidden, with the origin of each value
```

`--print-config` marks every value with `# default`, `# file`, `# app` or `# env NAME` (and includes
the settings made in the app). Syntax errors and
unknown keys come with the line number from the TOML parser; a missing `${NAME}` names the key, the
variable and the line. `--check-config` also checks that the token is long enough, that the database
URL is `sqlite:` or `postgres:`, that `web_dir` has an `index.html` and that the price sources file
exists and parses. A bank `pin_env` whose variable is not set in the environment of the check is a
warning (it may only be set for the running service).

## Changing the configuration from the app

Every key of `financer.toml` can be set from the app, so nothing needs a text editor on the server:
**Settings > Server settings** (hosted server only; the on-phone backend has no such file). The
screen is drawn from a list the server sends, so each key shows its label, what it does, its range
and default, and where its current value comes from: `Set in the app`, `From financer.toml`,
`Default`, or `Set by FINANCER_X on the server`.

- **Layers.** What you save in the app ranks after `financer.toml` and before the environment: it
  replaces the file's value for that key (for `[[bank.accounts]]`, `[[stores]]` and the mailbox
  senders it replaces the whole list), and an environment variable still wins. A key an environment
  variable decides is shown but locked; change it where the variable is set. **Reset** drops what the
  app set, so the file's value (or the default) applies again; clearing a field blanks a value the
  file sets.
- **Where it is kept.** In `financer.settings.json`, a small JSON file next to the SQLite database
  (so inside the Docker volume `/data`), or at `FINANCER_SETTINGS_FILE`. It is written atomically and
  readable by the server's user only (`0600`). **Secrets typed into the app are kept in it in plain
  text**, like a secret written in `financer.toml`; they are never sent back to the app, printed or
  logged (the screen only says "Set"). Keep that file out of version control and backups you do not
  trust. If the server cannot write it (a read-only mount), the screen says so and names
  `FINANCER_SETTINGS_FILE`.
- **Applying.** The server checks the whole change the way it checks its configuration at start (the
  same rules as `--check-config`), and refuses it with one message per problem if anything is wrong,
  saving nothing. A good change is saved and the server **restarts itself** a moment later (it
  re-executes the same program in place, so the process id stays and a container keeps running); the
  app waits and shows the result. In flight requests are cut, so do not save in the middle of an
  import.
- **It cannot lock you out.** The changed settings are "pending" until the server has started with
  them (listening). If they do not start (an address that is taken, a database that cannot be opened,
  a price sources file that does not parse), the server puts the previous settings back, starts with
  them, and the app shows why. The same happens if the server keeps dying on the changed settings.
  What this cannot catch is a setting that starts fine but that the app cannot reach, such as a new
  listen address or port: then set the new address under Settings > Backend. When you change the
  API token the app switches to the new one by itself once the server is back; other devices need it
  entered again.
- **What is not stored.** The bank **PIN** is still never stored anywhere; a FinTS connection names an
  environment variable (`pin_env`) or you type the PIN for each sync. The mailbox password is a key
  of its own (`[receipts.email] password`, new with this screen), used before `password_env`.
- **Checking a server's configuration.** `--print-config` and `--check-config` include the settings
  made in the app, read-only.

New keys appear in the app without a new app release, because the server describes them
(`crates/config/src/schema.rs`). A test fails if a key of the file format is missing from that list,
so "every key" stays true.

## Reference

Unknown keys are an error that names the key (to catch typos), everywhere, `[receipts]` included.

| Key | Environment variable | Default | |
|---|---|---|---|
| `[server] bind` | `FINANCER_BIND` | `127.0.0.1:8080` | listen address; put HTTPS in front |
| `[server] web_dir` | `FINANCER_WEB_DIR` | not served | folder with the built web app (needs `index.html`) |
| `[server] cors_origins` | `FINANCER_CORS_ORIGIN` (comma-separated) | none | development only |
| `[server] refresh_hours` | `FINANCER_REFRESH_HOURS` | `24` | hours between price refreshes, `0` = off |
| `[auth] api_token` | `FINANCER_API_TOKEN` | required | at least 32 characters |
| `[auth] api_token_file` | | | read the token from a file instead (not together with `api_token`) |
| `[database] url` | `FINANCER_DATABASE_URL` | `sqlite://financer.db?mode=rwc` | `sqlite:` or `postgres:` |
| `[prices] sources_file` | `FINANCER_PRICE_SOURCES` | none | JSON price sources, see `docs/PRICES.md` |
| `[[prices.sources]]` | | none | the same entries written in place (`type`, `chain`, `urls`, `is_offer`, `items`, `max_age_days`); used together with `sources_file` |
| `[llm] anthropic_api_key` | `FINANCER_ANTHROPIC_API_KEY` | none | enables Claude |
| `[llm] openai_api_key` | `FINANCER_OPENAI_API_KEY` | none | enables OpenAI |
| `[llm] provider` | `FINANCER_LLM_PROVIDER` | `claude` | `claude` or `openai`; used until the app stores its own choice (Settings) |
| `[bank] fints_product_id` | `FINANCER_FINTS_PRODUCT_ID` | none | enables live bank sync, see `docs/FINTS.md` |
| `[bank.plaid] client_id`, `secret`, `environment`, `country_codes`, `language`, `redirect_uri` | `FINANCER_PLAID_CLIENT_ID`, `FINANCER_PLAID_SECRET`, `FINANCER_PLAID_ENV` | sandbox, DE, de | Plaid keys for `kind = "plaid"` connections, see `docs/BANK_PROVIDERS.md` |
| `[[bank.accounts]]` | | none | connections to sync, below |
| `[[stores]]` | | none | your own supermarket spellings, below |
| `[receipts.email]`, `[receipts.lidl_plus]`, `[receipts.folder]` | `FINANCER_RECEIPTS_*` | all off | automatic receipt import, below |

`FINANCER_CONFIG` (path of the file) is the only variable without a key. `RUST_LOG` is unchanged.

### `[[bank.accounts]]`

```toml
[[bank.accounts]]
name = "Girokonto"                 # shown in the app; unique
kind = "fints"                     # "fints" (default) or "plaid", see below
bank_code = "37050198"             # 8 digits
login = "your-login-name"          # online banking login
iban = "DE89 3704 0044 0532 0130 00"   # FinTS needs the account; checked with the IBAN checksum
pin_env = "SPARKASSE_PIN"          # optional: environment variable that holds the PIN
sync_every_hours = 12              # 0 (default) = only when you press Sync now
since_days = 90                    # optional: how far back the first import reaches (1 to 365)
# fints_url = "https://..."        # optional; otherwise the bank is looked up by its code
# bic = "..."                      # required together with fints_url
```

See `docs/FINTS.md` for what a scheduled sync does, what it needs from you, and what was and was
not tested. In short: the connection is in the file; the PIN is typed in the app or comes from
`pin_env`; every login still needs your approval in the banking app. A scheduled sync starts by
itself (when a PIN is available from `pin_env`) and then waits in the "needs approval" state.

Without `fints_product_id`, FinTS accounts are accepted but cannot sync; the app shows why.

A second provider, **Plaid**, works without a PIN or a per-sync approval: you sign in to your bank
once on Plaid's own page. Its account entry has no bank code, login, IBAN or PIN:

```toml
[bank.plaid]
client_id = "${PLAID_CLIENT_ID}"
secret = "${PLAID_SECRET}"
environment = "production"         # "sandbox" (default) is Plaid's test bank

[[bank.accounts]]
name = "Plaid Girokonto"
kind = "plaid"
sync_every_hours = 12
# account_ids = ["..."]            # optional: read only some linked accounts
```

Both kinds can be configured side by side. See `docs/BANK_PROVIDERS.md` for the sign-in, what is
stored, and what was and was not tested.

### `[[stores]]`

```toml
[[stores]]
chain = "edeka"                          # a built-in chain, or any name of your own
match = ["Mueller Frischemarkt"]         # one text or a list
```

Bank texts are compared without upper/lower case, accents folded the way the rest of Financer does
(letters only, punctuation and digits ignored) and as whole words, in the counterparty first and the
purpose second. Your entries are tried before the built-in table, so they can also correct a
built-in guess. A `chain` that is not built in becomes a chain of its own on the Stores screen. The
name `other` is reserved. Each text needs at least 3 letters. See `docs/STORES.md`.

### `[receipts]`

Automatic receipt import; the full explanation, security notes and what is and is not verified are
in [RECEIPT_SOURCES.md](RECEIPT_SOURCES.md). Every source is off until it is configured.

```toml
[receipts.email]                  # IMAP over TLS
host = "imap.example.org"
username = "you@example.org"
password_env = "FINANCER_IMAP_PASSWORD"   # the NAME of the variable that holds the password
# port = 993, folder = "INBOX", poll_minutes = 30, mark_seen = false, max_age_days = 90
# [[receipts.email.senders]]      # optional; the default is the German retailers
# retailer = "rewe"
# from = ["rewe.de"]

[receipts.lidl_plus]              # experimental, unofficial
enabled = true                    # default false; country = "DE", language = "de", poll_hours = 12

[receipts.folder]
path = "/data/receipts"           # relative paths are relative to the file; poll_seconds = 60
# on_done = "keep"                # or "move" (to done/)
```

Environment variables (they win over the file, value by value; a blank one counts as not set):
`FINANCER_RECEIPTS_IMAP_HOST` (also creates the section), `_USERNAME`, `_PORT`, `_FOLDER`,
`_POLL_MINUTES`, `_MARK_SEEN`, `_MAX_AGE_DAYS`, `_ENABLED`, `_PASSWORD_ENV`, `_SENDERS`
(`rewe=rewe.de,rewe-group.com;lidl=lidl.de`); `FINANCER_RECEIPTS_LIDL_PLUS` (`1` or `0`),
`FINANCER_RECEIPTS_LIDL_COUNTRY`, `_LIDL_LANGUAGE`, `_LIDL_POLL_HOURS`;
`FINANCER_RECEIPTS_FOLDER` (also creates the section), `_FOLDER_POLL_SECONDS`, `_FOLDER_ON_DONE`.
The mailbox password is read from the variable named by `password_env` (default
`FINANCER_IMAP_PASSWORD`), unless a password was typed into the app (Settings > Server settings,
Receipts: mailbox), which keeps it in the server's settings file and uses it first. It is not a key
to write in `financer.toml`. `FINANCER_SECRET_KEY` (16+ characters) encrypts the stored
Lidl Plus token; without it the API token is used.

`--print-config` shows the section with the mail login masked (`j***@example.org`) and only the
*name* of the password variable. `--check-config` fails on an empty host, username or folder path and
warns when the password variable is not set or the folder does not exist.

## Docker

`deploy/docker-compose.yml` mounts `deploy/financer.toml` read-only at `/config/financer.toml` and
sets `FINANCER_CONFIG` to it. Create it before the first start (`cp financer.example.toml
deploy/financer.toml`; a file with only comments is fine). The image and the compose file set
`FINANCER_BIND` and `FINANCER_DATABASE_URL` themselves, and environment variables win over the file,
so `bind` and `database.url` in the file have no effect there; change them in `deploy/.env`.
A `${NAME}` in the file can only see variables the container has: the `FINANCER_*` ones that compose
already forwards, or any you add under `environment:` (for example a `SPARKASSE_PIN` for `pin_env`).

This compose change was written but **not run** (no Docker in the sandbox). The nested mount of a
file into the already mounted `./config` folder is standard bind-mount behavior, but check it on
first use.

## Development

`make dev` creates `.dev/financer.toml` from the example if it is missing and the server reads it.
The variables the Makefile sets (token, database, address, CORS) win over it. `.dev/env` still
works.

## Desktop bundle

`start.sh` / `start.bat` create a commented `financer.toml` next to the token on first start and
otherwise behave as before. The settings they export (token, database, web dir, address) win over
the file.
