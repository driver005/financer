# Configuration

The hosted server (`financer-server`) is configured with environment variables, an optional
`financer.toml` file, and a few settings stored in its database (payday, habit mode, LLM model;
those are changed in the app and are not part of this page).

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

For every setting that has an environment variable: **environment variable, then the file, then
the default.** A variable that is set but blank counts as not set (docker compose passes unset
variables through as empty strings). Settings that only make sense in the file
(`[[bank.accounts]]`, `[[stores]]`) have no variable.

Relative paths written in the file (`web_dir`, `api_token_file`, `sources_file`) are relative to the
folder of the file. A path given by environment variable is relative to the working directory. The
database URL is passed on as written (a relative SQLite path is relative to the working directory).

## Secrets

- Any **string** value may refer to the environment: `${NAME}`. It is an error if `NAME` is not set
  or blank, unless the reference has a default: `${NAME:-fallback}`. Write `$$` for a literal `$`.
  References work in every string of the file (not in numbers, and not inside `[receipts]`).
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

`--print-config` marks every value with `# default`, `# file` or `# env NAME`. Syntax errors and
unknown keys come with the line number from the TOML parser; a missing `${NAME}` names the key, the
variable and the line. `--check-config` also checks that the token is long enough, that the database
URL is `sqlite:` or `postgres:`, that `web_dir` has an `index.html` and that the price sources file
exists and parses. A bank `pin_env` whose variable is not set in the environment of the check is a
warning (it may only be set for the running service).

## Reference

Unknown keys are an error that names the key (to catch typos), everywhere except under `[receipts]`.

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
| `[llm] anthropic_api_key` | `FINANCER_ANTHROPIC_API_KEY` | none | enables Claude |
| `[llm] openai_api_key` | `FINANCER_OPENAI_API_KEY` | none | enables OpenAI |
| `[llm] provider` | `FINANCER_LLM_PROVIDER` | `claude` | `claude` or `openai`; used until the app stores its own choice (Settings) |
| `[bank] fints_product_id` | `FINANCER_FINTS_PRODUCT_ID` | none | enables live bank sync, see `docs/FINTS.md` |
| `[[bank.accounts]]` | | none | connections to sync, below |
| `[[stores]]` | | none | your own supermarket spellings, below |
| `[receipts]` | | | reserved; accepted and ignored |

`FINANCER_CONFIG` (path of the file) is the only variable without a key. `RUST_LOG` is unchanged.

### `[[bank.accounts]]`

```toml
[[bank.accounts]]
name = "Girokonto"                 # shown in the app; unique
kind = "fints"                     # the only kind
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

Without `fints_product_id`, accounts are accepted but cannot sync; the app shows why.

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
