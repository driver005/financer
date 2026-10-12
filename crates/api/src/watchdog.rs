//! Subscription watchdog and anomaly alerts. Everything is computed from the stored transactions;
//! only the dismissal of an alert is stored.

use axum::extract::{Path, Query, State};
use axum::Json;
use financer_core::{
    Alert, AlertKind, AnomalyConfig, AnomalyDetector, Cadence, DuplicateReason,
    DuplicateSubscription, PriceHike, Severity, StaleSubscription, SubscriptionReport,
    SubscriptionWatch, Transaction, UpcomingCharge, WatchedSubscription,
};
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;

use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

const DEFAULT_CALENDAR_DAYS: i64 = 30;
const MAX_CALENDAR_DAYS: i64 = 366;
const DEFAULT_ALERT_LOOKBACK_DAYS: i64 = 60;
const MAX_ALERT_LOOKBACK_DAYS: i64 = 3650;

/// One recurring outgoing payment. All amounts in the watchdog are positive charge sizes.
#[derive(Debug, Serialize, ToSchema)]
pub struct SubscriptionDto {
    pub counterparty: String,
    #[schema(value_type = i64, example = 1299)]
    pub amount_cents: i64,
    /// What it costs per month on average (weekly x 52/12, quarterly / 3, yearly / 12).
    #[schema(example = 1299)]
    pub monthly_cents: i64,
    #[schema(value_type = String, example = "monthly")]
    pub cadence: Cadence,
    #[schema(value_type = String, format = Date)]
    pub first_date: Date,
    #[schema(value_type = String, format = Date)]
    pub last_date: Date,
    #[schema(value_type = String, format = Date)]
    pub next_expected: Date,
    pub occurrences: usize,
    /// 10 to 99.
    pub confidence: u8,
}

impl From<WatchedSubscription> for SubscriptionDto {
    fn from(s: WatchedSubscription) -> Self {
        let cents = s.amount.cents();
        SubscriptionDto {
            counterparty: s.counterparty,
            amount_cents: cents,
            monthly_cents: match s.cadence {
                Cadence::Weekly => cents * 52 / 12,
                Cadence::Monthly => cents,
                Cadence::Quarterly => cents / 3,
                Cadence::Yearly => cents / 12,
            },
            cadence: s.cadence,
            first_date: s.first_date,
            last_date: s.last_date,
            next_expected: s.next_expected,
            occurrences: s.occurrences,
            confidence: s.confidence,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpcomingChargeDto {
    #[schema(value_type = String, format = Date)]
    pub date: Date,
    pub counterparty: String,
    pub amount_cents: i64,
    #[schema(value_type = String, example = "monthly")]
    pub cadence: Cadence,
    /// 10 to 99; lower for charges further out and for overdue ones.
    pub confidence: u8,
    /// The expected date has passed and the charge has not been booked yet.
    pub overdue: bool,
}

impl From<UpcomingCharge> for UpcomingChargeDto {
    fn from(u: UpcomingCharge) -> Self {
        UpcomingChargeDto {
            date: u.date,
            counterparty: u.counterparty,
            amount_cents: u.amount.cents(),
            cadence: u.cadence,
            confidence: u.confidence,
            overdue: u.overdue,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PriceHikeDto {
    pub counterparty: String,
    #[schema(value_type = String, example = "monthly")]
    pub cadence: Cadence,
    pub old_amount_cents: i64,
    pub new_amount_cents: i64,
    pub delta_cents: i64,
    /// Increase in basis points of the old amount: 2002 is +20.02%.
    pub percent_bp: i64,
    /// First booking at the new price.
    #[schema(value_type = String, format = Date)]
    pub since: Date,
}

impl From<PriceHike> for PriceHikeDto {
    fn from(h: PriceHike) -> Self {
        PriceHikeDto {
            counterparty: h.counterparty,
            cadence: h.cadence,
            old_amount_cents: h.old_amount.cents(),
            new_amount_cents: h.new_amount.cents(),
            delta_cents: h.delta.cents(),
            percent_bp: h.percent_bp,
            since: h.since,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DuplicateSubscriptionDto {
    /// `same_merchant` or `similar_merchant`.
    #[schema(value_type = String, example = "similar_merchant")]
    pub reason: DuplicateReason,
    pub first: SubscriptionDto,
    pub second: SubscriptionDto,
}

impl From<DuplicateSubscription> for DuplicateSubscriptionDto {
    fn from(d: DuplicateSubscription) -> Self {
        DuplicateSubscriptionDto {
            reason: d.reason,
            first: d.first.into(),
            second: d.second.into(),
        }
    }
}

/// A subscription whose last charge is older than two periods: cancelled, paused or moved.
#[derive(Debug, Serialize, ToSchema)]
pub struct StaleSubscriptionDto {
    pub subscription: SubscriptionDto,
    pub days_since_last: i64,
    /// How many expected charges did not arrive (at least 2).
    pub periods_missed: u32,
}

impl From<StaleSubscription> for StaleSubscriptionDto {
    fn from(s: StaleSubscription) -> Self {
        StaleSubscriptionDto {
            subscription: s.subscription.into(),
            days_since_last: s.days_since_last,
            periods_missed: s.periods_missed,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SubscriptionsDto {
    #[schema(value_type = String, format = Date)]
    pub as_of: Date,
    /// How many days ahead `upcoming` looks.
    pub days: i64,
    /// Subscriptions that are still running.
    pub active: Vec<SubscriptionDto>,
    /// Sum of `monthly_cents` of the active subscriptions.
    pub monthly_total_cents: i64,
    /// Expected charges from today to `days` ahead, in date order (an overdue one comes first).
    pub upcoming: Vec<UpcomingChargeDto>,
    pub price_hikes: Vec<PriceHikeDto>,
    pub duplicates: Vec<DuplicateSubscriptionDto>,
    /// Possibly cancelled or unused, reported apart from the active ones.
    pub stale: Vec<StaleSubscriptionDto>,
}

impl SubscriptionsDto {
    fn new(report: SubscriptionReport, days: i64) -> Self {
        let active: Vec<SubscriptionDto> = report.active.into_iter().map(Into::into).collect();
        SubscriptionsDto {
            as_of: report.as_of,
            days,
            monthly_total_cents: active.iter().map(|s| s.monthly_cents).sum(),
            active,
            upcoming: report.upcoming.into_iter().map(Into::into).collect(),
            price_hikes: report.price_hikes.into_iter().map(Into::into).collect(),
            duplicates: report.duplicates.into_iter().map(Into::into).collect(),
            stale: report.stale.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AlertDto {
    /// Stable id; pass it to `POST /v1/alerts/{id}/dismiss`.
    pub id: String,
    /// `duplicate_charge`, `unusual_amount`, `new_merchant` or `large_for_category`. The app labels
    /// these in the user's language; `reason` is the English explanation with the numbers.
    #[schema(value_type = String, example = "duplicate_charge")]
    pub kind: AlertKind,
    /// `low`, `medium` or `high`.
    #[schema(value_type = String, example = "high")]
    pub severity: Severity,
    pub reason: String,
    /// Id of the transaction in `GET /v1/transactions`.
    pub transaction_id: i64,
    #[schema(value_type = String, format = Date)]
    pub booking_date: Date,
    pub counterparty: String,
    /// What was charged (positive).
    pub amount_cents: i64,
    /// What it is compared with (earlier charge, median, threshold), positive.
    pub reference_cents: Option<i64>,
    /// How many earlier charges the comparison is based on.
    pub history_count: usize,
    pub dismissed: bool,
}

impl AlertDto {
    fn new(a: Alert, dismissed: bool) -> Self {
        AlertDto {
            id: a.id,
            kind: a.kind,
            severity: a.severity,
            reason: a.reason,
            transaction_id: a.transaction_id,
            booking_date: a.booking_date,
            counterparty: a.counterparty,
            amount_cents: a.amount.cents(),
            reference_cents: a.reference_amount.map(|m| m.cents()),
            history_count: a.history_count,
            dismissed,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AlertsDto {
    /// Alerts that are not dismissed (also when `include_dismissed` is set).
    pub unread_count: usize,
    /// Newest first.
    pub alerts: Vec<AlertDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AlertDismissedDto {
    pub id: String,
    pub dismissed: bool,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SubscriptionsQuery {
    /// How many days ahead the calendar looks (default 30, 1 to 366).
    days: Option<i64>,
    /// Treat this date as today (`2026-03-02`). Default: today. Mainly for testing.
    #[param(value_type = Option<String>, example = "2026-03-02")]
    as_of: Option<Date>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct AlertsQuery {
    /// Also list dismissed alerts (default false).
    include_dismissed: Option<bool>,
    /// Only payments booked within this many days (default 60, 1 to 3650).
    lookback_days: Option<i64>,
    /// Treat this date as today (`2026-03-02`). Default: today. Mainly for testing.
    #[param(value_type = Option<String>, example = "2026-03-02")]
    as_of: Option<Date>,
}

/// Handlers' real logic; the free functions below are thin shims because `#[utoipa::path]`
/// cannot annotate methods.
pub struct Watchdog;

/// Recurring payments seen as a watchdog: what is due in the next days, price hikes, possible
/// duplicates, and subscriptions that seem to have stopped.
#[utoipa::path(
    get,
    path = "/v1/subscriptions",
    params(SubscriptionsQuery),
    responses((status = 200, body = SubscriptionsDto)),
    security(("bearer" = []))
)]
pub async fn subscriptions(
    State(state): State<AppState>,
    Query(q): Query<SubscriptionsQuery>,
) -> Result<Json<SubscriptionsDto>, ApiError> {
    Watchdog::subscriptions(state, q).await
}

/// Possible problems in recent payments: duplicate charges, amounts far above the usual, big
/// first-time merchants and charges that are large for their category. Dismissed alerts are left
/// out unless `include_dismissed=true`.
#[utoipa::path(
    get,
    path = "/v1/alerts",
    params(AlertsQuery),
    responses((status = 200, body = AlertsDto)),
    security(("bearer" = []))
)]
pub async fn alerts(
    State(state): State<AppState>,
    Query(q): Query<AlertsQuery>,
) -> Result<Json<AlertsDto>, ApiError> {
    Watchdog::alerts(state, q).await
}

/// Dismiss an alert so it no longer counts as unread. Dismissing twice is fine.
#[utoipa::path(
    post,
    path = "/v1/alerts/{id}/dismiss",
    params(("id" = String, Path, description = "alert id from GET /v1/alerts")),
    responses(
        (status = 200, body = AlertDismissedDto),
        (status = 404, description = "No such alert", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn dismiss_alert(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AlertDismissedDto>, ApiError> {
    Watchdog::dismiss_alert(state, id).await
}

impl Watchdog {
    fn today() -> Date {
        OffsetDateTime::now_utc().date()
    }

    async fn transactions(state: &AppState) -> Result<Vec<(i64, Transaction)>, ApiError> {
        Ok(state
            .store
            .list_transactions()
            .await?
            .into_iter()
            .map(|s| (s.id, s.transaction))
            .collect())
    }

    fn detect_alerts(txs: &[(i64, Transaction)], as_of: Date, lookback_days: i64) -> Vec<Alert> {
        let config = AnomalyConfig {
            lookback_days,
            ..AnomalyConfig::default()
        };
        AnomalyDetector::detect(txs, as_of, &config)
    }

    pub async fn subscriptions(
        state: AppState,
        q: SubscriptionsQuery,
    ) -> Result<Json<SubscriptionsDto>, ApiError> {
        let days = q
            .days
            .unwrap_or(DEFAULT_CALENDAR_DAYS)
            .clamp(1, MAX_CALENDAR_DAYS);
        let txs: Vec<Transaction> = Self::transactions(&state)
            .await?
            .into_iter()
            .map(|(_, t)| t)
            .collect();
        let report = SubscriptionWatch::analyze(&txs, q.as_of.unwrap_or_else(Self::today), days);
        Ok(Json(SubscriptionsDto::new(report, days)))
    }

    pub async fn alerts(state: AppState, q: AlertsQuery) -> Result<Json<AlertsDto>, ApiError> {
        let lookback = q
            .lookback_days
            .unwrap_or(DEFAULT_ALERT_LOOKBACK_DAYS)
            .clamp(1, MAX_ALERT_LOOKBACK_DAYS);
        let txs = Self::transactions(&state).await?;
        let alerts = Self::detect_alerts(&txs, q.as_of.unwrap_or_else(Self::today), lookback);
        let dismissed = state.store.dismissed_alert_ids().await?;
        let include_dismissed = q.include_dismissed.unwrap_or(false);
        let all: Vec<AlertDto> = alerts
            .into_iter()
            .map(|a| {
                let is_dismissed = dismissed.contains(&a.id);
                AlertDto::new(a, is_dismissed)
            })
            .collect();
        let unread_count = all.iter().filter(|a| !a.dismissed).count();
        Ok(Json(AlertsDto {
            unread_count,
            alerts: all
                .into_iter()
                .filter(|a| include_dismissed || !a.dismissed)
                .collect(),
        }))
    }

    pub async fn dismiss_alert(
        state: AppState,
        id: String,
    ) -> Result<Json<AlertDismissedDto>, ApiError> {
        // Only ids that are alerts right now are stored, so the table cannot be filled with junk.
        // The clock is not needed for that: no alert is newer than the newest transaction.
        let txs = Self::transactions(&state).await?;
        let newest = txs.iter().map(|(_, t)| t.booking_date).max();
        let known = Self::detect_alerts(&txs, newest.unwrap_or_else(Self::today), 36_500)
            .iter()
            .any(|a| a.id == id);
        if !known {
            return Err(ApiError::NotFound);
        }
        state
            .store
            .dismiss_alert(&id, OffsetDateTime::now_utc().unix_timestamp())
            .await?;
        Ok(Json(AlertDismissedDto {
            id,
            dismissed: true,
        }))
    }
}
