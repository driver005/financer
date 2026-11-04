//! Wording for the "safe to spend today" card and its explainer sheet. The numbers all come from the
//! server (`GET /v1/budget/safe-to-spend`); this only turns them into rows and sentences, so what the
//! sheet shows always adds up to the big number.

use serde::{Deserialize, Serialize};

use crate::format::format_cents;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pace {
    OnTrack,
    OverPace,
    Unknown,
}

/// The part of the server's answer the card reads.
#[derive(Debug, Clone, Deserialize)]
pub struct SafeToSpend {
    pub days_left: i64,
    pub available_cents: i64,
    pub income_detected: bool,
    pub income_cents: i64,
    pub income_received_cents: i64,
    pub income_upcoming_cents: i64,
    pub spent_so_far_cents: i64,
    pub fixed_costs_due_cents: i64,
    pub envelope_headroom_cents: i64,
    pub pace: Pace,
    pub pace_target_cents: i64,
    pub discretionary_spent_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BreakdownRow {
    pub id: &'static str,
    pub label: &'static str,
    /// Signed as it enters the sum: income is positive, everything taken off is negative.
    pub cents: i64,
    pub hint: String,
}

pub fn breakdown_rows(s: &SafeToSpend) -> Vec<BreakdownRow> {
    vec![
        BreakdownRow {
            id: "income",
            label: "Income this period",
            cents: s.income_cents,
            hint: if s.income_detected {
                format!(
                    "{} arrived, {} still expected (from recurring income)",
                    format_cents(s.income_received_cents),
                    format_cents(s.income_upcoming_cents)
                )
            } else {
                "No recurring income found in your bookings yet".into()
            },
        },
        BreakdownRow {
            id: "spent",
            label: "Spent so far",
            cents: -s.spent_so_far_cents,
            hint: "Everything booked in this period, including fixed costs already paid".into(),
        },
        BreakdownRow {
            id: "fixed",
            label: "Fixed costs still to come",
            cents: -s.fixed_costs_due_cents,
            hint: "Recurring payments (rent, subscriptions) due before the period ends".into(),
        },
        BreakdownRow {
            id: "envelopes",
            label: "Planned in envelopes",
            cents: -s.envelope_headroom_cents,
            hint: "Budget limits you have not used up yet; kept aside for those categories".into(),
        },
    ]
}

/// `14 days left in this period` / `the last day of this period`.
pub fn days_left_text(days_left: i64) -> String {
    if days_left <= 1 {
        "the last day of this period".into()
    } else {
        format!("{days_left} days left in this period")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PaceInfo {
    pub tone: &'static str,
    pub title: &'static str,
    pub detail: String,
}

pub fn pace_info(s: &SafeToSpend) -> PaceInfo {
    if s.pace == Pace::Unknown {
        return PaceInfo {
            tone: "muted",
            title: "Pace unknown",
            detail: "Needs recurring income to compare against. Import a few months of bookings with your salary.".into(),
        };
    }
    let detail = format!(
        "You have spent {} on everyday things; a straight-line plan would allow {} by today.",
        format_cents(s.discretionary_spent_cents),
        format_cents(s.pace_target_cents)
    );
    if s.pace == Pace::OverPace {
        PaceInfo {
            tone: "warn",
            title: "Over pace",
            detail,
        }
    } else {
        PaceInfo {
            tone: "good",
            title: "On track",
            detail,
        }
    }
}

/// The one-sentence summary under the big number.
pub fn headline_hint(s: &SafeToSpend) -> String {
    if !s.income_detected {
        return "No recurring income found yet, so there is nothing to plan with.".into();
    }
    if s.available_cents < 0 {
        return format!(
            "This period is over budget by {}.",
            format_cents(-s.available_cents)
        );
    }
    format!(
        "{} free for {}.",
        format_cents(s.available_cents),
        days_left_text(s.days_left)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> SafeToSpend {
        SafeToSpend {
            days_left: 14,
            available_cents: 129000,
            income_detected: true,
            income_cents: 250000,
            income_received_cents: 250000,
            income_upcoming_cents: 0,
            spent_so_far_cents: 100000,
            fixed_costs_due_cents: 1000,
            envelope_headroom_cents: 20000,
            pace: Pace::OnTrack,
            pace_target_cents: 95766,
            discretionary_spent_cents: 20000,
        }
    }

    #[test]
    fn the_breakdown_adds_up_to_the_available_amount() {
        let rows = breakdown_rows(&base());
        assert_eq!(
            rows.iter().map(|r| r.cents).sum::<i64>(),
            base().available_cents
        );
        assert_eq!(
            rows.iter().map(|r| r.id).collect::<Vec<_>>(),
            ["income", "spent", "fixed", "envelopes"]
        );
    }

    #[test]
    fn it_says_where_the_income_comes_from_or_that_there_is_none() {
        assert!(breakdown_rows(&base())[0]
            .hint
            .contains("2.500,00 € arrived, 0,00 € still expected"));
        let none = SafeToSpend {
            income_detected: false,
            income_cents: 0,
            ..base()
        };
        assert!(breakdown_rows(&none)[0]
            .hint
            .contains("No recurring income"));
    }

    #[test]
    fn it_describes_the_days_left() {
        assert_eq!(days_left_text(14), "14 days left in this period");
        assert_eq!(days_left_text(1), "the last day of this period");
    }

    #[test]
    fn it_explains_the_pace() {
        assert_eq!(pace_info(&base()).title, "On track");
        assert_eq!(pace_info(&base()).tone, "good");
        assert_eq!(
            pace_info(&SafeToSpend {
                pace: Pace::OverPace,
                ..base()
            })
            .tone,
            "warn"
        );
        assert_eq!(
            pace_info(&SafeToSpend {
                pace: Pace::Unknown,
                ..base()
            })
            .tone,
            "muted"
        );
        assert!(pace_info(&base()).detail.contains("957,66 €"));
    }

    #[test]
    fn it_summarises_the_situation() {
        assert!(headline_hint(&base()).contains("1.290,00 € free for 14 days left"));
        assert!(headline_hint(&SafeToSpend {
            available_cents: -2500,
            ..base()
        })
        .contains("over budget by 25,00 €"));
        assert!(headline_hint(&SafeToSpend {
            income_detected: false,
            ..base()
        })
        .contains("No recurring income"));
    }
}
