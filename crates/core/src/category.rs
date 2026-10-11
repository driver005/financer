use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::rules::RuleSet;
use crate::transaction::{NameNormalizer, Transaction};

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

impl Rule {
    const fn new(needle: &'static str, category: Category) -> Self {
        Self { needle, category }
    }
}

/// Substring rules on the normalized counterparty + purpose. First match wins, so more
/// specific needles come before general ones.
const DEFAULT_RULES: &[Rule] = &[
    Rule::new("gehalt", Category::Income),
    Rule::new("lohn", Category::Income),
    Rule::new("rewe", Category::Groceries),
    Rule::new("lidl", Category::Groceries),
    Rule::new("aldi", Category::Groceries),
    Rule::new("kaufland", Category::Groceries),
    Rule::new("edeka", Category::Groceries),
    Rule::new("penny", Category::Groceries),
    Rule::new("netto", Category::Groceries),
    Rule::new("dm drogerie", Category::Shopping),
    Rule::new("rossmann", Category::Shopping),
    Rule::new("amazon", Category::Shopping),
    Rule::new("lieferando", Category::Dining),
    Rule::new("restaurant", Category::Dining),
    Rule::new("mcdonald", Category::Dining),
    Rule::new("cafe", Category::Dining),
    Rule::new("bäckerei", Category::Dining),
    Rule::new("deutsche bahn", Category::Transport),
    Rule::new("db vertrieb", Category::Transport),
    Rule::new("aral", Category::Transport),
    Rule::new("shell", Category::Transport),
    Rule::new("tankstelle", Category::Transport),
    Rule::new("bvg", Category::Transport),
    Rule::new("miete", Category::Housing),
    Rule::new("stadtwerke", Category::Utilities),
    Rule::new("strom", Category::Utilities),
    Rule::new("telekom", Category::Utilities),
    Rule::new("vodafone", Category::Utilities),
    Rule::new("rundfunk", Category::Utilities),
    Rule::new("versicherung", Category::Insurance),
    Rule::new("allianz", Category::Insurance),
    Rule::new("apotheke", Category::Health),
    Rule::new("arzt", Category::Health),
    Rule::new("netflix", Category::Subscriptions),
    Rule::new("spotify", Category::Subscriptions),
    Rule::new("disney", Category::Subscriptions),
    Rule::new("kino", Category::Leisure),
    Rule::new("fitness", Category::Leisure),
    Rule::new("geldautomat", Category::Cash),
    Rule::new("bargeld", Category::Cash),
    Rule::new("sparplan", Category::Savings),
];

/// Rule-based categorizer. User corrections (`learn`) are keyed by normalized counterparty
/// and always beat the built-in rules.
#[derive(Debug, Clone, Default)]
pub struct Categorizer {
    overrides: HashMap<String, Category>,
    rules: RuleSet,
}

impl Categorizer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remember that this counterparty belongs to `category` from now on.
    pub fn learn(&mut self, counterparty: &str, category: Category) {
        self.overrides
            .insert(NameNormalizer::normalize(counterparty), category);
    }

    /// Put the user's own rules (in priority order) in front of the built-in ones.
    pub fn with_rules(mut self, rules: RuleSet) -> Self {
        self.rules = rules;
        self
    }

    pub fn categorize(&self, tx: &Transaction) -> Category {
        if let Some(rule) = self.rules.first_match(tx) {
            return rule.category;
        }
        if let Some(c) = self
            .overrides
            .get(&NameNormalizer::normalize(&tx.counterparty))
        {
            return *c;
        }
        let haystack = format!(
            "{} {}",
            NameNormalizer::normalize(&tx.counterparty),
            NameNormalizer::normalize(&tx.purpose)
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

    struct Fixture;

    impl Fixture {
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
    }

    #[test]
    fn matches_default_rules() {
        let c = Categorizer::new();
        assert_eq!(
            c.categorize(&Fixture::tx("REWE SAGT DANKE", "Kartenzahlung", -2347)),
            Category::Groceries
        );
        assert_eq!(
            c.categorize(&Fixture::tx("Vermieter GmbH", "Miete März", -80000)),
            Category::Housing
        );
        assert_eq!(
            c.categorize(&Fixture::tx("Arbeitgeber AG", "Gehalt 03/2026", 250000)),
            Category::Income
        );
    }

    #[test]
    fn unknown_falls_back_by_sign() {
        let c = Categorizer::new();
        assert_eq!(
            c.categorize(&Fixture::tx("Unbekannt", "", -500)),
            Category::Other
        );
        assert_eq!(
            c.categorize(&Fixture::tx("Oma", "Geschenk", 5000)),
            Category::Income
        );
    }

    #[test]
    fn user_corrections_beat_rules() {
        let mut c = Categorizer::new();
        let t = Fixture::tx("Rewe Gutschein Shop", "", -1000);
        assert_eq!(c.categorize(&t), Category::Groceries);
        c.learn("REWE gutschein shop", Category::Leisure);
        assert_eq!(c.categorize(&t), Category::Leisure);
    }

    #[test]
    fn user_rules_beat_built_in_rules_in_priority_order() {
        use crate::rules::{MatchKind, UserRule};
        let rule = |id, pattern: &str, category| UserRule {
            id,
            pattern: pattern.into(),
            kind: MatchKind::Contains,
            sign: None,
            min: None,
            max: None,
            category,
        };
        let t = Fixture::tx("Rewe Gutschein Shop", "", -1000);
        let plain = Categorizer::new();
        assert_eq!(plain.categorize(&t), Category::Groceries);
        let c = Categorizer::new().with_rules(RuleSet::new(vec![
            rule(1, "gutschein", Category::Leisure),
            rule(2, "rewe", Category::Health),
        ]));
        assert_eq!(c.categorize(&t), Category::Leisure);
        // a rule that does not match leaves the built-in rules in charge
        assert_eq!(
            c.categorize(&Fixture::tx("Lidl", "", -100)),
            Category::Groceries
        );
    }

    #[test]
    fn serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&Category::Groceries).unwrap(),
            "\"groceries\""
        );
    }
}
