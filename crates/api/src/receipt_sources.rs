//! Receipt sources, through one API whatever the source: which exist and how each is doing, sync
//! now, and for each `{kind}` the calls its flow needs.
//!
//! - `server` (`email`, `folder`): the server reads on a schedule; nothing to do but look.
//! - `sign_in` (`lidl_plus`, `kaufland_card`): `connect`, sign in on the shop's own page (the server
//!   only ever sees the address it redirects to), `finish`, and later `disconnect`.
//! - `push` (`rewe_app`, `orders_file`): the app reads the receipts and hands them over with
//!   `import` (and asks `known` which ones are new).

use axum::extract::{Path, State};
use axum::Json;
use financer_receipt_sources::kaufland::KauflandError;
use financer_receipt_sources::lidl::LidlError;
use financer_receipt_sources::{SourceHealth, SourceKind, SourceStatus, SyncNowError, SyncReport};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

/// One receipt source and how it is doing. Contains no secrets.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptSourceDto {
    /// `email`, `lidl_plus`, `kaufland_card`, `folder`, `rewe_app` or `orders_file`.
    pub source: String,
    /// How its receipts get in: `server`, `sign_in` or `push`.
    pub flow: String,
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
    /// Unix seconds of the sign-in (a `sign_in` source).
    pub connected_at: Option<i64>,
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
            flow: s.kind.flow().to_string(),
            configured: s.configured,
            enabled: s.enabled,
            state: health_name(s.health).to_string(),
            last_run: s.last_run,
            last_success: s.last_success,
            next_run: s.next_run,
            last_error: s.last_error,
            connected_at: None,
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
            flow: kind.flow().to_string(),
            configured: false,
            enabled: false,
            state: "disabled".into(),
            last_run: None,
            last_success: None,
            next_run: None,
            last_error: None,
            connected_at: None,
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

/// Starting a sign-in on a shop's own page.
#[derive(Debug, Serialize, ToSchema)]
pub struct SourceConnectDto {
    /// Open this address in a browser: it is the shop's own sign-in page.
    pub authorization_url: String,
    /// Send this back with the final address to `POST /v1/receipts/sources/{kind}/finish`.
    pub state: String,
    /// The address scheme the shop's page redirects to after sign-in (`com.lidlplus.app`); an app
    /// can watch for it, a person can copy the address from the browser.
    pub callback_scheme: String,
    pub redirect_uri: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SourceFinishRequest {
    pub state: String,
    /// The address the sign-in ended on, `com.lidlplus.app://callback?code=...`.
    pub callback_url: String,
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

fn kind_of(key: &str) -> Result<SourceKind, ApiError> {
    SourceKind::from_any_key(key).ok_or(ApiError::NotFound)
}

fn wrong_flow(kind: SourceKind, what: &str) -> ApiError {
    ApiError::BadRequest(format!(
        "{} has nothing to {what}: it is a `{}` source",
        kind.key(),
        kind.flow()
    ))
}

pub struct ReceiptSourceRoutes;

impl ReceiptSourceRoutes {
    fn sign_in_syncer(
        state: &AppState,
        kind: SourceKind,
    ) -> Result<&financer_receipt_sources::ReceiptSyncer, ApiError> {
        let syncer = state.receipt_syncer.as_deref();
        let on = match kind {
            SourceKind::LidlPlus => syncer.is_some_and(|s| s.lidl().is_some()),
            SourceKind::KauflandCard => syncer.is_some_and(|s| s.kaufland().is_some()),
            _ => false,
        };
        match syncer {
            Some(s) if on => Ok(s),
            _ => Err(ApiError::Conflict(format!(
                "{} is not switched on",
                match kind {
                    SourceKind::LidlPlus => "Lidl Plus",
                    _ => "Kaufland",
                }
            ))),
        }
    }

    pub async fn sources(
        State(state): State<AppState>,
    ) -> Result<Json<Vec<ReceiptSourceDto>>, ApiError> {
        let mut list = Vec::new();
        for kind in SourceKind::EVERY {
            list.push(Self::source(&state, kind).await?);
        }
        Ok(Json(list))
    }

    /// One source as the list shows it. A pushed source has no schedule: it counts as connected
    /// once receipts came that way.
    async fn source(state: &AppState, kind: SourceKind) -> Result<ReceiptSourceDto, ApiError> {
        if kind.flow() == "push" {
            let (last, receipts) = match kind {
                SourceKind::ReweApp => financer_receipt_sources::rewe::status(&state.store)
                    .await
                    .map_err(sync_error)?,
                _ => (None, state.store.count_receipts_from(kind.key()).await?),
            };
            let mut dto = ReceiptSourceDto::disabled(kind);
            dto.configured = true;
            dto.enabled = true;
            dto.state = if receipts > 0 { "ok" } else { "not_connected" }.into();
            dto.last_run = last;
            dto.last_success = last;
            dto.imported_total = receipts;
            return Ok(dto);
        }
        let Some(syncer) = &state.receipt_syncer else {
            return Ok(ReceiptSourceDto::disabled(kind));
        };
        let status = syncer
            .statuses()
            .await
            .map_err(sync_error)?
            .into_iter()
            .find(|s| s.kind == kind);
        let Some(status) = status else {
            return Ok(ReceiptSourceDto::disabled(kind));
        };
        let mut dto = ReceiptSourceDto::from(status);
        dto.connected_at = match kind {
            SourceKind::LidlPlus => match syncer.lidl() {
                Some(l) => l.connected_at().await.map_err(sync_error)?,
                None => None,
            },
            SourceKind::KauflandCard => match syncer.kaufland() {
                Some(k) => k.connected_at().await.map_err(sync_error)?,
                None => None,
            },
            _ => None,
        };
        Ok(dto)
    }

    pub async fn get(
        State(state): State<AppState>,
        Path(kind): Path<String>,
    ) -> Result<Json<ReceiptSourceDto>, ApiError> {
        Self::source(&state, kind_of(&kind)?).await.map(Json)
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

    pub async fn connect(
        State(state): State<AppState>,
        Path(kind): Path<String>,
    ) -> Result<Json<SourceConnectDto>, ApiError> {
        let kind = kind_of(&kind)?;
        let syncer = match kind.flow() {
            "sign_in" => Self::sign_in_syncer(&state, kind)?,
            _ => return Err(wrong_flow(kind, "sign in to")),
        };
        macro_rules! dto {
            ($s:expr) => {
                SourceConnectDto {
                    authorization_url: $s.authorization_url,
                    state: $s.state,
                    callback_scheme: $s.callback_scheme,
                    redirect_uri: $s.redirect_uri,
                    expires_in_seconds: $s.expires_in_secs,
                }
            };
        }
        let dto = match kind {
            SourceKind::LidlPlus => dto!(syncer
                .lidl()
                .ok_or(ApiError::Internal)?
                .start()
                .await
                .map_err(lidl_error)?),
            _ => dto!(syncer
                .kaufland()
                .ok_or(ApiError::Internal)?
                .start()
                .await
                .map_err(kaufland_error)?),
        };
        Ok(Json(dto))
    }

    pub async fn finish(
        State(state): State<AppState>,
        Path(kind): Path<String>,
        Json(req): Json<SourceFinishRequest>,
    ) -> Result<Json<ReceiptSourceDto>, ApiError> {
        let kind = kind_of(&kind)?;
        if kind.flow() != "sign_in" {
            return Err(wrong_flow(kind, "finish"));
        }
        let syncer = Self::sign_in_syncer(&state, kind)?;
        match kind {
            SourceKind::LidlPlus => syncer
                .lidl()
                .ok_or(ApiError::Internal)?
                .finish(&req.state, &req.callback_url)
                .await
                .map_err(lidl_error)?,
            _ => syncer
                .kaufland()
                .ok_or(ApiError::Internal)?
                .finish(&req.state, &req.callback_url)
                .await
                .map_err(kaufland_error)?,
        }
        // first sync right away; failures are shown in the status, they do not undo the sign-in
        if let Err(e) = syncer.sync_now(Some(kind)).await {
            tracing::warn!("first {} sync: {e}", kind.key());
        }
        Self::source(&state, kind).await.map(Json)
    }

    pub async fn disconnect(
        State(state): State<AppState>,
        Path(kind): Path<String>,
    ) -> Result<Json<ReceiptSourceDto>, ApiError> {
        let kind = kind_of(&kind)?;
        match kind {
            SourceKind::LidlPlus | SourceKind::KauflandCard => {
                let syncer = Self::sign_in_syncer(&state, kind)?;
                if kind == SourceKind::LidlPlus {
                    syncer
                        .lidl()
                        .ok_or(ApiError::Internal)?
                        .disconnect()
                        .await
                        .map_err(sync_error)?;
                } else {
                    syncer
                        .kaufland()
                        .ok_or(ApiError::Internal)?
                        .disconnect()
                        .await
                        .map_err(sync_error)?;
                }
            }
            SourceKind::ReweApp => financer_receipt_sources::rewe::forget(&state.store)
                .await
                .map_err(sync_error)?,
            _ => return Err(wrong_flow(kind, "disconnect")),
        }
        Self::source(&state, kind).await.map(Json)
    }

    pub async fn known(
        State(state): State<AppState>,
        Path(kind): Path<String>,
        Json(req): Json<ReceiptKnownRequest>,
    ) -> Result<Json<ReceiptKnownDto>, ApiError> {
        let kind = kind_of(&kind)?;
        if kind != SourceKind::ReweApp {
            return Err(wrong_flow(kind, "list known receipts of"));
        }
        if req.ids.len() > 1000 || req.ids.iter().any(|i| !receipt_id_ok(i)) {
            return Err(bad("too many ids, or an id with odd characters"));
        }
        let unknown = financer_receipt_sources::rewe::unknown_ids(&state.store, &req.ids)
            .await
            .map_err(sync_error)?;
        Ok(Json(ReceiptKnownDto { unknown }))
    }

    pub async fn import(
        State(state): State<AppState>,
        Path(kind): Path<String>,
        Json(req): Json<ReceiptImportRequest>,
    ) -> Result<Json<ReceiptImportDto>, ApiError> {
        let kind = kind_of(&kind)?;
        let summary = match kind {
            SourceKind::ReweApp => {
                if req.receipts.len() > financer_receipt_sources::rewe::MAX_RECEIPTS {
                    return Err(bad("too many receipts in one call (at most 100)"));
                }
                let receipts = req
                    .receipts
                    .iter()
                    .map(receipt)
                    .collect::<Result<Vec<_>, _>>()?;
                financer_receipt_sources::rewe::import(&state.store, &receipts)
                    .await
                    .map_err(sync_error)?
            }
            SourceKind::OrdersFile => Self::import_orders(&state, &req).await?,
            _ => return Err(wrong_flow(kind, "import")),
        };
        let matcher = financer_core::StoreMatcher::with_aliases(&[]);
        let linked = financer_receipt_sources::Linker::run(&state.store, &matcher)
            .await
            .map_err(sync_error)?;
        Ok(Json(ReceiptImportDto {
            imported: summary.imported,
            duplicates: summary.duplicates,
            skipped: summary.skipped,
            linked: linked as u64,
            notes: summary.notes,
        }))
    }

    async fn import_orders(
        state: &AppState,
        req: &ReceiptImportRequest,
    ) -> Result<financer_receipt_sources::summary::RunSummary, ApiError> {
        use financer_receipt_sources::orders::{self, Order, OrderLine};
        let shop = req.shop.as_deref().unwrap_or("").trim();
        if shop.is_empty() || shop.chars().count() > 40 || orders::retailer_key(shop).is_empty() {
            return Err(bad("the shop needs a name of at most 40 characters"));
        }
        if req.receipts.len() > orders::MAX_ORDERS {
            return Err(bad("too many orders in one call (at most 200)"));
        }
        let mut parsed = Vec::new();
        for o in &req.receipts {
            let r = receipt(o)?;
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
        orders::import(&state.store, shop, &parsed)
            .await
            .map_err(sync_error)
    }
}

// ---- receipts a `push` source hands over ----

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReceiptKnownRequest {
    /// The shop's receipt ids the app has just listed.
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptKnownDto {
    /// The ids that are not stored yet: fetch and push only these.
    pub unknown: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReceiptLineInput {
    pub name: String,
    /// 1 to 99.
    pub quantity: u32,
    /// What the line cost in cents (negative for a refund).
    pub total_cents: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReceiptInput {
    /// The shop's id of the receipt (for an order, its order number).
    pub id: String,
    /// Local day of the purchase, `YYYY-MM-DD`.
    #[schema(example = "2026-03-02")]
    pub date: String,
    /// Local time, `HH:MM`.
    pub time: Option<String>,
    pub store: Option<String>,
    /// The printed total in cents; the sum of the lines when absent.
    pub total_cents: Option<i64>,
    pub lines: Vec<ReceiptLineInput>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReceiptImportRequest {
    /// `orders_file` only: the shop's name as it should show ("Amazon"); at most 40 characters.
    pub shop: Option<String>,
    /// At most 100 receipts for `rewe_app`, 200 orders for `orders_file` (whose `time` is not used).
    pub receipts: Vec<ReceiptInput>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptImportDto {
    pub imported: u32,
    pub duplicates: u32,
    pub skipped: u32,
    /// Receipts matched to a bank payment by this import.
    pub linked: u64,
    pub notes: Vec<String>,
}

const MAX_CENTS: i64 = 100_000_000;

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError::BadRequest(msg.into())
}

fn receipt_id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.'))
}

fn receipt(r: &ReceiptInput) -> Result<financer_receipt_sources::rewe::ImportReceipt, ApiError> {
    use financer_core::Money;
    use financer_receipt_sources::rewe::{ImportLine, ImportReceipt, MAX_LINES};
    if !receipt_id_ok(&r.id) {
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

// ---- the calls ----

/// Every receipt source and how it is doing: the mailbox and the watched folder (`server`), Lidl
/// Plus and the Kaufland Card (`sign_in`), REWE in the app and an orders file (`push`). Never
/// contains a password or token.
#[utoipa::path(get, path = "/v1/receipts/sources", responses(
    (status = 200, body = Vec<ReceiptSourceDto>)), security(("bearer" = [])))]
pub async fn list_sources(state: State<AppState>) -> Result<Json<Vec<ReceiptSourceDto>>, ApiError> {
    ReceiptSourceRoutes::sources(state).await
}

/// One source: its state, when it last ran, how many receipts came from it, the last error.
#[utoipa::path(get, path = "/v1/receipts/sources/{kind}", params(("kind" = String, Path, description = "`email`, `lidl_plus`, `kaufland_card`, `folder`, `rewe_app` or `orders_file`")), responses(
    (status = 200, body = ReceiptSourceDto),
    (status = 404, description = "Unknown source", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn get_source(
    state: State<AppState>,
    kind: Path<String>,
) -> Result<Json<ReceiptSourceDto>, ApiError> {
    ReceiptSourceRoutes::get(state, kind).await
}

/// Run the enabled receipt sources now (or just one). New receipts are linked to bank
/// transactions where that is unambiguous. `409` while another sync is running.
#[utoipa::path(post, path = "/v1/receipts/sync", request_body = ReceiptSyncRequest, responses(
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

/// `sign_in` sources: start the sign-in. Returns the address of the shop's own sign-in page;
/// nothing is sent to the shop by this call. Experimental and unofficial: see
/// docs/RECEIPT_SOURCES.md.
#[utoipa::path(post, path = "/v1/receipts/sources/{kind}/connect", params(("kind" = String, Path, description = "`lidl_plus` or `kaufland_card`")), responses(
    (status = 200, body = SourceConnectDto),
    (status = 400, description = "Not a source you sign in to", body = ErrorBody),
    (status = 404, description = "Unknown source", body = ErrorBody),
    (status = 409, description = "The source is not switched on", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn connect_source(
    state: State<AppState>,
    kind: Path<String>,
) -> Result<Json<SourceConnectDto>, ApiError> {
    ReceiptSourceRoutes::connect(state, kind).await
}

/// `sign_in` sources: finish the sign-in with the address the shop's page ended on. Only the
/// refresh token is stored, encrypted. The first receipts are fetched right away.
#[utoipa::path(post, path = "/v1/receipts/sources/{kind}/finish", params(("kind" = String, Path, description = "`lidl_plus` or `kaufland_card`")), request_body = SourceFinishRequest, responses(
    (status = 200, body = ReceiptSourceDto),
    (status = 400, description = "Unknown or expired sign-in, or an address that is not the callback", body = ErrorBody),
    (status = 404, description = "Unknown source", body = ErrorBody),
    (status = 409, description = "The source is not switched on", body = ErrorBody),
    (status = 502, description = "The shop did not accept the code or could not be reached", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn finish_source(
    state: State<AppState>,
    kind: Path<String>,
    body: Json<SourceFinishRequest>,
) -> Result<Json<ReceiptSourceDto>, ApiError> {
    ReceiptSourceRoutes::finish(state, kind, body).await
}

/// Forget the connection: a stored token is deleted (`sign_in`), or the note of the last push
/// (`rewe_app`). Receipts already stored stay.
#[utoipa::path(post, path = "/v1/receipts/sources/{kind}/disconnect", params(("kind" = String, Path, description = "`lidl_plus`, `kaufland_card` or `rewe_app`")), responses(
    (status = 200, body = ReceiptSourceDto),
    (status = 400, description = "Nothing to disconnect for this source", body = ErrorBody),
    (status = 404, description = "Unknown source", body = ErrorBody),
    (status = 409, description = "The source is not switched on", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn disconnect_source(
    state: State<AppState>,
    kind: Path<String>,
) -> Result<Json<ReceiptSourceDto>, ApiError> {
    ReceiptSourceRoutes::disconnect(state, kind).await
}

/// `push` sources (`rewe_app`): which of the shop's receipt ids are not stored yet. The app calls
/// it with the list it just read, so that it fetches the details of the new ones only.
#[utoipa::path(post, path = "/v1/receipts/sources/{kind}/known", params(("kind" = String, Path, description = "`rewe_app`")), request_body = ReceiptKnownRequest, responses(
    (status = 200, body = ReceiptKnownDto),
    (status = 400, description = "Too many ids, an odd id, or a source without a list", body = ErrorBody),
    (status = 404, description = "Unknown source", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn known_receipts(
    state: State<AppState>,
    kind: Path<String>,
    body: Json<ReceiptKnownRequest>,
) -> Result<Json<ReceiptKnownDto>, ApiError> {
    ReceiptSourceRoutes::known(state, kind, body).await
}

/// `push` sources: store the receipts the app read (REWE's web shop in its own window, `rewe_app`)
/// or the orders it read from a file the shop produced (`orders_file`: Amazon's data request, for
/// example), once each, and match them to bank payments. Nothing is fetched from the shop.
/// Experimental: see docs/RECEIPT_SOURCES.md.
#[utoipa::path(post, path = "/v1/receipts/sources/{kind}/import", params(("kind" = String, Path, description = "`rewe_app` or `orders_file`")), request_body = ReceiptImportRequest, responses(
    (status = 200, body = ReceiptImportDto),
    (status = 400, description = "A receipt is malformed, there are too many, or the source takes no pushes", body = ErrorBody),
    (status = 404, description = "Unknown source", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn import_receipts(
    state: State<AppState>,
    kind: Path<String>,
    body: Json<ReceiptImportRequest>,
) -> Result<Json<ReceiptImportDto>, ApiError> {
    ReceiptSourceRoutes::import(state, kind, body).await
}
