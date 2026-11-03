//! Automatic receipt sources: which exist, how each is doing, sync now, and the Lidl Plus
//! sign-in (done on Lidl's own page; the server only ever sees the address it redirects to).

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use financer_receipt_sources::kaufland::KauflandError;
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
    /// `email`, `lidl_plus`, `kaufland_card` or `folder`.
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
    /// Only this source (`email`, `lidl_plus`, `kaufland_card`, `folder`); all enabled ones when absent.
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

fn kaufland_error(e: KauflandError) -> ApiError {
    match e {
        KauflandError::BadCallback(_)
        | KauflandError::SignInRefused(_)
        | KauflandError::UnknownSignIn => ApiError::BadRequest(e.to_string()),
        KauflandError::Network(_) | KauflandError::Status(_) | KauflandError::BadResponse(_) => {
            ApiError::BadGateway(e.to_string())
        }
        KauflandError::NeedsSignIn | KauflandError::NotConnected => {
            ApiError::Conflict(e.to_string())
        }
        KauflandError::Config(_) | KauflandError::Internal(_) => {
            tracing::error!("kaufland: {e}");
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
    fn lidl(
        state: &AppState,
    ) -> Result<
        (
            &financer_receipt_sources::ReceiptSyncer,
            &financer_receipt_sources::lidl::LidlPlus,
        ),
        ApiError,
    > {
        state
            .receipt_syncer
            .as_deref()
            .and_then(|s| s.lidl().map(|l| (s, l)))
            .ok_or_else(|| ApiError::Conflict("Lidl Plus is not switched on".into()))
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
                ApiError::BadRequest(
                    "source must be email, lidl_plus, kaufland_card or folder".into(),
                )
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

    fn kaufland(
        state: &AppState,
    ) -> Result<
        (
            &financer_receipt_sources::ReceiptSyncer,
            &financer_receipt_sources::kaufland::KauflandCard,
        ),
        ApiError,
    > {
        state
            .receipt_syncer
            .as_deref()
            .and_then(|s| s.kaufland().map(|k| (s, k)))
            .ok_or_else(|| ApiError::Conflict("Kaufland is not switched on".into()))
    }

    pub async fn kaufland_start(
        State(state): State<AppState>,
    ) -> Result<Json<LidlStartDto>, ApiError> {
        let (_, card) = Self::kaufland(&state)?;
        let s = card.start().await.map_err(kaufland_error)?;
        Ok(Json(LidlStartDto {
            authorization_url: s.authorization_url,
            state: s.state,
            callback_scheme: s.callback_scheme,
            redirect_uri: s.redirect_uri,
            expires_in_seconds: s.expires_in_secs,
        }))
    }

    async fn kaufland_status_dto(state: &AppState) -> Result<LidlStatusDto, ApiError> {
        let Some(syncer) = state
            .receipt_syncer
            .as_deref()
            .filter(|s| s.kaufland().is_some())
        else {
            return Ok(LidlStatusDto {
                enabled: false,
                state: "disabled".into(),
                connected_at: None,
                last_sync: None,
                last_error: None,
                receipts: state
                    .store
                    .count_receipts_from(SourceKind::KauflandCard.key())
                    .await?,
            });
        };
        let card = syncer.kaufland().ok_or(ApiError::Internal)?;
        let status = syncer
            .statuses()
            .await
            .map_err(sync_error)?
            .into_iter()
            .find(|s| s.kind == SourceKind::KauflandCard)
            .ok_or(ApiError::Internal)?;
        let connection = card.connection().await.map_err(sync_error)?;
        Ok(LidlStatusDto {
            enabled: true,
            state: match connection {
                Connection::Never => "never",
                Connection::Connected => "connected",
                Connection::NeedsSignin => "needs_signin",
            }
            .into(),
            connected_at: card.connected_at().await.map_err(sync_error)?,
            last_sync: status.last_run,
            last_error: status.last_error,
            receipts: status.imported_total,
        })
    }

    pub async fn kaufland_status(
        State(state): State<AppState>,
    ) -> Result<Json<LidlStatusDto>, ApiError> {
        Self::kaufland_status_dto(&state).await.map(Json)
    }

    pub async fn kaufland_finish(
        State(state): State<AppState>,
        Json(req): Json<LidlFinishRequest>,
    ) -> Result<Json<LidlStatusDto>, ApiError> {
        let (syncer, card) = Self::kaufland(&state)?;
        card.finish(&req.state, &req.callback_url)
            .await
            .map_err(kaufland_error)?;
        // first sync right away; failures are shown in the status, they do not undo the sign-in
        if let Err(e) = syncer.sync_now(Some(SourceKind::KauflandCard)).await {
            tracing::warn!("first Kaufland sync: {e}");
        }
        Self::kaufland_status_dto(&state).await.map(Json)
    }

    pub async fn kaufland_disconnect(
        State(state): State<AppState>,
    ) -> Result<StatusCode, ApiError> {
        let (_, card) = Self::kaufland(&state)?;
        card.disconnect().await.map_err(sync_error)?;
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

/// Start a Kaufland Card sign-in. Returns the address of Kaufland's own sign-in page; nothing is
/// sent to Kaufland by this call. Same shapes as the Lidl Plus sign-in. Experimental and
/// unofficial: see docs/RECEIPT_SOURCES.md.
#[utoipa::path(post, path = "/v1/receipts/kaufland/start", responses(
    (status = 200, body = LidlStartDto),
    (status = 409, description = "Kaufland is not switched on", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn kaufland_start(state: State<AppState>) -> Result<Json<LidlStartDto>, ApiError> {
    ReceiptSourceRoutes::kaufland_start(state).await
}

/// Finish the sign-in with the address Kaufland's page ended on. Only the refresh token (and the
/// customer id) is stored, the token encrypted. Starts a first sync.
#[utoipa::path(post, path = "/v1/receipts/kaufland/finish", request_body = LidlFinishRequest, responses(
    (status = 200, body = LidlStatusDto),
    (status = 400, description = "The address is wrong or the sign-in expired", body = ErrorBody),
    (status = 502, description = "Kaufland did not accept the code or could not be reached", body = ErrorBody),
    (status = 409, description = "Kaufland is not switched on", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn kaufland_finish(
    state: State<AppState>,
    body: Json<LidlFinishRequest>,
) -> Result<Json<LidlStatusDto>, ApiError> {
    ReceiptSourceRoutes::kaufland_finish(state, body).await
}

/// Whether the Kaufland Card is connected, when it last synced and how many receipts came from it.
#[utoipa::path(get, path = "/v1/receipts/kaufland/status", responses(
    (status = 200, body = LidlStatusDto)), security(("bearer" = [])))]
pub async fn kaufland_status(state: State<AppState>) -> Result<Json<LidlStatusDto>, ApiError> {
    ReceiptSourceRoutes::kaufland_status(state).await
}

/// Disconnect the Kaufland Card: the stored token is deleted. Receipts already imported stay.
#[utoipa::path(delete, path = "/v1/receipts/kaufland", responses(
    (status = 204, description = "Disconnected"),
    (status = 409, description = "Kaufland is not switched on", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn kaufland_disconnect(state: State<AppState>) -> Result<StatusCode, ApiError> {
    ReceiptSourceRoutes::kaufland_disconnect(state).await
}

// ---- REWE receipts the app fetched in its own browser window ----

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReweKnownRequest {
    /// REWE's receipt ids the app has just listed.
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReweKnownDto {
    /// The ids that are not stored yet: fetch and push only these.
    pub unknown: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReweLineInput {
    pub name: String,
    /// 1 to 99.
    pub quantity: u32,
    /// What the line cost in cents (negative for a refund).
    pub total_cents: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReweReceiptInput {
    /// REWE's id of the receipt.
    pub id: String,
    /// Local day of the purchase, `YYYY-MM-DD`.
    #[schema(example = "2026-03-02")]
    pub date: String,
    /// Local time, `HH:MM`.
    pub time: Option<String>,
    pub store: Option<String>,
    /// The printed total in cents; the sum of the lines when absent.
    pub total_cents: Option<i64>,
    pub lines: Vec<ReweLineInput>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReweImportRequest {
    /// At most 100 receipts.
    pub receipts: Vec<ReweReceiptInput>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReweImportDto {
    pub imported: u32,
    pub duplicates: u32,
    pub skipped: u32,
    /// Receipts matched to a bank payment by this import.
    pub linked: u64,
    pub notes: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReweStatusDto {
    /// Unix seconds of the last push.
    pub last_import: Option<i64>,
    /// Receipts that came this way.
    pub receipts: u64,
}

const MAX_CENTS: i64 = 100_000_000;

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError::BadRequest(msg.into())
}

fn rewe_id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.'))
}

fn rewe_receipt(
    r: &ReweReceiptInput,
) -> Result<financer_receipt_sources::rewe::ImportReceipt, ApiError> {
    use financer_core::Money;
    use financer_receipt_sources::rewe::{ImportLine, ImportReceipt, MAX_LINES};
    if !rewe_id_ok(&r.id) {
        return Err(bad("a receipt id is empty, too long or has odd characters"));
    }
    let date = time::Date::parse(
        &r.date,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .map_err(|_| bad("date must be YYYY-MM-DD"))?;
    let time = match r.time.as_deref() {
        None | Some("") => None,
        Some(t) => {
            let ok = t.len() == 5
                && t.as_bytes()[2] == b':'
                && t[..2].parse::<u8>().is_ok_and(|h| h < 24)
                && t[3..].parse::<u8>().is_ok_and(|m| m < 60);
            if !ok {
                return Err(bad("time must be HH:MM"));
            }
            Some(t.to_string())
        }
    };
    if r.lines.len() > MAX_LINES {
        return Err(bad("a receipt has too many lines"));
    }
    let cents_ok = |c: i64| c.abs() <= MAX_CENTS;
    if r.total_cents.is_some_and(|c| !cents_ok(c)) {
        return Err(bad("an amount is out of range"));
    }
    let mut lines = Vec::new();
    for l in &r.lines {
        let name = l.name.trim();
        if name.is_empty() || name.chars().count() > 200 {
            return Err(bad("a line has no name or a name over 200 characters"));
        }
        if !(1..=99).contains(&l.quantity) || !cents_ok(l.total_cents) {
            return Err(bad("a line has a quantity or an amount out of range"));
        }
        lines.push(ImportLine {
            name: name.to_string(),
            quantity: l.quantity,
            total: Money::from_cents(l.total_cents),
        });
    }
    Ok(ImportReceipt {
        id: r.id.clone(),
        date,
        time,
        store: r
            .store
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(80).collect()),
        total: r.total_cents.map(Money::from_cents),
        lines,
    })
}

/// Which of REWE's receipt ids are not stored yet. The app calls it with the list it just read, so
/// that it fetches the details of the new ones only.
#[utoipa::path(post, path = "/v1/receipts/rewe/known", request_body = ReweKnownRequest, responses(
    (status = 200, body = ReweKnownDto),
    (status = 400, description = "Too many ids or an odd id", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn rewe_known(
    State(state): State<AppState>,
    Json(req): Json<ReweKnownRequest>,
) -> Result<Json<ReweKnownDto>, ApiError> {
    if req.ids.len() > 1000 || req.ids.iter().any(|i| !rewe_id_ok(i)) {
        return Err(bad("too many ids, or an id with odd characters"));
    }
    let unknown = financer_receipt_sources::rewe::unknown_ids(&state.store, &req.ids)
        .await
        .map_err(sync_error)?;
    Ok(Json(ReweKnownDto { unknown }))
}

/// Store receipts the app read from REWE's web shop, once each, and match them to bank payments.
/// Experimental: see docs/RECEIPT_SOURCES.md.
#[utoipa::path(post, path = "/v1/receipts/rewe/import", request_body = ReweImportRequest, responses(
    (status = 200, body = ReweImportDto),
    (status = 400, description = "A receipt is malformed or there are too many", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn rewe_import(
    State(state): State<AppState>,
    Json(req): Json<ReweImportRequest>,
) -> Result<Json<ReweImportDto>, ApiError> {
    if req.receipts.len() > financer_receipt_sources::rewe::MAX_RECEIPTS {
        return Err(bad("too many receipts in one call (at most 100)"));
    }
    let receipts = req
        .receipts
        .iter()
        .map(rewe_receipt)
        .collect::<Result<Vec<_>, _>>()?;
    let summary = financer_receipt_sources::rewe::import(&state.store, &receipts)
        .await
        .map_err(sync_error)?;
    let matcher = financer_core::StoreMatcher::with_aliases(&[]);
    let linked = financer_receipt_sources::Linker::run(&state.store, &matcher)
        .await
        .map_err(sync_error)?;
    Ok(Json(ReweImportDto {
        imported: summary.imported,
        duplicates: summary.duplicates,
        skipped: summary.skipped,
        linked: linked as u64,
        notes: summary.notes,
    }))
}

/// When the app last pushed REWE receipts and how many came this way.
#[utoipa::path(get, path = "/v1/receipts/rewe/status", responses(
    (status = 200, body = ReweStatusDto)), security(("bearer" = [])))]
pub async fn rewe_status(State(state): State<AppState>) -> Result<Json<ReweStatusDto>, ApiError> {
    let (last_import, receipts) = financer_receipt_sources::rewe::status(&state.store)
        .await
        .map_err(sync_error)?;
    Ok(Json(ReweStatusDto {
        last_import,
        receipts,
    }))
}

/// Forget when the app last pushed. Receipts already stored stay.
#[utoipa::path(delete, path = "/v1/receipts/rewe", responses(
    (status = 204, description = "Forgotten")), security(("bearer" = [])))]
pub async fn rewe_forget(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    financer_receipt_sources::rewe::forget(&state.store)
        .await
        .map_err(sync_error)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---- online orders from a file (Amazon's data export and the like) ----

#[derive(Debug, Deserialize, ToSchema)]
pub struct OrdersImportRequest {
    /// The shop's name as it should show ("Amazon"); at most 40 characters.
    pub shop: String,
    /// At most 200 orders. Same shape as a REWE receipt: the id is the shop's order number, the
    /// date the day of the order, `time` is not used.
    pub orders: Vec<ReweReceiptInput>,
}

/// Store online orders the app read from a file the shop produced (Amazon's data request, for
/// example), once each per shop and order number. Nothing is fetched from the shop.
#[utoipa::path(post, path = "/v1/receipts/orders/import", request_body = OrdersImportRequest, responses(
    (status = 200, body = ReweImportDto),
    (status = 400, description = "An order is malformed or there are too many", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn orders_import(
    State(state): State<AppState>,
    Json(req): Json<OrdersImportRequest>,
) -> Result<Json<ReweImportDto>, ApiError> {
    use financer_receipt_sources::orders::{self, Order, OrderLine};
    let shop = req.shop.trim();
    if shop.is_empty() || shop.chars().count() > 40 || orders::retailer_key(shop).is_empty() {
        return Err(bad("the shop needs a name of at most 40 characters"));
    }
    if req.orders.len() > orders::MAX_ORDERS {
        return Err(bad("too many orders in one call (at most 200)"));
    }
    let mut parsed = Vec::new();
    for o in &req.orders {
        let r = rewe_receipt(o)?;
        if r.lines.len() > orders::MAX_LINES {
            return Err(bad("an order has too many lines"));
        }
        parsed.push(Order {
            id: r.id,
            date: r.date,
            total: r.total,
            lines: r
                .lines
                .into_iter()
                .map(|l| OrderLine {
                    name: l.name,
                    quantity: l.quantity,
                    total: l.total,
                })
                .collect(),
        });
    }
    let summary = orders::import(&state.store, shop, &parsed)
        .await
        .map_err(sync_error)?;
    let matcher = financer_core::StoreMatcher::with_aliases(&[]);
    let linked = financer_receipt_sources::Linker::run(&state.store, &matcher)
        .await
        .map_err(sync_error)?;
    Ok(Json(ReweImportDto {
        imported: summary.imported,
        duplicates: summary.duplicates,
        skipped: summary.skipped,
        linked: linked as u64,
        notes: summary.notes,
    }))
}
