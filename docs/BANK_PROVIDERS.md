# Bank providers

A bank connection (`[[bank.accounts]]` in `financer.toml`, or **Settings > Server settings > Bank
accounts** in the app, which needs no file at all) has a `kind`, which says where its data
comes from. Everything after the data arrives (categories, budgets, the per-supermarket spending,
de-duplication) is the same for every kind.

| `kind` | You give | Per sync | Good for |
| --- | --- | --- | --- |
| `fints` (default) | bank code, login, IBAN, a PIN (typed, or an environment variable) | approve a pushTAN in your banking app | German banks that still offer FinTS, no third party |
| `plaid` | nothing in the file; you sign in once on Plaid's page | nothing | banks Plaid covers (Germany and other EU countries, UK, US, Canada), unattended scheduled syncs |

FinTS is described in `docs/FINTS.md`. This page is about Plaid and about how to add a provider.

## Plaid

### What it is, and what it costs you

Plaid is a third party. Your bank login goes to Plaid's page, not to Financer, and Plaid then reads
your transactions for you. That is the trade: no PIN and no approval per sync, but your data passes
through Plaid, and Plaid has its own terms and, for real banks, its own pricing. FinTS keeps
everything between you and your bank. Use whichever you are comfortable with, or both.

### Set it up

**From the app:** Settings > Server settings > *Bank providers* takes the Plaid client id, secret,
environment, countries and language, and *Bank accounts* takes the connection itself (choose
*plaid* as the provider). Save; the server restarts and the connection shows up under Settings >
Bank connections. The steps below do the same in the file and the environment.

1. Create a Plaid account and keys at <https://dashboard.plaid.com>. Turn on **Hosted Link** for
   them (the app opens Plaid's page in the browser; it needs no native Plaid component).
2. Put the keys in the environment, not in the file:

   ```
   export PLAID_CLIENT_ID=...
   export PLAID_SECRET=...
   export FINANCER_SECRET_KEY=a-long-random-string-of-16-characters-or-more
   ```

   `FINANCER_SECRET_KEY` seals the Plaid access token in the database (see below). Without it the
   API token is used, which works but ties the token's safety to the API token.
3. Describe the connection:

   ```toml
   [bank.plaid]
   client_id = "${PLAID_CLIENT_ID}"
   secret = "${PLAID_SECRET}"
   environment = "sandbox"        # then "production" for your real bank

   [[bank.accounts]]
   name = "Plaid Girokonto"
   kind = "plaid"
   sync_every_hours = 12
   ```

4. Start the server and open **Settings > Bank connections**. Press **Connect your bank**: Plaid's
   page opens, you pick your bank and sign in there, and the screen updates when you are done. The
   first read starts by itself. In the sandbox, Plaid offers a test bank: log in with `user_good` /
   `pass_good`.

`sandbox` only offers the test bank; the server says so in its log and `--check-config`. Switch to
`production` (and production keys) for a real one.

### What happens, step by step

- **Link, once.** The server asks Plaid for a *link token* with a hosted sign-in page and shows its
  address in the app (`needs_link`). It polls Plaid every few seconds until the session is
  finished, then swaps the result for an *access token*. The page is given up after about 30
  minutes.
- **Sync.** With an access token the server reads what is new *by cursor* and imports it with the
  same de-duplication as a CSV import. The cursor is saved only after the import worked, so a
  failed import is read again, not skipped. A sync of an overlapping period changes nothing.
- **Scheduled.** A linked connection with `sync_every_hours` syncs by itself, with no PIN and no
  approval. A connection that is not linked yet waits for you to press the button.
- **Sign in again.** When the bank wants a new login, the server drops the token and the card says
  so; press the button once more.
- **Disconnect.** Tells Plaid to forget the connection and deletes the token here. Transactions
  that were imported stay.

### What is imported

Booked transactions in euro only. Pending ones are skipped (Plaid sends the booked one later), as
are other currencies. The amount is negative for money leaving the account. The counterparty is
Plaid's merchant name, else the payee, else the description. The balance shown is the sum of the
current balance of your included checking and savings accounts in euro; a credit card does not count.
Restrict the accounts with `account_ids` (the card lists the ids after the first sync).

### What is stored, and where

| What | Where | How |
| --- | --- | --- |
| Plaid client id and secret | your environment | never in the file or the database, never in logs |
| Access token | database setting `bankconn.<name>.plaid_access` | XChaCha20-Poly1305, key derived from `FINANCER_SECRET_KEY` (or the API token), bound to the connection |
| Cursor, account list | database settings | plain; they identify no bank login |
| Your bank login | Plaid only | never reaches Financer |

A backup or a stolen database file shows nothing usable without the server secret. Changing the
secret makes a stored token unreadable, which shows up as "not connected": link again.

### What was tested, and what was not

Tested without a network, against a scripted Plaid: the request bodies, paging by cursor,
restarting a page when the data changes underneath, the linking flow (waiting, finished, expired,
cancelled), sealed storage, scheduling, sign-in-again, disconnect, de-duplication against a CSV
import, and that no secret appears in a listing, a message or a debug print.

**Not tested against real Plaid.** There is no Plaid account behind this repository. Before you rely
on it: run the sandbox flow once, check the Plaid dashboard's *Hosted Link* setting, and watch the
first real sync. Plaid's exact field names were taken from its public documentation; if Plaid
changes one, the sync reports "an answer this app does not understand" with the path, and
`crates/plaid/src/types.rs` is the one place to adjust.

The on-phone (embedded) backend does not read `financer.toml`, so Plaid connections are a feature
of the hosted server for now.

## Adding another provider

A provider has to answer three questions, which map to three functions:

1. *How do I get permission?* FinTS asks for a PIN and a TAN; Plaid shows a page. Add the new
   `BankProvider` variant (`crates/api/src/bank_connections.rs`) and branch in `BankSync::start`.
2. *How do I fetch?* Return `financer_fints::BankData` (booked transactions, balance, skipped
   count). Everything after that is shared: `BankSync::import` de-duplicates and categorises.
3. *How do I forget?* Store the credential with `SecretBox` (never plain), and drop it on
   disconnect.

Put the HTTP calls behind a small trait (see `PlaidHttp`) so tests run without a network, and
add the `kind` to `crates/config` (`validate.rs`) so a typo is an error with the key's name.
`crates/api/tests/bank_plaid.rs` is a good template for the integration tests.
