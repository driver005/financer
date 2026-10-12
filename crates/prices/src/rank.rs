//! Picking one price per chain and the cheapest chain, from prices that may be quoted in
//! different ways (per kg/l, per catalog reference pack, per the scanned pack).

use std::collections::BTreeMap;

use financer_core::Chain;
use serde::Serialize;

/// The ways one price can be compared with others, all in cents.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Keys {
    /// Cents per kg or l.
    pub unit: Option<i64>,
    /// Cents per reference pack of the catalog item.
    pub reference: Option<i64>,
    /// Cents for the scanned pack itself.
    pub pack: Option<i64>,
}

impl Keys {
    fn get(&self, basis: Basis) -> Option<i64> {
        match basis {
            Basis::Unit => self.unit,
            Basis::Reference => self.reference,
            Basis::Pack => self.pack,
        }
    }
}

/// What chains were compared on. Listed from the most to the least meaningful.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Basis {
    Unit,
    Reference,
    Pack,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ranking<T> {
    /// `None` when the chains' prices have no way of being compared in common.
    pub basis: Option<Basis>,
    /// One entry per chain, cheapest first (or in chain order when not comparable).
    pub entries: Vec<(Chain, T)>,
    /// Every chain sharing the lowest price: one chain when there is a clear winner, several
    /// on a tie, none when the prices cannot be compared.
    pub cheapest: Vec<Chain>,
}

/// Ranks chains by price.
pub struct ChainRanker;

impl ChainRanker {
    const ORDER: [Basis; 3] = [Basis::Unit, Basis::Reference, Basis::Pack];

    /// Keep each chain's cheapest candidate and order chains by price. Chains are compared on
    /// the first basis that every chain has a price for; a chain is never compared on a basis
    /// the others do not share.
    pub fn rank<T>(candidates: Vec<(Chain, Keys, T)>) -> Ranking<T> {
        let mut by_chain: BTreeMap<Chain, Vec<(Keys, T)>> = BTreeMap::new();
        for (chain, keys, value) in candidates {
            by_chain.entry(chain).or_default().push((keys, value));
        }
        let basis = Self::ORDER.into_iter().find(|b| {
            !by_chain.is_empty()
                && by_chain
                    .values()
                    .all(|c| c.iter().any(|(k, _)| k.get(*b).is_some()))
        });

        let Some(basis) = basis else {
            // nothing in common: show one entry per chain, as found, without a winner
            let entries = by_chain
                .into_iter()
                .filter_map(|(chain, c)| c.into_iter().next().map(|(_, v)| (chain, v)))
                .collect();
            return Ranking {
                basis: None,
                entries,
                cheapest: Vec::new(),
            };
        };

        let mut ranked: Vec<(i64, Chain, T)> = by_chain
            .into_iter()
            .filter_map(|(chain, c)| {
                c.into_iter()
                    .filter_map(|(k, v)| k.get(basis).map(|key| (key, v)))
                    .min_by_key(|(key, _)| *key)
                    .map(|(key, v)| (key, chain, v))
            })
            .collect();
        ranked.sort_by_key(|(key, chain, _)| (*key, *chain));
        let lowest = ranked.first().map(|(key, _, _)| *key);
        let cheapest = ranked
            .iter()
            .filter(|(key, _, _)| Some(*key) == lowest)
            .map(|(_, chain, _)| *chain)
            .collect();
        Ranking {
            basis: Some(basis),
            entries: ranked.into_iter().map(|(_, c, v)| (c, v)).collect(),
            cheapest,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(cents: i64) -> Keys {
        Keys {
            unit: Some(cents),
            ..Keys::default()
        }
    }

    fn pack(cents: i64) -> Keys {
        Keys {
            pack: Some(cents),
            ..Keys::default()
        }
    }

    #[test]
    fn cheapest_chain_wins_on_unit_price() {
        let r = ChainRanker::rank(vec![
            (Chain::Rewe, unit(199), "rewe"),
            (Chain::Aldi, unit(149), "aldi"),
            (Chain::Lidl, unit(159), "lidl"),
        ]);
        assert_eq!(r.basis, Some(Basis::Unit));
        assert_eq!(r.cheapest, vec![Chain::Aldi]);
        assert_eq!(
            r.entries.iter().map(|(c, _)| *c).collect::<Vec<_>>(),
            vec![Chain::Aldi, Chain::Lidl, Chain::Rewe]
        );
    }

    #[test]
    fn keeps_each_chains_cheapest_candidate() {
        let r = ChainRanker::rank(vec![
            (Chain::Aldi, unit(180), "old"),
            (Chain::Aldi, unit(120), "offer"),
            (Chain::Lidl, unit(150), "lidl"),
        ]);
        assert_eq!(r.entries.len(), 2);
        assert_eq!(r.entries[0], (Chain::Aldi, "offer"));
    }

    #[test]
    fn a_tie_has_no_single_winner() {
        let r = ChainRanker::rank(vec![
            (Chain::Lidl, pack(99), ()),
            (Chain::Aldi, pack(99), ()),
            (Chain::Rewe, pack(129), ()),
        ]);
        assert_eq!(r.basis, Some(Basis::Pack));
        assert_eq!(r.cheapest, vec![Chain::Lidl, Chain::Aldi]);
    }

    #[test]
    fn falls_back_to_a_basis_every_chain_has() {
        // Aldi only knows the shelf price of the scanned pack, Lidl has both
        let r = ChainRanker::rank(vec![
            (Chain::Aldi, pack(89), "aldi"),
            (
                Chain::Lidl,
                Keys {
                    unit: Some(100),
                    pack: Some(99),
                    ..Keys::default()
                },
                "lidl",
            ),
        ]);
        assert_eq!(r.basis, Some(Basis::Pack));
        assert_eq!(r.cheapest, vec![Chain::Aldi]);
    }

    #[test]
    fn mixed_bases_are_not_compared() {
        let r = ChainRanker::rank(vec![
            (Chain::Aldi, unit(100), "aldi"),
            (Chain::Lidl, pack(99), "lidl"),
        ]);
        assert_eq!(r.basis, None);
        assert!(r.cheapest.is_empty());
        assert_eq!(r.entries.len(), 2);
    }

    #[test]
    fn a_single_chain_and_no_chain() {
        let one = ChainRanker::rank(vec![(Chain::Rewe, unit(300), 1)]);
        assert_eq!(one.cheapest, vec![Chain::Rewe]);
        let none = ChainRanker::rank::<u8>(Vec::new());
        assert_eq!(none.basis, None);
        assert!(none.entries.is_empty() && none.cheapest.is_empty());
    }
}
