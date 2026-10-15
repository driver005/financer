/**
 * Maths for the progress ring and the count-up number. Pure (no React Native), so it is
 * unit-tested in plain Node.
 */

export function clamp01(v: number): number {
  "worklet"; // called from the ring's animated props, which run on the UI thread
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

export type RingGeometry = {
  /** Centre of the circle in the SVG's own coordinates. */
  c: number;
  /** Radius of the stroke's centre line (the stroke is drawn half inside, half outside it). */
  r: number;
  /** Length of the whole circle; the dash array of the progress arc. */
  circumference: number;
};

/** A ring that fits inside a `size` x `size` box with a stroke of `stroke` width, so nothing is clipped. */
export function ringGeometry(size: number, stroke: number): RingGeometry {
  const r = Math.max(0, (size - stroke) / 2);
  return { c: size / 2, r, circumference: 2 * Math.PI * r };
}

/** `strokeDashoffset` that leaves `progress` (0..1) of the circle drawn. */
export function dashOffset(circumference: number, progress: number): number {
  "worklet"; // runs on the UI thread (useAnimatedProps in Ring.tsx): a plain function there crashes the app on a phone
  return circumference * (1 - clamp01(progress));
}

/** The share of a budget period still ahead: 1 on the first day, close to 0 on the last. */
export function periodLeft(daysLeft: number, daysTotal: number): number {
  if (daysTotal <= 0) return 0;
  return clamp01(daysLeft / daysTotal);
}

/** Ease-out cubic: fast start, gentle stop. `t` is 0..1. */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

/** The number shown `t` (0..1) of the way through a count-up from `from` to `to`, in whole units. */
export function countUpValue(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * easeOutCubic(t));
}

/**
 * Font size for the hero amount so the whole euros plus the small cents fit in `available` points
 * (the inside of the ring). Digits are about 0.62 em wide, separators about 0.32 em, and the
 * `,00 EUR` tail takes a fixed share. Never below `min`, never above `max`. This does not depend on
 * the platform's auto-shrink (which the web does not have), so the number is never clipped.
 */
export function heroFontSize(whole: string, available = 112, max = 44, min = 24): number {
  let em = 0;
  for (const ch of whole) em += /\d/.test(ch) ? 0.62 : 0.32;
  return Math.max(min, Math.min(max, Math.floor(available / Math.max(em, 0.1) + 1e-6)));
}
