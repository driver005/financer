use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use financer_core::{Budget, Disposable, RecurringDetector};

use crate::budget_period::BudgetPeriods;
use crate::dto::*;
use crate::AppState;

/// Anything a handler can fail with; mapped to a JSON `{"error": ...}` body.
pub enum ApiError {
    BadRequest(String),
    NotFound,
    /// The request is fine but cannot be completed yet (e.g. TAN not approved).
    Conflict(String),
    /// Too many attempts; try again later.
    TooManyRequests(String),
    /// A feature that is not set up (no price sources, no LLM key).
    Unavailable(String),
    /// An upstream service failed.
    BadGateway(String),
    Internal,
}

impl ApiError {
    /// The text of the error, for logs.
    pub(crate) fn message(&self) -> String {
        match self {
            ApiError::BadRequest(m)
            | ApiError::Conflict(m)
            | ApiError::TooManyRequests(m)
            | ApiError::Unavailable(m)
            | ApiError::BadGateway(m) => m.clone(),
            ApiError::NotFound => "not found".to_string(),
            ApiError::Internal => "internal error".to_string(),
        }
    }
}

impl From<financer_store::StoreError> for ApiError {
    fn from(e: financer_store::StoreError) -> Self {
        tracing::error!("store error: {e}");
        ApiError::Internal
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not found".to_string()),
            ApiError::Conflict(m) => (StatusCode::CONFLICT, m),
            ApiError::TooManyRequests(m) => (StatusCode::TOO_MANY_REQUESTS, m),
            ApiError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m),
            ApiError::BadGateway(m) => (StatusCode::BAD_GATEWAY, m),
            ApiError::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            ),
        };
        (status, Json(ErrorBody { error: msg })).into_response()
    }
}

/// Handlers' real logic; the free functions below are thin shims because `#[utoipa::path]`
/// cannot annotate methods.
pub struct Routes;

#[utoipa::path(get, path = "/health", responses((status = 200, description = "Server is up", body = String)))]
pub async fn health() -> &'static str {
    Routes::health().await
}

/// All transactions, newest first.
#[utoipa::path(
    get,
    path = "/v1/transactions",
    responses((status = 200, body = Vec<TransactionDto>)),
    security(("bearer" = []))
)]
pub async fn list_transactions(
    State(state): State<AppState>,
) -> Result<Json<Vec<TransactionDto>>, ApiError> {
    Routes::list_transactions(state).await
}

/// Payments that repeat on a steady rhythm and amount (rent, salary, subscriptions).
#[utoipa::path(
    get,
    path = "/v1/recurring",
    responses((status = 200, body = Vec<RecurringDto>)),
    security(("bearer" = []))
)]
pub async fn recurring(State(state): State<AppState>) -> Result<Json<Vec<RecurringDto>>, ApiError> {
    Routes::recurring(state).await
}

/// Replace all monthly envelopes. A category may appear once; limits must not be negative.
#[utoipa::path(
    put,
    path = "/v1/budget/envelopes",
    request_body = Vec<EnvelopeInput>,
    responses(
        (status = 200, body = Vec<EnvelopeStatusDto>),
        (status = 400, description = "Duplicate category or negative limit", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn put_envelopes(
    State(state): State<AppState>,
    Json(envelopes): Json<Vec<EnvelopeInput>>,
) -> Result<Json<Vec<EnvelopeStatusDto>>, ApiError> {
    Routes::put_envelopes(state, envelopes).await
}

impl Routes {
    pub async fn health() -> &'static str {
        "ok"
    }

    pub async fn list_transactions(state: AppState) -> Result<Json<Vec<TransactionDto>>, ApiError> {
        let rows = state.store.list_transactions().await?;
        Ok(Json(rows.into_iter().map(TransactionDto::from).collect()))
    }

    pub async fn recurring(state: AppState) -> Result<Json<Vec<RecurringDto>>, ApiError> {
        let txs: Vec<_> = state
            .store
            .list_transactions()
            .await?
            .into_iter()
            .map(|s| s.transaction)
            .collect();
        Ok(Json(
            RecurringDetector::detect(&txs)
                .into_iter()
                .map(RecurringDto::from)
                .collect(),
        ))
    }

    pub(crate) async fn disposable(state: &AppState) -> Result<DisposableDto, ApiError> {
        let txs: Vec<_> = state
            .store
            .list_transactions()
            .await?
            .into_iter()
            .map(|s| s.transaction)
            .collect();
        let d = Disposable::from_recurring(&RecurringDetector::detect(&txs));
        Ok(DisposableDto {
            monthly_income_cents: d.monthly_income,
            monthly_fixed_costs_cents: d.monthly_fixed_costs,
            disposable_cents: d.disposable,
        })
    }

    pub async fn put_envelopes(
        state: AppState,
        envelopes: Vec<EnvelopeInput>,
    ) -> Result<Json<Vec<EnvelopeStatusDto>>, ApiError> {
        let mut budget = Budget::default();
        for e in &envelopes {
            if e.limit_cents.is_negative() {
                return Err(ApiError::BadRequest(
                    "limit_cents must not be negative".into(),
                ));
            }
            if budget.envelopes.insert(e.category, e.limit_cents).is_some() {
                return Err(ApiError::BadRequest(format!(
                    "category {:?} appears twice",
                    e.category
                )));
            }
        }
        state.store.save_budget(&budget).await?;
        let period = BudgetPeriods::resolve(&state, None, None, None, None).await?;
        Ok(Json(Self::envelope_status(&state, period).await?))
    }

    /// Spent and remaining per envelope for a budget period; split transactions count by their
    /// parts.
    pub(crate) async fn envelope_status(
        state: &AppState,
        period: financer_core::BudgetPeriod,
    ) -> Result<Vec<EnvelopeStatusDto>, ApiError> {
        let txs = state.store.list_effective_transactions().await?;
        let budget = state.store.load_budget().await?;
        Ok(budget
            .status(&txs, period)
            .into_iter()
            .map(EnvelopeStatusDto::from)
            .collect())
    }
}
