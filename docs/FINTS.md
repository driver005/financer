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
- **Verified with mocks of my own trait:** the whole approval flow in the API (waiting, 409 until
  approved, expiry, import, no duplicates, the PIN never in a response).
- **Not verified, because the mock bank cannot do it:** TAN challenges and the polling for your
  approval. The mock answers TAN requests with a stub. This is the part most likely to need work
  on a first live run.
- **Never run against a real Sparkasse:** that needs your product ID and credentials. Things that
  differ per bank: TAN medium selection, how far back the bank lets you read without extra
  approval (often 90 days), and the BIC. Errors from the bank are shown in the app.

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
