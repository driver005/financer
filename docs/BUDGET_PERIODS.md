# Budget periods and "safe to spend today"

## Payday

`payday` is a setting (day of month, 1 to 28, default 1) stored in the existing key/value
`settings` table, so there is no migration. `PUT /v1/settings {"payday": 25}` changes it (anything
outside 1 to 28 is a 400), `GET /v1/settings` returns it.

`BudgetPeriod` (`crates/core/src/period.rs`) maps a date to its period, both ends inclusive:
payday 25 gives 25 Sep to 24 Oct for any day in that range. Payday 1 is the calendar month. The core
also clamps a payday above the month's length to its last day (so 31 means "last day of the
month"), which keeps the periods gap-free even for hand-edited data; the API never stores such a
value.

Every place that used a calendar month now uses the period: the envelope status, spent-by-category,
and the "what can I buy" groceries budget.

`GET /v1/budget[?period=current|previous][&date=YYYY-MM-DD]` is the one answer for the budget:

* `period`: payday, start, end, length and days left, for the running period (default) or the one
  before it. `date` is the day to treat as today; the period is the one that contains it (a month
  with payday 1; with payday 10, `date=2026-03-20` is the period 10 Mar to 9 Apr).
* `envelopes`: every envelope with its limit, what was spent in that period and what is left.
* `safe_to_spend`: the daily number below, only for the running period.
* `disposable`: monthly income minus fixed costs, from the recurring payments.

`PUT /v1/budget/envelopes` replaces the limits and answers with the envelopes of the running period.

The app passes its own local date as `date`, so the late evening is not already "tomorrow" in UTC.

## Safe to spend

`safe_to_spend` of `GET /v1/budget`. The formula is documented at the top of
`crates/core/src/safe_to_spend.rs`:

```
income            = recurring income booked so far in the period + recurring income still expected
spent_so_far      = everything spent in the period up to today
fixed_costs_due   = recurring payments still to come until the period ends
envelope_headroom = sum over envelopes of max(0, limit - spent - fixed costs due in that category)

available = income - spent_so_far - fixed_costs_due - envelope_headroom
daily     = max(0, available) / days_left      (cents, rounded down, today counts as a day)
```

The response carries every term, so the app can explain the number. `pace` compares the spending
that is not an already-paid fixed cost with a straight-line share of what is left after fixed
costs: `on_track`, `over_pace`, or `unknown` when no recurring income was detected.

## What is verified and what is not

* Verified by tests: the period arithmetic (payday 1, 25, 31, leap years, year end, gap-free
  tiling), the formula and its edge cases (no income, overspent and overlapping envelopes, stopped
  subscriptions, weekly repeats, last day), settings validation, and the endpoints through the
  real router on SQLite. The TypeScript copy of the period rule has the same cases as the Rust
  tests.
* Not verified: the screens (Today card and explainer sheet, payday picker in Settings, period
  labels on the Budget screen) typecheck but were never run on a device, an emulator or in a
  browser.
* Limits of the estimate: there is no bank balance in the model, so it is a budget view. It relies
  on recurring-payment detection (three similar bookings on a steady rhythm); a salary that is not
  detected means "no income found" and a daily number of 0. A recurring payment more than half a
  cadence overdue is treated as stopped. With payday 1 and a salary on the 28th, the whole
  salary counts for the month although it has not arrived yet; a payday that matches the salary
  day avoids that.
