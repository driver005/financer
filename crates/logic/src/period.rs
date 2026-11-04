//! Budget periods on the phone: the rule of `BudgetPeriod` in `financer-core` (the server's own),
//! so the game layer (streaks, daily goals) agrees with what the server counts as "this month".
//! With payday 1 a period is the calendar month; with payday 25 it runs from the 25th to the 24th.

use financer_core::BudgetPeriod;
use serde::{Deserialize, Serialize};
use time::Date;

use crate::format::date_of;

/// A period as the screens hold it: ISO dates, both ends included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Period {
    pub start: String,
    pub end: String,
}

const MONTH_NAMES: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

pub(crate) fn iso(d: Date) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), d.month() as u8, d.day())
}

/// A payday as the settings may hold it: whole days, 0 or missing means 1, beyond the month means its last day.
fn payday_of(payday: f64) -> u8 {
    let p = payday.trunc();
    if p.is_nan() || p < 1.0 {
        1
    } else {
        p.min(31.0) as u8
    }
}

fn core_of(p: &Period) -> Result<BudgetPeriod, String> {
    Ok(BudgetPeriod {
        start: date_of(&p.start)?,
        end: date_of(&p.end)?,
    })
}

fn period_of(p: BudgetPeriod) -> Period {
    Period {
        start: iso(p.start),
        end: iso(p.end),
    }
}

/// Number of days in `month` (1-12) of `year`.
pub fn days_in_month(year: i32, month: u8) -> Result<u8, String> {
    time::Month::try_from(month)
        .map(|m| m.length(year))
        .map_err(|_| format!("{month} is not a month (1-12)"))
}

/// The period that contains `date` (ISO `YYYY-MM-DD`).
pub fn budget_period(date: &str, payday: f64) -> Result<Period, String> {
    Ok(period_of(BudgetPeriod::containing(
        date_of(date)?,
        payday_of(payday),
    )))
}

/// The period right before `period`.
pub fn previous_period(period: &Period, payday: f64) -> Result<Period, String> {
    Ok(period_of(core_of(period)?.previous(payday_of(payday))))
}

/// Number of days in the period, both ends included.
pub fn period_days(period: &Period) -> Result<u32, String> {
    Ok(core_of(period)?.days())
}

/// A short label: the month name for a calendar-month period (`October 2026`), otherwise the date
/// range in German notation (`25.09. – 24.10.2026`).
pub fn period_label(period: &Period) -> Result<String, String> {
    let (s, e) = (date_of(&period.start)?, date_of(&period.end)?);
    let (sd, sm, sy) = (s.day(), s.month() as u8, s.year());
    let (ed, em, ey) = (e.day(), e.month() as u8, e.year());
    if sd == 1 && sy == ey && sm == em {
        return Ok(format!("{} {sy}", MONTH_NAMES[sm as usize - 1]));
    }
    let from = if sy == ey {
        format!("{sd:02}.{sm:02}.")
    } else {
        format!("{sd:02}.{sm:02}.{sy}")
    };
    Ok(format!("{from} \u{2013} {ed:02}.{em:02}.{ey}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(start: &str, end: &str) -> Period {
        Period {
            start: start.into(),
            end: end.into(),
        }
    }
    fn bp(date: &str, payday: f64) -> Period {
        budget_period(date, payday).unwrap()
    }

    #[test]
    fn it_is_the_calendar_month_at_payday_1() {
        assert_eq!(bp("2026-03-15", 1.0), p("2026-03-01", "2026-03-31"));
        assert_eq!(bp("2026-02-01", 1.0), p("2026-02-01", "2026-02-28"));
        assert_eq!(bp("2028-02-29", 1.0), p("2028-02-01", "2028-02-29"));
    }

    #[test]
    fn it_runs_from_the_25th_to_the_24th_at_payday_25() {
        assert_eq!(bp("2026-10-11", 25.0), p("2026-09-25", "2026-10-24"));
        assert_eq!(bp("2026-10-24", 25.0), p("2026-09-25", "2026-10-24"));
        assert_eq!(bp("2026-10-25", 25.0), p("2026-10-25", "2026-11-24"));
    }

    #[test]
    fn it_crosses_the_year_end() {
        assert_eq!(bp("2026-12-30", 25.0), p("2026-12-25", "2027-01-24"));
        assert_eq!(bp("2027-01-03", 25.0), p("2026-12-25", "2027-01-24"));
        assert_eq!(bp("2027-01-03", 10.0), p("2026-12-10", "2027-01-09"));
    }

    #[test]
    fn a_payday_beyond_the_month_means_its_last_day() {
        assert_eq!(bp("2026-02-10", 31.0), p("2026-01-31", "2026-02-27"));
        assert_eq!(bp("2026-02-28", 31.0), p("2026-02-28", "2026-03-30"));
        assert_eq!(bp("2028-02-29", 30.0), p("2028-02-29", "2028-03-29"));
        assert_eq!(bp("2026-03-15", 0.0), bp("2026-03-15", 1.0));
        assert_eq!(bp("2026-03-15", f64::NAN), bp("2026-03-15", 1.0));
        assert_eq!(bp("2026-03-15", 25.9), bp("2026-03-15", 25.0));
    }

    #[test]
    fn periods_tile_the_calendar() {
        for payday in [1.0, 15.0, 25.0, 28.0, 29.0, 31.0] {
            let mut day = Date::from_calendar_date(2026, time::Month::January, 1).unwrap();
            let mut prev = bp("2026-01-01", payday);
            while day.year() < 2029 {
                let d = iso(day);
                let cur = bp(&d, payday);
                assert!(cur.start <= d && d <= cur.end, "{d} payday {payday}");
                if cur.start != prev.start {
                    assert_eq!(previous_period(&cur, payday).unwrap().start, prev.start);
                    assert_eq!(
                        iso(date_of(&prev.end).unwrap().next_day().unwrap()),
                        cur.start
                    );
                    prev = cur;
                }
                day = day.next_day().unwrap();
            }
        }
    }

    #[test]
    fn days_count_both_ends() {
        assert_eq!(period_days(&p("2026-09-25", "2026-10-24")).unwrap(), 30);
        assert_eq!(period_days(&bp("2026-03-10", 1.0)).unwrap(), 31);
        assert_eq!(period_days(&bp("2026-02-10", 1.0)).unwrap(), 28);
    }

    #[test]
    fn calendar_months_are_labelled_by_name_and_other_periods_by_their_dates() {
        assert_eq!(
            period_label(&bp("2026-10-11", 1.0)).unwrap(),
            "October 2026"
        );
        assert_eq!(
            period_label(&bp("2026-10-11", 25.0)).unwrap(),
            "25.09. \u{2013} 24.10.2026"
        );
        assert_eq!(
            period_label(&bp("2027-01-03", 25.0)).unwrap(),
            "25.12.2026 \u{2013} 24.01.2027"
        );
    }

    #[test]
    fn months_know_their_length() {
        assert_eq!(days_in_month(2026, 2).unwrap(), 28);
        assert_eq!(days_in_month(2028, 2).unwrap(), 29);
        assert_eq!(days_in_month(2026, 12).unwrap(), 31);
        assert!(days_in_month(2026, 13).is_err());
    }

    #[test]
    fn a_bad_date_is_an_error_not_a_guess() {
        assert!(budget_period("2026-13-01", 1.0).is_err());
        assert!(period_label(&p("x", "y")).is_err());
    }
}
