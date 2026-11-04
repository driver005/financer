# App logic in Rust

The rules the screens used to compute in TypeScript move to `crates/logic` (`financer-logic`), one module at a
time. The screens stay React (Expo needs it), but they ask Rust: how an amount is written, which budget period a
day is in, how the cards put the server's numbers into words, how a streak and its freezes are replayed.

```
screen (TSX)  ->  apps/mobile/src/<module>.ts   typed entries: one line per function, no rules
                      |  logic("game.streak_state", { ... })       packages/wire/src/logic.ts
                      v
                  Rust `logic(name, args_json) -> json`            crates/sdk/src/logic.rs  (UniFFI, synchronous)
                      v
                  financer_logic::call                             crates/logic
```

- **Pure.** Every function takes plain data and returns plain data; no clock, no I/O. A function that needs
  today's date is given it (the device's clock stays in TypeScript: `localIsoDate`).
- **Same wire shapes.** Arguments and answers are JSON in the shapes the screens already hold (`snake_case` from the
  server, `camelCase` for the view types), so a screen changes by an import, not by its code.
- **Built once for every platform.** The crate compiles natively and to WebAssembly (it depends only on `serde`,
  `time` and `financer-core`), so the web app, the phones and the server see the same rules. `BudgetPeriod`
  is the server's own type: the phone no longer has a second copy of it.
- **Loaded before the first screen.** `SdkGate` (in the root layout) waits for the SDK, because screens ask while they
  draw. Without the SDK a call fails with a message that says so.

## Where the tests are

The Rust tests (`cargo test -p financer-logic`) are the old TypeScript tests for `format`, `period`,
`safeToSpend` and `forecast`, moved with the code. The TypeScript tests of `game.ts` (and of the modules that call
`game`, `period` or `format`: calendar, onboarding, notification plan, …) stay and **now run against the Rust
code**: `apps/mobile/tests/run.mjs` loads the real WebAssembly module into every test process
(`tests/preload.mjs`), so those tests prove the Rust implementation, and the wrapper, behave as the TypeScript did.
CI runs them in the `sdk-web` job, which has the bindings.

## What is moved

| Module | Lines of TypeScript before | Now |
|---|---|---|
| `format` (money, dates, euro input) | 76 | Rust, 35 tests |
| `period` (budget periods, labels) | 79 | Rust on `financer-core`'s `BudgetPeriod` |
| `safeToSpend` (card wording) | 75 | Rust |
| `forecast` (card wording) | 151 | Rust |
| `game` (streaks, freezes, badges, XP, mascot) | 501 | Rust; TypeScript tests kept as the specification |
| `calendar` (dates, series, day layout, quick-add sentences) | 468 | Rust, 8 tests; the TypeScript calendar tests (241 lines) run against it |
| `stores` (Stores screen wording) | 110 | Rust, 6 tests |
| `watchdog` (subscriptions and alerts wording, week grouping) | 180 | Rust, 7 tests |
| `rules` (rule form, split sheet) | 148 | Rust, 4 tests |
| `settingsPlan` (summaries, connection status, IBAN/BLZ hints) | 120 | Rust, 4 tests |
| `backupPlan` (schedule, file names, retention, passphrase) | 105 | Rust, 5 tests |
| `groceryView` (avatar tones, price ranking, summary) | 142 | Rust, 5 tests |
| `mealplan` (weeks, plan entries, ticks, budget wording) | 280 | Rust, 6 tests |
| `scan` (barcode check, result rows, headline) | 204 | Rust, 4 tests; the camera's repeat-read gate stays beside the camera |
| `notifyPlan`: evening message, payday reminder, price drops | about 200 of 279 | Rust; the calendar event reminders stay beside `calendar` until that is moved |

## What is not moved yet

The rest of `apps/mobile/src/*.ts` (about 2,300 lines: `onboarding`, `calendarView`/`calendarFeeds`/`calendarForm`, `mealplan`,
`receiptSources`, `serverConfig`, `rules`, `scan`, `groceryView`, `stores`, `watchdog`, `todayCharts`, …), the shopping
module's `logic/` (`weights`, `schemaEdit`, `view`, `progress`, …) and the mail module's `logic/`. They follow the
same recipe: write the function in `crates/logic`, add its name to `financer_logic::call`, replace the body in
TypeScript by a `logic(...)` entry, keep the TypeScript test (it then tests Rust) or move it to Rust.

Judged to stay TypeScript: per-frame animation maths (`ring`: a WebAssembly call per frame costs more than it saves), a plain array filter (`spendingView`) and device storage (`savingsGoal`).

What stays TypeScript for good: the screens, and everything that asks the device (files, notifications,
biometrics, background tasks, the clock).
