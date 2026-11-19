# Pantry app flow map (all current features)

Design source: Stitch project created from `DESIGN.md`, screens generated for
each route below. The bottom nav has five anchors; everything else is reached
from the Overview hero, the hub, or a screen CTA.

## Navigation spine

| Tab | Route | Purpose |
| --- | --- | --- |
| Overview | `/home` | balance, streak, budgets, accounts, quick actions |
| Prices | `/prices` | Idealo-style item comparison across discounters + sales |
| Contracts | `/contracts` | contracts, saving tips, cancellation status |
| Insights | `/insights` | disposable income, trends, categories, budgets |
| More | `/hub` | every remaining feature |

Secondary tabs reachable from More and Overview: Insurance `/insurance`,
Savings Booster `/savings`, Automatic categorisation `/categorised`,
Connect accounts `/connect`, Budgets `/budgets`, Transactions `/transactions`,
Money flows `/flows`, Recipes `/recipes`, Shopping list `/list`,
Shops & offers `/shops`, Settings & Plus `/settings`.

## Flows

1. **Overview** → see balance → tap Budgets → adjust → back → tap Accounts → detail.
2. **Price comparison** → search item → compare all discounters → see sale badge → tap cheapest → add to shopping list. Empty state → Add first price.
3. **Contracts** → see monthly total → money-saving tips → tap contract → cancellation sheet → download or send (email/SMS/webhook) → `Cancelled!` badge.
4. **Insights** → disposable income → month trend → category bars → AI tips → budget status.
5. **Insurance** → coverage check → tap missing area → add premium → policy appears.
6. **Savings Booster** → points → cash out/reserve → vouchers → savings potential → goals.
7. **Categorisation** → merchant list → tap category pill → reassign → Insights updates.
8. **Connect accounts** → choose Demo / Real PSD2 / Plaid / Custom API → configure credentials in sheet → bank login → import accounts + transactions.
9. **Budgets** → monthly expense bars → budget cards (left/over) → + new budget.
10. **Transactions** → forecast balance → dated groups → cashback pill → more → Money flows.
11. **Money flows** → Transfer / Refund / Rebook / Split / Plus tabs → local write → confirmation.
12. **Recipes** → search → dish of the day → save → generate shopping list.
13. **Shopping list** → week/month → generate from brands → add item → check off.
14. **Shops & offers** → match transactions → supermarket sync → paste offers.
15. **Hub** → grid of every feature → route.
16. **Settings & Plus** → language, timezone, payday, biometrics, plan, promo code, advanced settings.

Every write is local SQLite; external bank/cancellation providers are
runtime-configured. No keys in the app.
