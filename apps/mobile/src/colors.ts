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
  accentSoft: "#f1e8fd",
  goodSoft: "#ecf9f1",
  badSoft: "#fde8e8",
  warnSoft: "#fef5e7",
  blueSoft: "#e1f1f9",
  goldSoft: "#fff4cc",
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
  onBlue: "#04283b",
  orange: "#ff9600",
  gold: "#ffc800",
  bad: "#ff6b6b",
  badEdge: "#c93f3f",
  onBad: "#2a0505",
  good: "#4ade80",
  warn: "#ff9600",
  goldText: "#ffc800",
  accentSoft: "#2a2340",
  goodSoft: "#14301f",
  badSoft: "#3a1c1f",
  warnSoft: "#3a2a12",
  blueSoft: "#122d3c",
  goldSoft: "#3a3112",
};

export type Palette = typeof light;
export const palette = { light, dark };
