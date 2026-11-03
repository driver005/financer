//! GoCardless and finAPI as providers of a bank connection (`kind = "gocardless"` and
//! `kind = "finapi"`). Both are open banking aggregators that work like Plaid does for the app:
//!
//! 1. **Link, once.** Pressing "Sync now" on a connection that is not linked asks the provider for
//!    a sign-in page (the state is `needs_link`, with `link_url`); you pick your bank and sign in
//!    there, and the server polls until the provider reports the session finished. The credential
//!    the provider hands over is kept sealed with the server secret (never in the clear, never in
//!    logs).
//! 2. **Sync, whenever.** With a credential, a sync reads the accounts, the balance and the
//!    bookings of the last days and imports them with the same de-duplication as a CSV import. A
//!    linked connection with `sync_every_hours` syncs on schedule by itself.
//! 3. **Sign in again.** When the consent has run out (GoCardless: about 90 days) the credential
//!    is dropped; press Sync now to link once more.

use std::sync::Arc;

use financer_fints::BankData;
use financer_openbanking::{
    FetchRequest, LinkPoll, LinkProvider, LinkRequest, LinkedAccount, OpenError,
};
use tokio::task::AbortHandle;
use zeroize::Zeroizing;

use crate::bank_connections::{
    BankConnection, BankProvider, BankSync, ConnectionState, StoredOutcome,
};
use crate::bank_plaid::LinkedAccountDto;
use crate::routes::ApiError;
use crate::AppState;

const DEFAULT_SINCE_DAYS: u32 = 90;
/// The longest a sign-in page is waited for.
const MAX_LINK_WAIT: i64 = 3600;

/// How the server talks to one aggregator, set once from `[bank.gocardless]` / `[bank.finapi]`.
pub struct OpenSetup {
    pub provider: Arc<dyn LinkProvider>,
    pub language: String,
    pub redirect_uri: Option<String>,
}

pub struct BankOpen;

impl BankOpen {
    const ACCESS: &'static str = "open_access";
    const ACCOUNTS: &'static str = "open_accounts";

    fn setup(state: &AppState, kind: BankProvider) -> Option<Arc<OpenSetup>> {
        match kind {
            BankProvider::GoCardless => state.gocardless.clone(),
            BankProvider::Finapi => state.finapi.clone(),
            _ => None,
        }
    }

    fn label(kind: BankProvider) -> &'static str {
        match kind {
            BankProvider::GoCardless => "GoCardless",
            _ => "finAPI",
        }
    }

    fn section(kind: BankProvider) -> &'static str {
        match kind {
            BankProvider::GoCardless => "bank.gocardless",
            _ => "bank.finapi",
        }
    }

    fn purpose(conn: &BankConnection) -> String {
        format!(
            "{}-access/{}",
            conn.kind.as_str(),
            conn.name.trim().to_lowercase()
        )
    }

    pub(crate) async fn is_linked(state: &AppState, conn: &BankConnection) -> bool {
        BankSync::get_str(state, conn, Self::ACCESS).await.is_some()
    }

    pub(crate) async fn linked_accounts(
        state: &AppState,
        conn: &BankConnection,
    ) -> Vec<LinkedAccountDto> {
        BankSync::get_str(state, conn, Self::ACCOUNTS)
            .await
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default()
    }

    async fn credential(state: &AppState, conn: &BankConnection) -> Option<Zeroizing<String>> {
        let sealed = BankSync::get_str(state, conn, Self::ACCESS).await?;
        let secrets = state.secret_box.as_ref()?;
        match secrets.open(&Self::purpose(conn), &sealed) {
            Ok(c) => Some(c),
            Err(e) => {
                tracing::warn!(connection = %conn.name, "the stored {} access cannot be opened: {e}", Self::label(conn.kind));
                None
            }
        }
    }

    /// What to tell the user, and whether the sign-in has to be done again.
    fn explain(kind: BankProvider, e: &OpenError) -> (String, bool) {
        let label = Self::label(kind);
        if e.needs_relink() {
            (
                "your bank access ran out or was withdrawn: press Sync now to connect once more"
                    .to_string(),
                true,
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
            (e.to_string(), false)
        }
    }

    fn api_error(kind: BankProvider, e: &OpenError) -> ApiError {
        let (text, _) = Self::explain(kind, e);
        match e {
            _ if e.bad_keys() => ApiError::Unavailable(text),
            OpenError::LinkFailed { .. } => ApiError::BadRequest(text),
            _ if e.rate_limited() => ApiError::TooManyRequests(text),
            _ => ApiError::BadGateway(text.chars().take(300).collect()),
        }
    }

    fn not_configured(kind: BankProvider) -> ApiError {
        ApiError::Unavailable(format!(
            "{} is not configured on the server ({} in financer.toml, see docs/BANK_PROVIDERS.md)",
            Self::label(kind),
            Self::section(kind)
        ))
    }

    /// Link (first time) or sync (afterwards). Returns once the work runs in the background.
    pub(crate) async fn start(state: &AppState, conn: &BankConnection) -> Result<(), ApiError> {
        let Some(setup) = Self::setup(state, conn.kind) else {
            return Err(Self::not_configured(conn.kind));
        };
        if state.secret_box.is_none() {
            return Err(ApiError::Unavailable(format!(
                "the server has no secret to keep the {} access safe (set FINANCER_SECRET_KEY, at least 16 characters)",
                Self::label(conn.kind)
            )));
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

        let handle = match Self::credential(state, conn).await {
            Some(credential) => Self::spawn_sync(state.clone(), conn.clone(), run, credential),
            None => match Self::begin_link(state, conn, &setup, run).await {
                Ok(handle) => handle,
                Err(e) => {
                    BankSync::finish(state, conn, run, Err((e.message(), false))).await;
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

    async fn begin_link(
        state: &AppState,
        conn: &BankConnection,
        setup: &Arc<OpenSetup>,
        run: u64,
    ) -> Result<AbortHandle, ApiError> {
        let start = setup
            .provider
            .begin(&LinkRequest {
                reference: conn.name.clone(),
                institution: conn.institution.clone(),
                language: setup.language.clone(),
                days: conn.since_days.unwrap_or(DEFAULT_SINCE_DAYS),
                redirect_uri: setup.redirect_uri.clone(),
            })
            .await
            .map_err(|e| {
                tracing::warn!(connection = %conn.name, "could not start the {} sign-in: {e}", Self::label(conn.kind));
                Self::api_error(conn.kind, &e)
            })?;
        let expires_at = start
            .expires_at
            .unwrap_or_else(|| BankSync::now() + 1800)
            .min(BankSync::now() + MAX_LINK_WAIT);
        {
            let mut map = state.bank_connections.runtime.lock().await;
            match map.get_mut(&conn.name.to_lowercase()) {
                Some(rt) if rt.run == run => {
                    rt.state = ConnectionState::NeedsLink;
                    rt.message = Some(format!(
                        "Sign in to your bank on the {} page; this screen updates when you are done.",
                        Self::label(conn.kind)
                    ));
                    rt.link_url = Some(start.url.clone());
                    rt.approval_expires_at = Some(expires_at);
                }
                // cancelled while asking the provider
                _ => return Ok(tokio::spawn(async {}).abort_handle()),
            }
        }
        Ok(Self::spawn_link_poller(
            state.clone(),
            conn.clone(),
            run,
            start.session,
            expires_at,
        ))
    }

    fn spawn_link_poller(
        state: AppState,
        conn: BankConnection,
        run: u64,
        session: String,
        expires_at: i64,
    ) -> AbortHandle {
        tokio::spawn(async move {
            let Some(setup) = Self::setup(&state, conn.kind) else {
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
                match setup.provider.poll(&session).await {
                    Ok(LinkPoll::Waiting) => continue,
                    Ok(LinkPoll::Done { credential }) => {
                        Self::finish_link(&state, &conn, run, Zeroizing::new(credential)).await;
                        return;
                    }
                    Err(e) => {
                        let (text, _) = Self::explain(conn.kind, &e);
                        BankSync::finish(&state, &conn, run, Err((text, false))).await;
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
            BankSync::finish(
                state,
                conn,
                run,
                Err(("no server secret to keep the access safe".into(), false)),
            )
            .await;
            return;
        };
        let sealed = match secrets.seal(&Self::purpose(conn), &credential) {
            Ok(s) => s,
            Err(e) => {
                BankSync::finish(
                    state,
                    conn,
                    run,
                    Err((format!("could not keep the access safe: {e}"), false)),
                )
                .await;
                return;
            }
        };
        BankSync::set(state, conn, Self::ACCESS, &sealed).await;
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

    async fn sync_with(state: &AppState, conn: &BankConnection, run: u64, credential: &str) {
        let Some(setup) = Self::setup(state, conn.kind) else {
            BankSync::finish(
                state,
                conn,
                run,
                Err((
                    format!("{} is not configured", Self::label(conn.kind)),
                    false,
                )),
            )
            .await;
            return;
        };
        let days = BankSync::days(state, conn).await;
        let since = time::OffsetDateTime::now_utc().date() - time::Duration::days(i64::from(days));
        let fetched = setup
            .provider
            .fetch(&FetchRequest {
                credential: credential.to_string(),
                account_ids: conn.account_ids.clone(),
                since,
            })
            .await;
        let out = match fetched {
            Ok(out) => out,
            Err(e) => {
                let (text, relink) = Self::explain(conn.kind, &e);
                if relink {
                    Self::forget(state, conn).await;
                }
                tracing::warn!(connection = %conn.name, "{} sync failed: {e}", Self::label(conn.kind));
                BankSync::finish(state, conn, run, Err((text, false))).await;
                return;
            }
        };
        let shown: Vec<LinkedAccountDto> = out
            .accounts
            .iter()
            .map(|a: &LinkedAccount| LinkedAccountDto {
                id: a.id.clone(),
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
        BankSync::finish(state, conn, run, imported).await;
    }

    async fn forget(state: &AppState, conn: &BankConnection) {
        for field in [Self::ACCESS, Self::ACCOUNTS] {
            BankSync::set(state, conn, field, "").await;
        }
    }

    /// Forget the connection: tell the provider, delete the credential, stop anything running.
    pub(crate) async fn disconnect(
        state: &AppState,
        conn: &BankConnection,
    ) -> Result<(), ApiError> {
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
        if let (Some(credential), Some(setup)) = (
            Self::credential(state, conn).await,
            Self::setup(state, conn.kind),
        ) {
            if let Err(e) = setup.provider.revoke(&credential).await {
                // still forget it here: the provider drops unused access on its own
                tracing::warn!(connection = %conn.name, "{} did not confirm removing the access: {e}", Self::label(conn.kind));
            }
        }
        Self::forget(state, conn).await;
        BankSync::set(state, conn, "last_result", "").await;
        Ok(())
    }
}
