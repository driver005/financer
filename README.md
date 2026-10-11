# Financer

Personal finance and grocery planner for one person with a Sparkasse account: track expenses, set a budget, see what the budget can buy, compare Lidl / Aldi / Kaufland / Rewe prices and get recipe ideas from what you normally buy.

**Stack:** Expo (TypeScript) app + Rust backend (Axum) on PostgreSQL or SQLite. The same API can later also run embedded on the phone.

## Status

| Area | State |
|---|---|
| Domain logic (money, categorizer, recurring payments, budget, basket / "what can I buy") | done, unit tested |
| Sparkasse CSV import | done (column names from memory of the CSV-CAMT export; check against a real export) |
| Store on SQLite **and** PostgreSQL | done, tested on both |
| REST API + hosted server, bearer-token auth, OpenAPI | done, tested |
| Expo app: connect, import CSV, transactions, budget limits | done; typechecks and bundles, **not yet run on a device** |
| Docker / Caddy deployment files | written; compose file validated, **image not built or deployed yet** |
| FinTS live sync | not started, needs DK product registration, see [docs/FINTS.md](docs/FINTS.md) |
| Price scrapers, Open Food Facts / Open Prices | not started |
| Receipts, recipes, LLM (Claude / OpenAI) | not started |
| Embedded on-phone backend | not started |

## Run it

Server (SQLite, local):

```sh
export FINANCER_API_TOKEN=$(openssl rand -hex 32)   # at least 32 characters
cargo run -p financer-server                        # listens on 127.0.0.1:8080
```

PostgreSQL instead: `FINANCER_DATABASE_URL=postgres://user:pass@host/db`. Other settings are documented at the top of `crates/server/src/main.rs`.

App:

```sh
cd apps/mobile
npm install
npm start          # Expo; open in Expo Go
```

In the app, open **Settings**, enter the server address and the token, then **Transactions → Import Sparkasse CSV** (export from Sparkasse online banking, CSV-CAMT format).

Deploying to a small VPS with HTTPS: see `deploy/docker-compose.yml` (about 3–6 EUR per month).

## Develop

```sh
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                                  # PostgreSQL tests are skipped unless:
FINANCER_TEST_POSTGRES_URL=postgres://financer:financer@127.0.0.1:5432/financer_test cargo test --workspace
cd apps/mobile && npm run typecheck
npm run gen:api    # regenerate src/api/schema.d.ts after changing the API
```

## Layout

```
crates/core      money, categorizer, recurring detection, budget and basket engines
crates/store     SeaORM entities + migrations (SQLite and PostgreSQL, chosen by URL)
crates/fints     bank sources; Sparkasse CSV import (FinTS client to come)
crates/api       Axum router, auth, OpenAPI
crates/server    hosted binary
apps/mobile      Expo app (routes in src/app)
deploy/          Dockerfile, compose, Caddyfile
```

## Security notes

- The API needs `Authorization: Bearer <token>` on everything except `/health`; the server keeps only a hash of the token and refuses tokens under 32 characters.
- Run it behind HTTPS (the Caddy file does this). Without it the token and your bank data travel in clear text.
- There is no rate limiting on token attempts yet; a long random token makes guessing impractical, but add it before exposing the server widely.
- Scraping retailer sites (planned) may breach their terms; it is meant for personal use only.
