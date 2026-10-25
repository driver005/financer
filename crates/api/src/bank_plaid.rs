//! Plaid as the provider of a bank connection (`kind = "plaid"`).
//!
//! The flow differs from FinTS in one way: there is nothing to approve per sync.
//!
//! 1. **Link, once.** Pressing "Sync now" on a connection that is not linked starts a hosted link
//!    session: the server asks Plaid for a link token, the app opens Plaid's own page (the state is
//!    `needs_link`, with `link_url`), you sign in to your bank there, and the server polls until
//!    Plaid reports the session finished. It swaps the result for an access token and keeps that
//!    sealed with the server secret (never in the clear, never in logs).
//! 2. **Sync, whenever.** With a token, a sync reads what is new by cursor and imports it with the
//!    same de-duplication as a CSV import. The cursor is saved only after the import succeeded, so
//!    a failed import is read again, not skipped. A linked connection with `sync_every_hours`
//!    syncs on schedule by itself.
//! 3. **Sign in again.** When the bank wants a fresh login, the token is dropped and the
//!    connection is not linked any more; press Sync now to link once more.

use std::sync::Arc;

use financer_fints::BankData;
use financer_plaid::{LinkRequest, LinkSession, PlaidClient, PlaidError, SyncRequest};
use serde::{Deserialize, Serialize};
use tokio::task::AbortHandle;
use utoipa::ToSchema;
use zeroize::Zeroizing;

use crate::bank_connections::{BankConnection, BankSync, ConnectionState, StoredOutcome};
use crate::routes::ApiError;
use crate::AppState;

const DEFAULT_SINCE_DAYS: u32 = 90;

/// How the server talks to Plaid, set once from `[bank.plaid]`.
pub struct PlaidSetup {
    pub client: Arc<PlaidClient>,
    pub country_codes: Vec<String>,
    pub language: String,
    pub redirect_uri: Option<String>,
}

/// An account Plaid reported for a linked connection.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LinkedAccountDto {
    /// Put this in `account_ids` of the connection to read only some accounts.
    pub id: String,
    pub name: String,
    /// The last digits of the account number, when Plaid has them.
    pub mask: Option<String>,
    /// For example `depository` or `credit`.
    pub kind: String,
}

pub struct BankPlaid;

impl BankPlaid {
    const ACCESS: &'static str = "plaid_access";
    const CURSOR: &'static str = "plaid_cursor";
    const ITEM: &'static str = "plaid_item";
    const ACCOUNTS: &'static str = "plaid_accounts";

    fn purpose(conn: &BankConnection) -> String {
        format!("plaid-access/{}", conn.name.trim().to_lowercase())
    }

    /// Has the connection been linked (is there a stored access token)?
    pub(crate) async fn is_linked(state: &AppState, conn: &BankConnection) -> bool {
        BankSync::get_str(state, conn, Self::ACCESS).await.is_some()
    }

    /// The accounts of the last sync, for the connection list.
    pub(crate) async fn linked_accounts(
        state: &AppState,
        conn: &BankConnection,
    ) -> Vec<LinkedAccountDto> {
        BankSync::get_str(state, conn, Self::ACCOUNTS)
            .await
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default()
    }

    /// The access token, opened. `None` when there is none, or when it cannot be opened with
    /// this server secret (changed secret): then the connection counts as not linked.
    async fn token(state: &AppState, conn: &BankConnection) -> Option<Zeroizing<String>> {
        let sealed = BankSync::get_str(state, conn, Self::ACCESS).await?;
        let secrets = state.secret_box.as_ref()?;
        match secrets.open(&Self::purpose(conn), &sealed) {
            Ok(token) => Some(token),
            Err(e) => {
                tracing::warn!(connection = %conn.name, "the stored Plaid access cannot be opened: {e}");
                None
            }
        }
    }

    /// What to tell the user, and whether the bank needs a new sign-in, for a Plaid error.
    fn explain(e: &PlaidError) -> (String, bool) {
        if e.needs_relink() {
            (
                "your bank wants you to sign in again: press Sync now to connect once more"
                    .to_string(),
                true,
            )
        } else if e.not_ready() {
            (
                "Plaid is still reading your bank for the first time; try again in a few minutes"
                    .to_string(),
                false,
            )
        } else if e.bad_keys() {
            (
                "Plaid refused the keys on the server (bank.plaid in financer.toml)".to_string(),
                false,
            )
        } else {
            (e.to_string(), false)
        }
    }

    fn api_error(e: &PlaidError) -> ApiError {
        let (text, _) = Self::explain(e);
        match e {
            PlaidError::NotConfigured => ApiError::Unavailable(text),
            _ if e.bad_keys() => ApiError::Unavailable(text),
            _ => ApiError::BadGateway(text.chars().take(300).collect()),
        }
    }

    /// Link (first time) or sync (afterwards). Returns once the work runs in the background.
    pub(crate) async fn start(state: &AppState, conn: &BankConnection) -> Result<(), ApiError> {
        let Some(setup) = state.plaid.clone() else {
            return Err(ApiError::Unavailable(
                "Plaid is not configured on the server (bank.plaid in financer.toml, see docs/BANK_PROVIDERS.md)"
                    .into(),
            ));
        };
        if state.secret_box.is_none() {
            return Err(ApiError::Unavailable(
                "the server has no secret to keep the Plaid access safe (set FINANCER_SECRET_KEY, at least 16 characters)"
                    .into(),
            ));
        }
        let key = conn.name.to_lowercase();
        let run = {
            let mut map = state.bank_connections.runtime.lock().await;
            let rt = map.entry(key.clone()).or_default();
            if matches!(
                rt.state,
                ConnectionState::Syncing
                    | ConnectionState::NeedsApproval
                    | ConnectionState::NeedsLink
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
            rt.run
        };
        BankSync::set(state, conn, "last_attempt_at", &BankSync::now().to_string()).await;

        let handle = match Self::token(state, conn).await {
            Some(token) => Self::spawn_sync(state.clone(), conn.clone(), run, token),
            None => match Self::begin_link(state, conn, &setup, run).await {
                Ok(handle) => handle,
                Err(e) => {
                    let (text, _) = match &e {
                        ApiError::BadGateway(m) | ApiError::Unavailable(m) => (m.clone(), false),
                        other => (other.message(), false),
                    };
                    BankSync::finish(state, conn, run, Err((text, false))).await;
                    return Err(e);
                }
            },
        };
        let mut map = state.bank_connections.runtime.lock().await;
        match map.get_mut(&key) {
            Some(rt) if rt.run == run && rt.state != ConnectionState::Idle => {
                rt.abort = Some(handle);
            }
            // finished already, or cancelled in the meantime
            _ => handle.abort(),
        }
        Ok(())
    }

    /// Ask Plaid for a sign-in page and wait for you to finish it.
    async fn begin_link(
        state: &AppState,
        conn: &BankConnection,
        setup: &Arc<PlaidSetup>,
        run: u64,
    ) -> Result<AbortHandle, ApiError> {
        let link = setup
            .client
            .create_link_token(&LinkRequest {
                user_id: conn.name.trim().to_lowercase(),
                country_codes: setup.country_codes.clone(),
                language: setup.language.clone(),
                days_requested: conn.since_days.unwrap_or(DEFAULT_SINCE_DAYS),
                completion_redirect_uri: setup.redirect_uri.clone(),
            })
            .await
            .map_err(|e| {
                tracing::warn!(connection = %conn.name, "could not start the Plaid sign-in: {e}");
                Self::api_error(&e)
            })?;
        let expires_at = link
            .expires_at
            .unwrap_or_else(|| BankSync::now() + 1800)
            .min(BankSync::now() + 3600);
        {
            let mut map = state.bank_connections.runtime.lock().await;
            match map.get_mut(&conn.name.to_lowercase()) {
                Some(rt) if rt.run == run => {
                    rt.state = ConnectionState::NeedsLink;
                    rt.message = Some(
                        "Sign in to your bank on the Plaid page; this screen updates when you are done."
                            .into(),
                    );
                    rt.link_url = Some(link.hosted_link_url.clone());
                    rt.approval_expires_at = Some(expires_at);
                }
                // cancelled while asking Plaid
                _ => return Ok(tokio::spawn(async {}).abort_handle()),
            }
        }
        Ok(Self::spawn_link_poller(
            state.clone(),
            conn.clone(),
            run,
            link.token,
            expires_at,
        ))
    }

    fn spawn_link_poller(
        state: AppState,
        conn: BankConnection,
        run: u64,
        link_token: String,
        expires_at: i64,
    ) -> AbortHandle {
        tokio::spawn(async move {
            let Some(setup) = state.plaid.clone() else {
                return;
            };
            loop {
                tokio::time::sleep(state.connection_poll).await;
                if BankSync::now() > expires_at {
                    BankSync::finish(
                        &state,
                        &conn,
                        run,
                        Err((
                            "the sign-in page expired; press Sync now to start again".into(),
                            false,
                        )),
                    )
                    .await;
                    return;
                }
                match setup.client.link_session(&link_token).await {
                    Ok(LinkSession::Waiting) => continue,
                    Ok(LinkSession::Finished { public_token }) => {
                        Self::finish_link(&state, &conn, run, &setup.client, &public_token).await;
                        return;
                    }
                    Err(e) => {
                        let (text, _) = Self::explain(&e);
                        BankSync::finish(&state, &conn, run, Err((text, false))).await;
                        return;
                    }
                }
            }
        })
        .abort_handle()
    }

    /// The sign-in is done: keep the access token (sealed) and read the transactions.
    async fn finish_link(
        state: &AppState,
        conn: &BankConnection,
        run: u64,
        client: &PlaidClient,
        public_token: &str,
    ) {
        let exchanged = match client.exchange(public_token).await {
            Ok(x) => x,
            Err(e) => {
                let (text, _) = Self::explain(&e);
                BankSync::finish(state, conn, run, Err((text, false))).await;
                return;
            }
        };
        let access = Zeroizing::new(exchanged.access_token);
        let Some(secrets) = state.secret_box.as_ref() else {
            BankSync::finish(
                state,
                conn,
                run,
                Err((
                    "no server secret to keep the Plaid access safe".into(),
                    false,
                )),
            )
            .await;
            return;
        };
        let sealed = match secrets.seal(&Self::purpose(conn), &access) {
            Ok(s) => s,
            Err(e) => {
                BankSync::finish(
                    state,
                    conn,
                    run,
                    Err((format!("could not keep the Plaid access safe: {e}"), false)),
                )
                .await;
                return;
            }
        };
        BankSync::set(state, conn, Self::ACCESS, &sealed).await;
        BankSync::set(state, conn, Self::ITEM, &exchanged.item_id).await;
        // a new link starts reading from the beginning; rows already imported are skipped
        BankSync::set(state, conn, Self::CURSOR, "").await;
        {
            let mut map = state.bank_connections.runtime.lock().await;
            match map.get_mut(&conn.name.to_lowercase()) {
                Some(rt) if rt.run == run => {
                    rt.state = ConnectionState::Syncing;
                    rt.message = None;
                    rt.link_url = None;
                    rt.approval_expires_at = None;
                }
                _ => return,
            }
        }
        Self::sync_with_token(state, conn, run, &access).await;
    }

    fn spawn_sync(
        state: AppState,
        conn: BankConnection,
        run: u64,
        token: Zeroizing<String>,
    ) -> AbortHandle {
        tokio::spawn(async move {
            Self::sync_with_token(&state, &conn, run, &token).await;
        })
        .abort_handle()
    }

    /// Read what is new, import it, and only then save the cursor.
    async fn sync_with_token(state: &AppState, conn: &BankConnection, run: u64, token: &str) {
        let Some(setup) = state.plaid.clone() else {
            BankSync::finish(
                state,
                conn,
                run,
                Err(("Plaid is not configured".into(), false)),
            )
            .await;
            return;
        };
        let cursor = BankSync::get_str(state, conn, Self::CURSOR).await;
        let outcome = setup
            .client
            .sync(&SyncRequest {
                access_token: token.to_string(),
                cursor,
                account_ids: conn.account_ids.clone(),
            })
            .await;
        let out = match outcome {
            Ok(out) => out,
            Err(e) => {
                let (text, relink) = Self::explain(&e);
                if relink {
                    Self::forget(state, conn).await;
                }
                tracing::warn!(connection = %conn.name, "Plaid sync failed: {e}");
                BankSync::finish(state, conn, run, Err((text, false))).await;
                return;
            }
        };
        if out.modified > 0 || out.removed > 0 {
            tracing::info!(
                connection = %conn.name,
                modified = out.modified,
                removed = out.removed,
                "Plaid reported changes to earlier transactions; they are not changed here"
            );
        }
        let shown: Vec<LinkedAccountDto> = out
            .accounts
            .iter()
            .map(|a| LinkedAccountDto {
                id: a.account_id.clone(),
                name: a.name.clone(),
                mask: a.mask.clone(),
                kind: a.kind.clone(),
            })
            .collect();
        if let Ok(json) = serde_json::to_string(&shown) {
            BankSync::set(state, conn, Self::ACCOUNTS, &json).await;
        }
        let data = BankData {
            balance: out.balance,
            balance_date: out.balance_date,
            transactions: out.transactions,
            skipped: out.skipped,
        };
        let imported: Result<StoredOutcome, (String, bool)> =
            BankSync::import(state, conn, data).await;
        if imported.is_ok() {
            BankSync::set(state, conn, Self::CURSOR, &out.next_cursor).await;
        }
        BankSync::finish(state, conn, run, imported).await;
    }

    /// Drop the stored access (after the bank asked for a new sign-in, or on disconnect).
    async fn forget(state: &AppState, conn: &BankConnection) {
        for field in [Self::ACCESS, Self::CURSOR, Self::ITEM, Self::ACCOUNTS] {
            BankSync::set(state, conn, field, "").await;
        }
    }

    /// Forget the connection: tell Plaid, delete the token, stop anything running.
    pub(crate) async fn disconnect(state: &AppState, name: &str) -> Result<(), ApiError> {
        let conn = state
            .bank_connections
            .find(name)
            .ok_or(ApiError::NotFound)?
            .clone();
        if conn.kind != crate::bank_connections::BankProvider::Plaid {
            return Err(ApiError::BadRequest(
                "only a Plaid connection can be disconnected; a FinTS connection stores nothing to forget"
                    .into(),
            ));
        }
        {
            let mut map = state.bank_connections.runtime.lock().await;
            if let Some(rt) = map.get_mut(&conn.name.to_lowercase()) {
                if let Some(handle) = rt.abort.take() {
                    handle.abort();
                }
                rt.run += 1;
                rt.state = ConnectionState::Idle;
                rt.message = None;
                rt.approval_expires_at = None;
                rt.link_url = None;
            }
        }
        if let (Some(token), Some(setup)) = (Self::token(state, &conn).await, state.plaid.clone()) {
            if let Err(e) = setup.client.remove_item(&token).await {
                // still forget it here: Plaid drops unused items on its own
                tracing::warn!(connection = %conn.name, "Plaid did not confirm removing the item: {e}");
            }
        }
        Self::forget(state, &conn).await;
        BankSync::set(state, &conn, "last_result", "").await;
        Ok(())
    }
}
