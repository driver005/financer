//! Plaid as a bank connection provider.
//!
//! Plaid works differently from FinTS: there is no PIN and no approval per sync. You sign in to
//! your bank once on Plaid's own page ("hosted link"), the server swaps the result for an access
//! token and keeps that (sealed), and from then on it reads new transactions by cursor whenever
//! it is asked. All network access goes through [`crate::OpenHttp`], so tests run without a
//! network.

pub mod client;
pub mod map;
pub mod types;

use async_trait::async_trait;

pub use client::{PlaidClient, PlaidConfig, PlaidEnvironment};
pub use types::{
    AccountBalance, Exchange, LinkRequest, LinkSession, LinkToken, SyncOutcome, SyncRequest,
};

use crate::types::{BeginRequest, FetchRequest, Fetched, LinkedAccount, Poll, ProviderKind, Step};
use crate::{OpenError, Provider};

/// Plaid behind the unified [`Provider`] trait.
pub struct PlaidProvider {
    client: PlaidClient,
    country_codes: Vec<String>,
    language: String,
    redirect_uri: Option<String>,
}

impl PlaidProvider {
    pub fn new(
        client: PlaidClient,
        country_codes: Vec<String>,
        language: String,
        redirect_uri: Option<String>,
    ) -> Self {
        Self {
            client,
            country_codes,
            language,
            redirect_uri,
        }
    }

    pub fn environment(&self) -> PlaidEnvironment {
        self.client.environment()
    }
}

#[async_trait]
impl Provider for PlaidProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Plaid
    }

    async fn begin(&self, req: &BeginRequest) -> Result<Step, OpenError> {
        let link = self
            .client
            .create_link_token(&LinkRequest {
                user_id: req.reference.trim().to_lowercase(),
                country_codes: self.country_codes.clone(),
                language: self.language.clone(),
                days_requested: req.days,
                completion_redirect_uri: self.redirect_uri.clone(),
            })
            .await?;
        Ok(Step::Link {
            url: link.hosted_link_url,
            session: link.token,
            expires_at: link.expires_at,
        })
    }

    async fn poll(&self, session: &str) -> Result<Poll, OpenError> {
        match self.client.link_session(session).await? {
            LinkSession::Waiting => Ok(Poll::Waiting),
            LinkSession::Finished { public_token } => {
                let exchanged = self.client.exchange(&public_token).await?;
                Ok(Poll::Linked {
                    credential: exchanged.access_token,
                })
            }
        }
    }

    async fn fetch(&self, req: &FetchRequest) -> Result<Fetched, OpenError> {
        let out = self
            .client
            .sync(&SyncRequest {
                access_token: req.credential.clone(),
                cursor: req.cursor.clone(),
                account_ids: req.account_ids.clone(),
            })
            .await?;
        if out.modified > 0 || out.removed > 0 {
            tracing::info!(
                modified = out.modified,
                removed = out.removed,
                "Plaid reported changes to earlier transactions; they are not changed here"
            );
        }
        Ok(Fetched {
            balance: out.balance,
            balance_date: out.balance_date,
            transactions: out.transactions,
            skipped: out.skipped,
            accounts: out
                .accounts
                .into_iter()
                .map(|a| LinkedAccount {
                    id: a.account_id,
                    name: a.name,
                    mask: a.mask,
                    kind: a.kind,
                })
                .collect(),
            next_cursor: Some(out.next_cursor),
        })
    }

    async fn revoke(&self, credential: &str) -> Result<(), OpenError> {
        self.client.remove_item(credential).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::testing::FakeHttp;
    use financer_core::Money;

    fn provider(fake: FakeHttp) -> (PlaidProvider, Arc<FakeHttp>) {
        let fake = Arc::new(fake);
        let client = PlaidClient::new(
            PlaidConfig::new("cid".into(), "secret".into(), PlaidEnvironment::Sandbox),
            fake.clone(),
        );
        (
            PlaidProvider::new(client, vec!["DE".into()], "de".into(), None),
            fake,
        )
    }

    #[tokio::test]
    async fn link_poll_and_fetch_follow_the_unified_flow() {
        let (p, _) = provider(
            FakeHttp::new()
                .answer("POST /link/token/create", 200, r#"{"link_token":"lt","hosted_link_url":"https://secure.plaid.com/hl/x","expiration":"2099-01-01T00:00:00Z"}"#)
                .answer("POST /link/token/get", 200, r#"{"link_sessions":[]}"#)
                .answer("POST /link/token/get", 200, r#"{"link_sessions":[{"results":{"item_add_results":[{"public_token":"pub"}]}}]}"#)
                .answer("POST /item/public_token/exchange", 200, r#"{"access_token":"acc","item_id":"i"}"#)
                .answer("POST /transactions/sync", 200, r#"{"added":[{"account_id":"a1","amount":12.94,"iso_currency_code":"EUR","date":"2026-10-14","name":"Lidl","pending":false}],"modified":[],"removed":[],"next_cursor":"c1","has_more":false}"#)
                .answer("POST /accounts/get", 200, r#"{"accounts":[{"account_id":"a1","name":"Giro","mask":"0000","type":"depository","balances":{"current":10.0,"iso_currency_code":"EUR"}}]}"#),
        );
        assert_eq!(p.kind(), ProviderKind::Plaid);
        let begin = BeginRequest {
            reference: "Giro".into(),
            days: 60,
            ..Default::default()
        };
        let Step::Link { url, session, .. } = p.begin(&begin).await.unwrap() else {
            panic!("a link");
        };
        assert_eq!(url, "https://secure.plaid.com/hl/x");
        assert_eq!(p.poll(&session).await.unwrap(), Poll::Waiting);
        let Poll::Linked { credential } = p.poll(&session).await.unwrap() else {
            panic!("linked");
        };
        assert_eq!(credential, "acc");
        let got = p
            .fetch(&FetchRequest {
                credential,
                account_ids: vec![],
                since: time::macros::date!(2026 - 01 - 01),
                cursor: None,
            })
            .await
            .unwrap();
        assert_eq!(got.transactions.len(), 1);
        assert_eq!(got.transactions[0].amount.cents(), -1294);
        assert_eq!(got.next_cursor.as_deref(), Some("c1"));
        assert_eq!(got.balance, Some(Money::from_cents(1000)));
        assert_eq!(got.accounts[0].name, "Giro");
    }
}
