//! Barcode scan logic without any screen or camera: validating what the camera or the keyboard
//! produced and turning the server's answer into rows. (Ignoring repeated camera reads is a small
//! stateful gate that stays beside the camera; it asks `check_ean` here.)

use serde::Serialize;
use serde_json::Value;

use crate::format::{format_cents, format_date};
use crate::mealplan::chain_name;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum EanCheck {
    Ok {
        ok: bool,
        code: String,
        kind: &'static str,
    },
    Bad {
        ok: bool,
        reason: String,
    },
}

/// Same rule as the server: weights 3,1,3,1... from the digit left of the check digit.
fn checksum_ok(digits: &str) -> bool {
    let sum: u32 = digits
        .bytes()
        .rev()
        .enumerate()
        .map(|(i, b)| u32::from(b - b'0') * if i % 2 == 1 { 3 } else { 1 })
        .sum();
    sum.is_multiple_of(10)
}

/// Check what was scanned or typed. Spaces and hyphens are ignored.
pub fn check_ean(input: &str) -> EanCheck {
    let code: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    let bad = |reason: String| EanCheck::Bad { ok: false, reason };
    if code.is_empty() {
        return bad("Enter the digits under the barcode.".into());
    }
    if !code.bytes().all(|b| b.is_ascii_digit()) {
        return bad("A barcode has digits only.".into());
    }
    let kind = match code.len() {
        8 => "ean8",
        12 => "upc_a",
        13 => "ean13",
        n => {
            return bad(format!(
                "A barcode has 8, 12 or 13 digits, this one has {n}."
            ))
        }
    };
    if !checksum_ok(&code) {
        return bad("The last digit does not fit. Check the number and try again.".into());
    }
    EanCheck::Ok {
        ok: true,
        code,
        kind,
    }
}

/// `258` -> `2,58 €/kg`
pub fn format_unit_price(cents: i64, unit: &str) -> String {
    format!("{}/{unit}", format_cents(cents))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainRow {
    pub key: String,
    pub chain: String,
    pub name: String,
    /// The price as the main figure: the unit price when there is one, else the shelf price.
    pub main: String,
    /// Smaller line: the pack price, the pack, where the price comes from.
    pub detail: String,
    pub is_cheapest: bool,
    pub is_tied: bool,
    pub is_offer: bool,
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str).filter(|x| !x.is_empty())
}

fn n(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(Value::as_i64)
}

fn scope_detail(p: &Value) -> String {
    let price = format_cents(n(p, "price_cents").unwrap_or(0));
    let mut parts = Vec::new();
    if s(p, "scope") == Some("product") {
        parts.push(format!(
            "{price}{}",
            s(p, "pack").map_or(String::new(), |k| format!(" for {k}"))
        ));
        if let Some(d) = s(p, "observed_on") {
            parts.push(format!("seen {}", format_date(d)));
        }
    } else {
        parts.push(format!(
            "{price}{}, typical price",
            s(p, "pack").map_or(String::new(), |k| format!(" per {k}"))
        ));
        if let Some(d) = s(p, "valid_until") {
            parts.push(format!("until {}", format_date(d)));
        }
    }
    parts.join(" · ")
}

fn tied(r: &Value) -> Vec<&str> {
    r.get("tied_cheapest")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

fn chains(r: &Value) -> Vec<&Value> {
    r.get("chains")
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default()
}

/// Rows for the result card, in the order the server ranked them (cheapest first).
pub fn chain_rows(r: &Value) -> Vec<ChainRow> {
    let tied = tied(r);
    let cheapest = s(r, "cheapest");
    chains(r)
        .into_iter()
        .enumerate()
        .map(|(i, p)| {
            let chain = s(p, "chain").unwrap_or("").to_string();
            let main = match (n(p, "unit_price_cents"), s(p, "unit")) {
                (Some(u), Some(unit)) => format_unit_price(u, unit),
                _ => format_cents(n(p, "price_cents").unwrap_or(0)),
            };
            ChainRow {
                key: format!("{chain}-{}-{i}", s(p, "scope").unwrap_or("")),
                name: chain_name(&chain),
                main,
                detail: scope_detail(p),
                is_cheapest: cheapest == Some(chain.as_str()),
                is_tied: tied.contains(&chain.as_str()),
                is_offer: p.get("is_offer").and_then(Value::as_bool).unwrap_or(false),
                chain,
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Headline {
    pub kind: &'static str,
    pub text: String,
}

/// "0,10 €/l less than Lidl", on the unit price when there is one, else on the price shown.
fn saving_text(r: &Value, cheap: &str, other: &str) -> Option<String> {
    let find = |c: &str| chains(r).into_iter().find(|p| s(p, "chain") == Some(c));
    let (a, b) = (find(cheap)?, find(other)?);
    let use_unit = matches!((n(a, "unit_price_cents"), n(b, "unit_price_cents"), s(a, "unit"), s(b, "unit")), (Some(_), Some(_), Some(x), Some(y)) if x == y);
    let diff = if use_unit {
        n(b, "unit_price_cents")? - n(a, "unit_price_cents")?
    } else {
        n(b, "price_cents")? - n(a, "price_cents")?
    };
    (diff > 0).then(|| {
        format!(
            "{} less than {}",
            if use_unit {
                format_unit_price(diff, s(a, "unit").unwrap_or(""))
            } else {
                format_cents(diff)
            },
            chain_name(other)
        )
    })
}

/// One sentence for the top of the result card.
pub fn headline(r: &Value) -> Headline {
    let rows = chain_rows(r);
    let h = |kind, text: String| Headline { kind, text };
    if rows.is_empty() {
        return h(
            "none",
            "No price known at Lidl, Aldi, Kaufland or Rewe.".into(),
        );
    }
    let has_cheapest = s(r, "cheapest").is_some();
    if has_cheapest && rows.len() == 1 {
        return h(
            "only",
            format!("Only {} has a known price: {}.", rows[0].name, rows[0].main),
        );
    }
    if has_cheapest {
        let first = rows.iter().find(|x| x.is_cheapest).unwrap_or(&rows[0]);
        let gap = rows
            .iter()
            .find(|x| !x.is_cheapest)
            .and_then(|next| saving_text(r, &first.chain, &next.chain));
        return h(
            "cheapest",
            format!(
                "{} is cheapest at {}{}.",
                first.name,
                first.main,
                gap.map_or(String::new(), |g| format!(", {g}"))
            ),
        );
    }
    let tied = tied(r);
    if tied.len() > 1 {
        let mut names: Vec<String> = tied.iter().map(|c| chain_name(c)).collect();
        let last = names.pop().unwrap_or_default();
        return h(
            "tie",
            format!("{} and {last} cost the same.", names.join(", ")),
        );
    }
    h(
        "incomparable",
        "These prices are not for the same pack, so there is no cheapest chain.".into(),
    )
}

/// Title line of the product, `Vollmilch 3,5% · 1 l`.
pub fn product_title(r: &Value) -> String {
    let name = s(r, "product_name")
        .or_else(|| s(r, "item_name"))
        .unwrap_or("Unknown product");
    match s(r, "pack") {
        Some(p) => format!("{name} · {p}"),
        None => name.into(),
    }
}

/// `Rewe · 1,29 € · 03.10.2026` for the list of recent Open Prices observations.
pub fn observation_line(o: &Value) -> String {
    let store = match s(o, "chain") {
        Some(c) => chain_name(c),
        None => s(o, "store").unwrap_or("Unknown store").to_string(),
    };
    let unit = match (n(o, "unit_price_cents"), s(o, "unit")) {
        (Some(u), Some(unit)) => format!(" ({})", format_unit_price(u, unit)),
        _ => String::new(),
    };
    format!(
        "{store} · {}{unit} · {}",
        format_cents(n(o, "price_cents").unwrap_or(0)),
        format_date(s(o, "date").unwrap_or(""))
    )
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UsualPlan {
    /// What to save as the usual items.
    pub items: Vec<Value>,
    pub status: &'static str,
    /// Something the person should know, if any.
    pub note: Option<String>,
}

/// Add a catalog item to the usual items without touching the rest. The comparison only uses the
/// saved list in manual mode, and a generic starter basket is not something the person chose, so it
/// is replaced instead of extended.
pub fn plan_add_to_usual(basket: &Value, item: &str) -> UsualPlan {
    let source = s(basket, "source").unwrap_or("");
    let items: Vec<Value> = basket
        .get("items")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|i| serde_json::json!({ "item": i.get("item").cloned().unwrap_or(Value::Null), "quantity": i.get("quantity").cloned().unwrap_or(Value::Null) })).collect())
        .unwrap_or_default();
    if items.iter().any(|i| i["item"] == item) && source != "starter" {
        return UsualPlan {
            items,
            status: "already",
            note: None,
        };
    }
    let mut kept = if source == "starter" { vec![] } else { items };
    kept.push(serde_json::json!({ "item": item, "quantity": 1 }));
    let note = match source {
        "receipts" => Some("Your list is learned from receipts right now. Set the habit mode to manual in Settings to use this list.".to_string()),
        "spending" => Some("Your list comes from your spending right now. Set the habit mode to manual in Settings to use this list.".to_string()),
        _ => None,
    };
    UsualPlan {
        items: kept,
        status: "added",
        note,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_barcode_is_checked_like_the_server_does() {
        assert_eq!(
            check_ean("4006381333931"),
            EanCheck::Ok {
                ok: true,
                code: "4006381333931".into(),
                kind: "ean13"
            }
        );
        assert_eq!(
            check_ean("4006 3813-33931"),
            EanCheck::Ok {
                ok: true,
                code: "4006381333931".into(),
                kind: "ean13"
            }
        );
        assert!(matches!(
            check_ean("96385074"),
            EanCheck::Ok { kind: "ean8", .. }
        ));
        assert!(matches!(
            check_ean("036000291452"),
            EanCheck::Ok { kind: "upc_a", .. }
        ));
        let reason = |s: &str| match check_ean(s) {
            EanCheck::Bad { reason, .. } => reason,
            other => panic!("{other:?}"),
        };
        assert_eq!(reason(""), "Enter the digits under the barcode.");
        assert_eq!(reason("12ab"), "A barcode has digits only.");
        assert_eq!(
            reason("12345"),
            "A barcode has 8, 12 or 13 digits, this one has 5."
        );
        assert_eq!(
            reason("4006381333932"),
            "The last digit does not fit. Check the number and try again."
        );
    }

    fn lookup() -> Value {
        json!({
            "cheapest": "lidl", "tied_cheapest": ["lidl"], "product_name": "Vollmilch", "pack": "1 l",
            "chains": [
                { "chain": "lidl", "scope": "product", "price_cents": 109, "pack": "1 l", "observed_on": "2026-10-03", "unit_price_cents": 109, "unit": "l", "is_offer": true },
                { "chain": "aldi", "scope": "typical", "price_cents": 119, "pack": "1 l", "valid_until": "2026-12-31", "unit_price_cents": 119, "unit": "l", "is_offer": false }
            ]
        })
    }

    #[test]
    fn the_result_card_has_rows_and_a_headline() {
        let rows = chain_rows(&lookup());
        assert_eq!(
            (
                rows[0].name.as_str(),
                rows[0].main.as_str(),
                rows[0].is_cheapest,
                rows[0].is_offer
            ),
            ("Lidl", "1,09 €/l", true, true)
        );
        assert_eq!(rows[0].detail, "1,09 € for 1 l · seen 03.10.2026");
        assert_eq!(
            rows[1].detail,
            "1,19 € per 1 l, typical price · until 31.12.2026"
        );
        assert_eq!(rows[1].key, "aldi-typical-1");
        assert_eq!(
            headline(&lookup()),
            Headline {
                kind: "cheapest",
                text: "Lidl is cheapest at 1,09 €/l, 0,10 €/l less than Aldi.".into()
            }
        );
        assert_eq!(headline(&json!({ "chains": [] })).kind, "none");
        let only = json!({ "cheapest": "rewe", "chains": [{ "chain": "rewe", "scope": "product", "price_cents": 99, "is_offer": false }] });
        assert_eq!(headline(&only).text, "Only Rewe has a known price: 0,99 €.");
        let tie = json!({ "cheapest": null, "tied_cheapest": ["lidl", "aldi", "rewe"], "chains": [{ "chain": "lidl", "scope": "product", "price_cents": 1 }] });
        assert_eq!(
            headline(&tie),
            Headline {
                kind: "tie",
                text: "Lidl, Aldi and Rewe cost the same.".into()
            }
        );
        let mixed = json!({ "cheapest": null, "tied_cheapest": [], "chains": [{ "chain": "lidl", "scope": "product", "price_cents": 1 }] });
        assert_eq!(headline(&mixed).kind, "incomparable");
    }

    #[test]
    fn titles_and_observations_are_worded() {
        assert_eq!(product_title(&lookup()), "Vollmilch · 1 l");
        assert_eq!(product_title(&json!({ "item_name": "Milch" })), "Milch");
        assert_eq!(product_title(&json!({})), "Unknown product");
        assert_eq!(
            observation_line(
                &json!({ "chain": "rewe", "price_cents": 129, "date": "2026-10-03", "unit_price_cents": 129, "unit": "l" })
            ),
            "Rewe · 1,29 € (1,29 €/l) · 03.10.2026"
        );
        assert_eq!(
            observation_line(
                &json!({ "store": "Corner", "price_cents": 50, "date": "2026-10-03" })
            ),
            "Corner · 0,50 € · 03.10.2026"
        );
    }

    #[test]
    fn adding_to_the_usual_items_keeps_the_rest_or_replaces_a_starter() {
        let basket = |source: &str| json!({ "source": source, "items": [{ "item": "milk", "quantity": 2, "extra": 1 }] });
        let added = plan_add_to_usual(&basket("manual"), "flour");
        assert_eq!(
            (added.status, added.items.len(), added.note),
            ("added", 2, None)
        );
        assert_eq!(
            plan_add_to_usual(&basket("manual"), "milk").status,
            "already"
        );
        assert_eq!(
            plan_add_to_usual(&basket("starter"), "milk").items,
            vec![json!({ "item": "milk", "quantity": 1 })]
        );
        assert!(plan_add_to_usual(&basket("receipts"), "flour")
            .note
            .unwrap()
            .contains("learned from receipts"));
        assert!(plan_add_to_usual(&basket("spending"), "flour")
            .note
            .unwrap()
            .contains("from your spending"));
    }
}
