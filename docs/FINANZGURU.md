# Finanzguru – Finance Manager (Play Store) parity

Target: https://play.google.com/store/apps/details?id=de.dwins.financeguru (dwins GmbH, 1M+ downloads, 4.4★).

## Research evidence

Listing and screenshots fetched from `play-lh.googleusercontent.com`, saved as
`/home/default/finanzguru-ref/shot1.jpg` … `shot4.jpg`. Dominant colours sampled
directly from the store images with Pillow:

| Colour | Sample | Use |
| --- | --- | --- |
| Deep indigo | `#3C318F` | hero / onboarding / app primary |
| Off-white canvas | `#F2F1F6` | screen background |
| White | `#FFFFFF` | cards, chips |
| Navy ink | `#2A2166` | headings, amounts |
| Mint | `#C9F2DC` | category pills, progress |
| Violet | `#7B3FE4` | Plus badge, saving tips |

## Screens reproduced

| Store screenshot | Local route | What matches |
| --- | --- | --- |
| shot1 – Overview | `/home` | Overview title, purple Statistics card (`823 €` available, `16 days until payday`), budget dial row + `Show all`, Accounts (Checking `3.205,99 €`, Credit card `-256,36 €`, PayPal `37.30 €`), Investments (`12.187,22 €`), 5-tab bar |
| shot4 – Contracts | `/contracts` | Contracts title + calendar/sort icons, `Ø 1.102 € / month` card with `Insights`, `2 money-saving tips`, `Sort by cycle`, `Monthly 1.102,00 €`, merchant rows (RE/MAX, HUK Coburg, E.ON, Telekom, Netflix, Spotify) |
| shot3 – Automatically categorised | `/categorised` | Floating Living / Leisure / Food & Drinks chips, merchant list with mint category pills and checks |
| shot2 – Connect accounts | `/connect` | Full indigo hero, bold white `Connect accounts` headline, six floating white bank-logo circles |

The bottom tab bar now uses the Finanzguru labels: Overview, Contracts, Insights,
Insurance, Savings Booster. All pre-existing recipes / shopping / offers / money
tracker routes are preserved and reachable from the grid icon on Overview and the
All apps hub.

## Single design system

One UI kit only: `packages/finance-ui`. The Finanzguru screen components live in
`src/finanzguru.tsx` and share the same tokens as every other screen.
`apps/mobile/src/ui/primitives.tsx` and `theme.ts` are thin compatibility shims.
Primary app colour: dark purple `#3C318F`.

Stitch reference project: `17031347711862038285` ("Finanzguru parity screens").
