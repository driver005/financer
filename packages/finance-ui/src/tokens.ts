/**
 * Single design system for the whole app — "Pantry Playful", generated in Stitch
 * from docs/stitch-duolingo/DESIGN.md. Duolingo-inspired: bright greens, chalk
 * neutrals, chunky tactile controls and Nunito Sans. See docs/stitch-duolingo.
 */

export const palette = {
  primary: "#58CC02",
  primaryDark: "#46A302",
  primaryLight: "#89E539",
  accent: "#FFC800",
  mint: "#D7FFB8",
  mintText: "#3C8C00",
  canvas: "#F7F7F7",
  surface: "#FFFFFF",
  border: "#E5E5E5",
  ink: "#3C3C3C",
  inkMuted: "#777777",
  inkSubtle: "#AFAFAF",
  error: "#FF4B4B",
  success: "#58CC02",
  warning: "#FF9600",
  info: "#1CB0F6",
  premium: "#CE82FF",
  chart: ["#58CC02", "#1CB0F6", "#FFC800", "#CE82FF", "#FF9600", "#FF4B4B", "#89E539", "#B7B7B7"],
};

export const spacing = { xs0: 0, xs: 4, sm: 8, mdSm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

export const radius = { sm: 8, md: 16, card: 24, lg: 24, xl: 28, full: 999, pill: 999, button: 16 };

const W800 = "800" as const;
const W700 = "700" as const;
const W600 = "600" as const;

export const typography = {
  font: { display: "Nunito Sans ExtraBold", body: "Nunito Sans", number: "Nunito Sans ExtraBold" },
  headlineLg: { fontSize: 32, fontWeight: W800, lineHeight: 38, letterSpacing: -0.02 },
  headlineMd: { fontSize: 26, fontWeight: W800, lineHeight: 32, letterSpacing: -0.01 },
  headlineSm: { fontSize: 20, fontWeight: W800, lineHeight: 26 },
  currencyDisplay: { fontSize: 34, fontWeight: W800, lineHeight: 40, letterSpacing: -0.02 },
  currencyMd: { fontSize: 22, fontWeight: W800, lineHeight: 28 },
  currencySm: { fontSize: 16, fontWeight: W700, lineHeight: 22 },
  bodyLg: { fontSize: 17, fontWeight: W600, lineHeight: 26 },
  bodyMd: { fontSize: 15, fontWeight: W600, lineHeight: 22 },
  bodySm: { fontSize: 13, fontWeight: W600, lineHeight: 18 },
  labelMd: { fontSize: 14, fontWeight: W800, lineHeight: 18, letterSpacing: 0.02 },
  labelSm: { fontSize: 12, fontWeight: W800, lineHeight: 15, letterSpacing: 0.04 },
  headline1: { fontSize: 32, fontWeight: W800, lineHeight: 38, letterSpacing: -0.02 },
  headline2: { fontSize: 26, fontWeight: W800, lineHeight: 32, letterSpacing: -0.01 },
  heading1: { fontSize: 32, fontWeight: W800, lineHeight: 38, letterSpacing: -0.02 },
  heading2: { fontSize: 26, fontWeight: W800, lineHeight: 32, letterSpacing: -0.01 },
  heading3: { fontSize: 20, fontWeight: W800, lineHeight: 26 },
  heading4: { fontSize: 18, fontWeight: W800, lineHeight: 24 },
  heading5: { fontSize: 17, fontWeight: W800, lineHeight: 23 },
  heading6: { fontSize: 16, fontWeight: W800, lineHeight: 22 },
  body1: { fontSize: 17, fontWeight: W600, lineHeight: 26 },
  body2: { fontSize: 15, fontWeight: W600, lineHeight: 22 },
  body3: { fontSize: 13, fontWeight: W600, lineHeight: 19 },
  body4: { fontSize: 12, fontWeight: W600, lineHeight: 18 },
  body5: { fontSize: 11, fontWeight: W800, lineHeight: 15, letterSpacing: 0.04 },
  subheading: { fontSize: 20, fontWeight: W800, lineHeight: 26 },
  body: { fontSize: 15, fontWeight: W600, lineHeight: 22 },
  caption: { fontSize: 12, fontWeight: W700, lineHeight: 17 },
  label: { fontSize: 14, fontWeight: W800, lineHeight: 19 },
  number: { fontSize: 28, fontWeight: W800, lineHeight: 34, letterSpacing: -0.02 },
  price: { fontSize: 15, fontWeight: W800, lineHeight: 21 },
  numericHeading: { fontSize: 34, fontWeight: W800, lineHeight: 40, letterSpacing: -0.02 },
  numericTitle: { fontSize: 22, fontWeight: W800, lineHeight: 28 },
  numericLarge: { fontSize: 16, fontWeight: W800, lineHeight: 22 },
  numericMedium: { fontSize: 16, fontWeight: W800, lineHeight: 22 },
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
  background: palette.canvas, surface: palette.surface, surfaceAlt: "#F0F0F0",
  text: palette.ink, muted: palette.inkMuted, subtle: palette.inkSubtle, border: palette.border,
  primary: palette.primary, primarySoft: palette.mint, secondary: palette.accent,
  secondarySoft: "#FFF4CC", tertiary: palette.warning, error: palette.error,
  income: palette.mintText, expense: palette.error, transfer: palette.info,
  offer: palette.mintText, offerSoft: palette.mint, success: palette.success, danger: palette.error,
  ios: { label: palette.ink, secondary: palette.inkMuted, tertiary: palette.inkSubtle,
    background: palette.canvas, separator: palette.border, blue: palette.info, income: palette.mintText,
    fixed: "#1CB0F6", variable: "#FF9600", guiltFree: "#CE82FF", investment: "#1CB0F6", goal: "#58CC02" },
};

export const darkTheme: Theme = {
  background: "#232323", surface: "#303030", surfaceAlt: "#3A3A3A",
  text: "#FFFFFF", muted: "#C7C7C7", subtle: "#A0A0A0", border: "#4A4A4A",
  primary: "#78D43B", primarySoft: "#2F4A1B", secondary: "#FFD84D",
  secondarySoft: "#4A3E14", tertiary: "#FFB25C", error: "#FF7B7B",
  income: "#A8E87A", expense: "#FF7B7B", transfer: "#6CD0FF",
  offer: "#A8E87A", offerSoft: "#2F4A1B", success: "#78D43B", danger: "#FF7B7B",
  ios: { label: "#FFFFFF", secondary: "#C7C7C7", tertiary: "#A0A0A0",
    background: "#232323", separator: "#4A4A4A", blue: "#6CD0FF", income: "#A8E87A",
    fixed: "#6CD0FF", variable: "#FFB25C", guiltFree: "#CE82FF", investment: "#6CD0FF", goal: "#78D43B" },
};

export const money = (cents: number, currency = "EUR"): string =>
  `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(cents / 100)} ${currency}`;
