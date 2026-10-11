//! Price comparison and "what can I buy" on top of already-fetched price quotes.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use time::Date;

use crate::money::Money;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Chain {
    Lidl,
    Aldi,
    Kaufland,
    Rewe,
}

/// A price for one canonical item ("generic item key", e.g. `vollmilch-3.5-1l`) at one chain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PriceQuote {
    pub item: String,
    pub chain: Chain,
    /// Price of one pack.
    pub price: Money,
    pub valid_until: Option<Date>,
    pub is_offer: bool,
}

/// An item you normally buy and how many packs per shopping period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BasketItem {
    pub item: String,
    pub quantity: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainBasket {
    pub chain: Chain,
    pub total: Money,
    /// Items this chain has no quote for.
    pub missing: Vec<String>,
}

fn cheapest_per_chain(quotes: &[PriceQuote]) -> BTreeMap<(&str, Chain), &PriceQuote> {
    let mut map: BTreeMap<(&str, Chain), &PriceQuote> = BTreeMap::new();
    for q in quotes {
        map.entry((q.item.as_str(), q.chain))
            .and_modify(|cur| {
                if q.price < cur.price {
                    *cur = q;
                }
            })
            .or_insert(q);
    }
    map
}

/// Total basket price at each chain that stocks at least one basket item.
/// Cheapest complete baskets come first; incomplete baskets are listed after complete ones.
pub fn price_basket(items: &[BasketItem], quotes: &[PriceQuote]) -> Vec<ChainBasket> {
    let best = cheapest_per_chain(quotes);
    let chains: BTreeSet<Chain> = quotes.iter().map(|q| q.chain).collect();
    let mut out: Vec<ChainBasket> = chains
        .into_iter()
        .map(|chain| {
            let mut total = Money::ZERO;
            let mut missing = Vec::new();
            for it in items {
                match best.get(&(it.item.as_str(), chain)) {
                    Some(q) => total += q.price.times(it.quantity),
                    None => missing.push(it.item.clone()),
                }
            }
            ChainBasket {
                chain,
                total,
                missing,
            }
        })
        .collect();
    out.sort_by_key(|b| (b.missing.len(), b.total, b.chain));
    out
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BestPick {
    pub item: String,
    pub chain: Chain,
    pub price: Money,
    pub is_offer: bool,
    pub valid_until: Option<Date>,
    /// How much more the next-cheapest chain charges; zero if only one chain has a quote.
    pub saving_vs_next: Money,
}

/// Cheapest chain for each basket item. Ties go to the chain that sorts first, so results
/// are deterministic.
pub fn best_picks(items: &[BasketItem], quotes: &[PriceQuote]) -> Vec<BestPick> {
    let best = cheapest_per_chain(quotes);
    items
        .iter()
        .filter_map(|it| {
            let mut options: Vec<&PriceQuote> = best
                .iter()
                .filter(|((name, _), _)| *name == it.item.as_str())
                .map(|(_, q)| *q)
                .collect();
            options.sort_by_key(|q| (q.price, q.chain));
            let top = options.first()?;
            let saving = options
                .get(1)
                .map(|n| n.price - top.price)
                .unwrap_or(Money::ZERO);
            Some(BestPick {
                item: it.item.clone(),
                chain: top.chain,
                price: top.price,
                is_offer: top.is_offer,
                valid_until: top.valid_until,
                saving_vs_next: saving,
            })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShoppingPlan {
    pub stops: BTreeMap<Chain, Vec<BestPick>>,
    pub total: Money,
    /// Total if everything were bought at the cheapest single complete chain, if any.
    pub single_chain_total: Option<Money>,
}

/// Split the basket across chains only when it beats the best single chain by at least
/// `min_saving`; otherwise everything goes to the single cheapest complete chain.
pub fn plan_shopping(
    items: &[BasketItem],
    quotes: &[PriceQuote],
    min_saving: Money,
) -> Option<ShoppingPlan> {
    let picks = best_picks(items, quotes);
    if picks.len() != items.len() {
        return None; // some item has no price anywhere
    }
    let qty = |name: &str| {
        items
            .iter()
            .find(|i| i.item == name)
            .map(|i| i.quantity)
            .unwrap_or(1)
    };
    let split_total: Money = picks.iter().map(|p| p.price.times(qty(&p.item))).sum();

    let single = price_basket(items, quotes)
        .into_iter()
        .find(|b| b.missing.is_empty());
    let single_total = single.as_ref().map(|b| b.total);

    let use_split = match &single {
        Some(s) => s.total - split_total >= min_saving,
        None => true,
    };

    let mut stops: BTreeMap<Chain, Vec<BestPick>> = BTreeMap::new();
    if use_split {
        for p in picks {
            stops.entry(p.chain).or_default().push(p);
        }
        Some(ShoppingPlan {
            stops,
            total: split_total,
            single_chain_total: single_total,
        })
    } else {
        let s = single?;
        let cheapest = cheapest_per_chain(quotes);
        for it in items {
            let q = cheapest.get(&(it.item.as_str(), s.chain))?;
            stops.entry(s.chain).or_default().push(BestPick {
                item: it.item.clone(),
                chain: s.chain,
                price: q.price,
                is_offer: q.is_offer,
                valid_until: q.valid_until,
                saving_vs_next: Money::ZERO,
            });
        }
        Some(ShoppingPlan {
            stops,
            total: s.total,
            single_chain_total: single_total,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainAffordability {
    pub chain: Chain,
    pub basket_total: Money,
    /// Whole baskets the budget pays for.
    pub baskets: u32,
    /// Days of groceries those baskets cover.
    pub days_covered: u32,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StapleOption {
    pub item: String,
    pub chain: Chain,
    pub price: Money,
    /// Packs the budget would buy if spent on this item alone.
    pub max_packs: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Affordability {
    pub budget: Money,
    pub per_chain: Vec<ChainAffordability>,
    /// Everything with a quote at or under the budget, cheapest first.
    pub staples: Vec<StapleOption>,
}

/// "What can I buy with my budget": how long the usual basket lasts at each chain
/// (`basket_period_days` is how many days one basket covers), and which items fit.
pub fn what_can_i_buy(
    budget: Money,
    items: &[BasketItem],
    quotes: &[PriceQuote],
    basket_period_days: u32,
) -> Affordability {
    let per_chain = price_basket(items, quotes)
        .into_iter()
        .map(|b| {
            let baskets = if b.total.cents() > 0 && budget.cents() > 0 {
                (budget.cents() / b.total.cents()) as u32
            } else {
                0
            };
            ChainAffordability {
                chain: b.chain,
                basket_total: b.total,
                baskets,
                days_covered: baskets * basket_period_days,
                missing: b.missing,
            }
        })
        .collect();

    let mut staples: Vec<StapleOption> = cheapest_per_chain(quotes)
        .values()
        .filter(|q| q.price.cents() > 0 && q.price <= budget)
        .map(|q| StapleOption {
            item: q.item.clone(),
            chain: q.chain,
            price: q.price,
            max_packs: (budget.cents() / q.price.cents()) as u32,
        })
        .collect();
    staples.sort_by(|a, b| (a.price, &a.item, a.chain).cmp(&(b.price, &b.item, b.chain)));

    Affordability {
        budget,
        per_chain,
        staples,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(item: &str, chain: Chain, cents: i64) -> PriceQuote {
        PriceQuote {
            item: item.into(),
            chain,
            price: Money::from_cents(cents),
            valid_until: None,
            is_offer: false,
        }
    }
    fn b(item: &str, quantity: u32) -> BasketItem {
        BasketItem {
            item: item.into(),
            quantity,
        }
    }

    fn sample() -> (Vec<BasketItem>, Vec<PriceQuote>) {
        let items = vec![b("milch", 2), b("brot", 1), b("nudeln", 1)];
        let quotes = vec![
            q("milch", Chain::Aldi, 99),
            q("milch", Chain::Rewe, 119),
            q("brot", Chain::Aldi, 179),
            q("brot", Chain::Lidl, 149),
            q("nudeln", Chain::Aldi, 89),
            q("nudeln", Chain::Lidl, 79),
            q("nudeln", Chain::Rewe, 129),
        ];
        (items, quotes)
    }

    #[test]
    fn prices_basket_per_chain_and_flags_missing() {
        let (items, quotes) = sample();
        let baskets = price_basket(&items, &quotes);
        assert_eq!(baskets[0].chain, Chain::Aldi);
        assert_eq!(baskets[0].total, Money::from_cents(99 * 2 + 179 + 89));
        assert!(baskets[0].missing.is_empty());
        let lidl = baskets.iter().find(|c| c.chain == Chain::Lidl).unwrap();
        assert_eq!(lidl.missing, vec!["milch".to_string()]);
    }

    #[test]
    fn picks_cheapest_chain_per_item() {
        let (items, quotes) = sample();
        let picks = best_picks(&items, &quotes);
        let by = |n: &str| picks.iter().find(|p| p.item == n).unwrap();
        assert_eq!(by("milch").chain, Chain::Aldi);
        assert_eq!(by("milch").saving_vs_next, Money::from_cents(20));
        assert_eq!(by("brot").chain, Chain::Lidl);
        assert_eq!(by("nudeln").chain, Chain::Lidl);
        assert_eq!(by("nudeln").saving_vs_next, Money::from_cents(10));
    }

    #[test]
    fn cheapest_quote_wins_when_chain_has_offer_and_regular_price() {
        let quotes = vec![
            q("milch", Chain::Aldi, 99),
            PriceQuote {
                is_offer: true,
                ..q("milch", Chain::Aldi, 79)
            },
        ];
        let picks = best_picks(&[b("milch", 1)], &quotes);
        assert_eq!(picks[0].price, Money::from_cents(79));
        assert!(picks[0].is_offer);
    }

    #[test]
    fn split_only_when_saving_is_large_enough() {
        let (items, quotes) = sample();
        // single Aldi basket = 466, split = 198 + 149 + 79 = 426 -> saves 40
        let split = plan_shopping(&items, &quotes, Money::from_cents(30)).unwrap();
        assert_eq!(split.total, Money::from_cents(426));
        assert_eq!(split.stops.len(), 2);
        assert_eq!(split.single_chain_total, Some(Money::from_cents(466)));

        let single = plan_shopping(&items, &quotes, Money::from_cents(50)).unwrap();
        assert_eq!(single.total, Money::from_cents(466));
        assert_eq!(
            single.stops.keys().copied().collect::<Vec<_>>(),
            vec![Chain::Aldi]
        );
    }

    #[test]
    fn no_plan_when_an_item_has_no_price() {
        let (mut items, quotes) = sample();
        items.push(b("kaviar", 1));
        assert!(plan_shopping(&items, &quotes, Money::ZERO).is_none());
    }

    #[test]
    fn affordability_counts_baskets_and_staples() {
        let (items, quotes) = sample();
        let a = what_can_i_buy(Money::from_cents(1000), &items, &quotes, 7);
        let aldi = a.per_chain.iter().find(|c| c.chain == Chain::Aldi).unwrap();
        assert_eq!(aldi.baskets, 2); // 1000 / 466
        assert_eq!(aldi.days_covered, 14);
        assert!(a.staples.windows(2).all(|w| w[0].price <= w[1].price));
        assert_eq!(a.staples[0].price, Money::from_cents(79));
        assert_eq!(a.staples[0].max_packs, 12);
    }

    #[test]
    fn zero_budget_buys_nothing() {
        let (items, quotes) = sample();
        let a = what_can_i_buy(Money::ZERO, &items, &quotes, 7);
        assert!(a.staples.is_empty());
        assert!(a.per_chain.iter().all(|c| c.baskets == 0));
    }
}
