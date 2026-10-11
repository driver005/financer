import { useColorScheme } from "react-native";

// Bright, game-like purple palette. Mirrors the CSS variables in global.css (the components read
// those; this is for the few places that need a colour value in JS: the 3D buttons, the
// tab bar, icons and progress fills).
const light = {
  background: "#ffffff",
  surface: "#ffffff",
  surfaceAlt: "#faf5ff",
  text: "#2d2438",
  muted: "#6b5f7a",
  border: "#e9defa",
  accent: "#7c3aed", // buttons and text on white (contrast 5.7:1)
  accentEdge: "#5b21b6", // the 3D "lip" under a button
  onAccent: "#ffffff",
  fill: "#a855f7", // bright purple for progress fills and decorations
  blue: "#1899d6",
  blueEdge: "#126f9c",
  orange: "#ff9600",
  gold: "#ffc800",
  bad: "#ea2b2b",
  good: "#16a34a",
};

const dark: typeof light = {
  background: "#0a0a0d",
  surface: "#16161b",
  surfaceAlt: "#1e1e25",
  text: "#f2f2f7",
  muted: "#9a9aa8",
  border: "#2a2a33",
  accent: "#a78bfa",
  accentEdge: "#7c3aed",
  onAccent: "#1a0b3a",
  fill: "#a855f7",
  blue: "#1cb0f6",
  blueEdge: "#1388bd",
  orange: "#ff9600",
  gold: "#ffc800",
  bad: "#ff6b6b",
  good: "#4ade80",
};

export const palette = { light, dark };

export function usePalette() {
  return useColorScheme() === "dark" ? dark : light;
}
