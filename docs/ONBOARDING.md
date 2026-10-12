# First-run setup (onboarding)

A short, skippable walk-through that shows on the first start and can be replayed from
**Settings > Setup > Replay setup**. Route: `apps/mobile/src/app/onboarding.tsx` (a hidden tab
without a tab bar). One question per screen, a thin progress bar with a back button (a close button
on the first step), the pig mascot reacting with a speech bubble, and a footer with the main button
and a **Skip**. Nothing blocks leaving: Skip moves on, the close button on step 1 ends the setup, and
the Android back button steps back.

## Design references

These come from published write-ups of how other apps do it. **Mobbin itself could not be reached
from the sandbox, so none of this was checked against Mobbin screens.**

* Duolingo: mascot and one clear promise first, one question per screen under a thin progress bar,
  the mascot reacts to each answer, try the product before creating an account, a daily commitment
  with named intensity levels (casual, regular, serious), notification permission only after the
  benefit is explained, the account step last, then a celebration.
* Revolut, Monzo, Chime: plain-language "why we ask" under sensitive questions, security wording,
  a clear "I'm new / I already have a server" split, micro-steps with progress, and early value (a
  demo dashboard) before any bank link.

## The steps

| # | Step | What it does |
|---|------|--------------|
| 1 | Welcome | Promise "Know what you can spend and what to buy". *Get started*, or *I already have a server* (jumps to step 2 with "My own server" chosen). |
| 2 | Where should your data live? | *Compact: on this phone* (the Rust backend inside the app; only enabled when `embeddedAvailable`, otherwise disabled with "This build talks to a server") or *My own server* (address + token, tested with the same health check and token check as Settings, then saved with the existing `save` / `setMode`). Two plain sentences on the trade-off for each. |
| 3 | Who do you shop for? | Household size (1 to 8), grocery budget per week or month, stores (Lidl, Aldi, Kaufland, Rewe, multi-select), optional 5-digit postal code. |
| 4 | Money rhythm | Payday (`PaydayPicker`), then a savings level: **Casual / Regular / Serious**. The level sets a daily grocery allowance suggestion you can edit; the mascot reacts and the screen shows the resulting daily number and the budget period it is spread over (`budgetPeriod`, `periodDays`, `dailyAllowanceOn`). |
| 5 | How should I learn what you buy? | The three existing `habit_mode` values: *My own list* (`manual`), *Receipts* (`receipts`, photo or pasted digital receipt), *Spending only* (`spending`). |
| 6 | Connect your money | All optional. Bank sync (explains the FinTS product ID and the PIN; opens the existing sync screen), CSV import (existing `importCsv`), or *Try with demo data*. |
| 7 | Small safety and nudges | App lock (existing `native/appLock.ts`) and the three notification kinds, with the system permission prompt shown only here, after they are explained (`native/notifications.ts`). **Not part of the web build**: the step is left out of the list there. |
| 8 | Finish | Confetti (Reanimated, skipped when the device asks for reduced motion), a success haptic, a recap of the answers, and the first quest: *Plan this week* (`/mealplan`) when bookings exist, otherwise *Add your first transaction* (`/spending`). |

### The daily allowance

`suggestAllowance` in `src/onboarding.ts`. The starting point is the entered grocery budget spread
over an average month (365/12 days), or, without a budget, 6,50 EUR per day for one person plus 85%
of that for each further person (a round planning figure, not a statistic). Casual keeps 100%, Regular
85%, Serious 70%; the result is rounded to 10 cents and never below 1 EUR. The value you finally
keep is turned into the groceries envelope as `daily x days in the current budget period`, so the
Today screen (`dailyAllowanceOn`) shows exactly that number back.

### What is written where

* **Backend (existing API):** `payday` and `habit_mode` through `PUT /v1/settings`, the groceries
  limit through `PUT /v1/budget/envelopes` (the other envelopes are kept). Only questions you
  answered are written. This happens on the last step (and before loading demo data), with a retry
  button if it fails; with no backend connected the recap says so.
* **Connection:** the existing keys `financer.api-config` and `financer.backend-mode`.
* **App lock / notifications:** their own existing keys (`financer.app-lock`,
  `financer.notify.prefs`).
* **Setup state** (`native/onboardingStore.ts`), in the same storage as the rest of the app
  (secure storage on a phone, `localStorage` in the browser):
  * `financer.onboarding.state`: `{ v, step, draft }`, saved after every change, deleted when the setup ends. This is what makes a killed app resume at the same step.
  * `financer.onboarding.done`: `"1"` once the setup was finished or closed.
  * `financer.profile`: household size, stores and postal code. The server has no field for them,
    so they are kept on the device after the setup ends. **Nothing reads them yet**: today's price
    sources cover whole chains, so the postal code and the stores do not change any number.

## When it shows

`OnboardingGate` (rendered once in `_layout.tsx`) asks `entryAction` (pure, tested) once per app
start:

* flag set: never show it;
* setup started and not finished: resume it, even if the connection was saved on the way;
* nothing stored and a server or the on-phone mode is already configured (an existing user): set the
  flag silently, show nothing;
* otherwise: go to the setup.

It acts once per start, so opening the bank sync from step 6 does not pull you back. **Replay setup**
clears the flag, writes a fresh state and opens the route; the data step then starts from what the
app is set up with now.

## Demo data

*Try with demo data* imports about four months of invented bookings through the existing
`POST /v1/import` (`src/onboardingDemo.ts`): a salary on your payday (so income is recognised as
recurring), rent, a streaming subscription, a transit pass and grocery trips at your stores.

* Every booking's counterparty starts with `[DEMO]` and its purpose says it is demo data.
* Only bookings are sent. `/v1/import` replaces the budget and the usual-items list when the file has
  any, which belong to you, so the demo file leaves them empty.
* It is only offered while the backend has **no bookings at all** (`demoGate`), so it never mixes
  with real data without you knowing. Importing a CSV after loading demo data warns first.
* **Known gap: it is not removable yet.** The API has no endpoint to delete bookings (only
  receipts, rules and splits can be deleted), and the setup is TypeScript-only. The demo bookings
  can be recognised (`isDemoBooking`) and the confirmation says they stay until you start with an
  empty database. A `DELETE` for bookings in the backend is the follow-up that would make this
  button reversible.

## Tests and what was not tested

* `apps/mobile/tests/onboarding.test.ts` and `onboardingDemo.test.ts` (`npm test`): step order and
  which steps exist per build, progress, stored-state parsing, validation (postal code, budget,
  server address), the savings levels, applying the answers against a fake API, the mascot lines,
  the recap, the first quest, the profile merge, the redirect decision, and the demo set.
* The screens were built to a static web bundle (`expo export --platform web`) and walked through in
  headless Chromium against a mocked backend, light and dark, at 320, 390 and 1280 px wide: redirect
  on first run, every step, resume after a reload, the connection test, demo loading, the settings and
  envelope writes, finish, no redirect afterwards, the silent flag for an existing user, replay and
  close.
* **Never run on a phone or an emulator.** Not exercised: the app lock and notification permission
  prompts (they do not exist on the web), the on-phone backend choice, haptics, keyboard avoidance on
  iOS and Android, the hardware back button, the bank sync hand-off, a real server, a real CSV file.
