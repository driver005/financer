use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use financer_core::{Budget, Disposable, RecurringDetector, YearMonth};
use financer_fints::SparkasseCsv;
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

/// Handlers' real logic; the free functions below are thin shims because `#[utoipa::path]`
/// cannot annotate methods.
pub struct Routes;

#[utoipa::path(get, path = "/health", responses((status = 200, description = "Server is up", body = String)))]
pub async fn health() -> &'static str {
    Routes::health().await
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
    Routes::import_transactions(state, body).await
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

/// Monthly income minus fixed costs, from detected recurring payments.
#[utoipa::path(
    get,
    path = "/v1/budget/disposable",
    responses((status = 200, body = DisposableDto)),
    security(("bearer" = []))
)]
pub async fn disposable(State(state): State<AppState>) -> Result<Json<DisposableDto>, ApiError> {
    Routes::disposable(state).await
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
    Routes::get_envelopes(state).await
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
    Routes::put_envelopes(state, envelopes).await
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
    Routes::budget_status(state, q).await
}

impl Routes {
    pub async fn health() -> &'static str {
        "ok"
    }

    pub async fn import_transactions(
        state: AppState,
        body: Bytes,
    ) -> Result<Json<ImportReport>, ApiError> {
        let parsed = SparkasseCsv::parse(&body).map_err(|e| ApiError::BadRequest(e.to_string()))?;

        let categorizer = state.store.categorizer().await?;
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

    pub async fn disposable(state: AppState) -> Result<Json<DisposableDto>, ApiError> {
        let txs: Vec<_> = state
            .store
            .list_transactions()
            .await?
            .into_iter()
            .map(|s| s.transaction)
            .collect();
        let d = Disposable::from_recurring(&RecurringDetector::detect(&txs));
        Ok(Json(DisposableDto {
            monthly_income_cents: d.monthly_income,
            monthly_fixed_costs_cents: d.monthly_fixed_costs,
            disposable_cents: d.disposable,
        }))
    }

    pub async fn get_envelopes(state: AppState) -> Result<Json<Vec<EnvelopeDto>>, ApiError> {
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

    pub async fn put_envelopes(
        state: AppState,
        envelopes: Vec<EnvelopeDto>,
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
        Self::get_envelopes(state).await
    }

    pub async fn budget_status(
        state: AppState,
        q: MonthQuery,
    ) -> Result<Json<Vec<EnvelopeStatusDto>>, ApiError> {
        let month = Month::try_from(q.month)
            .map_err(|_| ApiError::BadRequest("month must be 1-12".into()))?;
        // split transactions count by their parts
        let txs = state.store.list_effective_transactions().await?;
        let budget = state.store.load_budget().await?;
        let status = budget.status(&txs, YearMonth::new(q.year, month));
        Ok(Json(
            status.into_iter().map(EnvelopeStatusDto::from).collect(),
        ))
    }
}
