//! The calendars that fill themselves from the rest of the app: payday and the charges of
//! subscriptions (money), the planned meals (groceries) and the end of a contract (the shopping
//! assistant). Each one is a read-only calendar with its own colour that can be hidden; tapping an
//! event opens the screen it comes from. These builders are pure; fetching what they need stays in
//! TypeScript (`loadFeeds`).

use serde::Deserialize;
use serde_json::Value;

use crate::calendar::{add_days, add_months, iso_of, weekday_index, ymd, Occurrence};
use crate::format::format_money;

struct Feed {
    key: &'static str,
    tone: &'static str,
    source: &'static str,
}

const PAYDAY: Feed = Feed {
    key: "payday",
    tone: "success",
    source: "Money",
};
const CHARGES: Feed = Feed {
    key: "charges",
    tone: "warning",
    source: "Subscription",
};
const MEALS: Feed = Feed {
    key: "meals",
    tone: "info",
    source: "Meal",
};
const SHOPPING: Feed = Feed {
    key: "shopping",
    tone: "neutral",
    source: "Shopping",
};

fn occurrence(
    f: &Feed,
    id: &str,
    title: String,
    date: &str,
    href: &str,
    notes: Option<String>,
) -> Occurrence {
    let key = format!("{}:{id}", f.key);
    Occurrence {
        event_id: Value::String(key.clone()),
        key,
        calendar_id: Value::String(f.key.into()),
        title,
        notes,
        location: None,
        all_day: true,
        start_date: date.into(),
        start_time: None,
        end_date: date.into(),
        end_time: None,
        tone: f.tone.into(),
        repeats: false,
        read_only: true,
        href: Some(href.into()),
        source: Some(f.source.into()),
    }
}

/// The payday of every month that touches the range (a day from 1 to 28).
pub fn payday_occurrences(payday: f64, from: &str, to: &str) -> Result<Vec<Occurrence>, String> {
    let day = (payday.trunc() as i64).clamp(1, 28);
    let (ay, am, _) = ymd(from)?;
    let (by, bm, _) = ymd(to)?;
    let mut out = vec![];
    for index in (i64::from(ay) * 12 + i64::from(am) - 1)..=(i64::from(by) * 12 + i64::from(bm) - 1)
    {
        let date = iso_of(index.div_euclid(12), index.rem_euclid(12) + 1, day);
        if date.as_str() >= from && date.as_str() <= to {
            let title = if day == 1 {
                "New budget month"
            } else {
                "Payday"
            };
            out.push(occurrence(
                &PAYDAY,
                &date,
                title.into(),
                &date,
                "/budget",
                Some("A new budget period starts.".into()),
            ));
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
pub struct Charge {
    pub counterparty: String,
    pub date: String,
    pub amount_cents: i64,
    #[serde(default)]
    pub overdue: bool,
}

/// Expected subscription charges inside the range (an overdue one shows on its expected day).
pub fn charge_occurrences(charges: &[Charge], from: &str, to: &str) -> Vec<Occurrence> {
    charges
        .iter()
        .filter(|c| c.date.as_str() >= from && c.date.as_str() <= to)
        .map(|c| {
            occurrence(
                &CHARGES,
                &format!("{}:{}", c.counterparty, c.date),
                format!(
                    "{} {}",
                    c.counterparty,
                    format_money(-c.amount_cents, false)
                ),
                &c.date,
                "/subscriptions",
                Some(
                    if c.overdue {
                        "Expected, not booked yet."
                    } else {
                        "Expected charge."
                    }
                    .into(),
                ),
            )
        })
        .collect()
}

#[derive(Deserialize)]
pub struct PlannedMeal {
    pub date: String,
    pub title: String,
    pub servings: i64,
}

pub fn meal_occurrences(meals: &[PlannedMeal], from: &str, to: &str) -> Vec<Occurrence> {
    meals
        .iter()
        .filter(|m| m.date.as_str() >= from && m.date.as_str() <= to)
        .map(|m| {
            let notes = format!(
                "{} {}",
                m.servings,
                if m.servings == 1 {
                    "serving"
                } else {
                    "servings"
                }
            );
            occurrence(
                &MEALS,
                &m.date,
                m.title.clone(),
                &m.date,
                "/mealplan",
                Some(notes),
            )
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contract {
    pub category: String,
    pub name: String,
    #[serde(default)]
    pub plan: Option<String>,
    pub ends_on: String,
}

/// The day a contract ends, and the day to look for a new one: two months before.
pub fn contract_occurrences(
    contracts: &[Contract],
    from: &str,
    to: &str,
) -> Result<Vec<Occurrence>, String> {
    let mut out = vec![];
    for c in contracts {
        let label = match c.plan.as_deref() {
            Some(p) if !p.is_empty() => format!("{}: {p}", c.name),
            _ => c.name.clone(),
        };
        if c.ends_on.as_str() >= from && c.ends_on.as_str() <= to {
            out.push(occurrence(
                &SHOPPING,
                &format!("{}:ends", c.category),
                format!("{label} ends"),
                &c.ends_on,
                "/shop",
                Some("Time to compare plans.".into()),
            ));
        }
        let look = add_months(&c.ends_on, -2)?;
        if look.as_str() >= from && look.as_str() <= to {
            out.push(occurrence(
                &SHOPPING,
                &format!("{}:look", c.category),
                format!("Look for a new {} plan", c.name.to_lowercase()),
                &look,
                "/shop",
                Some(format!("{label} ends on {}.", c.ends_on)),
            ));
        }
    }
    Ok(out)
}

/// The Mondays of the weeks that touch the range.
pub fn week_starts(from: &str, to: &str) -> Result<Vec<String>, String> {
    let mut out = vec![];
    let mut d = add_days(from, -(weekday_index(from)? as i64))?;
    while d.as_str() <= to {
        out.push(d.clone());
        d = add_days(&d, 7)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payday_is_once_a_month_inside_the_range() {
        let list = payday_occurrences(15.0, "2026-10-20", "2026-12-31").unwrap();
        let dates: Vec<_> = list.iter().map(|o| o.start_date.as_str()).collect();
        assert_eq!(dates, ["2026-11-15", "2026-12-15"]);
        assert!(list
            .iter()
            .all(|o| o.read_only && o.all_day && o.title == "Payday"));
        assert_eq!(
            payday_occurrences(1.0, "2026-11-01", "2026-11-30").unwrap()[0].title,
            "New budget month"
        );
    }

    #[test]
    fn contracts_give_an_end_and_a_look_day() {
        let c = vec![Contract {
            category: "mobile".into(),
            name: "Mobile".into(),
            plan: Some("Big".into()),
            ends_on: "2026-12-31".into(),
        }];
        let list = contract_occurrences(&c, "2026-10-01", "2026-12-31").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "Mobile: Big ends");
        assert_eq!(list[1].start_date, "2026-10-31");
        assert_eq!(list[1].title, "Look for a new mobile plan");
    }

    #[test]
    fn weeks_start_on_monday() {
        assert_eq!(
            week_starts("2026-11-04", "2026-11-17").unwrap(),
            ["2026-11-02", "2026-11-09", "2026-11-16"]
        );
    }
}
