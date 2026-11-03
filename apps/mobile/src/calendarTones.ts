import type { Tone } from "./calendar";

export const TONES: readonly Tone[] = ["accent", "success", "warning", "danger", "info", "neutral"];

/** The server stores a tone as text; anything it does not know is neutral. */
export function toTone(value: string): Tone {
  return (TONES as readonly string[]).includes(value) ? (value as Tone) : "neutral";
}

export const TONE_LABEL: Record<Tone, string> = { accent: "Blue", success: "Green", warning: "Orange", danger: "Red", info: "Teal", neutral: "Grey" };
