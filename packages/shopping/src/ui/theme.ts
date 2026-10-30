// Colours and spacing. They mirror the finance app's palette (indigo on cool neutrals, light and
// dark) so the two apps look like one family. Kept as plain values so the module does not depend
// on the host's styling system; when the finance app's theme moves into a shared package this
// file goes away.

import { useColorScheme } from "react-native";

export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  tint: string;
  accentSoft: string;
  goodSoft: string;
  warnSoft: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  onAccent: string;
  good: string;
  warn: string;
  bad: string;
  /** Categorical colours for charts, in order; each reaches 3:1 on the page. */
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
};

const light: Palette = {
  background: "#ffffff",
  surface: "#ffffff",
  surfaceAlt: "#f6f9fc",
  tint: "#eef0ff",
  accentSoft: "#eef0ff",
  goodSoft: "#ecf9f1",
  warnSoft: "#fef5e7",
  text: "#1a1f36",
  muted: "#5b6577",
  border: "#e3e8ee",
  accent: "#4f46e5",
  onAccent: "#ffffff",
  good: "#15803d",
  warn: "#b45309",
  bad: "#c81e1e",
  chart1: "#7c5ce6",
  chart2: "#0e95c9",
  chart3: "#b87c00",
  chart4: "#e8590c",
  chart5: "#1f9d6b",
};

const dark: Palette = {
  background: "#0b0f17",
  surface: "#131a26",
  surfaceAlt: "#1b2332",
  tint: "#263043",
  accentSoft: "#1c2340",
  goodSoft: "#14301f",
  warnSoft: "#3a2a12",
  text: "#f1f5f9",
  muted: "#9aa7bb",
  border: "#263043",
  accent: "#a5b4fc",
  onAccent: "#0f1236",
  good: "#4ade80",
  warn: "#fbbf24",
  bad: "#ff6b6b",
  chart1: "#a893f4",
  chart2: "#67cefd",
  chart3: "#f5be3d",
  chart4: "#ff8845",
  chart5: "#4ade80",
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 12, xl: 16, pill: 999 } as const;

export const type = {
  title: { fontSize: 28, fontWeight: "800" as const },
  heading: { fontSize: 18, fontWeight: "700" as const },
  body: { fontSize: 15 },
  small: { fontSize: 13 },
};

/** A 0..1 score as a colour role: how good it looks. */
export function scoreTone(score: number | null): "good" | "warn" | "bad" | "none" {
  if (score === null) return "none";
  return score >= 0.7 ? "good" : score >= 0.4 ? "warn" : "bad";
}
