//! Live Sparkasse sync (FinTS pushTAN): start, wait for approval in the banking app, import.

use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::Json;
use financer_core::Categorizer;
use financer_fints::{BankError, PendingSync, SyncParams};
use time::OffsetDateTime;

use crate::dto::*;
use crate::routes::ApiError;
use crate::AppState;

const DEFAULT_DAYS: u32 = 90;
const MAX_DAYS: u32 = 365;

/// The one sync that is waiting for approval. Holds the bank dialog (and through it the PIN)
/// in memory only.
pub struct PendingEntry {
    id: String,
    started: Instant,
    pending: Box<dyn PendingSync>,
    blz: String,
    user_id: String,
    iban: String,
    bic: String,
}

fn bank_error(e: BankError) -> ApiError {
    match e {
        BankError::NotConfigured => ApiError::Unavailable(e.to_string()),
        BankError::WrongPin
        | BankError::Locked
        | BankError::UnsupportedTan
        | BankError::Rejected(_) => ApiError::BadRequest(e.to_string().chars().take(300).collect()),
        BankError::TanPending => ApiError::Conflict(e.to_string()),
        BankError::Connection(_) => ApiError::BadGateway(e.to_string().chars().take(300).collect()),
    }
}

/// Log in to the bank and ask for approval. Approve in your Sparkasse app, then call confirm.
#[utoipa::path(post, path = "/v1/bank/sync", request_body = SyncRequest, responses(
    (status = 200, body = SyncStarted),
    (status = 400, description = "Rejected by the bank, or a TAN method that is not supported", body = ErrorBody),
    (status = 502, description = "Could not reach the bank", body = ErrorBody),
    (status = 503, description = "No FinTS product id configured", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn start_sync(
    State(state): State<AppState>,
    Json(req): Json<SyncRequest>,
) -> Result<Json<SyncStarted>, ApiError> {
    if req.blz.trim().is_empty()
        || req.user_id.trim().is_empty()
        || req.pin.is_empty()
        || req.iban.trim().is_empty()
    {
        return Err(ApiError::BadRequest(
            "blz, user_id, pin and iban are required".into(),
        ));
    }
    let params = SyncParams {
        blz: req.blz.trim().to_string(),
        user_id: req.user_id.trim().to_string(),
        pin: req.pin,
        iban: req.iban.trim().replace(' ', ""),
        bic: req.bic.unwrap_or_default().trim().to_string(),
        days: req.days.unwrap_or(DEFAULT_DAYS).clamp(1, MAX_DAYS),
    };
    if let Some(minutes) = state.pin_guard.lock().await.blocked_minutes() {
        return Err(ApiError::TooManyRequests(format!(
            "syncing is paused for about {minutes} more minute(s) after failed logins, to keep your online banking from being locked. Check your PIN and login first"
        )));
    }
    let (pending, challenge) = match state.bank.start(&params).await {
        Ok(started) => {
            state.pin_guard.lock().await.failures = 0;
            started
        }
        Err(e) => {
            if matches!(e, BankError::WrongPin | BankError::Locked) {
                let mut guard = state.pin_guard.lock().await;
                guard.failures += 1;
                if guard.failures >= PIN_STRIKES || matches!(e, BankError::Locked) {
                    guard.blocked_until = Some(Instant::now() + state.pin_pause);
                }
            }
            return Err(bank_error(e));
        }
    };

    let id = uuid::Uuid::new_v4().to_string();
    *state.pending_sync.lock().await = Some(PendingEntry {
        id: id.clone(),
        started: Instant::now(),
        pending,
        blz: params.blz,
        user_id: params.user_id,
        iban: params.iban,
        bic: params.bic,
    });
    Ok(Json(SyncStarted {
        sync_id: id,
        challenge: challenge.text,
        no_tan_required: challenge.no_tan_required,
    }))
}

/// Check whether you approved in the banking app; if so, import. Answers 409 while still
/// waiting: keep calling every few seconds.
#[utoipa::path(post, path = "/v1/bank/sync/{id}/confirm", params(("id" = String, Path, description = "sync_id")), responses(
    (status = 200, body = SyncDone),
    (status = 404, description = "Unknown or expired sync", body = ErrorBody),
    (status = 409, description = "Not approved yet", body = ErrorBody),
    (status = 400, description = "Rejected by the bank", body = ErrorBody),
    (status = 502, description = "Could not reach the bank", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn confirm_sync(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SyncDone>, ApiError> {
    let mut slot = state.pending_sync.lock().await;
    let expired = slot
        .as_ref()
        .is_some_and(|e| e.started.elapsed() > state.sync_ttl);
    if expired {
        *slot = None;
    }
    let Some(entry) = slot.as_mut().filter(|e| e.id == id) else {
        return Err(ApiError::NotFound);
    };

    let data = match entry.pending.confirm().await {
        Ok(d) => d,
        Err(BankError::TanPending) => {
            return Err(ApiError::Conflict(BankError::TanPending.to_string()))
        }
        Err(e) => {
            *slot = None; // a failed dialog cannot be resumed
            return Err(bank_error(e));
        }
    };
    let entry = slot.take().expect("entry present");
    drop(slot);

    let categorizer = Categorizer::new();
    let mut txs = data.transactions;
    for tx in &mut txs {
        tx.category = Some(categorizer.categorize(tx));
    }
    let imported = state.store.insert_new_transactions(&txs).await?;

    let store = &state.store;
    for (key, value) in [
        ("bank_blz", &entry.blz),
        ("bank_user_id", &entry.user_id),
        ("bank_iban", &entry.iban),
        ("bank_bic", &entry.bic),
    ] {
        store.set_setting(key, value).await?;
    }
    store
        .set_setting(
            "bank_last_sync_at",
            &OffsetDateTime::now_utc().unix_timestamp().to_string(),
        )
        .await?;
    if let Some(b) = data.balance {
        store
            .set_setting("bank_balance_cents", &b.cents().to_string())
            .await?;
    }
    if let Some(d) = data.balance_date {
        store
            .set_setting("bank_balance_date", &d.to_string())
            .await?;
    }
    Ok(Json(SyncDone {
        imported,
        duplicates: txs.len() - imported,
        skipped: data.skipped,
        balance_cents: data.balance,
        balance_date: data.balance_date,
    }))
}

#[utoipa::path(get, path = "/v1/bank/status", responses((status = 200, body = BankStatus)), security(("bearer" = [])))]
pub async fn bank_status(State(state): State<AppState>) -> Result<Json<BankStatus>, ApiError> {
    let store = &state.store;
    let date_format = time::macros::format_description!("[year]-[month]-[day]");
    Ok(Json(BankStatus {
        configured: state.bank_configured,
        last_sync_at: store
            .get_setting("bank_last_sync_at")
            .await?
            .and_then(|v| v.parse().ok()),
        balance_cents: store
            .get_setting("bank_balance_cents")
            .await?
            .and_then(|v| v.parse().ok())
            .map(financer_core::Money::from_cents),
        balance_date: store
            .get_setting("bank_balance_date")
            .await?
            .and_then(|v| time::Date::parse(&v, date_format).ok()),
        blz: store.get_setting("bank_blz").await?,
        user_id: store.get_setting("bank_user_id").await?,
        iban: store.get_setting("bank_iban").await?,
        bic: store.get_setting("bank_bic").await?,
    }))
}

/// Two wrong PINs in a row pause new syncs: banks typically lock online banking after about
/// three, and a locked account is far worse than a short wait.
const PIN_STRIKES: u32 = 2;

#[derive(Default)]
pub struct PinGuard {
    failures: u32,
    blocked_until: Option<Instant>,
}

impl PinGuard {
    /// Minutes left in a pause, if one is active.
    fn blocked_minutes(&mut self) -> Option<u64> {
        let until = self.blocked_until?;
        match until.checked_duration_since(Instant::now()) {
            Some(left) => Some(left.as_secs() / 60 + 1),
            None => {
                self.blocked_until = None;
                self.failures = 0;
                None
            }
        }
    }
}

/// How long a started sync may wait for approval before it must be restarted.
pub const DEFAULT_SYNC_TTL: Duration = Duration::from_secs(10 * 60);

/// How long syncing pauses after repeated wrong PINs.
pub const DEFAULT_PIN_PAUSE: Duration = Duration::from_secs(15 * 60);
