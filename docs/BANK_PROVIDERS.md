# Bank providers

A bank connection (`[[bank.accounts]]` in `financer.toml`, or **Settings > Server settings > Bank
accounts** in the app, which needs no file at all) has a `kind`, which says where its data
comes from. Everything after the data arrives (categories, budgets, the per-supermarket spending,
de-duplication) is the same for every kind.

| `kind` | You give | Per sync | Good for |
| --- | --- | --- | --- |
| `fints` (default) | bank code, login, IBAN, a PIN (typed, or an environment variable) | approve a pushTAN in your banking app | German banks that still offer FinTS, no third party |
| `plaid` | nothing in the file; you sign in once on Plaid's page | nothing | banks Plaid covers (Germany and other EU countries, UK, US, Canada), unattended scheduled syncs |
| `gocardless` | the bank's institution id; you sign in once on your bank's page | nothing | European banks through GoCardless Bank Account Data, unattended scheduled syncs |
| `finapi` | nothing in the file; you pick the bank and sign in once on finAPI's page | nothing | German banks through finAPI, unattended scheduled syncs |

A CSV export of your online banking always works too and needs no provider at all.

FinTS is described in `docs/FINTS.md`. This page is about Plaid, GoCardless and finAPI and about how
to add a provider.

## Choosing what to connect in the app

The **Spending** screen is where the transactions come from. With no bank connection set up it shows
a **Set up** button (also the bank icon at the top, and the empty state). It opens a menu:

- **CSV import** picks a file right away.
- **Sparkasse (FinTS)** opens the sync screen.
- **GoCardless**, **Plaid**, **finAPI** ask for what the server still lacks (its keys, and a name for
  the connection; for GoCardless also the bank's institution id), save that into the server's
  settings and wait for the server to restart. Keys the server already has, or that an
  environment variable decides, are not asked for again. The keys stay on the server.

Above the transactions a row of chips switches between the sources: CSV import, Sparkasse,
GoCardless, Plaid, finAPI. Each has a panel with its state, the linked accounts, the last result and
its main button (*Connect via ...* the first time, which opens the provider's page in the browser,
then *Sync now*). You can use several sources side by side. A booking that arrives twice with identical date, amount,
counterparty and purpose is imported once; two providers that describe the same booking in
different words can show it twice, so connect one source per account.

The on-phone (embedded) backend has no server settings, so there only CSV import and FinTS are
available.

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

## GoCardless Bank Account Data

GoCardless Bank Account Data (formerly Nordigen) reads your bank over PSD2. The server trades the
secret id and key for a token, creates a *requisition* for the bank you named (`institution`), and
the app opens the requisition's link. You sign in to your bank there; the server polls the
requisition until it is linked, keeps its id (sealed) and reads accounts, balances and booked
transactions from then on.

- **Availability.** GoCardless stopped accepting new sign-ups for this product in July 2025. The
  keys must come from an account that already existed. If you have none, use finAPI, Plaid or a CSV
  import instead.
- **Consent runs out.** The bank's consent lasts about 90 days (it can be shorter). When it ends the
  connection shows "your bank access ran out"; press *Connect* once more.
- **Rate limits.** GoCardless limits reads per account and day (a handful; check your agreement). Keep
  `sync_every_hours` at 6 or more; a refusal is shown as "allows only a few reads per day".
- **Bank id.** The institution id (`SPARKASSE_...`) comes from GoCardless's institutions list for your
  country (its institutions endpoint, `/api/v2/institutions/?country=de`, as far as its documentation
  was known).
- **Only euro, only booked.** Pending bookings and other currencies are skipped (counted as
  skipped), as with the other providers.

## finAPI

finAPI is a German aggregator. For each connection the server creates a finAPI *user* with a random
id and password that only this server knows, opens a *web form* where you pick your bank and sign
in, and reads accounts and transactions with that user afterwards. Disconnecting deletes the user,
which removes everything finAPI holds for it.

- **Needs a customer agreement.** finAPI is a business product; the sandbox works with test banks,
  `environment = "live"` needs a contract and approved access.
- **Sealed.** The user id and password are kept sealed with the server secret, like the other
  credentials.
- **Euro only.** Other currencies are skipped and not added to the balance.

## What was tested for GoCardless and finAPI, and what was not

Tested without a network, against scripted stand-ins: the request shapes, the token reuse, the
linking flow (waiting, finished, rejected, expired, cancelled), paging, sealed storage,
scheduling, sign-in-again after a consent ran out, wrong keys, rate limits, disconnect,
de-duplication against a CSV import, and that no key, token or password appears in a listing, a
message or a debug print.

**Not tested against the real services.** There is no GoCardless or finAPI account behind this
repository, and neither service's documentation could be opened while this was written. The
request and answer shapes follow the public descriptions as far as they were known:

- GoCardless: `crates/openbanking/src/gocardless.rs`.
- finAPI: `crates/openbanking/src/finapi.rs`. The least certain part is the web form: its address
  (`webform-sandbox.finapi.io` / `webform-live.finapi.io`, overridable in `FinapiConfig`), the
  request body of `POST /api/webForms/bankConnectionImport` and the status names
  (`COMPLETED`, `ABORTED`, ...).

If a field differs, the sync reports "an answer this app does not understand" with the path, and
those two files are the only places to adjust. Run the sandbox flow once and watch the first sync
before you rely on either.

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

A provider that works like GoCardless and finAPI (a page to sign in on, then reads) does not need its
own flow code: implement `LinkProvider` in `crates/openbanking` (`begin`, `poll`, `fetch`, `revoke`),
add a `BankProvider` variant, and `crates/api/src/bank_open.rs` does the linking, sealing,
scheduling and disconnecting. Then add its keys and its `kind` to `crates/config`, and an entry to
`SOURCES` in `apps/mobile/src/bankSetup.ts` so the Spending screen offers it.
