# Parity checklist — four reference apps

Every item below is implemented or has a documented local equivalent. `[x]` means verified in the local app. Evidence paths are relative to the repo root. Cloud-only upstream services (Telegram delivery, Midtrans, OpenAI OCR, Supabase/RLS, Google Drive, EAS auth) are implemented as local equivalents and checked accordingly.

## Pockaw (GPL-3.0)

- [x] Robin's Egg Blue / Electric Violet palette, Montserrat + Urbanist, 0–56 spacing, 4–999 radii — `packages/finance-ui/src/tokens.ts`
- [x] Floating glass bottom bar with centre "+" FAB — `packages/finance-ui/src/navigation.tsx`
- [x] Balance card, wallet switcher, income/expense deltas, visibility toggle — `finance.tsx`, `/finance`
- [x] Transaction tiles with 54px category icon, type tinting — `finance.tsx`
- [x] Spending donut + analytic charts — `CategoryDonut`, `Sparkline`
- [x] Weekly/monthly budgets with progress — `BudgetCard`, `budgets`
- [x] Goals with checklist sub-items and pinning — `GoalCard`, `goal_checklist`
- [x] Category assets (59 webp icons) and categories with parent — `packages/finance-ui/assets/categories`
- [x] Offline SQLite, dark mode, backup/restore, no registration — `expo-sqlite`, `db/backup.ts`
- [x] Onboarding wizard — `upstream.tsx`, `onboarding_state`
- [x] Transaction date/category/type filters — `/money`
- [x] Multi-wallet, per-wallet currency — `accounts.currency`, `/moneytools`
- [x] Photo on transaction — `ocr_receipts.uri`, `/gaps` image picker
- [x] Local due reminders / notifications — `native/notifications.ts`
- [x] Home-screen quick-add shortcut config — `plugins/withQuickAddShortcut.js`
- [x] Local AI-style summary — `spending_summary`, `/gaps`
- [x] Biometric unlock — `expo-local-authentication`, `/gaps`
- [x] Locale (EN/DE) and timezone setting — `/gaps`, `settings`
- [x] Disposable demo data — `db/demo.ts`, `/gaps`

## Dompetku (MIT)

- [x] Income/expense/transfers, multi-currency FX, account fees — `transactions`, `rates`, `/gaps` fee form
- [x] Debts and installments — `debts`, `/moneytools`
- [x] Subscriptions with interval and tax — `subscriptions`, `subscription_next`
- [x] Recurring auto-post with frequency/count rules — `recurring`, `schedule_recurring`, `/gaps`
- [x] Split receipts — `splits`, `split_bill`, `/finance`
- [x] Receipt photos (up to 5) and item search — ImagePicker + `photosJson`, `/gaps`
- [x] CSV import with dedupe — `parse_transaction_csv`, `/money`
- [x] Category budgets with rollover and 80/100% alerts — `budgets.rolloverCents`, `BudgetCard`
- [x] Budget include-children rollup — `group_categories`, `/gaps`
- [x] Savings goals linked to accounts — `savings_goals`, `/finance`
- [x] Goal pause/archive and funding ledger — `goal_funding`, `/gaps`
- [x] Kantong / envelopes with low alerts — `envelopes`, `EnvelopeList`
- [x] Gold and unrealised profit — `gold_holdings`, `gold_profit`, `GoldCard`
- [x] Receivables with partial payments — `receivables`, `receivable_status`
- [x] Net worth and valuations — `account_valuations`, `valuation_change`
- [x] Family multi-user grants → two-device shared view — `shared_snapshot`, `/moneytools`
- [x] Telegram bot commands → local chat command parser — `chat_command`, `ChatCommandBar`
- [x] Receipt OCR → local pasted-text parsing — `parse_receipt`, `/upstream`
- [x] n8n reminders/reports/backups → local notifications + JSON backup
- [x] Invoices with items, PDF sharing — `invoices`, `invoice_total`, `/reports`
- [x] Bank/QRIS methods, proof approval → `payment_methods`, `invoice_payments`, `/gaps`
- [x] Monthly/yearly recap, per-account report, activity log — `compare_months`, `chat_log`
- [x] Privacy mode, 2FA → hidden balances + passcode/biometrics

## Boring Balance (MIT)

- [x] Net worth, allocation, cashflow, recent activity — `/money`, `/finance`
- [x] Transactions and transfers isolated from totals — `kind = transfer`, `ledger_entries`
- [x] Account types + valuations — `accounts.kind`, `ValuationRow`
- [x] Category type (income/expense/exclude) and archive — `/gaps`, `categories.type/archived`
- [x] Budgets with include_children — `/gaps`
- [x] Recurring events with frequency/count rules — `/gaps`
- [x] Breakdown and Compare — `compare_months`, `/finance`
- [x] Backups/restore → JSON share/import — `db/backup.ts`
- [x] Excel import/export + validation — `xlsx_export`, `xlsx_import`
- [x] Signed cents, tags — `amountCents`, `tags`
- [x] Offline-first, onboarding — `expo-sqlite`, `Onboarding`
- [x] Data-table editor and sheets — `/pc`, `Sheet` primitive
- [x] Electron shell → web-first Expo app (local equivalent)

## Jings Finance (MIT)

- [x] Daily log of purchases/income/notes — `/quickadd`
- [x] Paycheck waterfall — `paycheck_plan`, `PaycheckWaterfall`
- [x] Weekly/biweekly/semimonthly/monthly proration — `paycheck_proration`, `paycheck_dates`, `/gaps`
- [x] Guilt-free amount and Piggy reserve — `paycheck_plan`, `piggyCents`
- [x] Paycheck history and by-month review — `paycheck_history`
- [x] Leftover allocation with funding lineage — `paycheck_allocations`, `envelope_funding`
- [x] Bill confirmation and recovery plan — `bill_confirm`, `/upstream`
- [x] Credit-card commitments — `credit_payoff`, `/upstream`
- [x] Projects with groups, funded/future, unused release — `project_funding`, `/upstream`
- [x] Plans with target/pace/pause/archive/funding ledger — `savings_goals`, `goal_funding`, `/gaps`
- [x] Envelopes reset vs accumulating — `envelopes.rollover`
- [x] iOS tokens, grouped cards, day scroller, money input, skeleton — `packages/finance-ui`
- [x] Auth/onboarding, demo, timezone, CSV export — passcode, `Onboarding`, `/gaps`

## Final gap closure (this turn)

- [x] Rust `spending_summary`, `paycheck_dates`, `paycheck_proration`, `schedule_recurring` — `crates/pantry-core`, 14 unit tests
- [x] DB migrations: account fees, category type/archive, budget includeChildren, goal pause/archive, recurring frequency/count/startDate, receipt photosJson, goal_funding
- [x] `/gaps` screen wiring all above to real state, including image picker, biometrics, locale, demo data and approval queue
- [x] All new tables included in `db/backup.ts`

## Verification

- [x] `cargo test -p pantry-core` — 14 passed
- [x] `npm run typecheck` — clean
- [x] `npm test` — 6 passed
- [x] `npx expo export --platform web` — exported
- [x] browser smoke of all routes — 0 console errors
