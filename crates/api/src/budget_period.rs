//! Payday-based budget periods and "safe to spend today".
//!
//! The payday (day of month, 1 to 28, default 1 = calendar month) is the `payday` entry of the
//! settings table; `PUT /v1/settings` changes it.

use axum::extract::{Query, State};
use axum::Json;
use financer_core::{
    BudgetPeriod, Pace, RecurringDetector, SafeToSpend, SafeToSpendInput, Transaction, YearMonth,
};
use serde::{Deserialize, Serialize};
use time::{Date, Month, OffsetDateTime};
use utoipa::ToSchema;

use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

const PAYDAY_KEY: &str = "payday";

/// Which period to look at when no year and month are given.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PeriodChoice {
    /// The period that contains the date (default: today).
    #[default]
    Current,
    /// The period right before it.
    Previous,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct PeriodQuery {
    /// `current` (default) or `previous`.
    period: Option<PeriodChoice>,
    /// The day to treat as today, ISO format (`2026-10-11`). Defaults to today (UTC); the app
    /// sends its local date so that a late evening is not already "tomorrow".
    #[param(value_type = Option<String>, format = Date, example = "2026-10-11")]
    date: Option<Date>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SafeToSpendQuery {
    /// The day to treat as today, ISO format. Defaults to today (UTC).
    #[param(value_type = Option<String>, format = Date, example = "2026-10-11")]
    date: Option<Date>,
}

/// A budget period: from payday to the day before the next payday.
#[derive(Debug, Serialize, ToSchema)]
pub struct PeriodDto {
    /// Day of month the period starts on (1 = calendar month).
    pub payday: u8,
    /// First day, inclusive.
    #[schema(value_type = String, format = Date, example = "2026-09-25")]
    pub start: Date,
    /// Last day, inclusive.
    #[schema(value_type = String, format = Date, example = "2026-10-24")]
    pub end: Date,
    /// Length of the period in days.
    pub days: u32,
    /// Days left including the reference day (0 for a finished period).
    pub days_left: u32,
}

/// The daily number and everything behind it. Amounts are integer cents.
#[derive(Debug, Serialize, ToSchema)]
pub struct SafeToSpendDto {
    pub payday: u8,
    #[schema(value_type = String, format = Date)]
    pub period_start: Date,
    #[schema(value_type = String, format = Date)]
    pub period_end: Date,
    #[schema(value_type = String, format = Date)]
    pub today: Date,
    /// Days left in the period, counting today.
    pub days_left: u32,
    pub days_total: u32,
    /// What you can spend per day for the rest of the period; never negative.
    pub daily_cents: i64,
    /// `income - spent_so_far - fixed_costs_due - envelope_headroom`; negative when overspent.
    pub available_cents: i64,
    /// Whether any recurring income was found in the bookings.
    pub income_detected: bool,
    /// Recurring income booked so far plus what is still expected this period.
    pub income_cents: i64,
    pub income_received_cents: i64,
    pub income_upcoming_cents: i64,
    pub spent_so_far_cents: i64,
    /// Recurring payments still to come this period.
    pub fixed_costs_due_cents: i64,
    /// Planned envelope money that is not spent yet (never negative).
    pub envelope_headroom_cents: i64,
    /// `on_track`, `over_pace` or `unknown` (no income detected).
    #[schema(value_type = String, example = "on_track")]
    pub pace: Pace,
    /// The straight-line share of discretionary spending that may be used up by today.
    pub pace_target_cents: i64,
    /// Spending so far without the fixed costs already paid.
    pub discretionary_spent_cents: i64,
}

/// Handlers' real logic; the free functions below are thin shims because `#[utoipa::path]`
/// cannot annotate methods.
pub struct BudgetPeriods;

impl BudgetPeriods {
    fn today() -> Date {
        OffsetDateTime::now_utc().date()
    }

    /// The configured payday; 1 when unset or when the stored value is not a valid day.
    pub async fn payday(state: &AppState) -> Result<u8, ApiError> {
        Ok(state
            .store
            .get_setting(PAYDAY_KEY)
            .await?
            .and_then(|v| v.trim().parse::<u8>().ok())
            .filter(|d| BudgetPeriod::is_valid_payday(*d))
            .unwrap_or(BudgetPeriod::DEFAULT_PAYDAY))
    }

    /// Check a payday from a settings update (1 to 28).
    pub fn validate_payday(payday: Option<i64>) -> Result<(), ApiError> {
        match payday {
            Some(d) if !u8::try_from(d).is_ok_and(BudgetPeriod::is_valid_payday) => Err(
                ApiError::BadRequest("payday must be a day of the month from 1 to 28".into()),
            ),
            _ => Ok(()),
        }
    }

    pub async fn set_payday(state: &AppState, payday: i64) -> Result<(), ApiError> {
        Self::validate_payday(Some(payday))?;
        state
            .store
            .set_setting(PAYDAY_KEY, &payday.to_string())
            .await?;
        Ok(())
    }

    /// The period a budget status request means:
    /// * `period=current|previous` (relative to `date`, default today), or
    /// * `year` and `month`: the period that starts in that month (the calendar month when the
    ///   payday is 1), or
    /// * nothing: the current period.
    pub async fn resolve(
        state: &AppState,
        year: Option<i32>,
        month: Option<u8>,
        choice: Option<PeriodChoice>,
        date: Option<Date>,
    ) -> Result<BudgetPeriod, ApiError> {
        let payday = Self::payday(state).await?;
        match (year, month, choice) {
            (Some(_), Some(_), Some(_)) => Err(ApiError::BadRequest(
                "use either year and month, or period".into(),
            )),
            (Some(year), Some(month), None) => {
                let month = Month::try_from(month)
                    .map_err(|_| ApiError::BadRequest("month must be 1-12".into()))?;
                Ok(BudgetPeriod::for_month(YearMonth::new(year, month), payday))
            }
            (Some(_), None, _) | (None, Some(_), _) => Err(ApiError::BadRequest(
                "year and month must be given together".into(),
            )),
            (None, None, choice) => {
                let current = BudgetPeriod::containing(date.unwrap_or_else(Self::today), payday);
                Ok(match choice.unwrap_or_default() {
                    PeriodChoice::Current => current,
                    PeriodChoice::Previous => current.previous(payday),
                })
            }
        }
    }

    pub async fn period(
        State(state): State<AppState>,
        Query(q): Query<PeriodQuery>,
    ) -> Result<Json<PeriodDto>, ApiError> {
        let payday = Self::payday(&state).await?;
        let reference = q.date.unwrap_or_else(Self::today);
        let period = Self::resolve(&state, None, None, q.period, Some(reference)).await?;
        Ok(Json(PeriodDto {
            payday,
            start: period.start,
            end: period.end,
            days: period.days(),
            days_left: period.days_left(reference),
        }))
    }

    pub async fn safe_to_spend(
        State(state): State<AppState>,
        Query(q): Query<SafeToSpendQuery>,
    ) -> Result<Json<SafeToSpendDto>, ApiError> {
        let payday = Self::payday(&state).await?;
        let today = q.date.unwrap_or_else(Self::today);
        let txs: Vec<Transaction> = state
            .store
            .list_transactions()
            .await?
            .into_iter()
            .map(|s| s.transaction)
            .collect();
        let recurring = RecurringDetector::detect(&txs);
        let budget = state.store.load_budget().await?;
        let period = BudgetPeriod::containing(today, payday);
        let s = SafeToSpend::calculate(&SafeToSpendInput {
            period,
            today,
            transactions: &txs,
            recurring: &recurring,
            budget: &budget,
        });
        Ok(Json(SafeToSpendDto {
            payday,
            period_start: period.start,
            period_end: period.end,
            today,
            days_left: s.days_left,
            days_total: period.days(),
            daily_cents: s.daily.cents(),
            available_cents: s.available.cents(),
            income_detected: s.income_detected,
            income_cents: s.income.cents(),
            income_received_cents: s.income_received.cents(),
            income_upcoming_cents: s.income_upcoming.cents(),
            spent_so_far_cents: s.spent_so_far.cents(),
            fixed_costs_due_cents: s.fixed_costs_due.cents(),
            envelope_headroom_cents: s.envelope_headroom.cents(),
            pace: s.pace,
            pace_target_cents: s.pace_target.cents(),
            discretionary_spent_cents: s.discretionary_spent.cents(),
        }))
    }
}

/// The budget period you are in (or the previous one), from your payday setting.
#[utoipa::path(
    get,
    path = "/v1/budget/period",
    params(PeriodQuery),
    responses((status = 200, body = PeriodDto)),
    security(("bearer" = []))
)]
pub async fn budget_period(
    State(state): State<AppState>,
    Query(q): Query<PeriodQuery>,
) -> Result<Json<PeriodDto>, ApiError> {
    BudgetPeriods::period(State(state), Query(q)).await
}

/// What you can spend per day for the rest of the period, with the breakdown: expected income,
/// recurring costs still to come, planned envelope money not yet spent, and spending so far.
#[utoipa::path(
    get,
    path = "/v1/budget/safe-to-spend",
    params(SafeToSpendQuery),
    responses(
        (status = 200, body = SafeToSpendDto),
        (status = 400, description = "Invalid date", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn safe_to_spend(
    State(state): State<AppState>,
    Query(q): Query<SafeToSpendQuery>,
) -> Result<Json<SafeToSpendDto>, ApiError> {
    BudgetPeriods::safe_to_spend(State(state), Query(q)).await
}
