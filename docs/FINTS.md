# Live Sparkasse sync with FinTS (not implemented yet)

CSV import works today. Live sync needs a registration that takes weeks, so start it early.

1. **Register your FinTS product** with the Deutsche Kreditwirtschaft (free PDF form on hbci-zka.de). You get a *product ID*. Reports from other open-source FinTS clients say the ID arrives within about two weeks, and then it can take anywhere from days to 8+ weeks until your bank's server accepts it. Check the current process on the official site.
2. **Find your Sparkasse's FinTS URL** by bank code (BLZ) in the institute list on hbci-zka.de.
3. **Enable FinTS / HBCI** for your account in Sparkasse online banking, if it is not already.
4. Expect a **pushTAN approval** on every sync. The server will expose a "TAN required" state; the app shows it and polls until you approve in your Sparkasse app.
5. The bank PIN is never stored on the server: the app sends it per sync request and the server keeps it in memory for that sync only.

Caveat: FinTS is the legacy channel. The Sparkassen have kept it open under a BaFin exemption, but it could be retired. CSV import remains the fallback.

Planned client: evaluate the `fints-rs` crate (0.2.0, reads the product ID from `FINTS_PRODUCT_ID`); if it is not mature enough, write a minimal client (dialog init, balance, statement retrieval, decoupled pushTAN).
