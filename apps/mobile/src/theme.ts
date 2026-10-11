import { useColorScheme } from "react-native";

// A calm green seed colour: money-positive without looking like a casino.
// Mirrors the CSS variables in global.css (the components read those; this is for the few
// places that need a colour value in JS, such as the tab bar and icons).
const light = {
  background: "#f6fbf6",
  surface: "#ffffff",
  text: "#151d18",
  muted: "#5b6a60",
  border: "#d3ddd5",
  accent: "#1b6b4a",
  bad: "#ba1a1a",
  good: "#1b6b4a",
};

const dark: typeof light = {
  background: "#0f1512",
  surface: "#17201b",
  text: "#e3eae5",
  muted: "#a9b6ad",
  border: "#2a362e",
  accent: "#5fbf8d",
  bad: "#ffb4ab",
  good: "#7fd9a8",
};

export const palette = { light, dark };

export function usePalette() {
  return useColorScheme() === "dark" ? dark : light;
}
