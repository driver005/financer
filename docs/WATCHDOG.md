# Subscription watchdog and anomaly alerts

Both are computed from your stored transactions each time you ask; the only thing stored is which
alerts you dismissed (`alert_dismissals`). Code: `crates/core/src/subscriptions.rs`,
`crates/core/src/anomaly.rs`, API in `crates/api/src/watchdog.rs`.

## API

| Endpoint | What |
|---|---|
| `GET /v1/subscriptions?days=30` | active subscriptions, calendar of the next `days` days (1 to 366), price hikes, possible duplicates, possibly-unused ones |
| `GET /v1/alerts?include_dismissed=false&lookback_days=60` | alerts for payments booked in the last `lookback_days` days, `unread_count` counts the not dismissed ones |
| `POST /v1/alerts/{id}/dismiss` | dismiss one (404 if the id is not an alert right now; dismissing twice is fine) |

Both GETs also take `as_of=YYYY-MM-DD` (treat that day as today) so results can be reproduced.
Amounts are integer cents; in these endpoints they are positive charge sizes (only outgoing
payments are looked at).

## Subscription watchdog

- A merchant (name normalised like everywhere else) is a subscription when it has at least three
  outgoing bookings whose gaps cluster around weekly, monthly, quarterly or yearly (the same
  cadence logic as `RecurringDetector`). Amounts must stay within 10% of the median **or** step to
  a new level once (twice in a long history) that is at most 2.5 times the old one, which is what a
  price hike looks like. `RecurringDetector` itself is unchanged and still rejects such payments; a
  test checks the watchdog finds everything it finds.
- Merchants that fail to form one series are retried as two interleaved series (same plan billed
  twice) and by exact amount (two price tiers).
- Calendar: dates are counted from the last booking (31 Jan, 28 Feb, 31 Mar); a charge whose date
  has passed but is not booked yet is listed first as `overdue`. Confidence (10 to 99) rises with
  the number of bookings and falls with rhythm wobble, a stepped price, the distance into the
  future and being overdue.
- Price hike: latest level above the previous one by at least 3% and 20 cents, started within the
  last 365 days. Old, new, delta, percent (basis points) and the first booking at the new price are
  reported. A price drop is not reported.
- Duplicate: two active subscriptions on the same cadence, amounts within 15% of the larger one,
  same or similar merchant (one name's words contained in the other, or at most two typos). Stopped
  subscriptions are not compared (a switch to a new plan is not a duplicate).
- Possibly unused: two expected charges missed (the second expected date is past). They are listed
  apart from the active ones and not in the calendar; ones silent for more than 400 days (3
  periods for yearly) are dropped.

## Anomaly alerts

One alert per payment at most, in this priority: `duplicate_charge`, `unusual_amount`,
`new_merchant`, `large_for_category`. Defaults are in `AnomalyConfig`.

- `duplicate_charge`: same merchant and amount (at least 5 EUR) within 3 days of an earlier one,
  unless the merchant is a known recurring payment.
- `unusual_amount`: at least 5 earlier charges at the merchant; the charge is more than 3.5
  "typical deviations" (1.4826 x MAD, floored at 10% of the median and 1 EUR, so a MAD of zero does
  not flag everything) above the median, at least 20 EUR and 150% of it.
- `new_merchant`: first payment ever to a merchant, at least 100 EUR, and more than 60 days after
  the first transaction in the data (so a fresh import does not flag everything).
- `large_for_category`: everyday categories only (groceries, dining, transport, health, leisure,
  shopping), at least 10 earlier charges in the category, z-score 6, at least 50 EUR and 200% of
  the category median.

Each alert has `kind` (the key the app words in its own language), `severity`, an English `reason`
with the numbers, the transaction id, and an id that is a hash of kind and transaction content, so
it is the same every time and survives a backup restore.

## Verified and not verified

- Verified: the core logic on hand-built transactions (monthly and annual cadence, price drop is
  not a hike, tiny first-time merchant is no alert, MAD of zero, stable ids, lookback), the store
  on SQLite, the endpoints through the real router (`crates/api/tests/watchdog.rs`), the mobile
  wording and week grouping in Node tests, and the screens by typecheck.
- Not verified: behaviour on a real Sparkasse history (thresholds are reasoned defaults, not tuned
  on real data), PostgreSQL for the new table (the migration uses only portable types), the screens
  on a device or in a browser.
- Not covered on purpose: a standing order paid twice (a known recurring payment never gives a
  duplicate-charge alert), income, and merchants whose name changes between bookings.

## Backup

The export/import does not carry `alert_dismissals` yet (`alert_id` text key, `dismissed_at` unix
seconds). Without it a restored database shows dismissed alerts again.
