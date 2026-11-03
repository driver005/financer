/**
 * Maths for the count-up number. Pure (no React Native), so it is unit-tested in plain Node.
 * (The progress ring and the charts have their own, in packages/ui.)
 */

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
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
