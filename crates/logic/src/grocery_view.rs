//! What the grocery screens look like, as rules: which tone a chain or meal avatar takes, the price
//! comparison per item, the "who is cheapest overall" summary, and the cost per serving of a recipe.
//! Money stays integer cents. Price rows travel as the server's own JSON.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::Value;

use crate::format::format_cents;

pub const MEAL_TONES: [&str; 6] = ["accent", "info", "warning", "success", "danger", "neutral"];

/// A small stable number for a text (FNV-1a over its UTF-16 units), used to pick a colour.
pub fn hash_text(text: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for unit in text.encode_utf16() {
        h ^= u32::from(unit);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

pub fn meal_tone(seed: &str) -> &'static str {
    MEAL_TONES[hash_text(seed) as usize % MEAL_TONES.len()]
}

pub fn chain_tone(chain: &str) -> &'static str {
    match chain.to_lowercase().as_str() {
        "aldi" => "info",
        "lidl" => "warning",
        "kaufland" | "rewe" => "danger",
        _ => meal_tone(chain),
    }
}

/// Letter on an avatar: the first letter of the first word.
pub fn initials(name: &str) -> String {
    name.split_whitespace()
        .next()
        .and_then(|w| w.chars().next())
        .map_or("?".into(), |c| c.to_uppercase().collect())
}

fn cents(p: &Value) -> i64 {
    p.get("price_cents").and_then(Value::as_i64).unwrap_or(0)
}

fn chain(p: &Value) -> &str {
    p.get("chain").and_then(Value::as_str).unwrap_or("")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceRow {
    pub price: Value,
    /// Cheapest price of the item (ties count as cheapest too, as long as chains compete).
    pub is_cheapest: bool,
    /// Cents more than the cheapest; 0 for the cheapest.
    pub extra_cents: i64,
}

/// Rows of one item, cheapest first. Nobody is "cheapest" when only one chain has a price.
pub fn rank_prices(prices: &[Value]) -> Vec<PriceRow> {
    let mut sorted = prices.to_vec();
    sorted.sort_by_key(cents); // stable, as the original sort was
    let best = sorted.first().map_or(0, cents);
    let competing = sorted.iter().map(chain).collect::<BTreeSet<_>>().len() > 1;
    sorted
        .into_iter()
        .map(|p| PriceRow {
            is_cheapest: competing && cents(&p) == best,
            extra_cents: cents(&p) - best,
            price: p,
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Saving {
    pub cents: i64,
    pub versus: Option<String>,
}

/// What picking the cheapest chain saves over the dearest one for one item (0 with one chain).
pub fn item_saving(prices: &[Value]) -> Saving {
    if prices.iter().map(chain).collect::<BTreeSet<_>>().len() < 2 {
        return Saving {
            cents: 0,
            versus: None,
        };
    }
    let mut sorted = prices.to_vec();
    sorted.sort_by_key(cents);
    let (low, high) = (&sorted[0], &sorted[sorted.len() - 1]);
    let c = cents(high) - cents(low);
    Saving {
        cents: c,
        versus: (c > 0).then(|| chain(high).to_string()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Win {
    pub chain: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceSummary {
    /// Number of items that are priced at two or more chains.
    pub compared: i64,
    /// Chains by how many of those items they win (ties count for each), most first.
    pub wins: Vec<Win>,
    /// The best chain, when one is ahead of the rest.
    pub leader: Option<Win>,
    /// The chains at the top of `wins`: one when there is a leader, several on a tie.
    pub top: Vec<String>,
    /// Sum over the items of dearest minus cheapest: what you keep by choosing well.
    pub saving_cents: i64,
}

pub fn summarize_prices(groups: &[Vec<Value>]) -> PriceSummary {
    let mut count: BTreeMap<String, i64> = BTreeMap::new();
    let (mut compared, mut saving_cents) = (0, 0);
    for prices in groups {
        let rows = rank_prices(prices);
        if !rows.iter().any(|r| r.is_cheapest) {
            continue;
        }
        compared += 1;
        saving_cents += item_saving(prices).cents;
        let winners: BTreeSet<&str> = rows
            .iter()
            .filter(|r| r.is_cheapest)
            .map(|r| chain(&r.price))
            .collect();
        for w in winners {
            *count.entry(w.to_string()).or_insert(0) += 1;
        }
    }
    let mut wins: Vec<Win> = count
        .into_iter()
        .map(|(chain, count)| Win { chain, count })
        .collect();
    wins.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.chain.cmp(&b.chain)));
    let leader = (!wins.is_empty() && (wins.len() == 1 || wins[0].count > wins[1].count))
        .then(|| wins[0].clone());
    let top = wins.first().map_or(vec![], |f| {
        wins.iter()
            .filter(|w| w.count == f.count)
            .map(|w| w.chain.clone())
            .collect()
    });
    PriceSummary {
        compared,
        wins,
        leader,
        top,
        saving_cents,
    }
}

/// `+0,06 €` for a dearer chain, nothing for the cheapest.
pub fn extra_text(extra_cents: i64) -> String {
    if extra_cents > 0 {
        format!("+{}", format_cents(extra_cents))
    } else {
        String::new()
    }
}

/// Cost of the missing, priced ingredients per serving (rounded to a cent); none when nothing is missing.
pub fn cost_per_serving(missing_cost_cents: i64, servings: i64, missing: usize) -> Option<i64> {
    (missing > 0 && servings > 0)
        .then(|| ((missing_cost_cents as f64 / servings as f64) + 0.5).floor() as i64)
}

/// How good a match is: 75+ high, 40+ middle, below that low.
pub fn match_tone(percent: f64) -> &'static str {
    if percent >= 75.0 {
        "high"
    } else if percent >= 40.0 {
        "mid"
    } else {
        "low"
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Shortened {
    pub shown: Vec<String>,
    pub more: usize,
}

/// `3 more` for the tail of a list that is cut after `max` names.
pub fn short_list(names: &[String], max: usize) -> Shortened {
    Shortened {
        shown: names.iter().take(max).cloned().collect(),
        more: names.len().saturating_sub(max),
    }
}

/// Shopping list progress as a whole percent, 0 for an empty list.
pub fn percent_done(done: i64, total: i64) -> i64 {
    if total > 0 {
        ((done as f64 / total as f64) * 100.0 + 0.5).floor() as i64
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn p(chain: &str, cents: i64) -> Value {
        json!({ "chain": chain, "price_cents": cents, "item": "milk" })
    }

    #[test]
    fn a_text_always_gets_the_same_tone() {
        assert_eq!(hash_text(""), 0x811c_9dc5);
        assert_eq!(hash_text("a"), 0xe40c_292c);
        assert_eq!(hash_text("pfannkuchen"), hash_text("pfannkuchen"));
        assert!(MEAL_TONES.contains(&meal_tone("Pasta")));
        assert_eq!(
            (chain_tone("Aldi"), chain_tone("LIDL"), chain_tone("rewe")),
            ("info", "warning", "danger")
        );
        assert_eq!(chain_tone("unknown"), meal_tone("unknown"));
        assert_eq!(
            (
                initials("  spaghetti bolognese"),
                initials("ärmel"),
                initials("   ")
            ),
            ("S".to_string(), "Ä".to_string(), "?".to_string())
        );
    }

    #[test]
    fn prices_of_one_item_are_ranked_cheapest_first() {
        let rows = rank_prices(&[p("lidl", 120), p("aldi", 100), p("rewe", 100)]);
        assert_eq!(
            rows.iter()
                .map(|r| r.price["chain"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["aldi", "rewe", "lidl"]
        );
        assert_eq!(
            rows.iter().map(|r| r.is_cheapest).collect::<Vec<_>>(),
            [true, true, false]
        );
        assert_eq!(rows[2].extra_cents, 20);
        assert!(
            rank_prices(&[p("lidl", 100)])
                .iter()
                .all(|r| !r.is_cheapest),
            "one chain: nobody is cheapest"
        );
        assert_eq!(
            rows[0].price["item"], "milk",
            "every field of the server's row survives"
        );
    }

    #[test]
    fn what_choosing_well_saves() {
        assert_eq!(
            item_saving(&[p("lidl", 100)]),
            Saving {
                cents: 0,
                versus: None
            }
        );
        assert_eq!(
            item_saving(&[p("lidl", 100), p("aldi", 130)]),
            Saving {
                cents: 30,
                versus: Some("aldi".into())
            }
        );
        assert_eq!(
            item_saving(&[p("lidl", 100), p("aldi", 100)]),
            Saving {
                cents: 0,
                versus: None
            }
        );
    }

    #[test]
    fn the_summary_names_a_leader_or_a_tie() {
        let s = summarize_prices(&[
            vec![p("aldi", 90), p("lidl", 100)],
            vec![p("aldi", 50), p("rewe", 80)],
            vec![p("lidl", 10)],
        ]);
        assert_eq!((s.compared, s.saving_cents), (2, 40));
        assert_eq!(
            s.leader,
            Some(Win {
                chain: "aldi".into(),
                count: 2
            })
        );
        assert_eq!(s.top, ["aldi"]);
        let tie = summarize_prices(&[
            vec![p("aldi", 90), p("lidl", 100)],
            vec![p("lidl", 50), p("rewe", 80)],
        ]);
        assert_eq!(tie.leader, None);
        assert_eq!(tie.top, ["aldi", "lidl"]);
        let none = summarize_prices(&[]);
        assert_eq!((none.compared, none.leader, none.top.len()), (0, None, 0));
    }

    #[test]
    fn small_helpers_word_and_round() {
        assert_eq!(extra_text(6), "+0,06 €");
        assert_eq!(extra_text(0), "");
        assert_eq!(cost_per_serving(1000, 3, 2), Some(333));
        assert_eq!(cost_per_serving(1000, 3, 0), None);
        assert_eq!(cost_per_serving(1000, 0, 2), None);
        assert_eq!(
            (match_tone(80.0), match_tone(40.0), match_tone(39.9)),
            ("high", "mid", "low")
        );
        let l = short_list(&["a".into(), "b".into(), "c".into(), "d".into()], 2);
        assert_eq!(
            (l.shown, l.more),
            (vec!["a".to_string(), "b".to_string()], 2)
        );
        assert_eq!(
            (percent_done(1, 3), percent_done(2, 3), percent_done(0, 0)),
            (33, 67, 0)
        );
    }
}
