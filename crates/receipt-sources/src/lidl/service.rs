//! The Lidl Plus source: starting and finishing the sign-in, keeping the refresh token, and
//! importing new tickets.

use std::time::{Duration, Instant};

use financer_store::Store;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::config::SourceKind;
use crate::error::SyncError;
use crate::ingest::{Ingest, Stored};
use crate::secret::SecretBox;
use crate::summary::RunSummary;

use super::client::{LidlClient, Tokens};
use super::consts::SIGN_IN_TTL_SECS;
use super::pkce::{parse_callback, AuthorizeUrl, Pkce};
use super::LidlError;

const PURPOSE: &str = "lidl_plus/refresh_token";
const SOURCE: &str = "lidl_plus";
/// Tickets fetched per run; older ones follow on the next run.
const MAX_TICKETS_PER_RUN: usize = 60;
/// Sign-ins that may wait for their browser at once.
const MAX_PENDING: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Connection {
    /// Never signed in, or disconnected.
    Never,
    Connected,
    /// A refresh token is stored but Lidl (or a changed server secret) no longer accepts it.
    NeedsSignin,
}

/// What the app needs to send the user to Lidl's page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartInfo {
    pub authorization_url: String,
    pub state: String,
    /// Scheme the app watches for (`com.lidlplus.app`).
    pub callback_scheme: String,
    pub redirect_uri: String,
    pub expires_in_secs: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LidlState {
    needs_signin: bool,
    connected_at: Option<i64>,
}

pub struct LidlPlus {
    store: Store,
    secrets: SecretBox,
    client: LidlClient,
    pending: Mutex<Vec<(Pkce, Instant)>>,
    /// Short-lived access token, memory only.
    access: Mutex<Option<(String, Instant)>>,
}

impl LidlPlus {
    pub fn new(store: Store, secrets: SecretBox, client: LidlClient) -> Self {
        LidlPlus {
            store,
            secrets,
            client,
            pending: Mutex::new(Vec::new()),
            access: Mutex::new(None),
        }
    }

    pub fn endpoints(&self) -> &super::client::Endpoints {
        &self.client.endpoints
    }

    /// Begin a sign-in. Nothing is sent anywhere: the address is for the user's own browser.
    pub async fn start(&self) -> Result<StartInfo, LidlError> {
        let pkce = Pkce::generate()?;
        let ep = &self.client.endpoints;
        let url = AuthorizeUrl {
            authorize_endpoint: &ep.authorize_url,
            client_id: &ep.client_id,
            redirect_uri: &ep.redirect_uri,
            scope: &ep.scope,
            country: &ep.country,
            language: &ep.language,
        }
        .build(&pkce)?;
        let ttl = Duration::from_secs(SIGN_IN_TTL_SECS);
        let mut pending = self.pending.lock().await;
        pending.retain(|(_, at)| at.elapsed() < ttl);
        while pending.len() >= MAX_PENDING {
            pending.remove(0);
        }
        let state = pkce.state.clone();
        pending.push((pkce, Instant::now()));
        Ok(StartInfo {
            authorization_url: url,
            state,
            callback_scheme: ep.callback_scheme(),
            redirect_uri: ep.redirect_uri.clone(),
            expires_in_secs: SIGN_IN_TTL_SECS,
        })
    }

    /// Finish a sign-in with the address Lidl's page redirected to. Only the refresh token is
    /// kept, encrypted.
    pub async fn finish(&self, state: &str, callback_url: &str) -> Result<(), LidlError> {
        let pkce = {
            let mut pending = self.pending.lock().await;
            let ttl = Duration::from_secs(SIGN_IN_TTL_SECS);
            let pos = pending
                .iter()
                .position(|(p, at)| p.state == state && at.elapsed() < ttl)
                .ok_or(LidlError::UnknownSignIn)?;
            pending.remove(pos).0
        };
        let code = parse_callback(callback_url, &pkce.state, &self.client.endpoints.redirect_uri)?;
        let tokens = self.client.exchange_code(&code, &pkce.verifier).await?;
        let refresh = tokens.refresh_token.clone().ok_or_else(|| {
            LidlError::BadResponse("Lidl sent no refresh token, so sign-in cannot be kept".into())
        })?;
        self.save_refresh_token(&refresh, true)
            .await
            .map_err(|e| LidlError::Internal(e.to_user_text()))?;
        self.remember_access(&tokens).await;
        Ok(())
    }

    async fn remember_access(&self, t: &Tokens) {
        let life = Duration::from_secs(t.expires_in.saturating_sub(60));
        *self.access.lock().await = Some((t.access_token.clone(), Instant::now() + life));
    }

    async fn save_refresh_token(&self, token: &str, new_sign_in: bool) -> Result<(), SyncError> {
        let sealed = self
            .secrets
            .seal(PURPOSE, token)
            .map_err(|e| SyncError::other(e.to_string()))?;
        self.store.put_source_secret(SOURCE, Some(&sealed)).await?;
        let mut state = self.read_state().await?;
        state.needs_signin = false;
        if new_sign_in {
            state.connected_at = Some(time::OffsetDateTime::now_utc().unix_timestamp());
        }
        self.store
            .put_source_state(
                SOURCE,
                &serde_json::to_string(&state).unwrap_or_else(|_| "{}".into()),
            )
            .await?;
        Ok(())
    }

    async fn read_state(&self) -> Result<LidlState, SyncError> {
        Ok(self
            .store
            .source_state(SOURCE)
            .await?
            .and_then(|s| serde_json::from_str(&s.state).ok())
            .unwrap_or_default())
    }

    async fn mark_needs_signin(&self) -> Result<(), SyncError> {
        let mut state = self.read_state().await?;
        state.needs_signin = true;
        self.store
            .put_source_state(
                SOURCE,
                &serde_json::to_string(&state).unwrap_or_else(|_| "{}".into()),
            )
            .await?;
        *self.access.lock().await = None;
        Ok(())
    }

    /// The decrypted refresh token, if one is stored and readable.
    async fn refresh_token(&self) -> Result<Option<zeroize::Zeroizing<String>>, SyncError> {
        let Some(row) = self.store.source_state(SOURCE).await? else {
            return Ok(None);
        };
        let Some(sealed) = row.secret else {
            return Ok(None);
        };
        Ok(self.secrets.open(PURPOSE, &sealed).ok())
    }

    pub async fn connection(&self) -> Result<Connection, SyncError> {
        let Some(row) = self.store.source_state(SOURCE).await? else {
            return Ok(Connection::Never);
        };
        let Some(sealed) = row.secret else {
            return Ok(Connection::Never);
        };
        let state: LidlState = serde_json::from_str(&row.state).unwrap_or_default();
        if state.needs_signin || self.secrets.open(PURPOSE, &sealed).is_err() {
            return Ok(Connection::NeedsSignin);
        }
        Ok(Connection::Connected)
    }

    pub async fn connected_at(&self) -> Result<Option<i64>, SyncError> {
        Ok(self.read_state().await?.connected_at)
    }

    /// Forget the token and everything the source remembered.
    pub async fn disconnect(&self) -> Result<(), SyncError> {
        self.store.delete_source_state(SOURCE).await?;
        *self.access.lock().await = None;
        self.pending.lock().await.clear();
        Ok(())
    }

    /// A usable access token: the cached one, or a fresh one from the refresh token.
    async fn access_token(&self) -> Result<String, SyncError> {
        if let Some((token, until)) = self.access.lock().await.as_ref() {
            if Instant::now() < *until {
                return Ok(token.clone());
            }
        }
        let refresh = match self.connection().await? {
            Connection::Never => return Err(SyncError::other(LidlError::NotConnected.to_string())),
            Connection::NeedsSignin => {
                return Err(SyncError::other(LidlError::NeedsSignIn.to_string()))
            }
            Connection::Connected => self
                .refresh_token()
                .await?
                .ok_or_else(|| SyncError::other(LidlError::NeedsSignIn.to_string()))?,
        };
        match self.client.refresh(&refresh).await {
            Ok(tokens) => {
                if let Some(rotated) = tokens.refresh_token.as_deref() {
                    if rotated != refresh.as_str() {
                        self.save_refresh_token(rotated, false).await?;
                    }
                }
                self.remember_access(&tokens).await;
                Ok(tokens.access_token)
            }
            Err(LidlError::NeedsSignIn) => {
                self.mark_needs_signin().await?;
                Err(SyncError::other(LidlError::NeedsSignIn.to_string()))
            }
            Err(e) => Err(SyncError::other(e.to_string())),
        }
    }

    /// Import tickets not seen before.
    pub async fn sync(&self) -> Result<RunSummary, SyncError> {
        let access = self.access_token().await?;
        let mut summary = RunSummary::default();
        let listed = match self.client.list_tickets(&access).await {
            Ok(l) => l,
            Err(LidlError::NeedsSignIn) => {
                self.mark_needs_signin().await?;
                return Err(SyncError::other(LidlError::NeedsSignIn.to_string()));
            }
            Err(e) => return Err(SyncError::other(e.to_string())),
        };
        let mut fetched = 0;
        for t in listed {
            if self.store.seen_outcome(SOURCE, &t.id).await?.is_some() {
                continue;
            }
            if fetched >= MAX_TICKETS_PER_RUN {
                summary.note("more tickets are waiting; they follow on the next run");
                break;
            }
            fetched += 1;
            let ticket = match self.client.ticket(&access, &t.id).await {
                Ok(t) => t,
                Err(LidlError::NeedsSignIn) => {
                    self.mark_needs_signin().await?;
                    return Err(SyncError::other(LidlError::NeedsSignIn.to_string()));
                }
                Err(LidlError::Status(404)) => {
                    self.store.mark_seen(SOURCE, &t.id, "missing").await?;
                    continue;
                }
                Err(LidlError::BadResponse(why)) => {
                    summary.skipped += 1;
                    summary.note(format!("a ticket could not be read: {why}"));
                    self.store.mark_seen(SOURCE, &t.id, "unreadable").await?;
                    continue;
                }
                Err(e) => return Err(SyncError::other(e.to_string())),
            };
            let outcome = match ticket.to_receipt() {
                Ok(r) => match Ingest::store(&self.store, SourceKind::LidlPlus, &r).await? {
                    Stored::New(_) => {
                        summary.imported += 1;
                        "imported"
                    }
                    Stored::Duplicate => {
                        summary.duplicates += 1;
                        "duplicate"
                    }
                },
                Err(why) => {
                    summary.skipped += 1;
                    summary.note(format!("a ticket has no readable items ({why})"));
                    "unreadable"
                }
            };
            self.store.mark_seen(SOURCE, &t.id, outcome).await?;
        }
        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::LidlPlusConfig;
    use crate::lidl::client::Endpoints;
    use crate::lidl::http::Method;
    use crate::testing::{lidl_fixtures as fx, FakeLidlHttp};
    use std::sync::Arc;

    struct Rig {
        http: Arc<FakeLidlHttp>,
        store: Store,
        lidl: LidlPlus,
    }

    async fn rig() -> Rig {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let http = Arc::new(FakeLidlHttp::default());
        let client = LidlClient::new(
            http.clone(),
            Endpoints::from_config(&LidlPlusConfig::default()),
            Duration::ZERO,
        );
        let lidl = LidlPlus::new(
            store.clone(),
            SecretBox::new("0123456789abcdef0123456789abcdef").unwrap(),
            client,
        );
        Rig { http, store, lidl }
    }

    async fn sign_in(r: &Rig) {
        r.http.respond(Method::Post, "/connect/token", 200, fx::TOKEN);
        let start = r.lidl.start().await.unwrap();
        r.lidl
            .finish(
                &start.state,
                &format!("com.lidlplus.app://callback?code=FIXTURECODE&state={}", start.state),
            )
            .await
            .unwrap();
    }

    fn serve_tickets(r: &Rig) {
        r.http.respond(Method::Get, "pageNumber=1", 200, fx::TICKETS_PAGE_1);
        r.http.respond(Method::Get, "pageNumber=2", 200, fx::TICKETS_PAGE_2);
        r.http.respond(Method::Get, "/tickets/FIXTURE-TICKET-0001", 200, fx::TICKET_1);
        r.http.respond(Method::Get, "/tickets/FIXTURE-TICKET-0002", 200, fx::TICKET_2);
        r.http.respond(Method::Get, "/tickets/FIXTURE-TICKET-0003", 200, fx::TICKET_3);
    }

    #[tokio::test]
    async fn sign_in_flow_stores_only_the_sealed_refresh_token() {
        let r = rig().await;
        assert_eq!(r.lidl.connection().await.unwrap(), Connection::Never);
        let start = r.lidl.start().await.unwrap();
        assert!(start.authorization_url.starts_with("https://accounts.lidl.com/connect/authorize?"));
        assert_eq!(start.callback_scheme, "com.lidlplus.app");
        assert_eq!(r.http.requests().len(), 0, "starting sends nothing to Lidl");

        r.http.respond(Method::Post, "/connect/token", 200, fx::TOKEN);
        r.lidl
            .finish(&start.state, "com.lidlplus.app://callback?code=FIXTURECODE")
            .await
            .unwrap();
        assert_eq!(r.lidl.connection().await.unwrap(), Connection::Connected);
        assert!(r.lidl.connected_at().await.unwrap().is_some());

        // the code was traded together with the verifier whose challenge went into the address
        let form: std::collections::HashMap<_, _> = r.http.requests()[0].form.iter().cloned().collect();
        assert_eq!(form["code"], "FIXTURECODE");
        let challenge = Pkce::challenge_of(&form["code_verifier"]);
        assert!(start.authorization_url.contains(&format!("code_challenge={challenge}")));

        // at rest: sealed, and neither token appears anywhere in the row
        let row = r.store.source_state("lidl_plus").await.unwrap().unwrap();
        let secret = row.secret.unwrap();
        assert!(secret.starts_with("v1."));
        for text in [secret.as_str(), row.state.as_str()] {
            assert!(!text.contains("fixture-refresh-token-1"));
            assert!(!text.contains("fixture-access-token-1"));
        }
    }

    #[tokio::test]
    async fn finish_refuses_unknown_reused_foreign_and_broken_sign_ins() {
        let r = rig().await;
        assert_eq!(
            r.lidl.finish("nope", "com.lidlplus.app://callback?code=A").await.unwrap_err(),
            LidlError::UnknownSignIn
        );
        let start = r.lidl.start().await.unwrap();
        // an address from another sign-in
        let e = r
            .lidl
            .finish(&start.state, "com.lidlplus.app://callback?code=A&state=other")
            .await
            .unwrap_err();
        assert!(matches!(e, LidlError::BadCallback(_)), "{e:?}");
        // a start is single-use, even after a failed finish
        assert_eq!(
            r.lidl.finish(&start.state, "com.lidlplus.app://callback?code=A").await.unwrap_err(),
            LidlError::UnknownSignIn
        );
        // Lidl's page reported an error
        let start = r.lidl.start().await.unwrap();
        let e = r
            .lidl
            .finish(&start.state, "com.lidlplus.app://callback?error=access_denied")
            .await
            .unwrap_err();
        assert!(matches!(e, LidlError::SignInRefused(_)));
        // the token endpoint refuses the code
        let start = r.lidl.start().await.unwrap();
        r.http.respond(Method::Post, "/connect/token", 400, fx::TOKEN_INVALID_GRANT);
        assert!(r.lidl.finish(&start.state, "com.lidlplus.app://callback?code=A").await.is_err());
        assert_eq!(r.lidl.connection().await.unwrap(), Connection::Never);
        // no refresh token in the answer: refused, nothing stored
        let start = r.lidl.start().await.unwrap();
        r.http.respond(
            Method::Post,
            "/connect/token",
            200,
            r#"{"access_token":"a","expires_in":10}"#,
        );
        let e = r.lidl.finish(&start.state, "com.lidlplus.app://callback?code=A").await.unwrap_err();
        assert!(matches!(e, LidlError::BadResponse(_)));
        assert_eq!(r.lidl.connection().await.unwrap(), Connection::Never);
    }

    #[tokio::test]
    async fn only_a_few_sign_ins_wait_at_once() {
        let r = rig().await;
        let first = r.lidl.start().await.unwrap();
        for _ in 0..MAX_PENDING {
            r.lidl.start().await.unwrap();
        }
        assert_eq!(
            r.lidl.finish(&first.state, "com.lidlplus.app://callback?code=A").await.unwrap_err(),
            LidlError::UnknownSignIn,
            "the oldest was dropped"
        );
    }

    #[tokio::test]
    async fn sync_imports_tickets_once_and_uses_the_access_token_from_sign_in() {
        let r = rig().await;
        sign_in(&r).await;
        serve_tickets(&r);
        let s = r.lidl.sync().await.unwrap();
        assert_eq!((s.imported, s.duplicates, s.skipped), (2, 0, 1), "{s:?}");
        let calls = r.http.requests();
        assert_eq!(calls.iter().filter(|c| c.url.contains("/connect/token")).count(), 1);

        let metas = r.store.receipt_metas().await.unwrap();
        assert_eq!(metas.len(), 2);
        assert!(metas.iter().all(|m| m.source == "lidl_plus" && m.retailer.as_deref() == Some("lidl")));
        let t1 = metas.iter().find(|m| m.total_cents == Some(565)).unwrap();
        assert_eq!(t1.time.as_deref(), Some("18:42"));

        // second run: the list is read again, but no ticket is fetched twice
        let before = r.http.requests().len();
        let s = r.lidl.sync().await.unwrap();
        assert_eq!((s.imported, s.skipped), (0, 0));
        let new_calls: Vec<_> = r.http.requests().into_iter().skip(before).collect();
        assert!(new_calls.iter().all(|c| c.url.contains("pageNumber")), "{new_calls:?}");
    }

    #[tokio::test]
    async fn expired_access_token_is_refreshed_and_a_rotated_token_replaces_the_old_one() {
        let r = rig().await;
        r.http.respond(
            Method::Post,
            "/connect/token",
            200,
            r#"{"access_token":"short","refresh_token":"fixture-refresh-token-1","expires_in":1}"#,
        );
        let start = r.lidl.start().await.unwrap();
        r.lidl.finish(&start.state, "com.lidlplus.app://callback?code=A").await.unwrap();
        serve_tickets(&r);
        r.http.respond(Method::Post, "/connect/token", 200, fx::TOKEN_REFRESHED);
        let s = r.lidl.sync().await.unwrap(); // access token lifetime is below the safety margin
        assert_eq!(s.imported, 2);
        let refresh = r.http.requests().into_iter().find(|c| c.form.iter().any(|(k, v)| k == "grant_type" && v == "refresh_token")).unwrap();
        assert!(refresh.form.iter().any(|(k, v)| k == "refresh_token" && v == "fixture-refresh-token-1"));
        let sealed = r.store.source_state("lidl_plus").await.unwrap().unwrap().secret.unwrap();
        let key = SecretBox::new("0123456789abcdef0123456789abcdef").unwrap();
        assert_eq!(key.open(PURPOSE, &sealed).unwrap().as_str(), "fixture-refresh-token-2");
    }

    #[tokio::test]
    async fn a_dead_refresh_token_means_sign_in_again_and_stays_that_way() {
        let r = rig().await;
        r.http.respond(
            Method::Post,
            "/connect/token",
            200,
            r#"{"access_token":"short","refresh_token":"fixture-refresh-token-1","expires_in":1}"#,
        );
        let start = r.lidl.start().await.unwrap();
        r.lidl.finish(&start.state, "com.lidlplus.app://callback?code=A").await.unwrap();
        r.http.respond(Method::Post, "/connect/token", 400, fx::TOKEN_INVALID_GRANT);
        let e = r.lidl.sync().await.unwrap_err().to_string();
        assert!(e.contains("sign in again"), "{e}");
        assert_eq!(r.lidl.connection().await.unwrap(), Connection::NeedsSignin);
        // no more requests until the user signs in again
        let n = r.http.requests().len();
        assert!(r.lidl.sync().await.is_err());
        assert_eq!(r.http.requests().len(), n);
        // signing in again repairs it
        sign_in(&r).await;
        assert_eq!(r.lidl.connection().await.unwrap(), Connection::Connected);
    }

    #[tokio::test]
    async fn a_changed_server_secret_reads_as_needs_signin() {
        let r = rig().await;
        sign_in(&r).await;
        let other = LidlPlus::new(
            r.store.clone(),
            SecretBox::new("a-completely-different-secret!!").unwrap(),
            LidlClient::new(r.http.clone(), Endpoints::from_config(&LidlPlusConfig::default()), Duration::ZERO),
        );
        assert_eq!(other.connection().await.unwrap(), Connection::NeedsSignin);
        assert!(other.sync().await.is_err());
    }

    #[tokio::test]
    async fn disconnect_forgets_the_token_and_what_was_seen() {
        let r = rig().await;
        sign_in(&r).await;
        serve_tickets(&r);
        r.lidl.sync().await.unwrap();
        r.lidl.disconnect().await.unwrap();
        assert_eq!(r.lidl.connection().await.unwrap(), Connection::Never);
        assert!(r.store.source_state("lidl_plus").await.unwrap().is_none());
        assert!(r.store.seen_outcome("lidl_plus", "FIXTURE-TICKET-0001").await.unwrap().is_none());
        assert!(r.lidl.sync().await.is_err());
        // imported receipts stay
        assert_eq!(r.store.receipt_metas().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn server_trouble_midway_keeps_progress_and_reports() {
        let r = rig().await;
        sign_in(&r).await;
        r.http.respond(Method::Get, "pageNumber=1", 200, fx::TICKETS_PAGE_1);
        r.http.respond(Method::Get, "pageNumber=2", 200, fx::TICKETS_PAGE_2);
        r.http.respond(Method::Get, "/tickets/FIXTURE-TICKET-0001", 200, fx::TICKET_1);
        r.http.respond(Method::Get, "/tickets/FIXTURE-TICKET-0002", 500, "");
        let e = r.lidl.sync().await.unwrap_err().to_string();
        assert!(e.contains("500"), "{e}");
        assert_eq!(r.store.receipt_metas().await.unwrap().len(), 1, "the first ticket was kept");
        // next run continues with the rest
        r.http.respond(Method::Get, "/tickets/FIXTURE-TICKET-0002", 200, fx::TICKET_2);
        r.http.respond(Method::Get, "/tickets/FIXTURE-TICKET-0003", 404, "");
        let s = r.lidl.sync().await.unwrap();
        assert_eq!(s.imported, 1);
    }
}
