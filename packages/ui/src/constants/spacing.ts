// Spacing: Tailwind CSS 3.4.17 default scale (rem steps of 0.25 = 4 px; one rem is 16 px).
// `spacing` is the full scale. `space` names the steps components and screens use, so a screen says
// `p="md"` and never a number.

/** Tailwind's spacing scale in density-independent pixels, keyed by its class suffix. */
export const spacing = {
  0: 0, px: 1, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12, 3.5: 14, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32,
  9: 36, 10: 40, 11: 44, 12: 48, 14: 56, 16: 64, 20: 80, 24: 96, 28: 112, 32: 128, 36: 144, 40: 160,
  44: 176, 48: 192, 52: 208, 56: 224, 60: 240, 64: 256, 72: 288, 80: 320, 96: 384,
} as const;

export type SpacingKey = keyof typeof spacing;

/** The named steps: 2xs 2, xs 4, sm 8, md 12, lg 16, xl 24, 2xl 32, 3xl 48, 4xl 64. */
export const space = {
  none: spacing[0],
  "2xs": spacing[0.5],
  xs: spacing[1],
  sm: spacing[2],
  md: spacing[3],
  lg: spacing[4],
  xl: spacing[6],
  "2xl": spacing[8],
  "3xl": spacing[12],
  "4xl": spacing[16],
} as const;

export type Space = keyof typeof space;
