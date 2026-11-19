/** Compatibility shim: tokens and theme come from the single @finance/ui design system. */
import { useColorScheme } from "react-native";
import { darkTheme, lightTheme, palette, radius, spacing, typography, font, legacyTypography, money } from "@finance/ui";

export { palette, spacing, radius, typography, font, legacyTypography, lightTheme, darkTheme, money };
export type { Theme } from "@finance/ui";

export const tokens = {
  ...spacing,
  ...radius,
  space: spacing,
  radius,
  font: { ...typography, serif: typography.font.display, sans: typography.font.body },
  serif: typography.font.display,
  sans: typography.font.body,
  minTouch: 44,
};

export function useTheme() {
  const scheme = useColorScheme();
  const t = scheme === "dark" ? darkTheme : lightTheme;
  return {
    dark: scheme === "dark",
    colors: {
      bg: t.background, surface: t.surface, surfaceMuted: t.surfaceAlt,
      text: t.text, muted: t.muted, subtle: t.subtle, border: t.border,
      accent: t.primary, accentHover: t.secondary, accentText: t.surface,
      accentSoft: t.primarySoft, danger: t.error, success: t.success,
      skeleton: t.surfaceAlt, offer: t.offer, offerSoft: t.offerSoft,
    },
  };
}
