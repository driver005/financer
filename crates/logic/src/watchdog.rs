//! The Subscriptions and Alerts screens: week grouping of the charge calendar, badges for price
//! hikes and duplicates, and the wording of alerts. The server sends keys and numbers (`kind`,
//! `cadence`, cents); the words are chosen here. Items travel as the server's own JSON, so every
//! field the screen reads survives.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;
use time::Duration;

use crate::format::{date_of, format_cents, format_date};
use crate::period::iso;

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn n(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn b(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// Names compare the way a person sorts them: ignoring case first.
fn by_name(a: &str, b: &str) -> Ordering {
    a.to_lowercase()
        .cmp(&b.to_lowercase())
        .then_with(|| a.cmp(b))
}

/// The Monday of the week that contains `iso_date` (weeks run Monday to Sunday).
pub fn week_start(iso_date: &str) -> Result<String, String> {
    let d = date_of(iso_date)?;
    Ok(iso(d - Duration::days(i64::from(
        d.weekday().number_days_from_monday(),
    ))))
}

/// `2026-10-05` -> `05.10.`
pub fn short_date(iso_date: &str) -> String {
    let mut p = iso_date.split('-');
    let (_, m, d) = (p.next(), p.next().unwrap_or(""), p.next().unwrap_or(""));
    format!("{d}.{m}.")
}

fn plus(iso_date: &str, days: i64) -> Result<String, String> {
    Ok(iso(date_of(iso_date)? + Duration::days(days)))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekGroup {
    /// Monday of the week, or `"overdue"` for charges whose date has passed.
    pub key: String,
    pub label: String,
    pub items: Vec<Value>,
    pub total_cents: i64,
}

/// Calendar entries grouped by week ("Overdue", "This week", "Next week", "05.10. - 11.10.").
pub fn group_by_week(upcoming: &[Value], as_of: &str) -> Result<Vec<WeekGroup>, String> {
    let this_week = week_start(as_of)?;
    let next_week = plus(&this_week, 7)?;
    let mut sorted: Vec<&Value> = upcoming.iter().collect();
    sorted.sort_by(|x, y| {
        s(x, "date")
            .cmp(s(y, "date"))
            .then_with(|| by_name(s(x, "counterparty"), s(y, "counterparty")))
    });
    let mut groups: BTreeMap<String, WeekGroup> = BTreeMap::new();
    for item in sorted {
        let key = if b(item, "overdue") {
            "overdue".to_string()
        } else {
            week_start(s(item, "date"))?
        };
        if !groups.contains_key(&key) {
            let end = plus(if key == "overdue" { as_of } else { &key }, 6)?;
            let label = if key == "overdue" {
                "Overdue".to_string()
            } else if key == this_week {
                "This week".into()
            } else if key == next_week {
                "Next week".into()
            } else {
                format!("{} - {}", short_date(&key), short_date(&end))
            };
            groups.insert(
                key.clone(),
                WeekGroup {
                    key: key.clone(),
                    label,
                    items: vec![],
                    total_cents: 0,
                },
            );
        }
        let g = groups.get_mut(&key).expect("just inserted");
        g.items.push(item.clone());
        g.total_cents += n(item, "amount_cents");
    }
    // overdue first, then weeks in date order
    let mut out: Vec<WeekGroup> = groups.into_values().collect();
    out.sort_by(|x, y| match (x.key.as_str(), y.key.as_str()) {
        ("overdue", "overdue") => Ordering::Equal,
        ("overdue", _) => Ordering::Less,
        (_, "overdue") => Ordering::Greater,
        (a, b) => a.cmp(b),
    });
    Ok(out)
}

pub fn cadence_label(cadence: &str) -> String {
    match cadence {
        "weekly" | "monthly" | "quarterly" | "yearly" => cadence.into(),
        other => other.into(),
    }
}

/// `2002` basis points -> `+20,0 %`
pub fn percent_text(bp: i64) -> String {
    let tenths = (bp.abs() as f64 / 10.0 + 0.5).floor() as i64; // as JavaScript rounds: halves go up
    format!(
        "{}{},{} %",
        if bp < 0 { "-" } else { "+" },
        tenths / 10,
        tenths % 10
    )
}

fn period_word(cadence: &str) -> &'static str {
    match cadence {
        "weekly" => "week",
        "monthly" => "month",
        "quarterly" => "quarter",
        "yearly" => "year",
        _ => "charge",
    }
}

pub fn hike_text(h: &Value) -> String {
    format!(
        "{} went from {} to {} ({}, +{} per {}) since {}.",
        s(h, "counterparty"),
        format_cents(n(h, "old_amount_cents")),
        format_cents(n(h, "new_amount_cents")),
        percent_text(n(h, "percent_bp")),
        format_cents(n(h, "delta_cents")),
        period_word(s(h, "cadence")),
        format_date(s(h, "since"))
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RowBadge {
    pub id: &'static str,
    pub text: String,
    pub tone: &'static str,
}

/// Badges shown on a calendar row, looked up by merchant name in the report.
pub fn badges_for(item: &Value, price_hikes: &[Value], duplicates: &[Value]) -> Vec<RowBadge> {
    let who = s(item, "counterparty");
    let mut out = Vec::new();
    if let Some(h) = price_hikes.iter().find(|h| s(h, "counterparty") == who) {
        out.push(RowBadge {
            id: "hike",
            text: format!("Price up {}", percent_text(n(h, "percent_bp"))),
            tone: "bad",
        });
    }
    let pair = |d: &Value, side: &str| {
        d.get(side)
            .map(|x| s(x, "counterparty").to_string())
            .unwrap_or_default()
    };
    if duplicates
        .iter()
        .any(|d| pair(d, "first") == who || pair(d, "second") == who)
    {
        out.push(RowBadge {
            id: "duplicate",
            text: "Possible duplicate".into(),
            tone: "warn",
        });
    }
    if b(item, "overdue") {
        out.push(RowBadge {
            id: "late",
            text: "Not booked yet".into(),
            tone: "warn",
        });
    }
    let confidence = n(item, "confidence");
    if confidence < 50 {
        out.push(RowBadge {
            id: "unsure",
            text: format!("{confidence} % sure"),
            tone: "muted",
        });
    }
    out
}

pub fn duplicate_text(d: &Value) -> String {
    let (a, bb) = (
        d.get("first").cloned().unwrap_or(Value::Null),
        d.get("second").cloned().unwrap_or(Value::Null),
    );
    let who = if s(d, "reason") == "same_merchant" {
        format!("{} is billed twice", s(&a, "counterparty"))
    } else {
        format!(
            "{} and {} look like the same service",
            s(&a, "counterparty"),
            s(&bb, "counterparty")
        )
    };
    format!(
        "{who}, both {} at {} and {}. Cancel one if you only need it once.",
        cadence_label(s(&a, "cadence")),
        format_cents(n(&a, "amount_cents")),
        format_cents(n(&bb, "amount_cents"))
    )
}

pub fn stale_text(st: &Value) -> String {
    let sub = st.get("subscription").cloned().unwrap_or(Value::Null);
    format!(
        "Last {} on {}; {} {} charges did not come since. Cancelled or paused? If you did not cancel it, check your contract.",
        format_cents(n(&sub, "amount_cents")),
        format_date(s(&sub, "last_date")),
        n(st, "periods_missed"),
        cadence_label(s(&sub, "cadence"))
    )
}

pub fn alert_kind_label(kind: &str) -> String {
    match kind {
        "duplicate_charge" => "Possible duplicate charge",
        "unusual_amount" => "Unusual amount",
        "new_merchant" => "New merchant",
        "large_for_category" => "Large for its category",
        other => other,
    }
    .into()
}

/// Higher first.
pub fn severity_rank(severity: &str) -> i64 {
    match severity {
        "high" => 3,
        "medium" => 2,
        "low" => 1,
        _ => 0,
    }
}

/// Explanation of an alert in the app's wording; unknown kinds fall back to the server's English `reason`.
pub fn alert_text(a: &Value) -> String {
    let amount = format_cents(n(a, "amount_cents"));
    let reference = a
        .get("reference_cents")
        .and_then(Value::as_i64)
        .map(format_cents);
    let who = s(a, "counterparty");
    let reason = || s(a, "reason").to_string();
    match s(a, "kind") {
        "duplicate_charge" => format!("{who} charged {amount} again within a few days of an identical charge. If it was one purchase, ask them for a refund."),
        "unusual_amount" => reference.map_or_else(reason, |r| format!("{amount} is far above the usual {r} at {who} (based on {} earlier charges).", n(a, "history_count"))),
        "new_merchant" => format!("First payment to {who}, and it is {amount}. Fine if you know it; otherwise check the charge."),
        "large_for_category" => reference.map_or_else(reason, |r| format!("{amount} at {who} is large for this category, where the usual is about {r}.")),
        _ => reason(),
    }
}

/// Alerts in the order they should be read: high severity first, then newest.
pub fn sort_alerts(alerts: &[Value]) -> Vec<Value> {
    let mut out = alerts.to_vec();
    out.sort_by(|x, y| {
        b(x, "dismissed")
            .cmp(&b(y, "dismissed"))
            .then_with(|| severity_rank(s(y, "severity")).cmp(&severity_rank(s(x, "severity"))))
            .then_with(|| s(y, "booking_date").cmp(s(x, "booking_date")))
            .then_with(|| n(y, "transaction_id").cmp(&n(x, "transaction_id")))
    });
    out
}

/// One line for the Today card: the next charge within `within_days` of `as_of`.
pub fn next_charge_text(
    upcoming: &[Value],
    as_of: &str,
    within_days: i64,
) -> Result<Option<String>, String> {
    let limit = plus(as_of, within_days)?;
    let mut sorted: Vec<&Value> = upcoming.iter().collect();
    sorted.sort_by(|x, y| s(x, "date").cmp(s(y, "date")));
    Ok(sorted
        .into_iter()
        .find(|u| s(u, "date") <= limit.as_str())
        .map(|u| {
            format!(
                "Next: {} {} on {}",
                s(u, "counterparty"),
                format_cents(n(u, "amount_cents")),
                short_date(s(u, "date"))
            )
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn charge(date: &str, who: &str, cents: i64, overdue: bool) -> Value {
        json!({ "date": date, "counterparty": who, "amount_cents": cents, "overdue": overdue, "confidence": 90, "extra": "kept" })
    }

    #[test]
    fn the_calendar_is_grouped_by_week_with_overdue_first() {
        let items = [
            charge("2026-10-15", "Spotify", 1199, false),
            charge("2026-10-09", "Netflix", 1299, false),
            charge("2026-10-02", "Gym", 3000, true),
            charge("2026-10-12", "Cloud", 200, false),
        ];
        let groups = group_by_week(&items, "2026-10-07").unwrap();
        assert_eq!(
            groups.iter().map(|g| g.label.as_str()).collect::<Vec<_>>(),
            ["Overdue", "This week", "Next week"]
        );
        assert_eq!(groups[0].key, "overdue");
        assert_eq!(groups[1].items[0]["counterparty"], "Netflix");
        assert_eq!(groups[1].total_cents, 1299);
        assert_eq!(
            groups[2].items.len(),
            2,
            "the 12th and the 15th are both next week"
        );
        assert_eq!(groups[2].items[0]["counterparty"], "Cloud");
        assert_eq!(
            groups[2].items[0]["extra"], "kept",
            "every field of the server's item survives"
        );
    }

    #[test]
    fn weeks_start_on_monday_and_dates_are_shortened() {
        assert_eq!(week_start("2026-10-11").unwrap(), "2026-10-05");
        assert_eq!(short_date("2026-10-05"), "05.10.");
    }

    #[test]
    fn percentages_and_hikes_are_worded() {
        assert_eq!(percent_text(2002), "+20,0 %");
        assert_eq!(percent_text(-505), "-5,1 %");
        let hike = json!({ "counterparty": "Netflix", "old_amount_cents": 1000, "new_amount_cents": 1200, "percent_bp": 2000, "delta_cents": 200, "cadence": "monthly", "since": "2026-08-01" });
        assert_eq!(
            hike_text(&hike),
            "Netflix went from 10,00 € to 12,00 € (+20,0 %, +2,00 € per month) since 01.08.2026."
        );
    }

    #[test]
    fn rows_carry_badges_for_hikes_duplicates_lateness_and_doubt() {
        let hike = json!({ "counterparty": "Netflix", "percent_bp": 2000 });
        let dup = json!({ "first": { "counterparty": "Netflix" }, "second": { "counterparty": "Prime" } });
        let item = json!({ "counterparty": "Netflix", "overdue": true, "confidence": 40 });
        let badges = badges_for(&item, &[hike], &[dup]);
        assert_eq!(
            badges.iter().map(|b| b.id).collect::<Vec<_>>(),
            ["hike", "duplicate", "late", "unsure"]
        );
        assert_eq!(badges[0].text, "Price up +20,0 %");
        assert_eq!(badges[3].text, "40 % sure");
        assert!(badges_for(&json!({ "counterparty": "X", "confidence": 90 }), &[], &[]).is_empty());
    }

    #[test]
    fn duplicates_and_stale_subscriptions_are_explained() {
        let same = json!({ "reason": "same_merchant", "first": { "counterparty": "Netflix", "cadence": "monthly", "amount_cents": 1000 }, "second": { "counterparty": "Netflix", "cadence": "monthly", "amount_cents": 1200 } });
        assert_eq!(duplicate_text(&same), "Netflix is billed twice, both monthly at 10,00 € and 12,00 €. Cancel one if you only need it once.");
        let similar = json!({ "reason": "similar", "first": { "counterparty": "A", "cadence": "yearly", "amount_cents": 100 }, "second": { "counterparty": "B", "cadence": "yearly", "amount_cents": 100 } });
        assert!(duplicate_text(&similar).starts_with("A and B look like the same service"));
        let stale = json!({ "periods_missed": 2, "subscription": { "amount_cents": 999, "last_date": "2026-07-01", "cadence": "monthly" } });
        assert!(stale_text(&stale)
            .starts_with("Last 9,99 € on 01.07.2026; 2 monthly charges did not come since."));
    }

    #[test]
    fn alerts_are_worded_by_kind_and_ordered_for_reading() {
        let a = |kind: &str, reference: Option<i64>| json!({ "kind": kind, "counterparty": "Kiosk", "amount_cents": 5000, "reference_cents": reference, "history_count": 4, "reason": "server words" });
        assert!(alert_text(&a("duplicate_charge", None)).starts_with("Kiosk charged 50,00 € again"));
        assert_eq!(
            alert_text(&a("unusual_amount", Some(1000))),
            "50,00 € is far above the usual 10,00 € at Kiosk (based on 4 earlier charges)."
        );
        assert_eq!(alert_text(&a("unusual_amount", None)), "server words");
        assert!(alert_text(&a("new_merchant", None)).starts_with("First payment to Kiosk"));
        assert!(alert_text(&a("large_for_category", Some(2000))).contains("about 20,00 €"));
        assert_eq!(alert_text(&a("future_kind", None)), "server words");
        assert_eq!(alert_kind_label("new_merchant"), "New merchant");
        assert_eq!(alert_kind_label("other"), "other");

        let mk = |id: i64, sev: &str, day: &str, dismissed: bool| json!({ "transaction_id": id, "severity": sev, "booking_date": day, "dismissed": dismissed });
        let sorted = sort_alerts(&[
            mk(1, "low", "2026-10-09", false),
            mk(2, "high", "2026-10-01", false),
            mk(3, "high", "2026-10-05", false),
            mk(4, "high", "2026-10-09", true),
        ]);
        assert_eq!(
            sorted
                .iter()
                .map(|v| v["transaction_id"].as_i64().unwrap())
                .collect::<Vec<_>>(),
            [3, 2, 1, 4]
        );
    }

    #[test]
    fn the_next_charge_is_named_inside_the_window() {
        let items = [
            charge("2026-10-15", "Spotify", 1199, false),
            charge("2026-10-09", "Netflix", 1299, false),
        ];
        assert_eq!(
            next_charge_text(&items, "2026-10-07", 14)
                .unwrap()
                .as_deref(),
            Some("Next: Netflix 12,99 € on 09.10.")
        );
        assert_eq!(next_charge_text(&items, "2026-10-07", 1).unwrap(), None);
        assert_eq!(next_charge_text(&[], "2026-10-07", 14).unwrap(), None);
    }
}
