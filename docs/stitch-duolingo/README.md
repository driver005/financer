# Stitch redesign source

- Project: `projects/6469722255160022713` — "Pantry — Playful Finance (Duolingo-style)"
- Design system asset: `assets/9527950638711688935` — "Pantry Playful"
- Screens generated: 16, one per route (Overview, Price comparison, Contracts,
  Insights, Insurance, Savings Booster, Categorisation, Connect, Budgets,
  Transactions, Money flows, Recipes, Shopping list, Shops, All apps, Settings)

The exact generated design tokens are in `get_project.designTheme.designMd`:
Nunito Sans, primary `#58CC02`, bevel `#46A302`, mint `#D7FFB8`, chalk canvas
`#FBF9F8`, ink `#3C3C3C`, yellow `#FFC800`, orange `#FF9600`, blue `#1CB0F6`,
purple `#CE82FF`, red `#FF4B4B`. Rounded 12–24px, 2px structural borders,
extruded buttons, thick progress meters.

`DESIGN.md` and `FLOWS.md` in this folder were the inputs to Stitch and are the
source of truth for the app implementation:

- `packages/finance-ui/src/tokens.ts` — palette, Nunito Sans, radii
- `packages/finance-ui/src/primitives.tsx` — 24px bordered cards, 54px beveled
  buttons, chunky chips/inputs/progress
- `packages/finance-ui/src/playful.tsx` — `PlayHero`, `StreakBadge`, `XpBar`,
  `MascotEmpty`, `StepCard`
- `apps/mobile/src/app/_layout.tsx` — five-tab green bottom nav, Nunito Sans fonts

All 21 routes were verified in light and dark at 320/375/390/430px: 168 checks,
zero overflow, zero console errors.
