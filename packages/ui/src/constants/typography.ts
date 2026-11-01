// Type: Nunito, a round bold sans (the chunky, friendly look), Tailwind CSS 3.4.17 `fontSize` (with its line heights), `fontWeight` and `letterSpacing`.
// `textVariants` are the roles screens use (`<Text variant="heading">`); each is made only of
// the tokens above it.

export const fontSize = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48,
} as const;

/** Line height for each size, as Tailwind pairs them. */
export const lineHeight = {
  xs: 16, sm: 20, base: 24, lg: 28, xl: 28, "2xl": 32, "3xl": 36, "4xl": 40, "5xl": 48,
} as const;

export const fontWeight = {
  normal: "400", medium: "500", semibold: "600", bold: "700", extrabold: "800",
} as const;

/**
 * The font file for each weight. Custom fonts have one file per weight, and every step is one heavier
 * than its name (normal reads as SemiBold, medium as Bold, ...), which is what makes the type chunky.
 */
export const fontFamilyByWeight = {
  normal: "Nunito_600SemiBold",
  medium: "Nunito_700Bold",
  semibold: "Nunito_800ExtraBold",
  bold: "Nunito_800ExtraBold",
  extrabold: "Nunito_900Black",
} as const;

/** Tailwind's tracking, in em. */
export const letterSpacing = { tighter: -0.05, tight: -0.025, normal: 0, wide: 0.025, wider: 0.05 } as const;

export type FontSize = keyof typeof fontSize;
export type FontWeight = keyof typeof fontWeight;

export type TextVariantSpec = {
  size: FontSize;
  weight: FontWeight;
  tracking: keyof typeof letterSpacing;
  /** Numbers line up in columns (prices, scores). */
  tabular?: boolean;
  /** ALL CAPS (button labels, badges). */
  caps?: boolean;
};

export const textVariants = {
  display: { size: "4xl", weight: "extrabold", tracking: "tight" },
  title: { size: "2xl", weight: "extrabold", tracking: "tight" },
  heading: { size: "xl", weight: "bold", tracking: "tight" },
  subheading: { size: "lg", weight: "bold", tracking: "normal" },
  body: { size: "base", weight: "normal", tracking: "normal" },
  bodyStrong: { size: "base", weight: "bold", tracking: "normal" },
  label: { size: "sm", weight: "medium", tracking: "normal" },
  caption: { size: "xs", weight: "normal", tracking: "wide" },
  /** Badges and tags: small caps-lock labels. */
  badge: { size: "xs", weight: "bold", tracking: "wider", caps: true },
  /** Button labels: bold, capitals, spaced out. */
  controlSmall: { size: "sm", weight: "bold", tracking: "wider", caps: true },
  control: { size: "base", weight: "bold", tracking: "wider", caps: true },
  controlLarge: { size: "lg", weight: "bold", tracking: "wider", caps: true },
  price: { size: "xl", weight: "bold", tracking: "tight", tabular: true },
  priceLarge: { size: "3xl", weight: "extrabold", tracking: "tight", tabular: true },
  number: { size: "sm", weight: "bold", tracking: "normal", tabular: true },
} as const satisfies Record<string, TextVariantSpec>;

export type TextVariant = keyof typeof textVariants;

/** The web fallback chain behind the Nunito files (also used while they load). */
export const fontFamilyWeb =
  'Nunito, ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
