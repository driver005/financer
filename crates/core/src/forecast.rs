//! End-of-period forecast: where will this budget period end if the current pace continues?
//!
//! Like [`SafeToSpend`] this is a budget view built from the bookings, the detected recurring
//! payments and the envelopes; there is no bank balance in the model. All amounts are integer
//! cents and the "current period" is the payday-based [`BudgetPeriod`].
//!
//! # The projection
//!
//! ```text
//! income        = recurring income booked so far + recurring income still expected
//! spent_so_far  = everything spent in the period up to and including today
//! fixed_due     = recurring payments still to come until the period ends
//! pace          = discretionary spending so far / days_through(today)
//!                 (discretionary = spent_so_far minus the recurring payments already paid,
//!                 split into groceries and everything else)
//! extra         = pace * days after today
//!
//! projected_leftover = income - spent_so_far - fixed_due - extra
//! ```
//!
//! The pace is a plain average of the days so far (today counts as a whole day), so one big
//! purchase early in the period weighs heavily; that is why a forecast made in the first days of
//! a period is flagged `early` and never rises above `watch` unless the shortfall is certain
//! even without any further spending.
//!
//! # Grocery run-out
//!
//! With a groceries envelope, the budget runs out on the first day `today + k` for which
//! `groceries_spent + k * grocery_pace >= limit`. It is reported only when that is before the
//! period's last day. If the limit is already used up, the date it was crossed is reported and
//! `grocery_exhausted` is set.
//!
//! # Warning level
//!
//! The first matching rule wins:
//!
//! | reason               | level  | when                                                                  |
//! |----------------------|--------|-----------------------------------------------------------------------|
//! | `no_data`            | ok     | no booking up to today at all                                         |
//! | `no_income`          | ok     | no recurring income was detected, so there is nothing to compare to   |
//! | `projected_shortfall`| danger | `projected_leftover < 0` (watch while `early`, see above)             |
//! | `income_overdue`     | watch  | expected income is later than its date but not yet booked             |
//! | `groceries_run_out`  | watch  | the grocery budget runs out (or is used up) before the period ends    |
//! | `thin_margin`        | watch  | `projected_leftover` is below 5% of the income                        |
//! | `income_pending`     | ok     | the projection counts on income that has not arrived yet              |
//! | `on_track`           | ok     | none of the above                                                     |

use serde::{Deserialize, Serialize};
use time::{Date, Duration};

use crate::budget::Budget;
use crate::category::Category;
use crate::money::Money;
use crate::period::BudgetPeriod;
use crate::safe_to_spend::{SafeToSpend, SafeToSpendInput};

/// What [`Forecast::calculate`] needs (the same inputs as the safe-to-spend number).
pub type ForecastInput<'a> = SafeToSpendInput<'a>;

/// A forecast made in the first days of a period is only an early guess.
pub const EARLY_DAYS: u32 = 4;
/// Below this share of the income (in percent) the projected leftover counts as thin.
pub const THIN_MARGIN_PERCENT: i64 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WarningLevel {
    Ok,
    Watch,
    Danger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WarningReason {
    NoData,
    NoIncome,
    ProjectedShortfall,
    IncomeOverdue,
    GroceriesRunOut,
    ThinMargin,
    IncomePending,
    OnTrack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Forecast {
    pub period: BudgetPeriod,
    pub today: Date,
    /// Days from the period start up to and including today.
    pub days_through: u32,
    /// Days after today until the period ends (what the pace is projected over).
    pub days_after_today: u32,
    /// Fewer than [`EARLY_DAYS`] days of the period are over, so the pace is a rough guess.
    pub early: bool,
    pub income_detected: bool,
    pub income_received: Money,
    pub income_upcoming: Money,
    /// When the next expected income is due (earlier than `today` when it is overdue).
    pub next_income_date: Option<Date>,
    pub spent_so_far: Money,
    pub fixed_costs_due: Money,
    pub grocery_spent: Money,
    /// Discretionary spending that is not groceries.
    pub other_spent: Money,
    /// Average groceries per day so far (rounded down).
    pub grocery_daily: Money,
    /// Average other discretionary spending per day so far (rounded down).
    pub other_daily: Money,
    /// What the pace adds until the period ends.
    pub projected_extra_spend: Money,
    /// `income - spent_so_far - fixed_costs_due - projected_extra_spend`; negative is a shortfall.
    pub projected_leftover: Money,
    /// The groceries limit, when there is one.
    pub grocery_limit: Option<Money>,
    /// When the grocery budget runs out before the period ends (see the module docs).
    pub grocery_run_out: Option<Date>,
    /// The grocery limit is already used up.
    pub grocery_exhausted: bool,
    pub level: WarningLevel,
    pub reason: WarningReason,
}

impl Forecast {
    pub fn calculate(input: &ForecastInput) -> Forecast {
        let period = input.period;
        let today = input.today;
        let sts = SafeToSpend::calculate(input);

        let days_through = period.days_through(today);
        let days_after_today = period.days() - days_through;
        let early = days_through < EARLY_DAYS;

        let so_far = BudgetPeriod {
            start: period.start,
            end: period.end.min(today),
        };
        let spent = Budget::spent_by_category(input.transactions, so_far);
        let grocery_spent = spent.get(&Category::Groceries).copied().unwrap_or_default();
        // fixed costs already paid are not part of the pace
        let other_spent = if sts.discretionary_spent > grocery_spent {
            sts.discretionary_spent - grocery_spent
        } else {
            Money::ZERO
        };

        let (grocery_daily, grocery_extra) =
            Self::pace(grocery_spent, days_through, days_after_today);
        let (other_daily, other_extra) = Self::pace(other_spent, days_through, days_after_today);
        let projected_extra_spend = grocery_extra + other_extra;
        let projected_leftover =
            sts.income - sts.spent_so_far - sts.fixed_costs_due - projected_extra_spend;

        let grocery_limit = input
            .budget
            .envelopes
            .get(&Category::Groceries)
            .copied()
            .filter(|l| *l > Money::ZERO);
        let (grocery_run_out, grocery_exhausted) = match grocery_limit {
            Some(limit) => Self::grocery_run_out(
                input,
                so_far,
                limit,
                grocery_spent,
                days_through,
                days_after_today,
            ),
            None => (None, false),
        };

        let next_income_date = input
            .recurring
            .iter()
            .filter(|r| !r.amount.is_negative())
            .flat_map(|r| SafeToSpend::dates_to_come(r, period, today))
            .min();

        let has_history = input.transactions.iter().any(|t| t.booking_date <= today);
        let (level, reason) = Self::assess(&Assessment {
            has_history,
            income_detected: sts.income_detected,
            income: sts.income,
            income_upcoming: sts.income_upcoming,
            next_income_date,
            today,
            early,
            days_after_today,
            projected_leftover,
            certain_shortfall: (sts.income - sts.spent_so_far - sts.fixed_costs_due).is_negative(),
            grocery_run_out: grocery_run_out.is_some(),
        });

        Forecast {
            period,
            today,
            days_through,
            days_after_today,
            early,
            income_detected: sts.income_detected,
            income_received: sts.income_received,
            income_upcoming: sts.income_upcoming,
            next_income_date,
            spent_so_far: sts.spent_so_far,
            fixed_costs_due: sts.fixed_costs_due,
            grocery_spent,
            other_spent,
            grocery_daily,
            other_daily,
            projected_extra_spend,
            projected_leftover,
            grocery_limit,
            grocery_run_out,
            grocery_exhausted,
            level,
            reason,
        }
    }

    /// The daily average of `spent` over the days so far, and what it adds over the days left.
    fn pace(spent: Money, days_through: u32, days_after_today: u32) -> (Money, Money) {
        if days_through == 0 {
            return (Money::ZERO, Money::ZERO);
        }
        let through = i64::from(days_through);
        (
            Money::from_cents(spent.cents() / through),
            Money::from_cents(spent.cents() * i64::from(days_after_today) / through),
        )
    }

    /// The day the grocery budget runs out, and whether it is used up already.
    fn grocery_run_out(
        input: &ForecastInput,
        so_far: BudgetPeriod,
        limit: Money,
        spent: Money,
        days_through: u32,
        days_after_today: u32,
    ) -> (Option<Date>, bool) {
        if spent >= limit {
            // the day the running total first reached the limit
            let mut shops: Vec<(Date, Money)> = input
                .transactions
                .iter()
                .filter(|t| t.is_expense() && so_far.contains(t.booking_date))
                .filter(|t| t.category == Some(Category::Groceries))
                .map(|t| (t.booking_date, -t.amount))
                .collect();
            shops.sort_by_key(|(date, _)| *date);
            let mut total = Money::ZERO;
            for (date, amount) in shops {
                total += amount;
                if total >= limit {
                    return (Some(date), true);
                }
            }
            return (None, true);
        }
        if spent == Money::ZERO || days_through == 0 {
            return (None, false);
        }
        // first k with spent + k * spent / days_through >= limit
        let missing = (limit - spent).cents();
        let k = (missing * i64::from(days_through) + spent.cents() - 1) / spent.cents();
        if k < i64::from(days_after_today) {
            (Some(input.today + Duration::days(k)), false)
        } else {
            (None, false)
        }
    }

    fn assess(a: &Assessment) -> (WarningLevel, WarningReason) {
        if !a.has_history {
            return (WarningLevel::Ok, WarningReason::NoData);
        }
        if !a.income_detected {
            return (WarningLevel::Ok, WarningReason::NoIncome);
        }
        if a.projected_leftover.is_negative() {
            // an early pace is a guess, unless the bills alone already exceed the income
            let level = if a.early && !a.certain_shortfall && a.days_after_today > 0 {
                WarningLevel::Watch
            } else {
                WarningLevel::Danger
            };
            return (level, WarningReason::ProjectedShortfall);
        }
        let overdue =
            a.income_upcoming > Money::ZERO && a.next_income_date.is_some_and(|d| d < a.today);
        if overdue {
            return (WarningLevel::Watch, WarningReason::IncomeOverdue);
        }
        if a.grocery_run_out {
            return (WarningLevel::Watch, WarningReason::GroceriesRunOut);
        }
        if a.projected_leftover.cents() * 100 < a.income.cents() * THIN_MARGIN_PERCENT {
            return (WarningLevel::Watch, WarningReason::ThinMargin);
        }
        if a.income_upcoming > Money::ZERO {
            return (WarningLevel::Ok, WarningReason::IncomePending);
        }
        (WarningLevel::Ok, WarningReason::OnTrack)
    }
}

struct Assessment {
    has_history: bool,
    income_detected: bool,
    income: Money,
    income_upcoming: Money,
    next_income_date: Option<Date>,
    today: Date,
    early: bool,
    days_after_today: u32,
    projected_leftover: Money,
    certain_shortfall: bool,
    grocery_run_out: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recurring::{Cadence, RecurringPayment};
    use crate::transaction::Transaction;
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

        fn budget(groceries: i64) -> Budget {
            let mut b = Budget::default();
            if groceries > 0 {
                b.envelopes
                    .insert(Category::Groceries, Money::from_cents(groceries));
            }
            b
        }

        fn run(
            payday: u8,
            today: Date,
            txs: &[Transaction],
            recurring: &[RecurringPayment],
            budget: &Budget,
        ) -> Forecast {
            Forecast::calculate(&ForecastInput {
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
    fn no_history_is_not_a_warning() {
        let f = Fixture::run(1, date!(2026 - 03 - 10), &[], &[], &Budget::default());
        assert_eq!(f.level, WarningLevel::Ok);
        assert_eq!(f.reason, WarningReason::NoData);
        assert_eq!(f.projected_leftover, Money::ZERO);
        assert_eq!(f.projected_extra_spend, Money::ZERO);
        assert_eq!(f.grocery_run_out, None);
        assert!(!f.grocery_exhausted);
        assert_eq!(f.next_income_date, None);
        assert_eq!(f.days_through, 10);
        assert_eq!(f.days_after_today, 21);
    }

    #[test]
    fn spending_without_recurring_income_cannot_be_judged() {
        let txs = vec![Fixture::tx(
            date!(2026 - 03 - 05),
            "Rewe",
            -2500,
            Category::Groceries,
        )];
        let f = Fixture::run(1, date!(2026 - 03 - 10), &txs, &[], &Budget::default());
        assert!(!f.income_detected);
        assert_eq!(f.reason, WarningReason::NoIncome);
        assert_eq!(f.level, WarningLevel::Ok);
        // the projection itself is still there: 2500 over 10 days, 21 more days
        assert_eq!(f.grocery_daily.cents(), 250);
        assert_eq!(f.projected_extra_spend.cents(), 2500 * 21 / 10);
        assert_eq!(f.projected_leftover.cents(), -2500 - 5250);
    }

    #[test]
    fn a_normal_month_ends_with_money_left() {
        let (txs, recurring) = Fixture::month();
        let f = Fixture::run(
            25,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Fixture::budget(40000),
        );
        // 17 of 30 days are over, 13 to go
        assert_eq!(f.days_through, 17);
        assert_eq!(f.days_after_today, 13);
        assert!(!f.early);
        assert_eq!((f.income_received + f.income_upcoming).cents(), 250000);
        assert_eq!(f.spent_so_far.cents(), 100000);
        assert_eq!(f.fixed_costs_due.cents(), 1000);
        // the rent is a fixed cost: only the 200 of groceries make up the pace
        assert_eq!(f.grocery_spent.cents(), 20000);
        assert_eq!(f.other_spent, Money::ZERO);
        assert_eq!(f.grocery_daily.cents(), 20000 / 17);
        assert_eq!(f.projected_extra_spend.cents(), 20000 * 13 / 17);
        assert_eq!(
            f.projected_leftover.cents(),
            250000 - 100000 - 1000 - 20000 * 13 / 17
        );
        // 200 of 400 spent at 11.76 a day lasts 17 more days, the period has 13
        assert_eq!(f.grocery_run_out, None);
        assert!(!f.grocery_exhausted);
        assert_eq!(f.level, WarningLevel::Ok);
        assert_eq!(f.reason, WarningReason::OnTrack);
    }

    #[test]
    fn an_overspending_pace_is_a_shortfall() {
        let (mut txs, recurring) = Fixture::month();
        txs.push(Fixture::tx(
            date!(2026 - 10 - 09),
            "Mediamarkt",
            -90000,
            Category::Shopping,
        ));
        let f = Fixture::run(
            25,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Fixture::budget(40000),
        );
        assert_eq!(f.other_spent.cents(), 90000);
        assert_eq!(
            f.projected_extra_spend.cents(),
            20000 * 13 / 17 + 90000 * 13 / 17
        );
        assert!(f.projected_leftover.is_negative());
        // today the plan still balances: the shortfall comes from the pace
        assert_eq!(f.level, WarningLevel::Danger);
        assert_eq!(f.reason, WarningReason::ProjectedShortfall);
    }

    #[test]
    fn groceries_running_out_early_is_named_with_a_date() {
        let (mut txs, recurring) = Fixture::month();
        // 400 limit, 300 already spent after 17 days: 17.65 a day, 100 left lasts 5.67 days
        txs.push(Fixture::tx(
            date!(2026 - 10 - 08),
            "Lidl",
            -10000,
            Category::Groceries,
        ));
        let f = Fixture::run(
            25,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Fixture::budget(40000),
        );
        assert_eq!(f.grocery_spent.cents(), 30000);
        // k = ceil(10000 * 17 / 30000) = 6 -> 17 Oct
        assert_eq!(f.grocery_run_out, Some(date!(2026 - 10 - 17)));
        assert!(!f.grocery_exhausted);
        assert_eq!(f.level, WarningLevel::Watch);
        assert_eq!(f.reason, WarningReason::GroceriesRunOut);
    }

    #[test]
    fn a_used_up_grocery_budget_reports_the_day_it_ran_out() {
        let (mut txs, recurring) = Fixture::month();
        txs.push(Fixture::tx(
            date!(2026 - 10 - 06),
            "Lidl",
            -15000,
            Category::Groceries,
        ));
        txs.push(Fixture::tx(
            date!(2026 - 10 - 09),
            "Rewe",
            -9000,
            Category::Groceries,
        ));
        // 200 + 150 = 350 on the 6th, 440 on the 9th: crossed 400 on the 9th
        let f = Fixture::run(
            25,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Fixture::budget(40000),
        );
        assert!(f.grocery_exhausted);
        assert_eq!(f.grocery_run_out, Some(date!(2026 - 10 - 09)));
        assert_eq!(f.reason, WarningReason::GroceriesRunOut);
        assert_eq!(f.level, WarningLevel::Watch);
    }

    #[test]
    fn no_grocery_limit_means_no_run_out_date() {
        let (txs, recurring) = Fixture::month();
        let f = Fixture::run(
            25,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert_eq!(f.grocery_limit, None);
        assert_eq!(f.grocery_run_out, None);
        assert!(!f.grocery_exhausted);
    }

    #[test]
    fn income_that_is_not_here_yet_is_counted_but_named() {
        // salary on the 28th with a calendar-month budget: not here yet on the 11th
        let txs = vec![
            Fixture::tx(
                date!(2026 - 09 - 28),
                "Arbeitgeber",
                250000,
                Category::Income,
            ),
            Fixture::tx(date!(2026 - 10 - 02), "Rewe", -3000, Category::Groceries),
        ];
        let recurring = vec![Fixture::recurring(
            "Arbeitgeber",
            250000,
            Cadence::Monthly,
            date!(2026 - 09 - 28),
        )];
        let f = Fixture::run(
            1,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert_eq!(f.income_received, Money::ZERO);
        assert_eq!(f.income_upcoming.cents(), 250000);
        assert_eq!(f.next_income_date, Some(date!(2026 - 10 - 28)));
        assert_eq!(f.projected_leftover.cents(), 250000 - 3000 - 3000 * 20 / 11);
        assert_eq!(f.level, WarningLevel::Ok);
        assert_eq!(f.reason, WarningReason::IncomePending);
    }

    #[test]
    fn income_that_is_late_is_a_watch() {
        let txs = vec![
            Fixture::tx(
                date!(2026 - 09 - 28),
                "Arbeitgeber",
                250000,
                Category::Income,
            ),
            Fixture::tx(date!(2026 - 10 - 02), "Rewe", -3000, Category::Groceries),
        ];
        let recurring = vec![Fixture::recurring(
            "Arbeitgeber",
            250000,
            Cadence::Monthly,
            date!(2026 - 09 - 28),
        )];
        // due on the 28th, still not booked on the 30th (within the grace of half a cadence)
        let f = Fixture::run(
            1,
            date!(2026 - 10 - 30),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert_eq!(f.next_income_date, Some(date!(2026 - 10 - 28)));
        assert_eq!(f.level, WarningLevel::Watch);
        assert_eq!(f.reason, WarningReason::IncomeOverdue);

        // a salary that is months late looks stopped: it is not counted and not flagged late
        let f = Fixture::run(
            1,
            date!(2027 - 02 - 10),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert_eq!(f.income_upcoming, Money::ZERO);
        assert_eq!(f.next_income_date, None);
        assert_ne!(f.reason, WarningReason::IncomeOverdue);
    }

    #[test]
    fn a_thin_margin_is_a_watch() {
        let (mut txs, recurring) = Fixture::month();
        // leaves about 2% of the salary (49 of 2500)
        txs.push(Fixture::tx(
            date!(2026 - 10 - 05),
            "Mediamarkt",
            -40000,
            Category::Shopping,
        ));
        txs.push(Fixture::tx(
            date!(2026 - 10 - 06),
            "Zalando",
            -33000,
            Category::Shopping,
        ));
        let f = Fixture::run(
            25,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Fixture::budget(0),
        );
        assert!(!f.projected_leftover.is_negative());
        assert!(f.projected_leftover.cents() * 100 < 250000 * 5);
        assert_eq!(f.reason, WarningReason::ThinMargin);
        assert_eq!(f.level, WarningLevel::Watch);
    }

    #[test]
    fn the_first_days_are_only_a_watch_unless_the_shortfall_is_certain() {
        let (_, recurring) = Fixture::month();
        // a big shop on payday itself: 29 more days at this pace would be absurd, but it is one day
        let txs = vec![
            Fixture::tx(
                date!(2026 - 09 - 25),
                "Arbeitgeber",
                250000,
                Category::Income,
            ),
            Fixture::tx(date!(2026 - 09 - 25), "Rewe", -15000, Category::Groceries),
        ];
        let f = Fixture::run(
            25,
            date!(2026 - 09 - 25),
            &txs,
            &recurring,
            &Fixture::budget(40000),
        );
        assert_eq!(f.days_through, 1);
        assert_eq!(f.days_after_today, 29);
        assert!(f.early);
        assert_eq!(f.projected_extra_spend.cents(), 15000 * 29);
        assert!(f.projected_leftover.is_negative());
        assert_eq!(f.reason, WarningReason::ProjectedShortfall);
        assert_eq!(f.level, WarningLevel::Watch);

        // bills larger than the income are a shortfall even on day one
        let txs = vec![
            Fixture::tx(
                date!(2026 - 09 - 25),
                "Arbeitgeber",
                100000,
                Category::Income,
            ),
            Fixture::tx(
                date!(2026 - 09 - 25),
                "Vermieter",
                -150000,
                Category::Housing,
            ),
        ];
        let recurring = vec![
            Fixture::recurring(
                "Arbeitgeber",
                100000,
                Cadence::Monthly,
                date!(2026 - 08 - 25),
            ),
            Fixture::recurring(
                "Vermieter",
                -150000,
                Cadence::Monthly,
                date!(2026 - 08 - 25),
            ),
        ];
        let f = Fixture::run(
            25,
            date!(2026 - 09 - 25),
            &txs,
            &recurring,
            &Budget::default(),
        );
        assert!(f.early);
        assert_eq!(f.level, WarningLevel::Danger);
    }

    #[test]
    fn the_last_day_has_nothing_left_to_project() {
        let (txs, recurring) = Fixture::month();
        let f = Fixture::run(
            25,
            date!(2026 - 10 - 24),
            &txs,
            &recurring,
            &Fixture::budget(40000),
        );
        assert_eq!(f.days_through, 30);
        assert_eq!(f.days_after_today, 0);
        assert_eq!(f.projected_extra_spend, Money::ZERO);
        // Netflix (20 Oct) was never booked, but four days late is still inside the grace, so it
        // stays a cost to come
        assert_eq!(f.fixed_costs_due.cents(), 1000);
        assert_eq!(
            f.projected_leftover,
            f.income_received + f.income_upcoming - f.spent_so_far - f.fixed_costs_due
        );
        assert_eq!(f.grocery_run_out, None);
    }

    #[test]
    fn the_boundary_day_belongs_to_the_next_period() {
        let (txs, recurring) = Fixture::month();
        let budget = Fixture::budget(40000);
        // 24 Oct is the last day of one period, 25 Oct the first of the next
        let last = Fixture::run(25, date!(2026 - 10 - 24), &txs, &recurring, &budget);
        let first = Fixture::run(25, date!(2026 - 10 - 25), &txs, &recurring, &budget);
        assert_eq!(last.period.end, date!(2026 - 10 - 24));
        assert_eq!(first.period.start, date!(2026 - 10 - 25));
        assert_eq!(first.days_through, 1);
        assert_eq!(first.days_after_today, 30);
        // nothing of the old period is carried over
        assert_eq!(first.spent_so_far, Money::ZERO);
        assert_eq!(first.grocery_spent, Money::ZERO);
        assert_eq!(first.grocery_run_out, None);
    }

    #[test]
    fn a_period_that_has_not_started_has_no_pace() {
        let (txs, recurring) = Fixture::month();
        let f = Forecast::calculate(&ForecastInput {
            period: BudgetPeriod::containing(date!(2026 - 10 - 25), 25),
            today: date!(2026 - 10 - 11),
            transactions: &txs,
            recurring: &recurring,
            budget: &Fixture::budget(40000),
        });
        assert_eq!(f.days_through, 0);
        assert_eq!(f.projected_extra_spend, Money::ZERO);
        assert_eq!(f.grocery_daily, Money::ZERO);
    }

    #[test]
    fn works_across_the_year_end() {
        let txs = vec![
            Fixture::tx(
                date!(2026 - 12 - 25),
                "Arbeitgeber",
                300000,
                Category::Income,
            ),
            Fixture::tx(date!(2026 - 12 - 28), "Rewe", -6000, Category::Groceries),
        ];
        let recurring = vec![
            Fixture::recurring(
                "Arbeitgeber",
                300000,
                Cadence::Monthly,
                date!(2026 - 12 - 25),
            ),
            Fixture::recurring("Strom", -6000, Cadence::Monthly, date!(2026 - 12 - 05)),
        ];
        let f = Fixture::run(
            25,
            date!(2027 - 01 - 03),
            &txs,
            &recurring,
            &Fixture::budget(30000),
        );
        assert_eq!(f.period.start, date!(2026 - 12 - 25));
        assert_eq!(f.period.end, date!(2027 - 01 - 24));
        assert_eq!(f.days_through, 10);
        assert_eq!(f.days_after_today, 21);
        assert_eq!(f.fixed_costs_due.cents(), 6000);
        assert_eq!(f.grocery_daily.cents(), 600);
        assert_eq!(f.projected_extra_spend.cents(), 6000 * 21 / 10);
        // 60 of 300 at 6 a day: 240 left lasts 40 days -> past the period end
        assert_eq!(f.grocery_run_out, None);
        assert_eq!(f.reason, WarningReason::OnTrack);
    }

    #[test]
    fn bookings_after_today_are_not_counted() {
        let (mut txs, recurring) = Fixture::month();
        txs.push(Fixture::tx(
            date!(2026 - 10 - 20),
            "Rewe",
            -99000,
            Category::Groceries,
        ));
        let f = Fixture::run(
            25,
            date!(2026 - 10 - 11),
            &txs,
            &recurring,
            &Fixture::budget(40000),
        );
        assert_eq!(f.grocery_spent.cents(), 20000);
    }
}
