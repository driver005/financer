# Public demo

Dompetku can run as a **public demo**: a separate deployment with its own throwaway database,
fake data and a login that is shown to everyone. It uses the same code as a normal instance; one
environment variable, `DEMO_MODE=true`, turns on the demo behaviour.

**Official demo:** <https://demo.dompetku.ilramdhan.dev> — the login is shown on the login page
("Masuk ke demo" signs you in with one click). Data resets every day at **00:00 WIB**.

> [!CAUTION]
> Never set `DEMO_MODE=true` on an instance that holds real data. A demo instance publishes its
> login credentials to every visitor. Always use a **second, empty** Supabase project for it.

## How it works

| Area              | Normal instance                              | Demo instance (`DEMO_MODE=true`)                                                                                                         |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Login             | Private username/password, optional 2FA      | Banner "data palsu, direset setiap hari", prefilled credentials, one-click **Masuk ke demo**. 2FA is never enforced or enrollable.       |
| Data              | Yours, permanent                             | Fake data from `scripts/seed-demo.mjs`, wiped and reseeded daily by `.github/workflows/demo-reset.yml`. Visitors can create/edit/delete. |
| In-app            | —                                            | Slim dismissible banner ("Data direset setiap hari · Install sendiri →") on every page load.                                             |
| Landing page      | "Coba demo" link if `PUBLIC_DEMO_URL` is set | Hero CTA becomes **Masuk ke demo**; no link to itself.                                                                                   |
| Disabled features | —                                            | Receipt OCR and AI text parsing, receipt photo upload, CSV import, backup restore, app settings save (incl. logo), 2FA enrolment.        |
| Automation        | `/api/public/n8n/*` with `N8N_API_KEY`       | Every n8n route answers `403 {"ok":false,"error":"demo"}` (no bot, backup or reminder email).                                            |
| Row caps          | —                                            | 3000 transactions and 200 rows per other table; beyond that: "Batas data demo tercapai, coba lagi setelah reset".                        |
| Write rate limit  | —                                            | 120 write requests (server-function POSTs) per IP per sliding 10 minutes; reads are unlimited.                                           |
| Backup export     | Available                                    | Still available (it only contains fake data).                                                                                            |

Every guard is enforced on the **server** (the UI also hides or disables the matching buttons).
With `DEMO_MODE` unset every guard is a no-op, so normal instances behave exactly as before.

**Why these limits?** The demo runs on free tiers. AI calls and photo uploads cost money or
storage and could be abused for unrelated content; restore/settings/2FA would let one visitor
break or lock the demo for everyone; automation endpoints have no use without the owner's bot.
The caps and the rate limit keep the database small between resets.

**Limitation:** the rate limiter keeps its counters in memory, so on Vercel each warm serverless
instance counts separately. It is a soft limit against casual abuse, not a hard quota; the row
caps and the daily reset are the real backstop.

## Run your own public demo

You need a **second** Supabase project and a **second** Vercel project from the same repository.

1. **Supabase:** create a new project (free tier is fine) and run the whole
   [`supabase/schema.sql`](../supabase/schema.sql) once in the SQL Editor — the same as a normal
   install ([SELF-HOSTING.md](SELF-HOSTING.md)).
2. **Vercel:** import the same GitHub repository as a new project and set:

   | Variable                    | Value                                                                |
   | --------------------------- | -------------------------------------------------------------------- |
   | `DEMO_MODE`                 | `true`                                                               |
   | `APP_USERNAME`              | `demo`                                                               |
   | `APP_PASSWORD`              | any password — **it is shown publicly** on the login page            |
   | `SESSION_SECRET`            | a fresh random string of ≥ 32 characters (`openssl rand -base64 48`) |
   | `SUPABASE_URL`              | the **demo** project's URL                                           |
   | `SUPABASE_SERVICE_ROLE_KEY` | the **demo** project's secret key                                    |
   | `APP_TIMEZONE`              | `Asia/Jakarta` (optional)                                            |

   Leave `AI_*`, `N8N_API_KEY`, `BOT_*`, `RESEND_API_KEY`/`EMAIL_*`, `APP_TOTP_SECRET` and
   `SENTRY_DSN` **empty**.

3. **First seed:** from your machine (with the demo project's URL and key):

   ```bash
   SUPABASE_URL=https://<demo-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<demo key> \
   DEMO_RESET_CONFIRM=yes node scripts/seed-demo.mjs --reset --allow-remote
   ```

   For any non-local database the script refuses to run unless **both** `--allow-remote` and
   `DEMO_RESET_CONFIRM=yes` are given. `--reset` deletes **everything**: all tables, visitor rows,
   activity log, bot drafts, budget alerts, app settings (back to defaults), categories (back to
   the schema defaults) and every photo in the `receipts` bucket. Dates are relative to "today",
   so the demo always looks current.

4. **Daily reset:** in the GitHub repository → **Settings → Secrets and variables → Actions**, add
   `DEMO_SUPABASE_URL` and `DEMO_SUPABASE_SERVICE_ROLE_KEY` (demo project only!). The workflow
   [`demo-reset.yml`](../.github/workflows/demo-reset.yml) runs daily at 17:00 UTC (= 00:00 WIB)
   and can be started by hand (**Actions → Demo reset → Run workflow**). It only runs on the
   upstream repository (`if: github.repository == 'ilramdhan/dompetku'`); in a fork, change that
   line to your own `owner/repo`.
5. **Domain (optional):** in Vercel → the demo project → **Settings → Domains**, add e.g.
   `demo.example.com`. At Cloudflare (or your DNS provider) add a `CNAME` record
   `demo` → `cname.vercel-dns.com` with the proxy **off** (DNS only, grey cloud) so Vercel can
   issue the certificate.
6. **Link it from your main instance:** set `PUBLIC_DEMO_URL=https://demo.example.com` on the
   **main** (private) Vercel project and redeploy. The landing page then shows **Coba demo** in
   the navbar, hero and final call-to-action. Empty = hidden.

## Costs

Both projects fit in the free tiers of Supabase and Vercel for a personal demo. The demo uses no
AI, email or bot, so it has no per-request costs. Free Supabase projects pause after a week
without activity; the daily reset workflow touches the database every day, which keeps it awake.
