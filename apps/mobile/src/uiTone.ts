// The screens' logic files (receiptSources, watchdog, categoryIcons) name colours the way the app always
// has ("good", "bad", "warn", "blue", "gold"). The design system names them as tones; this maps one to the other,
// and turns the icon names in those files into the design system's icon type.
import type { IconName, Tone } from "@financer/ui";

export type LegacyTone = "accent" | "good" | "bad" | "warn" | "blue" | "gold" | "muted";

const MAP: Record<LegacyTone, Tone> = { accent: "accent", good: "success", bad: "danger", warn: "warning", blue: "info", gold: "warning", muted: "neutral" };

export function toTone(t: LegacyTone | undefined): Tone {
  return t ? MAP[t] : "neutral";
}

/** Icon names in the logic files are plain strings; they are all Material Community names. */
export function asIcon(name: string): IconName {
  return name as IconName;
}
