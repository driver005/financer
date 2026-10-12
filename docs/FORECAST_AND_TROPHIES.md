# End-of-period forecast and trophies

Both features build on the payday-based budget period (see [BUDGET_PERIODS.md](BUDGET_PERIODS.md)).
Neither stores anything new: no migration, no counters. Everything is computed from the bookings,
the detected recurring payments and the envelope limits you have right now.

## End-of-period forecast

`GET /v1/forecast[?date=YYYY-MM-DD]`, logic in `crates/core/src/forecast.rs`, card on the Today
screen. Amounts are integer cents.

```
income             = recurring income booked so far + recurring income still expected
spent_so_far       = everything spent in the period up to and including today
fixed_costs_due    = recurring payments still to come until the period ends
pace               = spending that is not an already-paid fixed cost / days so far
                     (groceries and everything else, each as a plain daily average)
projected_leftover = income - spent_so_far - fixed_costs_due - pace * days after today
```

* **Grocery run-out.** With a groceries envelope, the budget runs out on the first day `today + k`
  where `groceries_spent + k * grocery_pace >= limit`. The date is only reported when it is before the
  last day of the period. If the limit is already used up, the day it was crossed is reported and
  `grocery_exhausted` is true. No limit or no grocery spending yet: no date.
* **Warning level and reason** (first match wins):

  | reason                | level  | when |
  |-----------------------|--------|------|
  | `no_data`             | ok     | no booking up to today |
  | `no_income`           | ok     | no recurring income found, nothing to compare with |
  | `projected_shortfall` | danger | `projected_leftover < 0` |
  | `income_overdue`      | watch  | expected income is past its date and not booked |
  | `groceries_run_out`   | watch  | grocery budget runs out (or is used up) before the period ends |
  | `thin_margin`         | watch  | leftover below 5% of the income |
  | `income_pending`      | ok     | the projection counts on income that has not arrived yet |
  | `on_track`            | ok     | none of the above |

* **Early in a period.** With fewer than 4 days gone (`early`), the pace is a guess: a shortfall is
  only `watch`, unless income minus spending so far minus fixed costs is already negative.
* The Today card shows the projected leftover, the level as a short label, the reason in plain
  language, the run-out date and, in small print, the sum behind the number.

Limits: it is a budget view, not a bank balance. It depends on recurring-payment detection (three
similar bookings on a steady rhythm); a salary that is not detected means `no_income` and no verdict.
The pace is a flat average, so a one-off purchase early in the period pulls the projection down for
the whole period, and irregular income is not predicted. Bookings dated after today are ignored.
Split transactions are not expanded (same as the safe-to-spend number).

## Trophies

Logic in `apps/mobile/src/game.ts`, shown as a card on Today and on a route `/trophies` that is not
a tab (link from the card). The game still has no stored state: the functions replay the bookings
day by day (at most the last 1100 days), so editing or re-importing bookings changes the result with
them. The only thing kept on the device is the "already celebrated" list of badge ids (to show a toast
once) and the optional savings goal.

### Streak freezes

A day is *met* when grocery spending is within that day's allowance (the groceries limit over the days
of the budget period the day belongs to). Replaying from the first booking:

* met day: the streak grows by one; every 7th day of a streak earns a freeze, at most 2 in stock
  (an extra one is lost);
* missed day with a freeze in stock: the freeze is used automatically, the streak stays as it was and
  the missed day does not count;
* missed day without a freeze: the streak restarts at 0.

Without any freeze this is the same number as the old `streak()`, apart from that function's cap of
366 days. Today's number is provisional like before: going over the allowance today uses a freeze
today (and spending is rarely undone).

### Badges

| id | title | rule |
|----|-------|------|
| `first-week` | First week | the streak reached 7 days |
| `streak-30` | 30-day streak | the streak reached 30 days |
| `streak-saved` | Streak saved | a freeze was used at least once |
| `week-under-budget` | Week under budget | a full Monday-Sunday week that starts on or after the first booking, with at least one booking, and grocery spending at or below the sum of its 7 daily allowances |
| `month-under-budget` | Period under budget | a finished budget period that starts on or after the first booking, has a booking, and groceries within the limit |
| `no-spend-day` | No-spend day | a day before today, between the first and the latest booking, with no money going out (income is fine, transfers to Savings are not spending) |
| `savings-goal` | Savings goal reached | within one budget period the net amount booked in the category Savings reached the goal |
| `quest-master` | Quest master | every quest on the Today screen is done |

A badge, once the rule held anywhere in the replayed history, stays earned. Each badge reports the day
it was first earned. Limits: the rules use today's limit and goal for the whole history (limits are
not versioned), and "no-spend" and "week" rules are only as good as the bookings that were imported;
a gap in a sync can look like a quiet day (days after the latest booking are never counted for that
reason). The savings goal is a number you set on the Trophies screen, stored on this device only, not
in the server's budget (the Budget screen has no envelope for Savings).

New badges get a toast and a haptic once: an in-memory guard (`freshBadges`) stops a remount or a
quick second reload from celebrating twice, and a persisted list of seen ids stops it on the next
start.

### Personal bests

There is a single user, so instead of leagues: the longest streak (and the day it ended), and the
grocery week (Monday-Sunday, complete, starting on or after the first booking, with at least one
grocery booking) with the lowest spending, next to this week so far.

## What is verified

* Rust: unit tests in `crates/core/src/forecast.rs` (no history, no income, a normal month,
  overspending pace, grocery run-out and used-up budget, income pending and late, thin margin, the first
  and last day of a period, the period boundary, a period that has not started, year end, bookings
  after today) and `crates/api/tests/forecast.rs` through the real router on SQLite.
* TypeScript: `tests/game.test.ts` (freeze rules, cap, determinism, equality with the old streak,
  every badge incl. payday periods, weeks and bests, celebration guard, mascot lines) and
  `tests/forecast.test.ts` (wording).
* Not verified: the screens (forecast card, trophies card and route, toast and haptic) typecheck but
  were never run on a device, an emulator or in a browser.
