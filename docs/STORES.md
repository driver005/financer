# What I spend at each supermarket

The **Stores** screen (reached from Spending and from Today) ranks the supermarket and drugstore
chains by what you spent in a budget period, from your booked bank transactions.

## Endpoints

`GET /v1/spending/stores?period=current|previous|last_n&n=3&date=YYYY-MM-DD`

- Periods are the payday-based budget periods ([BUDGET_PERIODS.md](BUDGET_PERIODS.md)).
  `current` (default) is the running one, `previous` the one before, `last_n` the running one and the
  `n - 1` before it (`n` 1 to 24, default 3). `date` is the day to treat as today; the app sends its
  local date.
- Per chain: total spent, number of visits (every booking is one visit), average basket, share of
  everything spent in stores (`share_permille`, 123 = 12.3 %), last visit, and the change against the
  comparison range (`change_cents`, `change_permille`, absent when nothing was spent there).
- `other` is grocery spending (category groceries) that no chain matched. It is always present.
- The comparison range is the same number of periods right before the range. While the range is
  still running, the comparison covers only as many days as have passed (`compare_is_partial`),
  so half a month is not compared with a whole one. A finished range is compared with the whole
  earlier one.

`GET /v1/spending/stores/{chain}/transactions` (same query) lists the bookings behind one total,
newest first. `{chain}` is the `chain` id from the first call, or `other`. An unknown id is a 404.

## What counts

- Only **expenses** count. A refund (a positive booking) from a store is not subtracted.
- The whole booking is the visit; splits (`PUT /v1/transactions/{id}/split`) are ignored here.
- A booking counts for a chain when its counterparty (or, if that matches nothing, its purpose)
  matches a spelling of the chain. A grocery-category booking with no chain match goes to `other`.
  A booking matched to a chain counts even if you categorized it elsewhere (dm and Rossmann are
  usually "shopping"), so "share" is the share of chain spending plus unmatched groceries.
- Total "store spending" is therefore not the same number as the groceries envelope.

## How bank texts are matched

Texts are normalized with the same rule as the rest of Financer (lowercase letters only) and
compared as **whole words**: `ALDI SAGT DANKE`, `LIDL SAGT DANKE//Berlin/DE`, `REWE Markt GmbH`,
`Netto Marken-Discount AG & Co. KG`, `dm-drogerie markt GmbH + Co. KG` and similar match; `Admin
GmbH` does not match dm. Built in: Lidl, Aldi (Nord and Süd together), Kaufland, REWE, Edeka
(also E center, Neukauf), Marktkauf, Netto, Penny, dm, Rossmann, Norma, Globus, tegut, real,
Famila, HIT, nahkauf, Alnatura, denn's Biomarkt, Bio Company, Budni, Müller, Metro.

- Short names that are also common words or surnames (`dm`, `norma`, `penny`, `netto`, `globus`)
  count only at the **start** of the counterparty (or in a longer spelling such as `real sb
  warenhaus`). The purpose text is used only when the counterparty matches nothing, which is how a
  PayPal payment naming the shop is found.
- Look-alikes are excluded: `ALDI TALK` and `Lidl Connect` (mobile contracts), `Globus Baumarkt`,
  `REWE Reisen`.
- **Known false positive:** a person whose name starts with one of the short names (for example
  "Norma Schmidt") is matched to that chain. Only expenses count and you can recategorize, but a
  bank transfer to such a person shows up as a store visit.
- **Add your own** with `[[stores]]` in `financer.toml` ([CONFIG.md](CONFIG.md)): your spellings are
  tried before the table, can point to a built-in chain (`chain = "edeka"`) or create a chain of
  your own (`chain = "Hofladen Maier"`), and are not subject to the look-alike exclusions.
  They need a restart of the server. The on-phone backend has no config file and uses only the
  built-in table.

## What was tested, and what not

Tested: the matcher on realistic Sparkasse booking texts and look-alikes, user aliases, the
aggregation and ranking (including rounding, empty ranges and the partial comparison window), the
period arithmetic (payday, year end, shorter earlier month) and both endpoints through the real
router on SQLite. The screen typechecks and its logic is unit-tested, but it was **never run on a
device or in a browser**. The built-in spellings come from knowledge of how German chains write
their names in bookings, not from your account: if one of your stores lands in `other`, look at
its booking text and add a `[[stores]]` entry.
