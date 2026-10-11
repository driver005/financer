use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use financer_core::{detect_recurring, disposable_income, Budget, Categorizer, YearMonth};
use financer_fints::parse_sparkasse_csv;
use serde::Deserialize;
use time::Month;

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

#[utoipa::path(get, path = "/health", responses((status = 200, description = "Server is up", body = String)))]
pub async fn health() -> &'static str {
    "ok"
}

/// Import a Sparkasse CSV-CAMT export. Transactions are categorized, and rows that were
/// imported before are skipped, so re-uploading an overlapping period is safe.
#[utoipa::path(
    post,
    path = "/v1/transactions/import",
    request_body(content = String, content_type = "text/csv"),
    responses(
        (status = 200, description = "Import finished", body = ImportReport),
        (status = 400, description = "Not a Sparkasse CSV export", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn import_transactions(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<ImportReport>, ApiError> {
    let parsed = parse_sparkasse_csv(&body).map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let categorizer = Categorizer::new();
    let mut txs = parsed.transactions;
    for tx in &mut txs {
        tx.category = Some(categorizer.categorize(tx));
    }

    let imported = state.store.insert_new_transactions(&txs).await?;
    Ok(Json(ImportReport {
        imported,
        duplicates: txs.len() - imported,
        skipped: parsed
            .skipped
            .into_iter()
            .map(|s| SkippedRowDto {
                line: s.line,
                reason: s.reason,
            })
            .collect(),
    }))
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
    let rows = state.store.list_transactions().await?;
    Ok(Json(rows.into_iter().map(TransactionDto::from).collect()))
}

/// Payments that repeat on a steady rhythm and amount (rent, salary, subscriptions).
#[utoipa::path(
    get,
    path = "/v1/recurring",
    responses((status = 200, body = Vec<RecurringDto>)),
    security(("bearer" = []))
)]
pub async fn recurring(State(state): State<AppState>) -> Result<Json<Vec<RecurringDto>>, ApiError> {
    let txs: Vec<_> = state
        .store
        .list_transactions()
        .await?
        .into_iter()
        .map(|s| s.transaction)
        .collect();
    Ok(Json(
        detect_recurring(&txs)
            .into_iter()
            .map(RecurringDto::from)
            .collect(),
    ))
}

/// Monthly income minus fixed costs, from detected recurring payments.
#[utoipa::path(
    get,
    path = "/v1/budget/disposable",
    responses((status = 200, body = DisposableDto)),
    security(("bearer" = []))
)]
pub async fn disposable(State(state): State<AppState>) -> Result<Json<DisposableDto>, ApiError> {
    let txs: Vec<_> = state
        .store
        .list_transactions()
        .await?
        .into_iter()
        .map(|s| s.transaction)
        .collect();
    let d = disposable_income(&detect_recurring(&txs));
    Ok(Json(DisposableDto {
        monthly_income_cents: d.monthly_income,
        monthly_fixed_costs_cents: d.monthly_fixed_costs,
        disposable_cents: d.disposable,
    }))
}

#[utoipa::path(
    get,
    path = "/v1/budget/envelopes",
    responses((status = 200, body = Vec<EnvelopeDto>)),
    security(("bearer" = []))
)]
pub async fn get_envelopes(
    State(state): State<AppState>,
) -> Result<Json<Vec<EnvelopeDto>>, ApiError> {
    let budget = state.store.load_budget().await?;
    Ok(Json(
        budget
            .envelopes
            .into_iter()
            .map(|(category, limit)| EnvelopeDto {
                category,
                limit_cents: limit,
            })
            .collect(),
    ))
}

/// Replace all monthly envelopes. A category may appear once; limits must not be negative.
#[utoipa::path(
    put,
    path = "/v1/budget/envelopes",
    request_body = Vec<EnvelopeDto>,
    responses(
        (status = 200, body = Vec<EnvelopeDto>),
        (status = 400, description = "Duplicate category or negative limit", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn put_envelopes(
    State(state): State<AppState>,
    Json(envelopes): Json<Vec<EnvelopeDto>>,
) -> Result<Json<Vec<EnvelopeDto>>, ApiError> {
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
    get_envelopes(State(state)).await
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct MonthQuery {
    year: i32,
    /// 1 to 12
    month: u8,
}

/// Spent and remaining per envelope for one month.
#[utoipa::path(
    get,
    path = "/v1/budget/status",
    params(MonthQuery),
    responses(
        (status = 200, body = Vec<EnvelopeStatusDto>),
        (status = 400, description = "Invalid month", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn budget_status(
    State(state): State<AppState>,
    Query(q): Query<MonthQuery>,
) -> Result<Json<Vec<EnvelopeStatusDto>>, ApiError> {
    let month =
        Month::try_from(q.month).map_err(|_| ApiError::BadRequest("month must be 1-12".into()))?;
    let txs: Vec<_> = state
        .store
        .list_transactions()
        .await?
        .into_iter()
        .map(|s| s.transaction)
        .collect();
    let budget = state.store.load_budget().await?;
    let status = budget.status(&txs, YearMonth::new(q.year, month));
    Ok(Json(
        status.into_iter().map(EnvelopeStatusDto::from).collect(),
    ))
}
