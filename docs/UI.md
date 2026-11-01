# The UI package (`packages/ui`) and its catalog (`apps/catalog`)

Every visual element of the shopping assistant comes from `packages/ui`. A screen never contains a
padding, margin, gap, size, radius, font size, shadow or colour of its own; it names a **token**.
The research behind the shapes of the screens is in [UI_RESEARCH.md](UI_RESEARCH.md).

> **The requirement** (also in `CLAUDE.md`): no manual spacing, sizes or colours in screens or app
> code. `packages/ui/tests/guard.test.mjs` fails when it happens and CI runs it.

## Layout of the package

| Folder | What is in it |
| --- | --- |
| `src/constants/` | **The only place for raw numbers and colour values.** Tailwind's neutral, green, yellow, red and sky (v3.4 hex values) and Untitled UI's brand violet, spacing on a 4 px grid, radius, font sizes with line heights, shadows, breakpoints, touch and control sizes. |
| `src/theme/` | `ThemeProvider`, light and dark colour roles built from the palette, `useTheme()`. |
| `src/responsive/` | `useLayout()` (layout class, columns, device), `Responsive<T>` values, `Viewport` (forces a width, used by the catalog). |
| `src/primitives/` | `Box`, `Stack`, `Row`, `Spacer`, `Text`, `Icon`, `Touchable`: they turn token props into styles. |
| `src/components/` | Button (six variants), Chip, Badge, Banner, Card, TextField, Switch, Checkbox, Segmented, OptionList, Meter, ScoreRing, Sparkline, Skeleton, Spinner, EmptyState, ListItem, Thumbnail, Divider. |
| `src/layout/` | `Screen`, `Section`, `Sheet`, `TopBar`, `Grid`, and the adaptive navigation (`AppShell`). |
| `src/shop/` | Shopping pieces built on the above: `ProductCard`, `ProductGrid`, `PriceTag`, `DealBadge`, `FilterBar`, `OfferRow`, `PriceHistory`, `ComparisonTable`. |

## Design language: Untitled UI and HeroUI

The look combines two sources. What was actually read from each is listed so nothing is claimed
that was not checked.

**From the Untitled UI community kit** (Figma file, read through the Figma tools):
- Colours: the kit uses Tailwind's **neutral, green, yellow and red** for its badges (neutral 100/700,
  green 50/700, yellow 50/700, red 50/700; read from the file) and a custom **violet brand** (brand 50
  `#f9f5ff` and 700 `#6941c6` read from the file). Our palette uses exactly these; the other brand steps
  are the kit's published ramp, **not read from the file**.
- Badges: a pill, 10 x 2 padding, 14/20 Inter medium, soft fill with the dark step as text (read).
- Toggles 44 x 24 (36 x 20 small), the 4 px spacing grid, containers of 640/768/1024/1280, 16 px phone
  margins and 32 px tablet and desktop margins (read from the file's metadata).
- Inputs and the focus halo (a 4 px brand-100 ring, a faint `xs` shadow) follow the kit's style from
  memory: the input and button nodes could not be read (the Figma tool timed out on them).

**From HeroUI** (read from its `heroui-native` style sheets in `apps/mobile/node_modules`):
- Shapes: buttons are pills (radius 3xl = 24, 4xl = 32 for large) at heights 40, 48 and 56; fields have
  a 14 px radius; cards are 24 px; a switch is 48 x 24 with an oval 28 x 20 knob.
- Variants: button primary, secondary, tertiary, outline, ghost, danger, danger-soft; chips are soft
  fills without an outline; fields are filled.
- Layering: page, white surface, a neutral secondary fill; soft layered shadows in the light theme and
  none in the dark one (overlays get a faint inner rim instead). Labels are medium weight.

**Ours on top:** a selected chip also shows a check (never colour alone), text colours are tuned so
every pair passes WCAG AA (`tests/contrast.test.ts`), and every size and radius is a token.

**Not done:** Inter is used where the machine has it (the web stack lists it first). No font file is
bundled, because loading one on the phones needs a font package; ask if you want it.

## Tokens

- **Spacing** is a named scale: `2xs` 2, `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24, `2xl` 32, `3xl` 48,
  `4xl` 64 (px). Props: `p`, `px`, `py`, `pt`/`pr`/`pb`/`pl`, `m*`, `gap`.
- **Colour** is a *role*, never a value: `bg="surface" | "sunken" | "raised"`, text `tone="muted" | "subtle" | "accent" | "danger" ...`,
  and the status tones `neutral | accent | success | warning | danger | info`, each with
  `solid / onSolid / soft / onSoft / text / line`. Light and dark are two sets of the same roles; contrast
  of every pair is tested against WCAG AA (`tests/contrast.test.ts`).
- **Type** is a variant: `display, title, heading, subheading, body, bodyStrong, label, caption, price, priceLarge, number`.
- **Radius, shadow, sizes**: `radius="3xl"`, `shadow="surface"` (also `field`, `overlay`, `xs`), `control="md"` (xs 32, sm 40, md 48, lg 56), `touch` (minimum 44 px target), `ring="focus"`.

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
