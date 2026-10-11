use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::{Date, Duration, Month};

use crate::money::Money;
use crate::transaction::{normalize_name, Transaction};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cadence {
    Weekly,
    Monthly,
    Quarterly,
    Yearly,
}

impl Cadence {
    fn nominal_days(self) -> i64 {
        match self {
            Cadence::Weekly => 7,
            Cadence::Monthly => 30,
            Cadence::Quarterly => 91,
            Cadence::Yearly => 365,
        }
    }

    /// The next booking after `last`: calendar-aware for monthly and longer rhythms
    /// (the 1st stays the 1st), a plain 7 days for weekly.
    fn next_after(self, last: Date) -> Date {
        match self {
            Cadence::Weekly => last + Duration::days(7),
            Cadence::Monthly => add_months(last, 1),
            Cadence::Quarterly => add_months(last, 3),
            Cadence::Yearly => add_months(last, 12),
        }
    }

    fn classify(median_gap_days: i64) -> Option<Cadence> {
        [
            Cadence::Weekly,
            Cadence::Monthly,
            Cadence::Quarterly,
            Cadence::Yearly,
        ]
        .into_iter()
        .find(|c| {
            let n = c.nominal_days();
            (median_gap_days - n).abs() <= (n / 10).max(2)
        })
    }
}

/// `date` plus `months` calendar months; the day is clamped to the target month's length
/// (31 Jan + 1 month = 28/29 Feb).
fn add_months(date: Date, months: i32) -> Date {
    let index = date.year() * 12 + (date.month() as i32 - 1) + months;
    let year = index.div_euclid(12);
    let month = Month::try_from(index.rem_euclid(12) as u8 + 1).expect("1..=12");
    let day = date.day().min(month.length(year));
    Date::from_calendar_date(year, month, day).expect("clamped day is valid")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecurringPayment {
    pub counterparty: String,
    pub amount: Money,
    pub cadence: Cadence,
    pub last_date: Date,
    pub next_expected: Date,
}

/// Find payments that repeat on a steady rhythm with a steady amount.
///
/// A group qualifies with at least three bookings from the same counterparty and sign,
/// whose gaps cluster around one cadence and whose amounts stay within 10% of the median.
pub fn detect_recurring(transactions: &[Transaction]) -> Vec<RecurringPayment> {
    let mut groups: BTreeMap<(String, bool), Vec<&Transaction>> = BTreeMap::new();
    for tx in transactions {
        groups
            .entry((normalize_name(&tx.counterparty), tx.amount.is_negative()))
            .or_default()
            .push(tx);
    }

    let mut found = Vec::new();
    for ((_, _), mut txs) in groups {
        if txs.len() < 3 {
            continue;
        }
        txs.sort_by_key(|t| t.booking_date);

        let mut gaps: Vec<i64> = txs
            .windows(2)
            .map(|w| (w[1].booking_date - w[0].booking_date).whole_days())
            .collect();
        gaps.sort_unstable();
        let median_gap = gaps[gaps.len() / 2];
        let Some(cadence) = Cadence::classify(median_gap) else {
            continue;
        };

        let mut amounts: Vec<i64> = txs.iter().map(|t| t.amount.cents()).collect();
        amounts.sort_unstable();
        let median_amount = amounts[amounts.len() / 2];
        let tolerance = median_amount.abs() / 10;
        if amounts
            .iter()
            .any(|a| (a - median_amount).abs() > tolerance)
        {
            continue;
        }

        let last = txs.last().expect("non-empty group");
        found.push(RecurringPayment {
            counterparty: last.counterparty.clone(),
            amount: Money::from_cents(median_amount),
            cadence,
            last_date: last.booking_date,
            next_expected: cadence.next_after(last.booking_date),
        });
    }
    found.sort_by(|a, b| a.counterparty.cmp(&b.counterparty));
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn tx(date: Date, who: &str, cents: i64) -> Transaction {
        Transaction {
            booking_date: date,
            amount: Money::from_cents(cents),
            counterparty: who.into(),
            purpose: String::new(),
            counterparty_iban: None,
            category: None,
        }
    }

    #[test]
    fn detects_monthly_rent_and_salary() {
        let txs = vec![
            tx(date!(2026 - 01 - 01), "Vermieter", -80000),
            tx(date!(2026 - 02 - 01), "Vermieter", -80000),
            tx(date!(2026 - 03 - 02), "Vermieter", -80000),
            tx(date!(2026 - 01 - 28), "Arbeitgeber", 250000),
            tx(date!(2026 - 02 - 27), "Arbeitgeber", 250000),
            tx(date!(2026 - 03 - 28), "Arbeitgeber", 250000),
        ];
        let found = detect_recurring(&txs);
        assert_eq!(found.len(), 2);
        let rent = found
            .iter()
            .find(|r| r.counterparty == "Vermieter")
            .unwrap();
        assert_eq!(rent.cadence, Cadence::Monthly);
        assert_eq!(rent.amount, Money::from_cents(-80000));
        assert_eq!(rent.next_expected, date!(2026 - 04 - 02));
    }

    #[test]
    fn next_expected_follows_the_calendar() {
        assert_eq!(add_months(date!(2026 - 03 - 01), 1), date!(2026 - 04 - 01));
        assert_eq!(add_months(date!(2026 - 01 - 31), 1), date!(2026 - 02 - 28));
        assert_eq!(add_months(date!(2028 - 01 - 31), 1), date!(2028 - 02 - 29));
        assert_eq!(add_months(date!(2026 - 11 - 15), 3), date!(2027 - 02 - 15));
        assert_eq!(add_months(date!(2026 - 06 - 10), 12), date!(2027 - 06 - 10));
        assert_eq!(
            Cadence::Weekly.next_after(date!(2026 - 03 - 01)),
            date!(2026 - 03 - 08)
        );
    }

    #[test]
    fn ignores_irregular_and_varying_payments() {
        let groceries = vec![
            tx(date!(2026 - 01 - 03), "Rewe", -2347),
            tx(date!(2026 - 01 - 05), "Rewe", -1850),
            tx(date!(2026 - 01 - 19), "Rewe", -4210),
            tx(date!(2026 - 02 - 02), "Rewe", -999),
        ];
        assert!(detect_recurring(&groceries).is_empty());

        let varying = vec![
            tx(date!(2026 - 01 - 15), "Strom AG", -4000),
            tx(date!(2026 - 02 - 15), "Strom AG", -9000),
            tx(date!(2026 - 03 - 15), "Strom AG", -4100),
        ];
        assert!(detect_recurring(&varying).is_empty());
    }

    #[test]
    fn needs_three_occurrences() {
        let two = vec![
            tx(date!(2026 - 01 - 01), "Netflix", -1299),
            tx(date!(2026 - 02 - 01), "Netflix", -1299),
        ];
        assert!(detect_recurring(&two).is_empty());
    }
}
