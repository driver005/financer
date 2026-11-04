//! The Stores screen (spending per supermarket chain): how shares and changes are worded. The server
//! sends numbers (cents, tenths of a percent); the words are chosen here.

use serde::Deserialize;

use crate::format::{date_of, format_cents, format_date};

/// The part of one row of the server's answer the wording reads.
#[derive(Debug, Clone, Deserialize)]
pub struct StoreSpend {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub total_cents: i64,
    #[serde(default)]
    pub previous_total_cents: i64,
    #[serde(default)]
    pub change_cents: i64,
    #[serde(default)]
    pub change_permille: Option<i64>,
    #[serde(default)]
    pub share_permille: i64,
    #[serde(default)]
    pub visits: i64,
}

/// The part of the server's answer the wording reads.
#[derive(Debug, Clone, Deserialize)]
pub struct StoreSpending {
    pub other: StoreSpend,
    pub total_cents: i64,
    pub previous_total_cents: i64,
    pub compare_start: String,
    pub compare_end: String,
    pub compare_is_partial: bool,
}

/// `123` (tenths of a percent) -> `12,3 %`; whole numbers drop the decimal.
pub fn format_permille(permille: f64) -> String {
    let tenths = (permille + 0.5).floor() as i64; // as JavaScript rounds: halves go up
    let whole = tenths.abs() / 10;
    let frac = tenths.abs() % 10;
    let sign = if tenths < 0 { "-" } else { "" };
    if frac > 0 {
        format!("{sign}{whole},{frac} %")
    } else {
        format!("{sign}{whole} %")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeTone {
    Up,
    Down,
    Flat,
    New,
}

/// Spending went up, down, stayed the same, or there is nothing to compare with.
pub fn change_tone(row: &StoreSpend) -> ChangeTone {
    if row.previous_total_cents == 0 {
        return if row.total_cents > 0 {
            ChangeTone::New
        } else {
            ChangeTone::Flat
        };
    }
    match row.change_cents {
        c if c > 0 => ChangeTone::Up,
        c if c < 0 => ChangeTone::Down,
        _ => ChangeTone::Flat,
    }
}

/// `+12,3 %` / `-33,3 %` / `same` / `new`, for the chip next to a chain.
pub fn change_text(row: &StoreSpend) -> String {
    match change_tone(row) {
        ChangeTone::New => "new".into(),
        ChangeTone::Flat => "same".into(),
        _ => {
            let sign = if row.change_cents > 0 { "+" } else { "" };
            match row.change_permille {
                Some(p) => format!("{sign}{}", format_permille(p as f64)),
                None => format!("{sign}{}", format_cents(row.change_cents)),
            }
        }
    }
}

/// Length of a row's bar relative to the biggest row, 0..1.
pub fn bar_fraction(row_total_cents: i64, totals: &[i64]) -> f64 {
    let max = totals.iter().copied().max().unwrap_or(0).max(0);
    if max == 0 {
        0.0
    } else {
        (row_total_cents as f64 / max as f64).clamp(0.0, 1.0)
    }
}

pub fn visits_text(visits: i64) -> String {
    format!("{visits} visit{}", if visits == 1 { "" } else { "s" })
}

/// `today`, `yesterday`, `5 days ago`, or the date for anything older than two weeks.
pub fn last_visit_text(last_visit: Option<&str>, today: &str) -> Result<Option<String>, String> {
    let Some(last) = last_visit.filter(|l| !l.is_empty()) else {
        return Ok(None);
    };
    let days = (date_of(today)? - date_of(last)?).whole_days();
    Ok(Some(match days {
        d if d < 0 => format_date(last),
        0 => "today".into(),
        1 => "yesterday".into(),
        d if d <= 14 => format!("{d} days ago"),
        _ => format_date(last),
    }))
}

/// What the figures are compared with, e.g. `01.09. - 11.09.2026 (the same number of days)`.
pub fn compare_text(r: &StoreSpending) -> String {
    let range = format!(
        "{} - {}",
        format_date(&r.compare_start),
        format_date(&r.compare_end)
    );
    if r.compare_is_partial {
        format!("{range} (the same number of days)")
    } else {
        range
    }
}

/// One line about the total, with its comparison.
pub fn total_text(r: &StoreSpending) -> String {
    if r.total_cents == 0 {
        return "Nothing spent in stores yet.".into();
    }
    if r.previous_total_cents == 0 {
        return format!(
            "{} in stores. Nothing to compare with before.",
            format_cents(r.total_cents)
        );
    }
    let diff = r.total_cents - r.previous_total_cents;
    if diff == 0 {
        return format!(
            "{} in stores, the same as before.",
            format_cents(r.total_cents)
        );
    }
    format!(
        "{} in stores, {} {} than before.",
        format_cents(r.total_cents),
        format_cents(diff.abs()),
        if diff > 0 { "more" } else { "less" }
    )
}

/// Hint under the list when groceries could not be assigned to a chain; none when all were.
pub fn unmatched_hint(r: &StoreSpending) -> Option<String> {
    (r.other.total_cents > 0).then(|| {
        format!(
            "{} of groceries could not be matched to a chain. If a shop is missing, add its bank text under [[stores]] in the server's financer.toml.",
            format_cents(r.other.total_cents)
        )
    })
}

/// Accessible one-line summary of a row.
pub fn row_label(row: &StoreSpend) -> String {
    format!(
        "{}, {}, {} of store spending, {}, {}",
        row.name,
        format_cents(row.total_cents),
        format_permille(row.share_permille as f64),
        visits_text(row.visits),
        change_text(row)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(total: i64, previous: i64, change: i64, permille: Option<i64>) -> StoreSpend {
        StoreSpend {
            name: "Lidl".into(),
            total_cents: total,
            previous_total_cents: previous,
            change_cents: change,
            change_permille: permille,
            share_permille: 456,
            visits: 3,
        }
    }
    fn spending(total: i64, previous: i64, other: i64, partial: bool) -> StoreSpending {
        StoreSpending {
            other: row(other, 0, 0, None),
            total_cents: total,
            previous_total_cents: previous,
            compare_start: "2026-09-01".into(),
            compare_end: "2026-09-11".into(),
            compare_is_partial: partial,
        }
    }

    #[test]
    fn permille_is_written_in_german_notation() {
        assert_eq!(format_permille(123.0), "12,3 %");
        assert_eq!(format_permille(120.0), "12 %");
        assert_eq!(format_permille(-333.0), "-33,3 %");
        assert_eq!(format_permille(0.0), "0 %");
        assert_eq!(format_permille(5.0), "0,5 %");
    }

    #[test]
    fn a_change_is_up_down_flat_or_new() {
        assert_eq!(change_tone(&row(500, 0, 500, None)), ChangeTone::New);
        assert_eq!(change_tone(&row(0, 0, 0, None)), ChangeTone::Flat);
        assert_eq!(change_tone(&row(500, 400, 100, Some(250))), ChangeTone::Up);
        assert_eq!(
            change_tone(&row(300, 400, -100, Some(-250))),
            ChangeTone::Down
        );
        assert_eq!(change_text(&row(500, 400, 100, Some(250))), "+25 %");
        assert_eq!(change_text(&row(300, 450, -150, Some(-333))), "-33,3 %");
        assert_eq!(change_text(&row(500, 400, 100, None)), "+1,00 €");
        assert_eq!(change_text(&row(500, 0, 500, None)), "new");
        assert_eq!(change_text(&row(400, 400, 0, Some(0))), "same");
    }

    #[test]
    fn bars_are_relative_to_the_biggest_row() {
        assert_eq!(bar_fraction(50, &[100, 50]), 0.5);
        assert_eq!(bar_fraction(100, &[100, 50]), 1.0);
        assert_eq!(bar_fraction(0, &[0, 0]), 0.0);
        assert_eq!(bar_fraction(10, &[]), 0.0);
    }

    #[test]
    fn visits_and_last_visits_are_worded() {
        assert_eq!(visits_text(1), "1 visit");
        assert_eq!(visits_text(2), "2 visits");
        let at = |d: &str| last_visit_text(Some(d), "2026-10-11").unwrap();
        assert_eq!(at("2026-10-11").as_deref(), Some("today"));
        assert_eq!(at("2026-10-10").as_deref(), Some("yesterday"));
        assert_eq!(at("2026-10-06").as_deref(), Some("5 days ago"));
        assert_eq!(at("2026-09-20").as_deref(), Some("20.09.2026"));
        assert_eq!(
            at("2026-10-20").as_deref(),
            Some("20.10.2026"),
            "a date ahead is shown as it is"
        );
        assert_eq!(last_visit_text(None, "2026-10-11").unwrap(), None);
    }

    #[test]
    fn the_total_says_what_changed() {
        assert_eq!(
            total_text(&spending(0, 0, 0, false)),
            "Nothing spent in stores yet."
        );
        assert_eq!(
            total_text(&spending(5000, 0, 0, false)),
            "50,00 € in stores. Nothing to compare with before."
        );
        assert_eq!(
            total_text(&spending(5000, 5000, 0, false)),
            "50,00 € in stores, the same as before."
        );
        assert_eq!(
            total_text(&spending(5000, 4000, 0, false)),
            "50,00 € in stores, 10,00 € more than before."
        );
        assert_eq!(
            total_text(&spending(3000, 4000, 0, false)),
            "30,00 € in stores, 10,00 € less than before."
        );
        assert_eq!(
            compare_text(&spending(1, 1, 0, true)),
            "01.09.2026 - 11.09.2026 (the same number of days)"
        );
        assert_eq!(
            compare_text(&spending(1, 1, 0, false)),
            "01.09.2026 - 11.09.2026"
        );
    }

    #[test]
    fn unmatched_groceries_get_a_hint_and_a_row_a_label() {
        assert_eq!(unmatched_hint(&spending(1, 1, 0, false)), None);
        assert!(unmatched_hint(&spending(1, 1, 1234, false))
            .unwrap()
            .starts_with("12,34 € of groceries could not be matched"));
        assert_eq!(
            row_label(&row(500, 400, 100, Some(250))),
            "Lidl, 5,00 €, 45,6 % of store spending, 3 visits, +25 %"
        );
    }
}
