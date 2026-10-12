//! From planned meals to a shopping list: ingredient amounts are scaled to the planned servings,
//! converted to the item's base unit and added up, items from the pantry list are dropped, and
//! what is left is priced with the basket planner.

use std::collections::{BTreeMap, HashSet};

use financer_core::{
    BasketItem, BasketPlanner, Catalog, ChainBasket, Money, PriceQuote, ShoppingPlan,
};

use crate::amount::Amount;
use crate::Recipe;

/// One ingredient of a planned meal. `item` is a catalog key when known; otherwise the name is
/// matched against the catalog (ideas from the language model only come with names).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MealIngredient {
    pub item: Option<String>,
    pub name: String,
    pub amount: String,
}

/// A meal on the plan: what the ingredient amounts are written for, and what is planned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedMeal {
    pub title: String,
    /// Servings planned.
    pub servings: u32,
    /// Servings the ingredient amounts are for.
    pub base_servings: u32,
    pub ingredients: Vec<MealIngredient>,
}

impl PlannedMeal {
    pub fn from_recipe(recipe: &Recipe, servings: u32) -> PlannedMeal {
        PlannedMeal {
            title: recipe.title.clone(),
            servings,
            base_servings: recipe.servings,
            ingredients: recipe
                .ingredients
                .iter()
                .map(|i| MealIngredient {
                    item: Some(i.item.clone()),
                    name: Catalog::by_key(&i.item)
                        .map(|c| c.name_de.to_string())
                        .unwrap_or_else(|| i.item.clone()),
                    amount: i.amount.clone(),
                })
                .collect(),
        }
    }
}

/// An item to buy: how much the plan needs, and how many reference packs that is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShoppingLine {
    /// Catalog key.
    pub item: String,
    /// Needed amount in thousandths of the item's base unit.
    pub needed_milli: u64,
    /// Whole reference packs to buy (at least one).
    pub packs: u32,
    /// Titles of the meals that use it, in plan order.
    pub meals: Vec<String>,
}

/// An ingredient that is not in the catalog, so it cannot be priced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnmatchedLine {
    pub name: String,
    /// Each use, e.g. `200 g`.
    pub amounts: Vec<String>,
    pub meals: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ShoppingList {
    /// Sorted by catalog key.
    pub lines: Vec<ShoppingLine>,
    pub unmatched: Vec<UnmatchedLine>,
    /// Catalog keys the plan needs but the pantry list covers.
    pub pantry_skipped: Vec<String>,
}

pub struct ShoppingListBuilder;

impl ShoppingListBuilder {
    /// `servings / base`, rounded to the nearest whole milli and never zero for a non-zero amount.
    fn scale(milli: u64, servings: u32, base: u32) -> u64 {
        if milli == 0 {
            return 0;
        }
        let base = u64::from(base.max(1));
        ((milli * u64::from(servings.max(1)) * 2 + base) / (2 * base)).max(1)
    }

    fn remember(meals: &mut Vec<String>, title: &str) {
        if !meals.iter().any(|m| m == title) {
            meals.push(title.to_string());
        }
    }

    pub fn build(meals: &[PlannedMeal], pantry: &HashSet<String>) -> ShoppingList {
        let mut by_item: BTreeMap<&'static str, (u64, Vec<String>)> = BTreeMap::new();
        let mut unmatched: BTreeMap<String, UnmatchedLine> = BTreeMap::new();

        for meal in meals {
            for ing in &meal.ingredients {
                let item = ing
                    .item
                    .as_deref()
                    .and_then(Catalog::by_key)
                    .or_else(|| Catalog::match_product(&ing.name));
                match item {
                    Some(it) => {
                        let milli = Self::scale(
                            Amount::parse(&ing.amount).to_base_milli(it),
                            meal.servings,
                            meal.base_servings,
                        );
                        let entry = by_item.entry(it.key).or_default();
                        entry.0 += milli;
                        Self::remember(&mut entry.1, &meal.title);
                    }
                    None => {
                        let name = ing.name.trim();
                        if name.is_empty() {
                            continue;
                        }
                        let line =
                            unmatched
                                .entry(name.to_lowercase())
                                .or_insert_with(|| UnmatchedLine {
                                    name: name.to_string(),
                                    amounts: Vec::new(),
                                    meals: Vec::new(),
                                });
                        let amount = ing.amount.trim();
                        if !amount.is_empty() {
                            line.amounts.push(amount.to_string());
                        }
                        Self::remember(&mut line.meals, &meal.title);
                    }
                }
            }
        }

        let mut lines = Vec::new();
        let mut pantry_skipped = Vec::new();
        for (key, (milli, meals)) in by_item {
            if pantry.contains(key) {
                pantry_skipped.push(key.to_string());
                continue;
            }
            let reference = u64::from(Catalog::reference_milli(key));
            lines.push(ShoppingLine {
                item: key.to_string(),
                needed_milli: milli,
                packs: u32::try_from(milli.div_ceil(reference).max(1)).unwrap_or(u32::MAX),
                meals,
            });
        }
        ShoppingList {
            lines,
            unmatched: unmatched.into_values().collect(),
            pantry_skipped,
        }
    }
}

/// The shopping list priced against stored quotes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PricedList {
    /// What the priced items cost at each chain; a chain that lacks some of them lists those in
    /// `missing`. Cheapest complete chains first.
    pub per_chain: Vec<ChainBasket>,
    /// The cheapest way to buy the priced items: split across chains only when that saves at
    /// least the minimum saving, otherwise everything at the cheapest complete chain.
    pub plan: Option<ShoppingPlan>,
    /// Items nobody has a price for.
    pub unpriced: Vec<String>,
}

pub struct ShoppingPricer;

impl ShoppingPricer {
    pub fn price(lines: &[ShoppingLine], quotes: &[PriceQuote], min_saving: Money) -> PricedList {
        let quoted: HashSet<&str> = quotes.iter().map(|q| q.item.as_str()).collect();
        let (priced, unpriced): (Vec<&ShoppingLine>, Vec<&ShoppingLine>) =
            lines.iter().partition(|l| quoted.contains(l.item.as_str()));
        let items: Vec<BasketItem> = priced
            .iter()
            .map(|l| BasketItem {
                item: l.item.clone(),
                quantity: l.packs,
            })
            .collect();
        let (per_chain, plan) = if items.is_empty() {
            (Vec::new(), None)
        } else {
            (
                BasketPlanner::price_basket(&items, quotes),
                BasketPlanner::plan_shopping(&items, quotes, min_saving),
            )
        };
        PricedList {
            per_chain,
            plan,
            unpriced: unpriced.iter().map(|l| l.item.clone()).collect(),
        }
    }
}

/// The estimated cost against what is left of the groceries budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BudgetCheck {
    pub budget: Option<Money>,
    pub estimated: Money,
    /// Budget minus estimate; negative when over.
    pub left_after: Option<Money>,
    pub fits: Option<bool>,
}

impl BudgetCheck {
    pub fn compare(estimated: Money, budget: Option<Money>) -> BudgetCheck {
        BudgetCheck {
            budget,
            estimated,
            left_after: budget.map(|b| b - estimated),
            fits: budget.map(|b| estimated <= b),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use financer_core::Chain;

    struct Fixtures;

    impl Fixtures {
        fn ing(item: &str, amount: &str) -> MealIngredient {
            MealIngredient {
                item: Some(item.into()),
                name: item.into(),
                amount: amount.into(),
            }
        }

        fn named(name: &str, amount: &str) -> MealIngredient {
            MealIngredient {
                item: None,
                name: name.into(),
                amount: amount.into(),
            }
        }

        fn meal(title: &str, servings: u32, base: u32, ings: Vec<MealIngredient>) -> PlannedMeal {
            PlannedMeal {
                title: title.into(),
                servings,
                base_servings: base,
                ingredients: ings,
            }
        }

        fn none() -> HashSet<String> {
            HashSet::new()
        }

        fn pantry(keys: &[&str]) -> HashSet<String> {
            keys.iter().map(|k| k.to_string()).collect()
        }

        fn quote(item: &str, chain: Chain, cents: i64) -> PriceQuote {
            PriceQuote {
                item: item.into(),
                chain,
                price: Money::from_cents(cents),
                valid_until: None,
                is_offer: false,
            }
        }

        fn line<'a>(list: &'a ShoppingList, key: &str) -> &'a ShoppingLine {
            list.lines.iter().find(|l| l.item == key).unwrap()
        }
    }

    #[test]
    fn sums_the_same_item_across_meals_and_units() {
        let meals = vec![
            Fixtures::meal("A", 2, 2, vec![Fixtures::ing("milch", "250 ml")]),
            Fixtures::meal("B", 2, 2, vec![Fixtures::ing("milch", "0,5 l")]),
            Fixtures::meal("C", 2, 2, vec![Fixtures::ing("milch", "2 EL")]),
        ];
        let list = ShoppingListBuilder::build(&meals, &Fixtures::none());
        assert_eq!(list.lines.len(), 1);
        let milk = Fixtures::line(&list, "milch");
        assert_eq!(milk.needed_milli, 250 + 500 + 30);
        assert_eq!(milk.packs, 1); // 780 ml of a 1 l pack
        assert_eq!(milk.meals, vec!["A", "B", "C"]);
    }

    #[test]
    fn rounds_up_to_whole_packs() {
        let meals = vec![
            Fixtures::meal("A", 2, 2, vec![Fixtures::ing("nudeln", "300 g")]),
            Fixtures::meal("B", 2, 2, vec![Fixtures::ing("nudeln", "250 g")]),
        ];
        let list = ShoppingListBuilder::build(&meals, &Fixtures::none());
        // 550 g with 500 g packs
        assert_eq!(Fixtures::line(&list, "nudeln").packs, 2);
        // exactly one pack stays one
        let one = ShoppingListBuilder::build(
            &[Fixtures::meal(
                "A",
                2,
                2,
                vec![Fixtures::ing("nudeln", "500 g")],
            )],
            &Fixtures::none(),
        );
        assert_eq!(Fixtures::line(&one, "nudeln").packs, 1);
    }

    #[test]
    fn scales_to_the_planned_servings() {
        let meals = vec![Fixtures::meal(
            "A",
            3,
            2,
            vec![
                Fixtures::ing("nudeln", "250 g"),
                Fixtures::ing("zwiebeln", "1"),
            ],
        )];
        let list = ShoppingListBuilder::build(&meals, &Fixtures::none());
        assert_eq!(Fixtures::line(&list, "nudeln").needed_milli, 375);
        assert_eq!(Fixtures::line(&list, "zwiebeln").needed_milli, 120); // 80 g * 1.5

        let halved = ShoppingListBuilder::build(
            &[Fixtures::meal(
                "A",
                1,
                4,
                vec![Fixtures::ing("reis", "250 g")],
            )],
            &Fixtures::none(),
        );
        assert_eq!(Fixtures::line(&halved, "reis").needed_milli, 63); // 62.5 rounds up
    }

    #[test]
    fn the_same_recipe_twice_doubles_the_amount() {
        let r = Recipe::bundled()
            .iter()
            .find(|r| r.id == "spaghetti-tomatensosse")
            .unwrap();
        let once = ShoppingListBuilder::build(
            &[PlannedMeal::from_recipe(r, r.servings)],
            &Fixtures::none(),
        );
        let twice = ShoppingListBuilder::build(
            &[
                PlannedMeal::from_recipe(r, r.servings),
                PlannedMeal::from_recipe(r, r.servings),
            ],
            &Fixtures::none(),
        );
        assert_eq!(
            Fixtures::line(&twice, "nudeln").needed_milli,
            2 * Fixtures::line(&once, "nudeln").needed_milli
        );
        // the meal is named once even though it is planned twice
        assert_eq!(Fixtures::line(&twice, "nudeln").meals.len(), 1);
    }

    #[test]
    fn pantry_items_are_left_off_and_reported() {
        let meals = vec![Fixtures::meal(
            "A",
            2,
            2,
            vec![
                Fixtures::ing("nudeln", "250 g"),
                Fixtures::ing("salz", "nach Geschmack"),
                Fixtures::ing("oel", "2 EL"),
            ],
        )];
        let list = ShoppingListBuilder::build(&meals, &Fixtures::pantry(&["salz", "oel"]));
        assert_eq!(
            list.lines
                .iter()
                .map(|l| l.item.as_str())
                .collect::<Vec<_>>(),
            vec!["nudeln"]
        );
        assert_eq!(list.pantry_skipped, vec!["oel", "salz"]);

        // without the pantry entry, "to taste" still means one pack
        let list = ShoppingListBuilder::build(&meals, &Fixtures::pantry(&["oel"]));
        assert_eq!(Fixtures::line(&list, "salz").packs, 1);
    }

    #[test]
    fn names_from_ideas_are_matched_and_the_rest_listed() {
        let meals = vec![
            Fixtures::meal(
                "Idee",
                2,
                2,
                vec![
                    Fixtures::named("Spaghetti", "250 g"),
                    Fixtures::named("Vollmilch", "200 ml"),
                    Fixtures::named("Safran", "1 Prise"),
                    Fixtures::named("  ", "1"),
                ],
            ),
            Fixtures::meal("Zwei", 2, 2, vec![Fixtures::named("safran", "2 Fäden")]),
        ];
        let list = ShoppingListBuilder::build(&meals, &Fixtures::none());
        assert_eq!(Fixtures::line(&list, "nudeln").needed_milli, 250);
        assert_eq!(Fixtures::line(&list, "milch").needed_milli, 200);
        assert_eq!(list.unmatched.len(), 1);
        assert_eq!(list.unmatched[0].name, "Safran");
        assert_eq!(list.unmatched[0].amounts, vec!["1 Prise", "2 Fäden"]);
        assert_eq!(list.unmatched[0].meals, vec!["Idee", "Zwei"]);
    }

    #[test]
    fn an_unknown_catalog_key_falls_back_to_the_name() {
        let meals = vec![Fixtures::meal(
            "A",
            1,
            1,
            vec![MealIngredient {
                item: Some("not-a-key".into()),
                name: "Tofu".into(),
                amount: "200 g".into(),
            }],
        )];
        let list = ShoppingListBuilder::build(&meals, &Fixtures::none());
        assert_eq!(Fixtures::line(&list, "tofu").needed_milli, 200);
    }

    #[test]
    fn an_empty_plan_gives_an_empty_list() {
        assert_eq!(
            ShoppingListBuilder::build(&[], &Fixtures::none()),
            ShoppingList::default()
        );
    }

    #[test]
    fn a_week_of_bundled_recipes_makes_a_plausible_list() {
        let pick = |id: &str| {
            let r = Recipe::bundled().iter().find(|r| r.id == id).unwrap();
            PlannedMeal::from_recipe(r, r.servings)
        };
        let meals: Vec<PlannedMeal> = [
            "spaghetti-tomatensosse",
            "spaghetti-bolognese",
            "kartoffelsuppe",
            "pfannkuchen",
            "lachs-kartoffeln",
        ]
        .into_iter()
        .map(pick)
        .collect();
        let pantry = Fixtures::pantry(&["salz", "pfeffer", "oel", "zucker", "mehl"]);
        let list = ShoppingListBuilder::build(&meals, &pantry);
        // pasta from two dishes is folded into one line
        let nudeln = Fixtures::line(&list, "nudeln");
        assert!(nudeln.meals.len() == 2 && nudeln.packs >= 1);
        // potatoes from two dishes too
        assert_eq!(Fixtures::line(&list, "kartoffeln").meals.len(), 2);
        // no duplicate lines and nothing from the pantry
        let keys: HashSet<_> = list.lines.iter().map(|l| &l.item).collect();
        assert_eq!(keys.len(), list.lines.len());
        assert!(!keys.contains(&"salz".to_string()) && !keys.contains(&"mehl".to_string()));
        assert!(list.unmatched.is_empty());
    }

    #[test]
    fn prices_per_chain_and_splits_when_it_pays() {
        let lines = vec![
            ShoppingLine {
                item: "milch".into(),
                needed_milli: 1_000,
                packs: 2,
                meals: vec![],
            },
            ShoppingLine {
                item: "brot".into(),
                needed_milli: 1_000,
                packs: 1,
                meals: vec![],
            },
            ShoppingLine {
                item: "nudeln".into(),
                needed_milli: 500,
                packs: 1,
                meals: vec![],
            },
        ];
        let quotes = vec![
            Fixtures::quote("milch", Chain::Aldi, 99),
            Fixtures::quote("milch", Chain::Rewe, 119),
            Fixtures::quote("brot", Chain::Aldi, 179),
            Fixtures::quote("brot", Chain::Lidl, 149),
            Fixtures::quote("nudeln", Chain::Aldi, 89),
            Fixtures::quote("nudeln", Chain::Lidl, 79),
        ];
        // single Aldi basket 198 + 179 + 89 = 466; split 198 + 149 + 79 = 426
        let split = ShoppingPricer::price(&lines, &quotes, Money::from_cents(30));
        let plan = split.plan.unwrap();
        assert_eq!(plan.total, Money::from_cents(426));
        assert_eq!(plan.stops.len(), 2);
        assert_eq!(plan.single_chain_total, Some(Money::from_cents(466)));
        let aldi = split
            .per_chain
            .iter()
            .find(|c| c.chain == Chain::Aldi)
            .unwrap();
        assert_eq!(aldi.total, Money::from_cents(466));
        assert!(aldi.missing.is_empty());
        let lidl = split
            .per_chain
            .iter()
            .find(|c| c.chain == Chain::Lidl)
            .unwrap();
        assert_eq!(lidl.missing, vec!["milch"]);
        assert!(split.unpriced.is_empty());

        // a split that saves too little stays at one shop
        let single = ShoppingPricer::price(&lines, &quotes, Money::from_cents(50));
        let plan = single.plan.unwrap();
        assert_eq!(plan.stops.len(), 1);
        assert_eq!(plan.total, Money::from_cents(466));
    }

    #[test]
    fn items_without_any_price_are_listed_apart_and_do_not_block_the_plan() {
        let line = |item: &str| ShoppingLine {
            item: item.into(),
            needed_milli: 1,
            packs: 1,
            meals: vec![],
        };
        let lines = vec![line("milch"), line("lachs")];
        let quotes = vec![Fixtures::quote("milch", Chain::Aldi, 99)];
        let priced = ShoppingPricer::price(&lines, &quotes, Money::from_cents(50));
        assert_eq!(priced.unpriced, vec!["lachs"]);
        assert_eq!(priced.plan.unwrap().total, Money::from_cents(99));

        // nothing priced at all
        let none = ShoppingPricer::price(&lines, &[], Money::from_cents(50));
        assert!(none.plan.is_none() && none.per_chain.is_empty());
        assert_eq!(none.unpriced.len(), 2);
        assert!(ShoppingPricer::price(&[], &quotes, Money::ZERO)
            .plan
            .is_none());
    }

    #[test]
    fn budget_check_compares_with_what_is_left() {
        let under = BudgetCheck::compare(Money::from_cents(4_000), Some(Money::from_cents(5_000)));
        assert_eq!(under.fits, Some(true));
        assert_eq!(under.left_after, Some(Money::from_cents(1_000)));

        let exact = BudgetCheck::compare(Money::from_cents(5_000), Some(Money::from_cents(5_000)));
        assert_eq!(exact.fits, Some(true));

        let over = BudgetCheck::compare(Money::from_cents(5_001), Some(Money::from_cents(5_000)));
        assert_eq!(over.fits, Some(false));
        assert_eq!(over.left_after, Some(Money::from_cents(-1)));

        // an overspent envelope can fit nothing
        let negative = BudgetCheck::compare(Money::from_cents(100), Some(Money::from_cents(-50)));
        assert_eq!(negative.fits, Some(false));

        let unknown = BudgetCheck::compare(Money::from_cents(100), None);
        assert_eq!((unknown.fits, unknown.left_after), (None, None));
    }
}
