/**
 * The colour palette as plain data (no React Native import), so tests can compute contrast
 * ratios from it. `theme.ts` re-exports it and adds the hook. Keep it in sync with the CSS
 * variables in `global.css`, which the HeroUI components read.
 *
 * Roles
 * - `text`, `muted`: body text and secondary text.
 * - `accent`, `good`, `bad`, `warn`, `blue`, `goldText`: colours that are used AS TEXT or icons on
 *   `background`, `surface`, `surfaceAlt` and on their own `*Soft` tint. All pass 4.5:1 there.
 * - `fill`, `orange`, `gold`: decorative fills (progress, rings, medals), never text.
 * - `onAccent`, `onBlue`, `onBad`: text on a button face of that colour.
 * - `*Soft`: a pale tint of the colour, for badge and icon backgrounds.
 */
const light = {
  background: "#f8fafc",
  surface: "#ffffff",
  surfaceAlt: "#f1f5f9",
  text: "#0f172a",
  muted: "#475569",
  border: "#e2e8f0",
  accent: "#1e40af", // trust blue: buttons and text on white (contrast 8.7:1)
  accentEdge: "#1e3a8a", // pressed / darker shade of the accent
  onAccent: "#ffffff",
  fill: "#2563eb", // progress fills and decorations
  blue: "#0b6fa4",
  blueEdge: "#08547d",
  onBlue: "#ffffff",
  orange: "#ff9600",
  gold: "#ffc800",
  bad: "#c81e1e",
  badEdge: "#8f1414",
  onBad: "#ffffff",
  good: "#15803d",
  warn: "#b45309", // orange that can be read as text
  goldText: "#8a5a00", // gold that can be read as text
  accentSoft: "#e0e7ff",
  goodSoft: "#ecf9f1",
  badSoft: "#fde8e8",
  warnSoft: "#fef5e7",
  blueSoft: "#e1f1f9",
  goldSoft: "#fff4cc",
};

const dark: typeof light = {
  background: "#0b0f17",
  surface: "#131a26",
  surfaceAlt: "#1b2332",
  text: "#f1f5f9",
  muted: "#9aa7bb",
  border: "#263043",
  accent: "#93b4ff",
  accentEdge: "#3b5bdb",
  onAccent: "#0b1a44",
  fill: "#5b8def",
  blue: "#1cb0f6",
  blueEdge: "#1388bd",
  onBlue: "#04283b",
  orange: "#ff9600",
  gold: "#ffc800",
  bad: "#ff6b6b",
  badEdge: "#c93f3f",
  onBad: "#2a0505",
  good: "#4ade80",
  warn: "#ff9600",
  goldText: "#ffc800",
  accentSoft: "#1c2a4d",
  goodSoft: "#14301f",
  badSoft: "#3a1c1f",
  warnSoft: "#3a2a12",
  blueSoft: "#122d3c",
  goldSoft: "#3a3112",
};

export type Palette = typeof light;
export const palette = { light, dark };
