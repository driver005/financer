//! Every way transactions come in, through one API: a CSV file, FinTS (your bank directly), Plaid,
//! GoCardless and finAPI. The providers live in `financer-openbanking` behind one trait; this is
//! the one engine that drives them.
//!
//! - **Providers** (`GET /v1/bank/providers`): what exists, how it works (`file`, `approval` or
//!   `link`), and whether this server has it set up.
//! - **Connections** (`[[bank.accounts]]` in the server configuration): a bank with a provider,
//!   listed with its state (`GET /v1/bank/connections`).
//! - **Sync** (`POST /v1/bank/sync`, then `GET /v1/bank/sync/{id}`): the same call for every
//!   provider. A connection syncs by its name; FinTS can also be given a login directly (an
//!   ad-hoc sync, nothing is stored but the non-secret details). The state says what the person has
//!   to do: `needs_approval` (approve in the banking app), `needs_link` (sign in on `link_url`), or
//!   nothing. The server waits in the background and imports as soon as it can.
//! - **Import** (`POST /v1/bank/import/{kind}`): hand over a file.
//!
//! Importing uses the same de-duplication whatever the source, so syncing an overlapping period, or
//! importing a file you synced before, is harmless. A PIN is typed in the app or read from the
//! environment variable named by `pin_env`, and is never stored. A credential a provider hands over
//! (Plaid, GoCardless, finAPI) is kept sealed with the server secret.

use std::collections::HashMap;
use std::fmt;
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::Json;
use financer_openbanking::{
    BeginRequest, FetchRequest, Fetched, Flow, Login, OpenError, Poll, ProviderKind, Step,
};
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use tokio::task::AbortHandle;
use utoipa::ToSchema;
use zeroize::Zeroizing;

use crate::dto::{BankStatusDto, ErrorBody, FileImportDto, SkippedRowDto};
use crate::routes::ApiError;
use crate::AppState;

/// Plaid, GoCardless, finAPI, FinTS, CSV: the name the configuration and the API use for a source.
pub type BankProvider = ProviderKind;

const DEFAULT_SINCE_DAYS: u32 = 90;
const MAX_DAYS: u32 = 365;
/// A later sync reads this many days before the last successful one, in case the bank books
/// late; rows already imported are skipped.
const OVERLAP_DAYS: i64 = 7;
/// The longest a sign-in page is waited for.
const MAX_LINK_WAIT: i64 = 3600;
/// A finished ad-hoc sync stays readable this long.
const ADHOC_KEEP: i64 = 3600;

/// How often the server asks the provider whether the person is done.
pub const DEFAULT_POLL: Duration = Duration::from_secs(5);
/// How often the scheduler looks for connections that are due.
pub const SCHEDULER_TICK: Duration = Duration::from_secs(60);
/// How long a started sync may wait for approval before it must be restarted.
pub const DEFAULT_SYNC_TTL: Duration = Duration::from_secs(10 * 60);

/// One `[[bank.accounts]]` entry, or an ad-hoc FinTS login (its name starts with `~`).
#[derive(Clone, PartialEq, Eq)]
pub struct BankConnection {
    pub name: String,
    pub kind: BankProvider,
    /// Plaid, GoCardless, finAPI: read only these accounts (empty = all that were linked).
    pub account_ids: Vec<String>,
    /// GoCardless only: the bank to connect (an institution id from GoCardless's list).
    pub institution: Option<String>,
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

impl BankConnection {
    /// A login that was sent with the request, not set up in the configuration. It stores nothing
    /// under its name.
    pub(crate) fn adhoc(&self) -> bool {
        self.name.starts_with('~')
    }

    /// The key of its state in memory, and the id a sync is polled by.
    pub(crate) fn id(&self) -> String {
        self.name.to_lowercase()
    }
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
    /// Waiting for you to sign in to your bank on the provider's page (`link_url`).
    NeedsLink,
    /// The last attempt failed; `message` says why.
    Error,
}

#[derive(Default)]
pub(crate) struct Runtime {
    pub(crate) state: ConnectionState,
    pub(crate) message: Option<String>,
    pub(crate) approval_expires_at: Option<i64>,
    /// The provider's sign-in page while the state is `needs_link`.
    pub(crate) link_url: Option<String>,
    /// Bumped for every attempt so a late task cannot overwrite a newer one.
    pub(crate) run: u64,
    pub(crate) abort: Option<AbortHandle>,
    /// What the provider calls the sign-in or approval that is open, to tell it when it is dropped.
    pub(crate) session: Option<String>,
    /// How the last attempt ended (kept in memory for an ad-hoc sync; a connection keeps it in the
    /// settings).
    pub(crate) result: Option<StoredOutcome>,
    pub(crate) finished_at: Option<i64>,
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

// ---------------------------------------------------------------------------------- the API's shapes

/// An account the provider reported for a linked connection.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LinkedAccountDto {
    /// Put this in `account_ids` of the connection to read only some accounts.
    pub id: String,
    pub name: String,
    /// The last digits of the account number, when the provider has them.
    pub mask: Option<String>,
    /// For example `depository` or `credit`.
    pub kind: String,
}

/// What a sync should do, to be reported in the connection list.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SyncOutcomeDto {
    pub ok: bool,
    /// Unix seconds.
    pub at: i64,
    pub imported: Option<u32>,
    pub duplicates: Option<u32>,
    pub skipped: Option<u32>,
    /// Why it failed (never contains the PIN).
    pub message: Option<String>,
    pub balance_cents: Option<i64>,
    #[schema(value_type = Option<String>, format = Date)]
    pub balance_date: Option<Date>,
}

/// A source of transactions and how to talk to it.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProviderDto {
    /// `csv`, `fints`, `plaid`, `gocardless` or `finapi`.
    pub kind: String,
    pub label: String,
    /// `file` (send a file to `/v1/bank/import/{kind}`), `approval` (a PIN, then an approval in the
    /// banking app, for every sync) or `link` (sign in once on the provider's page).
    pub flow: String,
    /// This server has it set up (its keys, or for FinTS the product id).
    pub available: bool,
    /// Connections of this kind in the server configuration.
    pub connections: u32,
}

/// A configured connection. The login is masked; the PIN is never part of it.
#[derive(Debug, Serialize, ToSchema)]
pub struct BankConnectionDto {
    /// What to poll and cancel it by (`/v1/bank/sync/{id}`).
    pub id: String,
    pub name: String,
    /// `fints`, `plaid`, `gocardless` or `finapi`.
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
    /// Unix seconds after which a sync waiting for approval, or for a sign-in, is given up.
    pub approval_expires_at: Option<i64>,
    /// False until you have signed in to your bank once (start a sync to do that); always true
    /// for FinTS.
    pub linked: bool,
    /// In `needs_link`: the page to open in the browser to sign in to your bank.
    pub link_url: Option<String>,
    /// The accounts that were linked (put their ids in `account_ids` to read only some).
    pub accounts: Vec<LinkedAccountDto>,
    /// A scheduled sync is due but cannot start by itself because the server has no PIN: start a
    /// sync and type it.
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

/// The online banking login of a FinTS sync that is not set up in the configuration.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginInput {
    /// Bank code (BLZ).
    pub blz: String,
    /// Online banking login name.
    pub user_id: String,
    pub iban: String,
    /// Leave empty to use the bank's own BIC.
    pub bic: Option<String>,
    /// Only for a bank that is not in the built-in list (then the BIC is needed too).
    pub fints_url: Option<String>,
}

/// Start a sync: the same request for every provider.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct SyncInput {
    /// A connection of the server configuration, by name. Or leave it out and name the `kind` and
    /// (for FinTS) the `login`.
    pub connection: Option<String>,
    /// `fints` for a login sent with this request.
    pub kind: Option<String>,
    pub login: Option<LoginInput>,
    /// The PIN, when the server does not have it (`pin_from_env` is false). Used for this sync
    /// only and never stored.
    pub pin: Option<String>,
    /// Days of history for a login sent with the request (default 90, 1 to 365).
    pub days: Option<u32>,
}

/// A sync, started or running or finished. Poll `GET /v1/bank/sync/{id}` while `state` is
/// `syncing`, `needs_approval` or `needs_link`.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncDto {
    pub id: String,
    pub kind: String,
    /// The configured connection it belongs to; absent for a login sent with the request.
    pub connection: Option<String>,
    pub state: ConnectionState,
    /// The bank's approval text in `needs_approval`, the reason in `error`.
    pub message: Option<String>,
    /// In `needs_link`: the page to open in the browser.
    pub link_url: Option<String>,
    /// Unix seconds after which the wait is given up.
    pub expires_at: Option<i64>,
    /// How the last attempt ended, once it did.
    pub result: Option<SyncOutcomeDto>,
}

/// What a finished attempt looked like; stored as JSON in the settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredOutcome {
    ok: bool,
    at: i64,
    imported: Option<u32>,
    duplicates: Option<u32>,
    skipped: Option<u32>,
    message: Option<String>,
    #[serde(default)]
    balance_cents: Option<i64>,
    #[serde(default)]
    balance_date: Option<String>,
}

impl StoredOutcome {
    fn dto(&self) -> SyncOutcomeDto {
        let date_format = time::macros::format_description!("[year]-[month]-[day]");
        SyncOutcomeDto {
            ok: self.ok,
            at: self.at,
            imported: self.imported,
            duplicates: self.duplicates,
            skipped: self.skipped,
            message: self.message.clone(),
            balance_cents: self.balance_cents,
            balance_date: self
                .balance_date
                .as_deref()
                .and_then(|d| Date::parse(d, date_format).ok()),
        }
    }
}

// ----------------------------------------------------------------------------------------- the engine

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
        Self::get_str(state, conn, field)
            .await
            .and_then(|v| v.parse().ok())
    }

    pub(crate) async fn get_str(
        state: &AppState,
        conn: &BankConnection,
        field: &str,
    ) -> Option<String> {
        if conn.adhoc() {
            return None;
        }
        state
            .store
            .get_setting(&Self::key(conn, field))
            .await
            .ok()
            .flatten()
            .filter(|v| !v.is_empty())
    }

    pub(crate) async fn set(state: &AppState, conn: &BankConnection, field: &str, value: &str) {
        if conn.adhoc() {
            return;
        }
        if let Err(e) = state
            .store
            .set_setting(&Self::key(conn, field), value)
            .await
        {
            tracing::warn!(connection = %conn.name, "could not save {field}: {e}");
        }
    }

    // -- the stored credential of a provider you sign in to once

    fn access_field(kind: BankProvider) -> String {
        format!("{}_access", kind.as_str())
    }

    fn cursor_field(kind: BankProvider) -> String {
        format!("{}_cursor", kind.as_str())
    }

    fn accounts_field(kind: BankProvider) -> String {
        format!("{}_accounts", kind.as_str())
    }

    fn purpose(conn: &BankConnection) -> String {
        format!(
            "{}-access/{}",
            conn.kind.as_str(),
            conn.name.trim().to_lowercase()
        )
    }

    /// Has the once-only sign-in been done? Always true for providers that have none.
    async fn is_linked(state: &AppState, conn: &BankConnection) -> bool {
        !conn.kind.links_once()
            || Self::get_str(state, conn, &Self::access_field(conn.kind))
                .await
                .is_some()
    }

    async fn linked_accounts(state: &AppState, conn: &BankConnection) -> Vec<LinkedAccountDto> {
        Self::get_str(state, conn, &Self::accounts_field(conn.kind))
            .await
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default()
    }

    /// The credential, opened. `None` when there is none, or when it cannot be opened with this
    /// server secret (changed secret): then the connection counts as not linked.
    async fn credential(state: &AppState, conn: &BankConnection) -> Option<Zeroizing<String>> {
        let sealed = Self::get_str(state, conn, &Self::access_field(conn.kind)).await?;
        let secrets = state.secret_box.as_ref()?;
        match secrets.open(&Self::purpose(conn), &sealed) {
            Ok(c) => Some(c),
            Err(e) => {
                tracing::warn!(connection = %conn.name, "the stored {} access cannot be opened: {e}", conn.kind.label());
                None
            }
        }
    }

    async fn forget(state: &AppState, conn: &BankConnection) {
        for field in [
            Self::access_field(conn.kind),
            Self::cursor_field(conn.kind),
            Self::accounts_field(conn.kind),
        ] {
            Self::set(state, conn, &field, "").await;
        }
    }

    // -- messages

    fn section(kind: BankProvider) -> &'static str {
        match kind {
            BankProvider::Fints => "bank.fints_product_id",
            BankProvider::Plaid => "bank.plaid",
            BankProvider::GoCardless => "bank.gocardless",
            BankProvider::Finapi => "bank.finapi",
            BankProvider::Csv => "",
        }
    }

    fn not_configured(kind: BankProvider) -> ApiError {
        ApiError::Unavailable(match kind {
            BankProvider::Fints => "no FinTS product id is configured on the server (bank.fints_product_id in financer.toml, see docs/FINTS.md)".to_string(),
            _ => format!(
                "{} is not configured on the server ({} in financer.toml, see docs/BANK_PROVIDERS.md)",
                kind.label(),
                Self::section(kind)
            ),
        })
    }

    /// What to tell the person, and whether the bank refused the login (after which nothing
    /// retries by itself).
    fn explain(kind: BankProvider, e: &OpenError) -> (String, bool) {
        let label = kind.label();
        if e.needs_relink() {
            (
                "your bank wants you to sign in again: press Sync now to connect once more"
                    .to_string(),
                false,
            )
        } else if e.not_ready() {
            (
                format!("{label} is still reading your bank for the first time; try again in a few minutes"),
                false,
            )
        } else if e.bad_keys() {
            (
                format!(
                    "{label} refused the keys on the server ({} in financer.toml)",
                    Self::section(kind)
                ),
                false,
            )
        } else if e.rate_limited() {
            (
                format!("{label} allows only a few reads per day for this bank; try again later"),
                false,
            )
        } else {
            (e.to_string(), e.refused())
        }
    }

    fn api_error(kind: BankProvider, e: &OpenError) -> ApiError {
        let (text, _) = Self::explain(kind, e);
        let short = || text.chars().take(300).collect::<String>();
        match e {
            OpenError::NotConfigured(_) => ApiError::Unavailable(text),
            OpenError::Paused { .. } => ApiError::TooManyRequests(text),
            OpenError::Refused { .. } | OpenError::Rejected(_) | OpenError::LinkFailed { .. } => {
                ApiError::BadRequest(short())
            }
            _ if e.bad_keys() => ApiError::Unavailable(text),
            _ if e.rate_limited() => ApiError::TooManyRequests(text),
            _ => ApiError::BadGateway(short()),
        }
    }

    // -- helpers for the listing

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

    async fn auth_failed(state: &AppState, conn: &BankConnection) -> bool {
        Self::get_i64(state, conn, "auth_failed").await == Some(1)
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

    async fn stored_result(state: &AppState, conn: &BankConnection) -> Option<StoredOutcome> {
        Self::get_str(state, conn, "last_result")
            .await
            .and_then(|v| serde_json::from_str(&v).ok())
    }

    async fn dto(state: &AppState, conn: &BankConnection) -> BankConnectionDto {
        let now = Self::now();
        let (rt_state, rt_message, expires, link_url) = {
            let map = state.bank_connections.runtime.lock().await;
            map.get(&conn.id())
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
        let linked = Self::is_linked(state, conn).await;
        let auth_failed = Self::auth_failed(state, conn).await;
        let last_result = Self::stored_result(state, conn).await;
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
            && conn.kind.flow() == Flow::Approval
            && !pin_from_env
            && !auth_failed
            && state.providers.has(conn.kind)
            && shown_state == ConnectionState::Idle
            && next_sync_at.is_some_and(|t| t <= now);
        let date_format = time::macros::format_description!("[year]-[month]-[day]");
        BankConnectionDto {
            id: conn.id(),
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
            accounts: Self::linked_accounts(state, conn).await,
            sync_due,
            last_sync_at: Self::get_i64(state, conn, "last_sync_at").await,
            last_result: last_result.as_ref().map(StoredOutcome::dto),
            next_sync_at,
            balance_cents: Self::get_i64(state, conn, "balance_cents").await,
            balance_date: Self::get_str(state, conn, "balance_date")
                .await
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

    /// What a poller or a person sees of one sync.
    async fn sync_dto(state: &AppState, id: &str) -> Result<SyncDto, ApiError> {
        let id = id.trim().to_lowercase();
        let conn = state
            .bank_connections
            .list
            .iter()
            .find(|c| c.id() == id)
            .cloned();
        let rt = {
            let map = state.bank_connections.runtime.lock().await;
            map.get(&id).map(|r| {
                (
                    r.state,
                    r.message.clone(),
                    r.link_url.clone(),
                    r.approval_expires_at,
                    r.result.clone(),
                    r.session.is_some(),
                )
            })
        };
        let (kind, name, stored) = match &conn {
            Some(c) => (
                c.kind,
                Some(c.name.clone()),
                Self::stored_result(state, c).await,
            ),
            // an ad-hoc sync is FinTS, the only provider that takes a login in the request
            None if rt.is_some() => (BankProvider::Fints, None, None),
            None => return Err(ApiError::NotFound),
        };
        let (st, message, link_url, expires, result, _) = rt.unwrap_or_default();
        Ok(SyncDto {
            id,
            kind: kind.as_str().into(),
            connection: name,
            state: st,
            message,
            link_url,
            expires_at: expires,
            result: result.or(stored).map(|r| r.dto()),
        })
    }

    // -- starting

    /// Mark the connection as syncing, or refuse when it already is. Returns the number of this run.
    async fn begin_run(state: &AppState, conn: &BankConnection) -> Result<u64, ApiError> {
        let mut map = state.bank_connections.runtime.lock().await;
        let rt = map.entry(conn.id()).or_default();
        if matches!(
            rt.state,
            ConnectionState::Syncing | ConnectionState::NeedsApproval | ConnectionState::NeedsLink
        ) {
            return Err(ApiError::Conflict(
                "a sync for this connection is already running".into(),
            ));
        }
        rt.run += 1;
        rt.state = ConnectionState::Syncing;
        rt.message = None;
        rt.approval_expires_at = None;
        rt.link_url = None;
        rt.session = None;
        rt.result = None;
        rt.finished_at = None;
        Ok(rt.run)
    }

    /// A run that was refused before anything happened: nothing to report.
    async fn release(state: &AppState, conn: &BankConnection, run: u64) {
        let mut map = state.bank_connections.runtime.lock().await;
        if conn.adhoc() {
            map.remove(&conn.id());
        } else if let Some(rt) = map.get_mut(&conn.id()).filter(|rt| rt.run == run) {
            rt.state = ConnectionState::Idle;
        }
    }

    /// Start a sync. Returns once the work runs in the background: poll [`BankSync::sync_dto`].
    pub(crate) async fn start(
        state: &AppState,
        conn: &BankConnection,
        typed_pin: Option<String>,
    ) -> Result<(), ApiError> {
        let flow = conn.kind.flow();
        if flow == Flow::File {
            return Err(ApiError::BadRequest(
                "a CSV import has nothing to sync: send the file to /v1/bank/import/csv".into(),
            ));
        }
        let Some(provider) = state.providers.get(conn.kind) else {
            return Err(Self::not_configured(conn.kind));
        };
        if flow == Flow::Link && state.secret_box.is_none() {
            return Err(ApiError::Unavailable(format!(
                "the server has no secret to keep the {} access safe (set FINANCER_SECRET_KEY, at least 16 characters)",
                conn.kind.label()
            )));
        }
        let pin = if flow == Flow::Approval {
            Some(
                typed_pin
                    .filter(|p| !p.is_empty())
                    .or_else(|| Self::pin_from_env(state, conn))
                    .ok_or_else(|| {
                        ApiError::BadRequest(match &conn.pin_env {
                            _ if conn.adhoc() => "blz, user_id, pin and iban are required".into(),
                            Some(var) => format!(
                                "enter your PIN: the environment variable {var} is not set on the server"
                            ),
                            None => "enter your PIN (this connection has no pin_env in financer.toml)".into(),
                        })
                    })?,
            )
        } else {
            None
        };

        let run = Self::begin_run(state, conn).await?;
        Self::set(state, conn, "last_attempt_at", &Self::now().to_string()).await;

        // a stored credential reads straight away; without one, the provider starts a sign-in
        let handle = if flow == Flow::Link {
            if let Some(credential) = Self::credential(state, conn).await {
                Self::spawn_sync(state.clone(), conn.clone(), run, credential)
            } else {
                match Self::begin(state, conn, run, &*provider, None).await {
                    Ok(h) => h,
                    Err(e) => return Self::begin_failed(state, conn, run, e).await,
                }
            }
        } else {
            match Self::begin(state, conn, run, &*provider, pin).await {
                Ok(h) => h,
                Err(e) => return Self::begin_failed(state, conn, run, e).await,
            }
        };
        let mut map = state.bank_connections.runtime.lock().await;
        match map.get_mut(&conn.id()) {
            Some(rt) if rt.run == run && rt.state != ConnectionState::Idle => {
                rt.abort = Some(handle);
            }
            // finished already, or cancelled in the meantime
            _ => handle.abort(),
        }
        Ok(())
    }

    async fn begin_failed(
        state: &AppState,
        conn: &BankConnection,
        run: u64,
        e: OpenError,
    ) -> Result<(), ApiError> {
        tracing::warn!(connection = %conn.name, "could not start the {} sync: {e}", conn.kind.label());
        let api = Self::api_error(conn.kind, &e);
        if e.paused() || conn.adhoc() {
            // nothing happened worth recording
            Self::release(state, conn, run).await;
        } else {
            let (text, refused) = Self::explain(conn.kind, &e);
            Self::finish(state, conn, run, Err((text, refused))).await;
        }
        Err(api)
    }

    /// Ask the provider to begin, show what the person has to do, and wait for it in the
    /// background.
    async fn begin(
        state: &AppState,
        conn: &BankConnection,
        run: u64,
        provider: &dyn financer_openbanking::Provider,
        pin: Option<String>,
    ) -> Result<AbortHandle, OpenError> {
        let request = BeginRequest {
            reference: conn.name.clone(),
            institution: conn.institution.clone(),
            days: Self::days(state, conn).await,
            login: pin.map(|pin| Login {
                blz: conn.bank_code.clone(),
                user_id: conn.login.clone(),
                pin,
                iban: conn.iban.clone(),
                bic: conn.bic.clone().unwrap_or_default(),
                fints_url: conn.fints_url.clone(),
            }),
        };
        let step = provider.begin(&request).await?;
        let (session, wait, delay) = match step {
            Step::Link {
                url,
                session,
                expires_at,
            } => {
                let at = expires_at
                    .unwrap_or_else(|| Self::now() + 1800)
                    .min(Self::now() + MAX_LINK_WAIT);
                if !Self::show(state, conn, run, &session, |rt| {
                    rt.state = ConnectionState::NeedsLink;
                    rt.message = Some(format!(
                        "Sign in to your bank on the {} page; this screen updates when you are done.",
                        conn.kind.label()
                    ));
                    rt.link_url = Some(url);
                    rt.approval_expires_at = Some(at);
                })
                .await
                {
                    provider.cancel(&session).await;
                    return Ok(tokio::spawn(async {}).abort_handle());
                }
                (session, Wait::Until(at), state.connection_poll)
            }
            Step::Approval {
                message, session, ..
            } => {
                let at = Self::now() + state.sync_ttl.as_secs() as i64;
                // publish the state before the poller can finish, so it cannot be overwritten
                if !Self::show(state, conn, run, &session, |rt| {
                    rt.state = ConnectionState::NeedsApproval;
                    rt.message = Some(message);
                    rt.approval_expires_at = Some(at);
                })
                .await
                {
                    provider.cancel(&session).await;
                    return Ok(tokio::spawn(async {}).abort_handle());
                }
                (session, Wait::For(state.sync_ttl), state.connection_poll)
            }
            Step::Fetching { session } => {
                if !Self::show(state, conn, run, &session, |_| {}).await {
                    provider.cancel(&session).await;
                    return Ok(tokio::spawn(async {}).abort_handle());
                }
                (session, Wait::For(state.sync_ttl), Duration::ZERO)
            }
        };
        Ok(Self::spawn_poller(
            state.clone(),
            conn.clone(),
            run,
            session,
            wait,
            delay,
        ))
    }

    /// Change what the runtime shows, unless this run was cancelled in the meantime.
    async fn show(
        state: &AppState,
        conn: &BankConnection,
        run: u64,
        session: &str,
        change: impl FnOnce(&mut Runtime),
    ) -> bool {
        let mut map = state.bank_connections.runtime.lock().await;
        match map.get_mut(&conn.id()).filter(|rt| rt.run == run) {
            Some(rt) => {
                rt.session = Some(session.to_string());
                change(rt);
                true
            }
            None => false,
        }
    }

    /// Wait for the person (the approval, or the sign-in), then fetch and import. Ends in `idle`
    /// or `error`.
    fn spawn_poller(
        state: AppState,
        conn: BankConnection,
        run: u64,
        session: String,
        wait: Wait,
        first_delay: Duration,
    ) -> AbortHandle {
        tokio::spawn(async move {
            let Some(provider) = state.providers.get(conn.kind) else {
                return;
            };
            let started = Instant::now();
            tokio::time::sleep(first_delay).await;
            loop {
                let expired = match wait {
                    Wait::For(ttl) => started.elapsed() > ttl,
                    Wait::Until(at) => Self::now() > at,
                };
                if expired {
                    provider.cancel(&session).await;
                    let message = match wait {
                        Wait::For(_) => "the approval in your banking app did not arrive in time; start the sync again",
                        Wait::Until(_) => "the sign-in page expired; press Sync now to start again",
                    };
                    Self::finish(&state, &conn, run, Err((message.to_string(), false))).await;
                    return;
                }
                match provider.poll(&session).await {
                    Ok(Poll::Waiting) => tokio::time::sleep(state.connection_poll).await,
                    Ok(Poll::Linked { credential }) => {
                        Self::finish_link(&state, &conn, run, Zeroizing::new(credential)).await;
                        return;
                    }
                    Ok(Poll::Data(data)) => {
                        let outcome = Self::import(&state, &conn, data).await;
                        Self::finish(&state, &conn, run, outcome).await;
                        return;
                    }
                    Err(e) => {
                        let (text, refused) = Self::explain(conn.kind, &e);
                        Self::finish(&state, &conn, run, Err((text, refused))).await;
                        return;
                    }
                }
            }
        })
        .abort_handle()
    }

    /// The sign-in is done: keep the credential (sealed) and read the transactions.
    async fn finish_link(
        state: &AppState,
        conn: &BankConnection,
        run: u64,
        credential: Zeroizing<String>,
    ) {
        let Some(secrets) = state.secret_box.as_ref() else {
            let text = "no server secret to keep the access safe".to_string();
            Self::finish(state, conn, run, Err((text, false))).await;
            return;
        };
        let sealed = match secrets.seal(&Self::purpose(conn), &credential) {
            Ok(s) => s,
            Err(e) => {
                let text = format!("could not keep the access safe: {e}");
                Self::finish(state, conn, run, Err((text, false))).await;
                return;
            }
        };
        Self::set(state, conn, &Self::access_field(conn.kind), &sealed).await;
        // a new link starts reading from the beginning; rows already imported are skipped
        Self::set(state, conn, &Self::cursor_field(conn.kind), "").await;
        {
            let mut map = state.bank_connections.runtime.lock().await;
            match map.get_mut(&conn.id()) {
                Some(rt) if rt.run == run => {
                    rt.state = ConnectionState::Syncing;
                    rt.message = None;
                    rt.link_url = None;
                    rt.approval_expires_at = None;
                }
                _ => return,
            }
        }
        Self::sync_with(state, conn, run, &credential).await;
    }

    fn spawn_sync(
        state: AppState,
        conn: BankConnection,
        run: u64,
        credential: Zeroizing<String>,
    ) -> AbortHandle {
        tokio::spawn(async move {
            Self::sync_with(&state, &conn, run, &credential).await;
        })
        .abort_handle()
    }

    /// Read with a stored credential, import, and only then save the cursor.
    async fn sync_with(state: &AppState, conn: &BankConnection, run: u64, credential: &str) {
        let Some(provider) = state.providers.get(conn.kind) else {
            let text = format!("{} is not configured", conn.kind.label());
            Self::finish(state, conn, run, Err((text, false))).await;
            return;
        };
        let days = Self::days(state, conn).await;
        let since = OffsetDateTime::now_utc().date() - time::Duration::days(i64::from(days));
        let cursor = Self::get_str(state, conn, &Self::cursor_field(conn.kind)).await;
        let fetched = provider
            .fetch(&FetchRequest {
                credential: credential.to_string(),
                account_ids: conn.account_ids.clone(),
                since,
                cursor,
            })
            .await;
        let out = match fetched {
            Ok(out) => out,
            Err(e) => {
                let (text, refused) = Self::explain(conn.kind, &e);
                if e.needs_relink() {
                    Self::forget(state, conn).await;
                }
                tracing::warn!(connection = %conn.name, "{} sync failed: {e}", conn.kind.label());
                Self::finish(state, conn, run, Err((text, refused))).await;
                return;
            }
        };
        let next_cursor = out.next_cursor.clone();
        let shown: Vec<LinkedAccountDto> = out
            .accounts
            .iter()
            .map(|a| LinkedAccountDto {
                id: a.id.clone(),
                name: a.name.clone(),
                mask: a.mask.clone(),
                kind: a.kind.clone(),
            })
            .collect();
        if let Ok(json) = serde_json::to_string(&shown) {
            Self::set(state, conn, &Self::accounts_field(conn.kind), &json).await;
        }
        let imported = Self::import(state, conn, out).await;
        if let (Ok(_), Some(next)) = (&imported, next_cursor) {
            Self::set(state, conn, &Self::cursor_field(conn.kind), &next).await;
        }
        Self::finish(state, conn, run, imported).await;
    }

    // -- importing

    /// Categorize bank transactions like a CSV import and store the ones not seen before.
    /// Returns (imported, duplicates); syncing the same period twice imports nothing new.
    pub(crate) async fn store_transactions(
        state: &AppState,
        mut txs: Vec<financer_core::Transaction>,
    ) -> Result<(usize, usize), financer_store::StoreError> {
        let categorizer = state.store.categorizer().await?;
        for tx in &mut txs {
            tx.category = Some(categorizer.categorize(tx));
        }
        let imported = state.store.insert_new_transactions(&txs).await?;
        Ok((imported, txs.len() - imported))
    }

    pub(crate) async fn import(
        state: &AppState,
        conn: &BankConnection,
        data: Fetched,
    ) -> Result<StoredOutcome, (String, bool)> {
        let skipped = data.skipped;
        let (imported, duplicates) = Self::store_transactions(state, data.transactions)
            .await
            .map_err(|e| {
                tracing::error!(connection = %conn.name, "could not save synced transactions: {e}");
                ("the transactions could not be saved".to_string(), false)
            })?;
        if let Some(b) = data.balance {
            Self::set(state, conn, "balance_cents", &b.cents().to_string()).await;
        }
        if let Some(d) = data.balance_date {
            Self::set(state, conn, "balance_date", &d.to_string()).await;
        }
        if conn.adhoc() {
            Self::remember_login(state, conn, &data.balance, data.balance_date).await;
        }
        Ok(StoredOutcome {
            ok: true,
            at: Self::now(),
            imported: Some(imported as u32),
            duplicates: Some(duplicates as u32),
            skipped: Some(skipped as u32),
            message: None,
            balance_cents: data.balance.map(|b| b.cents()),
            balance_date: data.balance_date.map(|d| d.to_string()),
        })
    }

    /// The non-secret details of a login that was sent with the request, to prefill the form next
    /// time (`GET /v1/bank/status`).
    async fn remember_login(
        state: &AppState,
        conn: &BankConnection,
        balance: &Option<financer_core::Money>,
        balance_date: Option<Date>,
    ) {
        let store = &state.store;
        let bic = conn.bic.clone().unwrap_or_default();
        let mut pairs = vec![
            ("bank_blz", conn.bank_code.clone()),
            ("bank_user_id", conn.login.clone()),
            ("bank_iban", conn.iban.clone()),
            ("bank_bic", bic),
            ("bank_last_sync_at", Self::now().to_string()),
        ];
        if let Some(b) = balance {
            pairs.push(("bank_balance_cents", b.cents().to_string()));
        }
        if let Some(d) = balance_date {
            pairs.push(("bank_balance_date", d.to_string()));
        }
        for (key, value) in pairs {
            if let Err(e) = store.set_setting(key, &value).await {
                tracing::warn!("could not save {key}: {e}");
            }
        }
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
                    balance_cents: None,
                    balance_date: None,
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
        if let Some(rt) = map.get_mut(&conn.id()) {
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
                rt.session = None;
                rt.finished_at = Some(Self::now());
                rt.result = Some(stored);
            }
        }
    }

    // -- cancelling and forgetting

    /// Give up on a sync that is waiting for an approval or a sign-in.
    pub(crate) async fn cancel(state: &AppState, id: &str) -> Result<(), ApiError> {
        let id = id.trim().to_lowercase();
        let known = state.bank_connections.list.iter().find(|c| c.id() == id);
        let session = {
            let mut map = state.bank_connections.runtime.lock().await;
            let Some(rt) = map.get_mut(&id) else {
                return if known.is_some() {
                    Ok(())
                } else {
                    Err(ApiError::NotFound)
                };
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
                    rt.session.take()
                }
                ConnectionState::Syncing => {
                    return Err(ApiError::Conflict(
                        "the sync is logging in or fetching right now; wait a moment".into(),
                    ))
                }
                _ => None,
            }
        };
        if let Some(session) = session {
            let kind = known.map_or(BankProvider::Fints, |c| c.kind);
            if let Some(provider) = state.providers.get(kind) {
                provider.cancel(&session).await;
            }
        }
        Ok(())
    }

    /// Forget the connection: tell the provider, delete the credential, stop anything running.
    pub(crate) async fn disconnect(state: &AppState, name: &str) -> Result<(), ApiError> {
        let conn = state
            .bank_connections
            .find(name)
            .ok_or(ApiError::NotFound)?
            .clone();
        if !conn.kind.links_once() {
            return Err(ApiError::BadRequest(
                "a FinTS connection stores nothing to forget; only Plaid, GoCardless and finAPI connections can be disconnected"
                    .into(),
            ));
        }
        {
            let mut map = state.bank_connections.runtime.lock().await;
            if let Some(rt) = map.get_mut(&conn.id()) {
                if let Some(handle) = rt.abort.take() {
                    handle.abort();
                }
                rt.run += 1;
                rt.state = ConnectionState::Idle;
                rt.message = None;
                rt.approval_expires_at = None;
                rt.link_url = None;
                rt.session = None;
            }
        }
        if let (Some(credential), Some(provider)) = (
            Self::credential(state, &conn).await,
            state.providers.get(conn.kind),
        ) {
            if let Err(e) = provider.revoke(&credential).await {
                // still forget it here: the provider drops unused access on its own
                tracing::warn!(connection = %conn.name, "{} did not confirm removing the access: {e}", conn.kind.label());
            }
        }
        Self::forget(state, &conn).await;
        Self::set(state, &conn, "last_result", "").await;
        Ok(())
    }

    /// Drop the ad-hoc syncs that are over for a while, and the ones still open when a new one
    /// starts (only one login waits at a time).
    async fn tidy_adhoc(state: &AppState, replace_open: bool) {
        let now = Self::now();
        let mut sessions = Vec::new();
        {
            let mut map = state.bank_connections.runtime.lock().await;
            map.retain(|key, rt| {
                if !key.starts_with('~') {
                    return true;
                }
                let open = matches!(
                    rt.state,
                    ConnectionState::Syncing
                        | ConnectionState::NeedsApproval
                        | ConnectionState::NeedsLink
                );
                if open && replace_open {
                    if let Some(handle) = rt.abort.take() {
                        handle.abort();
                    }
                    sessions.extend(rt.session.take());
                    return false;
                }
                open || rt.finished_at.is_none_or(|t| now - t < ADHOC_KEEP)
            });
        }
        if let Some(provider) = state.providers.get(BankProvider::Fints) {
            for session in sessions {
                provider.cancel(&session).await;
            }
        }
    }

    // -- the scheduler

    /// Start every connection whose schedule is due and that can start by itself. Returns how many
    /// were started. A connection whose login was refused is left alone until you sync it by
    /// hand, so a wrong PIN in the environment cannot lock your online banking.
    pub async fn run_due(state: &AppState) -> usize {
        let now = Self::now();
        let mut started = 0;
        for conn in &state.bank_connections.list {
            if conn.sync_every_hours == 0 || !state.providers.has(conn.kind) {
                continue;
            }
            match conn.kind.flow() {
                Flow::File => continue,
                // needs a PIN from the environment, and no refusal before
                Flow::Approval => {
                    if Self::pin_from_env(state, conn).is_none()
                        || Self::auth_failed(state, conn).await
                    {
                        continue;
                    }
                }
                // needs no PIN and no approval, so a linked connection syncs by itself; one that
                // is not linked yet waits for you to start a sync
                Flow::Link => {
                    if !Self::is_linked(state, conn).await {
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
            match Self::start(state, conn, None).await {
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

    // -- the routes' logic

    async fn start_request(state: &AppState, req: SyncInput) -> Result<String, ApiError> {
        if let Some(name) = req.connection.as_deref().filter(|n| !n.trim().is_empty()) {
            let conn = state
                .bank_connections
                .find(name)
                .ok_or(ApiError::NotFound)?
                .clone();
            Self::start(state, &conn, req.pin).await?;
            return Ok(conn.id());
        }
        let kind = req
            .kind
            .as_deref()
            .and_then(ProviderKind::parse)
            .ok_or_else(|| {
                ApiError::BadRequest(
                    "name a connection, or a kind with a login (kind \"fints\")".into(),
                )
            })?;
        if kind != BankProvider::Fints {
            return Err(ApiError::BadRequest(format!(
                "{} needs a connection from the server configuration (Server settings, Bank accounts); only FinTS takes a login in the request",
                kind.label()
            )));
        }
        let login = req.login.ok_or_else(|| {
            ApiError::BadRequest("blz, user_id, pin and iban are required".into())
        })?;
        let conn = BankConnection {
            name: format!("~{}", uuid::Uuid::new_v4()),
            kind,
            account_ids: Vec::new(),
            institution: None,
            bank_code: login.blz.trim().to_string(),
            login: login.user_id.trim().to_string(),
            iban: login.iban.split_whitespace().collect(),
            bic: login
                .bic
                .filter(|b| !b.trim().is_empty())
                .map(|b| b.trim().to_string()),
            fints_url: login.fints_url.filter(|u| !u.trim().is_empty()),
            pin_env: None,
            sync_every_hours: 0,
            since_days: Some(req.days.unwrap_or(DEFAULT_SINCE_DAYS).clamp(1, MAX_DAYS)),
        };
        Self::tidy_adhoc(state, true).await;
        Self::start(state, &conn, req.pin).await?;
        Ok(conn.id())
    }

    async fn providers(state: &AppState) -> Vec<ProviderDto> {
        ProviderKind::ALL
            .into_iter()
            .map(|kind| ProviderDto {
                kind: kind.as_str().into(),
                label: kind.label().into(),
                flow: match kind.flow() {
                    Flow::File => "file",
                    Flow::Approval => "approval",
                    Flow::Link => "link",
                }
                .into(),
                available: state.providers.has(kind),
                connections: state
                    .bank_connections
                    .list
                    .iter()
                    .filter(|c| c.kind == kind)
                    .count() as u32,
            })
            .collect()
    }

    async fn import_file(
        state: &AppState,
        kind: &str,
        body: Bytes,
    ) -> Result<FileImportDto, ApiError> {
        let kind = ProviderKind::parse(kind).ok_or(ApiError::NotFound)?;
        if kind.flow() != Flow::File {
            return Err(ApiError::BadRequest(format!(
                "{} does not take a file: start a sync instead",
                kind.label()
            )));
        }
        let provider = state
            .providers
            .get(kind)
            .ok_or_else(|| Self::not_configured(kind))?;
        let parsed = provider
            .import(&body)
            .await
            .map_err(|e| Self::api_error(kind, &e))?;
        let (imported, duplicates) = Self::store_transactions(state, parsed.transactions).await?;
        Ok(FileImportDto {
            imported,
            duplicates,
            skipped: parsed
                .skipped
                .into_iter()
                .map(|s| SkippedRowDto {
                    line: s.line,
                    reason: s.reason,
                })
                .collect(),
        })
    }

    async fn status(state: &AppState) -> Result<BankStatusDto, ApiError> {
        let store = &state.store;
        let date_format = time::macros::format_description!("[year]-[month]-[day]");
        Ok(BankStatusDto {
            configured: state.providers.has(BankProvider::Fints),
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
                .and_then(|v| Date::parse(&v, date_format).ok()),
            blz: store.get_setting("bank_blz").await?,
            user_id: store.get_setting("bank_user_id").await?,
            iban: store.get_setting("bank_iban").await?,
            bic: store.get_setting("bank_bic").await?,
        })
    }
}

/// How long the engine waits for the person.
#[derive(Clone, Copy)]
enum Wait {
    /// This long from now (an approval in the banking app).
    For(Duration),
    /// Until this Unix time (a sign-in page).
    Until(i64),
}

// ------------------------------------------------------------------------------------------- routes

/// The ways transactions come in (a CSV file, FinTS, Plaid, GoCardless, finAPI), how each works, and
/// whether this server has it set up.
#[utoipa::path(get, path = "/v1/bank/providers", responses((status = 200, body = Vec<ProviderDto>)), security(("bearer" = [])))]
pub async fn list_providers(State(state): State<AppState>) -> Json<Vec<ProviderDto>> {
    Json(BankSync::providers(&state).await)
}

/// The bank connections from `financer.toml`, with the state of each. The login is masked and no
/// secret is part of the answer.
#[utoipa::path(get, path = "/v1/bank/connections", responses((status = 200, body = Vec<BankConnectionDto>)), security(("bearer" = [])))]
pub async fn list_connections(
    State(state): State<AppState>,
) -> Result<Json<Vec<BankConnectionDto>>, ApiError> {
    BankSync::list(state).await
}

/// Start a sync, whichever provider: name a `connection` of the server configuration, or for FinTS
/// a `kind` with a `login`. The server logs in or asks the provider for a sign-in page, then waits
/// in the background for what the person has to do (`state` is `needs_approval` or `needs_link`)
/// and imports as soon as it is done. Poll `GET /v1/bank/sync/{id}`. Send the PIN only when the
/// connection has no `pin_from_env`.
#[utoipa::path(post, path = "/v1/bank/sync", request_body = SyncInput, responses(
    (status = 200, body = SyncDto),
    (status = 400, description = "PIN or login missing or refused by the bank, a kind that needs a connection", body = ErrorBody),
    (status = 404, description = "No such connection", body = ErrorBody),
    (status = 409, description = "Already running", body = ErrorBody),
    (status = 429, description = "Paused after wrong PINs", body = ErrorBody),
    (status = 502, description = "Could not reach the bank or the provider", body = ErrorBody),
    (status = 503, description = "The provider is not set up on the server", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn start_sync(
    State(state): State<AppState>,
    Json(req): Json<SyncInput>,
) -> Result<Json<SyncDto>, ApiError> {
    let id = BankSync::start_request(&state, req).await?;
    Ok(Json(BankSync::sync_dto(&state, &id).await?))
}

/// Where a sync stands: waiting for an approval or a sign-in, running, or how it ended (`result`).
/// A connection can be asked by its name; an unknown or expired login answers 404.
#[utoipa::path(get, path = "/v1/bank/sync/{id}", params(("id" = String, Path, description = "`id` of a connection or of a started sync")), responses(
    (status = 200, body = SyncDto),
    (status = 404, description = "Unknown or expired sync", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn get_sync(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SyncDto>, ApiError> {
    Ok(Json(BankSync::sync_dto(&state, &id).await?))
}

/// Stop waiting for an approval or a sign-in.
#[utoipa::path(post, path = "/v1/bank/sync/{id}/cancel", params(("id" = String, Path, description = "`id` of a connection or of a started sync")), responses(
    (status = 200, body = SyncDto),
    (status = 404, description = "Unknown or expired sync", body = ErrorBody),
    (status = 409, description = "Logging in or fetching right now", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn cancel_sync(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SyncDto>, ApiError> {
    BankSync::cancel(&state, &id).await?;
    Ok(Json(BankSync::sync_dto(&state, &id).await?))
}

/// Plaid, GoCardless, finAPI: forget the connection. Tells the provider to drop it and deletes the
/// stored access, so the next sync starts with signing in again. The imported transactions stay.
#[utoipa::path(post, path = "/v1/bank/connections/{name}/disconnect", params(("name" = String, Path, description = "connection name")), responses(
    (status = 200, body = BankConnectionDto),
    (status = 400, description = "A FinTS connection has nothing to forget", body = ErrorBody),
    (status = 404, description = "No such connection", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn disconnect_connection(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<BankConnectionDto>, ApiError> {
    BankSync::disconnect(&state, &name).await?;
    let conn = state
        .bank_connections
        .find(&name)
        .ok_or(ApiError::NotFound)?;
    Ok(Json(BankSync::dto(&state, conn).await))
}

/// Import a file of a provider with the `file` flow (`csv`: the Sparkasse CSV-CAMT export).
/// Transactions are categorized, and rows that were imported before are skipped, so uploading an
/// overlapping period is safe.
#[utoipa::path(
    post,
    path = "/v1/bank/import/{kind}",
    params(("kind" = String, Path, description = "`csv`")),
    request_body(content = String, content_type = "text/csv"),
    responses(
        (status = 200, description = "Import finished", body = FileImportDto),
        (status = 400, description = "Not a file this provider reads", body = ErrorBody),
        (status = 404, description = "Unknown provider", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn import_file(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    body: Bytes,
) -> Result<Json<FileImportDto>, ApiError> {
    Ok(Json(BankSync::import_file(&state, &kind, body).await?))
}

/// What the last login sent with a request looked like (its non-secret details), to prefill the form.
#[utoipa::path(get, path = "/v1/bank/status", responses((status = 200, body = BankStatusDto)), security(("bearer" = [])))]
pub async fn bank_status(State(state): State<AppState>) -> Result<Json<BankStatusDto>, ApiError> {
    Ok(Json(BankSync::status(&state).await?))
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
            institution: None,
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
