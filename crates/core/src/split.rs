//! Split transactions: one booking divided into parts with their own category (a supermarket
//! receipt that also holds a bottle deposit and a gift card, say). The parts must add up to the
//! booked amount exactly, and category totals use the parts instead of the whole.

use serde::{Deserialize, Serialize};

use crate::category::Category;
use crate::money::Money;
use crate::transaction::Transaction;

/// One part of a split transaction. `amount` has the same sign as the booking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SplitPart {
    pub amount: Money,
    pub category: Category,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SplitError {
    #[error("a split needs at least two parts")]
    TooFewParts,
    #[error("a transaction with amount 0 cannot be split")]
    ZeroTotal,
    #[error("every part needs a non-zero amount with the same sign as the transaction")]
    BadPartAmount,
    #[error("the parts add up to {parts} cents but the transaction is {total} cents")]
    SumMismatch { parts: i64, total: i64 },
    #[error("a note may be at most {0} characters")]
    NoteTooLong(usize),
}

pub struct Splitter;

impl Splitter {
    pub const MAX_NOTE_CHARS: usize = 200;

    /// Check that `parts` divide `total` exactly.
    pub fn validate(total: Money, parts: &[SplitPart]) -> Result<(), SplitError> {
        if parts.len() < 2 {
            return Err(SplitError::TooFewParts);
        }
        if total.cents() == 0 {
            return Err(SplitError::ZeroTotal);
        }
        let mut sum = 0i64;
        for p in parts {
            let c = p.amount.cents();
            if c == 0 || (c < 0) != total.is_negative() {
                return Err(SplitError::BadPartAmount);
            }
            if p.note
                .as_ref()
                .is_some_and(|n| n.chars().count() > Self::MAX_NOTE_CHARS)
            {
                return Err(SplitError::NoteTooLong(Self::MAX_NOTE_CHARS));
            }
            sum = sum.checked_add(c).ok_or(SplitError::SumMismatch {
                parts: i64::MAX,
                total: total.cents(),
            })?;
        }
        if sum != total.cents() {
            return Err(SplitError::SumMismatch {
                parts: sum,
                total: total.cents(),
            });
        }
        Ok(())
    }

    /// What category totals should see for one booking: the transaction itself when it is not
    /// split, otherwise one transaction per part (same date and counterparty, the part's amount
    /// and category). Budget and spending sums stay correct because the parts add up to the
    /// whole.
    pub fn effective(tx: &Transaction, parts: &[SplitPart]) -> Vec<Transaction> {
        if parts.is_empty() {
            return vec![tx.clone()];
        }
        parts
            .iter()
            .map(|p| Transaction {
                amount: p.amount,
                category: Some(p.category),
                ..tx.clone()
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::{Budget, YearMonth};
    use time::macros::date;
    use time::Month;

    struct Fixture;

    impl Fixture {
        fn tx(cents: i64, category: Category) -> Transaction {
            Transaction {
                booking_date: date!(2026 - 03 - 02),
                amount: Money::from_cents(cents),
                counterparty: "Rewe".into(),
                purpose: String::new(),
                counterparty_iban: None,
                category: Some(category),
            }
        }

        fn part(cents: i64, category: Category) -> SplitPart {
            SplitPart {
                amount: Money::from_cents(cents),
                category,
                note: None,
            }
        }
    }

    #[test]
    fn parts_must_sum_exactly() {
        let total = Money::from_cents(-5000);
        let ok = [
            Fixture::part(-3000, Category::Groceries),
            Fixture::part(-2000, Category::Shopping),
        ];
        assert_eq!(Splitter::validate(total, &ok), Ok(()));

        let short = [
            Fixture::part(-3000, Category::Groceries),
            Fixture::part(-1999, Category::Shopping),
        ];
        assert_eq!(
            Splitter::validate(total, &short),
            Err(SplitError::SumMismatch {
                parts: -4999,
                total: -5000
            })
        );
    }

    #[test]
    fn rejects_single_part_zero_and_wrong_sign_parts() {
        let total = Money::from_cents(-5000);
        assert_eq!(
            Splitter::validate(total, &[Fixture::part(-5000, Category::Groceries)]),
            Err(SplitError::TooFewParts)
        );
        // -6000 + 1000 sums to the total but a positive part inside an expense is not a part
        assert_eq!(
            Splitter::validate(
                Money::from_cents(-5000),
                &[
                    Fixture::part(-6000, Category::Groceries),
                    Fixture::part(1000, Category::Shopping)
                ]
            ),
            Err(SplitError::BadPartAmount)
        );
        assert_eq!(
            Splitter::validate(
                total,
                &[
                    Fixture::part(0, Category::Groceries),
                    Fixture::part(-5000, Category::Shopping)
                ]
            ),
            Err(SplitError::BadPartAmount)
        );
        assert_eq!(
            Splitter::validate(
                Money::ZERO,
                &[
                    Fixture::part(1, Category::Groceries),
                    Fixture::part(-1, Category::Shopping)
                ]
            ),
            Err(SplitError::ZeroTotal)
        );
    }

    #[test]
    fn income_can_be_split_too_and_notes_are_capped() {
        let total = Money::from_cents(10_000);
        let parts = [
            Fixture::part(7_000, Category::Income),
            Fixture::part(3_000, Category::Other),
        ];
        assert_eq!(Splitter::validate(total, &parts), Ok(()));
        let mut long = parts.clone();
        long[0].note = Some("x".repeat(201));
        assert_eq!(
            Splitter::validate(total, &long),
            Err(SplitError::NoteTooLong(200))
        );
    }

    #[test]
    fn category_totals_use_the_parts_instead_of_the_whole() {
        let march = YearMonth::new(2026, Month::March);
        let whole = Fixture::tx(-5000, Category::Groceries);
        let other = Fixture::tx(-1000, Category::Groceries);
        let parts = vec![
            Fixture::part(-3000, Category::Groceries),
            Fixture::part(-1500, Category::Shopping),
            Fixture::part(-500, Category::Savings), // not spending
        ];

        let unsplit = Budget::spent_by_category(&[whole.clone(), other.clone()], march);
        assert_eq!(unsplit[&Category::Groceries], Money::from_cents(6000));

        let mut effective = Splitter::effective(&whole, &parts);
        effective.extend(Splitter::effective(&other, &[]));
        let split = Budget::spent_by_category(&effective, march);
        assert_eq!(split[&Category::Groceries], Money::from_cents(4000));
        assert_eq!(split[&Category::Shopping], Money::from_cents(1500));
        assert!(!split.contains_key(&Category::Savings));
        assert_eq!(
            effective.iter().map(|t| t.amount).sum::<Money>().cents(),
            -6000
        );
    }
}
