# Pantry

One local app. Recipes, saved favourites, a week/month shopping list, supermarket tracking and
monthly spending — all stored on the device. **No server, no account, no token, no client SDK.**

## What it does

- **Recipes** from TheMealDB (a large public recipe provider): search, surprise me, open full recipe.
- **Saved** recipes are cached on the device and work offline.
- **List**: add a recipe's scaled ingredients, or type items yourself, to a **weekly** or **monthly** list.
- **Shops**: REWE, Kaufland, Lidl, Aldi, Penny and Netto. Edit each shop's spellings, match pasted
  transactions to a shop, see visits / total / average basket per month, and save **Angebote**
  (special offers) pasted from a shop app.
- **Money**: month total, category and per-store breakdown. Add transactions by hand, import a CSV,
  or pull directly from **Plaid** / **GoCardless** with your own keys — the request goes from the
  device to the provider, never through an app server.

UI follows the `ui-ux-pro-max` design system: minimal single column, monochrome + one blue accent,
large type, 44px touch targets, visible empty/loading/error states, light and dark.

## CI builds

`.github/workflows/build.yml` builds both apps on a tag (`v*`) or via manual dispatch, with no external credentials:

- **Android** — `expo prebuild` + `gradlew assembleRelease` → artifact `pantry-android-apk`.
- **iOS** — `expo prebuild` + `pod install` + `xcodebuild -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO` → artifact `pantry-ios-simulator-app` (unsigned simulator app).

For a signed App Store / Play Store build, add an EAS workflow with your own credentials; the local build above needs none.

## Run

```sh
make setup
make start          # Expo: phone or emulator
make web            # browser
make typecheck
make test
```

Web build: `make web-build` → `apps/mobile/dist`.

## Layout

```text
apps/mobile        the only app (Expo Router + expo-sqlite); Expo renders UI only
apps/mobile/src/rust  WebAssembly build of the Rust core
crates/pantry-core business logic: periods, money, CSV, store matching, Angebote, recipes
packages/finance-ui Expo UI kit based on Pockaw (see docs/POCKAW_UI.md)
docs/reference     unmodified reference clones of Pockaw, Dompetku, Boring Balance, Jings Finance
docs/PARITY_MAP.md feature-by-feature status against those four apps
docs/PARITY_CHECKLIST.md checked implementation checklist (full parity)
docs/POCKAW_UI.md  design tokens, components and integrated flows
apps/catalog       design-system catalog
packages/ui        shared UI tokens (design work)
crates/uiconv      standalone icon generator for packages/ui
```

The Money area follows feature sets from Google Play money trackers (Money Manager, Monefy, Money Tracker); see `docs/MONEY_TRACKER.md`.

Design follows Dribbble food-app references (Foody by SLAB, Bodega by Ipanadh, Meto by V. Labici) with Fraunces + Plus Jakarta Sans, a sage canvas and fresh-green accent; see `docs/DESIGN.md`. Stitch reference screens live in project `9534181714922376088`. The shopping list can be generated from what you buy at each supermarket; items matching an Angebot are marked with price.
Rebuild the Rust core with `make core-build`, test it with `make core-test`.

The data lives in `apps/mobile`'s local SQLite database (`pantry.db`). Deleting the app deletes
its data; Settings has an explicit "erase all local data" action.
