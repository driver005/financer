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
| Budget: monthly limits per category, income and fixed costs from recurring payments | built and tested |
| "What can I buy?": basket per chain, cheapest split, cheapest items for your budget | built and tested on supplied prices |
| Prices from Lidl, Aldi, Kaufland, Rewe | **no per-retailer scrapers** (I could not check any against the live sites). You configure pages, read by schema.org data, by your Claude/OpenAI model (works on any layout, costs API calls, prices must literally appear in the page), or Open Prices ([docs/PRICES.md](docs/PRICES.md)). The whole path is tested end to end against local pages; **which real pages work is unverified**
| What you normally buy | three modes: your own list, learned from receipts, or a generic starter basket |
| Receipts | paste text, or photograph one (read by your Claude/OpenAI model; the photo leaves your server). digital receipts (Rewe eBon, Lidl Plus) work as PDF imports: export the PDF from their app and import it, read by your model; there is no automatic pull from their private APIs |
| Recipes | 23 bundled German recipes ranked by your items, offers and cost; "surprise me" ideas from Claude or OpenAI (switchable), tested with a mock model, and the Claude and OpenAI request/response formats (JSON mode, image upload, auth headers) are checked against local fakes of both APIs; **never run against the real providers (no API key)** |
| Embedded on-phone backend | Rust side built and tested; bindings generate; background refresh task written; the **native build and device run are not done** ([docs/EMBEDDED.md](docs/EMBEDDED.md)) |
| Backup / move between server and phone | export and import of your data as one JSON file (no secrets), idempotent; tested, including through the browser |
| App | HeroUI Native (Tailwind classes via Uniwind) with a playful, Duolingo-style look: bright green/blue/orange palette (light and dark), chunky 3D buttons with haptics, thick-bordered cards, animated progress bars, and a **Today** tab with a mascot (Penny), a daily grocery goal, a streak, XP/levels and five quests. The streak, goal, XP and quests are **computed from your real data** (transactions, limits, usual items, prices, receipts), nothing is stored separately or invented ([`src/game.ts`](apps/mobile/src/game.ts), unit-tested). Typechecks, 28 Node tests, bundles for iOS/Android/web, and the web build was driven in a real browser against the real server (every screen, both colour schemes, and a quest being completed); **never run on a phone**. In the web build HeroUI logs harmless `colorKit` warnings (its hover colours use CSS `color-mix`) and renders each toast twice on top of each other |
| Deployment (Docker, Caddy HTTPS, Postgres profile) | the image **was built and run** (161 MB, non-root user, health and auth work, data survives a restart, runs against a PostgreSQL container). The real `deploy/docker-compose.yml` **was brought up with Caddy**: HTTPS on a local certificate, HTTP redirects to HTTPS, no token gives 401, the API port is not reachable from outside Caddy, and imported data survives `down`/`up`. Caveats: in this sandbox the server image was assembled from a host-built binary on Ubuntu instead of the Dockerfile's own Rust build stage (the sandbox proxy blocks that), and Caddy used `localhost` with its own CA, so **a real domain with Let's Encrypt was not tried**. Trying it exposed that the SQLite setup failed without a `POSTGRES_PASSWORD`; fixed |

## Run it

Server (SQLite, local):

```sh
export FINANCER_API_TOKEN=$(openssl rand -hex 32)   # at least 32 characters
cargo run -p financer-server                        # listens on 127.0.0.1:8080
```

Settings (environment variables; the full list is at the top of `crates/server/src/main.rs`):

| Variable | Purpose |
|---|---|
| `FINANCER_API_TOKEN` | required; the app sends it as a bearer token |
| `FINANCER_DATABASE_URL` | `postgres://user:pass@host/db` or `sqlite://path?mode=rwc` (default `sqlite://financer.db?mode=rwc`) |
| `FINANCER_BIND` | listen address, default `127.0.0.1:8080` (put HTTPS in front) |
| `FINANCER_PRICE_SOURCES` | path to a JSON file of price sources |
| `FINANCER_FINTS_PRODUCT_ID` | enables live Sparkasse sync |
| `FINANCER_ANTHROPIC_API_KEY`, `FINANCER_OPENAI_API_KEY` | enable recipe ideas and receipt photo scan |

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
crates/recipes    bundled recipes, ranking, AI ideas
crates/llm        Claude and OpenAI behind one trait (genai)
crates/api        Axum router, auth, OpenAPI
crates/server     hosted binary
crates/embedded   the same backend as a library for the phone (UniFFI)
apps/mobile       Expo app (routes in src/app)
deploy/           Dockerfile, compose, Caddyfile
docs/             FINTS.md, PRICES.md, EMBEDDED.md
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
