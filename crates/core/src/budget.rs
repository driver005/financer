use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::{Date, Month};

use crate::category::Category;
use crate::money::Money;
use crate::period::BudgetPeriod;
use crate::recurring::{Cadence, RecurringPayment};
use crate::transaction::Transaction;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct YearMonth {
    pub year: i32,
    pub month: Month,
}

impl YearMonth {
    pub fn new(year: i32, month: Month) -> Self {
        Self { year, month }
    }

    pub fn of(date: Date) -> Self {
        Self {
            year: date.year(),
            month: date.month(),
        }
    }

    pub fn contains(self, date: Date) -> bool {
        Self::of(date) == self
    }

    pub fn days(self) -> u8 {
        self.month.length(self.year)
    }
}

/// Spending limit per category and budget period (a calendar month unless a payday is set).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Budget {
    pub envelopes: BTreeMap<Category, Money>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvelopeStatus {
    pub category: Category,
    pub limit: Money,
    pub spent: Money,
    /// `limit - spent`; negative when overspent.
    pub remaining: Money,
}

impl Budget {
    /// Spending per category in a budget period, as positive amounts. Income and savings are not
    /// spending.
    pub fn spent_by_category(
        transactions: &[Transaction],
        period: BudgetPeriod,
    ) -> BTreeMap<Category, Money> {
        let mut out: BTreeMap<Category, Money> = BTreeMap::new();
        for tx in transactions {
            if !tx.is_expense() || !period.contains(tx.booking_date) {
                continue;
            }
            let cat = tx.category.unwrap_or(Category::Other);
            if matches!(cat, Category::Income | Category::Savings) {
                continue;
            }
            *out.entry(cat).or_default() += -tx.amount;
        }
        out
    }

    pub fn status(
        &self,
        transactions: &[Transaction],
        period: BudgetPeriod,
    ) -> Vec<EnvelopeStatus> {
        let spent = Self::spent_by_category(transactions, period);
        self.envelopes
            .iter()
            .map(|(category, limit)| {
                let s = spent.get(category).copied().unwrap_or(Money::ZERO);
                EnvelopeStatus {
                    category: *category,
                    limit: *limit,
                    spent: s,
                    remaining: *limit - s,
                }
            })
            .collect()
    }

    /// What is left of one envelope in this period, never below zero.
    pub fn remaining(
        &self,
        category: Category,
        transactions: &[Transaction],
        period: BudgetPeriod,
    ) -> Money {
        self.status(transactions, period)
            .into_iter()
            .find(|s| s.category == category)
            .map(|s| {
                if s.remaining.is_negative() {
                    Money::ZERO
                } else {
                    s.remaining
                }
            })
            .unwrap_or(Money::ZERO)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Disposable {
    pub monthly_income: Money,
    pub monthly_fixed_costs: Money,
    pub disposable: Money,
}

impl Disposable {
    /// Disposable income per month from detected recurring payments: recurring credits are
    /// income, recurring debits are fixed costs, the rest is yours to budget.
    pub fn from_recurring(recurring: &[RecurringPayment]) -> Disposable {
        let mut income = Money::ZERO;
        let mut fixed = Money::ZERO;
        for r in recurring {
            let monthly = Self::monthly_equivalent(r.amount, r.cadence);
            if monthly.is_negative() {
                fixed += -monthly;
            } else {
                income += monthly;
            }
        }
        Disposable {
            monthly_income: income,
            monthly_fixed_costs: fixed,
            disposable: income - fixed,
        }
    }

    /// Convert a recurring payment into its monthly cost (cents, rounded to nearest).
    fn monthly_equivalent(amount: Money, cadence: Cadence) -> Money {
        let cents = amount.cents();
        let (num, den) = match cadence {
            Cadence::Weekly => (52, 12),
            Cadence::Monthly => (1, 1),
            Cadence::Quarterly => (1, 3),
            Cadence::Yearly => (1, 12),
        };
        let scaled = cents * num;
        let half = den / 2;
        let rounded = if scaled >= 0 {
            (scaled + half) / den
        } else {
            (scaled - half) / den
        };
        Money::from_cents(rounded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    struct Fixture;

    impl Fixture {
        fn tx(date: Date, cents: i64, cat: Category) -> Transaction {
            Transaction {
                booking_date: date,
                amount: Money::from_cents(cents),
                counterparty: "x".into(),
                purpose: String::new(),
                counterparty_iban: None,
                category: Some(cat),
            }
        }
    }

    #[test]
    fn computes_envelope_status_for_one_month() {
        let txs = vec![
            Fixture::tx(date!(2026 - 03 - 02), -2347, Category::Groceries),
            Fixture::tx(date!(2026 - 03 - 15), -5000, Category::Groceries),
            Fixture::tx(date!(2026 - 02 - 28), -9999, Category::Groceries),
            Fixture::tx(date!(2026 - 03 - 10), 250000, Category::Income),
            Fixture::tx(date!(2026 - 03 - 11), -1000, Category::Dining),
        ];
        let mut budget = Budget::default();
        budget
            .envelopes
            .insert(Category::Groceries, Money::from_cents(40000));
        budget
            .envelopes
            .insert(Category::Dining, Money::from_cents(500));

        let m = BudgetPeriod::for_month(YearMonth::new(2026, Month::March), 1);
        let status = budget.status(&txs, m);
        let groceries = status
            .iter()
            .find(|s| s.category == Category::Groceries)
            .unwrap();
        assert_eq!(groceries.spent, Money::from_cents(7347));
        assert_eq!(groceries.remaining, Money::from_cents(32653));
        let dining = status
            .iter()
            .find(|s| s.category == Category::Dining)
            .unwrap();
        assert_eq!(dining.remaining, Money::from_cents(-500));

        assert_eq!(budget.remaining(Category::Dining, &txs, m), Money::ZERO);
        assert_eq!(
            budget.remaining(Category::Groceries, &txs, m),
            Money::from_cents(32653)
        );
        assert_eq!(budget.remaining(Category::Leisure, &txs, m), Money::ZERO);
    }

    #[test]
    fn a_payday_period_cuts_spending_at_payday() {
        let txs = vec![
            Fixture::tx(date!(2026 - 02 - 24), -1000, Category::Groceries),
            Fixture::tx(date!(2026 - 02 - 25), -2000, Category::Groceries),
            Fixture::tx(date!(2026 - 03 - 24), -400, Category::Groceries),
            Fixture::tx(date!(2026 - 03 - 25), -8000, Category::Groceries),
        ];
        let mut budget = Budget::default();
        budget
            .envelopes
            .insert(Category::Groceries, Money::from_cents(5000));
        let p = BudgetPeriod::containing(date!(2026 - 03 - 10), 25);
        assert_eq!(p.start, date!(2026 - 02 - 25));
        assert_eq!(
            Budget::spent_by_category(&txs, p)[&Category::Groceries],
            Money::from_cents(2400)
        );
        assert_eq!(
            budget.remaining(Category::Groceries, &txs, p),
            Money::from_cents(2600)
        );
        // the next period holds only what came after payday
        assert_eq!(
            budget.remaining(Category::Groceries, &txs, p.next(25)),
            Money::ZERO
        );
    }

    #[test]
    fn income_is_not_spending() {
        let txs = vec![Fixture::tx(date!(2026 - 03 - 10), 250000, Category::Income)];
        let march = BudgetPeriod::for_month(YearMonth::new(2026, Month::March), 1);
        assert!(Budget::spent_by_category(&txs, march).is_empty());
    }

    #[test]
    fn disposable_income_normalizes_cadence() {
        let d = date!(2026 - 03 - 01);
        let rec = |amount: i64, cadence| RecurringPayment {
            counterparty: "x".into(),
            amount: Money::from_cents(amount),
            cadence,
            last_date: d,
            next_expected: d,
        };
        let r = Disposable::from_recurring(&[
            rec(250000, Cadence::Monthly),
            rec(-80000, Cadence::Monthly),
            rec(-12000, Cadence::Yearly),
            rec(-3000, Cadence::Quarterly),
        ]);
        assert_eq!(r.monthly_income, Money::from_cents(250000));
        assert_eq!(
            r.monthly_fixed_costs,
            Money::from_cents(80000 + 1000 + 1000)
        );
        assert_eq!(r.disposable, Money::from_cents(250000 - 82000));
    }

    #[test]
    fn year_month_days() {
        assert_eq!(YearMonth::new(2026, Month::February).days(), 28);
        assert_eq!(YearMonth::new(2028, Month::February).days(), 29);
    }
}
