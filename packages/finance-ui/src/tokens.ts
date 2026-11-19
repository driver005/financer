/**
 * Design tokens from the Stitch project "Pantry merged app screens"
 * (11057116803371822050), design system "Culinary Capital".
 * Single source of truth for every merged Expo screen.
 */

export const palette = {
  primary: "#027E83",
  primaryDark: "#006367",
  primaryLight: "#78D5DA",
  secondary: "#8E1AB1",
  secondaryLight: "#D778FA",
  tertiary: "#B9A115",
  error: "#E50855",
  success: "#19A048",
  canvas: "#F7F9FA",
  surface: "#FFFFFF",
  border: "#E5E9EB",
  ink: "#111A1C",
  inkMuted: "#5A6B70",
  inkSubtle: "#8E9DA2",
  chart: ["#027E83", "#8E1AB1", "#B9A115", "#E50855", "#19A048", "#0050AA", "#D99700", "#6B7280"],
};

export const spacing = { xs0: 0, xs: 4, sm: 8, mdSm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

export const radius = { sm: 4, md: 8, card: 12, lg: 16, xl: 24, full: 999, pill: 999, button: 8 };

export const typography = {
  font: { display: "Montserrat", body: "Plus Jakarta Sans", number: "Urbanist" },
  headlineLg: { fontSize: 28, fontWeight: "700" as const, lineHeight: 34, letterSpacing: -0.02 },
  headlineMd: { fontSize: 22, fontWeight: "600" as const, lineHeight: 28, letterSpacing: -0.01 },
  headlineSm: { fontSize: 18, fontWeight: "600" as const, lineHeight: 24 },
  currencyDisplay: { fontSize: 32, fontWeight: "700" as const, lineHeight: 38, letterSpacing: -0.03 },
  currencyMd: { fontSize: 20, fontWeight: "700" as const, lineHeight: 26, letterSpacing: -0.02 },
  currencySm: { fontSize: 15, fontWeight: "600" as const, lineHeight: 20 },
  bodyLg: { fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  bodyMd: { fontSize: 14, fontWeight: "400" as const, lineHeight: 20 },
  bodySm: { fontSize: 12, fontWeight: "400" as const, lineHeight: 16 },
  labelMd: { fontSize: 13, fontWeight: "600" as const, lineHeight: 16, letterSpacing: 0.02 },
  labelSm: { fontSize: 11, fontWeight: "700" as const, lineHeight: 14, letterSpacing: 0.04 },
  headline1: { fontSize: 28, fontWeight: "700" as const, lineHeight: 34, letterSpacing: -0.02 },
  headline2: { fontSize: 22, fontWeight: "600" as const, lineHeight: 28, letterSpacing: -0.01 },
  heading1: { fontSize: 28, fontWeight: "700" as const, lineHeight: 34, letterSpacing: -0.02 },
  heading2: { fontSize: 22, fontWeight: "600" as const, lineHeight: 28, letterSpacing: -0.01 },
  heading3: { fontSize: 18, fontWeight: "600" as const, lineHeight: 24 },
  heading4: { fontSize: 18, fontWeight: "600" as const, lineHeight: 24 },
  heading5: { fontSize: 18, fontWeight: "600" as const, lineHeight: 24 },
  heading6: { fontSize: 18, fontWeight: "600" as const, lineHeight: 24 },
  body1: { fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  body2: { fontSize: 14, fontWeight: "400" as const, lineHeight: 20 },
  body3: { fontSize: 12, fontWeight: "400" as const, lineHeight: 16 },
  body4: { fontSize: 12, fontWeight: "400" as const, lineHeight: 16 },
  body5: { fontSize: 11, fontWeight: "700" as const, lineHeight: 14, letterSpacing: 0.04 },
  numericHeading: { fontSize: 32, fontWeight: "700" as const, lineHeight: 38, letterSpacing: -0.03 },
  numericTitle: { fontSize: 20, fontWeight: "700" as const, lineHeight: 26, letterSpacing: -0.02 },
  numericLarge: { fontSize: 15, fontWeight: "600" as const, lineHeight: 20 },
  numericMedium: { fontSize: 15, fontWeight: "600" as const, lineHeight: 20 },
};

/** Backwards-compatible aliases used by existing components. */
export const font = typography.font;
export const legacyTypography = {
  headline1: typography.headlineLg, headline2: typography.headlineMd,
  heading1: typography.headlineLg, heading2: typography.headlineMd, heading3: typography.headlineSm,
  heading4: typography.headlineSm, heading5: typography.headlineSm, heading6: typography.headlineSm,
  body1: typography.bodyLg, body2: typography.bodyMd, body3: typography.bodySm,
  body4: typography.bodySm, body5: typography.labelSm,
  numericHeading: typography.currencyDisplay, numericTitle: typography.currencyMd,
  numericLarge: typography.currencySm, numericMedium: typography.currencySm,
};

export type Theme = {
  background: string; surface: string; surfaceAlt: string; text: string;
  muted: string; subtle: string; border: string; primary: string; primarySoft: string;
  secondary: string; secondarySoft: string; tertiary: string; error: string;
  income: string; expense: string; transfer: string; ios: Record<string, string>;
};

export const lightTheme: Theme = {
  background: palette.canvas, surface: palette.surface, surfaceAlt: "#F2F4F5",
  text: palette.ink, muted: palette.inkMuted, subtle: palette.inkSubtle, border: palette.border,
  primary: palette.primary, primarySoft: "#E5F7F8", secondary: palette.secondary,
  secondarySoft: "#F7E8FF", tertiary: palette.tertiary, error: palette.error,
  income: "#19A048", expense: palette.error, transfer: palette.secondary,
  ios: { label: palette.ink, secondary: palette.inkMuted, tertiary: palette.inkSubtle,
    background: palette.canvas, separator: palette.border, blue: "#005FCC", income: "#34C759",
    fixed: "#0A84A5", variable: "#FF9500", guiltFree: "#AF52DE", investment: "#007AFF", goal: "#FF2D55" },
};

export const darkTheme: Theme = {
  background: "#0E1416", surface: "#182021", surfaceAlt: "#222B2D",
  text: "#F7FAFB", muted: "#A9B9BC", subtle: "#7E8F93", border: "#2C383A",
  primary: palette.primaryLight, primarySoft: "#10383A", secondary: palette.secondaryLight,
  secondarySoft: "#3A0E48", tertiary: "#E0C63E", error: "#FF7096",
  income: "#52DF83", expense: "#FF7096", transfer: palette.secondaryLight,
  ios: { label: "#F7FAFB", secondary: "#A9B9BC", tertiary: "#7E8F93",
    background: "#0E1416", separator: "#2C383A", blue: "#5AC8FA", income: "#52DF83",
    fixed: "#0A84A5", variable: "#FF9500", guiltFree: "#AF52DE", investment: "#007AFF", goal: "#FF2D55" },
};

export const money = (cents: number, currency = "EUR"): string =>
  `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(cents / 100)} ${currency}`;
