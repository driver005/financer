// Initials and a colour for a person, from their name or address. Pure, so it is tested in Node.

import type { Tone } from "../constants/colors";

/** The tones a person can get. Neutral is left out (it is the colour of "nobody"). */
export const AVATAR_TONES: readonly Tone[] = ["accent", "success", "warning", "danger", "info"];

/** "Max Müller" -> "MM", "max@example.com" -> "M", "Dr. Anna-Lena von Berg" -> "AB", "" -> "?". */
export function initialsOf(name: string): string {
  const cleaned = name.replace(/<[^>]*>/g, " ").split("@")[0];
  const words = cleaned
    .split(/[\s._-]+/)
    .filter((w) => /\p{L}/u.test(w))
    .filter((w) => !/^(dr|prof|herr|frau|mr|mrs|ms|von|van|de|der|zu)\.?$/i.test(w));
  if (words.length === 0) return "?";
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : "";
  return (first.charAt(0) + last.charAt(0)).toLocaleUpperCase();
}

/** The same seed always gets the same tone. */
export function toneForSeed(seed: string): Tone {
  let h = 0;
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
