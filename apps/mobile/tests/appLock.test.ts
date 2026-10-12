import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOCK_AFTER_MS,
  cameToForeground,
  isCovered,
  lockAvailability,
  setEnabled,
  settingsLoaded,
  startState,
  unlockOutcome,
  unlocked,
  wentToBackground,
} from "../src/appLock";

const T = 1_000_000;

describe("lock state", () => {
  it("is covered until the setting is read", () => {
    assert.equal(isCovered(startState()), true);
  });
  it("starts locked when the lock is on, open when it is off", () => {
    const on = settingsLoaded(startState(), true);
    assert.equal(isCovered(on), true);
    assert.equal(on.locked, true);
    const off = settingsLoaded(startState(), false);
    assert.equal(isCovered(off), false);
  });
  it("stays locked until unlocked", () => {
    const s = unlocked(settingsLoaded(startState(), true));
    assert.equal(isCovered(s), false);
  });
  it("locks after more than 60 seconds in the background", () => {
    let s = unlocked(settingsLoaded(startState(), true));
    s = wentToBackground(s, T);
    assert.equal(cameToForeground(s, T + LOCK_AFTER_MS + 1).locked, true);
  });
  it("does not lock for a short absence, exactly 60 seconds included", () => {
    let s = unlocked(settingsLoaded(startState(), true));
    s = wentToBackground(s, T);
    assert.equal(cameToForeground(s, T + 5_000).locked, false);
    assert.equal(cameToForeground(s, T + LOCK_AFTER_MS).locked, false);
  });
  it("locks if the clock went backwards", () => {
    let s = unlocked(settingsLoaded(startState(), true));
    s = wentToBackground(s, T);
    assert.equal(cameToForeground(s, T - 10).locked, true);
  });
  it("never locks when the lock is off", () => {
    let s = settingsLoaded(startState(), false);
    s = wentToBackground(s, T);
    assert.equal(s.backgroundedAt, null);
    assert.equal(cameToForeground(s, T + 10 * LOCK_AFTER_MS).locked, false);
  });
  it("keeps the first background time if told twice, and clears it on return", () => {
    let s = unlocked(settingsLoaded(startState(), true));
    s = wentToBackground(s, T);
    s = wentToBackground(s, T + 50_000);
    assert.equal(s.backgroundedAt, T);
    assert.equal(cameToForeground(s, T + 50_000).backgroundedAt, null);
  });
  it("ignores a return without a matching background event", () => {
    const s = unlocked(settingsLoaded(startState(), true));
    assert.deepEqual(cameToForeground(s, T), s);
  });
  it("a locked app stays locked across background and foreground", () => {
    let s = settingsLoaded(startState(), true);
    s = wentToBackground(s, T);
    assert.equal(cameToForeground(s, T + 1).locked, true);
  });
  it("an unlock that finishes after a background trip leaves no stale timestamp", () => {
    let s = unlocked(settingsLoaded(startState(), true));
    s = wentToBackground(s, T);
    s = unlocked(s);
    assert.equal(s.backgroundedAt, null);
    assert.equal(cameToForeground(s, T + 10 * LOCK_AFTER_MS).locked, false);
  });
  it("turning the lock on does not lock the current session; turning it off clears it", () => {
    const off = settingsLoaded(startState(), false);
    const on = setEnabled(off, true);
    assert.equal(on.enabled && !isCovered(on), true);
    const back = setEnabled(settingsLoaded(startState(), true), false);
    assert.equal(isCovered(back), false);
  });
});

describe("lockAvailability", () => {
  it("is unavailable on the web, with a reason", () => {
    const a = lockAvailability(true, true, 3);
    assert.equal(a.available, false);
    assert.match((a as { reason: string }).reason, /browser/);
  });
  it("is unavailable without the native module", () => {
    assert.equal(lockAvailability(false, false, 3).available, false);
  });
  it("is unavailable when nothing is enrolled, and says what to do", () => {
    const a = lockAvailability(false, true, 0);
    assert.equal(a.available, false);
    assert.match((a as { reason: string }).reason, /screen lock/);
  });
  it("is available with a passcode only or with biometrics", () => {
    assert.equal(lockAvailability(false, true, 1).available, true);
    assert.equal(lockAvailability(false, true, 3).available, true);
  });
});

describe("unlockOutcome", () => {
  it("unlocks on success", () => {
    assert.equal(unlockOutcome({ success: true }), "unlocked");
  });
  it("lets the user try again after cancel or a failed attempt", () => {
    for (const error of ["user_cancel", "authentication_failed", "lockout", "system_cancel", "timeout", "unknown"]) {
      assert.equal(unlockOutcome({ success: false, error }), "try_again", error);
    }
  });
  it("gives way when the phone has no screen lock any more, so nobody is locked out for good", () => {
    for (const error of ["not_enrolled", "passcode_not_set", "not_available"]) {
      assert.equal(unlockOutcome({ success: false, error }), "lock_unavailable", error);
    }
  });
});
