// Elevation as `boxShadow` strings, which React Native (0.76 and later) and the web both understand.
//
// - xs: Untitled UI's `shadow-xs`, the faint lift under inputs and outline buttons.
// - surface, field, overlay: HeroUI's own three, soft and layered: cards sit on `surface`, inputs on
//   `field`, menus, sheets and dialogs on `overlay`. In the dark theme there is no shadow under cards
//   and fields (the lighter fill does the lifting) and overlays get a faint inner rim instead.
// - sm to xl: Tailwind CSS 3.4.17 `boxShadow`, for the few places that want a stronger lift.
export type Shadow = "none" | "xs" | "surface" | "field" | "overlay" | "sm" | "md" | "lg" | "xl";

const tailwind = {
  sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
} as const;

const heroSurface = "0 2px 4px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.06), 0 0 1px 0 rgba(0, 0, 0, 0.06)";

export const shadowsByScheme: Record<"light" | "dark", Record<Shadow, string>> = {
  light: {
    none: "none",
    xs: "0 1px 2px 0 rgba(10, 10, 10, 0.05)",
    surface: heroSurface,
    field: heroSurface,
    overlay: "0 2px 8px 0 rgba(0, 0, 0, 0.02), 0 -6px 12px 0 rgba(0, 0, 0, 0.01), 0 14px 28px 0 rgba(0, 0, 0, 0.03)",
    ...tailwind,
  },
  dark: {
    none: "none",
    xs: "none",
    surface: "none",
    field: "none",
    overlay: "inset 0 0 1px 0 rgba(255, 255, 255, 0.2)",
    ...tailwind,
  },
};

/** The light set, for tools and tests that do not care about the theme. */
export const shadows = shadowsByScheme.light;
