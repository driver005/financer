//! The Bank connections card in Settings. The connections are described in the server's
//! `financer.toml`, each with a provider: FinTS (the server logs in, waits for the approval in the
//! banking app and imports), or Plaid, GoCardless or finAPI (you sign in once on the provider's
//! page; after that there is no PIN and no approval). The card only shows the state and starts or
//! cancels a sync.
//!
//! A connection is the API's `BankConnectionDto`, a sync the API's `SyncDto`, both read as plain
//! JSON. Stamps in the device's time zone stay in TypeScript.

use serde_json::Value;

use crate::format::{format_cents, format_date};

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

/// Plaid, GoCardless and finAPI: sign in once on the provider's page, then no PIN and no approval.
pub fn links_once(c: &Value) -> bool {
    s(c, "kind") != "fints"
}

/// A connection that has not been signed in to a bank yet (Plaid, GoCardless, finAPI).
pub fn needs_linking(c: &Value) -> bool {
    links_once(c) && !b(c, "linked")
}

/// `Plaid`, `GoCardless`, `finAPI` or `Bank (FinTS)`, for the line under the name; a kind this
/// app does not know is shown as it is.
pub fn provider_label(c: &Value) -> String {
    match s(c, "kind") {
        "plaid" => "Plaid".into(),
        "gocardless" => "GoCardless".into(),
        "finapi" => "finAPI".into(),
        "fints" => "Bank (FinTS)".into(),
        other => other.into(),
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
    if !links_once(c) {
        return format!(
            "Bank code {} · login {} · {}",
            s(c, "bank_code"),
            s(c, "login_masked"),
            s(c, "iban_masked")
        );
    }
    let name = provider_label(c);
    if !b(c, "linked") {
        return format!("{name} · not connected yet");
    }
    let count = accounts(c).len();
    if count == 0 {
        format!("{name} · connected")
    } else {
        format!("{name} · {count} account{} connected", plural(count as i64))
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

/// A FinTS PIN has to be typed in the app unless the server has it in the environment. The others have no PIN.
pub fn needs_typed_pin(c: &Value) -> bool {
    !links_once(c) && !b(c, "pin_from_env")
}

/// Whether the main button can be pressed with what has been typed.
pub fn can_sync(c: &Value, typed_pin: &str) -> bool {
    !is_busy(c) && (links_once(c) || b(c, "pin_from_env") || !typed_pin.is_empty())
}

/// When the next scheduled sync is, in words.
pub fn next_sync_text(c: &Value, now_seconds: f64) -> Option<String> {
    if needs_linking(c) {
        return Some(format!(
            "Press Connect your bank to sign in once on {}'s page. After that a sync needs no PIN and no approval.",
            provider_label(c)
        ));
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

/// How long the server keeps waiting for the approval, or for you to finish signing in on the provider's page.
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

/// The hosts whose sign-in pages are opened: Plaid, GoCardless (its bank pages) and finAPI (its web form).
const LINK_HOSTS: [&str; 3] = ["plaid.com", "gocardless.com", "finapi.io"];

/// Only a web address that one of the providers hands out is opened: https, on one of their hosts.
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
    LINK_HOSTS
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
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

// ---------------------------------------------------------------- one protocol for every provider

/// A sync is still waiting for something: the bank, an approval, or the sign-in.
pub fn is_running(sync: &Value) -> bool {
    matches!(
        s(sync, "state"),
        "syncing" | "needs_approval" | "needs_link"
    )
}

/// The connection as it looks while the given sync runs (what the sync call and its polls report).
pub fn apply_sync(c: &Value, sync: &Value) -> Value {
    let mut out = c.clone();
    if let Some(map) = out.as_object_mut() {
        let get = |key: &str| sync.get(key).cloned().unwrap_or(Value::Null);
        map.insert("state".into(), get("state"));
        map.insert("message".into(), get("message"));
        map.insert("link_url".into(), get("link_url"));
        map.insert("approval_expires_at".into(), get("expires_at"));
    }
    out
}

/// How a finished sync ended, in a sentence; `None` while it runs or when nothing is known.
pub fn sync_result_text(sync: &Value) -> Option<String> {
    if is_running(sync) {
        return None;
    }
    let result = sync.get("result").filter(|r| !r.is_null());
    let ok = result.map(|r| b(r, "ok"));
    if s(sync, "state") == "error" || ok == Some(false) {
        let message = [sync, result.unwrap_or(&Value::Null)]
            .iter()
            .map(|v| s(v, "message"))
            .find(|m| !m.is_empty());
        return Some(message.unwrap_or("The sync failed.").to_string());
    }
    let r = result?;
    let count = |key: &str| r.get(key).and_then(Value::as_i64).unwrap_or(0);
    let balance = match r.get("balance_cents").and_then(Value::as_i64) {
        Some(cents) => {
            let date = match s(r, "balance_date") {
                "" => String::new(),
                d => format!(" ({})", format_date(d)),
            };
            format!(" Balance {}{date}.", format_cents(cents))
        }
        None => String::new(),
    };
    Some(format!(
        "Imported {} new transactions, {} were already known.{balance}",
        count("imported"),
        count("duplicates")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_providers_own_pages_are_the_only_ones_opened() {
        assert!(is_safe_link_url(Some("https://secure.plaid.com/hl/abc")));
        assert!(is_safe_link_url(Some("https://plaid.com/x")));
        assert!(is_safe_link_url(Some(
            "https://ob.gocardless.com/psd2/start/x"
        )));
        assert!(is_safe_link_url(Some("https://webform.finapi.io/wf/abc")));
        for bad in [
            "http://secure.plaid.com/hl/abc",
            "https://plaid.com.evil.example/x",
            "https://evilplaid.com/x",
            "https://gocardless.com.evil.example/x",
            "https://evilfinapi.io/x",
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

    #[test]
    fn every_provider_that_links_once_reads_the_same() {
        let gc = json!({ "kind": "gocardless", "linked": false, "state": "idle", "accounts": [] });
        assert!(links_once(&gc) && needs_linking(&gc));
        assert_eq!(provider_label(&gc), "GoCardless");
        assert_eq!(connection_subtitle(&gc), "GoCardless · not connected yet");
        assert_eq!(state_label(&gc), "Not connected");
        assert!(can_sync(&gc, "") && !needs_typed_pin(&gc));
        assert_eq!(
            next_sync_text(&gc, 0.0).as_deref(),
            Some("Press Connect your bank to sign in once on GoCardless's page. After that a sync needs no PIN and no approval.")
        );
        let linked = json!({ "kind": "finapi", "linked": true, "accounts": [{ "name": "Giro" }, { "name": "Tages" }] });
        assert_eq!(
            connection_subtitle(&linked),
            "finAPI · 2 accounts connected"
        );
        assert_eq!(provider_label(&json!({ "kind": "other" })), "other");
        assert!(needs_typed_pin(
            &json!({ "kind": "fints", "pin_from_env": false })
        ));
    }

    #[test]
    fn a_sync_is_shown_on_its_connection_and_said_in_a_sentence() {
        let running = json!({ "state": "needs_link", "message": "Sign in", "link_url": "https://ob.gocardless.com/x", "expires_at": 1700 });
        assert!(is_running(&running));
        let shown = apply_sync(&json!({ "name": "Giro", "state": "idle" }), &running);
        assert_eq!(shown["state"], "needs_link");
        assert_eq!(shown["link_url"], "https://ob.gocardless.com/x");
        assert_eq!(shown["approval_expires_at"], 1700);
        assert_eq!(shown["name"], "Giro");

        assert_eq!(
            sync_result_text(&json!({ "state": "needs_approval" })),
            None
        );
        assert_eq!(
            sync_result_text(&json!({ "state": "idle", "result": null })),
            None
        );
        let ok = json!({ "ok": true, "imported": 2, "duplicates": 1, "balance_cents": 123456, "balance_date": "2026-03-09" });
        assert_eq!(
            sync_result_text(&json!({ "state": "idle", "result": ok })).as_deref(),
            Some("Imported 2 new transactions, 1 were already known. Balance 1.234,56 € (09.03.2026).")
        );
        let no_balance = json!({ "ok": true, "imported": 2, "duplicates": 1, "balance_cents": null, "balance_date": null });
        assert_eq!(
            sync_result_text(&json!({ "state": "idle", "result": no_balance })).as_deref(),
            Some("Imported 2 new transactions, 1 were already known.")
        );
        assert_eq!(
            sync_result_text(&json!({ "state": "error", "message": "the bank refused the login" }))
                .as_deref(),
            Some("the bank refused the login")
        );
        assert_eq!(
            sync_result_text(
                &json!({ "state": "idle", "result": { "ok": false, "message": "no access" } })
            )
            .as_deref(),
            Some("no access")
        );
    }
}
