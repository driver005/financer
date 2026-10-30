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
 * - `chart1`..`chart5`: categorical colours for charts, in the order slices and bars use them.
 */
const light = {
  background: "#ffffff",
  surface: "#ffffff",
  surfaceAlt: "#f6f9fc",
  text: "#1a1f36",
  muted: "#5b6577",
  border: "#e3e8ee",
  accent: "#4f46e5", // indigo: buttons and text on white (contrast 6.3:1)
  accentEdge: "#4338ca", // pressed / darker shade of the accent
  onAccent: "#ffffff",
  fill: "#635bff", // progress fills and decorations
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
  accentSoft: "#eef0ff",
  goodSoft: "#ecf9f1",
  badSoft: "#fde8e8",
  warnSoft: "#fef5e7",
  blueSoft: "#e1f1f9",
  goldSoft: "#fff4cc",
  // Categorical chart colours (donut slices, store bars): lavender, cyan, butterscotch, orange,
  // green. Decorative only, but each reaches 3:1 on the page so a slice or bar is always visible.
  chart1: "#7c5ce6",
  chart2: "#0e95c9",
  chart3: "#b87c00",
  chart4: "#e8590c",
  chart5: "#1f9d6b",
};

const dark: typeof light = {
  background: "#0b0f17",
  surface: "#131a26",
  surfaceAlt: "#1b2332",
  text: "#f1f5f9",
  muted: "#9aa7bb",
  border: "#263043",
  accent: "#a5b4fc",
  accentEdge: "#6366f1",
  onAccent: "#0f1236",
  fill: "#818cf8",
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
  accentSoft: "#1c2340",
  goodSoft: "#14301f",
  badSoft: "#3a1c1f",
  warnSoft: "#3a2a12",
  blueSoft: "#122d3c",
  goldSoft: "#3a3112",
  chart1: "#a893f4",
  chart2: "#67cefd",
  chart3: "#f5be3d",
  chart4: "#ff8845",
  chart5: "#4ade80",
};

export type Palette = typeof light;
export const palette = { light, dark };

/** The five chart colours of a palette, in order. */
export function chartColors(p: Palette): string[] {
  return [p.chart1, p.chart2, p.chart3, p.chart4, p.chart5];
}
