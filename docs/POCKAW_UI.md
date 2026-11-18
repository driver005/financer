# Pockaw-based Expo UI package

## Reference projects (cloned into `docs/reference/`)

| Project | Upstream | License | Role |
|---|---|---|---|
| Pockaw | https://github.com/layground/pockaw | GPL-3.0 | Primary design base: palette, type scale, spacing, cards, floating nav |
| Dompetku | https://github.com/ilramdhan/dompetku | MIT | Envelopes/Kantong, rollover budgets, invoices, multi-currency, split receipts |
| Boring Balance | https://github.com/Tratt0re/boring_balance | MIT | Double-entry accounting, accounts/valuations, recurring events, compare/breakdown, Excel |
| Jings Finance | https://github.com/IndexDuo/Jings-Finance-App | MIT | Paycheck waterfall, envelopes, plans/projects, day scroller, grouped iOS cards |

The clones are unmodified upstream checkouts kept for reference. `packages/finance-ui` is an original React Native/Expo implementation of the *design language and feature ideas* found in them; no upstream source code, images, fonts or assets were copied into the app.

## Design tokens (`packages/finance-ui/src/tokens.ts`)

- **Colours** — Pockaw's Robin's Egg Blue (`#027E83` primary, `#009FA4` buttons), Electric Violet (`#8E1AB1`), Bird Flower (`#B9A115`), Razzmatazz (`#E50855`), purple/green ramps, neutral 50–950, light `#FDFDFD` / dark `#0E0011`. Plus Jings iOS semantic colours and an 8-colour chart palette.
- **Typography** — Montserrat for UI (Pockaw scale headline1 68 → body5 10), Urbanist for numbers (`numericHeading` 36 → `numericRegular` 12).
- **Spacing** — Pockaw scale 0,2,4,8,12,16,20,24,32,40,48,56.
- **Radius** — 4,8,12 (card), 16 (button), 20,24,32,64, full 999.
- **Themes** — `lightTheme`, `darkTheme`, `FinanceUIProvider`, `useFinanceTheme`.

## Components

`primitives.tsx` — Card, Button, IconButton, Chip, Badge, Text, Money, TextField, Segmented, Progress, Checkbox, SwitchRow, EmptyState, Skeleton, Sheet, Divider, Icon, Box.

`navigation.tsx` — `FloatingBottomNav`: Pockaw's floating pill bar with a centred primary "+" FAB.

`finance.tsx` — BalanceCard (wallet switcher + visibility + cash-flow deltas), CashFlowCard, TransactionTile (54px category icon), CategoryIcon, WalletSwitcher, StatCard, CategoryDonut, DayScroller, Sparkline.

`features.tsx` — PaycheckWaterfall (Jings), EnvelopeList (Dompetku), GoalCard with checklist (Pockaw), BudgetCard with rollover/alerts, RecurringRow (Boring Balance), ObligationRow, ValuationRow, SplitEditor, InvoiceCard, CompareRow, PlanCard.

## Integration

- App import alias: `@finance/ui` → `packages/finance-ui/src/index.ts`.
- Metro watches the package and resolves the alias; `make setup` (and CI) links `packages/finance-ui/node_modules` to the app's `node_modules` for typechecking.
- Demo screen: `apps/mobile/src/app/showcase.tsx` renders the kit in both themes.
- **Integrated screen**: `apps/mobile/src/app/finance.tsx` uses the kit with real persisted state and Rust-backed logic. It replaces the old showcase-only usage of these components:

| Flow | UI component | Persistence | Rust function |
|---|---|---|---|
| Paycheck waterfall allocation | `PaycheckWaterfall` | `paychecks`, `paycheck_allocations` | `paycheck_plan` |
| Envelope / pocket funding | `EnvelopeList` | `envelopes`, `envelope_funding` | — (integer arithmetic in DB) |
| Goal checklist | `GoalCard` | `goal_checklist` | `checklist_status` |
| Rollover budgets | `BudgetCard` | `budgets.rolloverCents` | `rollover_status` |
| Recurring events | `RecurringRow` | `recurring` | `scheduled` |
| Account valuations | `ValuationRow` | `account_valuations` | `valuation_change` |
| Month comparison | `CompareRow` values | `transactions` | `compare_months` |
| Invoices with VAT | `InvoiceCard`, `SplitEditor` | `invoices`, `invoice_items`, `splits` | `invoice_total`, `split_bill` |

Open it from Money tools → "Open finance suite".

## Verification

```sh
cd apps/mobile && npm run typecheck && npm test
npx expo export --platform web --output-dir dist
```
