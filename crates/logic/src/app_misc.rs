//! Small rules of the finance app: the Spending list's filter, the demo bookings of the setup, the
//! colour a calendar names, the stamp written in the device's time zone, and the next whole hour.

use jiff::Timestamp;
use serde_json::{json, Value};

use crate::calendar::time_of;
use crate::onboarding::{chain_name, CHAINS};

// ---- the Spending list ----

fn cents(t: &Value) -> f64 {
    t.get("amount_cents").and_then(Value::as_f64).unwrap_or(0.0)
}

/// The bookings that match `filter` (`all`, `spending`, `income`); the input order is kept.
pub fn filter_tx(items: &[Value], filter: &str) -> Vec<Value> {
    items
        .iter()
        .filter(|t| match filter {
            "spending" => cents(t) < 0.0,
            "income" => cents(t) > 0.0,
            _ => true,
        })
        .cloned()
        .collect()
}

/// Net amount of a day's bookings: income minus spending.
pub fn day_total(items: &[Value]) -> i64 {
    items.iter().map(|t| cents(t) as i64).sum()
}

/// `No spending to show.` style sentence for an empty filtered list.
pub fn empty_filter_text(filter: &str) -> &'static str {
    match filter {
        "spending" => "No spending to show.",
        "income" => "No income to show.",
        _ => "Nothing to show.",
    }
}

// ---- the demo bookings ----

pub const DEMO_TAG: &str = "[DEMO]";
const DEMO_PURPOSE: &str = "DEMO DATA, not a real booking";
// Cents of one grocery trip, cycled through; an uneven spread so the numbers look lived in.
const TRIPS: [i64; 10] = [2347, 1189, 3560, 842, 2915, 1476, 4120, 1733, 2208, 967];
const TRIP_DAYS: [i64; 8] = [2, 5, 9, 12, 16, 19, 23, 26];
const DEMO_SALARY_CENTS: i64 = 245_000;

fn days_in(year: i32, month: u8) -> u8 {
    time::Month::try_from(month).map_or(31, |m| m.length(year))
}

/// About four months of bookings ending today: a salary on `payday` (so income is recognised as
/// recurring), rent, a streaming subscription, a transit pass and grocery trips at the user's
/// stores. Bookings after `today` are left out. The same arguments always give the same bookings.
pub fn demo_transactions(
    today: &str,
    payday: f64,
    chains: &[String],
) -> Result<Vec<Value>, String> {
    let (ty, tm, _) = crate::calendar::ymd(today)?;
    let wanted: Vec<&str> = CHAINS
        .iter()
        .copied()
        .filter(|c| chains.is_empty() || chains.iter().any(|x| x == c))
        .collect();
    let stores: Vec<&str> = wanted.iter().map(|c| chain_name(c)).collect();
    let mut rows: Vec<(String, String, Value)> = vec![];
    let mut trip = 0usize;
    for back in (0..=3).rev() {
        let index = i64::from(ty) * 12 + i64::from(tm) - 1 - back;
        let (year, month) = (
            index.div_euclid(12) as i32,
            (index.rem_euclid(12) + 1) as u8,
        );
        let mut add = |day: i64, amount: i64, who: &str, what: &str, category: &str| {
            let day = day.min(i64::from(days_in(year, month)));
            let date = format!("{year:04}-{month:02}-{day:02}");
            if date.as_str() <= today {
                let counterparty = format!("{DEMO_TAG} {who}");
                rows.push((
                    date.clone(),
                    counterparty.clone(),
                    json!({ "booking_date": date, "amount_cents": amount, "counterparty": counterparty, "purpose": format!("{DEMO_PURPOSE} ({what})"), "category": category }),
                ));
            }
        };
        add(
            (payday.trunc() as i64).clamp(1, 28),
            DEMO_SALARY_CENTS,
            "Employer",
            "salary",
            "income",
        );
        add(2, -72_000, "Landlord", "rent", "housing");
        add(8, -1_299, "Streaming", "subscription", "subscriptions");
        add(3, -4_900, "Transit pass", "monthly pass", "transport");
        for day in TRIP_DAYS {
            add(
                day,
                -TRIPS[trip % TRIPS.len()],
                stores[trip % stores.len()],
                "groceries",
                "groceries",
            );
            trip += 1;
        }
    }
    rows.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    Ok(rows.into_iter().map(|r| r.2).collect())
}

/// The import document: bookings only (no budget, no usual items, no receipts, no settings).
pub fn demo_export(today: &str, payday: f64, chains: &[String]) -> Result<Value, String> {
    Ok(
        json!({ "version": 1, "transactions": demo_transactions(today, payday, chains)?, "budget": [], "basket": [], "receipts": [], "settings": {} }),
    )
}

/// Whether a booking is part of the demo set.
pub fn is_demo_booking(t: &Value) -> bool {
    t.get("counterparty")
        .and_then(Value::as_str)
        .is_some_and(|c| c.starts_with(DEMO_TAG))
}

/// Demo bookings only go into an empty backend. Next to real bookings they would change every
/// number on the Today screen, and the API has no way to take them out again.
pub fn demo_gate(bookings: &[Value]) -> Value {
    if bookings.is_empty() {
        json!({ "allowed": true })
    } else if bookings.iter().all(is_demo_booking) {
        json!({ "allowed": false, "reason": "The demo data is already loaded." })
    } else {
        json!({ "allowed": false, "reason": format!("There are already {} bookings here. Demo data would mix with them, so it is only offered on an empty setup.", bookings.len()) })
    }
}

// ---- tones ----

const TONES: [&str; 6] = ["accent", "success", "warning", "danger", "info", "neutral"];

/// The server stores a tone as text; anything it does not know is neutral.
pub fn calendar_tone(value: &str) -> &'static str {
    TONES
        .iter()
        .copied()
        .find(|t| *t == value)
        .unwrap_or("neutral")
}

// ---- the device's clock and zone ----

/// `12.10.2026 14:03` in the given time zone.
pub fn format_stamp(unix_seconds: f64, zone: &str) -> Result<String, String> {
    let t = Timestamp::from_second(unix_seconds.floor() as i64).map_err(|e| e.to_string())?;
    let d = t
        .in_tz(zone)
        .map_err(|e| format!("{zone}: {e}"))?
        .datetime();
    Ok(format!(
        "{:02}.{:02}.{} {:02}:{:02}",
        d.day(),
        d.month(),
        d.year(),
        d.hour(),
        d.minute()
    ))
}

/// Default when a new event is made without a time (a tap on the add button): the next whole hour.
pub fn next_hour(hour: f64) -> String {
    time_of(f64::min(23.0 * 60.0, (hour + 1.0) * 60.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_spending_list_filters_and_sums() {
        let items = [
            json!({ "amount_cents": -500 }),
            json!({ "amount_cents": 900 }),
            json!({ "amount_cents": -100 }),
        ];
        assert_eq!(filter_tx(&items, "spending").len(), 2);
        assert_eq!(filter_tx(&items, "income").len(), 1);
        assert_eq!(filter_tx(&items, "all").len(), 3);
        assert_eq!(day_total(&items), 300);
        assert_eq!(empty_filter_text("income"), "No income to show.");
    }

    #[test]
    fn the_demo_is_labelled_deterministic_and_stops_at_today() {
        let a = demo_transactions("2026-11-15", 25.0, &[]).unwrap();
        assert_eq!(a, demo_transactions("2026-11-15", 25.0, &[]).unwrap());
        assert!(a
            .iter()
            .all(|t| is_demo_booking(t) && t["booking_date"].as_str().unwrap() <= "2026-11-15"));
        assert!(!a
            .iter()
            .any(|t| t["category"] == "income" && t["booking_date"] == "2026-11-25"));
        assert!(a
            .iter()
            .any(|t| t["category"] == "income" && t["booking_date"] == "2026-10-25"));
        let lidl = demo_transactions("2026-11-15", 1.0, &["lidl".to_string()]).unwrap();
        assert!(lidl
            .iter()
            .filter(|t| t["category"] == "groceries")
            .all(|t| t["counterparty"] == "[DEMO] Lidl"));
        assert_eq!(demo_gate(&[])["allowed"], true);
        assert_eq!(demo_gate(&a)["reason"], "The demo data is already loaded.");
        assert!(demo_gate(&[json!({ "counterparty": "REWE" })])["reason"]
            .as_str()
            .unwrap()
            .contains("1 bookings"));
        assert_eq!(demo_export("2026-11-15", 1.0, &[]).unwrap()["version"], 1);
    }

    #[test]
    fn the_stamp_is_written_in_the_zone() {
        assert_eq!(
            format_stamp(1_793_696_400.0, "Europe/Berlin").unwrap(),
            "03.11.2026 10:00"
        );
        assert_eq!(
            format_stamp(1_793_696_400.0, "UTC").unwrap(),
            "03.11.2026 09:00"
        );
        assert_eq!(next_hour(8.0), "09:00");
        assert_eq!(next_hour(23.0), "23:00");
        assert_eq!(calendar_tone("danger"), "danger");
        assert_eq!(calendar_tone("pink"), "neutral");
    }
}
