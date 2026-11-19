# Merged screens — one big app

Stitch project: `11057116803371822050` ("Pantry merged app screens"), 14 generated designs from the four reference apps. Design system **Culinary Capital** (`#027E83` teal, `#8E1AB1` violet, `#B9A115` yellow, `#E50855` red, `#F7F9FA` canvas, Montserrat headings / Plus Jakarta Sans body / Urbanist numerals) is the single token source in `packages/finance-ui/src/tokens.ts`.

Every screen uses `AsyncBoundary` (skeleton/empty/error), `FadeIn` motion (reduced-motion aware) and the themed shell. QA matrix: 375/390/430 px × light/dark, 24 route checks, zero horizontal overflow.

## Screen map

| New Expo route | Merges |
|---|---|
| `/home` | Pockaw dashboard + Dompetku dashboard + Boring overview + Jings log |
| `/transactions` | Pockaw transaction list/form + Dompetku dialog + Boring table + Jings calendar |
| `/budgets` | Pockaw weekly/monthly + Dompetku rollover/alerts + Boring analysis |
| `/goals` | Pockaw goals/checklist + Dompetku goals + Jings plans |
| `/projects` | Jings projects + Dompetku envelopes/Kantong |
| `/paycheck` | Jings waterfall/history + Dompetku allocations/piggy |
| `/accounts` | Pockaw wallets + Boring accounts/valuations + Dompetku account detail |
| `/reports` | Pockaw monthly report + Dompetku rekap + Boring breakdown/compare |
| `/obligations` | Boring recurring + Dompetku debts/subscriptions/receivables/reminders |
| `/assets` | Dompetku gold + invoices/payment approval |
| `/shops` | supermarket sync, Angebote, price curves, best-buy plan |
| `/list` | week/month shopping list with offer flags |
| `/recipes` | recipe provider, favorites |
| `/settings-backup` (via `/settings`, `/gaps`) | settings, passcode, locale, backup/share |
| `/hub` | navigator for every merged screen |

Bottom bar: Home, Money, Plans, Shops, More. `/` redirects to `/home`; recipes moved to `/recipes`.

Business logic remains in `crates/pantry-core` with a Hermes fallback in `apps/mobile/src/rust/coreFallback.ts`. No upstream framework code (Flutter/Next/Angular) is shipped; only merged Expo screens.
