use serde::{Deserialize, Serialize};
use time::Date;

use crate::category::Category;
use crate::money::Money;

/// One booked account movement. `amount` is negative for money leaving the account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub booking_date: Date,
    pub amount: Money,
    pub counterparty: String,
    pub purpose: String,
    pub counterparty_iban: Option<String>,
    pub category: Option<Category>,
}

impl Transaction {
    pub fn is_expense(&self) -> bool {
        self.amount.is_negative()
    }

    /// Stable identity used to skip duplicates when the same period is imported or synced twice.
    pub fn fingerprint(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.booking_date,
            self.amount.cents(),
            NameNormalizer::normalize(&self.counterparty),
            NameNormalizer::normalize(&self.purpose),
        )
    }
}

/// Normalizes free-text names (counterparties, purposes, product titles) for grouping and matching.
pub struct NameNormalizer;

impl NameNormalizer {
    /// Lowercase, collapse whitespace and strip punctuation/digits-noise so that
    /// `"REWE SAGT DANKE 1234"` and `"Rewe sagt danke"` group together.
    pub fn normalize(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut last_space = true;
        for c in input.chars().flat_map(|c| c.to_lowercase()) {
            if c.is_alphabetic() {
                out.push(c);
                last_space = false;
            } else if !last_space {
                out.push(' ');
                last_space = true;
            }
        }
        out.trim_end().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn normalizes_merchant_names() {
        assert_eq!(
            NameNormalizer::normalize("REWE SAGT DANKE 1234/Köln"),
            "rewe sagt danke köln"
        );
        assert_eq!(NameNormalizer::normalize("  Lidl  "), "lidl");
    }

    #[test]
    fn fingerprint_ignores_case_and_noise() {
        let a = Transaction {
            booking_date: date!(2026 - 03 - 02),
            amount: Money::from_cents(-2347),
            counterparty: "REWE Markt 123".into(),
            purpose: "Kartenzahlung".into(),
            counterparty_iban: None,
            category: None,
        };
        let mut b = a.clone();
        b.counterparty = "rewe markt 456".into();
        assert_eq!(a.fingerprint(), b.fingerprint());
    }
}
