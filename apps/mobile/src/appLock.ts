// The app lock: when to lock, what an unlock attempt means, whether the lock can be offered at all. The
// rules are in Rust (crates/logic, app_lock.rs); asking the phone stays in `native/appLock.ts`.

import { logic } from "../../../packages/wire/src/logic";

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
export const startState = (): LockState => logic("app_lock.start_state");

/** The stored setting has been read. With the lock on, the app starts locked. */
export const settingsLoaded = (s: LockState, enabled: boolean): LockState => logic("app_lock.settings_loaded", { s, enabled });

/** The user switched the lock on or off (having just proven who they are). */
export const setEnabled = (s: LockState, enabled: boolean): LockState => logic("app_lock.set_enabled", { s, enabled });

export const wentToBackground = (s: LockState, now: number): LockState => logic("app_lock.went_to_background", { s, now });

export const cameToForeground = (s: LockState, now: number, afterMs: number = LOCK_AFTER_MS): LockState =>
  logic("app_lock.came_to_foreground", { s, now, after_ms: afterMs });

export const unlocked = (s: LockState): LockState => logic("app_lock.unlocked", { s });

/** What the screen shows: the app, or the cover. */
export const isCovered = (s: LockState): boolean => logic("app_lock.is_covered", { s });

// ---- availability ----

/** Values of expo-local-authentication's `SecurityLevel`: 0 none, 1 PIN/pattern/passcode, above that biometrics. */
export type EnrolledLevel = number;

export type Availability = { available: true } | { available: false; reason: string };

/** Whether the lock can be offered, and if not, a sentence for the setting that says why. */
export const lockAvailability = (isWeb: boolean, nativeModule: boolean, level: EnrolledLevel): Availability =>
  logic("app_lock.lock_availability", { is_web: isWeb, native_module: nativeModule, level });

/** The error names `authenticateAsync` can return. */
export type AuthResult = { success: true } | { success: false; error: string };

export type UnlockOutcome = "unlocked" | "try_again" | "lock_unavailable";

/**
 * What an unlock attempt means. If the phone no longer has a screen lock, nobody could ever
 * unlock the app again, so the lock must give way (anyone could open the phone anyway).
 */
export const unlockOutcome = (result: AuthResult): UnlockOutcome => logic("app_lock.unlock_outcome", { result });
