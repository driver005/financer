# Price comparison (Idealo-style)

Route: `/prices` — also reachable from the **Prices** bottom tab, the Overview
"Compare prices" tile and the All apps hub.

## What it does

For every item in the local price history the screen shows:

- every discounter that has a recorded price, sorted cheapest first
- cheapest store badge, current price, historical average, number of samples
- sale badges from local offers plus discount price dips
- savings versus the average price across stores
- buy-now / wait-for-date advice from the Rust `core.forecast`
- search and sort by biggest saving or A–Z
- add a price for an item at any discounter (stored in SQLite)

## Data sources

| Data | Source |
| --- | --- |
| Price history | `apps/mobile/src/db/prices.ts` (`prices` table) |
| Discounters | `apps/mobile/src/lib/stores.ts` (REWE, Kaufland, Lidl, Aldi, Penny, Netto) |
| Sales / offers | `apps/mobile/src/db/money.ts` (`offers` table) |
| Stats and forecast | Rust core `wasm_price_stats` / `wasm_forecast` |

Sample prices and sample sales are seeded only on first launch so the
comparison is populated before the user imports receipts. Settings → *Remove
sample prices* clears the seeded price rows.

## Limitation

This is not a live Idealo/Geizhals integration. It compares prices the user has
recorded or imported locally; there is no scraping or retailer API. Adding a
real price feed needs a licensed data source or per-retailer agreement.
