//! The meal plan screen: week math (weeks run Monday to Sunday and are named by their Monday),
//! turning picked recipes into plan entries, the ticks on the shopping list, and the wording of the
//! budget check. Money is integer cents; the server does the arithmetic, the words are chosen here.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::calendar::{add_days, start_of_week, weekday_index};
use crate::format::format_cents;

pub const MAX_SERVINGS: i64 = 20;
const WEEKDAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

pub fn chain_name(chain: &str) -> String {
    match chain {
        "aldi" => "Aldi",
        "lidl" => "Lidl",
        "kaufland" => "Kaufland",
        "rewe" => "Rewe",
        other => other,
    }
    .into()
}

// ---- weeks ----

/// The seven days of the week, Monday first.
pub fn week_days(start: &str) -> Result<Vec<String>, String> {
    (0..7).map(|i| add_days(start, i)).collect()
}

/// The Monday `weeks` weeks after (or, negative, before) `start`.
pub fn shift_week(start: &str, weeks: i64) -> Result<String, String> {
    add_days(start, weeks * 7)
}

/// `Mon` ... `Sun`
pub fn weekday_name(iso: &str) -> Result<String, String> {
    Ok(WEEKDAYS[weekday_index(iso)?].into())
}

/// `2026-10-12` -> `12.10.`
pub fn short_date(iso: &str) -> String {
    let mut p = iso.split('-');
    let (_, m, d) = (p.next(), p.next().unwrap_or(""), p.next().unwrap_or(""));
    format!("{d}.{m}.")
}

/// `12.10. – 18.10.2026`, with both years when the week spans New Year.
pub fn week_label(start: &str) -> Result<String, String> {
    let end = add_days(start, 6)?;
    let (sy, ey) = (
        start.split('-').next().unwrap_or(""),
        end.split('-').next().unwrap_or(""),
    );
    let from = if sy == ey {
        short_date(start)
    } else {
        format!("{}{sy}", short_date(start))
    };
    Ok(format!("{from} \u{2013} {}{ey}", short_date(&end)))
}

/// Where `start` is relative to the week that contains `today`.
pub fn week_relation(start: &str, today: &str) -> Result<&'static str, String> {
    let current = start_of_week(today)?;
    Ok(if start == current {
        "this"
    } else if start == shift_week(&current, 1)? {
        "next"
    } else if start == shift_week(&current, -1)? {
        "last"
    } else {
        "other"
    })
}

// ---- the plan ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ingredient {
    pub name: String,
    pub amount: String,
}

/// One planned meal. `recipe_id` is none for a suggested recipe that is not in the dataset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MealEntry {
    #[serde(default)]
    pub recipe_id: Option<String>,
    pub title: String,
    pub servings: i64,
    /// Servings the ingredient amounts are written for.
    pub recipe_servings: i64,
    #[serde(default)]
    pub ingredients: Vec<Ingredient>,
}

pub fn clamp_servings(n: f64) -> i64 {
    if !n.is_finite() {
        return 1;
    }
    ((n + 0.5).floor() as i64).clamp(1, MAX_SERVINGS)
}

/// The plan of a week by day (a day without a meal has no key) from the server's days.
pub fn plan_from_days(days: &[Value]) -> Map<String, Value> {
    let mut plan = Map::new();
    for d in days {
        let date = d
            .get("date")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let ingredients: Vec<Value> = d
            .get("ingredients")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|i| json!({ "name": i.get("name").cloned().unwrap_or(Value::Null), "amount": i.get("amount").cloned().unwrap_or(Value::Null) })).collect())
            .unwrap_or_default();
        plan.insert(
            date,
            json!({
                "recipe_id": d.get("recipe_id").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null),
                "title": d.get("title").cloned().unwrap_or(Value::Null),
                "servings": d.get("servings").cloned().unwrap_or(Value::Null),
                "recipe_servings": d.get("recipe_servings").cloned().unwrap_or(Value::Null),
                "ingredients": ingredients,
            }),
        );
    }
    plan
}

fn ingredients_of(v: &Value) -> Vec<Ingredient> {
    v.get("ingredients")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|i| Ingredient {
                    name: i.get("name").and_then(Value::as_str).unwrap_or("").into(),
                    amount: i.get("amount").and_then(Value::as_str).unwrap_or("").into(),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn entry_from_recipe(r: &Value, servings: Option<f64>) -> MealEntry {
    let recipe_servings = r.get("servings").and_then(Value::as_f64).unwrap_or(1.0);
    MealEntry {
        recipe_id: r.get("id").and_then(Value::as_str).map(String::from),
        title: r.get("title").and_then(Value::as_str).unwrap_or("").into(),
        servings: clamp_servings(servings.unwrap_or(recipe_servings)),
        recipe_servings: recipe_servings as i64,
        ingredients: ingredients_of(r),
    }
}

pub fn entry_from_idea(i: &Value, servings: Option<f64>) -> MealEntry {
    let idea_servings = i.get("servings").and_then(Value::as_f64).unwrap_or(1.0);
    MealEntry {
        recipe_id: None,
        title: i
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .into(),
        servings: clamp_servings(servings.unwrap_or(idea_servings)),
        recipe_servings: clamp_servings(idea_servings),
        ingredients: ingredients_of(i),
    }
}

/// A copy of the plan with `iso` set to `entry`, or cleared when `entry` is none.
pub fn set_day(plan: &Map<String, Value>, iso: &str, entry: Option<Value>) -> Map<String, Value> {
    let mut next = plan.clone();
    match entry {
        Some(e) => {
            next.insert(iso.into(), e);
        }
        None => {
            next.remove(iso);
        }
    }
    next
}

/// The request body for saving the week that starts on `start`: planned days only, in order.
pub fn plan_to_input(plan: &Map<String, Value>, start: &str) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for date in week_days(start)? {
        let Some(e) = plan.get(&date) else { continue };
        let servings = clamp_servings(e.get("servings").and_then(Value::as_f64).unwrap_or(1.0));
        match e.get("recipe_id").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            Some(id) => out.push(json!({ "date": date, "recipe_id": id, "servings": servings })),
            None => out.push(json!({
                "date": date,
                "title": e.get("title").cloned().unwrap_or(Value::Null),
                "servings": servings,
                "recipe_servings": clamp_servings(e.get("recipe_servings").and_then(Value::as_f64).unwrap_or(1.0)),
                "ingredients": ingredients_of(e),
            })),
        }
    }
    Ok(out)
}

pub fn planned_count(plan: &Map<String, Value>) -> usize {
    plan.len()
}

// ---- ticking items off ----

/// Ticks are per item, so they survive the best split moving an item to another shop.
pub fn item_tick_id(item: &str) -> String {
    format!("item:{item}")
}

pub fn unmatched_tick_id(name: &str) -> String {
    format!("name:{}", name.trim().to_lowercase())
}

/// Everything on the list that can be ticked, each once.
pub fn tick_ids(list: &Value) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    let mut add = |id: String| {
        if seen.insert(id.clone()) {
            out.push(id);
        }
    };
    let items = |v: Option<&Value>| v.and_then(Value::as_array).cloned().unwrap_or_default();
    for stop in items(list.get("plan").and_then(|p| p.get("stops"))) {
        for i in items(stop.get("items")) {
            add(item_tick_id(
                i.get("item").and_then(Value::as_str).unwrap_or(""),
            ));
        }
    }
    for i in items(list.get("unpriced")) {
        add(item_tick_id(
            i.get("item").and_then(Value::as_str).unwrap_or(""),
        ));
    }
    for u in items(list.get("unmatched")) {
        add(unmatched_tick_id(
            u.get("name").and_then(Value::as_str).unwrap_or(""),
        ));
    }
    out
}

pub fn toggle_tick(ticks: &[String], id: &str) -> Vec<String> {
    if ticks.iter().any(|t| t == id) {
        ticks.iter().filter(|t| t.as_str() != id).cloned().collect()
    } else {
        ticks.iter().cloned().chain([id.to_string()]).collect()
    }
}

/// Drops ticks of things that are no longer on the list (a recipe was swapped, say).
pub fn prune_ticks(ticks: &[String], list: &Value) -> Vec<String> {
    let valid: BTreeSet<String> = tick_ids(list).into_iter().collect();
    ticks
        .iter()
        .filter(|t| valid.contains(*t))
        .cloned()
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

pub fn tick_progress(list: &Value, ticks: &[String]) -> Progress {
    let ids = tick_ids(list);
    let ticked: BTreeSet<&String> = ticks.iter().collect();
    Progress {
        done: ids.iter().filter(|id| ticked.contains(id)).count(),
        total: ids.len(),
    }
}

/// Where the ticks of a week are kept on the device.
pub fn ticks_key(start: &str) -> String {
    format!("financer.mealplan.ticks.{start}")
}

pub fn serialize_ticks(ticks: &[String]) -> String {
    let mut seen = BTreeSet::new();
    let unique: Vec<&String> = ticks.iter().filter(|t| seen.insert(*t)).collect();
    serde_json::to_string(&unique).unwrap_or_else(|_| "[]".into())
}

/// Unreadable or foreign data gives no ticks instead of an error.
pub fn parse_ticks(raw: Option<&str>) -> Vec<String> {
    raw.filter(|r| !r.is_empty())
        .and_then(|r| serde_json::from_str::<Value>(r).ok())
        .and_then(|v| {
            v.as_array().map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
        })
        .unwrap_or_default()
}

// ---- wording ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Verdict {
    pub tone: &'static str,
    pub title: String,
    pub detail: String,
}

/// Whether the week's shopping fits what is left of the groceries budget.
pub fn budget_verdict(b: &Value) -> Verdict {
    let int = |k: &str| b.get(k).and_then(Value::as_i64);
    let unpriced_count = int("unpriced_count").unwrap_or(0);
    let estimated = int("estimated_cents").unwrap_or(0);
    let unpriced = if unpriced_count > 0 {
        format!(
            " {unpriced_count} item{} no price and {} not counted.",
            if unpriced_count == 1 {
                " has"
            } else {
                "s have"
            },
            if unpriced_count == 1 { "is" } else { "are" }
        )
    } else {
        String::new()
    };
    if estimated == 0 && unpriced_count > 0 {
        return Verdict {
            tone: "neutral",
            title: "No prices for this list yet".into(),
            detail: format!("Refresh the prices on the Prices tab to see the cost.{unpriced}"),
        };
    }
    let cost = format!("About {} for the week.", format_cents(estimated));
    let (budget, left, fits) = (
        int("budget_cents"),
        int("left_after_cents"),
        b.get("fits").and_then(Value::as_bool),
    );
    let (Some(budget), Some(left), Some(fits)) = (budget, left, fits) else {
        return Verdict {
            tone: "neutral",
            title: cost,
            detail: format!("Set a groceries limit in Budget to see if it fits.{unpriced}"),
        };
    };
    if fits {
        return Verdict {
            tone: "good",
            title: "Fits your groceries budget".into(),
            detail: format!(
                "{cost} {} of {} stays left.{unpriced}",
                format_cents(left),
                format_cents(budget)
            ),
        };
    }
    Verdict {
        tone: "bad",
        title: format!("{} over your groceries budget", format_cents(-left)),
        detail: format!(
            "{cost} Only {} is left this period.{unpriced}",
            format_cents(budget.max(0))
        ),
    }
}

/// One line on what the best plan is.
pub fn plan_headline(plan: &Value) -> String {
    let int = |k: &str| plan.get(k).and_then(Value::as_i64).unwrap_or(0);
    let stops = plan
        .get("stops")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if plan.get("split").and_then(Value::as_bool).unwrap_or(false) {
        return format!(
            "Best split over {} shops: {}, {} cheaper than one shop",
            stops.len(),
            format_cents(int("total_cents")),
            format_cents(int("saving_cents"))
        );
    }
    match stops.first() {
        Some(only) => format!(
            "Cheapest at {}: {}",
            chain_name(only.get("chain").and_then(Value::as_str).unwrap_or("")),
            format_cents(int("total_cents"))
        ),
        None => format_cents(int("total_cents")),
    }
}

/// `Lidl 12,30 €`, with a note when the shop lacks some of the items.
pub fn chain_total_text(c: &Value) -> String {
    let base = format!(
        "{} {}",
        chain_name(c.get("chain").and_then(Value::as_str).unwrap_or("")),
        format_cents(c.get("total_cents").and_then(Value::as_i64).unwrap_or(0))
    );
    if c.get("complete").and_then(Value::as_bool).unwrap_or(true) {
        base
    } else {
        format!(
            "{base} (lacks {})",
            c.get("missing")
                .and_then(Value::as_array)
                .map_or(0, Vec::len)
        )
    }
}

/// The detail line of a list item: `2 × 500 g, need 1 kg`.
pub fn item_detail(i: &Value) -> String {
    let s = |k: &str| {
        i.get(k)
            .map(|v| v.as_str().map_or_else(|| v.to_string(), String::from))
            .unwrap_or_default()
    };
    format!("{} × {}, need {}", s("packs"), s("pack"), s("needed"))
}

/// Ingredient of a suggested recipe that has no known item: `Safran: 1 Prise, 2 Fäden`.
pub fn unmatched_text(u: &Value) -> String {
    let name = u.get("name").and_then(Value::as_str).unwrap_or("");
    let amounts: Vec<&str> = u
        .get("amounts")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if amounts.is_empty() {
        name.into()
    } else {
        format!("{name}: {}", amounts.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weeks_are_named_by_their_monday() {
        assert_eq!(
            week_days("2026-10-12").unwrap().last().unwrap(),
            "2026-10-18"
        );
        assert_eq!(shift_week("2026-10-12", -1).unwrap(), "2026-10-05");
        assert_eq!(weekday_name("2026-10-14").unwrap(), "Wed");
        assert_eq!(short_date("2026-10-12"), "12.10.");
        assert_eq!(
            week_label("2026-10-12").unwrap(),
            "12.10. \u{2013} 18.10.2026"
        );
        assert_eq!(
            week_label("2026-12-28").unwrap(),
            "28.12.2026 \u{2013} 03.01.2027"
        );
        assert_eq!(week_relation("2026-10-12", "2026-10-14").unwrap(), "this");
        assert_eq!(week_relation("2026-10-19", "2026-10-14").unwrap(), "next");
        assert_eq!(week_relation("2026-10-05", "2026-10-14").unwrap(), "last");
        assert_eq!(week_relation("2026-09-01", "2026-10-14").unwrap(), "other");
    }

    #[test]
    fn servings_are_kept_between_one_and_twenty() {
        assert_eq!(
            (
                clamp_servings(0.0),
                clamp_servings(2.4),
                clamp_servings(2.5),
                clamp_servings(99.0),
                clamp_servings(f64::NAN)
            ),
            (1, 2, 3, 20, 1)
        );
    }

    #[test]
    fn a_week_is_saved_as_planned_days_only() {
        let recipe = json!({ "id": "pfannkuchen", "title": "Pfannkuchen", "servings": 4, "ingredients": [{ "name": "Mehl", "amount": "200 g" }] });
        let idea = json!({ "title": "  Soup ", "servings": 2, "ingredients": [{ "name": "Carrot", "amount": "3" }] });
        let mut plan = Map::new();
        plan = set_day(
            &plan,
            "2026-10-14",
            Some(serde_json::to_value(entry_from_recipe(&recipe, Some(2.0))).unwrap()),
        );
        plan = set_day(
            &plan,
            "2026-10-12",
            Some(serde_json::to_value(entry_from_idea(&idea, None)).unwrap()),
        );
        assert_eq!(planned_count(&plan), 2);
        let input = plan_to_input(&plan, "2026-10-12").unwrap();
        assert_eq!(
            input[0],
            json!({ "date": "2026-10-12", "title": "Soup", "servings": 2, "recipe_servings": 2, "ingredients": [{ "name": "Carrot", "amount": "3" }] })
        );
        assert_eq!(
            input[1],
            json!({ "date": "2026-10-14", "recipe_id": "pfannkuchen", "servings": 2 })
        );
        assert_eq!(
            plan_to_input(&set_day(&plan, "2026-10-12", None), "2026-10-12")
                .unwrap()
                .len(),
            1
        );
        let back = plan_from_days(&[
            json!({ "date": "2026-10-14", "recipe_id": null, "title": "T", "servings": 2, "recipe_servings": 4, "ingredients": [{ "name": "a", "amount": "b", "extra": 1 }] }),
        ]);
        assert_eq!(
            back["2026-10-14"]["ingredients"][0],
            json!({ "name": "a", "amount": "b" })
        );
    }

    fn list() -> Value {
        json!({ "plan": { "stops": [{ "items": [{ "item": "milk" }, { "item": "flour" }] }] }, "unpriced": [{ "item": "milk" }, { "item": "salt" }], "unmatched": [{ "name": " Safran " }] })
    }

    #[test]
    fn ticks_are_per_item_and_follow_the_list() {
        assert_eq!(
            tick_ids(&list()),
            ["item:milk", "item:flour", "item:salt", "name:safran"]
        );
        let ticks = vec!["item:milk".to_string(), "item:gone".to_string()];
        assert_eq!(prune_ticks(&ticks, &list()), ["item:milk"]);
        assert_eq!(
            tick_progress(&list(), &ticks),
            Progress { done: 1, total: 4 }
        );
        assert_eq!(toggle_tick(&ticks, "item:milk"), ["item:gone"]);
        assert_eq!(
            toggle_tick(&ticks, "item:salt"),
            ["item:milk", "item:gone", "item:salt"]
        );
        assert_eq!(
            ticks_key("2026-10-12"),
            "financer.mealplan.ticks.2026-10-12"
        );
        assert_eq!(
            serialize_ticks(&["a".into(), "b".into(), "a".into()]),
            r#"["a","b"]"#
        );
        assert_eq!(parse_ticks(Some(r#"["a",3,"b"]"#)), ["a", "b"]);
        assert!(
            parse_ticks(Some("{")).is_empty()
                && parse_ticks(Some(r#"{"a":1}"#)).is_empty()
                && parse_ticks(None).is_empty()
        );
    }

    #[test]
    fn the_budget_is_worded_by_whether_it_fits() {
        let b = |v: Value| budget_verdict(&v);
        assert_eq!(
            b(json!({ "estimated_cents": 0, "unpriced_count": 2 })).title,
            "No prices for this list yet"
        );
        let fits = b(
            json!({ "estimated_cents": 3000, "unpriced_count": 0, "budget_cents": 8000, "left_after_cents": 5000, "fits": true }),
        );
        assert_eq!(
            (fits.tone, fits.title.as_str()),
            ("good", "Fits your groceries budget")
        );
        assert_eq!(
            fits.detail,
            "About 30,00 € for the week. 50,00 € of 80,00 € stays left."
        );
        let over = b(
            json!({ "estimated_cents": 9000, "unpriced_count": 1, "budget_cents": 8000, "left_after_cents": -1000, "fits": false }),
        );
        assert_eq!(over.title, "10,00 € over your groceries budget");
        assert_eq!(over.detail, "About 90,00 € for the week. Only 80,00 € is left this period. 1 item has no price and is not counted.");
        let none = b(
            json!({ "estimated_cents": 3000, "unpriced_count": 0, "budget_cents": null, "left_after_cents": null, "fits": null }),
        );
        assert_eq!(
            (none.tone, none.title.as_str()),
            ("neutral", "About 30,00 € for the week.")
        );
        assert!(b(json!({ "estimated_cents": 100, "unpriced_count": 3 }))
            .detail
            .contains("3 items have no price and are not counted."));
    }

    #[test]
    fn plans_and_items_are_worded() {
        assert_eq!(
            plan_headline(
                &json!({ "split": true, "stops": [{}, {}], "total_cents": 4000, "saving_cents": 500 })
            ),
            "Best split over 2 shops: 40,00 €, 5,00 € cheaper than one shop"
        );
        assert_eq!(
            plan_headline(
                &json!({ "split": false, "stops": [{ "chain": "lidl" }], "total_cents": 4000 })
            ),
            "Cheapest at Lidl: 40,00 €"
        );
        assert_eq!(
            plan_headline(&json!({ "split": false, "stops": [], "total_cents": 0 })),
            "0,00 €"
        );
        assert_eq!(
            chain_total_text(&json!({ "chain": "aldi", "total_cents": 1230, "complete": true })),
            "Aldi 12,30 €"
        );
        assert_eq!(
            chain_total_text(
                &json!({ "chain": "aldi", "total_cents": 1230, "complete": false, "missing": ["a", "b"] })
            ),
            "Aldi 12,30 € (lacks 2)"
        );
        assert_eq!(
            item_detail(&json!({ "packs": 2, "pack": "500 g", "needed": "1 kg" })),
            "2 × 500 g, need 1 kg"
        );
        assert_eq!(
            unmatched_text(&json!({ "name": "Safran", "amounts": ["1 Prise", "2 Fäden"] })),
            "Safran: 1 Prise, 2 Fäden"
        );
        assert_eq!(
            unmatched_text(&json!({ "name": "Salz", "amounts": [] })),
            "Salz"
        );
    }
}
