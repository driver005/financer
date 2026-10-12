//! "Safe to spend today": what is left to spend per day in the current budget period.
//!
//! # The formula
//!
//! Everything is integer cents and comes from data the app already has (bookings, detected
//! recurring payments, the envelopes). There is no account balance in the model, so this is a
//! budget view of the period, not a cash balance.
//!
//! ```text
//! income           = recurring income booked in the period so far
//!                  + recurring income still expected until the period ends
//! spent_so_far     = everything spent in the period up to today (as in the envelope status:
//!                    income and savings are not spending; fixed costs already paid count)
//! fixed_costs_due  = recurring payments (debits) still to come until the period ends
//! envelope_headroom = sum over envelopes of max(0, limit - spent - fixed_costs_due in that category)
//!
//! available = income - spent_so_far - fixed_costs_due - envelope_headroom      (may be negative)
//! daily     = max(0, available) / days_left                                    (floor, in cents)
//! ```
//!
//! * `envelope_headroom` is money you have already planned for an envelope and not spent yet, so
//!   it is not "free". It is never negative per envelope: an overspent envelope contributes 0
//!   (its overspend is already inside `spent_so_far`, which lowers `available`).
//! * A recurring payment whose category has an envelope is already covered by that envelope's
//!   limit, so it is taken off that envelope's headroom instead of being counted twice. A
//!   payment's category is the category of its latest booking.
//! * `days_left` counts today, and is at least 1 in the division.
//! * A recurring payment counts as "still to come" from its `next_expected` date on, stepping by
//!   its cadence until the period ends. One that is more than half a cadence overdue is treated
//!   as stopped and ignored (a cancelled subscription must not eat your daily number forever).
//!
//! # Pace
//!
//! Is the discretionary spending so far (everything except the fixed costs already paid) within
//! a linear share of what is discretionary over the whole period?
//!
//! ```text
//! discretionary_total = income - fixed_costs_paid - fixed_costs_due
//! pace_target         = max(0, discretionary_total) * days_through(today) / period_days
//! over pace           = (spent_so_far - fixed_costs_paid) > pace_target
//! ```
//!
//! Without any detected recurring income there is nothing to measure against, so the pace is
//! `unknown`.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use time::{Date, Duration};

use crate::budget::Budget;
use crate::category::Category;
use crate::money::Money;
use crate::period::BudgetPeriod;
use crate::recurring::RecurringPayment;
use crate::transaction::{NameNormalizer, Transaction};

/// Is spending ahead of a straight-line share of the period?
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pace {
    OnTrack,
    OverPace,
    /// No recurring income was detected, so there is no budget to compare against.
    Unknown,
}

/// What [`SafeToSpend::calculate`] needs.
#[derive(Debug, Clone, Copy)]
pub struct SafeToSpendInput<'a> {
    /// The period to look at (normally the one containing `today`).
    pub period: BudgetPeriod,
    pub today: Date,
    pub transactions: &'a [Transaction],
    pub recurring: &'a [RecurringPayment],
    pub budget: &'a Budget,
}

/// The daily number and the breakdown behind it. All amounts are positive cents except
/// `available`, which is negative when the period is already overspent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SafeToSpend {
    pub period: BudgetPeriod,
    pub today: Date,
    /// Days left including today.
    pub days_left: u32,
    /// Whether any recurring income was detected at all.
    pub income_detected: bool,
    /// `income_received + income_upcoming`.
    pub income: Money,
    pub income_received: Money,
    pub income_upcoming: Money,
    pub spent_so_far: Money,
    /// Recurring payments still to come in this period.
    pub fixed_costs_due: Money,
    /// Planned envelope money not spent yet (never negative).
    pub envelope_headroom: Money,
    /// `income - spent_so_far - fixed_costs_due - envelope_headroom`.
    pub available: Money,
    /// `max(0, available) / days_left`, rounded down.
    pub daily: Money,
    pub pace: Pace,
    /// The straight-line share of discretionary spending you may have used up by today.
    pub pace_target: Money,
    /// Spending so far without the fixed costs already paid.
    pub discretionary_spent: Money,
}

impl SafeToSpend {
    pub fn calculate(input: &SafeToSpendInput) -> SafeToSpend {
        let period = input.period;
        let today = input.today;
        // only what has happened by today counts as spent
        let so_far = BudgetPeriod {
            start: period.start,
            end: period.end.min(today),
        };
        let spent = Budget::spent_by_category(input.transactions, so_far);
        let spent_so_far: Money = spent.values().copied().sum();

        let income_names = Names::of(input.recurring, |r| !r.amount.is_negative());
        let cost_names = Names::of(input.recurring, |r| r.amount.is_negative());
        let income_received: Money = input
            .transactions
            .iter()
            .filter(|t| !t.is_expense() && so_far.contains(t.booking_date))
            .filter(|t| income_names.has(&t.counterparty))
            .map(|t| t.amount)
            .sum();
        let fixed_paid: Money = input
            .transactions
            .iter()
            .filter(|t| t.is_expense() && so_far.contains(t.booking_date))
            .filter(|t| cost_names.has(&t.counterparty))
            .map(|t| -t.amount)
            .sum();

        let categories = Names::categories(input.transactions);
        let mut income_upcoming = Money::ZERO;
        let mut fixed_due_by_category: BTreeMap<Category, Money> = BTreeMap::new();
        for r in input.recurring {
            let occurrences = Self::occurrences_to_come(r, period, today);
            if r.amount.is_negative() {
                let category = categories
                    .get(&NameNormalizer::normalize(&r.counterparty))
                    .copied()
                    .unwrap_or(Category::Other);
                *fixed_due_by_category.entry(category).or_default() += -r.amount.times(occurrences);
            } else {
                income_upcoming += r.amount.times(occurrences);
            }
        }
        let fixed_costs_due: Money = fixed_due_by_category.values().copied().sum();

        let mut envelope_headroom = Money::ZERO;
        for (category, limit) in &input.budget.envelopes {
            let used = spent.get(category).copied().unwrap_or(Money::ZERO)
                + fixed_due_by_category
                    .get(category)
                    .copied()
                    .unwrap_or(Money::ZERO);
            if *limit > used {
                envelope_headroom += *limit - used;
            }
        }

        let income = income_received + income_upcoming;
        let available = income - spent_so_far - fixed_costs_due - envelope_headroom;
        let days_left = period.days_left(today);
        let daily = if available.is_negative() {
            Money::ZERO
        } else {
            Money::from_cents(available.cents() / i64::from(days_left.max(1)))
        };

        let income_detected = input.recurring.iter().any(|r| !r.amount.is_negative());
        let discretionary_total = income - fixed_paid - fixed_costs_due;
        let discretionary_spent = if spent_so_far > fixed_paid {
            spent_so_far - fixed_paid
        } else {
            Money::ZERO
        };
        let pace_target = if discretionary_total.is_negative() {
            Money::ZERO
        } else {
            Money::from_cents(
                discretionary_total.cents() * i64::from(period.days_through(today))
                    / i64::from(period.days().max(1)),
            )
        };
        let pace = if !income_detected {
            Pace::Unknown
        } else if discretionary_spent > pace_target {
            Pace::OverPace
        } else {
            Pace::OnTrack
        };

        SafeToSpend {
            period,
            today,
            days_left,
            income_detected,
            income,
            income_received,
            income_upcoming,
            spent_so_far,
            fixed_costs_due,
            envelope_headroom,
            available,
            daily,
            pace,
            pace_target,
            discretionary_spent,
        }
    }

    /// How many times `r` is still to come between `today` (or an overdue date inside the period)
    /// and the period's end. Zero for a payment that looks stopped.
    fn occurrences_to_come(r: &RecurringPayment, period: BudgetPeriod, today: Date) -> u32 {
        Self::dates_to_come(r, period, today).len() as u32
    }

    /// The dates `r` is still expected on inside the period, oldest first. Empty for a payment
    /// that looks stopped (more than half a cadence overdue).
    pub(crate) fn dates_to_come(
        r: &RecurringPayment,
        period: BudgetPeriod,
        today: Date,
    ) -> Vec<Date> {
        let grace = Duration::days(r.cadence.nominal_days() / 2);
        if r.next_expected + grace < today {
            return Vec::new();
        }
        let mut dates = Vec::new();
        let mut date = r.next_expected;
        while date <= period.end {
            if date >= period.start {
                dates.push(date);
            }
            date = r.cadence.next_after(date);
        }
        dates
    }
}

/// Counterparty lookups by normalized name.
struct Names(BTreeSet<String>);

impl Names {
    fn of(recurring: &[RecurringPayment], keep: impl Fn(&RecurringPayment) -> bool) -> Names {
        Names(
            recurring
                .iter()
                .filter(|r| keep(r))
                .map(|r| NameNormalizer::normalize(&r.counterparty))
                .collect(),
        )
    }

    fn has(&self, counterparty: &str) -> bool {
        self.0.contains(&NameNormalizer::normalize(counterparty))
    }

    /// The category of each counterparty's latest booking.
    fn categories(transactions: &[Transaction]) -> BTreeMap<String, Category> {
        let mut latest: BTreeMap<String, (Date, Category)> = BTreeMap::new();
        for t in transactions {
            let category = t.category.unwrap_or(Category::Other);
            let entry = latest
                .entry(NameNormalizer::normalize(&t.counterparty))
                .or_insert((t.booking_date, category));
            if t.booking_date >= entry.0 {
                *entry = (t.booking_date, category);
            }
        }
        latest.into_iter().map(|(k, (_, c))| (k, c)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recurring::Cadence;
    use time::macros::date;

    struct Fixture;

    impl Fixture {
        fn tx(date: Date, who: &str, cents: i64, cat: Category) -> Transaction {
            Transaction {
                booking_date: date,
                amount: Money::from_cents(cents),
                counterparty: who.into(),
                purpose: String::new(),
                counterparty_iban: None,
                category: Some(cat),
            }
        }

        fn recurring(who: &str, cents: i64, cadence: Cadence, last: Date) -> RecurringPayment {
            RecurringPayment {
                counterparty: who.into(),
                amount: Money::from_cents(cents),
                cadence,
                last_date: last,
                next_expected: cadence.next_after(last),
            }
        }

        fn budget(limits: &[(Category, i64)]) -> Budget {
            let mut b = Budget::default();
            for (c, l) in limits {
                b.envelopes.insert(*c, Money::from_cents(*l));
            }
            b
        }

        fn run(
            payday: u8,
            today: Date,
            txs: &[Transaction],
            recurring: &[RecurringPayment],
            budget: &Budget,
        ) -> SafeToSpend {
            SafeToSpend::calculate(&SafeToSpendInput {
                period: BudgetPeriod::containing(today, payday),
                today,
                transactions: txs,
                recurring,
                budget,
            })
        }

        /// Salary on the 25th, rent on the 1st, Netflix on the 20th; period 25 Sep to 24 Oct.
        fn month() -> (Vec<Transaction>, Vec<RecurringPayment>) {
            let txs = vec![
                Self::tx(
                    date!(2026 - 09 - 25),
                    "Arbeitgeber",
                    250000,
                    Category::Income,
                ),
                Self::tx(
                    date!(2026 - 09 - 20),
                    "Netflix",
                    -1000,
                    Category::Subscriptions,
                ),
                Self::tx(
                    date!(2026 - 10 - 01),
                    "Vermieter",
                    -80000,
                    Category::Housing,
                ),
                Self::tx(date!(2026 - 10 - 03), "Rewe", -20000, Category::Groceries),
            ];
            let recurring = vec![
                Self::recurring(
                    "Arbeitgeber",
                    250000,
                    Cadence::Monthly,
                    date!(2026 - 09 - 25),
                ),
                Self::recurring("Netflix", -1000, Cadence::Monthly, date!(2026 - 09 - 20)),
                Self::recurring("Vermieter", -80000, Cadence::Monthly, date!(2026 - 10 - 01)),
            ];
            (txs, recurring)
        }
    }

    #[test]
    fn explains_the_daily_number() {
        let (txs, recurring) = Fixture::month();
        let budget = Fixture::budget(&[(Category::Groceries, 40000)]);
        let s = Fixture::run(25, date!(2026 - 10 - 11), &txs, &recurring, &budget);

        assert_eq!(s.period.start, date!(2026 - 09 - 25));
        assert_eq!(s.period.end, date!(2026 - 10 - 24));
        assert_eq!(s.days_left, 14);
        // salary arrived on payday; the next one (25 Oct) is in the next period
        assert_eq!(s.income_received.cents(), 250000);
        assert_eq!(s.income_upcoming.cents(), 0);
        assert_eq!(s.income.cents(), 250000);
        assert!(s.income_detected);
        // rent and groceries are spent (the 20 Sep Netflix is the previous period's)
        assert_eq!(s.spent_so_far.cents(), 100000);
        // Netflix on 20 Oct is still to come; rent is next due on 1 Nov
        assert_eq!(s.fixed_costs_due.cents(), 1000);
        // groceries: 400 planned, 200 spent
        assert_eq!(s.envelope_headroom.cents(), 20000);
        assert_eq!(s.available.cents(), 250000 - 100000 - 1000 - 20000);
        assert_eq!(s.daily.cents(), 129000 / 14);
    }

    #[test]
    fn pace_compares_discretionary_spend_with_a_linear_share() {
        let (mut txs, recurring) = Fixture::month();
        let budget = Fixture::budget(&[(Category::Groceries, 40000)]);
        let s = Fixture::run(25, date!(2026 - 10 - 11), &txs, &recurring, &budget);
        // 2500 - 800 paid - 10 due = 1690 discretionary; 17 of 30 days through
        assert_eq!(s.pace_target.cents(), 169000 * 17 / 30);
        assert_eq!(s.discretionary_spent.cents(), 20000);
        assert_eq!(s.pace, Pace::OnTrack);

        txs.push(Fixture::tx(
            date!(2026 - 10 - 09),
            "Mediamarkt",
            -90000,
            Category::Shopping,
        ));
        let s = Fixture::run(25, date!(2026 - 10 - 11), &txs, &recurring, &budget);
        assert_eq!(s.discretionary_spent.cents(), 110000);
        assert_eq!(s.pace, Pace::OverPace);
    }

    #[test]
    fn without_detected_income_there_is_nothing_to_spend_and_no_pace() {
        let txs = vec![Fixture::tx(
            date!(2026 - 03 - 05),
            "Rewe",
            -2500,
            Category::Groceries,
        )];
        let s = Fixture::run(1, date!(2026 - 03 - 10), &txs, &[], &Budget::default());
        assert!(!s.income_detected);
        assert_eq!(s.income, Money::ZERO);
        assert_eq!(s.available.cents(), -2500);
        assert_eq!(s.daily, Money::ZERO);
        assert_eq!(s.pace, Pace::Unknown);
    }

    #[test]
    fn overspent_envelopes_have_no_headroom_and_never_go_negative() {
        let (mut txs, recurring) = Fixture::month();
        txs.push(Fixture::tx(
            date!(2026 - 10 - 08),
            "Rewe",
            -30000,
            Category::Groceries,
        ));
        // limit 400, spent 500
        let budget = Fixture::budget(&[(Category::Groceries, 40000)]);
        let s = Fixture::run(25, date!(2026 - 10 - 11), &txs, &recurring, &budget);
        assert_eq!(s.envelope_headroom, Money::ZERO);
        // the overspend is in spent_so_far: 800 rent + 500 groceries
        assert_eq!(s.spent_so_far.cents(), 130000);
        assert_eq!(s.available.cents(), 250000 - 130000 - 1000);
        assert_eq!(s.daily.cents(), 119000 / 14);
    }

    #[test]
    fn a_fixed_cost_inside_an_envelope_is_not_counted_twice() {
        let (txs, recurring) = Fixture::month();
        // Netflix is a subscription: 15 planned, 10 still due, nothing spent this period
        let budget = Fixture::budget(&[(Category::Subscriptions, 1500)]);
        let s = Fixture::run(25, date!(2026 - 10 - 11), &txs, &recurring, &budget);
        assert_eq!(s.fixed_costs_due.cents(), 1000);
        assert_eq!(s.envelope_headroom.cents(), 500);
        assert_eq!(s.available.cents(), 250000 - 100000 - 1000 - 500);

        // a limit smaller than the cost still due leaves no headroom, never a negative one
        let tight = Fixture::budget(&[(Category::Subscriptions, 400)]);
        let s = Fixture::run(25, date!(2026 - 10 - 11), &txs, &recurring, &tight);
        assert_eq!(s.envelope_headroom, Money::ZERO);
    }

    #[test]
    fn income_still_to_come_counts_for_the_period() {
        // salary on the 28th with a calendar-month budget: not here yet on the 11th
        let txs = vec![Fixture::tx(
            date!(2026 - 09 - 28),
            "Arbeitgeber",
            250000,
            Category::Income,
        )];
        let recurring = vec![Fixture::recurring(
            "Arbeitgeber",
            250000,
            Cadence::Monthly,
            date!(2026 - 09 - 28),
        )];
        let s = Fixture::run(
            1,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert_eq!(s.income_received, Money::ZERO);
        assert_eq!(s.income_upcoming.cents(), 250000);
        assert_eq!(s.days_left, 21);
        assert_eq!(s.daily.cents(), 250000 / 21);
    }

    #[test]
    fn works_across_the_year_end() {
        let txs = vec![Fixture::tx(
            date!(2026 - 12 - 25),
            "Arbeitgeber",
            300000,
            Category::Income,
        )];
        let recurring = vec![
            Fixture::recurring(
                "Arbeitgeber",
                300000,
                Cadence::Monthly,
                date!(2026 - 12 - 25),
            ),
            // due on 5 January, inside the period 25 Dec to 24 Jan
            Fixture::recurring("Strom", -6000, Cadence::Monthly, date!(2026 - 12 - 05)),
        ];
        let s = Fixture::run(
            25,
            date!(2026 - 12 - 30),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert_eq!(s.period.start, date!(2026 - 12 - 25));
        assert_eq!(s.period.end, date!(2027 - 01 - 24));
        assert_eq!(s.days_left, 26);
        assert_eq!(s.fixed_costs_due.cents(), 6000);
        assert_eq!(s.daily.cents(), 294000 / 26);

        // after New Year the same period is still current
        let s = Fixture::run(
            25,
            date!(2027 - 01 - 03),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert_eq!(s.period.start, date!(2026 - 12 - 25));
        assert_eq!(s.days_left, 22);
    }

    #[test]
    fn a_payday_of_31_clamps_to_the_month_end() {
        let s = Fixture::run(31, date!(2026 - 02 - 10), &[], &[], &Budget::default());
        assert_eq!(s.period.start, date!(2026 - 01 - 31));
        assert_eq!(s.period.end, date!(2026 - 02 - 27));
        assert_eq!(s.days_left, 18);
    }

    #[test]
    fn a_stopped_subscription_is_ignored_but_a_slightly_late_payment_is_not() {
        let recurring = vec![
            // last paid in May; "expected" in June, months overdue
            Fixture::recurring("Altes Abo", -999, Cadence::Monthly, date!(2026 - 05 - 03)),
            // expected on the 8th, three days late: still due
            Fixture::recurring("Miete", -50000, Cadence::Monthly, date!(2026 - 09 - 08)),
        ];
        let s = Fixture::run(
            1,
            date!(2026 - 10 - 11),
            &[],
            &recurring,
            &Budget::default(),
        );
        assert_eq!(s.fixed_costs_due.cents(), 50000);
    }

    #[test]
    fn weekly_payments_repeat_inside_the_period() {
        let recurring = vec![Fixture::recurring(
            "Sportkurs",
            -1000,
            Cadence::Weekly,
            date!(2026 - 10 - 08),
        )];
        // expected 15, 22 and 29 Oct
        let s = Fixture::run(
            1,
            date!(2026 - 10 - 11),
            &[],
            &recurring,
            &Budget::default(),
        );
        assert_eq!(s.fixed_costs_due.cents(), 3000);
    }

    #[test]
    fn the_last_day_gets_everything_that_is_left() {
        let txs = vec![Fixture::tx(
            date!(2026 - 03 - 01),
            "Arbeitgeber",
            100000,
            Category::Income,
        )];
        let recurring = vec![Fixture::recurring(
            "Arbeitgeber",
            100000,
            Cadence::Monthly,
            date!(2026 - 03 - 01),
        )];
        let s = Fixture::run(
            1,
            date!(2026 - 03 - 31),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert_eq!(s.days_left, 1);
        assert_eq!(s.daily.cents(), 100000);
    }

    #[test]
    fn bookings_after_today_are_not_spent_yet() {
        let txs = vec![Fixture::tx(
            date!(2026 - 03 - 20),
            "Rewe",
            -5000,
            Category::Groceries,
        )];
        let s = Fixture::run(1, date!(2026 - 03 - 10), &txs, &[], &Budget::default());
        assert_eq!(s.spent_so_far, Money::ZERO);
    }
}
