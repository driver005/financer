# Money tracker — Play Store references

Apps reviewed on **Google Play** (listings and store screenshots opened in a browser):

- **Money Manager Expense & Budget** — Realbyte Inc. — https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree
- **Monefy: Money & Budget App** — Reflective Technologies — https://play.google.com/store/apps/details?id=com.monefy.app.lite
- **Money Tracker – Expense & Budget** — MetaTime Tech — https://play.google.com/store/apps/details?id=com.freeman.moneymanager

## Feature parity — all implemented locally

| Feature from the listings | Where it lives |
|---|---|
| One-tap amount + category entry | `/quickadd` |
| Built-in calculator (`12,50 + 2*3`) | Rust `evaluate`, `/quickadd` |
| Day / Week / Month / Total periods | Money screen, Rust `period_key` |
| Balance / income / expense cards | Money screen, Rust `tx_totals` |
| Donut spending distribution + legend | Money screen (SVG), Rust `category_totals` |
| Category budgets with progress | Money screen, Rust `budget_status` |
| Accounts, balances and transfers | Money screen, `transfer()` |
| Credit/debit card settlement date + outstanding | `/moneytools`, account fields |
| Scheduled / recurring payments with next due date | Money screen + `/moneytools` due soon, Rust `scheduled`, `due_soon` |
| Frequent-expense bookmarks | Money screen, DB `bookmarks` |
| CSV import / export | Money screen, `/export`, Rust `parse_transaction_csv`, `csv_export` |
| Search over transactions | Money screen |
| Passcode lock | Settings + `LockGate`, Rust `pin_hash` |
| Multi-currency with editable rates | `/moneytools`, Rust `convert` |
| Excel-compatible CSV and printable HTML report (save as PDF) | `/reports`, Rust `report_csv`, `report_html` |
| Receipt entry from pasted text | `/moneytools`, Rust `parse_receipt` |
| Bill splitting (equal / by amount / percent) | `/moneytools`, Rust `split_bill` |
| Debt tracking with partial payments | `/moneytools`, Rust `debt_summary` |
| Standing orders | `/moneytools` |
| Local backup / restore | `/moneytools`, `db/backup.ts` |
| Local due-date notifications | `native/notifications.ts`, scheduled from `/moneytools` |
| Quick-add home shortcut / widget config | `plugins/withQuickAddShortcut.js` (Android long-press shortcut → `pantry://quickadd`), deep link handled in `_layout.tsx` |
| Real PDF report export | `/reports`, Rust `report_pdf` (download on web, share sheet on device) |
| Voice / dictation entry | `/quickadd` "Dictate merchant" (browser Web Speech API; typed fallback on phone) |
| Device-to-device backup / sync | `/moneytools` "Share backup to another device" / "Pick backup file from device" via `expo-sharing` + `expo-document-picker` |
| Savings goals with target, progress and target date | `/moneytools`, Rust `goal_status` |
| Subcategories and parent roll-up | `/quickadd`, `/moneytools`, Rust `group_categories` |
| Geo-mapping and hashtags on transactions | `/quickadd`, `/moneytools`, Rust `filter_tag`, `geo_summary` |
| Receipt and warranty tracking | `/moneytools`, Rust `warranty_status` |
| PC-over-Wi-Fi style editing | `/pc` web table editor, reachable from `/moneytools` |
| Full double-entry ledger with balance check | `db/moneyTracker.ts`, Rust `ledger_balance`, `ledger_check` |
| Configurable start-of-period / payday | Settings "Start of month", Money screen period, Rust `period_start_key`, `period_start_shift`, `period_start_label` |
| Real XLSX workbook export | `/reports`, Rust `xlsx_export` (ZIP/XML, no external crate) |
| Ask-the-assistant spending/budget Q&A | `/ask`, Rust `assistant_answer` over local transactions and budgets |
| Two-person shared view via backup import | `/moneytools`, `db/backup.ts` snapshot + Rust `combined_summary` |
| Plaid / GoCardless direct provider pull | Money screen (existing local adapter) |

All of the above stay on-device: notifications are local, the PDF is generated in Rust, dictation uses the browser's own speech engine, and device-to-device transfer uses the OS share sheet instead of a cloud account.

## Design inspiration

- Money Manager: summary cards, Daily/Weekly/Monthly/Total tab strip, donut and charts.
- Monefy: dark canvas, large donut, icon grid for categories, prominent add action.
- Money Tracker: coloured header, category rows with icons, donut and calculator.

The app keeps its own Dribbble-derived food palette; only information architecture and widget types were adopted, not proprietary artwork or branding.
