//! Budget periods: a "month" that starts on payday instead of on the 1st.

use serde::{Deserialize, Serialize};
use time::{Date, Duration, Month};

use crate::budget::YearMonth;

/// One budget period, `start` and `end` both inclusive.
///
/// With payday 1 this is the calendar month. With payday 25 it runs from the 25th to the 24th of
/// the next month. The start day in a month is `min(payday, days in that month)`, so a payday of
/// 29 to 31 means "the last day of short months" and every day belongs to exactly one period.
/// (The API only accepts 1 to 28; the larger values are handled so that stored data can never
/// break the arithmetic.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct BudgetPeriod {
    pub start: Date,
    pub end: Date,
}

impl BudgetPeriod {
    /// Payday 1 is the calendar month.
    pub const DEFAULT_PAYDAY: u8 = 1;
    /// Largest payday the API accepts: every month has this day.
    pub const MAX_PAYDAY: u8 = 28;

    /// Whether `payday` is a day the settings accept (1 to 28).
    pub fn is_valid_payday(payday: u8) -> bool {
        (1..=Self::MAX_PAYDAY).contains(&payday)
    }

    /// The day the period starts on in `year`/`month`, clamped to the month's length.
    fn start_in(year: i32, month: Month, payday: u8) -> Date {
        let day = payday.clamp(1, 31).min(month.length(year));
        Date::from_calendar_date(year, month, day).expect("clamped day is valid")
    }

    /// `ym` shifted by `delta` calendar months.
    fn shift(ym: YearMonth, delta: i32) -> YearMonth {
        let index = ym.year * 12 + (ym.month as i32 - 1) + delta;
        YearMonth::new(
            index.div_euclid(12),
            Month::try_from(index.rem_euclid(12) as u8 + 1).expect("1..=12"),
        )
    }

    /// The period that starts in `ym` (its start day is `payday` of that month).
    pub fn for_month(ym: YearMonth, payday: u8) -> BudgetPeriod {
        let start = Self::start_in(ym.year, ym.month, payday);
        let next = Self::shift(ym, 1);
        let end = Self::start_in(next.year, next.month, payday) - Duration::days(1);
        BudgetPeriod { start, end }
    }

    /// The period that contains `date`.
    pub fn containing(date: Date, payday: u8) -> BudgetPeriod {
        let this = YearMonth::of(date);
        let starts_this_month = Self::start_in(this.year, this.month, payday);
        if date >= starts_this_month {
            Self::for_month(this, payday)
        } else {
            Self::for_month(Self::shift(this, -1), payday)
        }
    }

    /// The period right before this one.
    pub fn previous(self, payday: u8) -> BudgetPeriod {
        Self::containing(self.start - Duration::days(1), payday)
    }

    /// The period right after this one.
    pub fn next(self, payday: u8) -> BudgetPeriod {
        Self::containing(self.end + Duration::days(1), payday)
    }

    pub fn contains(self, date: Date) -> bool {
        self.start <= date && date <= self.end
    }

    /// Number of days in the period.
    pub fn days(self) -> u32 {
        ((self.end - self.start).whole_days() + 1) as u32
    }

    /// Days from `today` to the end, counting today. A period still ahead has all its days
    /// left, a finished one has none.
    pub fn days_left(self, today: Date) -> u32 {
        if today < self.start {
            self.days()
        } else if today > self.end {
            0
        } else {
            ((self.end - today).whole_days() + 1) as u32
        }
    }

    /// Days from the start up to and including `today`: 0 before the period, all of it after.
    /// (`days_through + days_left` is the period length plus one, because today is in both.)
    pub fn days_through(self, today: Date) -> u32 {
        if today < self.start {
            0
        } else if today > self.end {
            self.days()
        } else {
            ((today - self.start).whole_days() + 1) as u32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn period(start: Date, end: Date) -> BudgetPeriod {
        BudgetPeriod { start, end }
    }

    #[test]
    fn payday_one_is_the_calendar_month() {
        assert_eq!(
            BudgetPeriod::containing(date!(2026 - 03 - 15), 1),
            period(date!(2026 - 03 - 01), date!(2026 - 03 - 31))
        );
        assert_eq!(
            BudgetPeriod::containing(date!(2026 - 02 - 01), 1),
            period(date!(2026 - 02 - 01), date!(2026 - 02 - 28))
        );
        assert_eq!(
            BudgetPeriod::containing(date!(2028 - 02 - 29), 1),
            period(date!(2028 - 02 - 01), date!(2028 - 02 - 29))
        );
        assert_eq!(
            BudgetPeriod::for_month(YearMonth::new(2026, Month::March), 1).days(),
            31
        );
    }

    #[test]
    fn payday_25_runs_from_the_25th_to_the_24th() {
        let p = BudgetPeriod::containing(date!(2026 - 10 - 11), 25);
        assert_eq!(p, period(date!(2026 - 09 - 25), date!(2026 - 10 - 24)));
        assert_eq!(p.days(), 30);
        // the boundary days belong to the right side
        assert_eq!(
            BudgetPeriod::containing(date!(2026 - 10 - 24), 25),
            period(date!(2026 - 09 - 25), date!(2026 - 10 - 24))
        );
        assert_eq!(
            BudgetPeriod::containing(date!(2026 - 10 - 25), 25),
            period(date!(2026 - 10 - 25), date!(2026 - 11 - 24))
        );
    }

    #[test]
    fn periods_cross_the_year_end() {
        assert_eq!(
            BudgetPeriod::containing(date!(2026 - 12 - 30), 25),
            period(date!(2026 - 12 - 25), date!(2027 - 01 - 24))
        );
        assert_eq!(
            BudgetPeriod::containing(date!(2027 - 01 - 03), 25),
            period(date!(2026 - 12 - 25), date!(2027 - 01 - 24))
        );
        assert_eq!(
            BudgetPeriod::containing(date!(2027 - 01 - 03), 10),
            period(date!(2026 - 12 - 10), date!(2027 - 01 - 09))
        );
    }

    #[test]
    fn a_payday_beyond_the_month_clamps_to_its_last_day() {
        // payday 31: starts on the last day of every month
        assert_eq!(
            BudgetPeriod::containing(date!(2026 - 02 - 10), 31),
            period(date!(2026 - 01 - 31), date!(2026 - 02 - 27))
        );
        assert_eq!(
            BudgetPeriod::containing(date!(2026 - 02 - 28), 31),
            period(date!(2026 - 02 - 28), date!(2026 - 03 - 30))
        );
        assert_eq!(
            BudgetPeriod::containing(date!(2028 - 02 - 29), 30),
            period(date!(2028 - 02 - 29), date!(2028 - 03 - 29))
        );
        // payday 0 behaves like 1
        assert_eq!(
            BudgetPeriod::containing(date!(2026 - 03 - 15), 0),
            BudgetPeriod::containing(date!(2026 - 03 - 15), 1)
        );
    }

    #[test]
    fn periods_tile_the_calendar_without_gaps_or_overlaps() {
        for payday in [1u8, 15, 25, 28, 29, 31] {
            let mut day = date!(2026 - 01 - 01);
            let mut prev = BudgetPeriod::containing(day, payday);
            while day < date!(2029 - 01 - 01) {
                let p = BudgetPeriod::containing(day, payday);
                assert!(p.contains(day), "{day} payday {payday}");
                if p != prev {
                    assert_eq!(p.start, prev.end + Duration::days(1), "payday {payday}");
                    assert_eq!(prev.next(payday), p);
                    assert_eq!(p.previous(payday), prev);
                    prev = p;
                }
                day += Duration::days(1);
            }
        }
    }

    #[test]
    fn day_counts_for_the_running_period() {
        let p = period(date!(2026 - 09 - 25), date!(2026 - 10 - 24));
        assert_eq!(p.days_left(date!(2026 - 10 - 11)), 14);
        assert_eq!(p.days_through(date!(2026 - 10 - 11)), 17);
        assert_eq!(p.days_left(date!(2026 - 10 - 24)), 1);
        assert_eq!(p.days_left(date!(2026 - 09 - 25)), 30);
        assert_eq!(p.days_through(date!(2026 - 09 - 25)), 1);
        // outside the period
        assert_eq!(p.days_left(date!(2026 - 09 - 01)), 30);
        assert_eq!(p.days_through(date!(2026 - 09 - 01)), 0);
        assert_eq!(p.days_left(date!(2026 - 11 - 01)), 0);
        assert_eq!(p.days_through(date!(2026 - 11 - 01)), 30);
    }

    #[test]
    fn validates_paydays() {
        assert!(!BudgetPeriod::is_valid_payday(0));
        assert!(BudgetPeriod::is_valid_payday(1));
        assert!(BudgetPeriod::is_valid_payday(28));
        assert!(!BudgetPeriod::is_valid_payday(29));
    }
}
