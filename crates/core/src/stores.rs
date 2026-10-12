//! Which shop chain a booking belongs to, and what is spent at each.
//!
//! Bank texts for the same chain come in many spellings (`LIDL SAGT DANKE//Berlin/DE`,
//! `REWE Markt GmbH`, `ALDI SAGT DANKE`, `Netto Marken-Discount AG & Co. KG`). Texts are run
//! through [`NameNormalizer`] (lowercase letters only) and compared as whole words, so `dm` does
//! not match inside `admin` and `real` does not match `realty`.
//!
//! A built-in table covers common German chains; users add their own spellings (or whole local
//! chains) with [`StoreAlias`]. User entries are tried before the table.
//!
//! Very short or common names (`dm`, `norma`, `penny`, `netto`, `real`, `globus`, `hit`) only count
//! at the start of the counterparty, or as a longer spelling such as `real sb warenhaus`; a
//! surname or a word in the purpose text should not make a booking a supermarket visit.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::Date;

use crate::category::Category;
use crate::money::Money;
use crate::transaction::{NameNormalizer, Transaction};

/// The `id` of the bucket for grocery spending that no chain matched.
pub const OTHER_ID: &str = "other";

/// A user-defined spelling: bank texts containing any of `patterns` belong to `chain`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoreAlias {
    /// A built-in chain (by id or name, e.g. `rewe`) or the name of a chain of your own.
    pub chain: String,
    pub patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoreChain {
    /// Stable lowercase id used in URLs (`rewe`, `bio-company`).
    pub id: String,
    /// Name for display (`REWE`).
    pub name: String,
}

struct Builtin {
    id: &'static str,
    name: &'static str,
    /// Spellings that count anywhere in the counterparty (or purpose).
    anywhere: &'static [&'static str],
    /// Spellings that only count at the very start of the counterparty.
    at_start: &'static [&'static str],
    /// Texts that look like the chain but are something else (a mobile contract, travel).
    not: &'static [&'static str],
}

const BUILTIN: &[Builtin] = &[
    Builtin {
        id: "lidl",
        name: "Lidl",
        anywhere: &["lidl"],
        at_start: &[],
        not: &["lidl connect"],
    },
    Builtin {
        id: "aldi",
        name: "Aldi",
        anywhere: &["aldi", "aldi nord", "aldi sued", "aldi süd"],
        at_start: &[],
        not: &["aldi talk", "aldi life", "aldi reisen"],
    },
    Builtin {
        id: "kaufland",
        name: "Kaufland",
        anywhere: &["kaufland"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "rewe",
        name: "REWE",
        anywhere: &["rewe"],
        at_start: &[],
        not: &["rewe reisen", "rewe touristik"],
    },
    Builtin {
        id: "edeka",
        name: "Edeka",
        anywhere: &["edeka", "neukauf"],
        at_start: &["e center", "e neukauf"],
        not: &[],
    },
    Builtin {
        id: "marktkauf",
        name: "Marktkauf",
        anywhere: &["marktkauf"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "netto",
        name: "Netto",
        anywhere: &["netto marken discount"],
        at_start: &["netto"],
        not: &[],
    },
    Builtin {
        id: "penny",
        name: "Penny",
        anywhere: &["penny markt"],
        at_start: &["penny"],
        not: &[],
    },
    Builtin {
        id: "dm",
        name: "dm",
        anywhere: &["dm drogerie markt", "dm drogerie"],
        at_start: &["dm"],
        not: &[],
    },
    Builtin {
        id: "rossmann",
        name: "Rossmann",
        anywhere: &["rossmann"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "norma",
        name: "Norma",
        anywhere: &["norma lebensmittelfilialbetrieb"],
        at_start: &["norma"],
        not: &[],
    },
    Builtin {
        id: "globus",
        name: "Globus",
        anywhere: &["globus sb", "globus markt", "globus holding"],
        at_start: &["globus"],
        not: &["globus baumarkt"],
    },
    Builtin {
        id: "tegut",
        name: "tegut",
        anywhere: &["tegut"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "real",
        name: "real",
        anywhere: &[
            "real sb warenhaus",
            "real sb",
            "real markt",
            "real gmbh",
            "real filiale",
        ],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "famila",
        name: "Famila",
        anywhere: &["famila"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "hit",
        name: "HIT",
        anywhere: &["hit markt", "hit sb warenhaus", "hit handelsgruppe"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "nahkauf",
        name: "nahkauf",
        anywhere: &["nahkauf"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "alnatura",
        name: "Alnatura",
        anywhere: &["alnatura"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "denns",
        name: "denn's Biomarkt",
        anywhere: &["denn s biomarkt", "denns biomarkt"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "bio-company",
        name: "Bio Company",
        anywhere: &["bio company"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "budni",
        name: "Budni",
        anywhere: &["budni", "budnikowsky"],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "mueller",
        name: "Müller",
        anywhere: &[
            "mueller drogerie",
            "müller drogerie",
            "mueller ltd",
            "müller ltd",
        ],
        at_start: &[],
        not: &[],
    },
    Builtin {
        id: "metro",
        name: "Metro",
        anywhere: &["metro cash", "metro deutschland", "metro ag"],
        at_start: &[],
        not: &[],
    },
];

struct Pattern {
    chain: usize,
    words: Vec<String>,
    at_start: bool,
    user: bool,
}

/// Decides which chain a booking belongs to.
pub struct StoreMatcher {
    chains: Vec<StoreChain>,
    patterns: Vec<Pattern>,
    /// Built-in "this is not the chain" texts per chain.
    exclusions: Vec<(usize, Vec<String>)>,
}

impl StoreMatcher {
    /// The built-in table only.
    pub fn builtin() -> Self {
        Self::with_aliases(&[])
    }

    /// The built-in table plus the user's own spellings.
    pub fn with_aliases(aliases: &[StoreAlias]) -> Self {
        let mut matcher = StoreMatcher {
            chains: Vec::new(),
            patterns: Vec::new(),
            exclusions: Vec::new(),
        };
        for b in BUILTIN {
            let idx = matcher.chains.len();
            matcher.chains.push(StoreChain {
                id: b.id.to_string(),
                name: b.name.to_string(),
            });
            for p in b.anywhere {
                matcher.add_pattern(idx, p, false, false);
            }
            for p in b.at_start {
                matcher.add_pattern(idx, p, true, false);
            }
            for p in b.not {
                let words = Self::words(p);
                if !words.is_empty() {
                    matcher.exclusions.push((idx, words));
                }
            }
        }
        for alias in aliases {
            let Some(idx) = matcher.chain_for_alias(&alias.chain) else {
                continue;
            };
            for p in &alias.patterns {
                matcher.add_pattern(idx, p, false, true);
            }
        }
        matcher
    }

    fn words(text: &str) -> Vec<String> {
        NameNormalizer::normalize(text)
            .split(' ')
            .filter(|w| !w.is_empty())
            .map(str::to_string)
            .collect()
    }

    fn add_pattern(&mut self, chain: usize, text: &str, at_start: bool, user: bool) {
        let words = Self::words(text);
        if !words.is_empty() {
            self.patterns.push(Pattern {
                chain,
                words,
                at_start,
                user,
            });
        }
    }

    /// The id of a custom chain: its normalized name with dashes (`Bio Company` -> `bio-company`).
    pub fn slug(name: &str) -> String {
        Self::words(name).join("-")
    }

    /// Index of the chain an alias belongs to; creates a custom chain when the name is new.
    fn chain_for_alias(&mut self, name: &str) -> Option<usize> {
        let slug = Self::slug(name);
        if slug.is_empty() || slug == OTHER_ID {
            return None;
        }
        let words = Self::words(name).join(" ");
        if let Some(i) = self
            .chains
            .iter()
            .position(|c| c.id == slug || Self::words(&c.name).join(" ") == words)
        {
            return Some(i);
        }
        self.chains.push(StoreChain {
            id: slug,
            name: name.trim().to_string(),
        });
        Some(self.chains.len() - 1)
    }

    /// All chains: the built-in ones, then the user's own.
    pub fn chains(&self) -> &[StoreChain] {
        &self.chains
    }

    pub fn chain(&self, id: &str) -> Option<&StoreChain> {
        self.chains.iter().find(|c| c.id == id)
    }

    fn contains(haystack: &[String], needle: &[String]) -> bool {
        !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
    }

    fn best_in(&self, words: &[String], allow_at_start: bool) -> Option<usize> {
        let mut best: Option<(usize, (bool, usize))> = None;
        for p in &self.patterns {
            let hit = if p.at_start {
                allow_at_start && words.starts_with(&p.words)
            } else {
                Self::contains(words, &p.words)
            };
            if !hit {
                continue;
            }
            if !p.user
                && self
                    .exclusions
                    .iter()
                    .any(|(c, ex)| *c == p.chain && Self::contains(words, ex))
            {
                continue;
            }
            let score = (p.user, p.words.len());
            // earlier table entries win ties
            if best.is_none_or(|(_, s)| score > s) {
                best = Some((p.chain, score));
            }
        }
        best.map(|(c, _)| c)
    }

    /// The chain for a booking's counterparty and purpose. The counterparty decides when it
    /// matches; the purpose is only consulted otherwise (a PayPal payment names the shop there).
    pub fn match_text(&self, counterparty: &str, purpose: &str) -> Option<&StoreChain> {
        let from_counterparty = self.best_in(&Self::words(counterparty), true);
        let idx = from_counterparty.or_else(|| self.best_in(&Self::words(purpose), false))?;
        self.chains.get(idx)
    }

    pub fn match_transaction(&self, tx: &Transaction) -> Option<&StoreChain> {
        self.match_text(&tx.counterparty, &tx.purpose)
    }
}

/// Where a purchase is counted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Bucket {
    Chain(StoreChain),
    /// Categorized as groceries, but no chain matched.
    OtherGrocery,
}

impl Bucket {
    pub fn id(&self) -> &str {
        match self {
            Bucket::Chain(c) => &c.id,
            Bucket::OtherGrocery => OTHER_ID,
        }
    }
}

/// What was spent in one bucket over a date range.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Totals {
    pub total: Money,
    pub visits: u32,
    pub last_visit: Option<Date>,
}

/// One row of the report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreRow {
    /// The chain's id, or [`OTHER_ID`].
    pub id: String,
    pub name: String,
    pub total: Money,
    pub visits: u32,
    /// Total divided by visits, rounded to the cent; zero without visits.
    pub average_basket: Money,
    /// Share of all store spending in tenths of a percent (123 = 12.3 %).
    pub share_permille: u32,
    pub last_visit: Option<Date>,
    pub previous_total: Money,
    pub previous_visits: u32,
    /// Spent now minus spent in the comparison range.
    pub change: Money,
    /// Change relative to the comparison range in tenths of a percent; `None` when nothing was
    /// spent there.
    pub change_permille: Option<i64>,
}

/// The ranked report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreReport {
    /// Chains with spending, largest first.
    pub chains: Vec<StoreRow>,
    /// Groceries that no chain matched (always present, possibly zero).
    pub other: StoreRow,
    pub total: Money,
    pub previous_total: Money,
}

pub struct StoreSpending;

impl StoreSpending {
    /// Where an expense belongs: a chain, the unmatched-grocery bucket, or nowhere.
    pub fn bucket(matcher: &StoreMatcher, tx: &Transaction) -> Option<Bucket> {
        if !tx.is_expense() {
            return None;
        }
        match matcher.match_transaction(tx) {
            Some(chain) => Some(Bucket::Chain(chain.clone())),
            None if tx.category == Some(Category::Groceries) => Some(Bucket::OtherGrocery),
            None => None,
        }
    }

    /// Totals per bucket id for expenses booked from `start` to `end` (both inclusive).
    pub fn totals<'a>(
        matcher: &StoreMatcher,
        txs: impl IntoIterator<Item = &'a Transaction>,
        start: Date,
        end: Date,
    ) -> BTreeMap<String, Totals> {
        let mut out: BTreeMap<String, Totals> = BTreeMap::new();
        for tx in txs {
            if tx.booking_date < start || tx.booking_date > end {
                continue;
            }
            let Some(bucket) = Self::bucket(matcher, tx) else {
                continue;
            };
            let t = out.entry(bucket.id().to_string()).or_default();
            t.total += tx.amount.abs();
            t.visits += 1;
            t.last_visit = Some(
                t.last_visit
                    .map_or(tx.booking_date, |d| d.max(tx.booking_date)),
            );
        }
        out
    }

    /// Rank `current` against `previous` (both from [`StoreSpending::totals`]).
    pub fn report(
        matcher: &StoreMatcher,
        current: &BTreeMap<String, Totals>,
        previous: &BTreeMap<String, Totals>,
    ) -> StoreReport {
        let total: Money = current.values().map(|t| t.total).sum();
        let previous_total: Money = previous.values().map(|t| t.total).sum();
        let row = |id: &str, name: &str| {
            let now = current.get(id).cloned().unwrap_or_default();
            let before = previous.get(id).cloned().unwrap_or_default();
            let change = now.total - before.total;
            StoreRow {
                id: id.to_string(),
                name: name.to_string(),
                total: now.total,
                visits: now.visits,
                average_basket: if now.visits == 0 {
                    Money::ZERO
                } else {
                    Money::from_cents(Self::div_round(now.total.cents(), i64::from(now.visits)))
                },
                share_permille: Self::permille(now.total.cents(), total.cents()),
                last_visit: now.last_visit,
                previous_total: before.total,
                previous_visits: before.visits,
                change,
                change_permille: (before.total.cents() > 0)
                    .then(|| Self::div_round(change.cents() * 1000, before.total.cents())),
            }
        };
        let mut chains: Vec<StoreRow> = matcher
            .chains()
            .iter()
            .filter(|c| current.contains_key(&c.id))
            .map(|c| row(&c.id, &c.name))
            .collect();
        chains.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.name.cmp(&b.name)));
        StoreReport {
            chains,
            other: row(OTHER_ID, "Other groceries"),
            total,
            previous_total,
        }
    }

    /// Integer division rounded half away from zero.
    fn div_round(n: i64, d: i64) -> i64 {
        let q = n / d;
        let r = n % d;
        if r.abs() * 2 >= d.abs() {
            q + n.signum() * d.signum()
        } else {
            q
        }
    }

    fn permille(part: i64, whole: i64) -> u32 {
        if whole <= 0 {
            0
        } else {
            Self::div_round(part * 1000, whole).clamp(0, 1000) as u32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn chain_of(m: &StoreMatcher, counterparty: &str, purpose: &str) -> Option<String> {
        m.match_text(counterparty, purpose).map(|c| c.id.clone())
    }

    fn tx(day: Date, who: &str, cents: i64, category: Category) -> Transaction {
        Transaction {
            booking_date: day,
            amount: Money::from_cents(cents),
            counterparty: who.into(),
            purpose: "Kartenzahlung".into(),
            counterparty_iban: None,
            category: Some(category),
        }
    }

    #[test]
    fn matches_realistic_sparkasse_texts() {
        let m = StoreMatcher::builtin();
        for (text, chain) in [
            ("LIDL SAGT DANKE//Berlin/DE", "lidl"),
            ("Lidl Dienstleistung GmbH & Co. KG", "lidl"),
            ("REWE Markt GmbH", "rewe"),
            ("REWE SAGT DANKE//Köln/DE", "rewe"),
            ("REWE-Markt Müller oHG", "rewe"),
            ("ALDI SAGT DANKE", "aldi"),
            ("ALDI SUED", "aldi"),
            ("ALDI SÜD Dienstleistungs-SE & Co. oHG", "aldi"),
            ("Aldi Nord Filiale 123", "aldi"),
            ("KAUFLAND DE 1234", "kaufland"),
            ("Kaufland Stiftung & Co. KG", "kaufland"),
            ("EDEKA Südbayern", "edeka"),
            ("Edeka Handelsgesellschaft Nord mbH", "edeka"),
            ("E CENTER MUELLER//Ulm/DE", "edeka"),
            ("NETTO MARKEN-DISCOUNT AG & CO. KG", "netto"),
            ("Netto//Dresden/DE", "netto"),
            ("PENNY-Markt GmbH", "penny"),
            ("PENNY SAGT DANKE//Bonn/DE", "penny"),
            ("dm-drogerie markt GmbH + Co. KG", "dm"),
            ("DM//Berlin/DE", "dm"),
            ("Dirk Rossmann GmbH", "rossmann"),
            ("ROSSMANN//Hannover/DE", "rossmann"),
            ("NORMA Lebensmittelfilialbetrieb Stiftung & Co. KG", "norma"),
            ("NORMA//Nuernberg/DE", "norma"),
            ("Globus SB-Warenhaus Holding GmbH & Co. KG", "globus"),
            ("tegut... gute Lebensmittel GmbH & Co. KG", "tegut"),
            ("TEGUT//Fulda/DE", "tegut"),
            ("real,- SB-Warenhaus GmbH", "real"),
            ("Marktkauf Hamburg", "marktkauf"),
            ("denn's Biomarkt GmbH", "denns"),
        ] {
            assert_eq!(chain_of(&m, text, ""), Some(chain.into()), "{text}");
        }
    }

    #[test]
    fn does_not_match_look_alikes() {
        let m = StoreMatcher::builtin();
        for text in [
            "ALDI TALK Medion AG",
            "Lidl Connect",
            "Realty Partners GmbH",
            "Admin Services GmbH",
            "Hans Penny Müller",
            "Brutto Netto Rechner",
            "Globus Baumarkt GmbH",
            "REWE Reisen",
            "Amazon EU S.a.r.l.",
            "Real Madrid Fan Shop",
        ] {
            assert_eq!(chain_of(&m, text, ""), None, "{text}");
        }
    }

    #[test]
    fn a_name_at_the_start_of_the_counterparty_is_a_known_false_positive() {
        // short names count at the start of the counterparty, so a person called Norma does too;
        // a [[stores]] entry cannot remove a built-in match, but the transaction can be
        // recategorized and it only counts as a store visit while it is an expense
        let m = StoreMatcher::builtin();
        assert_eq!(chain_of(&m, "Norma Schmidt", ""), Some("norma".into()));
    }

    #[test]
    fn short_names_in_the_middle_of_a_text_do_not_count() {
        let m = StoreMatcher::builtin();
        assert_eq!(chain_of(&m, "Max Penny", ""), None);
        assert_eq!(chain_of(&m, "Sparkasse", "Einkauf bei Norma"), None);
        assert_eq!(chain_of(&m, "Herr dm", ""), None);
    }

    #[test]
    fn purpose_is_consulted_only_when_the_counterparty_has_no_match() {
        let m = StoreMatcher::builtin();
        // a payment processor names the shop in the purpose
        assert_eq!(
            chain_of(
                &m,
                "PayPal (Europe) S.a.r.l. et Cie",
                "1234 PP.1234 PayPal LIDL SAGT DANKE"
            ),
            Some("lidl".into())
        );
        // the counterparty wins over the purpose
        assert_eq!(
            chain_of(&m, "REWE Markt GmbH", "Gutschein Lidl"),
            Some("rewe".into())
        );
        // at-start names do not count in the purpose
        assert_eq!(chain_of(&m, "Sparkasse", "Penny"), None);
    }

    #[test]
    fn user_aliases_add_spellings_and_new_chains() {
        let m = StoreMatcher::with_aliases(&[
            StoreAlias {
                chain: "Edeka".into(),
                patterns: vec!["Mueller Frischemarkt".into()],
            },
            StoreAlias {
                chain: "Bio Company".into(),
                patterns: vec!["BIOCOMPANY GMBH".into()],
            },
            StoreAlias {
                chain: "Hofladen Maier".into(),
                patterns: vec!["Maier Hof".into(), "Hofladen M.".into()],
            },
        ]);
        assert_eq!(
            chain_of(&m, "Mueller Frischemarkt GmbH", ""),
            Some("edeka".into())
        );
        assert_eq!(
            chain_of(&m, "BioCompany GmbH", ""),
            Some("bio-company".into())
        );
        assert_eq!(
            chain_of(&m, "MAIER HOF//Ulm/DE", ""),
            Some("hofladen-maier".into())
        );
        assert_eq!(m.chain("hofladen-maier").unwrap().name, "Hofladen Maier");
        // a built-in chain is not duplicated
        assert_eq!(m.chains().iter().filter(|c| c.id == "edeka").count(), 1);
        assert_eq!(
            m.chains().iter().filter(|c| c.id == "bio-company").count(),
            1
        );
    }

    #[test]
    fn user_aliases_beat_the_table_and_ignore_its_exclusions() {
        let m = StoreMatcher::with_aliases(&[
            StoreAlias {
                chain: "dm".into(),
                patterns: vec!["Rossmann Sonderposten".into()],
            },
            StoreAlias {
                chain: "Handy".into(),
                patterns: vec!["aldi talk".into()],
            },
        ]);
        assert_eq!(chain_of(&m, "Rossmann Sonderposten", ""), Some("dm".into()));
        assert_eq!(chain_of(&m, "ALDI TALK", ""), Some("handy".into()));
        assert_eq!(
            chain_of(&m, "Dirk Rossmann GmbH", ""),
            Some("rossmann".into())
        );
    }

    #[test]
    fn the_reserved_name_other_is_not_a_chain() {
        let m = StoreMatcher::with_aliases(&[StoreAlias {
            chain: "other".into(),
            patterns: vec!["whatever shop".into()],
        }]);
        assert_eq!(chain_of(&m, "whatever shop", ""), None);
    }

    #[test]
    fn totals_count_expenses_in_range_only() {
        let m = StoreMatcher::builtin();
        let txs = vec![
            tx(
                date!(2026 - 10 - 02),
                "LIDL SAGT DANKE//Berlin/DE",
                -2350,
                Category::Groceries,
            ),
            tx(
                date!(2026 - 10 - 09),
                "LIDL SAGT DANKE//Berlin/DE",
                -1000,
                Category::Groceries,
            ),
            tx(
                date!(2026 - 10 - 05),
                "REWE Markt GmbH",
                -5000,
                Category::Groceries,
            ),
            tx(
                date!(2026 - 10 - 06),
                "Bäckerei Kranz",
                -450,
                Category::Groceries,
            ), // unmatched grocery
            tx(
                date!(2026 - 10 - 07),
                "dm-drogerie markt",
                -1999,
                Category::Shopping,
            ), // matched, not groceries
            tx(date!(2026 - 10 - 08), "Amazon", -3000, Category::Shopping), // not a store
            tx(
                date!(2026 - 10 - 08),
                "REWE Markt GmbH",
                1200,
                Category::Groceries,
            ), // refund: ignored
            tx(date!(2026 - 09 - 30), "LIDL", -9999, Category::Groceries),  // out of range
            tx(date!(2026 - 10 - 11), "LIDL", -9999, Category::Groceries),  // out of range
        ];
        let t = StoreSpending::totals(&m, &txs, date!(2026 - 10 - 01), date!(2026 - 10 - 10));
        assert_eq!(t["lidl"].total, Money::from_cents(3350));
        assert_eq!(t["lidl"].visits, 2);
        assert_eq!(t["lidl"].last_visit, Some(date!(2026 - 10 - 09)));
        assert_eq!(t["rewe"].total, Money::from_cents(5000));
        assert_eq!(t["dm"].total, Money::from_cents(1999));
        assert_eq!(t[OTHER_ID].total, Money::from_cents(450));
        assert!(!t.contains_key("amazon"));
        assert_eq!(t.len(), 4);
    }

    #[test]
    fn report_ranks_and_compares() {
        let m = StoreMatcher::builtin();
        let now = vec![
            tx(date!(2026 - 10 - 02), "LIDL", -2000, Category::Groceries),
            tx(date!(2026 - 10 - 03), "LIDL", -1000, Category::Groceries),
            tx(date!(2026 - 10 - 04), "REWE", -6000, Category::Groceries),
            tx(
                date!(2026 - 10 - 05),
                "Hofladen",
                -1000,
                Category::Groceries,
            ),
        ];
        let before = vec![
            tx(date!(2026 - 09 - 02), "LIDL", -4500, Category::Groceries),
            tx(date!(2026 - 09 - 04), "REWE", -6000, Category::Groceries),
            tx(date!(2026 - 09 - 05), "ALDI", -500, Category::Groceries),
        ];
        let cur = StoreSpending::totals(&m, &now, date!(2026 - 10 - 01), date!(2026 - 10 - 31));
        let prev = StoreSpending::totals(&m, &before, date!(2026 - 09 - 01), date!(2026 - 09 - 30));
        let r = StoreSpending::report(&m, &cur, &prev);

        assert_eq!(r.total, Money::from_cents(10_000));
        assert_eq!(r.previous_total, Money::from_cents(11_000));
        let ids: Vec<_> = r.chains.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["rewe", "lidl"]); // ranked by spend; aldi only in the old range
        let rewe = &r.chains[0];
        assert_eq!(rewe.share_permille, 600);
        assert_eq!(rewe.change, Money::ZERO);
        assert_eq!(rewe.change_permille, Some(0));
        let lidl = &r.chains[1];
        assert_eq!(lidl.visits, 2);
        assert_eq!(lidl.average_basket, Money::from_cents(1500));
        assert_eq!(lidl.share_permille, 300);
        assert_eq!(lidl.last_visit, Some(date!(2026 - 10 - 03)));
        assert_eq!(lidl.previous_total, Money::from_cents(4500));
        assert_eq!(lidl.change, Money::from_cents(-1500));
        assert_eq!(lidl.change_permille, Some(-333));
        assert_eq!(r.other.total, Money::from_cents(1000));
        assert_eq!(r.other.share_permille, 100);
        assert_eq!(r.other.change_permille, None); // nothing in the old range
    }

    #[test]
    fn report_for_an_empty_range_is_all_zero() {
        let m = StoreMatcher::builtin();
        let r = StoreSpending::report(&m, &BTreeMap::new(), &BTreeMap::new());
        assert!(r.chains.is_empty());
        assert_eq!(r.total, Money::ZERO);
        assert_eq!(r.other.visits, 0);
        assert_eq!(r.other.share_permille, 0);
        assert_eq!(r.other.average_basket, Money::ZERO);
    }

    #[test]
    fn rounding_is_half_away_from_zero() {
        assert_eq!(StoreSpending::div_round(10, 4), 3);
        assert_eq!(StoreSpending::div_round(-10, 4), -3);
        assert_eq!(StoreSpending::div_round(9, 4), 2);
        assert_eq!(StoreSpending::div_round(-1500 * 1000, 4500), -333);
    }
}
