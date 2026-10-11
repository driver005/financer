import { useColorScheme } from "react-native";

// Bright, game-like palette. Mirrors the CSS variables in global.css (the components read
// those; this is for the few places that need a colour value in JS: the 3D buttons, the
// tab bar, icons and progress fills).
const light = {
  background: "#ffffff",
  surface: "#ffffff",
  surfaceAlt: "#f7f7f7",
  text: "#3c3c3c",
  muted: "#777777",
  border: "#e5e5e5",
  accent: "#58a700", // buttons and text on white (contrast 3.4:1 for bold labels)
  accentEdge: "#3d7500", // the 3D "lip" under a button
  onAccent: "#ffffff",
  fill: "#58cc02", // bright green for progress fills and decorations
  blue: "#1899d6",
  blueEdge: "#126f9c",
  orange: "#ff9600",
  gold: "#ffc800",
  bad: "#ea2b2b",
  good: "#58a700",
};

const dark: typeof light = {
  background: "#131f24",
  surface: "#202f36",
  surfaceAlt: "#243740",
  text: "#f1f7fb",
  muted: "#8fa1ab",
  border: "#37464f",
  accent: "#58cc02",
  accentEdge: "#3f9000",
  onAccent: "#0d2000",
  fill: "#58cc02",
  blue: "#1cb0f6",
  blueEdge: "#1388bd",
  orange: "#ff9600",
  gold: "#ffc800",
  bad: "#ff6b6b",
  good: "#58cc02",
};

export const palette = { light, dark };

export function usePalette() {
  return useColorScheme() === "dark" ? dark : light;
}
