//! The Receipt sources screen: names and texts for the sources, the status pill, "last synced"
//! wording, setup help, and reading the callback address of a shop's sign-in.

use serde::{Deserialize, Serialize};

/// The fields of a source the list helpers read (a subset of the API's `ReceiptSource`).
#[derive(Deserialize)]
pub struct SourceLike {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub imported_total: Option<f64>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Pill {
    pub label: &'static str,
    pub tone: &'static str,
    pub icon: &'static str,
}

pub fn source_title(s: &str) -> String {
    match s {
        "email" => "Email",
        "lidl_plus" => "Lidl Plus",
        "kaufland_card" => "Kaufland Card",
        "rewe_app" => "REWE eBon (app)",
        "folder" => "Watched folder",
        other => other,
    }
    .to_string()
}

pub fn source_icon(s: &str) -> &'static str {
    match s {
        "email" => "email-fast-outline",
        "lidl_plus" => "cart-heart",
        "kaufland_card" => "card-account-details-outline",
        "folder" => "folder-download-outline",
        _ => "receipt-text-outline",
    }
}

/// One line saying what the source does.
pub fn source_blurb(s: &str) -> &'static str {
    match s {
        "email" => {
            "Reads the receipt mails your shops send you (REWE eBon and others) from your mailbox."
        }
        "lidl_plus" => {
            "Reads your Lidl Plus receipts after you sign in on Lidl's own page. Experimental."
        }
        "kaufland_card" => {
            "Reads the digital receipts of your Kaufland Card after you sign in on Kaufland's own page. Experimental."
        }
        "folder" => {
            "Imports any receipt PDF, text or web page you drop into a folder on your server."
        }
        _ => "",
    }
}

/// Label, tone and icon of the status chip. The label always says it in words (colour is not the only cue).
pub fn health_pill(state: &str) -> Pill {
    let (label, tone, icon) = match state {
        "ok" => ("Working", "good", "check-circle-outline"),
        "running" => ("Syncing", "blue", "sync"),
        "waiting" => ("Waiting for first run", "muted", "clock-outline"),
        "error" => ("Problem", "bad", "alert-circle-outline"),
        "not_connected" => ("Not connected", "warn", "link-off"),
        "needs_signin" => ("Sign in again", "warn", "login"),
        _ => ("Off", "muted", "power-sleep"),
    };
    Pill { label, tone, icon }
}

/// "Never", "Just now", "12 min ago", "3 h ago", "Yesterday", "5 days ago".
pub fn last_sync_text(ts: Option<f64>, now_sec: f64) -> String {
    let Some(ts) = ts else {
        return "Never".into();
    };
    let diff = (now_sec - ts).max(0.0);
    if diff < 60.0 {
        "Just now".into()
    } else if diff < 3600.0 {
        format!("{} min ago", (diff / 60.0).floor() as i64)
    } else if diff < 86_400.0 {
        format!("{} h ago", (diff / 3600.0).floor() as i64)
    } else {
        let days = (diff / 86_400.0).floor() as i64;
        if days == 1 {
            "Yesterday".into()
        } else {
            format!("{days} days ago")
        }
    }
}

/// JavaScript's `Math.round`: halves go up.
fn js_round(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

/// "Next run in 25 min", "Next run in 3 h", "Next run due now".
pub fn next_run_text(ts: Option<f64>, now_sec: f64) -> Option<String> {
    let diff = ts? - now_sec;
    Some(if diff <= 30.0 {
        "Next run due now".into()
    } else if diff < 3600.0 {
        format!("Next run in {} min", js_round(diff / 60.0).max(1))
    } else if diff < 86_400.0 {
        format!("Next run in {} h", js_round(diff / 3600.0))
    } else {
        format!("Next run in {} days", js_round(diff / 86_400.0))
    })
}

pub fn imported_text(n: i64) -> String {
    if n <= 0 {
        "No receipts yet".into()
    } else if n == 1 {
        "1 receipt imported".into()
    } else {
        format!("{n} receipts imported")
    }
}

/// Can "Sync now" do something for this source?
pub fn can_sync_now(enabled: bool, state: &str) -> bool {
    enabled && !["running", "not_connected", "needs_signin", "disabled"].contains(&state)
}

/// Sources that need the person to do something.
pub fn attention_count(list: &[SourceLike]) -> usize {
    list.iter()
        .filter(|s| {
            s.enabled && ["error", "needs_signin", "not_connected"].contains(&s.state.as_str())
        })
        .count()
}

/// The header sentence: how many sources are on and how many receipts they brought.
pub fn summary_text(list: &[SourceLike]) -> String {
    let on = list.iter().filter(|s| s.enabled).count();
    let receipts: i64 = list
        .iter()
        .map(|s| s.imported_total.unwrap_or(0.0) as i64)
        .sum();
    if on == 0 {
        return "No automatic source is switched on yet.".into();
    }
    let sources = format!("{on} of {} sources on", list.len());
    if receipts == 0 {
        sources
    } else {
        format!(
            "{sources}, {receipts} {} imported",
            if receipts == 1 { "receipt" } else { "receipts" }
        )
    }
}

/// What a finished sync did, for a short message under the button.
pub fn sync_result_text(imported: i64, linked: i64) -> String {
    let found = match imported {
        0 => "No new receipts".to_string(),
        1 => "1 new receipt".to_string(),
        n => format!("{n} new receipts"),
    };
    if linked <= 0 {
        return format!("{found}.");
    }
    format!(
        "{found}; {} to a bank payment.",
        if linked == 1 {
            "1 matched".to_string()
        } else {
            format!("{linked} matched")
        }
    )
}

/// Setup steps of a source. The same on the phone as on a server: both are configured through the
/// Server settings screen (or `financer.toml`), and a saved change restarts the backend by itself.
pub fn setup_steps(s: &str) -> Vec<&'static str> {
    match s {
        "email" => vec![
            "Set the password in an environment variable of the backend, for example FINANCER_IMAP_PASSWORD. It never goes into the settings.",
            "Add your mail server (host), your login (username) and the folder under Settings > Server settings > Receipts, or in a [receipts.email] section of financer.toml.",
            "Only mails from the shops' own addresses are downloaded; all other mail stays untouched.",
        ],
        "lidl_plus" => vec![
            "Switch it on under Settings > Server settings > Lidl Plus (enabled), or with enabled = true under [receipts.lidl_plus] in financer.toml. The backend restarts by itself.",
            "Come back here and tap Connect. You sign in on Lidl's own page; Financer never sees your password.",
        ],
        "kaufland_card" => vec![
            "Switch it on under Settings > Server settings > Kaufland Card (enabled), or with enabled = true under [receipts.kaufland] in financer.toml. The backend restarts by itself.",
            "Come back here and tap Connect. You sign in on Kaufland's own page; Financer never sees your password.",
        ],
        "folder" => vec![
            "Set the path of a folder the backend can read under Settings > Server settings > Receipts, or in a [receipts.folder] section of financer.toml.",
            "Then drop receipt PDFs, text or web pages into that folder (a synced cloud folder works well).",
        ],
        _ => vec![],
    }
}

/// The short, plain statements shown on the sign-in card of a shop (`Lidl`, `Kaufland`).
pub fn sign_in_promises(shop: &str) -> Vec<String> {
    vec![
        format!("You sign in on {shop}'s own page. Financer never sees your password."),
        "Only a refresh token is stored, in the backend's database, encrypted.".into(),
        format!("This is unofficial. {shop} has no public interface for this, so it can stop working at any time."),
        "You can disconnect whenever you like. That deletes the token; receipts already imported stay.".into(),
    ]
}

/// The statements of the Lidl Plus card.
pub fn lidl_promises() -> Vec<String> {
    sign_in_promises("Lidl")
}

/// What "Disconnect" says happened to the saved sign-in.
pub fn disconnected_text() -> &'static str {
    "Disconnected. The saved sign-in was deleted from the backend."
}

/// The empty state when no receipt source is on.
pub fn no_source_text() -> &'static str {
    "Receipts can arrive from your mailbox, from Lidl Plus, from the Kaufland Card or from a folder. Sources are switched on under Settings > Server settings; the cards below say how."
}

/// Where the sign-in can be completed: inside the app (a browser sheet that hands the address back) or by pasting it.
pub fn sign_in_mode(platform_os: &str) -> &'static str {
    if platform_os == "ios" || platform_os == "android" {
        "auth-session"
    } else {
        "paste"
    }
}

/// Find the callback address (`com.lidlplus.app://callback?code=...`) in whatever was pasted: the
/// bare address, an address with spaces or quotes around it, or a line of text containing it.
pub fn extract_callback_url(input: &str, scheme: &str) -> Option<String> {
    let text = input.trim();
    let marker = format!("{scheme}://");
    let at = text.find(&marker)?;
    let rest = &text[at..];
    let end = rest.find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>'));
    let url = end.map_or(rest, |e| &rest[..e]);
    (url.len() > marker.len()).then(|| url.to_string())
}

/// Does the address carry a sign-in result (a code or an error)?
pub fn callback_has_result(url: &str) -> bool {
    ["code=", "error="].iter().any(|k| {
        ['?', '&', '#']
            .iter()
            .any(|p| url.contains(&format!("{p}{k}")))
    })
}

/// A source you sign in to is connected once it has a token: any state but "not connected",
/// "switched off" and "sign in again".
pub fn is_signed_in(state: &str) -> bool {
    ["connected", "ok", "waiting", "running", "error"].contains(&state)
}

/// The one-line state of the sign-in card of a shop (`Lidl`, `Kaufland`).
pub fn sign_in_state_text(
    shop: &str,
    state: &str,
    connected_at: Option<f64>,
    now_sec: f64,
) -> String {
    match state {
        s if is_signed_in(s) => match connected_at.filter(|t| *t != 0.0) {
            Some(t) => format!(
                "Connected {}",
                last_sync_text(Some(t), now_sec).to_lowercase()
            ),
            None => "Connected".into(),
        },
        "needs_signin" => format!("{shop} no longer accepts the saved sign-in"),
        "never" | "not_connected" => "Not connected".into(),
        _ => "Switched off".into(),
    }
}

/// The one-line state of the Lidl card.
pub fn lidl_state_text(state: &str, connected_at: Option<f64>, now_sec: f64) -> String {
    sign_in_state_text("Lidl", state, connected_at, now_sec)
}

/// The sources that run on a schedule or that you sign in to: the ones with a card of their own in
/// the list. A source the app pushes (`flow` `push`) has its own screen.
pub fn listed_sources(list: &[serde_json::Value]) -> Vec<serde_json::Value> {
    list.iter()
        .filter(|s| s.get("flow").and_then(serde_json::Value::as_str) != Some("push"))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_are_said_in_words() {
        assert_eq!(last_sync_text(None, 1000.0), "Never");
        assert_eq!(last_sync_text(Some(990.0), 1000.0), "Just now");
        assert_eq!(last_sync_text(Some(1000.0 - 720.0), 1000.0), "12 min ago");
        assert_eq!(last_sync_text(Some(0.0), 86_400.0), "Yesterday");
        assert_eq!(
            next_run_text(Some(1010.0), 1000.0).as_deref(),
            Some("Next run due now")
        );
        assert_eq!(
            next_run_text(Some(1000.0 + 1500.0), 1000.0).as_deref(),
            Some("Next run in 25 min")
        );
        assert_eq!(next_run_text(None, 0.0), None);
    }

    #[test]
    fn the_callback_address_is_found_in_pasted_text() {
        let s = "com.lidlplus.app";
        assert_eq!(
            extract_callback_url("  \"com.lidlplus.app://callback?code=abc\" ", s).as_deref(),
            Some("com.lidlplus.app://callback?code=abc")
        );
        assert_eq!(
            extract_callback_url("see com.lidlplus.app://callback?code=1&x=2 ok", s).as_deref(),
            Some("com.lidlplus.app://callback?code=1&x=2")
        );
        assert_eq!(extract_callback_url("com.lidlplus.app://", s), None);
        assert_eq!(extract_callback_url("nothing", s), None);
        assert!(callback_has_result("a://b?code=1"));
        assert!(callback_has_result("a://b#error=x"));
        assert!(!callback_has_result("a://b?state=1"));
    }

    #[test]
    fn summaries() {
        let list: Vec<SourceLike> = serde_json::from_str(r#"[{"enabled":true,"state":"error","imported_total":3},{"enabled":false,"state":"disabled","imported_total":0}]"#).unwrap();
        assert_eq!(attention_count(&list), 1);
        assert_eq!(
            summary_text(&list),
            "1 of 2 sources on, 3 receipts imported"
        );
        assert_eq!(
            sync_result_text(2, 1),
            "2 new receipts; 1 matched to a bank payment."
        );
        assert!(!can_sync_now(true, "running"));
    }

    #[test]
    fn every_sign_in_shop_is_named_in_its_own_sentences() {
        assert_eq!(source_title("kaufland_card"), "Kaufland Card");
        assert_eq!(source_title("rewe_app"), "REWE eBon (app)");
        assert_eq!(source_icon("kaufland_card"), "card-account-details-outline");
        assert!(sign_in_promises("Kaufland")[0].starts_with("You sign in on Kaufland's own page"));
        assert!(sign_in_promises("Kaufland")[1].contains("in the backend's database"));
        assert!(sign_in_promises("Lidl")[2].contains("Lidl has no public interface"));
        assert_eq!(
            sign_in_state_text("Kaufland", "needs_signin", None, 0.0),
            "Kaufland no longer accepts the saved sign-in"
        );
        assert_eq!(
            sign_in_state_text("Kaufland", "ok", Some(990.0), 1000.0),
            "Connected just now"
        );
        assert_eq!(
            sign_in_state_text("Lidl", "not_connected", None, 0.0),
            "Not connected"
        );
        assert_eq!(
            sign_in_state_text("Lidl", "disabled", None, 0.0),
            "Switched off"
        );
        assert!(
            is_signed_in("running") && !is_signed_in("needs_signin") && !is_signed_in("disabled")
        );
        assert!(!setup_steps("kaufland_card").is_empty());
    }

    #[test]
    fn pushed_sources_have_no_card_in_the_list() {
        let list: Vec<serde_json::Value> = serde_json::from_str(
            r#"[{"source":"email","flow":"server"},{"source":"lidl_plus","flow":"sign_in"},{"source":"rewe_app","flow":"push"}]"#,
        )
        .unwrap();
        let shown: Vec<_> = listed_sources(&list)
            .iter()
            .map(|s| s["source"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(shown, ["email", "lidl_plus"]);
    }
}
