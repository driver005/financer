import { logic } from "../../../packages/wire/src/logic";
import type { Tone } from "./calendar";

export const TONES: readonly Tone[] = ["accent", "success", "warning", "danger", "info", "neutral"];

/** The server stores a tone as text; anything it does not know is neutral. */
export const toTone = (value: string): Tone => logic("app_misc.calendar_tone", { value });

export const TONE_LABEL: Record<Tone, string> = { accent: "Blue", success: "Green", warning: "Orange", danger: "Red", info: "Teal", neutral: "Grey" };
