# Live Sparkasse sync with FinTS

CSV import works without any of this. Live sync needs a registration that takes weeks, so
start it early.

## What is implemented

The server talks to your Sparkasse with the [`fints-rs`](https://crates.io/crates/fints-rs)
crate (FinTS 3.0 PinTan). The flow in the app (**Spending → Sync with Sparkasse**):

1. You enter bank code (BLZ), online banking login, IBAN and PIN. The PIN is sent to your
   server for this sync only, kept in memory until you approve, and never stored or logged.
   The app can remember it in the phone's secure storage if you switch that on.
2. The bank asks you to approve in the **S-pushTAN app**. The app shows the bank's text and
   checks every 3 seconds (the server answers 409 until you approve; a started sync expires
   after 10 minutes).
3. After approval the server fetches the balance and booked transactions, categorizes them like
   a CSV import and skips what it already has.

**Only pushTAN is supported** (approval in the banking app). `fints-rs` completes the
"decoupled" flow by polling; a method where you type a TAN (chipTAN, SMS) is refused with a
clear message.

## What is verified, and what is not

- **Verified against the `fints-rs` mock bank** (real FinTS 3.0 messages, run in CI): login,
  dialogs, balance, and MT940 transaction parsing through to Financer's types; a wrong PIN is
  recognised; an unreachable bank is a connection error.
- **Verified against a simulated pushTAN bank:** the stock mock stubs TANs, so
  `crates/fints/tests/mock/decoupled-tan.patch` implements the decoupled flow it was meant to have
  (login answers 0030/3955 with a challenge, polls answer 3956 until the approval time, then
  0020). Against that, the real client code shows the bank's challenge text, keeps answering
  "pending" while you have not approved, and delivers the data once you have. Build it with
  `crates/fints/tests/mock/build.sh <dir>`.
- **Verified with mocks of my own trait:** the whole approval flow in the API (waiting, 409 until
  approved, expiry, import, no duplicates, the PIN never in a response).
- **Still unverified:** how a *real* Sparkasse words and sequences its pushTAN messages. The
  simulation follows the FinTS 3.0 flow as `fints-rs` implements it (0030/3955, `HITAN`,
  `HKTAN` process S, 3956, 0020); a bank that deviates (a different TAN medium to pick, TAN
  already required at login for every request, or a different code on approval) is the most
  likely thing to need work on a first live run.
- **Never run against a real Sparkasse:** that needs your product ID and credentials. Things that
  differ per bank: TAN medium selection, how far back the bank lets you read without extra
  approval (often 90 days), and the BIC. Errors from the bank are shown in the app.

## Connections in `financer.toml` (scheduled sync)

Instead of typing bank code, login and IBAN into the app every time, describe the connection once
in the server's `financer.toml` (all keys: [CONFIG.md](CONFIG.md)):

```toml
[bank]
fints_product_id = "${FINTS_PRODUCT_ID}"

[[bank.accounts]]
name = "Girokonto"
bank_code = "37050198"
login = "your-login-name"
iban = "DE89 3704 0044 0532 0130 00"
pin_env = "SPARKASSE_PIN"     # optional; without it you type the PIN in the app
sync_every_hours = 12         # 0 = only when you press "Sync now"
since_days = 90               # how far back the first import reaches
```

What this does and does not do:

- **The PIN is never in the file and never stored.** It comes from the environment variable named
  by `pin_env` (read when a sync starts), or you type it in the app (Settings > Bank connections
  > Sync now); then it is used for that sync only.
- **You still approve every login.** pushTAN needs you, so a scheduled sync cannot finish alone:
  it **starts by itself** (when the server has the PIN through `pin_env`), logs in, and then waits
  in the state `needs_approval`. The app shows the bank's text. When you approve in your banking
  app the server notices within a few seconds (it asks the bank every 5 seconds) and imports; the
  app does not have to stay open. If no approval arrives within 10 minutes the sync is given up
  (state `error`) and the next one starts at the next interval.
- A connection **without** `pin_env` cannot start by itself. When its schedule is due the app shows
  "sync due" and waits for you to press Sync now and type the PIN.
- **A refused login is never retried automatically.** After a wrong PIN or a locked login the
  connection shows an error and the scheduler leaves it alone, also across restarts, until you sync
  it by hand (so a wrong PIN in the environment cannot lock your online banking). Other failures
  (bank unreachable, approval timed out) are retried at the next interval, not every minute. The
  existing pause after two wrong PINs (15 minutes) applies to all syncs together.
- **No duplicates.** Imports go through the same de-duplication as a CSV import and the manual
  sync. After the first import a sync reads from the last successful one minus 7 days, so
  overlapping periods are harmless.
- `GET /v1/bank/connections` lists the connections without secrets (login and IBAN masked) with
  `state` (`idle`, `syncing`, `needs_approval`, `error`), the bank's message, the last result and
  the next scheduled time. `POST /v1/bank/connections/{name}/sync` (optional body `{"pin": "..."}`)
  starts one and `POST .../cancel` stops waiting.
- The older manual flow (`POST /v1/bank/sync`, **Spending > Sync with Sparkasse**) is unchanged. The
  app offers it on the Bank connections card only when no connection is configured. The on-phone
  backend has no config file, so it has no configured connections.
- `fints_url` (with `bic`) is for a bank that `fints-rs` does not know by bank code.

**What was tested:** all of the above against a scripted bank in the API tests (approval wait,
import, idempotence, scheduling, no retry after a refused login, timeouts, cancel, nothing secret in
any response), and the real server binary was started with such a file and answered the list and a
sync request (the sync failed at the network, as the sandbox cannot reach a bank). The one new piece
of FinTS client code, using `fints_url` instead of the registry, has a test against the `fints-rs`
mock server that was **not run** here (the mock server binary was not available).
**Not tested:** any of this against a real Sparkasse, how often a bank wants a fresh approval for a
background login, and whether banks accept the repeated logins of a schedule without extra
approvals or limits. Check the first few runs by hand.

## Protecting your account from lockout

Banks typically lock online banking after about three wrong PINs. After **two** wrong PINs in a
row (or one "locked" answer) Financer pauses new syncs for 15 minutes and says why, so a typo in
the saved PIN cannot lock you out. The bank's own error codes vary (`fints-rs` only knows 9340
and 9942; real banks commonly use 9931), so wrong-PIN and locked answers are recognised by code
and by message text.

## Setup

1. **Register your FinTS product** with the Deutsche Kreditwirtschaft (free PDF form on
   hbci-zka.de). You get a *product ID*. Reports from other open-source FinTS clients say the ID
   arrives within about two weeks and can then take anywhere from days to 8+ weeks to be accepted
   by your bank's server. Check the current process on the official site.
2. **Enable FinTS / HBCI** for your account in Sparkasse online banking if it is not already.
3. Set `FINANCER_FINTS_PRODUCT_ID` on the server (or enter it in the app's on-phone settings).
   Without it the sync screen says live sync is not set up.
4. `fints-rs` knows the FinTS URL of about 1,700 banks by bank code, so you do not enter one.

## Caveat

FinTS is the legacy channel. The Sparkassen have kept it open under a BaFin exemption, but it
could be retired. CSV import remains the fallback.
