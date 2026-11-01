// Primitive colours. This is the only place raw colours are allowed besides `colors.ts`, which maps
// them to roles. Components never read this file; they read roles from the theme.
//
// Where the values come from:
// - neutral, green, yellow, red, sky: Tailwind CSS 3.4.17 `colors.js`. The Untitled UI community kit
//   (docs/UI.md) uses exactly these for its badges (neutral 100/700, green 50/700, yellow 50/700,
//   red 50/700), so one scale serves both.
// - brand: the violet of Untitled UI. Its 50 (#f9f5ff) and 700 (#6941c6) were read from the kit's
//   brand badge; the other steps are the kit's published brand ramp and were not read from the file.

export const palette = {
  white: "#ffffff",
  black: "#000000",
  neutral: {
    50: "#fafafa", 100: "#f5f5f5", 200: "#e5e5e5", 300: "#d4d4d4", 400: "#a3a3a3", 500: "#737373",
    600: "#525252", 700: "#404040", 800: "#262626", 900: "#171717", 950: "#0a0a0a",
  },
  brand: {
    50: "#f9f5ff", 100: "#f4ebff", 200: "#e9d7fe", 300: "#d6bbfb", 400: "#b692f6", 500: "#9e77ed",
    600: "#7f56d9", 700: "#6941c6", 800: "#53389e", 900: "#42307d", 950: "#2c1c5f",
  },
  green: {
    50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80", 500: "#22c55e",
    600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d", 950: "#052e16",
  },
  yellow: {
    50: "#fefce8", 100: "#fef9c3", 200: "#fef08a", 300: "#fde047", 400: "#facc15", 500: "#eab308",
    600: "#ca8a04", 700: "#a16207", 800: "#854d0e", 900: "#713f12", 950: "#422006",
  },
  red: {
    50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444",
    600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1d", 950: "#450a0a",
  },
  sky: {
    50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9",
    600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e", 950: "#082f49",
  },
} as const;

/** Transparent black and white for scrims and overlays (Tailwind's `black/50` style). */
export const alpha = {
  scrimLight: "rgba(10, 10, 10, 0.5)",
  scrimDark: "rgba(0, 0, 0, 0.7)",
  clear: "rgba(0, 0, 0, 0)",
} as const;
