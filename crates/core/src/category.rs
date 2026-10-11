use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::transaction::{normalize_name, Transaction};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Groceries,
    Dining,
    Transport,
    Housing,
    Utilities,
    Insurance,
    Subscriptions,
    Health,
    Leisure,
    Shopping,
    Cash,
    Savings,
    Income,
    Other,
}

struct Rule {
    needle: &'static str,
    category: Category,
}

const fn rule(needle: &'static str, category: Category) -> Rule {
    Rule { needle, category }
}

/// Substring rules on the normalized counterparty + purpose. First match wins, so more
/// specific needles come before general ones.
const DEFAULT_RULES: &[Rule] = &[
    rule("gehalt", Category::Income),
    rule("lohn", Category::Income),
    rule("rewe", Category::Groceries),
    rule("lidl", Category::Groceries),
    rule("aldi", Category::Groceries),
    rule("kaufland", Category::Groceries),
    rule("edeka", Category::Groceries),
    rule("penny", Category::Groceries),
    rule("netto", Category::Groceries),
    rule("dm drogerie", Category::Shopping),
    rule("rossmann", Category::Shopping),
    rule("amazon", Category::Shopping),
    rule("lieferando", Category::Dining),
    rule("restaurant", Category::Dining),
    rule("mcdonald", Category::Dining),
    rule("cafe", Category::Dining),
    rule("bäckerei", Category::Dining),
    rule("deutsche bahn", Category::Transport),
    rule("db vertrieb", Category::Transport),
    rule("aral", Category::Transport),
    rule("shell", Category::Transport),
    rule("tankstelle", Category::Transport),
    rule("bvg", Category::Transport),
    rule("miete", Category::Housing),
    rule("stadtwerke", Category::Utilities),
    rule("strom", Category::Utilities),
    rule("telekom", Category::Utilities),
    rule("vodafone", Category::Utilities),
    rule("rundfunk", Category::Utilities),
    rule("versicherung", Category::Insurance),
    rule("allianz", Category::Insurance),
    rule("apotheke", Category::Health),
    rule("arzt", Category::Health),
    rule("netflix", Category::Subscriptions),
    rule("spotify", Category::Subscriptions),
    rule("disney", Category::Subscriptions),
    rule("kino", Category::Leisure),
    rule("fitness", Category::Leisure),
    rule("geldautomat", Category::Cash),
    rule("bargeld", Category::Cash),
    rule("sparplan", Category::Savings),
];

/// Rule-based categorizer. User corrections (`learn`) are keyed by normalized counterparty
/// and always beat the built-in rules.
#[derive(Debug, Clone, Default)]
pub struct Categorizer {
    overrides: HashMap<String, Category>,
}

impl Categorizer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remember that this counterparty belongs to `category` from now on.
    pub fn learn(&mut self, counterparty: &str, category: Category) {
        self.overrides
            .insert(normalize_name(counterparty), category);
    }

    pub fn categorize(&self, tx: &Transaction) -> Category {
        if let Some(c) = self.overrides.get(&normalize_name(&tx.counterparty)) {
            return *c;
        }
        let haystack = format!(
            "{} {}",
            normalize_name(&tx.counterparty),
            normalize_name(&tx.purpose)
        );
        for r in DEFAULT_RULES {
            if haystack.contains(r.needle) {
                return r.category;
            }
        }
        if tx.amount.cents() > 0 {
            Category::Income
        } else {
            Category::Other
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::money::Money;
    use time::macros::date;

    fn tx(counterparty: &str, purpose: &str, cents: i64) -> Transaction {
        Transaction {
            booking_date: date!(2026 - 03 - 02),
            amount: Money::from_cents(cents),
            counterparty: counterparty.into(),
            purpose: purpose.into(),
            counterparty_iban: None,
            category: None,
        }
    }

    #[test]
    fn matches_default_rules() {
        let c = Categorizer::new();
        assert_eq!(
            c.categorize(&tx("REWE SAGT DANKE", "Kartenzahlung", -2347)),
            Category::Groceries
        );
        assert_eq!(
            c.categorize(&tx("Vermieter GmbH", "Miete März", -80000)),
            Category::Housing
        );
        assert_eq!(
            c.categorize(&tx("Arbeitgeber AG", "Gehalt 03/2026", 250000)),
            Category::Income
        );
    }

    #[test]
    fn unknown_falls_back_by_sign() {
        let c = Categorizer::new();
        assert_eq!(c.categorize(&tx("Unbekannt", "", -500)), Category::Other);
        assert_eq!(c.categorize(&tx("Oma", "Geschenk", 5000)), Category::Income);
    }

    #[test]
    fn user_corrections_beat_rules() {
        let mut c = Categorizer::new();
        let t = tx("Rewe Gutschein Shop", "", -1000);
        assert_eq!(c.categorize(&t), Category::Groceries);
        c.learn("REWE gutschein shop", Category::Leisure);
        assert_eq!(c.categorize(&t), Category::Leisure);
    }

    #[test]
    fn serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&Category::Groceries).unwrap(),
            "\"groceries\""
        );
    }
}
