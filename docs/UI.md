# The UI package (`packages/ui`) and its catalog (`apps/catalog`)

Every visual element of both apps, the finance app and the shopping assistant, comes from `packages/ui`. A screen never contains a
padding, margin, gap, size, radius, font size, shadow or colour of its own; it names a **token**.
The research behind the shapes of the screens is in [UI_RESEARCH.md](UI_RESEARCH.md).

> **The requirement** (also in `CLAUDE.md`): no manual spacing, sizes or colours in screens or app
> code. `packages/ui/tests/guard.test.mjs` fails when it happens and CI runs it.

## Layout of the package

| Folder | What is in it |
| --- | --- |
| `src/constants/` | **The only place for raw numbers and colour values.** HeroUI's palette (converted to hex) and Tailwind's sky, spacing on a 4 px grid, radius, font sizes with line heights, shadows, breakpoints, touch and control sizes. |
| `src/theme/` | `ThemeProvider`, light and dark colour roles built from the palette, `useTheme()`. |
| `src/responsive/` | `useLayout()` (layout class, columns, device), `Responsive<T>` values, `Viewport` (forces a width, used by the catalog). |
| `src/primitives/` | `Box`, `Stack`, `Row`, `Spacer`, `Text`, `Icon`, `Touchable`: they turn token props into styles. |
| `src/components/` | Button (six variants), Chip, Badge, MatchBadge, Hint, Banner (with a retry action), Card, TextField, Switch, Checkbox, Segmented, OptionList, Meter, ScoreRing, Sparkline, Skeleton, Spinner, EmptyState (also as a `card`), ListItem, Thumbnail, Divider. |
| `src/layout/` | `Screen`, `Section` (title, tag, count, `card`), `Sheet` (a bottom sheet with a handle on a phone), `Split` (side by side from a tablet up), `TopBar`, `Grid`, and the adaptive navigation (`AppShell`). |
| `src/shop/` | Shopping pieces built on the above: `ProductCard`, `ProductGrid`, `PriceTag`, `DealBadge`, `FilterBar`, `OfferRow`, `PriceHistory`, `ComparisonTable`, `SavingsBar`, `ProductCardSkeleton`. |

## Design language: HeroUI

The shopping app looks like the finance app, which uses HeroUI, so the two feel like one product. The
values were read from HeroUI Native's own style sheets (the library the finance app used before it moved onto this
package), converted from oklch to sRGB hex (`palette.hero` in `constants/palette.ts`).

- **Colour:** HeroUI's neutral zinc greys, its blue accent, green, amber and red; a light page with white
  surfaces and a grey secondary fill; in the dark theme a near-black page with `#18181b` surfaces. Status
  colours also come as soft fills (15 % of the colour over the surface) with a darker text.
- **Shape:** buttons are pills (radius 24, 32 for large) at 40, 48 and 56 px; fields have a 14 px radius, no
  outline at rest (the accent colour on focus, red on error); cards are 24 px; a switch is 48 x 24 with an
  oval 28 x 20 knob; chips are soft fills without an outline.
- **Depth:** soft layered shadows under cards and white fields in the light theme, none in the dark one
  (the lighter fill does the lifting; overlays get a faint inner rim).
- **Type:** the system font (Inter where the machine has it), medium-weight labels.
- **Variants:** button solid, secondary (grey fill), tertiary, soft, outline and ghost, as in HeroUI.

**Where it departs on purpose (accessibility).** HeroUI puts near-white text on its blue and red at 3.6:1
and 3.5:1, and its muted text on its grey fills is 4.2:1; WCAG AA asks for 4.5:1. So the blue and red faces
are a little darker (`#0485f7` to `#0072e2`, `#ff383c` to `#e71226`), and muted text and the text colours of a
tone are mixed towards the foreground until they pass (`tests/contrast.test.ts`). HeroUI's green and amber
fills are light by design and carry dark text (8:1); they are only 2:1 against white as shapes.

**Stitch.** The Stitch project "Shopping Assistant" holds the HeroUI design system and the screens (search,
product, compare, weights, deals, plans, web and tablet) that the app was compared against. The app takes
their structure (the pick card with a label row, a Match pill and a View deal button; the grouped
"understood" strip; the savings bar; quick budgets; deal filters) but not their invented copy, and it keeps
its own comparison table and level chips where Stitch drew grouped cards and sliders.

**Earlier looks.** A violet, Untitled-UI-flavoured version, a Duolingo-style chunky version (thick edges,
bold capitals, Nunito) and several Stitch explorations were tried and set aside. The Stitch project
"Shopping Assistant" still holds the explorations.

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

## The finance app

`apps/mobile` is built on this package too. Its screens (`src/app`) and the components they are made of
(`src/components`) contain no style prop, no `StyleSheet`, no `View`/`Text` from react-native, no colour and no
raw spacing or size; `tests/guard.test.mjs` enforces it for these folders as for the shopping assistant.

What the finance screens needed beyond the shopping ones lives in `packages/ui/src/finance` and `components`:

| Piece | Used for |
| --- | --- |
| `Money` | every amount: German notation, real minus sign, tabular, one line; income green, spending plain |
| `HeroCard`, `HeroChip`, `HeroFigure`, `HeroNumber`, `HeroCaption`, `HeroStats`, `HeroProgress` | the one filled card at the top of a screen |
| `BarChart`, `ColumnChart`, `CurveChart`, `DonutChart`, `CompareBars`, `ProgressRing` | charts; each takes a `summary` sentence that is its screen reader label |
| `Group`, `ListItem` (`tile`, `value`, `note`, `tone`, `disclosure`, `leading`), `ToggleRow`, `Expandable`, `ConfirmAction`, `Note` | settings and lists |
| `IconBadge`, `Stepper`, `TileButton`, `ChoiceCard`, `Snackbar` | small controls |
| `VirtualList` | long lists, in the same readable column as a `Screen` |
| `Mascot`, `MascotFace`, `Confetti`, `ScanFrame`, `Cover` | the playful and the camera parts |

The calendar (`packages/ui/src/calendar`) adds `MonthGrid`, `TimeGrid` (week, 3 days and day), `AgendaList`
(schedule), `MiniMonth`, `TimePicker` and `FloatingButton`, and `layout/Scroll` is a scrolling area for pages that
do not scroll themselves. They take plain data (`CalendarItem`, `DayColumn`, `MonthCell`, ...); the dates and
repeats are worked out in the app, see [CALENDAR.md](CALENDAR.md).

The app adds a few components of its own on top (`Page` for the title bar, `AppFrame` for the adaptive navigation,
`Loading`, `Empty` and `NeedsSetup` in `Status.tsx`, `SectionSwitch`); they use only this package.

## What is not covered

- Logic files (`src/*.ts`, `src/native`, `src/api`) name colours the old way (`"good"`, `"warn"`) and icons as plain
  strings; `src/uiTone.ts` turns those into tones and icon names at the edge.
- The catalog was checked in a desktop browser at the three device widths; it was not run on a physical phone or tablet.
