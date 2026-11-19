# Finanzguru – Finance Manager parity

Target: https://play.google.com/store/apps/details?id=de.dwins.financeguru (dwins GmbH, 1M+ downloads, 4.4★).
Feature list taken from the Play Store "About this app" text and https://finanzguru.de/ (Nov 2026).

## Research evidence

Listing and screenshots fetched from `play-lh.googleusercontent.com`, saved as
`/home/default/finanzguru-ref/shot1.jpg` … `shot4.jpg`. Dominant colours sampled
directly from the store images with Pillow:

| Colour | Sample | Use |
| --- | --- | --- |
| Deep indigo | `#3C318F` | hero / onboarding / app primary |
| Off-white canvas | `#F2F1F6` | screen background |
| White | `#FFFFFF` | cards, chips |
| Navy ink | `#2A2166` | headings, amounts |
| Mint | `#C9F2DC` | category pills, progress |
| Violet | `#7B3FE4` | Plus badge, saving tips |

## Store screens reproduced

| Store screenshot | Local route | What matches |
| --- | --- | --- |
| shot1 – Overview | `/home` | Overview title, purple Statistics card, budget dial row + `Show all`, Accounts, Investments, 5-tab bar |
| shot4 – Contracts | `/contracts` | `Ø … € / month` card with `Insights`, `2 money-saving tips`, `Sort by cycle`, monthly total, merchant rows |
| shot3 – Automatically categorised | `/categorised` | Floating Living / Leisure / Food & Drinks chips, merchant list with mint category pills and checks |
| shot2 – Connect accounts | `/connect` | Full indigo hero, bold white `Connect accounts` headline, six floating white bank-logo circles |

Bottom tabs match Finanzguru: **Overview, Contracts, Insights, Insurance, Savings Booster**.

## Full Play Store feature list → local implementation

| Store feature | Local route / implementation | Data source |
| --- | --- | --- |
| All bank, investment and insurance accounts in one app | `/home` Accounts + Investments, `/connect` | SQLite `accounts`, `gold` |
| Income & expenses, statistics, money left until payday | `/home` Statistics card, `/insights` | `allTransactions` + `core.txTotals` |
| Automatic contract detection, contract folder, subscriptions | `/contracts`, `/obligations` | `recurringList`, `subscriptions`, `debts`, `receivables` |
| Free cancellation of contracts & insurance | `/contracts` row → cancellation-letter sheet | local printable HTML, no network |
| Smart budgets / disposable income | `/budgets`, `/insights` | `budgets` + `core.budgetStatus` |
| Helpful spending insights, trends, saving opportunities | `/insights`, `/gaps` | `core.compareMonths`, `core.categoryTotals` |
| Insurance overview, needs analysis, coverage gaps, advice | `/insurance` | local policies + coverage checklist, `/ask` |
| AI companion — any question, answers from real bookings | `/ask` | `core.assistant` on `allTransactions` |
| Savings Booster — cashback points, retirement depot, 7 % bonus | `/savings` | transactions at matched stores, goals, local reserve setting |
| Automatic categorisation | `/categorised` | real merchants from `allTransactions`, editable via `updateTransaction` |
| Connect 4,000+ banks | `/connect` | local adapter: 12 searchable banks, `addAccount` |
| German banking-grade data privacy | local-first SQLite, no cloud login anywhere | on-device only |

The three previously unrelated tab targets (`/reports`, `/obligations`, `/goals`)
are preserved and reachable from the All apps hub, but the visible tabs now open
purpose-built Finanzguru screens.

## Single design system

One UI kit only: `packages/finance-ui`. Store-screen components live in
`src/finanzguru.tsx` and share tokens with every other screen.
`apps/mobile/src/ui/primitives.tsx` and `theme.ts` are thin compatibility shims.
Primary app colour: dark purple `#3C318F`.

Real-data loaders for the new screens: `apps/mobile/src/lib/finanzguru.ts`.

## Store screenshot coverage (all 8)

| Screenshot | Headline | Local screen |
| --- | --- | --- |
| shot1 | Full control of your finances | `/home` Overview |
| shot2 | Connect accounts | `/connect` |
| shot3 | Automatically categorised | `/categorised` |
| shot4 | All contracts at a glance | `/contracts` |
| shot5 | Cancel & save money | `/contracts` cancellation sheet + `Cancelled!` status |
| shot6 | Budgets under control | `/budgets` monthly bars + budget cards |
| shot7 | Cashback on expenses | `/savings` points → euro, vouchers, savings potential |
| shot8 | Look into the future | `/transactions` dated groups, cashback pills, forecast balance |

Help-center flow inventory (hilfe.finanzguru.de): login/registration, bank
connection, account management, booking edits/refunds/forecasts, statistics,
budgets, analyses, contracts (create/edit/cancel/split), insurance, transfers,
account/Plus settings, Sparbooster, security, general info and Split. Every
flow has a local equivalent in the same purple kit:

| Help-center flow | Local screen | Writes |
| --- | --- | --- |
| Transfers | `/flows` → Transfer | `transfer()` updates both account balances and creates two ledger legs |
| Refunds | `/flows` → Refund | new income transaction + ledger + balance |
| Rebookings / category edits | `/flows` → Rebook | `updateTransaction()` |
| Split a bill | `/flows` → Split | Rust `core.splitBill` (equal / by amount / by %) |
| Forecasts | `/transactions`, `/insights` | Rust `core.forecast`, `core.compareMonths` |
| Contract split & cancellation | `/contracts`, `/obligations` | local cancellation letter + status |
| Language, timezone, payday, biometrics, Plus, promo code | `/flows` → Plus | SQLite `settings` table |
| Advanced settings / security | `/settings`, `/gaps` | passcode hash, bank config, locale |

Fix applied while verifying: the legacy `transfer()` reused one `externalId`
for both ledger legs, violating the `UNIQUE(source, externalId)` constraint;
each leg now has its own id.

## Limitations (honest parity boundaries)

- **Bank connection has four adapters.** `/connect` → Demo banks uses 12 local
  examples with no network. `/connect` → Plaid uses the native Link SDK v13
  (development build only) with a runtime-configured backend that creates the
  link_token and exchanges the public_token. `/connect` → Custom API posts to
  any HTTPS bank-data backend (TrueLayer, Tink, Yapily or self-hosted) and
  imports the accounts and transactions it returns. `/connect` → Real PSD2 implements the GoCardless
  Bank Account Data API v2 (`/token/new/`, `/institutions/`, `/requisitions/`,
  account details and booked transactions), with credentials entered at runtime
  and stored in SecureStore (localStorage on web). Bank login opens in a secure
  in-app browser and imported transactions are written to local SQLite.
  GoCardless stopped accepting **new** Bank Account Data signups in July 2025,
  so an existing provider account (or an API-compatible alternative) is required.
  Without valid credentials the UI reports the provider's 401 error. No keys are
  bundled in the app.
- **Cancellation can be downloaded or sent.** `/contracts` offers a printable
  HTML letter plus runtime-configurable delivery: email through Expo Mail
  Composer (user confirms in their mail app, `mailto:` on web), SMS via the
  native composer, or an HTTPS webhook with bearer token. The letter is stored
  locally and marked `Cancelled!` after handoff. The user remains responsible
  for checking the provider address and notice period.
- **Savings Booster points, vouchers and the 7 % bonus are local simulations**
  computed from the user's own transactions, goals and offers. No cashback is
  actually earned and no retirement product is opened.
- **Insurance coverage checks are heuristic** (keyword matching on local
  policies), not an underwriting assessment.
- **Savings potential is an estimate** (5 % of tracked 12-month spending), not a
  guarantee.

Stitch reference project: `17031347711862038285` ("Finanzguru parity screens").
