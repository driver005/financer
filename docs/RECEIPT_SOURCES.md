# Automatic receipts

Financer can pull your digital receipts in by itself, so that "what I normally buy" and the
spending per supermarket have item-level data without you photographing anything. There are three
sources, each **off until you configure it**:

| Source | What it reads | Reliability |
|---|---|---|
| **Email** | receipt mails (REWE eBon as PDF, other shops' mails) from your mailbox over IMAP | the main route |
| **Folder** | PDF, text, HTML or `.eml` files dropped into a folder on the server | simple and robust |
| **Lidl Plus** | your Lidl Plus receipts, after you sign in on Lidl's own page | **experimental and unofficial** |
| **Kaufland Card** | digital receipts of your Kaufland Card, after you sign in on Kaufland's own page | experimental and unofficial, see below |

All three feed the same receipts list as the manual ones, so the usual-items learning, the
receipts screen and the matching below treat them alike. A receipt knows where it came from
(`manual`, `email`, `folder`, `lidl_plus`).

> **What was and was not tested.** Everything below was built and tested against **fakes**: a fake
> mailbox holding hand-written mails with generated PDFs, hand-written JSON in the shapes the
> open-source Lidl Plus client documents, and a temporary folder. **No real mailbox, no real
> retailer and no real account were ever contacted**, no live request was made while building
> this, and the screen was never run on a phone or in a browser. See
> [What is verified, and what is not](#what-is-verified-and-what-is-not).

## Quick start

Paste what you need into `financer.toml` (all keys, with defaults, are in
[`financer.example.toml`](../financer.example.toml)), set the mailbox password in the
**environment** and restart the server:

```toml
[receipts.email]
host = "imap.example.org"
username = "you@example.org"
password_env = "FINANCER_IMAP_PASSWORD"   # the NAME of the variable, never the password
folder = "INBOX"
poll_minutes = 30
max_age_days = 90                         # on the first run, only mails this new

[receipts.lidl_plus]
enabled = false                           # experimental; see below
country = "DE"
language = "de"
poll_hours = 12

[receipts.folder]
path = "/data/receipts"
poll_seconds = 60
on_done = "keep"                          # or "move" to file originals under done/
```

```sh
export FINANCER_IMAP_PASSWORD='the mailbox password'   # or an app password, see below
financer-server --check-config                          # validates, warns about a missing variable
```

The same settings can come from `FINANCER_RECEIPTS_*` environment variables (they win over the
file); the list is in [CONFIG.md](CONFIG.md#receipts). In the app: **Settings > Groceries >
Receipt sources** (also reachable from the Receipts screen).

## Source 1: email

REWE mails the eBon as a PDF to the address of your REWE account; other retailers' receipt mails
work the same way. Financer logs in to your mailbox, looks at **new** mail, and imports what is a
receipt.

**Setup**

1. Put the mailbox password in an environment variable on the server (name it in `password_env`),
   or type it into the app under Settings > Server settings > Receipts: mailbox.
   Many providers (Gmail, iCloud, Outlook) require an *app password* for IMAP; use that, not your
   main password. Use a mailbox you control: the server reads it.
2. Add `[receipts.email]` as above. Only implicit TLS is supported (port 993 or your provider's
   IMAPS port); STARTTLS and plain connections are refused on purpose so the password never
   travels unencrypted. Certificates are checked against the Mozilla root list.
3. Restart. The first run looks back `max_age_days`.

**Which mails are downloaded.** Only mails from an allowed sender. The built-in list (used when
`senders` is not set) is the shops' own domains: `rewe.de`, `rewe-group.com`, `lidl.de`,
`lidl.com`, `lidlplus.com`, `kaufland.de`, `edeka.de`, `dm.de`, `rossmann.de`, `penny.de`,
`netto-online.de`. A rule is a retailer plus senders (a domain matches its subdomains, an
address matches exactly) and an optional `subject_contains`. Headers are fetched first; **mail from
anybody else is never downloaded**. If you forward receipts to yourself, add a rule for your own
address with `retailer = "auto"` and `subject_contains = ["ebon"]`: the shop is then read from the
receipt itself.

**What is read.** Per mail: every PDF attachment, then HTML and text attachments (including a
forwarded mail attached as `.eml`), and only if none of them was a receipt, the mail body. The PDF
must have a text layer (REWE's eBon has; a scan does not, use the photo route in the app). Body text
must add up to its printed total, so a newsletter with prices is not imported as a receipt; a PDF or
attachment from an allowed sender needs only readable items.

**Nothing twice.** The server remembers, per folder, the IMAP `UIDVALIDITY` and the last UID it
handled, in the database; a restart continues where it stopped, and if the server renumbers the
folder Financer looks again (stored receipts are not duplicated). Beyond that, every receipt has a
content fingerprint (shop, date, time, total and items) and the same purchase arriving a second
time, by another route or in another layout, is recognised by shop, day, total and time and
dropped. The folder is opened read-only unless `mark_seen = true`, which marks mails that held a
receipt as read.

## Source 2: Lidl Plus (experimental, unofficial, off by default)

Lidl has **no public interface for third parties**. This source uses the same sign-in and receipt
interface as the Lidl Plus app, worked out by the open-source client
[Andre0512/lidl-plus](https://github.com/Andre0512/lidl-plus) (`lidlplus/api.py`). Financer does
**not** copy or vendor that code: it reimplements the documented flow in Rust, and credits the
project for the protocol. It may stop working at any time, and using it may be against Lidl's
terms; that is your decision.

**How the sign-in works (and what Financer sees)**

1. In the app, **Connect Lidl Plus**. The server creates a random PKCE verifier and state and
   returns the address of **Lidl's own sign-in page** (`POST /v1/receipts/lidl/start`). Nothing is
   sent to Lidl by this step.
2. You sign in **on Lidl's page**, in a browser sheet (iOS: `ASWebAuthenticationSession`; Android:
   a custom tab). Financer never sees your password, your phone number or your SMS code.
3. Lidl's page ends by redirecting to `com.lidlplus.app://callback?code=...`. On a phone the sheet
   hands that address to the app; the app sends it to the server
   (`POST /v1/receipts/lidl/finish`), which exchanges the one-time code (with the verifier) for
   tokens.
4. **Only the refresh token is stored**, encrypted. From then on the server refreshes access
   tokens and reads new receipts every `poll_hours`, without a browser.

**Web and desktop.** A browser cannot hand a custom-scheme address to a web page, so there the
app shows a clearly worded fallback: open Lidl's page, sign in, then copy the address you end up on
and paste it. Many browsers show an error or a blank page at the end (nothing understands
`com.lidlplus.app://`); some do not show the address at all. If yours does not, open the
developer tools (Network tab), copy the request that ends in `callback?code=`, or use the email
route instead. This fallback is described but **was not tried in any browser**.

**Android.** The callback address is registered for the app in `app.json`
(`android.intentFilters`, scheme `com.lidlplus.app`, host `callback`) and routed back to the
Receipt sources screen (`src/app/+native-intent.tsx`). This **competes with the Lidl app**: if it
is installed, Android may offer to open the address in either app; choose Financer. On iOS an
authentication session accepts any callback scheme.

**Disconnect** (`DELETE /v1/receipts/lidl`, or the button) deletes the token and what the source
remembered. Receipts already imported stay. If Lidl stops accepting the saved sign-in, the status
becomes *Sign in again* and nothing more is requested until you do.

All constants of the protocol (client id, addresses, scopes, header values) are in one file,
`crates/receipt-sources/src/lidl/consts.rs`, each with its origin, and can be overridden under
`[receipts.lidl_plus]` (`client_id`, `authorize_url`, `token_url`, `tickets_url`, `redirect_uri`,
`scope`). The client id and the token endpoint's fixed client authentication are taken from the
open-source client. The authorization path `/connect/authorize` is **assumed** (the open-source
client reads it from the provider's discovery document; it is the standard path of the identity
server Lidl uses).

### Lidl Plus on the phone (embedded mode)

The on-phone backend has no `financer.toml`. There Lidl Plus is switched on in the app (Receipt
sources > Lidl Plus), the token is encrypted with a secret kept in the phone's secure storage, and
syncing happens when the app opens and in the OS background slot. Email and the watched folder are
server-only. Details and limits: [EMBEDDED.md](EMBEDDED.md#receipts-from-lidl-plus-on-the-phone).

## Source 3: watched folder

`[receipts.folder]` names a directory on the server. Every `poll_seconds`, new `.pdf`, `.txt`,
`.html`/`.htm` and `.eml` files in it (not in subfolders, not hidden files, not files modified in
the last two seconds) are imported. Files are identified by the hash of their content, so the same
file is never imported twice, whatever it is called. `on_done = "keep"` (default) leaves the file
alone and remembers it in the database; `"move"` files imported receipts under `done/` (files that
are not receipts stay where they are, remembered, so they are reported once and not retried until
their content changes). A synced folder (Syncthing, a cloud drive) is a convenient drop box.

## Matching receipts to bank payments

After every run, each receipt without a link is matched to a bank transaction when

* it is the **same shop** (the chain table of the Stores screen, with your `[[stores]]` spellings,
  decides which chain the payment belongs to; there is no second table),
* the amount is within **one cent** of the receipt total (a payment, not a refund), and
* the booking date is within **three days** of the receipt date,

and it is the **only candidate on both sides**: if two payments fit one receipt, or two receipts
fit one payment (two identical shopping trips), none of them is linked rather than guessing. The
link is stored (`receipts.transaction_id`) and shown as `transaction_id` on `GET /v1/receipts`, so
the spending-per-store view can show item-level detail later; nothing reads it for that yet.

## Endpoints

| | |
|---|---|
| `GET /v1/receipts/sources` | each source: `state` (`disabled`, `waiting`, `running`, `ok`, `error`, `not_connected`, `needs_signin`), last run, last success, next run, last error, receipts imported (last run and in total), notes, where it reads from. No secrets. |
| `POST /v1/receipts/sync` | run now; optional body `{"source": "email" \| "lidl_plus" \| "folder"}`; `409` while a run is going |
| `POST /v1/receipts/lidl/start` | `authorization_url`, `state`, `callback_scheme`, `redirect_uri`, `expires_in_seconds` (15 minutes) |
| `POST /v1/receipts/lidl/finish` | `{state, callback_url}`; stores the encrypted token, runs the first sync |
| `GET /v1/receipts/lidl/status` | `disabled`, `never`, `connected` or `needs_signin`, connected-at, last sync, receipts |
| `DELETE /v1/receipts/lidl` | disconnect |

Without a configured source every source reports `disabled`; the Lidl endpoints answer `409`.

## Security notes

* **No secret in the config file.** The mailbox password is read from the environment variable
  named by `password_env`, or typed into the app (Settings > Server settings), which keeps it in the
  server's private settings file (`financer.settings.json`, mode 0600, see `docs/CONFIG.md`) and
  never sends it back. `--print-config` shows that name (and that a password is set), and a masked login. Error messages
  from the mail server are shortened and have the password removed.
* **The Lidl token is encrypted at rest**: XChaCha20-Poly1305, a key derived with HKDF-SHA256 from
  a server secret (`FINANCER_SECRET_KEY`, else the API token) and a random salt per value, bound to
  its purpose. The token is in its own table, not in the settings, and **not in exports or
  backups**. A stolen database file reveals nothing without the secret. Changing the secret makes
  the stored token unreadable, which shows as *Sign in again*. (The encrypted backups of your
  data use a passphrase with scrypt; a server secret that is a long random string needs no
  stretching, which is why this uses a plain KDF.)
* The PKCE verifier lives in server memory only, for 15 minutes, and is single use; the address
  you paste is checked for the callback scheme and the state before anything is sent anywhere.
* Request and response bodies of the Lidl client are never logged; debug output of tokens and
  requests is redacted.
* The mailbox is read-only unless you set `mark_seen`. Mail from other senders is not downloaded.
* **Privacy:** receipts reveal what you buy. They stay in your database. Unlike the photo route,
  the automatic sources do not send anything to an AI provider (PDFs are read by a local text
  extractor).

## Known limits

* PDFs without a text layer cannot be read by the automatic sources.
* The first run reads at most 200 mails and 60 Lidl tickets at a time; the rest follow on the next
  poll.
* Retailers other than the four price-tracked chains get a receipt and a link to bank payments,
  but no price comparison.
* A receipt that appears twice without a time of day, from one source, with identical total, is
  kept twice (it could be two trips); across two sources it is merged.

## What is verified, and what is not

**Verified (automated tests, no network):** configuration parsing, environment overlay and
redaction; sender matching; MIME parsing of mails with PDF, HTML, text and attached-mail parts;
PDF text extraction on generated PDFs; the receipt reader and de-duplication across routes; the
mailbox sync against a fake mailbox (cursor, `UIDVALIDITY` change, age limit, failure, mark-as-read,
sender allow-list, nothing downloaded from strangers); the watched folder on a temporary
directory; the Lidl client against hand-written fixtures (the exact form fields, `Basic` client
authentication, PKCE challenge against the RFC 7636 example, paging, headers, token rotation, a dead
token); the encrypted storage; the matcher including the ambiguous cases; the HTTP endpoints; the
pure helpers of the screen.

**Not verified:**

* **Nothing was run against a real IMAP server.** The IMAP code (`async-imap` over `tokio-rustls`)
  compiles and follows the library's documented use, but login, `UIDVALIDITY`, `SEARCH`, header
  and body fetches, and TLS were never exercised against a real server.
* **The sender addresses are a best guess**, not checked against real mail. If a shop's mails are
  not picked up, add its real sender to `senders`.
* **The REWE eBon and Lidl receipt layouts** were written from memory of their typical shape, not
  from real documents. The reader is deliberately forgiving and checks items against the printed
  total, but a real eBon may need an adjustment.
* **Lidl:** the sign-in flow and ticket interface are those of the open-source client, which
  describes the token request, the ticket list/paging and the item fields. The authorization path,
  the ticket-level fields (date, total, store, printed HTML) and every response here are **hand
  written, not recorded**. Nothing was sent to Lidl. Lidl may have changed anything.
* **The app side** was typechecked and its pure helpers tested; it was **never run on a device or in
  a browser**. `expo-web-browser` is a new dependency (`package.json` and the lock file are updated)
  that could not be installed in the sandbox, so the screen was not bundled; the Expo
  documentation was not reachable either, so the behaviour of the authentication session on iOS with
  a custom callback scheme, and the Android intent filter, are taken from the package's own type
  definitions and general knowledge, not from a run.

## REWE, Kaufland, Penny and ALDI

None of the four has a public interface for receipts, and Financer does not sign in to their apps. Looked up on
2026-11-03 from what the shops and press say, not tried with accounts:

| Shop | What the shop offers | What works in Financer |
| --- | --- | --- |
| REWE | eBon in the REWE app or account; the PDF is mailed to the account's address and kept under "Meine Einkäufe" | the **Email** source reads the PDF; or the **REWE window** below (unofficial). The REWE app's own interface is protected (Cloudflare mutual TLS since March 2024, certificates from the APK), so only the web shop is used |
| Kaufland | digital receipt in the Kaufland app with the Kaufland Card ("Papierbon sparen") | the **Kaufland Card** source below (unofficial sign-in); or a screenshot of the receipt, scanned under Receipts |
| Penny | eBon in the PENNY app (off until switched on) | same as Kaufland |
| ALDI | no digital receipt found | photograph the paper receipt |

What other people have worked out (read in their public code on 2026-11-03, none of it run by me):

- **Kaufland**: the Bonfire project (`Naxter/bonfire`, pull request 26, file `backend/app/kaufland.py`) signs in through
  Kaufland's own account page (OAuth with PKCE, `account.kaufland.com`, the redirect goes to the app's own
  address) and reads the receipt history from a private API of the Schwarz group (`p.crm-dynamics.schwarz`,
  `/api/v2/customers/{user}/transactions`), sending the app's client id and version. Its author says the API is
  made for the app, is not stable, and was only tested with fake answers. A second project (`receipt-radar`) says
  the receipt host is certificate-pinned, which a program written like the app's own client would meet too. This is
  the same family of sign-in as Lidl Plus, so Financer could follow the Lidl Plus module.
- **REWE**: `grocy-rewe-connect` reads `shop.rewe.de/api/receipts/` with the `rstp` session cookie copied from a
  browser that is signed in to the REWE account (it expires and cannot be refreshed by a program). The app's own
  API is behind client certificates (see above) and no project covers receipts there.
- **Penny and ALDI**: nothing found.

None of this is an official interface; it can stop working at any app update and may go against the shops' terms
of use. The Kaufland sign-in and the REWE window (below) are built into Financer. The guide in Settings > Receipt sources shows the table above.

## Kaufland Card (experimental, unofficial, off by default)

Works like Lidl Plus: switch it on (`[receipts.kaufland] enabled = true` or `FINANCER_RECEIPTS_KAUFLAND=1` on a
server; a switch in the card on the phone), tap Connect in Settings > Receipt sources and sign in on Kaufland's own
page (`account.kaufland.com`). The password never reaches Financer; only the refresh token is kept, encrypted with
the same key as the Lidl Plus one, together with your customer id. New receipts are read from
`p.crm-dynamics.schwarz/api/v2/customers/{user}/transactions` (20 per page, newest first; a page of known receipts
ends the run; at most 200 new ones per run) every 12 hours (`poll_hours`).

- Every address, client id and the app version are in `crates/receipt-sources/src/kaufland/consts.rs` and can be
  overridden under `[receipts.kaufland]` (Settings > Server settings shows the keys).
- The protocol is taken from the public project Bonfire (see above); it is **not** an official interface, **was not
  run against a real Kaufland account** (only against fake answers shaped like Bonfire's description), and the
  receipt host is said to be certificate-pinned for the real app, which may keep a program like this out. Amounts are
  read as whole cents, as Bonfire documents; refunds become negative lines. If a receipt cannot be read it is noted
  and not tried again.
- Only receipts you get digitally exist (the "Papierbon sparen" switch in the Kaufland app).
- It may break at any app update and may go against Kaufland's terms of use. Switch it off or disconnect any time;
  disconnecting deletes the token and keeps the receipts already imported.

## REWE eBon in a window of the app (experimental, unofficial, phone app only)

Settings > Receipt sources > REWE eBon > Read my REWE receipts opens REWE's web shop (`shop.rewe.de`) in a window
of the app (`react-native-webview`). You sign in there, on REWE's own page. Once signed in, a small script that
**the app runs inside that page** asks the shop's own address `/api/receipts/` for the list of receipts and then
fetches the new ones (30 per run, one every 0.4 seconds); the app sends them to your server, which stores each once
(by REWE's receipt id), matches them to bank payments and treats a copy that also arrived as the mailed PDF eBon as
the same purchase.

- **No cookie is copied.** The page's own session does the authentication inside the window, so the session cookie
  never leaves it, whether scripts can read it or not. (Reading cookies out of Chrome is not an option: not from a
  phone app, and on a computer Chrome 127 and later block it.) Your password is only typed on REWE's page.
- **Only REWE's pages load** in the window (`*.rewe.de` over https), and the app only believes messages that come from
  `shop.rewe.de` itself. A receipt id is only used in the script or the address when it consists of letters, digits,
  `-` and `_`.
- **Nothing runs by itself**: receipts are read when you open the window. While you are still signed in to REWE
  there, that happens right away; when the session has run out, you sign in again. There is no background schedule.
- The server side is `POST /v1/receipts/rewe/known` (which ids are new), `POST /v1/receipts/rewe/import` (at most 100
  receipts of at most 500 lines, validated), `GET /v1/receipts/rewe/status` and `DELETE /v1/receipts/rewe`.
- The shape of REWE's answers (`items` with `receiptId`, `receiptTimestamp`, `receiptTotalPrice`; a receipt's
  `articles` with `productName`, `quantity`, `totalPrice`, all prices in cents) comes from the public project
  `grocy-rewe-connect`. It is **not** an official interface and **was not run against a real REWE account**; the
  scripts were run in a desktop browser against a stand-in server with that shape, and the window itself was never
  run on a phone. Lines without a product name (deposit, counter goods) are left out, so a receipt with such lines is
  flagged as not adding up to its total.
- It needs a new build of the phone app, because `react-native-webview` is a native module. It may break at any
  change of REWE's web shop and may go against REWE's terms of use.

## The other supermarkets and online shops

Looked up on 2026-11-03 (what the shops and the press say; none of it tried with an account):

| Shop | What exists | What works in Financer |
| --- | --- | --- |
| dm | digital receipt in the "Mein dm" app since 2021 | in-app only; **share** it to Financer (below) |
| Rossmann | digital receipt in the Rossmann app since May 2025 (technology: anybill, which can also save a receipt as a PDF) | **share** the PDF or a screenshot |
| Penny | eBon in the PENNY app since April 2026 (off until switched on) | **share** |
| Edeka, Netto | receipts inside the Edeka app; Netto unclear | **share** |
| Aldi | no digital receipt found | photograph the paper receipt |
| Amazon | no connection for private customers: "Login with Amazon" only gives name, e-mail and postal code; the official way to the order history is "request your data" (a CSV after a few days to about a month) | **Online orders** import below |
| eBay | no buyer export; the API only returns what you won in the last 60 days; the official data request exists | the same CSV import, if the file has the usual columns |

From 1 January 2028 a draft law makes the digital receipt the standard (a QR code at the till, e-mail or app, no
shop app needed). Nothing is known about the format yet.

### Online orders from a file (Settings > Receipt sources > Online orders)

Pick the CSV, see what was found, import. The columns are found by their **heading**, not their place (Amazon renamed
"Total Amount" to "Total Owed" between versions), English or German: order number, order date, product name, quantity
and an amount (the total, or the unit price times the quantity). Rows with the same order number become one order;
cancelled rows, other currencies, rows without an amount or a readable date are left out and counted in the preview.
A file whose columns are not found is refused with the headings it has. The orders are stored as receipts of the shop
(`orders_file`), once per shop and order number, and matched to bank payments. The file is read on the phone; the server
only receives the orders (`POST /v1/receipts/orders/import`, at most 200 orders of 200 lines).

It was tested with files shaped like the documented Amazon export and run end to end in a desktop browser against the
real server; **it was not tried with a real Amazon file**, whose exact columns differ between versions.

### Share to Financer (phone app only)

The share menu of the phone gets a Financer entry (`expo-share-intent`): share a receipt (PDF, JPEG, PNG or text)
from the dm, Rossmann, Edeka, Netto or Penny app, a PDF invoice, or an order CSV. The Share screen says what it is and
reads it only after you tap the button: a receipt goes through the same reading as a scanned one (your configured AI
provider, the items stored once), a CSV opens the order import. A link cannot be read, and HEIC photos are refused with
the reason. iOS gets a share extension (a second target in the Xcode project); Android gets intent filters for PDF,
images and text. **It needs a new native build, was never run on a phone**, and the iOS extension may need extra signing
setup for device builds.
