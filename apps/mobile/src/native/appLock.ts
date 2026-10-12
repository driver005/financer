import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

import { deleteSecret, getSecret, setSecret } from "@/api/storage";
import {
  cameToForeground,
  isCovered,
  lockAvailability,
  setEnabled,
  settingsLoaded,
  startState,
  unlockOutcome,
  unlocked,
  wentToBackground,
  type Availability,
  type AuthResult,
  type LockState,
} from "@/appLock";

// The app lock: the state machine is in `@/appLock` (pure, tested); this file connects it to
// expo-local-authentication, secure storage and AppState. Nothing here runs on the web.

const LOCK_KEY = "financer.app-lock";
const isWeb = Platform.OS === "web";

type LocalAuth = typeof import("expo-local-authentication");

/** The native module, or `null` on the web and in builds that do not contain it. */
function localAuth(): LocalAuth | null {
  if (isWeb) return null;
  try {
    // required lazily: importing it throws in a build without the native module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-local-authentication") as LocalAuth;
  } catch {
    return null;
  }
}

export type LockView = {
  state: LockState;
  /** `null` until checked. */
  availability: Availability | null;
  /** A note to show in Settings after the lock had to switch itself off. */
  notice: string | null;
};

let view: LockView = {
  // nothing to protect on the web: never cover the page there
  state: isWeb ? settingsLoaded(startState(), false) : startState(),
  availability: isWeb ? lockAvailability(true, false, 0) : null,
  notice: null,
};
const listeners = new Set<() => void>();

function update(patch: Partial<LockView>) {
  view = { ...view, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to the lock state. */
export function useAppLock(): LockView {
  return useSyncExternalStore(subscribe, () => view, () => view);
}

export function isAppCovered(v: LockView): boolean {
  return isCovered(v.state);
}

/** Counts returns from the background; the cover prompts again on each. */
let foregroundTick = 0;
const tickListeners = new Set<() => void>();
export function useForegroundTick(): number {
  return useSyncExternalStore(
    (l) => {
      tickListeners.add(l);
      return () => tickListeners.delete(l);
    },
    () => foregroundTick,
    () => foregroundTick,
  );
}

async function checkAvailability(): Promise<Availability> {
  const mod = localAuth();
  if (!mod) return lockAvailability(isWeb, false, 0);
  try {
    return lockAvailability(false, true, await mod.getEnrolledLevelAsync());
  } catch {
    return lockAvailability(false, false, 0);
  }
}

/** Re-check whether the phone has a screen lock (the user may have just set one up). */
export async function refreshLockAvailability(): Promise<Availability> {
  const availability = await checkAvailability();
  update({ availability });
  return availability;
}

let started = false;

/** Read the setting and start watching the app state. Safe to call more than once. */
export async function startAppLock(): Promise<void> {
  if (started || isWeb) return;
  started = true;

  let previous = AppState.currentState;
  AppState.addEventListener("change", (next) => {
    if (next === "background") {
      update({ state: wentToBackground(view.state, Date.now()) });
    } else if (next === "active") {
      const cameBack = previous === "background";
      update({ state: cameToForeground(view.state, Date.now()) });
      if (cameBack) {
        foregroundTick += 1;
        tickListeners.forEach((l) => l());
      }
    }
    previous = next;
  });

  let enabled = false;
  let notice: string | null = null;
  try {
    enabled = (await getSecret(LOCK_KEY)) === "1";
  } catch {
    enabled = false;
  }
  const availability = await checkAvailability();
  if (enabled && !availability.available) {
    // The phone has lost its screen lock (or the module is missing). Staying locked would lock
    // the owner out for good, so give way; the setting explains it.
    enabled = false;
    notice = "The app lock was switched off because this phone no longer has a screen lock or fingerprint set up.";
    await deleteSecret(LOCK_KEY).catch(() => {});
  }
  update({ state: settingsLoaded(view.state, enabled), availability, notice });
}

let authenticating = false;
let lastAttemptEnded = 0;

async function authenticate(prompt: string): Promise<AuthResult> {
  const mod = localAuth();
  if (!mod) return { success: false, error: "not_available" };
  try {
    const r = await mod.authenticateAsync({ promptMessage: prompt, cancelLabel: "Cancel" });
    return r.success ? { success: true } : { success: false, error: r.error };
  } catch {
    return { success: false, error: "unknown" };
  }
}

/**
 * Ask the phone to confirm who is there (biometrics, falling back to the device passcode).
 * `auto` is the prompt the cover shows by itself: it is skipped if another attempt has just
 * ended, so cancelling does not make the prompt come straight back.
 */
export async function unlockApp(auto = false): Promise<void> {
  if (authenticating || !view.state.locked) return;
  if (auto && Date.now() - lastAttemptEnded < 3000) return;
  authenticating = true;
  try {
    const result = await authenticate("Unlock Financer");
    const outcome = unlockOutcome(result);
    if (outcome === "unlocked") {
      update({ state: unlocked(view.state) });
    } else if (outcome === "lock_unavailable") {
      await deleteSecret(LOCK_KEY).catch(() => {});
      update({
        state: setEnabled(view.state, false),
        availability: await checkAvailability(),
        notice: "The app lock was switched off because this phone no longer has a screen lock or fingerprint set up.",
      });
    }
  } finally {
    lastAttemptEnded = Date.now();
    authenticating = false;
  }
}

/**
 * Turn the lock on or off from Settings. Both ask the phone to confirm first: turning it on
 * proves it works (so the owner is not locked out by a broken setup), turning it off stops
 * someone who picked up the unlocked app from removing the lock.
 */
export async function setAppLockEnabled(enabled: boolean): Promise<{ ok: boolean; message: string | null }> {
  if (authenticating) return { ok: false, message: null };
  const availability = await refreshLockAvailability();
  if (enabled && !availability.available) return { ok: false, message: availability.reason };
  authenticating = true;
  try {
    const result = await authenticate(enabled ? "Confirm to turn on the app lock" : "Confirm to turn off the app lock");
    if (!result.success) {
      const gone = unlockOutcome(result) === "lock_unavailable";
      if (gone && !enabled) {
        // no screen lock any more: nothing to confirm with, let them switch it off
      } else {
        return {
          ok: false,
          message: gone ? "This phone has no screen lock or fingerprint set up." : "Not confirmed, so the lock was left as it was.",
        };
      }
    }
    if (enabled) await setSecret(LOCK_KEY, "1");
    else await deleteSecret(LOCK_KEY);
    update({ state: setEnabled(view.state, enabled), notice: null });
    return { ok: true, message: null };
  } catch {
    return { ok: false, message: "Could not save the setting." };
  } finally {
    lastAttemptEnded = Date.now();
    authenticating = false;
  }
}
