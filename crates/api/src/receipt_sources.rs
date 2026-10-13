//! Automatic receipt sources: which exist, how each is doing, sync now, and the Lidl Plus
//! sign-in (done on Lidl's own page; the server only ever sees the address it redirects to).

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use financer_receipt_sources::lidl::{Connection, LidlError};
use financer_receipt_sources::{SourceHealth, SourceKind, SourceStatus, SyncNowError, SyncReport};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

/// One receipt source and how it is doing. Contains no secrets.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptSourceDto {
    /// `email`, `lidl_plus` or `folder`.
    pub source: String,
    /// Has a setting in the server configuration (Lidl Plus always counts).
    pub configured: bool,
    pub enabled: bool,
    /// `disabled`, `waiting`, `running`, `ok`, `error`, `not_connected` or `needs_signin`.
    pub state: String,
    /// Unix seconds.
    pub last_run: Option<i64>,
    pub last_success: Option<i64>,
    pub next_run: Option<i64>,
    pub last_error: Option<String>,
    /// Receipts the last run stored.
    pub last_imported: u32,
    /// Receipts from this source in the database.
    pub imported_total: u64,
    /// Remarks from the last run, e.g. why a mail or file was skipped.
    pub notes: Vec<String>,
    /// Where it reads from (mail server and folder, folder path, account region); never a login.
    pub detail: Option<String>,
}

fn health_name(h: SourceHealth) -> &'static str {
    match h {
        SourceHealth::Disabled => "disabled",
        SourceHealth::Waiting => "waiting",
        SourceHealth::Running => "running",
        SourceHealth::Ok => "ok",
        SourceHealth::Error => "error",
        SourceHealth::NotConnected => "not_connected",
        SourceHealth::NeedsSignin => "needs_signin",
    }
}

impl From<SourceStatus> for ReceiptSourceDto {
    fn from(s: SourceStatus) -> Self {
        ReceiptSourceDto {
            source: s.kind.key().to_string(),
            configured: s.configured,
            enabled: s.enabled,
            state: health_name(s.health).to_string(),
            last_run: s.last_run,
            last_success: s.last_success,
            next_run: s.next_run,
            last_error: s.last_error,
            last_imported: s.last_imported,
            imported_total: s.imported_total,
            notes: s.notes,
            detail: s.detail,
        }
    }
}

impl ReceiptSourceDto {
    fn disabled(kind: SourceKind) -> Self {
        ReceiptSourceDto {
            source: kind.key().to_string(),
            configured: false,
            enabled: false,
            state: "disabled".into(),
            last_run: None,
            last_success: None,
            next_run: None,
            last_error: None,
            last_imported: 0,
            imported_total: 0,
            notes: Vec::new(),
            detail: None,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptSyncDto {
    pub sources: Vec<ReceiptSourceDto>,
    /// New receipts stored by this run.
    pub imported: u32,
    /// Receipts newly linked to a bank transaction by this run.
    pub linked: u32,
}

impl From<SyncReport> for ReceiptSyncDto {
    fn from(r: SyncReport) -> Self {
        ReceiptSyncDto {
            sources: r.sources.into_iter().map(Into::into).collect(),
            imported: r.imported,
            linked: r.linked as u32,
        }
    }
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ReceiptSyncRequest {
    /// Only this source (`email`, `lidl_plus`, `folder`); all enabled ones when absent.
    pub source: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LidlStartDto {
    /// Open this address in a browser: it is Lidl's own sign-in page.
    pub authorization_url: String,
    /// Send this back with the final address to `POST /v1/receipts/lidl/finish`.
    pub state: String,
    /// The address scheme Lidl's page redirects to after sign-in (`com.lidlplus.app`); an app can
    /// watch for it, a person can copy the address from the browser.
    pub callback_scheme: String,
    pub redirect_uri: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LidlFinishRequest {
    pub state: String,
    /// The address the sign-in ended on, `com.lidlplus.app://callback?code=...`.
    pub callback_url: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LidlStatusDto {
    /// Lidl Plus is switched on in the server configuration.
    pub enabled: bool,
    /// `disabled`, `never`, `connected` or `needs_signin`.
    pub state: String,
    /// Unix seconds of the sign-in.
    pub connected_at: Option<i64>,
    /// Unix seconds of the last receipt sync.
    pub last_sync: Option<i64>,
    pub last_error: Option<String>,
    /// Receipts imported from Lidl Plus.
    pub receipts: u64,
}

fn lidl_error(e: LidlError) -> ApiError {
    match e {
        LidlError::BadCallback(_) | LidlError::SignInRefused(_) | LidlError::UnknownSignIn => {
            ApiError::BadRequest(e.to_string())
        }
        LidlError::Network(_) | LidlError::Status(_) | LidlError::BadResponse(_) => {
            ApiError::BadGateway(e.to_string())
        }
        LidlError::NeedsSignIn | LidlError::NotConnected => ApiError::Conflict(e.to_string()),
        LidlError::Config(_) | LidlError::Internal(_) => {
            tracing::error!("lidl plus: {e}");
            ApiError::Internal
        }
    }
}

fn sync_error(e: financer_receipt_sources::error::SyncError) -> ApiError {
    tracing::error!("receipt sources: {e}");
    ApiError::Internal
}

pub struct ReceiptSourceRoutes;

impl ReceiptSourceRoutes {
    fn lidl<'a>(
        state: &'a AppState,
    ) -> Result<
        (
            &'a financer_receipt_sources::ReceiptSyncer,
            &'a financer_receipt_sources::lidl::LidlPlus,
        ),
        ApiError,
    > {
        state
            .receipt_syncer
            .as_deref()
            .and_then(|s| s.lidl().map(|l| (s, l)))
            .ok_or_else(|| {
                ApiError::Conflict(
                    "Lidl Plus is not switched on; set receipts.lidl_plus.enabled in the server configuration"
                        .into(),
                )
            })
    }

    pub async fn sources(
        State(state): State<AppState>,
    ) -> Result<Json<Vec<ReceiptSourceDto>>, ApiError> {
        let list = match &state.receipt_syncer {
            Some(s) => s
                .statuses()
                .await
                .map_err(sync_error)?
                .into_iter()
                .map(Into::into)
                .collect(),
            None => SourceKind::ALL
                .into_iter()
                .map(ReceiptSourceDto::disabled)
                .collect(),
        };
        Ok(Json(list))
    }

    pub async fn sync(
        State(state): State<AppState>,
        body: Option<Json<ReceiptSyncRequest>>,
    ) -> Result<Json<ReceiptSyncDto>, ApiError> {
        let only = match body.and_then(|b| b.0.source) {
            None => None,
            Some(name) => Some(SourceKind::from_key(&name).ok_or_else(|| {
                ApiError::BadRequest("source must be email, lidl_plus or folder".into())
            })?),
        };
        let Some(syncer) = &state.receipt_syncer else {
            return Ok(Json(ReceiptSyncDto {
                sources: SourceKind::ALL
                    .into_iter()
                    .map(ReceiptSourceDto::disabled)
                    .collect(),
                imported: 0,
                linked: 0,
            }));
        };
        match syncer.sync_now(only).await {
            Ok(report) => Ok(Json(report.into())),
            Err(SyncNowError::Busy) => Err(ApiError::Conflict(
                "a receipt sync is already running; try again in a moment".into(),
            )),
            Err(SyncNowError::Failed(e)) => Err(sync_error(e)),
        }
    }

    pub async fn lidl_start(State(state): State<AppState>) -> Result<Json<LidlStartDto>, ApiError> {
        let (_, lidl) = Self::lidl(&state)?;
        let s = lidl.start().await.map_err(lidl_error)?;
        Ok(Json(LidlStartDto {
            authorization_url: s.authorization_url,
            state: s.state,
            callback_scheme: s.callback_scheme,
            redirect_uri: s.redirect_uri,
            expires_in_seconds: s.expires_in_secs,
        }))
    }

    async fn lidl_status_dto(state: &AppState) -> Result<LidlStatusDto, ApiError> {
        let Some(syncer) = state
            .receipt_syncer
            .as_deref()
            .filter(|s| s.lidl().is_some())
        else {
            return Ok(LidlStatusDto {
                enabled: false,
                state: "disabled".into(),
                connected_at: None,
                last_sync: None,
                last_error: None,
                receipts: state
                    .store
                    .count_receipts_from(SourceKind::LidlPlus.key())
                    .await?,
            });
        };
        let lidl = syncer.lidl().ok_or(ApiError::Internal)?;
        let status = syncer
            .statuses()
            .await
            .map_err(sync_error)?
            .into_iter()
            .find(|s| s.kind == SourceKind::LidlPlus)
            .ok_or(ApiError::Internal)?;
        let connection = lidl.connection().await.map_err(sync_error)?;
        Ok(LidlStatusDto {
            enabled: true,
            state: match connection {
                Connection::Never => "never",
                Connection::Connected => "connected",
                Connection::NeedsSignin => "needs_signin",
            }
            .into(),
            connected_at: lidl.connected_at().await.map_err(sync_error)?,
            last_sync: status.last_run,
            last_error: status.last_error,
            receipts: status.imported_total,
        })
    }

    pub async fn lidl_status(
        State(state): State<AppState>,
    ) -> Result<Json<LidlStatusDto>, ApiError> {
        Self::lidl_status_dto(&state).await.map(Json)
    }

    pub async fn lidl_finish(
        State(state): State<AppState>,
        Json(req): Json<LidlFinishRequest>,
    ) -> Result<Json<LidlStatusDto>, ApiError> {
        let (syncer, lidl) = Self::lidl(&state)?;
        lidl.finish(&req.state, &req.callback_url)
            .await
            .map_err(lidl_error)?;
        // first sync right away, in the background of this request's result: failures are shown
        // in the status, they do not undo the sign-in
        if let Err(e) = syncer.sync_now(Some(SourceKind::LidlPlus)).await {
            tracing::warn!("first Lidl Plus sync: {e}");
        }
        Self::lidl_status_dto(&state).await.map(Json)
    }

    pub async fn lidl_disconnect(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
        let (_, lidl) = Self::lidl(&state)?;
        lidl.disconnect().await.map_err(sync_error)?;
        Ok(StatusCode::NO_CONTENT)
    }
}

/// The receipt sources: the mailbox, the Lidl Plus account and the watched folder, with state,
/// last run, receipts imported and the last error. Never contains a password or token.
#[utoipa::path(get, path = "/v1/receipts/sources", responses(
    (status = 200, body = Vec<ReceiptSourceDto>)), security(("bearer" = [])))]
pub async fn list_sources(state: State<AppState>) -> Result<Json<Vec<ReceiptSourceDto>>, ApiError> {
    ReceiptSourceRoutes::sources(state).await
}

/// Run the enabled receipt sources now (or just one). New receipts are linked to bank
/// transactions where that is unambiguous. `409` while another sync is running.
#[utoipa::path(post, path = "/v1/receipts/sync", request_body(content = Option<ReceiptSyncRequest>), responses(
    (status = 200, body = ReceiptSyncDto),
    (status = 400, description = "Unknown source", body = ErrorBody),
    (status = 409, description = "A sync is already running", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn sync_now(
    state: State<AppState>,
    body: Option<Json<ReceiptSyncRequest>>,
) -> Result<Json<ReceiptSyncDto>, ApiError> {
    ReceiptSourceRoutes::sync(state, body).await
}

/// Start a Lidl Plus sign-in. Returns the address of Lidl's own sign-in page; nothing is sent to
/// Lidl by this call. Experimental and unofficial: see docs/RECEIPT_SOURCES.md.
#[utoipa::path(post, path = "/v1/receipts/lidl/start", responses(
    (status = 200, body = LidlStartDto),
    (status = 409, description = "Lidl Plus is not switched on", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn lidl_start(state: State<AppState>) -> Result<Json<LidlStartDto>, ApiError> {
    ReceiptSourceRoutes::lidl_start(state).await
}

/// Finish the sign-in with the address Lidl's page ended on. Only the refresh token is stored,
/// encrypted. The first receipts are fetched right away.
#[utoipa::path(post, path = "/v1/receipts/lidl/finish", request_body = LidlFinishRequest, responses(
    (status = 200, body = LidlStatusDto),
    (status = 400, description = "Unknown or expired sign-in, or an address that is not the callback", body = ErrorBody),
    (status = 502, description = "Lidl did not accept the code or could not be reached", body = ErrorBody),
    (status = 409, description = "Lidl Plus is not switched on", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn lidl_finish(
    state: State<AppState>,
    body: Json<LidlFinishRequest>,
) -> Result<Json<LidlStatusDto>, ApiError> {
    ReceiptSourceRoutes::lidl_finish(state, body).await
}

/// Whether Lidl Plus is connected, when it last synced and how many receipts came from it.
#[utoipa::path(get, path = "/v1/receipts/lidl/status", responses(
    (status = 200, body = LidlStatusDto)), security(("bearer" = [])))]
pub async fn lidl_status(state: State<AppState>) -> Result<Json<LidlStatusDto>, ApiError> {
    ReceiptSourceRoutes::lidl_status(state).await
}

/// Disconnect Lidl Plus: the stored token is deleted. Receipts already imported stay.
#[utoipa::path(delete, path = "/v1/receipts/lidl", responses(
    (status = 204, description = "Disconnected"),
    (status = 409, description = "Lidl Plus is not switched on", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn lidl_disconnect(state: State<AppState>) -> Result<StatusCode, ApiError> {
    ReceiptSourceRoutes::lidl_disconnect(state).await
}
