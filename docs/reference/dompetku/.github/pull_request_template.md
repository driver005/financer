<!--
Thanks for contributing! Please fill in the sections below.
New here? See CONTRIBUTING.md. Delete sections that don't apply.
-->

## Summary

<!-- What does this PR change, and why? -->

## Type of change

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (existing setups need manual action, e.g. new required env var)
- [ ] 📖 Documentation only
- [ ] 🌐 Translation (ID/EN)
- [ ] 🧹 Refactor / tooling / CI / dependencies

## Related issue

<!-- e.g. "Closes #123". For larger changes, please open an issue first. -->

## How was this tested?

<!-- Commands you ran and what you checked manually. -->

- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] Manually tested in the browser (describe below)

## Database schema change?

- [ ] No schema change
- [ ] Yes — added as a **new, idempotent `vN` section** at the end of `supabase/schema.sql` (old sections untouched)
- [ ] Types added to `src/lib/database.types.ts` (optional where the section may not have been run)
- [ ] New tables added to `RESTORE_TABLES` in `src/lib/backup.ts` in foreign-key order
- [ ] App degrades gracefully before the section is run (`isMissingTable()` / `isMissingFunction()`)
- [ ] Setup docs mention the new section

## New environment variables?

- [ ] None
- [ ] Added to `.env.example` and documented in `docs/ENVIRONMENT.md`; the app still works when they are not set

## Screenshots

<!-- For UI changes: mobile + desktop, light + dark mode. Redact amounts and personal data. -->

|         | Light | Dark |
| ------- | ----- | ---- |
| Mobile  |       |      |
| Desktop |       |      |

## i18n

- [ ] No new UI text
- [ ] New UI text is wrapped in `t(...)` and has an English entry in `DICT` (`src/lib/i18n.tsx`)

## Checklist

- [ ] CI is green (lint, typecheck, test, build)
- [ ] New pure logic has unit tests in `src/test/`
- [ ] Colors use semantic tokens; amounts use `money()`/`compact()` and respect privacy mode
- [ ] Docs updated if behaviour or setup changed
- [ ] No secrets, API keys, chat IDs, domains or personal financial data in code, screenshots or logs
- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md) and agree to license my contribution under the MIT License
