# The UI package (`packages/ui`) and its catalog (`apps/catalog`)

Every visual element of the shopping assistant comes from `packages/ui`. A screen never contains a
padding, margin, gap, size, radius, font size, shadow or colour of its own; it names a **token**.
The research behind the shapes of the screens is in [UI_RESEARCH.md](UI_RESEARCH.md).

> **The requirement** (also in `CLAUDE.md`): no manual spacing, sizes or colours in screens or app
> code. `packages/ui/tests/guard.test.mjs` fails when it happens and CI runs it.

## Layout of the package

| Folder | What is in it |
| --- | --- |
| `src/constants/` | **The only place for raw numbers and colour values.** Tailwind's palette (v3.4 hex values), spacing on a 4 px grid, radius, font sizes with line heights, shadows, breakpoints, touch and control sizes. |
| `src/theme/` | `ThemeProvider`, light and dark colour roles built from the palette, `useTheme()`. |
| `src/responsive/` | `useLayout()` (layout class, columns, device), `Responsive<T>` values, `Viewport` (forces a width, used by the catalog). |
| `src/primitives/` | `Box`, `Stack`, `Row`, `Spacer`, `Text`, `Icon`, `Touchable`: they turn token props into styles. |
| `src/components/` | Button, Chip, Badge, Banner, Card, TextField, Switch, Checkbox, Segmented, OptionList, Meter, ScoreRing, Sparkline, Skeleton, Spinner, EmptyState, ListItem, Thumbnail, Divider. |
| `src/layout/` | `Screen`, `Section`, `Sheet`, `TopBar`, `Grid`, and the adaptive navigation (`AppShell`). |
| `src/shop/` | Shopping pieces built on the above: `ProductCard`, `ProductGrid`, `PriceTag`, `DealBadge`, `FilterBar`, `OfferRow`, `PriceHistory`, `ComparisonTable`. |

## Tokens

- **Spacing** is a named scale: `2xs` 2, `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24, `2xl` 32, `3xl` 48,
  `4xl` 64 (px). Props: `p`, `px`, `py`, `pt`/`pr`/`pb`/`pl`, `m*`, `gap`.
- **Colour** is a *role*, never a value: `bg="surface" | "sunken" | "raised"`, text `tone="muted" | "subtle" | "accent" | "danger" ...`,
  and the status tones `neutral | accent | success | warning | danger | info`, each with
  `solid / onSolid / soft / onSoft / text / line`. Light and dark are two sets of the same roles; contrast
  of every pair is tested against WCAG AA (`tests/contrast.test.ts`).
- **Type** is a variant: `display, title, heading, subheading, body, bodyStrong, label, caption, price, priceLarge, number`.
- **Radius, shadow, sizes**: `radius="md"`, `shadow="sm"`, `control="md"`, `touch` (minimum 44 px target).

```tsx
<Card p="lg" gap="md" tone="accent">
  <Text variant="heading">Best fit</Text>
  <Button label="Compare" onPress={go} />
</Card>
```

## Responsive

Three layout classes by width, from Tailwind's breakpoints: **compact** (< 768, phone), **medium**
(768–1023, tablet), **expanded** (≥ 1024, laptop and web). Screens never test pixels:

- `useLayout()` returns the class and the grid column count (2 / 3 / 4 / 5).
- Any token prop can be responsive: `p={{ compact: "md", expanded: "xl" }}`.
- `AppShell` swaps the bottom bar (compact), the rail (medium) and the sidebar (expanded).

## Adding something

1. A missing value → add a token in `src/constants/` (and a test if it has a contrast or scale rule).
2. A missing element → add a component under `src/components|layout|shop`, reading tokens only, export it from `src/index.ts`.
3. Show it in the catalog: add a story in `apps/catalog/src/stories/`.
4. `make ui-test` must stay green.

## The catalog

A Widgetbook-style app, `apps/catalog`: every component in every state, with a theme switch (light /
dark), a device switch (phone 390 / tablet 820 / desktop 1280, rendered through `Viewport`) and the
token tables.

```
make ui-catalog          # in the browser, with live reload
make ui-catalog-export   # static build in apps/catalog/dist
```

It is a small purpose-built app and not Storybook or Widgetbook itself: the real tools need extra
dependencies and a build of their own, and the repository's rule is not to add a UI library without
asking.

## What is not covered

- `apps/mobile` (the finance app) still uses HeroUI and its own tokens; it is **not** migrated.
- The catalog was checked in a desktop browser at the three device widths; it was not run on a physical phone or tablet.
