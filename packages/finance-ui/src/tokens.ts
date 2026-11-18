/**
 * Pockaw design tokens, ported from docs/reference/pockaw/lib/core/constants/:
 * app_colors.dart, app_text_styles.dart, app_spacing.dart, app_radius.dart.
 * Extra semantic colours come from Dompetku, Boring Balance and Jings Finance.
 */

export const palette = {
  primary: {
    50: "#F7FFFE", 100: "#C6FFFB", 200: "#8EFFF8", 300: "#4DFBF4", 400: "#19E8E6",
    500: "#00CCCD", 600: "#009FA4", 700: "#027E83", 800: "#086267", 900: "#0C5255", 950: "#002F34",
  },
  secondary: {
    100: "#F7E8FF", 400: "#D778FA", 600: "#AD25DA", 700: "#8E1AB1", 950: "#40034F",
  },
  tertiary: { 400: "#E7E328", 500: "#D8CC1B", 600: "#B9A115" },
  red: { 50: "#FFF0F4", 400: "#FF638F", 500: "#FF2C6D", 600: "#E50855", 700: "#D0004E" },
  purple: { 400: "#AA86FF", 600: "#8333F4", 700: "#731FE0" },
  green: { 100: "#52DF83", 200: "#21B354", 400: "#19A048", 700: "#0E4A23" },
  neutral: {
    50: "#FDFDFD", 100: "#F4F4F4", 200: "#E8E8E8", 300: "#D1D1D1", 400: "#9E9E9E",
    500: "#6E6E6E", 600: "#4E4E4E", 700: "#333333", 800: "#242424", 900: "#171717", 950: "#1C1C1C",
  },
  ios: {
    label: "#000000", secondary: "#3C3C4399", tertiary: "#3C3C434D",
    background: "#F2F2F7", separator: "#3C3C4333", blue: "#005FCC",
    income: "#34C759", fixed: "#0A84A5", variable: "#FF9500", guiltFree: "#AF52DE",
    investment: "#007AFF", goal: "#FF2D55",
  },
  chart: ["#009FA4", "#AD25DA", "#B9A115", "#E50855", "#8333F4", "#21B354", "#FF9500", "#0A84A5"],
};

export const spacing = { xs0: 0, xs: 2, sm: 4, mdSm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40, giant: 48, max: 56 };

export const radius = { sm: 4, md: 8, card: 12, button: 16, lg: 20, xl: 24, xxl: 32, xxxl: 64, full: 999 };

export const typography = {
  font: { display: "Montserrat", number: "Urbanist" },
  headline1: { fontSize: 68, fontWeight: "900" as const, lineHeight: 76 },
  headline2: { fontSize: 56, fontWeight: "900" as const, lineHeight: 64 },
  heading1: { fontSize: 46, fontWeight: "900" as const, lineHeight: 54 },
  heading2: { fontSize: 38, fontWeight: "900" as const, lineHeight: 46 },
  heading3: { fontSize: 32, fontWeight: "900" as const, lineHeight: 40 },
  heading4: { fontSize: 26, fontWeight: "900" as const, lineHeight: 34 },
  heading5: { fontSize: 22, fontWeight: "800" as const, lineHeight: 30 },
  heading6: { fontSize: 20, fontWeight: "700" as const, lineHeight: 28 },
  body1: { fontSize: 18, fontWeight: "700" as const, lineHeight: 26 },
  body2: { fontSize: 16, fontWeight: "500" as const, lineHeight: 24 },
  body3: { fontSize: 14, fontWeight: "500" as const, lineHeight: 22 },
  body4: { fontSize: 12, fontWeight: "500" as const, lineHeight: 18 },
  body5: { fontSize: 10, fontWeight: "400" as const, lineHeight: 14 },
  numericHeading: { fontSize: 36, fontWeight: "700" as const, lineHeight: 42 },
  numericTitle: { fontSize: 24, fontWeight: "600" as const, lineHeight: 30 },
  numericLarge: { fontSize: 20, fontWeight: "600" as const, lineHeight: 26 },
  numericMedium: { fontSize: 16, fontWeight: "600" as const, lineHeight: 22 },
};

export type Theme = {
  background: string; surface: string; surfaceAlt: string; text: string;
  muted: string; border: string; primary: string; primarySoft: string;
  secondary: string; income: string; expense: string; transfer: string; ios: typeof palette.ios;
};

export const lightTheme: Theme = {
  background: "#FDFDFD", surface: "#FFFFFF", surfaceAlt: "#F4F4F4",
  text: "#1C1C1C", muted: "#6E6E6E", border: "#E8E8E8",
  primary: palette.primary[700], primarySoft: palette.primary[50],
  secondary: palette.secondary[700],
  income: palette.green[200], expense: palette.red[700], transfer: palette.tertiary[600], ios: palette.ios,
};

export const darkTheme: Theme = {
  background: "#0E0011", surface: "#21272B", surfaceAlt: "#2B3338",
  text: "#FDFDFD", muted: "#B9B9B9", border: "#3A4247",
  primary: palette.primary[400], primarySoft: palette.primary[950],
  secondary: palette.secondary[400],
  income: palette.green[100], expense: palette.red[400], transfer: palette.tertiary[400], ios: palette.ios,
};

export const money = (cents: number, currency = "EUR"): string =>
  `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(cents / 100)} ${currency}`;
