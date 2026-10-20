//! Bank connections described in the server configuration (`[[bank.accounts]]`), from either
//! provider: FinTS (below) or Plaid (see `bank_plaid.rs`).
//!
//! The connection (bank code, login, account) lives in the file; the PIN is typed in the app or
//! read from the environment variable named by `pin_env`, and is never stored. A sync is started
//! by the app ("Sync now") or by the scheduler (`sync_every_hours`). Either way the bank then asks
//! for an approval in the banking app (pushTAN), so a started sync waits in the `needs_approval`
//! state; the server polls the bank itself and imports as soon as you have approved. Importing
//! uses the same de-duplication as a CSV import, so syncing an overlapping period is harmless.

use std::collections::HashMap;
use std::fmt;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use financer_fints::{BankData, BankError, PendingSync, SyncParams};
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use tokio::task::AbortHandle;
use utoipa::ToSchema;

use crate::bank::BankRoutes;
use crate::bank_plaid::{BankPlaid, LinkedAccountDto};
use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

const DEFAULT_SINCE_DAYS: u32 = 90;
const MAX_DAYS: u32 = 365;
/// A later sync reads this many days before the last successful one, in case the bank books
/// late; rows already imported are skipped.
const OVERLAP_DAYS: i64 = 7;

/// How often the server asks the bank whether the approval arrived.
pub const DEFAULT_POLL: Duration = Duration::from_secs(5);
/// How often the scheduler looks for connections that are due.
pub const SCHEDULER_TICK: Duration = Duration::from_secs(60);

/// Who the bank data comes from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum BankProvider {
    /// Your bank directly (FinTS): a PIN and an approval in the banking app for every sync.
    #[default]
    Fints,
    /// Plaid: you sign in once on Plaid's page; syncs need no PIN and no approval.
    Plaid,
}

impl BankProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            BankProvider::Fints => "fints",
            BankProvider::Plaid => "plaid",
        }
    }
}

/// One `[[bank.accounts]]` entry.
#[derive(Clone, PartialEq, Eq)]
pub struct BankConnection {
    pub name: String,
    pub kind: BankProvider,
    /// Plaid only: read only these accounts (empty = all that were linked).
    pub account_ids: Vec<String>,
    pub bank_code: String,
    pub login: String,
    pub iban: String,
    pub bic: Option<String>,
    pub fints_url: Option<String>,
    /// Name of the environment variable holding the PIN.
    pub pin_env: Option<String>,
    /// 0 = only when asked.
    pub sync_every_hours: u32,
    pub since_days: Option<u32>,
}

impl fmt::Debug for BankConnection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BankConnection")
            .field("name", &self.name)
            .field("kind", &self.kind)
            .field("bank_code", &self.bank_code)
            .field("login", &"<redacted>")
            .field("iban", &"<redacted>")
            .field("pin_env", &self.pin_env)
            .field("sync_every_hours", &self.sync_every_hours)
            .finish()
    }
}

/// Where a connection is in a sync.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    /// Nothing running.
    #[default]
    Idle,
    /// Logging in or fetching.
    Syncing,
    /// Logged in; waiting for you to approve in the banking app.
    NeedsApproval,
    /// Plaid: waiting for you to sign in to your bank on Plaid's page (`link_url`).
    NeedsLink,
    /// The last attempt failed; `message` says why.
    Error,
}

#[derive(Default)]
pub(crate) struct Runtime {
    pub(crate) state: ConnectionState,
    pub(crate) message: Option<String>,
    pub(crate) approval_expires_at: Option<i64>,
    /// Plaid's sign-in page while the state is `needs_link`.
    pub(crate) link_url: Option<String>,
    /// Bumped for every attempt so a late task cannot overwrite a newer one.
    pub(crate) run: u64,
    pub(crate) abort: Option<AbortHandle>,
}

/// The configured connections and what each is doing right now.
pub struct Connections {
    pub(crate) list: Vec<BankConnection>,
    pub(crate) runtime: tokio::sync::Mutex<HashMap<String, Runtime>>,
}

impl Connections {
    pub fn new(list: Vec<BankConnection>) -> Self {
        Self {
            list,
            runtime: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    pub(crate) fn find(&self, name: &str) -> Option<&BankConnection> {
        self.list
            .iter()
            .find(|c| c.name.eq_ignore_ascii_case(name.trim()))
    }
}

/// What a sync should do, to be reported in the connection list.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncOutcomeDto {
    pub ok: bool,
    /// Unix seconds.
    pub at: i64,
    pub imported: Option<u32>,
    pub duplicates: Option<u32>,
    pub skipped: Option<u32>,
    /// Why it failed (never contains the PIN).
    pub message: Option<String>,
}

/// A configured connection. The login is masked; the PIN is never part of it.
#[derive(Debug, Serialize, ToSchema)]
pub struct BankConnectionDto {
    pub name: String,
    /// `fints` or `plaid`.
    pub kind: String,
    pub bank_code: String,
    pub login_masked: String,
    pub iban_masked: String,
    /// Hours between automatic syncs; 0 = only when you ask.
    pub sync_every_hours: u32,
    /// True when the server has the PIN (the environment variable named by `pin_env` is set), so
    /// the app does not need to ask for it.
    pub pin_from_env: bool,
    pub state: ConnectionState,
    /// The bank's approval text in `needs_approval`, the reason in `error`.
    pub message: Option<String>,
    /// Unix seconds after which a sync waiting for approval, or Plaid's sign-in page, is given up.
    pub approval_expires_at: Option<i64>,
    /// Plaid: false until you have signed in to your bank once (press Sync now to start that);
    /// always true for FinTS.
    pub linked: bool,
    /// Plaid, in `needs_link`: the page to open in the browser to sign in to your bank.
    pub link_url: Option<String>,
    /// Plaid: the accounts that were linked (put their ids in `account_ids` to read only some).
    pub accounts: Vec<LinkedAccountDto>,
    /// A scheduled sync is due but cannot start by itself because the server has no PIN: press
    /// Sync now and type it.
    pub sync_due: bool,
    /// Unix seconds of the last successful sync.
    pub last_sync_at: Option<i64>,
    pub last_result: Option<SyncOutcomeDto>,
    /// Unix seconds of the next scheduled sync; absent for manual-only connections.
    pub next_sync_at: Option<i64>,
    pub balance_cents: Option<i64>,
    #[schema(value_type = Option<String>, format = Date)]
    pub balance_date: Option<Date>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct SyncNowRequest {
    /// The PIN, when the server does not have it (`pin_from_env` is false). Used for this sync
    /// only and never stored.
    pub pin: Option<String>,
}

/// What a finished attempt looked like; stored as JSON in the settings.
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct StoredOutcome {
    ok: bool,
    at: i64,
    imported: Option<u32>,
    duplicates: Option<u32>,
    skipped: Option<u32>,
    message: Option<String>,
}

pub struct BankSync;

impl BankSync {
    pub(crate) fn now() -> i64 {
        OffsetDateTime::now_utc().unix_timestamp()
    }

    pub(crate) fn key(conn: &BankConnection, field: &str) -> String {
        format!("bankconn.{}.{field}", conn.name.trim().to_lowercase())
    }

    pub(crate) async fn get_i64(
        state: &AppState,
        conn: &BankConnection,
        field: &str,
    ) -> Option<i64> {
        state
            .store
            .get_setting(&Self::key(conn, field))
            .await
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
    }

    pub(crate) async fn get_str(
        state: &AppState,
        conn: &BankConnection,
        field: &str,
    ) -> Option<String> {
        state
            .store
            .get_setting(&Self::key(conn, field))
            .await
            .ok()
            .flatten()
            .filter(|v| !v.is_empty())
    }

    pub(crate) async fn set(state: &AppState, conn: &BankConnection, field: &str, value: &str) {
        if let Err(e) = state
            .store
            .set_setting(&Self::key(conn, field), value)
            .await
        {
            tracing::warn!(connection = %conn.name, "could not save {field}: {e}");
        }
    }

    async fn auth_failed(state: &AppState, conn: &BankConnection) -> bool {
        Self::get_i64(state, conn, "auth_failed").await == Some(1)
    }

    fn mask_login(login: &str) -> String {
        let chars: Vec<char> = login.trim().chars().collect();
        if chars.len() <= 4 {
            "****".to_string()
        } else {
            format!("{}****", chars[..2].iter().collect::<String>())
        }
    }

    fn mask_iban(iban: &str) -> String {
        let s: Vec<char> = iban.chars().filter(|c| !c.is_whitespace()).collect();
        if s.len() <= 8 {
            "****".to_string()
        } else {
            format!(
                "{}****{}",
                s[..4].iter().collect::<String>(),
                s[s.len() - 4..].iter().collect::<String>()
            )
        }
    }

    fn pin_from_env(state: &AppState, conn: &BankConnection) -> Option<String> {
        conn.pin_env
            .as_deref()
            .and_then(|var| (state.pin_lookup)(var))
            .filter(|p| !p.is_empty())
    }

    /// How many days the next sync reads: `since_days` the first time, afterwards everything since
    /// the last successful sync plus a few days of overlap.
    pub(crate) async fn days(state: &AppState, conn: &BankConnection) -> u32 {
        let first = conn
            .since_days
            .unwrap_or(DEFAULT_SINCE_DAYS)
            .clamp(1, MAX_DAYS);
        match Self::get_i64(state, conn, "last_sync_at").await {
            None => first,
            Some(last) => {
                let gone = (Self::now() - last).max(0) / 86_400;
                u32::try_from(gone + 1 + OVERLAP_DAYS)
                    .unwrap_or(MAX_DAYS)
                    .clamp(1, MAX_DAYS)
            }
        }
    }

    async fn dto(state: &AppState, conn: &BankConnection) -> BankConnectionDto {
        let now = Self::now();
        let (rt_state, rt_message, expires, link_url) = {
            let map = state.bank_connections.runtime.lock().await;
            map.get(&conn.name.to_lowercase())
                .map(|r| {
                    (
                        r.state,
                        r.message.clone(),
                        r.approval_expires_at,
                        r.link_url.clone(),
                    )
                })
                .unwrap_or_default()
        };
        let plaid = conn.kind == BankProvider::Plaid;
        let linked = !plaid || BankPlaid::is_linked(state, conn).await;
        let auth_failed = Self::auth_failed(state, conn).await;
        let last_result: Option<StoredOutcome> = state
            .store
            .get_setting(&Self::key(conn, "last_result"))
            .await
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_str(&v).ok());
        // after a restart the in-memory state is gone; a refused login still blocks the schedule
        let (shown_state, shown_message) = if rt_state == ConnectionState::Idle && auth_failed {
            (
                ConnectionState::Error,
                last_result
                    .as_ref()
                    .and_then(|r| r.message.clone())
                    .or(Some("the bank refused the login".into())),
            )
        } else {
            (rt_state, rt_message)
        };
        let last_attempt = Self::get_i64(state, conn, "last_attempt_at").await;
        let hours = i64::from(conn.sync_every_hours);
        let next_sync_at = (hours > 0).then(|| last_attempt.map_or(now, |t| t + hours * 3600));
        let pin_from_env = Self::pin_from_env(state, conn).is_some();
        let sync_due = hours > 0
            && !plaid
            && !pin_from_env
            && !auth_failed
            && state.bank_configured
            && shown_state == ConnectionState::Idle
            && next_sync_at.is_some_and(|t| t <= now);
        let date_format = time::macros::format_description!("[year]-[month]-[day]");
        BankConnectionDto {
            name: conn.name.clone(),
            kind: conn.kind.as_str().into(),
            bank_code: conn.bank_code.clone(),
            login_masked: Self::mask_login(&conn.login),
            iban_masked: Self::mask_iban(&conn.iban),
            sync_every_hours: conn.sync_every_hours,
            pin_from_env,
            state: shown_state,
            message: shown_message,
            approval_expires_at: expires,
            linked,
            link_url,
            accounts: if plaid {
                BankPlaid::linked_accounts(state, conn).await
            } else {
                Vec::new()
            },
            sync_due,
            last_sync_at: Self::get_i64(state, conn, "last_sync_at").await,
            last_result: last_result.map(|r| SyncOutcomeDto {
                ok: r.ok,
                at: r.at,
                imported: r.imported,
                duplicates: r.duplicates,
                skipped: r.skipped,
                message: r.message,
            }),
            next_sync_at,
            balance_cents: Self::get_i64(state, conn, "balance_cents").await,
            balance_date: state
                .store
                .get_setting(&Self::key(conn, "balance_date"))
                .await
                .ok()
                .flatten()
                .and_then(|v| Date::parse(&v, date_format).ok()),
        }
    }

    pub async fn list(state: AppState) -> Result<Json<Vec<BankConnectionDto>>, ApiError> {
        let mut out = Vec::new();
        for conn in &state.bank_connections.list {
            out.push(Self::dto(&state, conn).await);
        }
        Ok(Json(out))
    }

    /// Log in and ask the bank for an approval; the server then waits for it in the background.
    pub async fn start(
        state: &AppState,
        name: &str,
        typed_pin: Option<String>,
    ) -> Result<(), ApiError> {
        let conn = state
            .bank_connections
            .find(name)
            .ok_or(ApiError::NotFound)?
            .clone();
        if conn.kind == BankProvider::Plaid {
            return BankPlaid::start(state, &conn).await;
        }
        if !state.bank_configured {
            return Err(ApiError::Unavailable(
                "no FinTS product id is configured on the server (bank.fints_product_id in financer.toml, see docs/FINTS.md)".into(),
            ));
        }
        let pin = typed_pin
            .filter(|p| !p.is_empty())
            .or_else(|| Self::pin_from_env(state, &conn))
            .ok_or_else(|| {
                ApiError::BadRequest(match &conn.pin_env {
                    Some(var) => format!(
                        "enter your PIN: the environment variable {var} is not set on the server"
                    ),
                    None => {
                        "enter your PIN (this connection has no pin_env in financer.toml)".into()
                    }
                })
            })?;
        if let Some(minutes) = state.pin_guard.lock().await.blocked_minutes() {
            return Err(ApiError::TooManyRequests(
                crate::bank::PinGuard::paused_message(minutes),
            ));
        }

        let key = conn.name.to_lowercase();
        let run = {
            let mut map = state.bank_connections.runtime.lock().await;
            let rt = map.entry(key.clone()).or_default();
            if matches!(
                rt.state,
                ConnectionState::Syncing | ConnectionState::NeedsApproval
            ) {
                return Err(ApiError::Conflict(
                    "a sync for this connection is already running".into(),
                ));
            }
            rt.run += 1;
            rt.state = ConnectionState::Syncing;
            rt.message = None;
            rt.approval_expires_at = None;
            rt.run
        };
        Self::set(state, &conn, "last_attempt_at", &Self::now().to_string()).await;

        let params = SyncParams {
            blz: conn.bank_code.clone(),
            user_id: conn.login.clone(),
            pin,
            iban: conn.iban.replace(' ', ""),
            bic: conn.bic.clone().unwrap_or_default(),
            days: Self::days(state, &conn).await,
            fints_url: conn.fints_url.clone(),
        };
        match state.bank.start(&params).await {
            Err(e) => {
                state.pin_guard.lock().await.failed(&e, state.pin_pause);
                let auth = matches!(e, BankError::WrongPin | BankError::Locked);
                Self::finish(state, &conn, run, Err((e.to_string(), auth))).await;
                Err(BankRoutes::bank_error(e))
            }
            Ok((pending, challenge)) => {
                state.pin_guard.lock().await.succeeded();
                let waiting = !challenge.no_tan_required;
                {
                    // publish the state before the poller can finish, so it cannot be overwritten
                    let mut map = state.bank_connections.runtime.lock().await;
                    if let Some(rt) = map.get_mut(&key).filter(|rt| rt.run == run) {
                        if waiting {
                            rt.state = ConnectionState::NeedsApproval;
                            rt.message = Some(challenge.text.chars().take(500).collect());
                            rt.approval_expires_at =
                                Some(Self::now() + state.sync_ttl.as_secs() as i64);
                        } else {
                            rt.message = None;
                        }
                    } else {
                        return Ok(()); // cancelled while logging in
                    }
                }
                let first_delay = if waiting {
                    state.connection_poll
                } else {
                    Duration::ZERO
                };
                let handle =
                    Self::spawn_poller(state.clone(), conn.clone(), run, pending, first_delay);
                let mut map = state.bank_connections.runtime.lock().await;
                match map.get_mut(&key) {
                    Some(rt)
                        if rt.run == run
                            && matches!(
                                rt.state,
                                ConnectionState::Syncing | ConnectionState::NeedsApproval
                            ) =>
                    {
                        rt.abort = Some(handle);
                    }
                    // finished already, or cancelled in the meantime
                    Some(rt) if rt.run != run => handle.abort(),
                    _ => {}
                }
                Ok(())
            }
        }
    }

    /// Wait for the approval, fetch and import. Ends in `idle` or `error`.
    fn spawn_poller(
        state: AppState,
        conn: BankConnection,
        run: u64,
        mut pending: Box<dyn PendingSync>,
        first_delay: Duration,
    ) -> AbortHandle {
        tokio::spawn(async move {
            let started = std::time::Instant::now();
            tokio::time::sleep(first_delay).await;
            loop {
                if started.elapsed() > state.sync_ttl {
                    let message = "the approval in your banking app did not arrive in time; start the sync again".to_string();
                    Self::finish(&state, &conn, run, Err((message, false))).await;
                    return;
                }
                match pending.confirm().await {
                    Err(BankError::TanPending) => tokio::time::sleep(state.connection_poll).await,
                    Err(e) => {
                        let auth = matches!(e, BankError::WrongPin | BankError::Locked);
                        Self::finish(&state, &conn, run, Err((e.to_string(), auth))).await;
                        return;
                    }
                    Ok(data) => {
                        let outcome = Self::import(&state, &conn, data).await;
                        Self::finish(&state, &conn, run, outcome).await;
                        return;
                    }
                }
            }
        })
        .abort_handle()
    }

    pub(crate) async fn import(
        state: &AppState,
        conn: &BankConnection,
        data: BankData,
    ) -> Result<StoredOutcome, (String, bool)> {
        let skipped = data.skipped;
        let (imported, duplicates) = BankRoutes::import(state, data.transactions).await.map_err(
            |e| {
                tracing::error!(connection = %conn.name, "could not save synced transactions: {e}");
                ("the transactions could not be saved".to_string(), false)
            },
        )?;
        if let Some(b) = data.balance {
            Self::set(state, conn, "balance_cents", &b.cents().to_string()).await;
        }
        if let Some(d) = data.balance_date {
            Self::set(state, conn, "balance_date", &d.to_string()).await;
        }
        Ok(StoredOutcome {
            ok: true,
            at: Self::now(),
            imported: Some(imported as u32),
            duplicates: Some(duplicates as u32),
            skipped: Some(skipped as u32),
            message: None,
        })
    }

    /// Record how an attempt ended and release the connection. `Err((message, refused))`:
    /// `refused` is a wrong PIN or a locked login, after which nothing retries by itself.
    pub(crate) async fn finish(
        state: &AppState,
        conn: &BankConnection,
        run: u64,
        outcome: Result<StoredOutcome, (String, bool)>,
    ) {
        let (stored, message, refused) = match outcome {
            Ok(o) => (o, None, false),
            Err((message, refused)) => (
                StoredOutcome {
                    ok: false,
                    at: Self::now(),
                    imported: None,
                    duplicates: None,
                    skipped: None,
                    message: Some(message.clone()),
                },
                Some(message),
                refused,
            ),
        };
        if stored.ok {
            Self::set(state, conn, "last_sync_at", &stored.at.to_string()).await;
            Self::set(state, conn, "auth_failed", "0").await;
        } else if refused {
            Self::set(state, conn, "auth_failed", "1").await;
        }
        if let Ok(json) = serde_json::to_string(&stored) {
            Self::set(state, conn, "last_result", &json).await;
        }
        let mut map = state.bank_connections.runtime.lock().await;
        if let Some(rt) = map.get_mut(&conn.name.to_lowercase()) {
            if rt.run == run {
                rt.state = if message.is_some() {
                    ConnectionState::Error
                } else {
                    ConnectionState::Idle
                };
                rt.message = message;
                rt.approval_expires_at = None;
                rt.link_url = None;
                rt.abort = None;
            }
        }
    }

    /// Give up on a sync that is waiting for approval.
    pub async fn cancel(state: &AppState, name: &str) -> Result<(), ApiError> {
        let conn = state
            .bank_connections
            .find(name)
            .ok_or(ApiError::NotFound)?;
        let mut map = state.bank_connections.runtime.lock().await;
        let Some(rt) = map.get_mut(&conn.name.to_lowercase()) else {
            return Ok(());
        };
        match rt.state {
            ConnectionState::NeedsApproval | ConnectionState::NeedsLink => {
                if let Some(handle) = rt.abort.take() {
                    handle.abort();
                }
                rt.run += 1;
                rt.state = ConnectionState::Idle;
                rt.message = None;
                rt.approval_expires_at = None;
                rt.link_url = None;
                Ok(())
            }
            ConnectionState::Syncing => Err(ApiError::Conflict(
                "the sync is logging in or fetching right now; wait a moment".into(),
            )),
            _ => Ok(()),
        }
    }

    /// Start every connection whose schedule is due and whose PIN the server has. Returns how
    /// many were started. A connection whose login was refused is left alone until you sync it
    /// by hand, so a wrong PIN in the environment cannot lock your online banking.
    pub async fn run_due(state: &AppState) -> usize {
        let now = Self::now();
        let mut started = 0;
        for conn in &state.bank_connections.list {
            if conn.sync_every_hours == 0 {
                continue;
            }
            match conn.kind {
                BankProvider::Fints => {
                    if !state.bank_configured
                        || Self::pin_from_env(state, conn).is_none()
                        || Self::auth_failed(state, conn).await
                    {
                        continue;
                    }
                }
                // Plaid needs no PIN and no approval, so a linked connection syncs by itself;
                // one that is not linked yet waits for you to press Sync now
                BankProvider::Plaid => {
                    if state.plaid.is_none() || !BankPlaid::is_linked(state, conn).await {
                        continue;
                    }
                }
            }
            let due = match Self::get_i64(state, conn, "last_attempt_at").await {
                None => true,
                Some(t) => now >= t + i64::from(conn.sync_every_hours) * 3600,
            };
            if !due {
                continue;
            }
            match Self::start(state, &conn.name, None).await {
                Ok(()) => {
                    started += 1;
                    tracing::info!(
                        connection = %conn.name,
                        provider = conn.kind.as_str(),
                        "scheduled bank sync started"
                    );
                }
                // already running, or paused after wrong PINs: try again next time
                Err(ApiError::Conflict(_) | ApiError::TooManyRequests(_)) => {}
                Err(e) => {
                    tracing::warn!(connection = %conn.name, "scheduled bank sync failed: {}", e.message());
                }
            }
        }
        started
    }

    /// Runs forever: looks for due connections once a minute.
    pub async fn run_scheduler(state: AppState) {
        if state.bank_connections.is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            Self::run_due(&state).await;
            tokio::time::sleep(SCHEDULER_TICK).await;
        }
    }
}

/// The bank connections from `financer.toml`, with the state of each. The login is masked and no
/// secret is part of the answer.
#[utoipa::path(get, path = "/v1/bank/connections", responses((status = 200, body = Vec<BankConnectionDto>)), security(("bearer" = [])))]
pub async fn list_connections(
    State(state): State<AppState>,
) -> Result<Json<Vec<BankConnectionDto>>, ApiError> {
    BankSync::list(state).await
}

/// Start a sync for one connection: logs in, then waits (in the background) for your approval in
/// the banking app and imports. Send the PIN only when `pin_from_env` is false.
#[utoipa::path(post, path = "/v1/bank/connections/{name}/sync", params(("name" = String, Path, description = "connection name")), request_body = Option<SyncNowRequest>, responses(
    (status = 200, body = BankConnectionDto),
    (status = 400, description = "PIN missing, or rejected by the bank", body = ErrorBody),
    (status = 404, description = "No such connection", body = ErrorBody),
    (status = 409, description = "Already running", body = ErrorBody),
    (status = 429, description = "Paused after wrong PINs", body = ErrorBody),
    (status = 502, description = "Could not reach the bank", body = ErrorBody),
    (status = 503, description = "No FinTS product id configured", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn sync_connection(
    State(state): State<AppState>,
    Path(name): Path<String>,
    body: Option<Json<SyncNowRequest>>,
) -> Result<Json<BankConnectionDto>, ApiError> {
    let pin = body.and_then(|Json(b)| b.pin);
    BankSync::start(&state, &name, pin).await?;
    let conn = state
        .bank_connections
        .find(&name)
        .ok_or(ApiError::NotFound)?;
    Ok(Json(BankSync::dto(&state, conn).await))
}

/// Stop waiting for an approval.
#[utoipa::path(post, path = "/v1/bank/connections/{name}/cancel", params(("name" = String, Path, description = "connection name")), responses(
    (status = 200, body = BankConnectionDto),
    (status = 404, description = "No such connection", body = ErrorBody),
    (status = 409, description = "Logging in right now", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn cancel_connection(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<BankConnectionDto>, ApiError> {
    BankSync::cancel(&state, &name).await?;
    let conn = state
        .bank_connections
        .find(&name)
        .ok_or(ApiError::NotFound)?;
    Ok(Json(BankSync::dto(&state, conn).await))
}

/// Plaid: forget the connection. Tells Plaid to drop it and deletes the stored access token, so
/// the next sync starts with signing in again. The imported transactions stay.
#[utoipa::path(post, path = "/v1/bank/connections/{name}/disconnect", params(("name" = String, Path, description = "connection name")), responses(
    (status = 200, body = BankConnectionDto),
    (status = 400, description = "Not a Plaid connection", body = ErrorBody),
    (status = 404, description = "No such connection", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn disconnect_connection(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<BankConnectionDto>, ApiError> {
    BankPlaid::disconnect(&state, &name).await?;
    let conn = state
        .bank_connections
        .find(&name)
        .ok_or(ApiError::NotFound)?;
    Ok(Json(BankSync::dto(&state, conn).await))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_hide_most_of_the_login_and_the_iban() {
        assert_eq!(BankSync::mask_login("mein-login-name"), "me****");
        assert_eq!(BankSync::mask_login("abc"), "****");
        assert_eq!(BankSync::mask_login(""), "****");
        assert_eq!(
            BankSync::mask_iban("DE89 3704 0044 0532 0130 00"),
            "DE89****3000"
        );
        assert_eq!(BankSync::mask_iban("DE89"), "****");
    }

    #[test]
    fn debug_never_shows_login_or_iban() {
        let c = BankConnection {
            name: "Giro".into(),
            kind: BankProvider::Fints,
            account_ids: vec![],
            bank_code: "37050198".into(),
            login: "secret-login".into(),
            iban: "DE89370400440532013000".into(),
            bic: None,
            fints_url: None,
            pin_env: Some("SPARKASSE_PIN".into()),
            sync_every_hours: 12,
            since_days: None,
        };
        let shown = format!("{c:?}");
        assert!(
            !shown.contains("secret-login") && !shown.contains("DE89"),
            "{shown}"
        );
    }
}
