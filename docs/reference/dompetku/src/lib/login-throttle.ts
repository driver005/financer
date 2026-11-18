/** Pure login brute-force throttle rules (shared by server code and tests). */
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_FAILURES = 8;

/** True when recent failures reach the limit and credentials must not be checked. */
export function isLoginLocked(recentFailures: number, max = LOGIN_MAX_FAILURES): boolean {
  return Number.isFinite(recentFailures) && recentFailures >= max;
}

/** Keeps only failure timestamps inside the window (in-memory fallback). */
export function pruneFailures(
  times: readonly number[],
  now: number,
  windowMs = LOGIN_WINDOW_MS,
): number[] {
  return times.filter((t) => now - t < windowMs);
}
