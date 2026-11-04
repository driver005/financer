//! The Settings screen: the one-line summaries shown on the collapsed rows, the connection status,
//! and hints for the bank sync form (the server has the last word).

use serde::{Deserialize, Serialize};

/// `https://financer.example.com:8443/api` -> `financer.example.com:8443`; the input if it is not an address.
pub fn server_host(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return trimmed.into();
    };
    if scheme.is_empty()
        || !scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    {
        return trimmed.into();
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = authority.rsplit('@').next().unwrap_or("");
    let default_port = match scheme.to_ascii_lowercase().as_str() {
        "http" | "ws" => Some("80"),
        "https" | "wss" => Some("443"),
        _ => None,
    };
    let host = match hostport.rsplit_once(':') {
        Some((h, p)) if !h.ends_with(']') && default_port == Some(p) => h,
        _ => hostport,
    };
    if host.is_empty() {
        trimmed.into()
    } else {
        host.to_lowercase()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub mode: String,
    pub has_config: bool,
    #[serde(default)]
    pub base_url: Option<String>,
    pub embedded_available: bool,
    #[serde(default)]
    pub embedded_error: Option<String>,
    pub settings_loaded: bool,
    #[serde(default)]
    pub settings_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectionState {
    pub tone: &'static str,
    /// Short, goes on the row ("Server", "This phone").
    pub r#where: String,
    /// What is going on, in plain words.
    pub status: String,
}

/// Read-only connection status for the top of Account & data.
pub fn connection_state(i: &ConnectionInput) -> ConnectionState {
    let state = |tone, w: &str, status: String| ConnectionState {
        tone,
        r#where: w.into(),
        status,
    };
    if i.mode == "embedded" {
        if !i.embedded_available {
            return state(
                "bad",
                "This phone",
                "This build does not include the on-phone backend".into(),
            );
        }
        if let Some(e) = i.embedded_error.as_ref().filter(|e| !e.is_empty()) {
            return state("bad", "This phone", e.clone());
        }
        return if i.settings_loaded {
            state("ok", "This phone", "Running inside this app".into())
        } else {
            state("warn", "This phone", "Starting…".into())
        };
    }
    if !i.has_config {
        return state("off", "Server", "Not connected yet".into());
    }
    let host = server_host(i.base_url.as_deref().unwrap_or(""));
    let w = if host.is_empty() {
        "Server".to_string()
    } else {
        host
    };
    if let Some(e) = i.settings_error.as_ref().filter(|e| !e.is_empty()) {
        return state("bad", &w, format!("Not reachable: {e}"));
    }
    if i.settings_loaded {
        state("ok", &w, "Connected".into())
    } else {
        state("warn", &w, "Checking…".into())
    }
}

pub fn habit_label(mode: &str) -> String {
    match mode {
        "manual" => "My own list",
        "receipts" => "Receipts",
        "spending" => "Estimate from spending",
        other => other,
    }
    .into()
}

pub fn provider_label(provider: &str) -> String {
    match provider {
        "claude" => "Claude",
        "open_ai" => "OpenAI",
        other => other,
    }
    .into()
}

/// `Claude · key set` / `OpenAI · no key`.
pub fn ai_summary(provider: &str, key_configured: bool, model: &str) -> String {
    let mut parts = vec![
        provider_label(provider),
        if key_configured {
            "key set".into()
        } else {
            "no key".into()
        },
    ];
    if !model.trim().is_empty() {
        parts.push(model.trim().into());
    }
    parts.join(" · ")
}

/// `3 price sources` / `1 price source` / `No price sources`.
pub fn price_sources_label(n: i64) -> String {
    match n {
        0 => "No price sources".into(),
        1 => "1 price source".into(),
        n => format!("{n} price sources"),
    }
}

/// `2 of 3 on`.
pub fn on_count_label(on: i64, total: i64) -> String {
    format!("{on} of {total} on")
}

/// `Day 25` or `Calendar month`.
pub fn payday_label(day: i64) -> String {
    if day == 1 {
        "Calendar month".into()
    } else {
        format!("Day {day}")
    }
}

/// A German bank code (BLZ) is eight digits. None when it looks fine or nothing was typed.
pub fn blz_problem(blz: &str) -> Option<String> {
    let v = blz.trim();
    if v.is_empty() || (v.len() == 8 && v.bytes().all(|b| b.is_ascii_digit())) {
        None
    } else {
        Some("A bank code has 8 digits.".into())
    }
}

/// ISO 7064 mod 97 check of an IBAN, spaces allowed.
pub fn iban_checksum_ok(iban: &str) -> bool {
    let v: String = iban.split_whitespace().collect::<String>().to_uppercase();
    let b = v.as_bytes();
    let shape = b.len() >= 15
        && b.len() <= 34
        && b[..2].iter().all(u8::is_ascii_uppercase)
        && b[2..4].iter().all(u8::is_ascii_digit)
        && b[4..]
            .iter()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if !shape {
        return false;
    }
    let mut rest = 0u32;
    for ch in v[4..].chars().chain(v[..4].chars()) {
        let digits = if ch.is_ascii_uppercase() {
            (ch as u32 - 55).to_string()
        } else {
            ch.to_string()
        };
        for d in digits.chars() {
            rest = (rest * 10 + d.to_digit(10).unwrap_or(0)) % 97;
        }
    }
    rest == 1
}

/// None when the IBAN looks fine or nothing was typed.
pub fn iban_problem(iban: &str) -> Option<String> {
    let v: String = iban.split_whitespace().collect();
    if v.is_empty() || iban_checksum_ok(&v) {
        None
    } else {
        Some("This IBAN does not pass the check digits. Check it for typos.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_server_address_shows_as_its_host() {
        assert_eq!(
            server_host("https://financer.example.com:8443/api"),
            "financer.example.com:8443"
        );
        assert_eq!(
            server_host("https://Financer.Example.com:443/x"),
            "financer.example.com"
        );
        assert_eq!(
            server_host("http://user:pw@192.168.1.5:8080"),
            "192.168.1.5:8080"
        );
        assert_eq!(server_host("  "), "");
        assert_eq!(server_host("not an address"), "not an address");
        assert_eq!(server_host("financer.example.com"), "financer.example.com");
    }

    fn input(over: impl FnOnce(&mut ConnectionInput)) -> ConnectionInput {
        let mut i = ConnectionInput {
            mode: "remote".into(),
            has_config: true,
            base_url: Some("https://x.test:8443".into()),
            embedded_available: true,
            embedded_error: None,
            settings_loaded: true,
            settings_error: None,
        };
        over(&mut i);
        i
    }

    #[test]
    fn the_connection_is_told_in_plain_words() {
        assert_eq!(
            connection_state(&input(|_| {})),
            ConnectionState {
                tone: "ok",
                r#where: "x.test:8443".into(),
                status: "Connected".into()
            }
        );
        assert_eq!(
            connection_state(&input(|i| i.settings_loaded = false)).status,
            "Checking…"
        );
        assert_eq!(
            connection_state(&input(|i| i.settings_error = Some("timeout".into()))).status,
            "Not reachable: timeout"
        );
        assert_eq!(
            connection_state(&input(|i| i.has_config = false)).tone,
            "off"
        );
        let phone = |f: fn(&mut ConnectionInput)| {
            connection_state(&input(|i| {
                i.mode = "embedded".into();
                f(i);
            }))
        };
        assert_eq!(phone(|_| {}).status, "Running inside this app");
        assert_eq!(phone(|i| i.settings_loaded = false).tone, "warn");
        assert_eq!(phone(|i| i.embedded_available = false).tone, "bad");
        assert_eq!(
            phone(|i| i.embedded_error = Some("no disk".into())).status,
            "no disk"
        );
    }

    #[test]
    fn the_summaries_read_well() {
        assert_eq!(habit_label("receipts"), "Receipts");
        assert_eq!(habit_label("x"), "x");
        assert_eq!(
            ai_summary("claude", true, " opus "),
            "Claude · key set · opus"
        );
        assert_eq!(ai_summary("open_ai", false, ""), "OpenAI · no key");
        assert_eq!(price_sources_label(0), "No price sources");
        assert_eq!(price_sources_label(1), "1 price source");
        assert_eq!(price_sources_label(3), "3 price sources");
        assert_eq!(on_count_label(2, 3), "2 of 3 on");
        assert_eq!(payday_label(1), "Calendar month");
        assert_eq!(payday_label(25), "Day 25");
    }

    #[test]
    fn bank_codes_and_ibans_are_checked_without_blocking() {
        assert_eq!(blz_problem(""), None);
        assert_eq!(blz_problem("37040044"), None);
        assert!(blz_problem("3704004").is_some());
        assert!(blz_problem("3704004x").is_some());
        assert!(iban_checksum_ok("DE89 3704 0044 0532 0130 00"));
        assert!(!iban_checksum_ok("DE89 3704 0044 0532 0130 01"));
        assert!(!iban_checksum_ok("short"));
        assert_eq!(iban_problem(""), None);
        assert_eq!(iban_problem("de89370400440532013000"), None);
        assert!(iban_problem("DE00370400440532013000").is_some());
    }
}
