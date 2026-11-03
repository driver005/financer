// Primitive colours. This is the only place raw colours are allowed besides `colors.ts`, which maps
// them to roles. Components never read this file; they read roles from the theme.
//
// HeroUI's palette, so the shopping app looks like the finance app (which uses HeroUI). The values are
// the ones in `heroui-native/src/styles/variables.css` and `theme.css` (oklch there), converted to sRGB
// hex. The "soft" fills are HeroUI's `color-mix(accent 15%, transparent)` laid over the surface.
//
// Departures, all for WCAG AA (4.5:1) and all small: the blue and red faces are a little darker than
// HeroUI's (blue #0485f7 -> #0072e2, red #ff383c -> #e71226 in the light theme) because HeroUI puts
// near-white text on them at 3.6:1 and 3.5:1; text colours of a tone, and the muted text on the grey
// fills, are mixed towards the foreground until they pass. `tests/contrast.test.ts` checks every pair.

export const palette = {
  white: "#ffffff",
  black: "#000000",
  /** HeroUI `snow` and `eclipse`: its near-white and near-black. */
  snow: "#fcfcfc",
  eclipse: "#18181b",
  hero: {
    light: {
      background: "#f5f5f5", surface: "#ffffff", surfaceSecondary: "#efeff0", surfaceTertiary: "#eaeaeb",
      fill: "#ebebec", border: "#dedee0", separator: "#aaaaad",
      text: "#18181b", muted: "#676770", subtle: "#6c6c75",
      accent: { face: "#0072e2", soft: "#d9edfe", onSoft: "#1c68ba", text: "#086dd7", line: "#8ec8fb" },
      success: { face: "#17c964", soft: "#dcf7e8", onSoft: "#2b7c47", text: "#2b7c47", line: "#97e7b9" },
      warning: { face: "#f5a524", soft: "#fef2de", onSoft: "#89612e", text: "#89612e", line: "#fbd79c" },
      danger: { face: "#e71226", soft: "#ffe1e2", onSoft: "#b43635", text: "#dc1827", line: "#ffa5a7" },
    },
    dark: {
      background: "#060607", surface: "#18181b", surfaceSecondary: "#232325", surfaceTertiary: "#262728",
      fill: "#27272a", border: "#28282c", separator: "#47474b", segment: "#46464c",
      text: "#fcfcfc", muted: "#c3c3ca", subtle: "#9f9fa9",
      accent: { face: "#0072e2", soft: "#15283c", onSoft: "#3592f9", text: "#2f81e6", line: "#0f497e" },
      success: { face: "#17c964", soft: "#183326", onSoft: "#17c964", text: "#17c964", line: "#17683c" },
      warning: { face: "#f7b750", soft: "#393023", onSoft: "#f7b750", text: "#f7b750", line: "#7c6033" },
      danger: { face: "#d7373b", soft: "#351d20", onSoft: "#e45f5b", text: "#de514f", line: "#70282b" },
    },
  },
  /** Informational blue, a step to the side of the accent (Tailwind sky). */
  sky: {
    50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9",
    600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e", 950: "#082f49",
  },
} as const;

/** Transparent black for scrims (HeroUI's backdrop is 20 % black; a touch more here so text behind a sheet recedes). */
export const alpha = {
  scrimLight: "rgba(0, 0, 0, 0.4)",
  scrimDark: "rgba(0, 0, 0, 0.6)",
  /** A dark chip behind text over a camera picture. */
  chip: "rgba(0, 0, 0, 0.65)",
  clear: "rgba(0, 0, 0, 0)",
  /** The light streak along the top of a progress bar. */
  shine: "rgba(255, 255, 255, 0.35)",
} as const;
