/**
 * Single design system for the whole app, taken from the Finanzguru – Finance Manager
 * Play Store listing (de.dwins.financeguru): deep indigo canvas, white rounded cards,
 * navy ink, mint status pills and violet accents. Sampled from the store screenshots.
 */

export const palette = {
  primary: "#3C318F",
  primaryDark: "#2A2168",
  primaryLight: "#7B6BD6",
  accent: "#7B3FE4",
  mint: "#C9F2DC",
  mintText: "#0E7A55",
  canvas: "#F2F1F6",
  surface: "#FFFFFF",
  border: "#E4E2ED",
  ink: "#2A2166",
  inkMuted: "#6E689B",
  inkSubtle: "#9B96BA",
  error: "#D93050",
  success: "#0E7A55",
  warning: "#B7791F",
  chart: ["#3C318F", "#7B3FE4", "#2FBFA0", "#F2A93B", "#E4647A", "#5B8DEF", "#9B6BE0", "#9B96BA"],
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
  subheading: { fontSize: 18, fontWeight: "600" as const, lineHeight: 24 },
  body: { fontSize: 14, fontWeight: "400" as const, lineHeight: 20 },
  caption: { fontSize: 11, fontWeight: "500" as const, lineHeight: 15 },
  label: { fontSize: 13, fontWeight: "600" as const, lineHeight: 18 },
  number: { fontSize: 26, fontWeight: "700" as const, lineHeight: 32, letterSpacing: -0.02 },
  price: { fontSize: 14, fontWeight: "600" as const, lineHeight: 20 },
  numericHeading: { fontSize: 32, fontWeight: "700" as const, lineHeight: 38, letterSpacing: -0.03 },
  numericTitle: { fontSize: 20, fontWeight: "700" as const, lineHeight: 26, letterSpacing: -0.02 },
  numericLarge: { fontSize: 15, fontWeight: "600" as const, lineHeight: 20 },
  numericMedium: { fontSize: 15, fontWeight: "600" as const, lineHeight: 20 },
};

export const font = typography.font;
export const legacyTypography = typography;

export type Theme = {
  background: string; surface: string; surfaceAlt: string; text: string;
  muted: string; subtle: string; border: string; primary: string; primarySoft: string;
  secondary: string; secondarySoft: string; tertiary: string; error: string;
  income: string; expense: string; transfer: string;
  offer: string; offerSoft: string; success: string; danger: string;
  ios: Record<string, string>;
};

export const lightTheme: Theme = {
  background: palette.canvas, surface: palette.surface, surfaceAlt: "#EAE8F2",
  text: palette.ink, muted: palette.inkMuted, subtle: palette.inkSubtle, border: palette.border,
  primary: palette.primary, primarySoft: "#E6E3F6", secondary: palette.accent,
  secondarySoft: "#F0E8FB", tertiary: palette.warning, error: palette.error,
  income: palette.mintText, expense: palette.error, transfer: palette.accent,
  offer: palette.mintText, offerSoft: palette.mint, success: palette.success, danger: palette.error,
  ios: { label: palette.ink, secondary: palette.inkMuted, tertiary: palette.inkSubtle,
    background: palette.canvas, separator: palette.border, blue: "#005FCC", income: palette.mintText,
    fixed: "#0A84A5", variable: "#FF9500", guiltFree: "#AF52DE", investment: "#007AFF", goal: "#7B3FE4" },
};

export const darkTheme: Theme = {
  background: "#191536", surface: "#241F4C", surfaceAlt: "#2E285E",
  text: "#F5F3FF", muted: "#B9B2DF", subtle: "#8F88B8", border: "#3E3672",
  primary: "#A99BF0", primarySoft: "#332A6B", secondary: "#B68BF5",
  secondarySoft: "#3B2A63", tertiary: "#E0C63E", error: "#FF8098",
  income: "#7BE0B4", expense: "#FF8098", transfer: "#B68BF5",
  offer: "#7BE0B4", offerSoft: "#224C3D", success: "#7BE0B4", danger: "#FF8098",
  ios: { label: "#F5F3FF", secondary: "#B9B2DF", tertiary: "#8F88B8",
    background: "#191536", separator: "#3E3672", blue: "#5AC8FA", income: "#7BE0B4",
    fixed: "#0A84A5", variable: "#FF9500", guiltFree: "#AF52DE", investment: "#007AFF", goal: "#B68BF5" },
};

export const money = (cents: number, currency = "EUR"): string =>
  `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(cents / 100)} ${currency}`;
