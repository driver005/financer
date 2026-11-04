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
| mail `logic/`: `format`, `agenda`, `chat`, `compose`, `templates` | about 400 | Rust (`mail_format.rs`, `mail_text.rs`), 9 tests; the package's 38 tests run against it in `sdk-web`. Time zones are Rust's (`jiff` with its bundled IANA database); the device passes a small pack of its language's words (see below) |
| `appLock`, `spendingView`, `onboardingDemo`, `calendarTones`; the stamp of `bankConnections`, `nextHour`; shopping `safeUrl`, `orderProfiles`, `offlineCache`, and the decisions inside `followJob` and `waitForRestart` | about 450 | Rust (`app_lock.rs`, `app_misc.rs`, `shop_*.rs`, `server_config.rs`) |

## Dates, time zones and languages

Formatting a day or a clock "the way the phone's language does" is what `Intl` does in JavaScript, and Rust has no
equivalent in the box. The options were: ICU4X (the Unicode consortium's Rust library; correct for every language, but it
brings the world's locale data, several megabytes of WebAssembly in the one example we found), or splitting the job:

- **Time zones are Rust's.** `jiff` with its bundled copy of the IANA database turns an instant and a zone name into a
  calendar day and a clock, the same on every device and in the tests. Nothing depends on what the phone has installed.
- **The words are the device's.** The screen asks `Intl` once per language for the seven short weekdays, the twelve short
  months, how a clock is laid out (24 hours, or `07:05 AM`), and the ten digits, and hands them in as a small pack
  (`packages/mail/src/logic/format.ts`, about 40 lines). Rust fills in the numbers. A language `Intl` knows works without
  Rust knowing it.

The limit: the order of the parts of a day (`Fri 6 Nov`) is fixed, as it was in the TypeScript code.

## What stays TypeScript, and why

Everything that is a rule is in Rust. What is left asks the phone or waits for something, which only the JavaScript
runtime can do:

- the screens, the navigation tables and the icon and colour tables they read at import time (plain data; the SDK is
  not loaded yet when modules are imported);
- the loops that wait: `followJob`, `waitForRestart`, `loadFeeds`, `applyDraft` and the screens' polling. They `await` the
  network and a timer. The decisions inside them (when to show, when to give up, when the server is back, which weeks
  to fetch) are Rust's; only the `await` is TypeScript;
- the count-up number (`ring.ts`) and the other animation maths: they run on the UI thread as worklets, where the
  native module cannot be called;
- device glue: files, notifications and Notifee (`notifeeSurface`), biometrics, the camera, storage (`savingsGoal`), the
  clock itself and the app's state changes;
- type glue to the UI package (`uiTone`, `asIcon`).
