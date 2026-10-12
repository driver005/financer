// Pure logic for the app lock: when to lock, what an unlock attempt means, whether the lock can
// be offered at all. No React Native or Expo imports, so it runs in tests.

/** Locked again when the app comes back after being in the background for longer than this. */
export const LOCK_AFTER_MS = 60_000;

export type LockState = {
  /** The user turned the lock on. */
  enabled: boolean;
  /** The settings have been read; until then the app stays covered. */
  ready: boolean;
  locked: boolean;
  /** When the app went to the background; `null` while it is in front. */
  backgroundedAt: number | null;
};

/** At start everything is covered until we know whether the lock is on. */
export function startState(): LockState {
  return { enabled: false, ready: false, locked: true, backgroundedAt: null };
}

/** The stored setting has been read. With the lock on, the app starts locked. */
export function settingsLoaded(s: LockState, enabled: boolean): LockState {
  return { ...s, enabled, ready: true, locked: enabled, backgroundedAt: null };
}

/** The user switched the lock on or off (having just proven who they are). */
export function setEnabled(s: LockState, enabled: boolean): LockState {
  return { ...s, enabled, locked: false, backgroundedAt: null };
}

export function wentToBackground(s: LockState, now: number): LockState {
  // Already covered, or lock off: nothing to protect, and a half-finished unlock prompt must
  // not leave a stale timestamp behind.
  if (!s.enabled || s.locked) return s;
  return s.backgroundedAt === null ? { ...s, backgroundedAt: now } : s;
}

export function cameToForeground(s: LockState, now: number, afterMs: number = LOCK_AFTER_MS): LockState {
  if (s.backgroundedAt === null) return s;
  const away = now - s.backgroundedAt;
  // a clock that moved backwards (away < 0) cannot prove the app was gone only briefly
  const lock = s.enabled && (away < 0 || away > afterMs);
  return { ...s, locked: s.locked || lock, backgroundedAt: null };
}

export function unlocked(s: LockState): LockState {
  return { ...s, locked: false, backgroundedAt: null };
}

/** What the screen shows: the app, or the cover. */
export function isCovered(s: LockState): boolean {
  return !s.ready || s.locked;
}

// ---- availability ----

/** Values of expo-local-authentication's `SecurityLevel`: 0 none, 1 PIN/pattern/passcode, above that biometrics. */
export type EnrolledLevel = number;

export type Availability = { available: true } | { available: false; reason: string };

/** Whether the lock can be offered, and if not, a sentence for the setting that says why. */
export function lockAvailability(isWeb: boolean, nativeModule: boolean, level: EnrolledLevel): Availability {
  if (isWeb) return { available: false, reason: "The app lock is only available in the phone app, not in the browser." };
  if (!nativeModule) {
    return { available: false, reason: "This build does not include the lock (it needs a development build or the store app)." };
  }
  if (level <= 0) {
    return {
      available: false,
      reason: "Set a screen lock (passcode, PIN or pattern) or add a fingerprint or face in your phone's settings first.",
    };
  }
  return { available: true };
}

/** The error names `authenticateAsync` can return. */
export type AuthResult = { success: true } | { success: false; error: string };

export type UnlockOutcome = "unlocked" | "try_again" | "lock_unavailable";

/**
 * What an unlock attempt means. If the phone no longer has a screen lock, nobody could ever
 * unlock the app again, so the lock must give way (anyone could open the phone anyway).
 */
export function unlockOutcome(result: AuthResult): UnlockOutcome {
  if (result.success) return "unlocked";
  return ["not_enrolled", "passcode_not_set", "not_available"].includes(result.error) ? "lock_unavailable" : "try_again";
}
