# Financer

Personal finance and grocery planner for one person with a Sparkasse account. It tracks your
spending, keeps a budget, shows what the budget can buy, compares Lidl / Aldi / Kaufland / Rewe
prices, and suggests recipes from what you normally buy.

**Stack:** Expo (TypeScript, HeroUI Native) app + Rust backend (Axum) on PostgreSQL or
SQLite. The same backend can also run inside the phone (see [docs/EMBEDDED.md](docs/EMBEDDED.md)).

## What works, and how sure I am

| Feature | State |
|---|---|
| Spending: import a Sparkasse CSV export, categorize, find recurring payments | built and tested; the CSV column names come from memory of the export, **check with a real file** |
| Live Sparkasse sync (FinTS, pushTAN approval in the Sparkasse app) | login, balance and transactions are verified against the `fints-rs` mock bank over the real protocol (in CI); wrong PINs are recognised and pause syncing after two tries to protect against lockout; pushTAN approval polling is verified against a **simulated** pushTAN bank (a small patch to the mock, in CI) but it was never run against a real Sparkasse; needs your FinTS product id ([docs/FINTS.md](docs/FINTS.md)) |
| Categorization rules, learning from corrections, split transactions, AI suggestions | your own rules (name contains/is/starts with, optional expense/income and amount range) beat the built-in ones on import and sync and can be re-applied; recategorizing a transaction can "remember" the merchant; a transaction can be split into parts that must add up exactly and that budget totals use; "Suggest categories" asks your Claude/OpenAI model about unknown merchants and sends **only merchant names**. Tested on SQLite and over HTTP with a mock model; the screens are typechecked and their logic unit-tested but **never run on a device**, and the real providers were never called ([docs/CATEGORIZATION.md](docs/CATEGORIZATION.md)) |
| Budget: monthly limits per category, income and fixed costs from recurring payments | built and tested |
| Payday budget months and "safe to spend today" | set the day you get paid (1-28) in Settings; budget status, envelopes and the grocery goal then run payday to payday instead of on calendar months. Today shows a daily number (income this period minus spending so far, recurring costs still due and unspent envelope money, divided by the days left) with a pace flag and an explainer sheet. Rust logic unit-tested (payday 31 clamp, year-end, no income, overspent envelopes) and the endpoints tested through the router; the TS mirror of the period rule is tested against the same cases. The app screens typecheck but were **never run on a device or in a browser**; the daily number is a budget estimate from detected recurring payments, **not a bank balance**, and is only as good as that detection ([docs/BUDGET_PERIODS.md](docs/BUDGET_PERIODS.md)) |
| "What can I buy?": basket per chain, cheapest split, cheapest items for your budget | built and tested on supplied prices |
| Prices from Lidl, Aldi, Kaufland, Rewe | **no per-retailer scrapers** (I could not check any against the live sites). You configure pages, read by schema.org data, by your Claude/OpenAI model (works on any layout, costs API calls, prices must literally appear in the page), or Open Prices ([docs/PRICES.md](docs/PRICES.md)). Tested end to end against local pages. A live probe from a GitHub runner showed: **Open Prices works** against the real service; **Rewe and Kaufland refused (403)** to that address; **Lidl and Aldi pages load but have no schema.org product data**, so they need the model-read source. Results from your own connection may differ
| What you normally buy | three modes: your own list, learned from receipts, or a generic starter basket |
| Receipts | paste text, or photograph one (read by your Claude/OpenAI model; the photo leaves your server). digital receipts (Rewe eBon, Lidl Plus) can be imported by hand as a PDF (read by your model), or pulled in automatically from your mailbox, a watched folder or, experimentally, your Lidl Plus account ([docs/RECEIPT_SOURCES.md](docs/RECEIPT_SOURCES.md)) |
| Recipes | 23 bundled German recipes ranked by your items, offers and cost; "surprise me" ideas from Claude or OpenAI (switchable), tested with a mock model, and the Claude and OpenAI request/response formats (JSON mode, image upload, auth headers) are checked against local fakes of both APIs; **never run against the real providers (no API key)** |
| Embedded on-phone backend | Rust side built and tested; bindings generate; background refresh task written; the Rust library **cross-compiles for Android and iOS** on GitHub runners; an **Android APK that includes it builds in CI** (`scripts/enable-embedded.sh`) and **answers a request on an emulator in CI**; the **iOS app with it builds in CI** (simulator) but has never been run, and no physical-phone run has been done ([docs/EMBEDDED.md](docs/EMBEDDED.md)) |
| Backup / move between server and phone | export and import of your data as one JSON file (no secrets), idempotent; tested, including through the browser |
| Subscription watchdog + anomaly alerts | built and unit/integration tested on hand-made transactions, **not tried on a real account**: calendar of upcoming charges, price-hike, duplicate and possibly-unused detection, and alerts for duplicate charges, unusual amounts, big first-time merchants and large-for-category charges, with dismissal ([docs/WATCHDOG.md](docs/WATCHDOG.md)). Screens are typechecked and their logic is Node-tested, but they were **never run on a device or bundled in this sandbox** |
| App | HeroUI Native (Tailwind classes via Uniwind) with a calm dashboard look: indigo accent on cool neutrals (light and dark), flat sections separated by hairlines, flat buttons with haptics, animated progress bars, and a **Today** tab with a mascot (Penny), a daily grocery goal, a streak, XP/levels and five quests. The streak, goal, XP and quests are **computed from your real data** (transactions, limits, usual items, prices, receipts), nothing is stored separately or invented ([`src/game.ts`](apps/mobile/src/game.ts), unit-tested). Typechecks, 28 Node tests, bundles for iOS/Android/web, and the web build was driven in a real browser against the real server (every screen, both colour schemes, and a quest being completed); **never run on a phone**. In the web build HeroUI logs harmless `colorKit` warnings (its hover colours use CSS `color-mix`) and renders each toast twice on top of each other |
| First-run onboarding | 8 steps (welcome, where your data lives, household and stores, payday and saving level, how to learn what you buy, connect money or try demo data, lock and notifications, celebration); walked in a headless browser against a mocked backend, **not run on a phone**; demo data cannot be removed again; household, stores and postal code are saved but nothing reads them yet ([docs/ONBOARDING.md](docs/ONBOARDING.md)) |
| Encrypted backup, app lock | passphrase-encrypted backups (round trip, wrong passphrase and damaged files tested), automatic backups, biometric lock; the **share sheet, pickers, biometrics were never run** ([docs/BACKUP_AND_LOCK.md](docs/BACKUP_AND_LOCK.md)) |
| Barcode scan | `GET /v1/prices/ean/{ean}` with EAN validation and per-chain ranking, tested on fixtures; the **camera screen was never run** |
| Weekly meal plan with shopping list | plan, merged ingredients, pantry, per-chain totals and best split, budget check; tested on the in-memory store, **Postgres not run**, not part of the JSON export ([docs/MEALPLAN.md](docs/MEALPLAN.md)) |
| Forecast and trophies | end-of-period forecast and derived streak freezes, badges and weekly bests; unit-tested, screens not run on a device ([docs/FORECAST_AND_TROPHIES.md](docs/FORECAST_AND_TROPHIES.md)) |
| Notifications, version stamping, dependency and nightly checks | notification planning logic tested, **scheduling and permissions never run**; release builds carry the tag's version; Android release signing is **untested** |
| Release builds (GitHub workflow: every release has two variants, **compact** (Android APK / iOS Simulator app with the backend inside) and **server + client** (desktop bundles, Docker image, web zip, client APK / iOS Simulator app; iPhone builds via EAS)) | [docs/RELEASE.md](docs/RELEASE.md); the web and desktop bundles built on GitHub's runners for Linux, macOS (both) and Windows, the Linux bundle was run locally, and an **installable Android APK builds on a runner without an Expo account** (never installed on a device); the Docker, release-attach and phone jobs have **not run** (the phone jobs need your Expo account) |
| Deployment (Docker, Caddy HTTPS, Postgres profile) | the image **was built and run** (161 MB, non-root user, health and auth work, data survives a restart, runs against a PostgreSQL container). The real `deploy/docker-compose.yml` **was brought up with Caddy**: HTTPS on a local certificate, HTTP redirects to HTTPS, no token gives 401, the API port is not reachable from outside Caddy, and imported data survives `down`/`up`. Caveats: in this sandbox the server image was assembled from a host-built binary on Ubuntu instead of the Dockerfile's own Rust build stage (the sandbox proxy blocks that), and Caddy used `localhost` with its own CA, so **a real domain with Let's Encrypt was not tried**. Trying it exposed that the SQLite setup failed without a `POSTGRES_PASSWORD`; fixed |
| Server config file (`financer.toml`) | optional TOML next to the environment variables (environment wins); `${NAME}` references for secrets, unknown keys are errors, `--check-config` and `--print-config` (secrets hidden). Unit-tested (precedence, interpolation, redaction, defaults equal to the old behavior) and the real binary was started with it; the compose, desktop-script and `make dev` changes were checked by reading/dry-run only, **docker compose was not re-run** ([docs/CONFIG.md](docs/CONFIG.md)) |
| Scheduled bank sync from the config | `[[bank.accounts]]` in `financer.toml`; the server logs in on a schedule (when the PIN is in an environment variable) and waits for your pushTAN approval, shown in Settings > Bank connections; a refused login is never retried by itself. Tested with a scripted bank (approval wait, idempotent import, scheduler, no retry after a wrong PIN, no secret in any response); **never run against a real bank**, and the Settings card was never run on a device or in a browser ([docs/FINTS.md](docs/FINTS.md)) |
| Automatic receipts (mailbox, watched folder, Lidl Plus) | `[receipts]` in `financer.toml`: IMAP mailbox (REWE eBon PDFs and other shops' mails), a watched folder, and an **experimental, unofficial** Lidl Plus sign-in done on Lidl's own page (only an encrypted refresh token is kept). Receipts are de-duplicated across routes and linked to the matching bank payment when that is unambiguous. Tested with a fake mailbox holding hand-written mails and generated PDFs, hand-written Lidl JSON and a temporary folder; **never run against a real mailbox, Lidl or REWE**, and the screen was never run on a device or in a browser ([docs/RECEIPT_SOURCES.md](docs/RECEIPT_SOURCES.md)) |
| What I spend at each supermarket | built-in German chains plus your own `[[stores]]` spellings, per payday period with share, visits, average basket and change against the comparable earlier range; matcher, aggregation and endpoints tested on realistic booking texts; the Stores screen typechecks and is unit-tested but was **never run on a device or in a browser**, and the built-in spellings were not checked against a real account ([docs/STORES.md](docs/STORES.md)) |

## Run it

For development, `make setup && make dev` starts the server and the web app together ([docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)). By hand:

Server (SQLite, local):

```sh
export FINANCER_API_TOKEN=$(openssl rand -hex 32)   # at least 32 characters
cargo run -p financer-server                        # listens on 127.0.0.1:8080
```

Settings come from environment variables and, optionally, a `financer.toml` file (copy
[`financer.example.toml`](financer.example.toml); the environment wins over the file, and
without a file the variables alone work as before). Full reference: [docs/CONFIG.md](docs/CONFIG.md).
`financer-server --check-config` validates it and `--print-config` shows what is in effect, with
secrets hidden. The on-phone backend does not read the file. The environment variables:

| Variable | Purpose |
|---|---|
| `FINANCER_API_TOKEN` | required; the app sends it as a bearer token |
| `FINANCER_DATABASE_URL` | `postgres://user:pass@host/db` or `sqlite://path?mode=rwc` (default `sqlite://financer.db?mode=rwc`) |
| `FINANCER_BIND` | listen address, default `127.0.0.1:8080` (put HTTPS in front) |
| `FINANCER_PRICE_SOURCES` | path to a JSON file of price sources |
| `FINANCER_WEB_DIR` | serve a built web app (`expo export --platform web`) at `/`, same address as the API |
| `FINANCER_CORS_ORIGIN` | development only: origins (comma-separated) whose browsers may call the API, used by `make dev` |
| `FINANCER_FINTS_PRODUCT_ID` | enables live Sparkasse sync |
| `FINANCER_ANTHROPIC_API_KEY`, `FINANCER_OPENAI_API_KEY` | enable recipe ideas and receipt photo scan |
| `FINANCER_LLM_PROVIDER` | `claude` or `openai`: the provider used until the app picks one |
| `FINANCER_CONFIG` | path of the config file (also `--config <path>`; default `./financer.toml`) |

App:

```sh
cd apps/mobile
npm install
npm start          # Expo; open in Expo Go (the on-phone backend needs a custom build)
```

In the app: **Settings** → server address and token → **Spending** → import a CSV (or
**Sync with Sparkasse**).

Deploy to a small VPS with HTTPS: `deploy/docker-compose.yml` (about 3–6 EUR a month).

## Develop

```sh
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
# PostgreSQL tests are skipped unless:
FINANCER_TEST_POSTGRES_URL=postgres://financer:financer@127.0.0.1:5432/financer_test cargo test --workspace
cd apps/mobile && npm run typecheck && npm test
npm run gen:api    # regenerate src/api/schema.d.ts after changing the API
```

## Layout

```
crates/core       money, catalog of generic items, categorizer, recurring payments, budget and basket engines
crates/store      SeaORM entities + migrations (SQLite and PostgreSQL, chosen by URL)
crates/fints      CSV import; live bank sync (trait, mock, fints-rs adapter)
crates/prices     pack-size normalisation, JSON-LD / Open Food Facts / Open Prices, polite HTTP
crates/receipts   receipt text parser and usual-item learning
crates/receipt-sources   mailbox, watched folder and Lidl Plus receipt import, receipt/payment matcher
crates/recipes    bundled recipes, ranking, AI ideas
crates/llm        Claude and OpenAI behind one trait (genai)
crates/api        Axum router, auth, OpenAPI
crates/config     financer.toml and environment configuration of the server
crates/server     hosted binary
crates/embedded   the same backend as a library for the phone (UniFFI)
apps/mobile       Expo app (routes in src/app)
deploy/           Dockerfile, compose, Caddyfile
docs/             CONFIG.md, RECEIPT_SOURCES.md, STORES.md, CATEGORIZATION.md, FINTS.md, PRICES.md, EMBEDDED.md, RELEASE.md, MASCOT.md
```

## Security notes

- Everything except `/health` needs `Authorization: Bearer <token>`. The server keeps only a
  hash of the token and refuses tokens under 32 characters. After 20 wrong tokens in a minute
  the API answers 429 for a minute (global, because there is one user).
- Run it behind HTTPS (the Caddy file does this). Without it the token and your bank data
  travel in clear text.
- The bank PIN is sent per sync, held in memory until you approve, and never stored or logged.
  API keys live in the server's environment, not in the app (on the phone they go into secure
  storage, since there is no server).
- The web build stores settings in `localStorage`, which is not secure storage. It exists for
  development; do not use it with a real bank server.
- Reading retailer pages may breach their terms. It is meant for personal use, runs only for
  sources you configure, obeys robots.txt and waits between requests.
