import { useColorScheme } from "react-native";

import { palette, type Palette } from "./colors";

// Bright, game-like purple palette. Mirrors the CSS variables in global.css (the components read
// those; this is for the places that need a colour value in JS: the 3D buttons, the tab bar,
// icons, rings and progress fills). The numbers live in colors.ts and tokens.ts (plain data, so
// tests can check contrast); this file adds the hook.
export { chartColors, palette, type Palette } from "./colors";
export { elevation, motion, radius, space, tabular, typography, type TypeName } from "./tokens";

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? palette.dark : palette.light;
}
