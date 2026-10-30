//! Side-by-side comparison of chosen products.

use serde::{Deserialize, Serialize};

use crate::product::Product;
use crate::rank::{Context, Profile, Ranker};
use crate::schema::CategorySchema;
use crate::value::fmt_num;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompareColumn {
    pub product_id: String,
    pub title: String,
    pub brand: Option<String>,
    pub price_cents: Option<i64>,
    pub shop: Option<String>,
    pub score: f64,
    pub confidence: f64,
    pub tier: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RowKind {
    Price,
    Criterion,
    Spec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompareCell {
    pub value: Option<String>,
    pub score: Option<f64>,
    /// The best of the row (only marked when the products differ).
    pub best: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompareRow {
    pub key: String,
    pub label: String,
    pub group: Option<String>,
    pub kind: RowKind,
    pub weight: f64,
    pub cells: Vec<CompareCell>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Comparison {
    pub category: String,
    pub columns: Vec<CompareColumn>,
    pub rows: Vec<CompareRow>,
    pub winner: Option<String>,
}

/// Compare `products` in the order given. Requirements in the profile (price limit, constraints)
/// do not hide a product you asked to see; its weights and preferences still apply.
pub fn compare(
    schema: &CategorySchema,
    products: &[Product],
    universe: &[Product],
    profile: &Profile,
    ctx: &Context<'_>,
) -> Comparison {
    let lenient = Profile {
        constraints: Vec::new(),
        max_price_cents: None,
        in_stock_only: false,
        conditions: Vec::new(),
        exclude_brands: Vec::new(),
        ..profile.clone()
    };
    let ranking = Ranker::rank_in(schema, products, universe, &lenient, ctx);
    let ranked = |p: &Product| ranking.items.iter().find(|r| r.product_id == p.id);

    let columns: Vec<CompareColumn> = products
        .iter()
        .map(|p| {
            let r = ranked(p);
            CompareColumn {
                product_id: p.id.clone(),
                title: p.title.clone(),
                brand: p.brand.clone(),
                price_cents: r.and_then(|r| r.price_cents),
                shop: r.and_then(|r| r.shop.clone()),
                score: r.map_or(0.0, |r| r.score),
                confidence: r.map_or(0.0, |r| r.confidence),
                tier: r.and_then(|r| r.tier.clone()),
            }
        })
        .collect();

    let mut rows = vec![CompareRow {
        key: "price".into(),
        label: "Price".into(),
        group: Some("cost".into()),
        kind: RowKind::Price,
        weight: 0.0,
        cells: columns
            .iter()
            .map(|c| CompareCell {
                value: c
                    .price_cents
                    .map(|p| format!("{},{:02} EUR", p / 100, p % 100)),
                score: None,
                best: false,
            })
            .collect(),
    }];
    mark_best_price(&mut rows[0], &columns);

    let mut first_seen: Vec<(String, String, Option<String>, f64)> = Vec::new();
    for r in &ranking.items {
        for b in &r.breakdown {
            if b.key != "price" && !first_seen.iter().any(|(k, ..)| *k == b.key) {
                first_seen.push((b.key.clone(), b.label.clone(), b.group.clone(), b.weight));
            }
        }
    }
    for (key, label, group, weight) in first_seen {
        let cells: Vec<CompareCell> = products
            .iter()
            .map(|p| {
                let b = ranked(p).and_then(|r| r.breakdown.iter().find(|b| b.key == key));
                CompareCell {
                    value: b.and_then(|b| b.value.clone()),
                    score: b.and_then(|b| b.score),
                    best: false,
                }
            })
            .collect();
        let mut row = CompareRow {
            key,
            label,
            group,
            kind: RowKind::Criterion,
            weight,
            cells,
        };
        mark_best_score(&mut row);
        rows.push(row);
    }

    // every other spec any product has, defined by the schema or not
    let mut spec_keys: Vec<String> = schema.attributes.iter().map(|a| a.key.clone()).collect();
    for p in products {
        for k in p.attributes.keys() {
            if !spec_keys.contains(k) {
                spec_keys.push(k.clone());
            }
        }
    }
    for key in spec_keys {
        if rows.iter().any(|r| r.key == key)
            || products.iter().all(|p| !p.attributes.contains_key(&key))
        {
            continue;
        }
        let def = schema.attribute(&key);
        rows.push(CompareRow {
            label: def.map_or_else(|| key.replace('_', " "), |d| d.label.clone()),
            key: key.clone(),
            group: Some("specs".into()),
            kind: RowKind::Spec,
            weight: 0.0,
            cells: products
                .iter()
                .map(|p| CompareCell {
                    value: p.attributes.get(&key).map(|v| match (def, v) {
                        (Some(d), v) => d.display(v),
                        (None, crate::value::AttrValue::Num(n)) => fmt_num(*n),
                        (None, v) => v.to_string(),
                    }),
                    score: None,
                    best: false,
                })
                .collect(),
        });
    }

    let winner = columns
        .iter()
        .filter(|c| c.price_cents.is_some() || c.score > 0.0)
        .max_by(|a, b| a.score.total_cmp(&b.score))
        .map(|c| c.product_id.clone());
    Comparison {
        category: schema.id.clone(),
        columns,
        rows,
        winner,
    }
}

fn mark_best_price(row: &mut CompareRow, columns: &[CompareColumn]) {
    let prices: Vec<Option<i64>> = columns.iter().map(|c| c.price_cents).collect();
    let Some(min) = prices.iter().flatten().min().copied() else {
        return;
    };
    if prices.iter().flatten().any(|p| *p != min) {
        for (cell, p) in row.cells.iter_mut().zip(prices) {
            cell.best = p == Some(min);
        }
    }
}

fn mark_best_score(row: &mut CompareRow) {
    let scores: Vec<Option<f64>> = row.cells.iter().map(|c| c.score).collect();
    let Some(max) = scores.iter().flatten().copied().max_by(f64::total_cmp) else {
        return;
    };
    if scores.iter().flatten().any(|s| (*s - max).abs() > 1e-9) {
        for (cell, s) in row.cells.iter_mut().zip(scores) {
            cell.best = s.is_some_and(|s| (s - max).abs() <= 1e-9);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::product::Offer;
    use crate::schema::Registry;
    use crate::value::AttrValue;

    fn phone(name: &str, price: i64, battery: f64, extra: Option<(&str, AttrValue)>) -> Product {
        let mut p = Product::new("smartphone", name)
            .with_offer(Offer::one_time("s", "u", price))
            .with("battery_mah", battery)
            .with("nfc", true);
        if let Some((k, v)) = extra {
            p.attributes.insert(k.into(), v);
        }
        p
    }

    #[test]
    fn rows_show_price_criteria_and_every_spec_with_the_best_marked() {
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        let a = phone(
            "A",
            50_000,
            5000.0,
            Some(("my_note", "friend has it".into())),
        );
        let b = phone("B", 70_000, 4000.0, None);
        let c = compare(
            &schema,
            &[a, b],
            &[],
            &Profile::default(),
            &Context::at(1_790_000_000),
        );

        assert_eq!(c.columns.len(), 2);
        let price = &c.rows[0];
        assert_eq!(
            (
                price.kind,
                price.cells[0].value.as_deref(),
                price.cells[0].best,
                price.cells[1].best
            ),
            (RowKind::Price, Some("500,00 EUR"), true, false)
        );
        let battery = c.rows.iter().find(|r| r.key == "battery").unwrap();
        assert_eq!(battery.kind, RowKind::Criterion);
        assert_eq!(battery.cells[0].value.as_deref(), Some("5000 mAh"));
        assert!(battery.cells[0].best && !battery.cells[1].best);
        // a spec that is no criterion still shows, labelled by the schema; unknown ones by key
        let nfc = c.rows.iter().find(|r| r.key == "nfc").unwrap();
        assert_eq!(
            (nfc.kind, nfc.label.as_str(), nfc.cells[0].value.as_deref()),
            (RowKind::Spec, "NFC", Some("yes"))
        );
        let note = c.rows.iter().find(|r| r.key == "my_note").unwrap();
        assert_eq!(
            (note.label.as_str(), note.cells[1].value.clone()),
            ("my note", None)
        );
        assert_eq!(c.winner.as_deref(), Some("smartphone:a"));
    }

    #[test]
    fn requirements_do_not_hide_a_product_you_asked_for() {
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        let profile = Profile {
            max_price_cents: Some(10_000),
            ..Profile::default()
        };
        let c = compare(
            &schema,
            &[phone("A", 50_000, 5000.0, None)],
            &[],
            &profile,
            &Context::at(0),
        );
        assert_eq!(c.columns[0].price_cents, Some(50_000));
    }
}
