# Categorization: rules, corrections, splits, AI suggestions

## What it does

- **Rules** (`/v1/rules`): "merchant name contains / is exactly / starts with X, optionally only
  expenses or income, optionally within an amount range -> category". The first matching rule (list
  order = priority) wins and beats the built-in rules in `crates/core/src/category.rs`. Names are
  compared after `NameNormalizer` (lowercase letters only), so `REWE Markt 1234` matches `rewe markt`.
  Amount limits compare the amount without its sign. Rules apply to every CSV import and bank sync;
  `POST /v1/rules/apply` runs them again over stored transactions and returns how many changed.
- **Learning from corrections** (`PUT /v1/transactions/{id}/category`): sets the category of one
  transaction. A hand-made category is recorded and never overwritten by a later rule run. With
  `remember: true` the merchant gets an "is exactly" rule (or the existing one is updated) at the top
  of the priority order, and it is applied to the merchant's other transactions.
- **Split transactions** (`PUT/DELETE /v1/transactions/{id}/split`, `GET /v1/transactions/splits`):
  two or more parts (amount in cents with the transaction's sign, category, optional note) that add up
  to the booked amount exactly. Budget status and the groceries "what can I buy" envelope count the
  parts instead of the whole (`Store::list_effective_transactions`). The bank record itself is not
  changed; recurring-payment detection still sees the whole booking.
- **AI suggestions for unknown merchants** (`POST /v1/transactions/categorize-unknown`): for
  expense merchants still `other`/uncategorized (no hand-made category, not split) the configured
  provider (Settings -> Claude/OpenAI) is asked for categories. **Only the distinct normalized merchant
  names (letters and spaces, at most 60 per request) and the list of allowed categories are sent**, never
  amounts, dates, IBANs or purposes. Answers are vetted: unknown merchants, `income`/`other` and repeats
  are dropped. Nothing changes until you accept (`POST .../categorize-unknown/accept` creates one rule
  per merchant and applies the rules).

## Identity of transactions

Transactions have a database id and a unique `fingerprint` (date, amount, normalized counterparty and
purpose, plus `#n` for identical rows within one import). The API addresses transactions by id; hand-made
categories and splits are stored against the fingerprint so they survive a backup restore, which
assigns new ids. Changing a category does not change the fingerprint, so re-importing the same CSV
still skips the row and does not undo the correction.

## Data model (migrations 000200-000202)

`categorization_rules`, `transaction_splits`, `transaction_category_overrides`.

## What is verified

- Core logic, store round trips on SQLite and the HTTP API (including the privacy of the LLM request, with
  `MockProvider`) are covered by tests. PostgreSQL uses the same portable column types but this feature's
  queries were not run against a PostgreSQL server here.
- The mobile screens typecheck and the pure logic (rule form, split sums, reordering, API calls) has Node
  tests. **The screens were never run on a device or in a browser**, and the real Claude/OpenAI APIs
  were not called (no key); the prompt and parsing are exercised against the mock only.
- Not covered: the Today streak/quests (`src/game.ts`) read the whole transaction's category and do not
  know about splits.
