//! The Kaufland Card source: starting and finishing the sign-in, keeping the refresh token, and
//! importing new receipts.

use std::time::{Duration, Instant};

use financer_store::Store;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::config::SourceKind;
use crate::error::SyncError;
use crate::ingest::{Ingest, Stored};
use crate::lidl::pkce::{parse_callback, Pkce};
use crate::lidl::Tokens;
use crate::secret::SecretBox;
use crate::summary::RunSummary;

use super::client::{KauflandClient, MAX_PAGES};
use super::consts::{PAGE_SIZE, SIGN_IN_TTL_SECS};
use super::transaction::Transaction;
use super::KauflandError;

pub use crate::lidl::service::Connection;

const PURPOSE: &str = "kaufland_card/refresh_token";
const SOURCE: &str = "kaufland_card";
/// New receipts stored per run; older ones follow on the next run.
const MAX_NEW_PER_RUN: usize = 200;
/// Sign-ins that may wait for their browser at once.
const MAX_PENDING: usize = 5;

/// What the app needs to send the user to Kaufland's page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartInfo {
    pub authorization_url: String,
    pub state: String,
    /// Scheme the app watches for (`com.kaufland.kaufland`).
    pub callback_scheme: String,
    pub redirect_uri: String,
    pub expires_in_secs: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct KauflandState {
    needs_signin: bool,
    connected_at: Option<i64>,
    /// The customer id the receipt API wants in its path.
    user_id: Option<String>,
}

pub struct KauflandCard {
    store: Store,
    secrets: SecretBox,
    client: KauflandClient,
    pending: Mutex<Vec<(Pkce, Instant)>>,
    /// Short-lived access token, memory only.
    access: Mutex<Option<(String, Instant)>>,
}

impl KauflandCard {
    pub fn new(store: Store, secrets: SecretBox, client: KauflandClient) -> Self {
        KauflandCard {
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
    pub async fn start(&self) -> Result<StartInfo, KauflandError> {
        let pkce = Pkce::generate()?;
        let ep = &self.client.endpoints;
        let url = ep.authorize_address(&pkce)?;
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

    /// Finish a sign-in with the address Kaufland's page redirected to. Only the refresh token
    /// (and the customer id) is kept, the token encrypted.
    pub async fn finish(&self, state: &str, callback_url: &str) -> Result<(), KauflandError> {
        let pkce = {
            let mut pending = self.pending.lock().await;
            let ttl = Duration::from_secs(SIGN_IN_TTL_SECS);
            let pos = pending
                .iter()
                .position(|(p, at)| p.state == state && at.elapsed() < ttl)
                .ok_or(KauflandError::UnknownSignIn)?;
            pending.remove(pos).0
        };
        let code = parse_callback(
            callback_url,
            &pkce.state,
            &self.client.endpoints.redirect_uri,
        )?;
        let tokens = self.client.exchange_code(&code, &pkce.verifier).await?;
        let refresh = tokens.refresh_token.clone().ok_or_else(|| {
            KauflandError::BadResponse(
                "Kaufland sent no refresh token, so the sign-in cannot be kept".into(),
            )
        })?;
        let user_id = self.client.user_id(&tokens.access_token).await?;
        self.save_refresh_token(&refresh, Some(user_id))
            .await
            .map_err(|e| KauflandError::Internal(e.to_user_text()))?;
        self.remember_access(&tokens).await;
        Ok(())
    }

    async fn remember_access(&self, t: &Tokens) {
        let life = Duration::from_secs(t.expires_in.saturating_sub(60));
        *self.access.lock().await = Some((t.access_token.clone(), Instant::now() + life));
    }

    /// Keep the (possibly rotated) refresh token; `new_user_id` is given for a new sign-in only.
    async fn save_refresh_token(
        &self,
        token: &str,
        new_user_id: Option<String>,
    ) -> Result<(), SyncError> {
        let sealed = self
            .secrets
            .seal(PURPOSE, token)
            .map_err(|e| SyncError::other(e.to_string()))?;
        self.store.put_source_secret(SOURCE, Some(&sealed)).await?;
        let mut state = self.read_state().await?;
        state.needs_signin = false;
        if let Some(id) = new_user_id {
            state.user_id = Some(id);
            state.connected_at = Some(time::OffsetDateTime::now_utc().unix_timestamp());
        }
        self.write_state(&state).await
    }

    async fn write_state(&self, state: &KauflandState) -> Result<(), SyncError> {
        self.store
            .put_source_state(
                SOURCE,
                &serde_json::to_string(state).unwrap_or_else(|_| "{}".into()),
            )
            .await?;
        Ok(())
    }

    async fn read_state(&self) -> Result<KauflandState, SyncError> {
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
        self.write_state(&state).await?;
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
        let state: KauflandState = serde_json::from_str(&row.state).unwrap_or_default();
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
            Connection::Never => {
                return Err(SyncError::other(KauflandError::NotConnected.to_string()))
            }
            Connection::NeedsSignin => {
                return Err(SyncError::other(KauflandError::NeedsSignIn.to_string()))
            }
            Connection::Connected => self
                .refresh_token()
                .await?
                .ok_or_else(|| SyncError::other(KauflandError::NeedsSignIn.to_string()))?,
        };
        match self.client.refresh(&refresh).await {
            Ok(tokens) => {
                if let Some(rotated) = tokens.refresh_token.as_deref() {
                    if rotated != refresh.as_str() {
                        self.save_refresh_token(rotated, None).await?;
                    }
                }
                self.remember_access(&tokens).await;
                Ok(tokens.access_token)
            }
            Err(KauflandError::NeedsSignIn) => {
                self.mark_needs_signin().await?;
                Err(SyncError::other(KauflandError::NeedsSignIn.to_string()))
            }
            Err(e) => Err(SyncError::other(e.to_string())),
        }
    }

    /// Import receipts not seen before.
    pub async fn sync(&self) -> Result<RunSummary, SyncError> {
        let access = self.access_token().await?;
        let user_id = self
            .read_state()
            .await?
            .user_id
            .ok_or_else(|| SyncError::other(KauflandError::NeedsSignIn.to_string()))?;
        let mut summary = RunSummary::default();
        let mut stored_new = 0usize;
        'pages: for page in 0..MAX_PAGES {
            let list = match self.client.transactions_page(&access, &user_id, page).await {
                Ok(l) => l,
                Err(KauflandError::NeedsSignIn) => {
                    self.mark_needs_signin().await?;
                    return Err(SyncError::other(KauflandError::NeedsSignIn.to_string()));
                }
                Err(e) => return Err(SyncError::other(e.to_string())),
            };
            let short_page = list.len() < PAGE_SIZE;
            let mut any_new = false;
            for raw in &list {
                let tx = match Transaction::from_json(raw) {
                    Ok(t) => t,
                    Err(why) => {
                        summary.skipped += 1;
                        summary.note(format!("a receipt could not be read: {why}"));
                        continue;
                    }
                };
                if self.store.seen_outcome(SOURCE, &tx.id).await?.is_some() {
                    continue;
                }
                any_new = true;
                if stored_new >= MAX_NEW_PER_RUN {
                    summary.note("more receipts are waiting; they follow on the next run");
                    break 'pages;
                }
                stored_new += 1;
                let outcome = match tx.to_receipt() {
                    Ok(r) => {
                        match Ingest::store(&self.store, SourceKind::KauflandCard, &r).await? {
                            Stored::New(_) => {
                                summary.imported += 1;
                                "imported"
                            }
                            Stored::Duplicate => {
                                summary.duplicates += 1;
                                "duplicate"
                            }
                        }
                    }
                    Err(why) => {
                        summary.skipped += 1;
                        summary.note(format!("a receipt has no readable items ({why})"));
                        "unreadable"
                    }
                };
                self.store.mark_seen(SOURCE, &tx.id, outcome).await?;
            }
            // newest first: a whole page of known receipts means the rest is known too
            if short_page || !any_new {
                break;
            }
        }
        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::KauflandCardConfig;
    use crate::kaufland::client::Endpoints;
    use crate::lidl::http::Method;
    use crate::testing::{kaufland_fixtures as fx, FakeLidlHttp};
    use std::sync::Arc;

    struct Rig {
        http: Arc<FakeLidlHttp>,
        store: Store,
        card: KauflandCard,
    }

    async fn rig() -> Rig {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let http = Arc::new(FakeLidlHttp::default());
        let client = KauflandClient::new(
            http.clone(),
            Endpoints::from_config(&KauflandCardConfig::default()),
            Duration::ZERO,
        );
        let card = KauflandCard::new(
            store.clone(),
            SecretBox::new("0123456789abcdef0123456789abcdef").unwrap(),
            client,
        );
        Rig { http, store, card }
    }

    async fn sign_in(r: &Rig) {
        r.http
            .respond(Method::Post, "/token-srv/token", 200, fx::TOKEN);
        r.http
            .respond(Method::Get, "/users-srv/userinfo", 200, fx::USERINFO);
        let start = r.card.start().await.unwrap();
        r.card
            .finish(
                &start.state,
                &format!(
                    "com.kaufland.kaufland://oauth/callback?code=FIXTURECODE&state={}",
                    start.state
                ),
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn sign_in_stores_only_the_sealed_refresh_token_and_the_customer_id() {
        let r = rig().await;
        assert_eq!(r.card.connection().await.unwrap(), Connection::Never);
        let start = r.card.start().await.unwrap();
        assert!(start
            .authorization_url
            .starts_with("https://account.kaufland.com/authz-srv/authz?"));
        assert_eq!(start.callback_scheme, "com.kaufland.kaufland");
        assert_eq!(
            r.http.requests().len(),
            0,
            "starting sends nothing to Kaufland"
        );

        r.http
            .respond(Method::Post, "/token-srv/token", 200, fx::TOKEN);
        r.http
            .respond(Method::Get, "/users-srv/userinfo", 200, fx::USERINFO);
        r.card
            .finish(
                &start.state,
                "com.kaufland.kaufland://oauth/callback?code=FIXTURECODE",
            )
            .await
            .unwrap();
        assert_eq!(r.card.connection().await.unwrap(), Connection::Connected);
        assert!(r.card.connected_at().await.unwrap().is_some());

        let row = r
            .store
            .source_state("kaufland_card")
            .await
            .unwrap()
            .unwrap();
        let sealed = row.secret.unwrap();
        assert!(!sealed.contains("fixture-kaufland-refresh-1"));
        assert!(
            !row.state.contains("fixture-kaufland"),
            "no token in the state"
        );
        assert!(row.state.contains("user-4711"));
    }

    #[tokio::test]
    async fn a_wrong_state_or_a_second_finish_is_refused() {
        let r = rig().await;
        let start = r.card.start().await.unwrap();
        assert_eq!(
            r.card
                .finish(
                    "not-the-state",
                    "com.kaufland.kaufland://oauth/callback?code=C"
                )
                .await
                .unwrap_err(),
            KauflandError::UnknownSignIn
        );
        r.http
            .respond(Method::Post, "/token-srv/token", 200, fx::TOKEN);
        r.http
            .respond(Method::Get, "/users-srv/userinfo", 200, fx::USERINFO);
        r.card
            .finish(
                &start.state,
                "com.kaufland.kaufland://oauth/callback?code=C",
            )
            .await
            .unwrap();
        assert_eq!(
            r.card
                .finish(
                    &start.state,
                    "com.kaufland.kaufland://oauth/callback?code=C"
                )
                .await
                .unwrap_err(),
            KauflandError::UnknownSignIn
        );
    }

    #[tokio::test]
    async fn sync_imports_each_receipt_once_and_stops_at_the_known_ones() {
        let r = rig().await;
        sign_in(&r).await;
        r.http
            .respond(Method::Get, "start=0&", 200, fx::TRANSACTIONS_PAGE_1);
        let s = r.card.sync().await.unwrap();
        assert_eq!((s.imported, s.duplicates, s.skipped), (2, 0, 0));
        // the same list again: nothing new, and it does not read on
        let s = r.card.sync().await.unwrap();
        assert_eq!((s.imported, s.duplicates, s.skipped), (0, 0, 0));
        assert!(r
            .store
            .seen_outcome("kaufland_card", "tx-0001")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn a_refresh_that_rotates_the_token_replaces_it() {
        let r = rig().await;
        sign_in(&r).await;
        // force a refresh: forget the cached access token
        *r.card.access.lock().await = None;
        r.http
            .respond(Method::Post, "/token-srv/token", 200, fx::TOKEN_REFRESHED);
        r.http.respond(Method::Get, "start=0&", 200, "[]");
        r.card.sync().await.unwrap();
        let used = r
            .http
            .requests()
            .into_iter()
            .rfind(|q| q.url.contains("/token-srv/token"))
            .unwrap();
        let form: std::collections::HashMap<_, _> = used.form.iter().cloned().collect();
        assert_eq!(form["grant_type"], "refresh_token");
        assert_eq!(form["refresh_token"], "fixture-kaufland-refresh-1");
        let again = r.card.refresh_token().await.unwrap().unwrap();
        assert_eq!(again.as_str(), "fixture-kaufland-refresh-2");
    }

    #[tokio::test]
    async fn a_refused_refresh_asks_for_a_new_sign_in_and_disconnect_forgets_everything() {
        let r = rig().await;
        sign_in(&r).await;
        *r.card.access.lock().await = None;
        r.http.respond(
            Method::Post,
            "/token-srv/token",
            400,
            fx::TOKEN_INVALID_GRANT,
        );
        let err = r.card.sync().await.unwrap_err();
        assert!(err.to_user_text().contains("sign in again"));
        assert_eq!(r.card.connection().await.unwrap(), Connection::NeedsSignin);
        r.card.disconnect().await.unwrap();
        assert_eq!(r.card.connection().await.unwrap(), Connection::Never);
        assert!(r
            .store
            .source_state("kaufland_card")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn a_receipt_that_cannot_be_read_is_noted_and_not_tried_again() {
        let r = rig().await;
        sign_in(&r).await;
        r.http.respond(
            Method::Get,
            "start=0&",
            200,
            r#"[{"id":"empty-1","timestamp":"2026-03-01T10:00:00+01:00","positions":[]},{"noid":true}]"#,
        );
        let s = r.card.sync().await.unwrap();
        assert_eq!((s.imported, s.skipped), (0, 2));
        assert_eq!(
            r.store
                .seen_outcome("kaufland_card", "empty-1")
                .await
                .unwrap()
                .as_deref(),
            Some("unreadable")
        );
    }
}
