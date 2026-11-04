//! Wording for the end-of-period forecast card. The numbers and the warning all come from the server
//! (`GET /v1/forecast`, see `financer-core`'s forecast); this only turns them into sentences, so the
//! card never disagrees with the server about the level or the run-out date.

use serde::{Deserialize, Serialize};

use crate::format::{date_of, format_cents, format_date};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Ok,
    Watch,
    Danger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    NoData,
    NoIncome,
    ProjectedShortfall,
    IncomeOverdue,
    GroceriesRunOut,
    ThinMargin,
    IncomePending,
    OnTrack,
}

/// The part of the server's answer the card reads.
#[derive(Debug, Clone, Deserialize)]
pub struct Forecast {
    pub period_end: String,
    pub days_through: i64,
    pub days_after_today: i64,
    pub early: bool,
    pub income_upcoming_cents: i64,
    pub next_income_date: Option<String>,
    pub grocery_spent_cents: i64,
    pub projected_leftover_cents: i64,
    pub grocery_limit_cents: Option<i64>,
    pub grocery_run_out: Option<String>,
    pub grocery_exhausted: bool,
    pub level: Level,
    pub reason: Reason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastView {
    pub tone: &'static str,
    /// Short badge text: "On track", "Keep an eye on it", "Heading for a shortfall".
    pub status: &'static str,
    /// The big number; none when there is nothing to project yet.
    pub amount_cents: Option<i64>,
    /// What the big number means, e.g. "left at the end of the period".
    pub amount_label: &'static str,
    /// The reason for the warning level, in plain language.
    pub reason: String,
    /// About the grocery budget; none without a grocery limit.
    pub groceries: Option<String>,
    /// Caveat for the first days of a period.
    pub early: Option<String>,
}

/// `19.10.` from `2026-10-19`.
pub fn short_date(iso: &str) -> String {
    let mut p = iso.split('-');
    let (_, m, d) = (p.next(), p.next().unwrap_or(""), p.next().unwrap_or(""));
    format!("{d}.{m}.")
}

/// Whole days from `from` to `to` (both `YYYY-MM-DD`).
pub fn days_between(from: &str, to: &str) -> Result<i64, String> {
    Ok((date_of(to)? - date_of(from)?).whole_days())
}

fn plural(n: i64, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// The sentence about the grocery budget, or none when there is no grocery limit.
pub fn grocery_text(f: &Forecast) -> Result<Option<String>, String> {
    let Some(limit) = f.grocery_limit_cents else {
        return Ok(None);
    };
    if f.grocery_exhausted {
        // short_date ends in a dot, which doubles as the end of the sentence
        let day = f
            .grocery_run_out
            .as_deref()
            .map_or(".".to_string(), |d| format!(" on {}", short_date(d)));
        return Ok(Some(format!(
            "Your grocery budget of {} was used up{day}",
            format_cents(limit)
        )));
    }
    if let Some(run_out) = &f.grocery_run_out {
        let before = days_between(run_out, &f.period_end)?;
        return Ok(Some(format!(
            "At this pace the grocery budget runs out on {}, {} before the period ends.",
            short_date(run_out),
            plural(before, "day", "days")
        )));
    }
    if f.grocery_spent_cents == 0 {
        return Ok(Some(
            "No grocery spending yet, so the budget is untouched.".into(),
        ));
    }
    Ok(Some(
        "The grocery budget should last until the period ends.".into(),
    ))
}

/// Everything the forecast card shows.
pub fn forecast_view(f: &Forecast) -> Result<ForecastView, String> {
    let groceries = grocery_text(f)?;
    let early = (f.early && f.days_after_today > 0 && f.reason != Reason::NoData).then(|| {
        format!(
            "Only {} of this period {} over, so this is a rough guess.",
            plural(f.days_through, "day", "days"),
            if f.days_through == 1 { "is" } else { "are" }
        )
    });
    let left = "left at the end of the period";
    let view = |tone, status, amount: Option<i64>, label, reason: String| ForecastView {
        tone,
        status,
        amount_cents: amount,
        amount_label: label,
        reason,
        groceries: groceries.clone(),
        early: early.clone(),
    };
    let amount = Some(f.projected_leftover_cents);
    Ok(match f.reason {
        Reason::NoData => ForecastView {
            early: None,
            ..view("muted", "Not enough data", None, "", "Import some bookings and I can tell how this period will end.".into())
        },
        Reason::NoIncome => view(
            "muted",
            "Income unknown",
            None,
            "",
            "No recurring income found in your bookings, so there is nothing to compare your spending with.".into(),
        ),
        Reason::ProjectedShortfall => {
            let short = -f.projected_leftover_cents;
            let danger = f.level == Level::Danger;
            view(
                if danger { "bad" } else { "warn" },
                if danger { "Heading for a shortfall" } else { "Could end short" },
                amount,
                "projected at the end of the period",
                format!("At the current pace you would end the period {} short.", format_cents(short)),
            )
        }
        Reason::IncomeOverdue => view(
            "warn",
            "Income is late",
            amount,
            "left at the end if it arrives",
            format!(
                "Your income of {} was expected on {} and is not booked yet.",
                format_cents(f.income_upcoming_cents),
                f.next_income_date.as_deref().map_or("an earlier day".to_string(), format_date)
            ),
        ),
        Reason::GroceriesRunOut => view(
            "warn",
            "Keep an eye on groceries",
            amount,
            left,
            groceries.clone().unwrap_or_else(|| "The grocery budget runs out before the period ends.".into()),
        ),
        Reason::ThinMargin => view(
            "warn",
            "Tight month",
            amount,
            left,
            format!("Only {} would be left, a very small cushion.", format_cents(f.projected_leftover_cents)),
        ),
        Reason::IncomePending => view(
            "good",
            "On track",
            amount,
            left,
            format!(
                "Counting on {} arriving{}.",
                format_cents(f.income_upcoming_cents),
                f.next_income_date.as_deref().map_or(String::new(), |d| format!(" on {}", format_date(d)))
            ),
        ),
        Reason::OnTrack => view(
            "good",
            "On track",
            amount,
            left,
            format!("At the current pace you end the period with {} to spare.", format_cents(f.projected_leftover_cents)),
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Forecast {
        Forecast {
            period_end: "2026-10-24".into(),
            days_through: 17,
            days_after_today: 13,
            early: false,
            income_upcoming_cents: 0,
            next_income_date: None,
            grocery_spent_cents: 20000,
            projected_leftover_cents: 133706,
            grocery_limit_cents: Some(40000),
            grocery_run_out: None,
            grocery_exhausted: false,
            level: Level::Ok,
            reason: Reason::OnTrack,
        }
    }

    #[test]
    fn it_shortens_and_subtracts_iso_dates() {
        assert_eq!(short_date("2026-10-19"), "19.10.");
        assert_eq!(days_between("2026-10-19", "2026-10-24").unwrap(), 5);
        assert_eq!(days_between("2026-12-30", "2027-01-02").unwrap(), 3);
        assert_eq!(days_between("2026-10-24", "2026-10-24").unwrap(), 0);
    }

    #[test]
    fn grocery_wording_says_nothing_without_a_limit() {
        let none = Forecast {
            grocery_limit_cents: None,
            ..base()
        };
        assert_eq!(grocery_text(&none).unwrap(), None);
        assert_eq!(forecast_view(&none).unwrap().groceries, None);
    }

    #[test]
    fn it_names_the_run_out_date_and_how_many_days_early_it_is() {
        let f = Forecast {
            grocery_run_out: Some("2026-10-19".into()),
            level: Level::Watch,
            reason: Reason::GroceriesRunOut,
            ..base()
        };
        assert_eq!(
            grocery_text(&f).unwrap().unwrap(),
            "At this pace the grocery budget runs out on 19.10., 5 days before the period ends."
        );
        let one = Forecast {
            grocery_run_out: Some("2026-10-23".into()),
            ..f
        };
        assert!(grocery_text(&one)
            .unwrap()
            .unwrap()
            .contains("on 23.10., 1 day before"));
    }

    #[test]
    fn it_says_when_the_budget_is_used_up_and_when_it_lasts() {
        let used = Forecast {
            grocery_exhausted: true,
            grocery_run_out: Some("2026-10-09".into()),
            ..base()
        };
        assert_eq!(
            grocery_text(&used).unwrap().unwrap(),
            "Your grocery budget of 400,00 € was used up on 09.10."
        );
        let no_day = Forecast {
            grocery_exhausted: true,
            grocery_run_out: None,
            ..base()
        };
        assert_eq!(
            grocery_text(&no_day).unwrap().unwrap(),
            "Your grocery budget of 400,00 € was used up."
        );
        assert!(grocery_text(&base())
            .unwrap()
            .unwrap()
            .contains("should last until the period ends"));
        assert!(grocery_text(&Forecast {
            grocery_spent_cents: 0,
            ..base()
        })
        .unwrap()
        .unwrap()
        .contains("No grocery spending yet"));
    }

    #[test]
    fn it_is_good_news_when_on_track() {
        let v = forecast_view(&base()).unwrap();
        assert_eq!((v.tone, v.status), ("good", "On track"));
        assert_eq!(v.amount_cents, Some(133706));
        assert_eq!(
            v.reason,
            "At the current pace you end the period with 1.337,06 € to spare."
        );
        assert_eq!(v.early, None);
    }

    #[test]
    fn it_calls_a_shortfall_a_shortfall_and_softens_it_early_in_the_period() {
        let short = Forecast {
            projected_leftover_cents: -25117,
            level: Level::Danger,
            reason: Reason::ProjectedShortfall,
            ..base()
        };
        let v = forecast_view(&short).unwrap();
        assert_eq!((v.tone, v.status), ("bad", "Heading for a shortfall"));
        assert_eq!(v.amount_cents, Some(-25117));
        assert_eq!(
            v.reason,
            "At the current pace you would end the period 251,17 € short."
        );

        let early = forecast_view(&Forecast {
            level: Level::Watch,
            early: true,
            days_through: 1,
            days_after_today: 29,
            ..short
        })
        .unwrap();
        assert_eq!((early.tone, early.status), ("warn", "Could end short"));
        assert_eq!(
            early.early.as_deref(),
            Some("Only 1 day of this period is over, so this is a rough guess.")
        );
    }

    #[test]
    fn it_explains_pending_and_late_income() {
        let pending = forecast_view(&Forecast {
            income_upcoming_cents: 250000,
            next_income_date: Some("2026-10-28".into()),
            reason: Reason::IncomePending,
            ..base()
        })
        .unwrap();
        assert_eq!(pending.tone, "good");
        assert_eq!(
            pending.reason,
            "Counting on 2.500,00 € arriving on 28.10.2026."
        );

        let late = forecast_view(&Forecast {
            income_upcoming_cents: 250000,
            next_income_date: Some("2026-10-09".into()),
            level: Level::Watch,
            reason: Reason::IncomeOverdue,
            ..base()
        })
        .unwrap();
        assert_eq!((late.tone, late.status), ("warn", "Income is late"));
        assert!(late
            .reason
            .contains("expected on 09.10.2026 and is not booked yet"));
    }

    #[test]
    fn it_warns_about_groceries_with_the_date() {
        let v = forecast_view(&Forecast {
            grocery_run_out: Some("2026-10-19".into()),
            level: Level::Watch,
            reason: Reason::GroceriesRunOut,
            ..base()
        })
        .unwrap();
        assert_eq!((v.tone, v.status), ("warn", "Keep an eye on groceries"));
        assert!(v.reason.contains("runs out on 19.10."));
        assert_eq!(Some(&v.reason), v.groceries.as_ref());
    }

    #[test]
    fn it_flags_a_thin_margin() {
        let v = forecast_view(&Forecast {
            projected_leftover_cents: 4883,
            level: Level::Watch,
            reason: Reason::ThinMargin,
            ..base()
        })
        .unwrap();
        assert_eq!(v.tone, "warn");
        assert!(v.reason.contains("Only 48,83 € would be left"));
    }

    #[test]
    fn it_does_not_invent_a_number_without_data_or_income() {
        let none = forecast_view(&Forecast {
            early: true,
            projected_leftover_cents: 0,
            reason: Reason::NoData,
            ..base()
        })
        .unwrap();
        assert_eq!(
            (none.amount_cents, none.tone, none.early),
            (None, "muted", None)
        );
        let no_income = forecast_view(&Forecast {
            reason: Reason::NoIncome,
            ..base()
        })
        .unwrap();
        assert_eq!(no_income.amount_cents, None);
        assert!(no_income.reason.contains("No recurring income"));
    }

    #[test]
    fn it_only_mentions_an_early_guess_while_days_remain() {
        let three = forecast_view(&Forecast {
            early: true,
            days_through: 3,
            days_after_today: 27,
            ..base()
        })
        .unwrap();
        assert_eq!(
            three.early.as_deref(),
            Some("Only 3 days of this period are over, so this is a rough guess.")
        );
        assert_eq!(
            forecast_view(&Forecast {
                early: true,
                days_through: 3,
                days_after_today: 0,
                ..base()
            })
            .unwrap()
            .early,
            None
        );
    }
}
