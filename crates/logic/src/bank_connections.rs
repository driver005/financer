//! The Bank connections card in Settings. The connections are described in the server's
//! `financer.toml`, each with a provider: FinTS (the server logs in, waits for the approval in the
//! banking app and imports) or Plaid (you sign in once on Plaid's page; after that there is no PIN
//! and no approval). The card only shows the state and starts or cancels a sync.
//!
//! A connection is the API's `BankConnectionDto`, read as plain JSON. Stamps in the device's time
//! zone stay in TypeScript.

use serde_json::Value;

fn s<'a>(c: &'a Value, key: &str) -> &'a str {
    c.get(key).and_then(Value::as_str).unwrap_or("")
}

fn b(c: &Value, key: &str) -> bool {
    c.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn n(c: &Value, key: &str) -> Option<f64> {
    c.get(key).and_then(Value::as_f64)
}

/// JavaScript's `Math.round`: halves go up (also below zero).
fn js_round(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

fn plural(n: i64) -> &'static str {
    if n == 1 {
        ""
    } else {
        "s"
    }
}

pub fn is_busy(c: &Value) -> bool {
    matches!(s(c, "state"), "syncing" | "needs_approval" | "needs_link")
}

pub fn is_plaid(c: &Value) -> bool {
    s(c, "kind") == "plaid"
}

/// A Plaid connection that has not been signed in to a bank yet.
pub fn needs_linking(c: &Value) -> bool {
    is_plaid(c) && !b(c, "linked")
}

/// `Plaid` or `Bank (FinTS)`, for the line under the name.
pub fn provider_label(c: &Value) -> &'static str {
    if is_plaid(c) {
        "Plaid"
    } else {
        "Bank (FinTS)"
    }
}

fn accounts(c: &Value) -> &[Value] {
    c.get("accounts")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// The line under the connection's name: what it is connected to.
pub fn connection_subtitle(c: &Value) -> String {
    if !is_plaid(c) {
        return format!(
            "Bank code {} · login {} · {}",
            s(c, "bank_code"),
            s(c, "login_masked"),
            s(c, "iban_masked")
        );
    }
    if !b(c, "linked") {
        return "Plaid · not connected yet".into();
    }
    let count = accounts(c).len();
    if count == 0 {
        "Plaid · connected".into()
    } else {
        format!("Plaid · {count} account{} connected", plural(count as i64))
    }
}

/// The linked accounts as `Giro ••0000, Tagesgeld ••1111`, or `None` when there are none.
pub fn linked_accounts_text(c: &Value) -> Option<String> {
    let list = accounts(c);
    if list.is_empty() {
        return None;
    }
    Some(
        list.iter()
            .map(|a| match s(a, "mask") {
                "" => s(a, "name").to_string(),
                mask => format!("{} ••{mask}", s(a, "name")),
            })
            .collect::<Vec<_>>()
            .join(", "),
    )
}

/// What the main button says.
pub fn sync_button_label(c: &Value, starting: bool) -> &'static str {
    match (starting, needs_linking(c)) {
        (true, true) => "Opening…",
        (true, false) => "Starting…",
        (false, true) => "Connect your bank",
        (false, false) => "Sync now",
    }
}

pub fn any_busy(list: &[Value]) -> bool {
    list.iter().any(is_busy)
}

/// The text of the state chip.
pub fn state_label(c: &Value) -> &'static str {
    match s(c, "state") {
        "syncing" => "Syncing",
        "needs_approval" => "Needs approval",
        "needs_link" => "Sign in to your bank",
        "error" => "Error",
        _ if needs_linking(c) => "Not connected",
        _ if b(c, "sync_due") => "Sync due",
        _ => "Ready",
    }
}

pub fn state_tone(c: &Value) -> &'static str {
    match s(c, "state") {
        "syncing" | "needs_approval" | "needs_link" => "warn",
        "error" => "bad",
        _ if needs_linking(c) => "muted",
        _ if b(c, "sync_due") => "warn",
        _ => "good",
    }
}

/// A FinTS PIN has to be typed in the app unless the server has it in the environment. Plaid has no PIN.
pub fn needs_typed_pin(c: &Value) -> bool {
    !is_plaid(c) && !b(c, "pin_from_env")
}

/// Whether the main button can be pressed with what has been typed.
pub fn can_sync(c: &Value, typed_pin: &str) -> bool {
    !is_busy(c) && (is_plaid(c) || b(c, "pin_from_env") || !typed_pin.is_empty())
}

/// What the last attempt did, or `None` when there was none. Stamps are written in the given time zone.
pub fn last_result_text(c: &Value, zone: &str) -> Result<Option<String>, String> {
    let Some(r) = c.get("last_result").filter(|r| !r.is_null()) else {
        return Ok(None);
    };
    let stamp = crate::app_misc::format_stamp(n(r, "at").unwrap_or(0.0), zone)?;
    if !b(r, "ok") {
        return Ok(Some(format!("Last attempt {stamp} failed.")));
    }
    let count = |key: &str| n(r, key).unwrap_or(0.0) as i64;
    Ok(Some(format!(
        "Last sync {stamp}: {} new, {} already known.",
        count("imported"),
        count("duplicates")
    )))
}

/// When the next scheduled sync is, in words.
pub fn next_sync_text(c: &Value, now_seconds: f64) -> Option<String> {
    if needs_linking(c) {
        return Some("Press Connect your bank to sign in once on Plaid's page. After that a sync needs no PIN and no approval.".into());
    }
    let every_hours = n(c, "sync_every_hours").unwrap_or(0.0);
    if every_hours <= 0.0 {
        return Some("Syncs only when you press Sync now.".into());
    }
    let next = n(c, "next_sync_at")?;
    let mins = js_round((next - now_seconds) / 60.0);
    let every = if every_hours == 1.0 {
        "every hour".to_string()
    } else {
        format!("every {} hours", every_hours as i64)
    };
    Some(if b(c, "sync_due") {
        format!(
            "Scheduled {every}. Due now: press Sync now and enter your PIN, the server has none."
        )
    } else if mins <= 0 {
        format!("Scheduled {every}. Due now.")
    } else if mins < 90 {
        format!(
            "Scheduled {every}. Next in about {mins} minute{}.",
            plural(mins)
        )
    } else {
        format!(
            "Scheduled {every}. Next in about {} hours.",
            js_round(mins as f64 / 60.0)
        )
    })
}

/// How long the server keeps waiting for the approval, or for you to finish signing in on Plaid's page.
pub fn approval_left_text(c: &Value, now_seconds: f64) -> Option<String> {
    if !matches!(s(c, "state"), "needs_approval" | "needs_link") {
        return None;
    }
    let secs = n(c, "approval_expires_at")? - now_seconds;
    if secs <= 0.0 {
        return Some("Time is about up.".into());
    }
    let mins = (secs / 60.0).ceil() as i64;
    Some(format!(
        "The server waits about {mins} more minute{}.",
        plural(mins)
    ))
}

/// Only a web address that Plaid hands out is opened: https, on a plaid.com host.
pub fn is_safe_link_url(url: Option<&str>) -> bool {
    let Some(url) = url else {
        return false;
    };
    // a browser would drop tabs and line breaks inside an address; refuse anything that has them
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#', '\\']).next().unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let host = match host_port.rsplit_once(':') {
        Some((h, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => h,
        Some(_) => return false,
        None => host_port,
    }
    .to_ascii_lowercase();
    host == "plaid.com" || host.ends_with(".plaid.com")
}

/// `Girokonto` -> a stable key for React lists and PIN fields.
pub fn connection_key(c: &Value) -> String {
    s(c, "name").trim().to_lowercase()
}

/// What to tell someone when live bank sync has no FinTS product id yet.
pub fn live_sync_missing(on_phone: bool) -> (&'static str, &'static str) {
    if on_phone {
        (
            "Live sync is not set up on this phone",
            "It needs a FinTS product id, which you request from the Deutsche Kreditwirtschaft. Add it under Settings > On-phone settings. See docs/FINTS.md. Until then, import a CSV export on the Spending tab.",
        )
    } else {
        (
            "Live sync is not set up on the server",
            "It needs a FinTS product id, which you request from the Deutsche Kreditwirtschaft. Add it under Settings, Server settings, Bank providers (or set FINANCER_FINTS_PRODUCT_ID, or bank.fints_product_id in financer.toml). See docs/FINTS.md. Until then, import a CSV export on the Spending tab.",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plaid_links_are_the_only_ones_opened() {
        assert!(is_safe_link_url(Some("https://secure.plaid.com/hl/abc")));
        assert!(is_safe_link_url(Some("https://plaid.com/x")));
        for bad in [
            "http://secure.plaid.com/hl/abc",
            "https://plaid.com.evil.example/x",
            "https://evilplaid.com/x",
            "https://evil.example\\@plaid.com/",
            "https://evil.example@plaid.com.evil.example/",
            "javascript:alert(1)",
            "not a url",
            "",
        ] {
            assert!(!is_safe_link_url(Some(bad)), "{bad}");
        }
        assert!(!is_safe_link_url(None));
    }

    #[test]
    fn the_last_attempt_is_told_in_the_zone() {
        let ok = json!({ "last_result": { "ok": true, "at": 1_793_696_400, "imported": 3, "duplicates": 1 } });
        assert_eq!(
            last_result_text(&ok, "Europe/Berlin").unwrap().as_deref(),
            Some("Last sync 03.11.2026 10:00: 3 new, 1 already known.")
        );
        let failed = json!({ "last_result": { "ok": false, "at": 1_793_696_400 } });
        assert_eq!(
            last_result_text(&failed, "UTC").unwrap().as_deref(),
            Some("Last attempt 03.11.2026 09:00 failed.")
        );
        assert_eq!(last_result_text(&json!({}), "UTC").unwrap(), None);
    }

    #[test]
    fn states_are_said_in_words() {
        let fints = json!({ "kind": "fints", "state": "idle", "sync_due": true, "sync_every_hours": 6, "next_sync_at": 1000, "pin_from_env": false });
        assert_eq!(state_label(&fints), "Sync due");
        assert_eq!(state_tone(&fints), "warn");
        assert!(!can_sync(&fints, ""));
        assert!(can_sync(&fints, "1234"));
        assert_eq!(
            next_sync_text(&fints, 0.0).as_deref(),
            Some("Scheduled every 6 hours. Due now: press Sync now and enter your PIN, the server has none.")
        );
        let plaid = json!({ "kind": "plaid", "linked": false, "state": "idle", "accounts": [] });
        assert_eq!(sync_button_label(&plaid, false), "Connect your bank");
        assert_eq!(state_label(&plaid), "Not connected");
    }
}
