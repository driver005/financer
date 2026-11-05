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

/// The bookings that match what was typed in the search box: every word of `query` must appear
/// (any case) in the counterparty, the purpose or the category. A blank query keeps everything.
pub fn search_tx(items: &[Value], query: &str) -> Vec<Value> {
    let words = query_words(query);
    if words.is_empty() {
        return items.to_vec();
    }
    items
        .iter()
        .filter(|t| matches_words(t, &words))
        .cloned()
        .collect()
}

fn query_words(query: &str) -> Vec<String> {
    query.split_whitespace().map(str::to_lowercase).collect()
}

fn matches_words(t: &Value, words: &[String]) -> bool {
    let text = |key: &str| {
        t.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase()
    };
    let hay = format!(
        "{} {} {}",
        text("counterparty"),
        text("purpose"),
        text("category")
    );
    words.iter().all(|w| hay.contains(w.as_str()))
}

/// Everything the Spending list can be narrowed and ordered by, as the filter sheet sets it.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(default)]
pub struct Filters {
    /// Words from the search box.
    pub query: String,
    /// `all`, `spending` or `income`.
    pub kind: String,
    /// Category keys (`uncategorized` for a booking with none); empty means every category.
    pub categories: Vec<String>,
    /// `all`, `7d`, `30d`, `90d`, `month`, `last_month` or `year`.
    pub preset: String,
    /// At least this much (cents, no matter whether it came in or went out).
    pub min_cents: Option<i64>,
    /// At most this much (cents, no matter whether it came in or went out).
    pub max_cents: Option<i64>,
    /// `newest`, `oldest`, `largest` or `smallest`.
    pub sort: String,
}

/// The first and last day a date preset covers, `None` for all time.
pub fn preset_bounds(preset: &str, today: &str) -> Result<Option<(String, String)>, String> {
    use crate::calendar::{add_days, add_months, iso_of, month_first, month_last};
    Ok(match preset {
        "7d" => Some((add_days(today, -6)?, today.to_string())),
        "30d" => Some((add_days(today, -29)?, today.to_string())),
        "90d" => Some((add_days(today, -89)?, today.to_string())),
        "month" => Some((month_first(today)?, month_last(today)?)),
        "last_month" => {
            let in_last = add_months(&month_first(today)?, -1)?;
            Some((month_first(&in_last)?, month_last(&in_last)?))
        }
        "year" => {
            let year: i64 = today
                .get(0..4)
                .and_then(|y| y.parse().ok())
                .ok_or_else(|| format!("not a date: {today}"))?;
            Some((iso_of(year, 1, 1), today.to_string()))
        }
        _ => None,
    })
}

fn category_key(t: &Value) -> String {
    t.get("category")
        .and_then(Value::as_str)
        .filter(|c| !c.is_empty())
        .unwrap_or("uncategorized")
        .to_string()
}

/// The bookings that pass every filter, in the order asked for. Dates compare as ISO text.
pub fn apply_filters(items: &[Value], f: &Filters, today: &str) -> Result<Vec<Value>, String> {
    let words = query_words(&f.query);
    let bounds = preset_bounds(&f.preset, today)?;
    let mut out: Vec<Value> = items
        .iter()
        .filter(|t| {
            let c = cents(t);
            let kind_ok = match f.kind.as_str() {
                "spending" => c < 0.0,
                "income" => c > 0.0,
                _ => true,
            };
            let abs = c.abs() as i64;
            let date = t.get("booking_date").and_then(Value::as_str).unwrap_or("");
            kind_ok
                && (f.categories.is_empty() || f.categories.contains(&category_key(t)))
                && bounds
                    .as_ref()
                    .is_none_or(|(from, to)| date >= from.as_str() && date <= to.as_str())
                && f.min_cents.is_none_or(|m| abs >= m)
                && f.max_cents.is_none_or(|m| abs <= m)
                && (words.is_empty() || matches_words(t, &words))
        })
        .cloned()
        .collect();
    let date_of = |t: &Value| {
        t.get("booking_date")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    match f.sort.as_str() {
        "oldest" => out.sort_by_key(date_of),
        "largest" => out.sort_by_key(|t| std::cmp::Reverse(cents(t).abs() as i64)),
        "smallest" => out.sort_by_key(|t| cents(t).abs() as i64),
        _ => out.sort_by_key(|t| std::cmp::Reverse(date_of(t))),
    }
    Ok(out)
}

fn preset_label(preset: &str) -> Option<&'static str> {
    Some(match preset {
        "7d" => "Last 7 days",
        "30d" => "Last 30 days",
        "90d" => "Last 90 days",
        "month" => "This month",
        "last_month" => "Last month",
        "year" => "This year",
        _ => return None,
    })
}

fn category_label(key: &str) -> String {
    let mut chars = key.chars();
    chars.next().map_or_else(String::new, |c| {
        c.to_uppercase().collect::<String>() + chars.as_str()
    })
}

/// One removable chip per filter that is on: `{ key, label }`, in the order they read best.
/// `key` is what to switch off: `query`, `kind`, `category:<key>`, `preset`, `amount` or `sort`.
pub fn filter_chips(f: &Filters) -> Vec<Value> {
    use crate::format::format_cents;
    let mut chips = Vec::new();
    let mut add = |key: String, label: String| chips.push(json!({ "key": key, "label": label }));
    if !f.query.trim().is_empty() {
        add(
            "query".into(),
            format!("\u{201c}{}\u{201d}", f.query.trim()),
        );
    }
    match f.kind.as_str() {
        "spending" => add("kind".into(), "Spending".into()),
        "income" => add("kind".into(), "Income".into()),
        _ => {}
    }
    if let Some(label) = preset_label(&f.preset) {
        add("preset".into(), label.into());
    }
    for c in &f.categories {
        add(format!("category:{c}"), category_label(c));
    }
    match (f.min_cents, f.max_cents) {
        (Some(lo), Some(hi)) => add(
            "amount".into(),
            format!("{} to {}", format_cents(lo), format_cents(hi)),
        ),
        (Some(lo), None) => add("amount".into(), format!("Over {}", format_cents(lo))),
        (None, Some(hi)) => add("amount".into(), format!("Under {}", format_cents(hi))),
        (None, None) => {}
    }
    match f.sort.as_str() {
        "oldest" => add("sort".into(), "Oldest first".into()),
        "largest" => add("sort".into(), "Largest first".into()),
        "smallest" => add("sort".into(), "Smallest first".into()),
        _ => {}
    }
    chips
}

/// What came in and what went out of these bookings, as positive cents each: `{ income, spent }`.
pub fn income_spent(items: &[Value]) -> Value {
    let (mut income, mut spent) = (0_i64, 0_i64);
    for t in items {
        let c = cents(t) as i64;
        if c > 0 {
            income += c;
        } else {
            spent -= c;
        }
    }
    json!({ "income": income, "spent": spent })
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
    fn the_listed_bookings_add_up_to_income_and_spent() {
        let items = [
            json!({ "amount_cents": -500 }),
            json!({ "amount_cents": 285000 }),
            json!({ "amount_cents": -1299 }),
            json!({ "amount_cents": 0 }),
        ];
        assert_eq!(
            income_spent(&items),
            json!({ "income": 285000, "spent": 1799 })
        );
        assert_eq!(income_spent(&[]), json!({ "income": 0, "spent": 0 }));
    }

    #[test]
    fn the_search_finds_every_word_in_the_counterparty_purpose_or_category() {
        let items = [
            json!({ "counterparty": "REWE Markt GmbH", "purpose": "Einkauf 14.10.", "category": "groceries" }),
            json!({ "counterparty": "Netflix International", "purpose": "Abo", "category": "subscriptions" }),
            json!({ "counterparty": "Hausverwaltung Schmidt", "purpose": "Miete November", "category": null }),
        ];
        assert_eq!(search_tx(&items, "").len(), 3);
        assert_eq!(search_tx(&items, "   ").len(), 3);
        assert_eq!(search_tx(&items, "rewe").len(), 1);
        assert_eq!(search_tx(&items, "REWE einkauf").len(), 1);
        assert_eq!(search_tx(&items, "rewe netflix").len(), 0);
        assert_eq!(search_tx(&items, "groceries").len(), 1);
        assert_eq!(search_tx(&items, "miete").len(), 1);
    }

    fn booking(date: &str, who: &str, category: Option<&str>, cents: i64) -> Value {
        json!({ "booking_date": date, "counterparty": who, "purpose": "", "category": category, "amount_cents": cents })
    }

    fn sample() -> Vec<Value> {
        vec![
            booking("2026-11-05", "REWE", Some("groceries"), -4674),
            booking("2026-11-03", "Lidl", Some("groceries"), -1294),
            booking("2026-10-30", "Netflix", Some("subscriptions"), -1299),
            booking("2026-10-01", "Arbeitgeber", None, 285000),
            booking("2026-01-15", "Vodafone", Some("utilities"), -3999),
        ]
    }

    fn names(items: &[Value]) -> Vec<&str> {
        items
            .iter()
            .map(|t| t["counterparty"].as_str().unwrap())
            .collect()
    }

    #[test]
    fn the_bookings_narrow_by_kind_category_period_and_amount() {
        let items = sample();
        let today = "2026-11-05";
        let f = |json: Value| serde_json::from_value::<Filters>(json).unwrap();
        assert_eq!(
            apply_filters(&items, &f(json!({})), today).unwrap().len(),
            5
        );
        assert_eq!(
            names(&apply_filters(&items, &f(json!({ "kind": "income" })), today).unwrap()),
            ["Arbeitgeber"]
        );
        assert_eq!(
            names(
                &apply_filters(&items, &f(json!({ "categories": ["groceries"] })), today).unwrap()
            ),
            ["REWE", "Lidl"]
        );
        assert_eq!(
            names(
                &apply_filters(
                    &items,
                    &f(json!({ "categories": ["uncategorized"] })),
                    today
                )
                .unwrap()
            ),
            ["Arbeitgeber"]
        );
        assert_eq!(
            names(&apply_filters(&items, &f(json!({ "preset": "month" })), today).unwrap()),
            ["REWE", "Lidl"]
        );
        assert_eq!(
            names(&apply_filters(&items, &f(json!({ "preset": "last_month" })), today).unwrap()),
            ["Netflix", "Arbeitgeber"]
        );
        assert_eq!(
            names(&apply_filters(&items, &f(json!({ "preset": "7d" })), today).unwrap()),
            ["REWE", "Lidl", "Netflix"]
        );
        assert_eq!(
            apply_filters(&items, &f(json!({ "preset": "year" })), today)
                .unwrap()
                .len(),
            5
        );
        // the amount counts whether it came in or went out
        assert_eq!(
            names(
                &apply_filters(
                    &items,
                    &f(json!({ "min_cents": 3000, "max_cents": 5000 })),
                    today
                )
                .unwrap()
            ),
            ["REWE", "Vodafone"]
        );
        assert_eq!(
            names(&apply_filters(&items, &f(json!({ "query": "lidl" })), today).unwrap()),
            ["Lidl"]
        );
        // everything together
        assert_eq!(names(&apply_filters(&items, &f(json!({ "kind": "spending", "categories": ["groceries"], "preset": "30d", "max_cents": 2000, "query": "li" })), today).unwrap()), ["Lidl"]);
    }

    #[test]
    fn the_bookings_come_in_the_order_asked_for() {
        let items = sample();
        let order = |sort: &str| {
            let f = Filters {
                sort: sort.into(),
                ..Filters::default()
            };
            names(&apply_filters(&items, &f, "2026-11-05").unwrap())
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            order("newest"),
            ["REWE", "Lidl", "Netflix", "Arbeitgeber", "Vodafone"]
        );
        assert_eq!(
            order(""),
            ["REWE", "Lidl", "Netflix", "Arbeitgeber", "Vodafone"]
        );
        assert_eq!(
            order("oldest"),
            ["Vodafone", "Arbeitgeber", "Netflix", "Lidl", "REWE"]
        );
        assert_eq!(
            order("largest"),
            ["Arbeitgeber", "REWE", "Vodafone", "Netflix", "Lidl"]
        );
        assert_eq!(
            order("smallest"),
            ["Lidl", "Netflix", "Vodafone", "REWE", "Arbeitgeber"]
        );
    }

    #[test]
    fn a_bad_today_is_an_error_not_a_guess() {
        let f = Filters {
            preset: "year".into(),
            ..Filters::default()
        };
        assert!(apply_filters(&sample(), &f, "soon").is_err());
        assert!(apply_filters(&sample(), &Filters::default(), "soon").is_ok());
    }

    #[test]
    fn every_filter_that_is_on_has_a_chip_to_switch_it_off() {
        assert!(filter_chips(&Filters::default()).is_empty());
        let f = Filters {
            query: " lidl ".into(),
            kind: "spending".into(),
            categories: vec!["groceries".into(), "uncategorized".into()],
            preset: "30d".into(),
            min_cents: Some(5000),
            max_cents: None,
            sort: "largest".into(),
        };
        let chips = filter_chips(&f);
        let key = |i: usize| chips[i]["key"].as_str().unwrap().to_string();
        let label = |i: usize| chips[i]["label"].as_str().unwrap().to_string();
        assert_eq!(chips.len(), 7);
        assert_eq!(
            (key(0), label(0)),
            ("query".into(), "\u{201c}lidl\u{201d}".into())
        );
        assert_eq!((key(1), label(1)), ("kind".into(), "Spending".into()));
        assert_eq!((key(2), label(2)), ("preset".into(), "Last 30 days".into()));
        assert_eq!(
            (key(3), label(3)),
            ("category:groceries".into(), "Groceries".into())
        );
        assert_eq!(key(4), "category:uncategorized");
        assert_eq!(
            (key(5), label(5)),
            ("amount".into(), "Over 50,00 \u{20ac}".into())
        );
        assert_eq!((key(6), label(6)), ("sort".into(), "Largest first".into()));
        let both = Filters {
            min_cents: Some(1000),
            max_cents: Some(2000),
            ..Filters::default()
        };
        assert_eq!(
            filter_chips(&both)[0]["label"],
            "10,00 \u{20ac} to 20,00 \u{20ac}"
        );
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
