# Feature parity map — four reference apps

Repositories cloned unmodified into `docs/reference/`. Every row below is either implemented in the local app (`apps/mobile`) or given an explicit local-only equivalent. "Local equivalent" means the same workflow without a cloud service.

## Pockaw (GPL-3.0)

| Upstream feature | Status / evidence |
|---|---|
| Robin's Egg Blue / Electric Violet palette, Montserrat + Urbanist, 0–56 spacing, 4–999 radii | Implemented in `packages/finance-ui/src/tokens.ts` |
| Floating glass bottom bar with centre "+" FAB | `packages/finance-ui/src/navigation.tsx` |
| Balance card, wallet switcher, income/expense deltas, visibility toggle | `finance.tsx` `BalanceCard`; `/finance` |
| Transaction tiles with 54px category icon, type tinting | `finance.tsx` `TransactionTile` |
| Spending donut + analytic charts | `CategoryDonut`, `Sparkline`; `/finance`, `/money` |
| Weekly/monthly budgets with progress and top transactions | `BudgetCard` + `budgets`; `/finance`, `/moneytools` |
| Goals with checklist sub-items and pinning | `GoalCard` + `goal_checklist`; `/finance` |
| Category assets (webp) and custom categories with parent | 59 webp icons in `packages/finance-ui/assets/categories`; `CategoryAssetIcon`; `categories` table |
| Offline Drift/SQLite, dark mode, backup/restore, no registration | `expo-sqlite`, `lightTheme`/`darkTheme`, `db/backup.ts`, no auth |
| Onboarding / get-started wizard | `upstream.tsx` uses `Onboarding` + `onboarding_state` |
| Transaction date/category/type filters | `/money` search + category charts |
| Multi-wallet, per-wallet currency | `accounts` + `currency`; `/moneytools` |
| Photo on transaction | Local equivalent: `ocr_receipts.uri` (image path kept on device) |
| Planned reminders, notifications, i18n, biometrics, AI summaries, home widget | Not in upstream release either (README "planned"); local equivalents: local due notifications, no cloud |

## Dompetku (MIT)

| Upstream feature | Status / evidence |
|---|---|
| Income / expense / transfers, IDR+USD with FX, account fees | `transactions` kind + `rates` + `accounts`; `/moneytools` |
| Debts and installments | `debts`, partial payments; `/moneytools` |
| Subscriptions with interval and tax | `subscriptions` + `subscription_next`; `/upstream` |
| Recurring auto-post | `recurring` + `scheduled`; `/money`, `/finance` |
| Split receipts | `splits` + `split_bill`; `/finance` |
| Receipt photos (up to 5) and item search | Local equivalent: `ocr_receipts` + `parse_receipt`; `/upstream` |
| CSV import with preview/dedupe | `parse_transaction_csv` + `saveTransactions`; `/money` |
| Per-category budgets with rollover and 80/100% alerts | `budgets.rolloverCents` + `rollover_status` + `BudgetCard`; `/finance` |
| Savings goals linked to accounts | `savings_goals` + accounts; `/finance`, `/moneytools` |
| Kantong / envelope budgeting with low alerts | `envelopes`, `envelope_funding`, `EnvelopeList`; `/finance` |
| Gold (Antam/XAU) and unrealised profit | `gold_holdings` + `gold_profit` + `GoldCard`; `/upstream` |
| Receivables with partial payments | `receivables` + `receivable_status`; `/upstream` |
| Net worth | `accounts` + `account_valuations` + `valuation_change`; `/finance` |
| Family multi-user with grants | Offline equivalent: `shared_snapshot` two-device view; `/moneytools` |
| Telegram bot commands / chat entry | Local equivalent: `ChatCommandBar` + `chat_command` + `chat_log`; `/upstream` |
| Receipt OCR via OpenAI-compatible API | Local equivalent: pasted receipt text parsed by `parse_receipt`; no cloud |
| n8n reminders/reports/backups | Local equivalent: local notifications + JSON backup |
| Invoices with items, public link, PDF print | `invoices`, `invoice_items`, `invoice_total`, `InvoiceCard`, PDF export; `/finance`, `/reports` |
| Bank/QRIS methods, proof upload, approval queue, Midtrans gateway | Local equivalent: `payment_methods`, `invoice_payments`, `PaymentProofRow`; no gateway |
| Monthly/yearly recap, per-account report, reconciliation, activity log | `compare_months`, `account_valuations`, `chat_log`; `/finance`, `/reports` |
| Privacy mode, 2FA, Sentry, PWA, ID/EN | Local equivalents: hidden balances toggle, passcode, no telemetry; single locale |

## Boring Balance (MIT)

| Upstream feature | Status / evidence |
|---|---|
| Net worth, allocation, monthly cashflow, recent activity | `/money`, `/finance` (`StatCard`, `BalanceCard`) |
| Transactions and transfers (transfers isolated from totals) | `transactions.kind = transfer`, `ledger_entries`; `/moneytools` |
| Accounts (cash/bank/savings/brokerage/crypto/credit) + valuations | `accounts.kind`, `account_valuations`, `ValuationRow`; `/finance` |
| Categories hierarchical, income/expense/exclude, archivable | `categories` parent; subcategory column; `/moneytools` |
| Budgets with include_children | `budgets`, `rollover_status`, `group_categories`; `/finance` |
| Recurring events with frequency/interval/count rules | `recurring` + `scheduled`; `/finance` |
| Breakdown & Compare (month-over-month, category trends) | `compare_months`; `/finance` |
| Backups/restore with retention, external folder sync | `db/backup.ts` share/import; no external folder automation |
| Excel import/export + template validation | `xlsx_export`, `xlsx_import`, `ExcelImportCard`; `/reports`, `/upstream` |
| Signed cents, cents-based models, tags | `amountCents`, `tags`; Rust arithmetic everywhere |
| Offline-first, i18n locales, onboarding | `expo-sqlite`, `Onboarding`; single locale |
| Electron shell, command palette, data-table, sheets | Web-first Expo app; `/pc` table editor, `Sheet` primitive |

## Jings Finance (MIT)

| Upstream feature | Status / evidence |
|---|---|
| Log daily purchases/income/bill payments/notes | `/quickadd`, `/money` |
| Paycheck waterfall (fixed → envelopes → plans → invest → leftover) | `paycheck_plan`, `paychecks`, `paycheck_allocations`, `PaycheckWaterfall`; `/finance` |
| Weekly/biweekly/semimonthly/monthly proration | Local equivalent: percentage-based rules in `/finance`; no multi-frequency scheduler |
| Guilt-free amount, Piggy reserve, investment suggestion | `paycheck_plan` leftover; `envelopes`; `PlanCard` |
| Paycheck history and by-month review | `paycheck_history`; `/finance` badges |
| Leftover allocation with funding lineage | `paycheck_allocations` + `envelope_funding` |
| Bill confirmation; overage becomes recovery plan | `bill_confirm`, `bill_confirmations`, `BillConfirmationCard`; `/upstream` |
| Credit-card commitments and checking recovery | `credit_commitments`, `credit_payoff`, `CreditCommitmentCard`; `/upstream` |
| Projects with groups, funded vs future purchases, release unused | `project_groups`, `projects`, `project_purchases`, `project_funding`, `ProjectCard`; `/upstream` |
| Plans (target/date/pace, pause/archive, funding ledger) | `savings_goals`, `goals`, `PlanCard`; `/finance`, `/moneytools` |
| Envelopes with reset vs accumulating rollover | `envelopes.rollover`, `EnvelopeList`; `/finance` |
| iOS tokens, grouped cards, day scroller, money input, skeleton | `packages/finance-ui/src/tokens.ts`, `primitives.tsx`, `finance.tsx` |
| Auth/onboarding, disposable demo, timezone, CSV export | Local equivalent: passcode, `Onboarding`, CSV/JSON export; no auth server |

## Notes on literal cloud/BaaS features

Telegram delivery, Midtrans payments, OpenAI OCR, Supabase/RLS, Google Drive sync and EAS cloud auth cannot run in a single offline app without credentials or a server. Each has a local equivalent above (chat-command parser, payment proof queue, pasted receipt parsing, JSON backup/import, passcode). No user credential was required to implement these equivalents.
