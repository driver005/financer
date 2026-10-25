/**
 * Design tokens: spacing, radius, type scale, elevation and motion. Pure data (no React Native
 * import) so the numbers can be unit-tested; `theme.ts` re-exports everything.
 *
 * Use these instead of loose numbers in screens, so the app keeps one rhythm.
 */

/** 4/8 spacing scale. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;

/** One radius set. `pill` is for badges and chips, `xl` for cards, `lg` for buttons. */
export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;

type Weight = "400" | "500" | "600" | "700" | "800" | "900";
type TypeStyle = { fontSize: number; lineHeight: number; fontWeight: Weight; letterSpacing?: number };

/**
 * Type scale. Sizes are the base at default text size; the platform scales them for dynamic type,
 * so every container around text must be allowed to grow (no fixed heights on text).
 * Add `tabular` to a text style for amounts, so columns of numbers line up.
 */
export const typography = {
  /** One hero number per screen. */
  display: { fontSize: 44, lineHeight: 50, fontWeight: "900" },
  /** Screen titles. */
  title: { fontSize: 28, lineHeight: 34, fontWeight: "800" },
  /** Card titles and big values inside a card. */
  heading: { fontSize: 20, lineHeight: 26, fontWeight: "800" },
  /** Default text. */
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  /** Buttons, row titles on dense lists. */
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  /** Secondary text. Never smaller than 12. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  /** Small label above a block, in sentence case. */
  overline: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
} as const satisfies Record<string, TypeStyle>;

export type TypeName = keyof typeof typography;

/** Spread into a text style for amounts. */
export const tabular = { fontVariant: ["tabular-nums"] as "tabular-nums"[] };

/**
 * Elevation set. Cards are flat with a hairline border (the game look) plus a barely visible
 * shadow in light mode; `raised` is for things that float (the tab bar, toasts), `overlay` for
 * sheets and dialogs. In dark mode shadows barely show, the border carries the edge.
 */
const shadow = (opacity: number, radiusPx: number, y: number, elevationPx: number) => ({
  shadowColor: "#1a1030",
  shadowOpacity: opacity,
  shadowRadius: radiusPx,
  shadowOffset: { width: 0, height: y },
  elevation: elevationPx,
});
export const elevation = {
  none: {},
  card: shadow(0.06, 8, 2, 1),
  raised: shadow(0.12, 14, 6, 4),
  overlay: shadow(0.24, 24, 12, 12),
} as const;

/** Durations in ms. All motion is skipped (value jumps to its end) when reduced motion is on. */
export const motion = { press: 90, quick: 180, base: 280, progress: 700, countUp: 900 } as const;
