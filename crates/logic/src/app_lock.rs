//! The app lock: when to lock, what an unlock attempt means, whether the lock can be offered at all.
//! Asking the phone (biometrics, the app going to the background) stays in TypeScript.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Locked again when the app comes back after being in the background for longer than this.
pub const LOCK_AFTER_MS: f64 = 60_000.0;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LockState {
    /// The user turned the lock on.
    pub enabled: bool,
    /// The settings have been read; until then the app stays covered.
    pub ready: bool,
    pub locked: bool,
    /// When the app went to the background; `None` while it is in front.
    pub backgrounded_at: Option<f64>,
}

/// At start everything is covered until we know whether the lock is on.
pub fn start_state() -> LockState {
    LockState {
        enabled: false,
        ready: false,
        locked: true,
        backgrounded_at: None,
    }
}

/// The stored setting has been read. With the lock on, the app starts locked.
pub fn settings_loaded(_previous: &LockState, enabled: bool) -> LockState {
    LockState {
        enabled,
        ready: true,
        locked: enabled,
        backgrounded_at: None,
    }
}

/// The user switched the lock on or off (having just proven who they are).
pub fn set_enabled(s: &LockState, enabled: bool) -> LockState {
    LockState {
        enabled,
        locked: false,
        backgrounded_at: None,
        ..s.clone()
    }
}

pub fn went_to_background(s: &LockState, now: f64) -> LockState {
    // Already covered, or lock off: nothing to protect, and a half-finished unlock prompt must
    // not leave a stale timestamp behind.
    if !s.enabled || s.locked || s.backgrounded_at.is_some() {
        return s.clone();
    }
    LockState {
        backgrounded_at: Some(now),
        ..s.clone()
    }
}

pub fn came_to_foreground(s: &LockState, now: f64, after_ms: f64) -> LockState {
    let Some(at) = s.backgrounded_at else {
        return s.clone();
    };
    let away = now - at;
    // a clock that moved backwards (away < 0) cannot prove the app was gone only briefly
    let lock = s.enabled && (away < 0.0 || away > after_ms);
    LockState {
        locked: s.locked || lock,
        backgrounded_at: None,
        ..s.clone()
    }
}

pub fn unlocked(s: &LockState) -> LockState {
    LockState {
        locked: false,
        backgrounded_at: None,
        ..s.clone()
    }
}

/// What the screen shows: the app, or the cover.
pub fn is_covered(s: &LockState) -> bool {
    !s.ready || s.locked
}

/// Whether the lock can be offered, and if not, a sentence for the setting that says why. `level` is
/// expo-local-authentication's `SecurityLevel`: 0 none, 1 PIN/pattern/passcode, above that biometrics.
pub fn lock_availability(is_web: bool, native_module: bool, level: f64) -> Value {
    let no = |reason: &str| json!({ "available": false, "reason": reason });
    if is_web {
        no("The app lock is only available in the phone app, not in the browser.")
    } else if !native_module {
        no("This build does not include the lock (it needs a development build or the store app).")
    } else if level <= 0.0 {
        no("Set a screen lock (passcode, PIN or pattern) or add a fingerprint or face in your phone's settings first.")
    } else {
        json!({ "available": true })
    }
}

/// What an unlock attempt means. If the phone no longer has a screen lock, nobody could ever
/// unlock the app again, so the lock must give way (anyone could open the phone anyway).
pub fn unlock_outcome(result: &Value) -> &'static str {
    if result
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return "unlocked";
    }
    match result.get("error").and_then(Value::as_str) {
        Some("not_enrolled" | "passcode_not_set" | "not_available") => "lock_unavailable",
        _ => "try_again",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_starts_covered_and_locks_after_a_long_absence() {
        let s = settings_loaded(&start_state(), true);
        assert!(s.locked && s.ready && is_covered(&s));
        let s = unlocked(&s);
        assert!(!is_covered(&s));
        let away = went_to_background(&s, 1000.0);
        assert_eq!(away.backgrounded_at, Some(1000.0));
        assert!(!came_to_foreground(&away, 1000.0 + 30_000.0, LOCK_AFTER_MS).locked);
        assert!(came_to_foreground(&away, 1000.0 + 90_000.0, LOCK_AFTER_MS).locked);
        assert!(
            came_to_foreground(&away, 500.0, LOCK_AFTER_MS).locked,
            "a clock that went back proves nothing"
        );
        assert_eq!(
            went_to_background(&settings_loaded(&start_state(), false), 5.0).backgrounded_at,
            None
        );
        assert_eq!(set_enabled(&away, false).backgrounded_at, None);
    }

    #[test]
    fn the_lock_gives_way_when_the_phone_has_no_screen_lock() {
        assert_eq!(unlock_outcome(&json!({ "success": true })), "unlocked");
        assert_eq!(
            unlock_outcome(&json!({ "success": false, "error": "user_cancel" })),
            "try_again"
        );
        assert_eq!(
            unlock_outcome(&json!({ "success": false, "error": "not_enrolled" })),
            "lock_unavailable"
        );
        assert_eq!(
            lock_availability(false, true, 1.0),
            json!({ "available": true })
        );
        assert_eq!(lock_availability(true, true, 1.0)["available"], false);
        assert!(lock_availability(false, true, 0.0)["reason"]
            .as_str()
            .unwrap()
            .starts_with("Set a screen lock"));
    }
}
