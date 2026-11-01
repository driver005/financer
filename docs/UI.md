# The UI package (`packages/ui`) and its catalog (`apps/catalog`)

Every visual element of the shopping assistant comes from `packages/ui`. A screen never contains a
padding, margin, gap, size, radius, font size, shadow or colour of its own; it names a **token**.
The research behind the shapes of the screens is in [UI_RESEARCH.md](UI_RESEARCH.md).

> **The requirement** (also in `CLAUDE.md`): no manual spacing, sizes or colours in screens or app
> code. `packages/ui/tests/guard.test.mjs` fails when it happens and CI runs it.

## Layout of the package

| Folder | What is in it |
| --- | --- |
| `src/constants/` | **The only place for raw numbers and colour values.** Tailwind's neutral and red/sky (v3.4 hex values) and the Duolingo-style `duo` set, spacing on a 4 px grid, radius, font sizes with line heights, shadows, breakpoints, touch and control sizes. |
| `src/theme/` | `ThemeProvider`, light and dark colour roles built from the palette, `useTheme()`. |
| `src/responsive/` | `useLayout()` (layout class, columns, device), `Responsive<T>` values, `Viewport` (forces a width, used by the catalog). |
| `src/primitives/` | `Box`, `Stack`, `Row`, `Spacer`, `Text`, `Icon`, `Touchable`: they turn token props into styles. |
| `src/components/` | Button (six variants, pressable keys), Chip, Badge, Banner, Card, TextField, Switch, Checkbox, Segmented, OptionList, Meter, ScoreRing, Sparkline, Skeleton, Spinner, EmptyState, ListItem, Thumbnail, Divider. |
| `src/layout/` | `Screen`, `Section`, `Sheet`, `TopBar`, `Grid`, and the adaptive navigation (`AppShell`). |
| `src/shop/` | Shopping pieces built on the above: `ProductCard`, `ProductGrid`, `PriceTag`, `DealBadge`, `FilterBar`, `OfferRow`, `PriceHistory`, `ComparisonTable`. |

## Design language: chunky and playful, in the manner of Duolingo

The look is thick, round and bright, after Duolingo's app. What it rests on, and what is ours:

- **Keys, not flat buttons.** A solid button, a card and a chip sit on a thick lower **edge** in a darker
  shade (`edge` prop, 4 px, 2 px for small things). A pressed button sinks onto its edge. Soft and white
  faces have a 2 px line and a matching edge.
- **Bright faces.** Green (the main action), blue (selected things and the navigation), red, yellow, with
  tinted soft fills (`soft`, `line`) for badges, banners and selected rows. The dark theme is a blue-green
  night (`#131f24`) with the same bright faces.
- **Round everything.** Controls are 16 px radius, buttons 48, 56 and 64 px high, a 56 x 32 switch whose knob
  springs, progress bars 16 px thick with a light streak, a thicker score ring.
- **Round bold type.** Nunito (`@expo-google-fonts/nunito`, loaded by `ThemeProvider`), every weight one step
  heavier than its name; button labels and badges are bold capitals.
- Earlier steps of this restyle took values from the Untitled UI community kit (its badge and toggle
  proportions and the Tailwind-based status colours) and HeroUI's component set (variants, sizes); the
  neutral greys and the variant names stay from that.

**What is a copy and what is not.** Duolingo's own values are not public. The faces `#58cc02`, `#1cb0f6`,
`#ff4b4b`, `#ffc800`, the green and blue edges (`#58a700`, `#1899d6`) and the pale tints are the values
third-party style guides list for it; none was read from Duolingo, so this is "in the manner of", not a copy
(see `duo` in `constants/palette.ts`).

**Where it departs on purpose (accessibility).** Duolingo puts white text on its bright faces. White on
`#58cc02` is 2.1:1, on `#1cb0f6` 2.4:1, on `#ffc800` 1.6:1, all below WCAG AA's 4.5:1. So text on a bright face
is dark ink, text colours (green, blue, red, yellow on white) are darker steps, the yellow edge is darker
(`#a87a00`), and a control counts as visible when its face or its edge reaches 3:1 (`tests/contrast.test.ts`).
To get white labels back, change `onSolid` in `constants/colors.ts` and relax that test knowingly.

## Tokens

- **Spacing** is a named scale: `2xs` 2, `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24, `2xl` 32, `3xl` 48,
  `4xl` 64 (px). Props: `p`, `px`, `py`, `pt`/`pr`/`pb`/`pl`, `m*`, `gap`.
- **Colour** is a *role*, never a value: `bg="surface" | "sunken" | "raised"`, text `tone="muted" | "subtle" | "accent" | "danger" ...`,
  and the status tones `neutral | accent | success | warning | danger | info`, each with
  `solid / onSolid / soft / onSoft / text / line`. Light and dark are two sets of the same roles; contrast
  of every pair is tested against WCAG AA (`tests/contrast.test.ts`).
- **Type** is a variant: `display, title, heading, subheading, body, bodyStrong, label, caption, price, priceLarge, number`.
- **Radius, edge, sizes**: `radius="2xl"`, `edge="accent"` (a thick lower edge; also `"info-line"`, `"border"`), `shadow="overlay"` for sheets, `control="md"` (xs 40, sm 48, md 56, lg 64), `touch` (minimum 44 px target).

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
