//! `GET /v1/forecast`: where the current budget period is heading (see `financer_core::forecast`).

use axum::extract::{Query, State};
use axum::Json;
use financer_core::{
    BudgetPeriod, Forecast, ForecastInput, RecurringDetector, Transaction, WarningLevel,
    WarningReason,
};
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;

use crate::budget_period::BudgetPeriods;
use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ForecastQuery {
    /// The day to treat as today, ISO format. Defaults to today (UTC); the app sends its local date.
    #[param(value_type = Option<String>, format = Date, example = "2026-10-11")]
    date: Option<Date>,
}

/// How worried to be about the end of the period.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WarningLevelDto {
    Ok,
    Watch,
    Danger,
}

impl From<WarningLevel> for WarningLevelDto {
    fn from(level: WarningLevel) -> Self {
        match level {
            WarningLevel::Ok => Self::Ok,
            WarningLevel::Watch => Self::Watch,
            WarningLevel::Danger => Self::Danger,
        }
    }
}

/// Why the warning level is what it is.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WarningReasonDto {
    /// No bookings yet.
    NoData,
    /// No recurring income was found, so there is nothing to compare the spending to.
    NoIncome,
    /// The period is projected to end below zero.
    ProjectedShortfall,
    /// Expected income is later than its date and not booked yet.
    IncomeOverdue,
    /// The grocery budget runs out before the period ends.
    GroceriesRunOut,
    /// The projected leftover is below 5% of the income.
    ThinMargin,
    /// The projection counts on income that has not arrived yet.
    IncomePending,
    OnTrack,
}

impl From<WarningReason> for WarningReasonDto {
    fn from(reason: WarningReason) -> Self {
        match reason {
            WarningReason::NoData => Self::NoData,
            WarningReason::NoIncome => Self::NoIncome,
            WarningReason::ProjectedShortfall => Self::ProjectedShortfall,
            WarningReason::IncomeOverdue => Self::IncomeOverdue,
            WarningReason::GroceriesRunOut => Self::GroceriesRunOut,
            WarningReason::ThinMargin => Self::ThinMargin,
            WarningReason::IncomePending => Self::IncomePending,
            WarningReason::OnTrack => Self::OnTrack,
        }
    }
}

/// The end-of-period projection. Amounts are integer cents.
#[derive(Debug, Serialize, ToSchema)]
pub struct ForecastDto {
    pub payday: u8,
    #[schema(value_type = String, format = Date)]
    pub period_start: Date,
    #[schema(value_type = String, format = Date)]
    pub period_end: Date,
    #[schema(value_type = String, format = Date)]
    pub today: Date,
    /// Days of the period up to and including today.
    pub days_through: u32,
    /// Days after today until the period ends.
    pub days_after_today: u32,
    /// Only the first days of the period are over: the pace is a rough guess.
    pub early: bool,
    pub income_detected: bool,
    pub income_received_cents: i64,
    pub income_upcoming_cents: i64,
    /// When the next expected income is due (before today when it is late).
    #[schema(value_type = Option<String>, format = Date)]
    pub next_income_date: Option<Date>,
    pub spent_so_far_cents: i64,
    /// Recurring payments still to come this period.
    pub fixed_costs_due_cents: i64,
    pub grocery_spent_cents: i64,
    /// Discretionary spending that is not groceries.
    pub other_spent_cents: i64,
    /// Average groceries per day so far.
    pub grocery_daily_cents: i64,
    /// Average other discretionary spending per day so far.
    pub other_daily_cents: i64,
    /// What the current pace adds until the period ends.
    pub projected_extra_spend_cents: i64,
    /// Income minus spending so far, fixed costs due and the projected extra spending;
    /// negative when the period is heading for a shortfall.
    pub projected_leftover_cents: i64,
    /// The groceries envelope limit, if there is one.
    pub grocery_limit_cents: Option<i64>,
    /// The day the grocery budget runs out (before the period ends), if it does at this pace.
    /// When it is already used up this is the day it was crossed.
    #[schema(value_type = Option<String>, format = Date)]
    pub grocery_run_out: Option<Date>,
    /// The grocery limit is already used up.
    pub grocery_exhausted: bool,
    pub level: WarningLevelDto,
    pub reason: WarningReasonDto,
}

impl ForecastDto {
    fn new(payday: u8, f: Forecast) -> Self {
        Self {
            payday,
            period_start: f.period.start,
            period_end: f.period.end,
            today: f.today,
            days_through: f.days_through,
            days_after_today: f.days_after_today,
            early: f.early,
            income_detected: f.income_detected,
            income_received_cents: f.income_received.cents(),
            income_upcoming_cents: f.income_upcoming.cents(),
            next_income_date: f.next_income_date,
            spent_so_far_cents: f.spent_so_far.cents(),
            fixed_costs_due_cents: f.fixed_costs_due.cents(),
            grocery_spent_cents: f.grocery_spent.cents(),
            other_spent_cents: f.other_spent.cents(),
            grocery_daily_cents: f.grocery_daily.cents(),
            other_daily_cents: f.other_daily.cents(),
            projected_extra_spend_cents: f.projected_extra_spend.cents(),
            projected_leftover_cents: f.projected_leftover.cents(),
            grocery_limit_cents: f.grocery_limit.map(|m| m.cents()),
            grocery_run_out: f.grocery_run_out,
            grocery_exhausted: f.grocery_exhausted,
            level: f.level.into(),
            reason: f.reason.into(),
        }
    }
}

/// Project the current budget period to its end from the recurring payments still due, the
/// average spending so far and the income expected.
#[utoipa::path(
    get,
    path = "/v1/forecast",
    params(ForecastQuery),
    responses(
        (status = 200, body = ForecastDto),
        (status = 400, description = "Invalid date", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn forecast(
    State(state): State<AppState>,
    Query(q): Query<ForecastQuery>,
) -> Result<Json<ForecastDto>, ApiError> {
    let payday = BudgetPeriods::payday(&state).await?;
    let today = q.date.unwrap_or_else(|| OffsetDateTime::now_utc().date());
    let txs: Vec<Transaction> = state
        .store
        .list_transactions()
        .await?
        .into_iter()
        .map(|s| s.transaction)
        .collect();
    let recurring = RecurringDetector::detect(&txs);
    let budget = state.store.load_budget().await?;
    let f = Forecast::calculate(&ForecastInput {
        period: BudgetPeriod::containing(today, payday),
        today,
        transactions: &txs,
        recurring: &recurring,
        budget: &budget,
    });
    Ok(Json(ForecastDto::new(payday, f)))
}
