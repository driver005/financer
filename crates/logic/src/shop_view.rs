//! Turning API answers into what the design system's components show: sorting results, deal badges,
//! the "understood as" chips, the comparison table, savings and the deal filters.

use std::cmp::Ordering;

use serde_json::{json, Map, Value};

use crate::js::{has, list, num, string, text};
use crate::shop_format::{format_cents, saving_text};

const BIG_DEAL_PCT: f64 = 15.0;

fn ranked_price(item: &Value) -> f64 {
    item.get("ranked")
        .and_then(|r| num(r, "price_cents"))
        .unwrap_or(f64::INFINITY)
}

fn discount(item: &Value) -> f64 {
    item.get("deal")
        .and_then(|d| num(d, "discount_pct"))
        .unwrap_or(0.0)
}

/// Re-order results the person already has. "Best match" is the server's order.
pub fn sort_items(items: &[Value], key: &str) -> Vec<Value> {
    let mut out = items.to_vec();
    match key {
        "price" => out.sort_by(|a, b| {
            ranked_price(a)
                .partial_cmp(&ranked_price(b))
                .unwrap_or(Ordering::Equal)
        }),
        "deal" => out.sort_by(|a, b| {
            discount(b)
                .partial_cmp(&discount(a))
                .unwrap_or(Ordering::Equal)
        }),
        _ => {}
    }
    out
}

fn offers(item: &Value) -> &[Value] {
    item.get("product").map_or(&[][..], |p| list(p, "offers"))
}

pub fn is_monthly(item: &Value) -> bool {
    offers(item)
        .iter()
        .any(|o| has(o, "recurring") && o.get("recurring") != Some(&Value::Bool(false)))
}

/// The offer behind the price shown for a result.
pub fn best_offer(item: &Value) -> Option<Value> {
    let url = item.get("ranked").and_then(|r| r.get("url"));
    let all = offers(item);
    all.iter()
        .find(|o| o.get("url") == url && url.is_some())
        .or_else(|| all.first())
        .cloned()
}

pub fn deal_badges(verdict: Option<&str>) -> Vec<Value> {
    match verdict {
        Some("great") => vec![json!({ "label": "Great deal", "tone": "success" })],
        Some("good") => vec![json!({ "label": "Good deal", "tone": "success" })],
        _ => vec![],
    }
}

pub fn saving_note(item: &Value, months: f64) -> Option<String> {
    let s = item.get("saving").filter(|s| !s.is_null())?;
    Some(saving_text(
        num(s, "per_month_cents").unwrap_or(0.0),
        num(s, "over_horizon_cents").unwrap_or(0.0),
        months,
        text(s, "current"),
    ))
}

fn without_zero_cents(cents: f64) -> String {
    format_cents(cents).replacen(",00", "", 1)
}

fn op_symbol(op: &str) -> &'static str {
    match op {
        "gte" => "≥",
        "lte" => "≤",
        "eq" => "=",
        "ne" => "≠",
        _ => ":",
    }
}

fn max_price(parsed: &Value) -> Option<f64> {
    num(parsed, "max_price_cents").filter(|p| *p != 0.0)
}

/// The "understood as" chips: what the query's price and conditions were taken to mean.
pub fn understood(parsed: &Value) -> Vec<Value> {
    let mut out = vec![];
    if let Some(p) = max_price(parsed) {
        out.push(json!({ "key": "price", "label": format!("under {}", without_zero_cents(p)) }));
    }
    for c in list(parsed, "constraints") {
        let attribute = text(c, "attribute").unwrap_or("");
        let op = text(c, "op").unwrap_or("");
        let value = c
            .get("value")
            .map(string)
            .unwrap_or_else(|| "undefined".into());
        out.push(json!({ "key": format!("{attribute}{op}{value}"), "label": format!("{} {} {value}", attribute.replace('_', " "), op_symbol(op)) }));
    }
    out
}

fn cell_value(cell: &Value) -> Value {
    cell.get("value").cloned().unwrap_or(Value::Null)
}

/// A spec row that shows what a criterion row already shows (same label, or the same values in every cell) is noise.
fn drop_repeated_specs(rows: Vec<&Value>) -> Vec<&Value> {
    let criteria: Vec<&Value> = rows
        .iter()
        .copied()
        .filter(|r| text(r, "kind") == Some("criterion"))
        .collect();
    let same = |a: &Value, b: &Value| {
        let (ca, cb) = (list(a, "cells"), list(b, "cells"));
        ca.len() == cb.len()
            && ca
                .iter()
                .zip(cb)
                .all(|(x, y)| !cell_value(x).is_null() && cell_value(x) == cell_value(y))
    };
    rows.into_iter()
        .filter(|r| {
            text(r, "kind") != Some("spec")
                || !criteria.iter().any(|c| {
                    text(c, "label").unwrap_or("").to_lowercase()
                        == text(r, "label").unwrap_or("").to_lowercase()
                        || same(r, c)
                })
        })
        .collect()
}

/// The comparison as the table component takes it: the price goes into the header, not a row.
/// `images` maps a product id to its picture, when it has one.
pub fn compare_view(c: &Value, images: &Value) -> Value {
    let columns: Vec<Value> = list(c, "columns")
        .iter()
        .map(|col| {
            let id = text(col, "product_id").unwrap_or("");
            json!({
                "id": id,
                "title": col.get("title").cloned().unwrap_or(Value::Null),
                "priceText": num(col, "price_cents").map(format_cents),
                "score": col.get("score").cloned().unwrap_or(Value::Null),
                "imageUri": images.get(id).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    let rows: Vec<&Value> = list(c, "rows")
        .iter()
        .filter(|r| text(r, "kind") != Some("price"))
        .collect();
    let rows: Vec<Value> = drop_repeated_specs(rows)
        .into_iter()
        .map(|r| {
            let mut row = Map::new();
            row.insert("key".into(), r.get("key").cloned().unwrap_or(Value::Null));
            row.insert(
                "label".into(),
                r.get("label").cloned().unwrap_or(Value::Null),
            );
            if let Some(g) = r.get("group") {
                row.insert("group".into(), g.clone());
            }
            let cells: Vec<Value> = list(r, "cells")
                .iter()
                .map(|cell| {
                    let mut o = Map::new();
                    o.insert("value".into(), cell_value(cell));
                    if let Some(b) = cell.get("best") {
                        o.insert("best".into(), b.clone());
                    }
                    Value::Object(o)
                })
                .collect();
            row.insert("cells".into(), Value::Array(cells));
            Value::Object(row)
        })
        .collect();
    json!({ "columns": columns, "rows": rows })
}

/// "Understood 3 conditions · budget 700 €": one line about what the query was taken to mean.
pub fn understood_line(parsed: &Value) -> Option<String> {
    let n = usize::from(max_price(parsed).is_some()) + list(parsed, "constraints").len();
    if n == 0 {
        return None;
    }
    let budget = max_price(parsed)
        .map(|p| format!(" · budget {}", without_zero_cents(p)))
        .unwrap_or_default();
    Some(format!(
        "Understood {n} {}{budget}",
        if n == 1 { "condition" } else { "conditions" }
    ))
}

/// The result that saves the most a month against what the person pays now, if any saves anything.
pub fn best_saving(items: &[Value]) -> Option<Value> {
    let mut best: Option<&Value> = None;
    for it in items {
        let per_month = it.get("saving").and_then(|s| num(s, "per_month_cents"));
        if let Some(p) = per_month.filter(|p| *p > 0.0) {
            let beats = best.is_none_or(|b| {
                p > b
                    .get("saving")
                    .and_then(|s| num(s, "per_month_cents"))
                    .unwrap_or(0.0)
            });
            if beats {
                best = Some(it);
            }
        }
    }
    let b = best?;
    let s = b.get("saving")?;
    Some(json!({
        "perMonthCents": s.get("per_month_cents").cloned().unwrap_or(Value::Null),
        "overHorizonCents": s.get("over_horizon_cents").cloned().unwrap_or(Value::Null),
        "current": s.get("current").cloned().unwrap_or(Value::Null),
        "title": b.get("product").and_then(|p| p.get("title")).cloned().unwrap_or(Value::Null),
    }))
}

/// The saving as a share (0..1) of what the person pays now, when that is known.
pub fn saving_share(per_month_cents: f64, current_monthly_cents: Option<f64>) -> Option<f64> {
    let current = current_monthly_cents.filter(|c| *c > 0.0)?;
    Some((per_month_cents / current).clamp(0.0, 1.0))
}

/// Round budgets to offer as quick choices (euros).
pub fn budget_presets(kind: Option<&str>) -> Vec<i64> {
    if kind == Some("subscription") {
        vec![10, 20, 30, 50]
    } else {
        vec![300, 500, 700, 1000]
    }
}

fn category_of(d: &Value) -> String {
    d.get("product")
        .and_then(|p| text(p, "category"))
        .unwrap_or("")
        .to_string()
}

fn deal_pct(d: &Value) -> f64 {
    d.get("deal")
        .and_then(|x| num(x, "discount_pct"))
        .unwrap_or(f64::NAN)
}

/// "All", "15 % off or more" and one entry per category that has deals (most deals first).
pub fn deal_filters(deals: &[Value]) -> Vec<Value> {
    let mut counts: Vec<(String, usize)> = vec![];
    for d in deals {
        let c = category_of(d);
        match counts.iter_mut().find(|(k, _)| *k == c) {
            Some((_, n)) => *n += 1,
            None => counts.push((c, 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let mut out = vec![json!({ "key": "all", "label": "All deals" })];
    if deals.iter().any(|d| deal_pct(d) >= BIG_DEAL_PCT) {
        out.push(
            json!({ "key": "big", "label": format!("{} % off or more", BIG_DEAL_PCT as i64) }),
        );
    }
    if counts.len() > 1 {
        for (c, _) in &counts {
            out.push(json!({ "key": format!("category:{c}"), "label": c.replace('_', " ") }));
        }
    }
    out
}

pub fn filter_deals(deals: &[Value], filter: &str) -> Vec<Value> {
    match filter {
        "all" => deals.to_vec(),
        "big" => deals
            .iter()
            .filter(|d| deal_pct(d) >= BIG_DEAL_PCT)
            .cloned()
            .collect(),
        other => {
            let cat = other.strip_prefix("category:").unwrap_or("");
            deals
                .iter()
                .filter(|d| category_of(d) == cat)
                .cloned()
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(price: Option<i64>, discount: Option<f64>, saving: Option<i64>) -> Value {
        json!({
            "product": { "title": "T", "category": "phone", "offers": [{ "url": "u", "price_cents": price }] },
            "ranked": { "price_cents": price, "url": "u" },
            "deal": discount.map(|d| json!({ "discount_pct": d })),
            "saving": saving.map(|s| json!({ "per_month_cents": s, "over_horizon_cents": s * 24, "current": null })),
        })
    }

    #[test]
    fn results_sort_by_price_or_discount_and_keep_the_server_order_for_best() {
        let items = [
            item(Some(300), Some(5.0), None),
            item(None, Some(30.0), None),
            item(Some(100), None, None),
        ];
        let prices: Vec<_> = sort_items(&items, "price")
            .iter()
            .map(|i| i["ranked"]["price_cents"].clone())
            .collect();
        assert_eq!(prices, [json!(100), json!(300), Value::Null]);
        assert_eq!(sort_items(&items, "deal")[0]["deal"]["discount_pct"], 30.0);
        assert_eq!(sort_items(&items, "best"), items.to_vec());
    }

    #[test]
    fn the_query_chips_say_what_was_understood() {
        let parsed = json!({ "max_price_cents": 60000, "constraints": [{ "attribute": "ram_gb", "op": "gte", "value": 8 }] });
        let chips = understood(&parsed);
        assert_eq!(chips[0], json!({ "key": "price", "label": "under 600 €" }));
        assert_eq!(
            chips[1],
            json!({ "key": "ram_gbgte8", "label": "ram gb ≥ 8" })
        );
        assert_eq!(
            understood_line(&parsed).as_deref(),
            Some("Understood 2 conditions · budget 600 €")
        );
        assert_eq!(
            understood_line(&json!({ "max_price_cents": null, "constraints": [] })),
            None
        );
    }

    #[test]
    fn savings_pick_the_best_and_share_is_clamped() {
        let items = [
            item(Some(1), None, Some(300)),
            item(Some(2), None, Some(500)),
            item(Some(3), None, Some(-100)),
        ];
        assert_eq!(best_saving(&items).unwrap()["perMonthCents"], 500);
        assert_eq!(saving_share(500.0, Some(1000.0)), Some(0.5));
        assert_eq!(saving_share(5000.0, Some(1000.0)), Some(1.0));
        assert_eq!(saving_share(5.0, None), None);
        assert_eq!(budget_presets(Some("subscription")), [10, 20, 30, 50]);
    }

    #[test]
    fn the_comparison_drops_prices_and_repeated_specs() {
        let c = json!({
            "columns": [{ "product_id": "a", "title": "A", "price_cents": 12345, "score": 0.9 }],
            "rows": [
                { "key": "price", "kind": "price", "label": "Price", "cells": [{ "value": "1" }] },
                { "key": "cam", "kind": "criterion", "label": "Camera", "cells": [{ "value": "50 MP", "best": true }] },
                { "key": "camera", "kind": "spec", "label": "camera", "cells": [{ "value": "50 MP" }] },
                { "key": "ram", "kind": "spec", "label": "RAM", "cells": [{ "value": "8 GB" }] },
            ],
        });
        let v = compare_view(&c, &json!({ "a": "img" }));
        assert_eq!(v["columns"][0]["priceText"], "123,45 €");
        assert_eq!(v["columns"][0]["imageUri"], "img");
        let keys: Vec<_> = v["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["key"].as_str().unwrap())
            .collect();
        assert_eq!(keys, ["cam", "ram"]);
    }

    #[test]
    fn deal_filters_list_categories_when_there_are_several() {
        let deal = |cat: &str, pct: f64| json!({ "product": { "category": cat }, "deal": { "discount_pct": pct } });
        let deals = [deal("phone", 20.0), deal("phone", 5.0), deal("laptop", 1.0)];
        let keys: Vec<_> = deal_filters(&deals)
            .iter()
            .map(|f| f["key"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(keys, ["all", "big", "category:phone", "category:laptop"]);
        assert_eq!(filter_deals(&deals, "big").len(), 1);
        assert_eq!(filter_deals(&deals, "category:phone").len(), 2);
    }
}
