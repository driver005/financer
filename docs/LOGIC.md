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
| `onboarding` (steps, answers, allowance, mascot, recap, entry rule) | 456 | Rust, 10 tests; the TypeScript onboarding tests run against it |
| `serverConfig` (server settings form, what is sent, wording) | 383 | Rust, 5 tests; the restart wait (a poll and a clock) stays |
| `receiptSources` (names, status, times, setup steps, Lidl callback) | 303 | Rust, 3 tests; the shop guides (plain content) stay |
| `bankConnections` (state, labels, schedule wording, Plaid link check) | 169 | Rust, 2 tests; the time-zone stamp stays |
| `calendarFeeds` (payday, charges, meals, contract ends) | 115 | Rust, 3 tests; fetching the feeds stays |
| `calendarView` (ranges, steps, month cells, day columns, schedule days) | 186 | Rust, 3 tests; the tap handlers are attached in TypeScript |
| `calendarForm` (event draft, moves, repeat, problems, request) | 173 | Rust, 5 tests; the clock-reading `nextHour` stays |
| `charts`, `todayCharts` (trend, curve, week, shares and their sentences) | 311 | Rust, 5 tests |
| shopping `logic/`: `format`, `weights`, `schemaEdit`, `view`, `progress` (model and throttle), `library`, `profiles`, `runs`, `searchPlan`, `sources`, `dealNotifications` | about 1,000 | Rust (`shop_*.rs`), 17 + 8 tests; the package's own 71 tests run against it in the `sdk-web` job |

## What is not moved

Everything below stays TypeScript on purpose, or because the rule is the device's, not the app's:

- the mail module's `logic/` (`agenda`, `chat`, `compose`, `format`, `templates`): its days, clocks and chat rows are
  written by the device's `Intl` in the device's language and time zone, which Rust does not have; the few rules that
  do not depend on it (`compose`, `templates`) are too small to carry a second test setup;
- the polling loop `followJob`, the waits (`waitForRestart`), the fetching of feeds (`loadFeeds`), the apply step of the
  setup (`applyDraft`): they hold the network, a clock or a callback, not a rule;
- `formatStamp` and `nextHour` (the device's time zone and clock), `safeUrl` (the platform's URL parser) and
  `orderProfiles` (sorts the way the device's language does);
- the shopping `notifeeSurface` and `offlineCache`, and `calendarTones`, `onboardingDemo` (device glue and plain data).

Judged to stay TypeScript: per-frame animation maths (`ring`: a WebAssembly call per frame costs more than it saves), a plain array filter (`spendingView`) and device storage (`savingsGoal`).

What stays TypeScript for good: the screens, and everything that asks the device (files, notifications,
biometrics, background tasks, the clock).
