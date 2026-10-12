//! User-defined categorization rules: "counterparty name contains / equals / starts with X
//! (optionally only expenses or income, optionally within an amount range) -> category".
//! Rules are tried in priority order and win over the built-in rules of the `Categorizer`.

use serde::{Deserialize, Serialize};

use crate::category::Category;
use crate::money::Money;
use crate::transaction::{NameNormalizer, Transaction};

/// How the rule pattern is compared with the counterparty name. Both sides are normalized
/// first (`NameNormalizer`), so case, digits and punctuation do not matter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    Contains,
    Equals,
    StartsWith,
}

/// Restricts a rule to money leaving or entering the account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmountSign {
    Expense,
    Income,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RuleError {
    #[error("the pattern needs at least one letter")]
    EmptyPattern,
    #[error("the smallest amount is larger than the largest amount")]
    EmptyRange,
    #[error("amounts must not be negative (they are compared without sign)")]
    NegativeAmount,
}

/// A user rule. `min`/`max` compare the amount without its sign, so "between 5 and 20 euro"
/// matches both a 12.00 payment and a 12.00 refund unless `sign` narrows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserRule {
    pub id: i64,
    pub pattern: String,
    pub kind: MatchKind,
    pub sign: Option<AmountSign>,
    pub min: Option<Money>,
    pub max: Option<Money>,
    pub category: Category,
}

impl UserRule {
    /// Check the fields the way the API accepts them.
    pub fn validate(&self) -> Result<(), RuleError> {
        if NameNormalizer::normalize(&self.pattern).is_empty() {
            return Err(RuleError::EmptyPattern);
        }
        if self.min.is_some_and(Money::is_negative) || self.max.is_some_and(Money::is_negative) {
            return Err(RuleError::NegativeAmount);
        }
        if let (Some(min), Some(max)) = (self.min, self.max) {
            if min > max {
                return Err(RuleError::EmptyRange);
            }
        }
        Ok(())
    }

    pub fn matches(&self, tx: &Transaction) -> bool {
        let pattern = NameNormalizer::normalize(&self.pattern);
        if pattern.is_empty() {
            return false;
        }
        let name = NameNormalizer::normalize(&tx.counterparty);
        let name_ok = match self.kind {
            MatchKind::Contains => name.contains(&pattern),
            MatchKind::Equals => name == pattern,
            MatchKind::StartsWith => name.starts_with(&pattern),
        };
        if !name_ok {
            return false;
        }
        let sign_ok = match self.sign {
            None => true,
            Some(AmountSign::Expense) => tx.amount.is_negative(),
            Some(AmountSign::Income) => tx.amount.cents() > 0,
        };
        let size = tx.amount.abs();
        sign_ok && self.min.is_none_or(|m| size >= m) && self.max.is_none_or(|m| size <= m)
    }

    /// Whether this rule is the plain "this merchant, any amount" rule that remembering a
    /// correction creates, so a second correction updates it instead of adding another.
    pub fn is_plain_merchant_rule(&self, counterparty: &str) -> bool {
        self.kind == MatchKind::Equals
            && self.sign.is_none()
            && self.min.is_none()
            && self.max.is_none()
            && NameNormalizer::normalize(&self.pattern) == NameNormalizer::normalize(counterparty)
    }
}

/// Rules in priority order (first match wins).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RuleSet {
    rules: Vec<UserRule>,
}

impl RuleSet {
    /// `rules` must already be in priority order.
    pub fn new(rules: Vec<UserRule>) -> Self {
        Self { rules }
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    pub fn first_match(&self, tx: &Transaction) -> Option<&UserRule> {
        self.rules.iter().find(|r| r.matches(tx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    struct Fixture;

    impl Fixture {
        fn tx(counterparty: &str, cents: i64) -> Transaction {
            Transaction {
                booking_date: date!(2026 - 03 - 02),
                amount: Money::from_cents(cents),
                counterparty: counterparty.into(),
                purpose: String::new(),
                counterparty_iban: None,
                category: None,
            }
        }

        fn rule(pattern: &str, kind: MatchKind, category: Category) -> UserRule {
            UserRule {
                id: 1,
                pattern: pattern.into(),
                kind,
                sign: None,
                min: None,
                max: None,
                category,
            }
        }
    }

    #[test]
    fn name_kinds_compare_normalized_names() {
        let t = Fixture::tx("REWE Markt 1234 Köln", -1000);
        let contains = Fixture::rule("markt", MatchKind::Contains, Category::Leisure);
        let starts = Fixture::rule("Rewe", MatchKind::StartsWith, Category::Leisure);
        let starts_no = Fixture::rule("markt", MatchKind::StartsWith, Category::Leisure);
        let equals = Fixture::rule("rewe markt köln", MatchKind::Equals, Category::Leisure);
        let equals_no = Fixture::rule("rewe", MatchKind::Equals, Category::Leisure);
        assert!(contains.matches(&t));
        assert!(starts.matches(&t));
        assert!(!starts_no.matches(&t));
        assert!(equals.matches(&t));
        assert!(!equals_no.matches(&t));
    }

    #[test]
    fn purpose_is_not_matched() {
        let mut t = Fixture::tx("Someone", -1000);
        t.purpose = "rewe".into();
        assert!(!Fixture::rule("rewe", MatchKind::Contains, Category::Leisure).matches(&t));
    }

    #[test]
    fn sign_and_amount_range_narrow_a_rule() {
        let mut r = Fixture::rule("kiosk", MatchKind::Contains, Category::Dining);
        r.sign = Some(AmountSign::Expense);
        r.min = Some(Money::from_cents(500));
        r.max = Some(Money::from_cents(2000));
        assert!(r.matches(&Fixture::tx("Kiosk", -500)));
        assert!(r.matches(&Fixture::tx("Kiosk", -2000)));
        assert!(!r.matches(&Fixture::tx("Kiosk", -499)));
        assert!(!r.matches(&Fixture::tx("Kiosk", -2001)));
        assert!(!r.matches(&Fixture::tx("Kiosk", 1000))); // a refund
        r.sign = Some(AmountSign::Income);
        assert!(r.matches(&Fixture::tx("Kiosk", 1000)));
        r.sign = None;
        assert!(r.matches(&Fixture::tx("Kiosk", 1000)));
    }

    #[test]
    fn first_rule_in_order_wins() {
        let a = Fixture::rule("rewe", MatchKind::Contains, Category::Leisure);
        let b = Fixture::rule("rewe", MatchKind::Contains, Category::Health);
        let set = RuleSet::new(vec![a, b]);
        assert_eq!(
            set.first_match(&Fixture::tx("REWE", -100))
                .unwrap()
                .category,
            Category::Leisure
        );
        assert!(set.first_match(&Fixture::tx("Lidl", -100)).is_none());
    }

    #[test]
    fn validation_rejects_bad_rules() {
        let mut r = Fixture::rule("  1234 ", MatchKind::Contains, Category::Other);
        assert_eq!(r.validate(), Err(RuleError::EmptyPattern));
        r.pattern = "x".into();
        assert_eq!(r.validate(), Ok(()));
        r.min = Some(Money::from_cents(10));
        r.max = Some(Money::from_cents(5));
        assert_eq!(r.validate(), Err(RuleError::EmptyRange));
        r.min = Some(Money::from_cents(-1));
        assert_eq!(r.validate(), Err(RuleError::NegativeAmount));
        // an empty pattern never matches, even if it slipped through
        let empty = Fixture::rule("", MatchKind::Contains, Category::Other);
        assert!(!empty.matches(&Fixture::tx("anything", -1)));
    }

    #[test]
    fn plain_merchant_rule_detection() {
        let r = Fixture::rule("rewe markt", MatchKind::Equals, Category::Groceries);
        assert!(r.is_plain_merchant_rule("REWE Markt 12"));
        assert!(!r.is_plain_merchant_rule("Lidl"));
        let mut narrowed = r.clone();
        narrowed.sign = Some(AmountSign::Expense);
        assert!(!narrowed.is_plain_merchant_rule("REWE Markt"));
    }
}
