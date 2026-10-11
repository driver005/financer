//! Ranks recipes by how much of them you already buy, what is on offer, and what the rest costs.

use std::collections::HashSet;

use financer_core::{Catalog, Money, PriceQuote};
use serde::Serialize;

use crate::Recipe;

pub struct MatchInput<'a> {
    /// Generic-item keys you normally buy.
    pub usual: &'a HashSet<String>,
    /// Keys currently on offer somewhere.
    pub on_offer: &'a HashSet<String>,
    pub quotes: &'a [PriceQuote],
    /// Hide recipes whose missing ingredients cost more than this.
    pub budget: Option<Money>,
    /// Only recipes carrying this tag (e.g. `vegetarisch`).
    pub tag: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecipeMatch {
    pub recipe: Recipe,
    pub have: Vec<String>,
    pub missing: Vec<String>,
    /// Missing ingredients that are on offer right now.
    pub on_offer: Vec<String>,
    /// Cheapest full-pack price of each missing ingredient that has a quote, summed. A pack
    /// is usually more than one recipe needs, so this is what you would pay at the till.
    pub missing_cost: Money,
    /// Missing ingredients with no known price.
    pub unpriced: Vec<String>,
    /// Share of the non-pantry ingredients you already buy, 0 to 100.
    pub coverage_percent: u32,
}

/// Ranks recipes against what the user buys, what is on offer and what the rest costs.
pub struct RecipeMatcher;

impl RecipeMatcher {
    fn is_pantry(key: &str) -> bool {
        Catalog::by_key(key).is_some_and(|i| i.pantry)
    }

    fn cheapest(quotes: &[PriceQuote], item: &str) -> Option<Money> {
        quotes
            .iter()
            .filter(|q| q.item == item)
            .map(|q| q.price)
            .min()
    }

    pub fn rank_recipes(recipes: &[Recipe], input: &MatchInput<'_>) -> Vec<RecipeMatch> {
        let mut out: Vec<RecipeMatch> = recipes
            .iter()
            .filter(|r| input.tag.is_none_or(|t| r.tags.iter().any(|x| x == t)))
            .filter_map(|r| {
                let needed: Vec<&str> = r
                    .ingredients
                    .iter()
                    .map(|i| i.item.as_str())
                    .filter(|k| !Self::is_pantry(k))
                    .collect();
                if needed.is_empty() {
                    return None;
                }
                let (have, missing): (Vec<&str>, Vec<&str>) = needed
                    .iter()
                    .copied()
                    .partition(|k| input.usual.contains(*k));

                let mut missing_cost = Money::ZERO;
                let mut unpriced = Vec::new();
                for k in &missing {
                    match Self::cheapest(input.quotes, k) {
                        Some(p) => missing_cost += p,
                        None => unpriced.push(k.to_string()),
                    }
                }
                if input.budget.is_some_and(|b| missing_cost > b) {
                    return None;
                }
                Some(RecipeMatch {
                    recipe: r.clone(),
                    coverage_percent: (have.len() * 100 / needed.len()) as u32,
                    on_offer: missing
                        .iter()
                        .filter(|k| input.on_offer.contains(**k))
                        .map(|k| k.to_string())
                        .collect(),
                    have: have.iter().map(|k| k.to_string()).collect(),
                    missing: missing.iter().map(|k| k.to_string()).collect(),
                    missing_cost,
                    unpriced,
                })
            })
            .collect();

        out.sort_by(|a, b| {
            b.coverage_percent
                .cmp(&a.coverage_percent)
                .then(b.on_offer.len().cmp(&a.on_offer.len()))
                .then(a.missing_cost.cmp(&b.missing_cost))
                .then(a.recipe.minutes.cmp(&b.recipe.minutes))
                .then(a.recipe.id.cmp(&b.recipe.id))
        });
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Ingredient;
    use financer_core::Chain;

    struct Fixtures;

    impl Fixtures {
        fn set(items: &[&str]) -> HashSet<String> {
            items.iter().map(|s| s.to_string()).collect()
        }

        fn quote(item: &str, cents: i64) -> PriceQuote {
            PriceQuote {
                item: item.into(),
                chain: Chain::Aldi,
                price: Money::from_cents(cents),
                valid_until: None,
                is_offer: false,
            }
        }

        fn recipe(id: &str, items: &[&str], minutes: u32) -> Recipe {
            Recipe {
                id: id.into(),
                title: id.into(),
                minutes,
                servings: 2,
                tags: vec!["vegetarisch".into()],
                ingredients: items
                    .iter()
                    .map(|i| Ingredient {
                        item: i.to_string(),
                        amount: "1".into(),
                    })
                    .collect(),
                steps: vec!["kochen".into()],
            }
        }
    }

    #[test]
    fn ranks_by_coverage_and_ignores_pantry_items() {
        let recipes = vec![
            Fixtures::recipe("a", &["nudeln", "tomaten-passiert", "salz", "oel"], 20),
            Fixtures::recipe("b", &["reis", "paprika", "mais", "salz"], 20),
        ];
        let usual = Fixtures::set(&["nudeln", "tomaten-passiert"]);
        let none = HashSet::new();
        let input = MatchInput {
            usual: &usual,
            on_offer: &none,
            quotes: &[],
            budget: None,
            tag: None,
        };
        let ranked = RecipeMatcher::rank_recipes(&recipes, &input);
        assert_eq!(ranked[0].recipe.id, "a");
        assert_eq!(ranked[0].coverage_percent, 100); // salz and oel are pantry, not "missing"
        assert!(ranked[0].missing.is_empty());
        assert_eq!(ranked[1].coverage_percent, 0);
        assert_eq!(ranked[1].missing, vec!["reis", "paprika", "mais"]);
    }

    #[test]
    fn prices_missing_items_and_reports_unpriced_ones() {
        let recipes = vec![Fixtures::recipe("b", &["reis", "paprika", "mais"], 20)];
        let usual = Fixtures::set(&["reis"]);
        let none = HashSet::new();
        let quotes = vec![
            Fixtures::quote("paprika", 199),
            Fixtures::quote("paprika", 149),
            Fixtures::quote("reis", 99),
        ];
        let input = MatchInput {
            usual: &usual,
            on_offer: &none,
            quotes: &quotes,
            budget: None,
            tag: None,
        };
        let r = &RecipeMatcher::rank_recipes(&recipes, &input)[0];
        assert_eq!(r.missing_cost, Money::from_cents(149)); // cheapest paprika
        assert_eq!(r.unpriced, vec!["mais"]);
    }

    #[test]
    fn budget_and_tag_filter() {
        let mut vegan = Fixtures::recipe("v", &["linsen"], 30);
        vegan.tags = vec!["vegan".into()];
        let recipes = vec![Fixtures::recipe("a", &["tofu"], 10), vegan];
        let none = HashSet::new();
        let quotes = vec![Fixtures::quote("tofu", 250), Fixtures::quote("linsen", 150)];

        let input = MatchInput {
            usual: &none,
            on_offer: &none,
            quotes: &quotes,
            budget: Some(Money::from_cents(200)),
            tag: None,
        };
        let ids: Vec<_> = RecipeMatcher::rank_recipes(&recipes, &input)
            .iter()
            .map(|r| r.recipe.id.clone())
            .collect();
        assert_eq!(ids, vec!["v"]); // tofu recipe costs 2.50 > 2.00

        let input = MatchInput {
            usual: &none,
            on_offer: &none,
            quotes: &quotes,
            budget: None,
            tag: Some("vegan"),
        };
        assert_eq!(RecipeMatcher::rank_recipes(&recipes, &input).len(), 1);
    }

    #[test]
    fn offers_break_ties() {
        let recipes = vec![
            Fixtures::recipe("a", &["tofu"], 10),
            Fixtures::recipe("b", &["lachs"], 10),
        ];
        let none = HashSet::new();
        let offer = Fixtures::set(&["lachs"]);
        let input = MatchInput {
            usual: &none,
            on_offer: &offer,
            quotes: &[],
            budget: None,
            tag: None,
        };
        assert_eq!(
            RecipeMatcher::rank_recipes(&recipes, &input)[0].recipe.id,
            "b"
        );
    }

    #[test]
    fn works_on_the_bundled_dataset() {
        let usual = Fixtures::set(&["nudeln", "tomaten-passiert", "zwiebeln", "knoblauch"]);
        let none = HashSet::new();
        let input = MatchInput {
            usual: &usual,
            on_offer: &none,
            quotes: &[],
            budget: None,
            tag: None,
        };
        let ranked = RecipeMatcher::rank_recipes(Recipe::bundled(), &input);
        assert_eq!(ranked[0].recipe.id, "spaghetti-tomatensosse");
        assert_eq!(ranked[0].coverage_percent, 100);
    }
}
