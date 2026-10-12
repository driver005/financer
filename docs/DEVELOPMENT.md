# Local development

Needs Rust (see `rust-version` in `Cargo.toml`), Node 22 and `make`. Docker is only needed for the
PostgreSQL option, and `cargo-watch` (`cargo install cargo-watch`) is optional. `make doctor`
shows what is installed.

```sh
make setup     # once: installs the app's npm packages
make dev       # server + web app, Ctrl-C stops both
```

`make dev` prints the addresses and a token. Open http://localhost:8081, and in the app (onboarding
step "Where should your data live?", or Settings) choose your own server, URL
`http://localhost:8080`, and paste the token. The browser remembers both.

| Command | What it does |
|---|---|
| `make dev` | Rust server (restarts on Rust changes when `cargo-watch` is installed) and the Expo web app with hot reload |
| `make dev-postgres` | the same on a PostgreSQL container (`make db-up`; `db-down` stops it, `db-reset` deletes its data) |
| `make server` / `make server-watch` | only the server, once / restarting on changes |
| `make web` | only the web app (start the server yourself) |
| `make app`, `make android`, `make ios` | Expo for a phone (Expo Go), an Android emulator, an iOS Simulator |
| `make serve` | builds the web app and serves it from the server on one address (`:8080`), like a release |
| `make dev-reset` | deletes the dev database, keeps the token |
| `make gen-api` | regenerates `openapi.json` and `src/api/schema.d.ts` after API changes |
| `make test`, `make lint`, `make check` | tests, format/clippy/typecheck, both (what CI runs) |
| `make clean` | removes `target/` and the web build |

Options go on the command line: `make dev BIND=0.0.0.0:8080 WEB_PORT=19006 DB_URL=postgres://...`.

## Where things live

Everything local is in `.dev/` (git-ignored):

- `.dev/financer.db`: the SQLite database.
- `.dev/token`: the dev API token, created on first use. Delete it to get a new one.
- `.dev/env`: optional. Plain `NAME=value` lines (or `export NAME=value`), loaded before the server
  starts. Put `FINANCER_ANTHROPIC_API_KEY`, `FINANCER_PRICE_SOURCES`, `FINANCER_FINTS_PRODUCT_ID`
  and the like here.

## Notes

- **A phone** cannot reach `localhost` on your computer. Run `make dev BIND=0.0.0.0:8080` and use
  your computer's address in the app. The server then listens on your whole network, so do this
  only on a network you trust (the token is the only protection and there is no HTTPS).
- **CORS.** The web dev server runs on another port than the API, so browsers block the calls unless
  the server allows that origin. The Makefile sets `FINANCER_CORS_ORIGIN` to the web dev server's
  address. The setting is off unless set; do not set it in production (the release bundle serves the
  app from the same address, so it does not need it).
- The on-phone backend (the "compact" variant) is not part of `make dev`; see `docs/EMBEDDED.md`.
- Not covered here: starting the on-phone backend in an emulator, and the production stack
  (`deploy/docker-compose.yml`, see `docs/RELEASE.md`).
