// Corner radii: Tailwind CSS 3.4.17 `borderRadius` (rem converted at 16 px), plus the steps HeroUI
// derives from a 0.5 rem base (3xl 24, 4xl 32: pill-shaped buttons) and its field radius (1.75 x the base).
export const radius = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  "4xl": 32,
  field: 14,
  full: 9999,
} as const;

export type Radius = keyof typeof radius;

/** Border widths: a hairline for dividers and outlines, a thicker one for focus and selection. */
export const borderWidth = { none: 0, hairline: 1, thick: 2 } as const;
export type BorderWidth = keyof typeof borderWidth;
