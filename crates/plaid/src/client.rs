use std::fmt;
use std::sync::Arc;

use financer_core::Money;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use time::{Date, OffsetDateTime};
use zeroize::Zeroizing;

use crate::error::{ApiError, PlaidError};
use crate::http::PlaidHttp;
use crate::map::{map_transaction, Mapped};
use crate::types::*;

const PAGE_SIZE: u32 = 500;
/// Plaid asks to start paging again from the saved cursor when the data changes underneath.
const MAX_RESTARTS: u32 = 3;
const MAX_PAGES: u32 = 200;
const CLIENT_NAME: &str = "Financer";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PlaidEnvironment {
    /// Plaid's test bank ("user_good" / "pass_good"): no real account involved.
    #[default]
    Sandbox,
    Production,
}

impl PlaidEnvironment {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "sandbox" => Some(Self::Sandbox),
            "production" => Some(Self::Production),
            _ => None,
        }
    }

    pub fn base_url(self) -> &'static str {
        match self {
            Self::Sandbox => "https://sandbox.plaid.com",
            Self::Production => "https://production.plaid.com",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Sandbox => "sandbox",
            Self::Production => "production",
        }
    }
}

#[derive(Clone)]
pub struct PlaidConfig {
    pub client_id: String,
    pub secret: Zeroizing<String>,
    pub environment: PlaidEnvironment,
    /// For tests and proxies; leave `None` to use the environment's address.
    pub base_url: Option<String>,
}

impl PlaidConfig {
    /// The server's setup: the real address of `environment`.
    pub fn new(client_id: String, secret: String, environment: PlaidEnvironment) -> Self {
        Self {
            client_id,
            secret: Zeroizing::new(secret),
            environment,
            base_url: None,
        }
    }
}

impl fmt::Debug for PlaidConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PlaidConfig")
            .field("client_id", &self.client_id)
            .field("secret", &"<redacted>")
            .field("environment", &self.environment)
            .finish()
    }
}

#[derive(Clone)]
pub struct PlaidClient {
    cfg: PlaidConfig,
    http: Arc<dyn PlaidHttp>,
}

impl fmt::Debug for PlaidClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PlaidClient")
            .field("environment", &self.cfg.environment)
            .finish()
    }
}

impl PlaidClient {
    pub fn new(cfg: PlaidConfig, http: Arc<dyn PlaidHttp>) -> Self {
        Self { cfg, http }
    }

    pub fn environment(&self) -> PlaidEnvironment {
        self.cfg.environment
    }

    fn url(&self, path: &str) -> String {
        let base = self
            .cfg
            .base_url
            .as_deref()
            .unwrap_or(self.cfg.environment.base_url())
            .trim_end_matches('/');
        format!("{base}{path}")
    }

    /// POST one call: adds the credentials, turns Plaid's error answers into [`PlaidError`].
    async fn call<T: DeserializeOwned>(
        &self,
        path: &str,
        mut body: Value,
    ) -> Result<T, PlaidError> {
        if let Some(map) = body.as_object_mut() {
            map.insert("client_id".into(), json!(self.cfg.client_id));
            map.insert("secret".into(), json!(self.cfg.secret.as_str()));
        }
        let answer = self.http.post_json(&self.url(path), &body).await?;
        if answer.status != 200 {
            let v: Value = serde_json::from_str(&answer.body).unwrap_or(Value::Null);
            let field = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            return Err(PlaidError::Api(ApiError {
                status: answer.status,
                kind: field("error_type"),
                code: match field("error_code") {
                    c if c.is_empty() => format!("HTTP_{}", answer.status),
                    c => c,
                },
                message: match (field("display_message"), field("error_message")) {
                    (d, _) if !d.is_empty() => d,
                    (_, m) if !m.is_empty() => m,
                    _ => "no details".to_string(),
                },
            }));
        }
        serde_json::from_str(&answer.body)
            .map_err(|e| PlaidError::Unreadable(format!("{path}: {e}")))
    }

    /// Start a hosted link session: open the returned page in a browser and sign in to your bank
    /// there.
    pub async fn create_link_token(&self, req: &LinkRequest) -> Result<LinkToken, PlaidError> {
        let mut hosted = json!({ "url_lifetime_seconds": 1800 });
        if let Some(uri) = &req.completion_redirect_uri {
            hosted["completion_redirect_uri"] = json!(uri);
        }
        let body = json!({
            "client_name": CLIENT_NAME,
            "language": req.language,
            "country_codes": req.country_codes,
            "user": { "client_user_id": req.user_id },
            "products": ["transactions"],
            "transactions": { "days_requested": req.days_requested.clamp(1, 730) },
            "hosted_link": hosted,
        });
        let raw: LinkTokenCreate = self.call("/link/token/create", body).await?;
        let hosted_link_url = raw.hosted_link_url.ok_or_else(|| {
            PlaidError::Unreadable(
                "no hosted_link_url (is Hosted Link enabled for your Plaid account?)".into(),
            )
        })?;
        let expires_at = raw.expiration.as_deref().and_then(|e| {
            OffsetDateTime::parse(e, &time::format_description::well_known::Rfc3339)
                .ok()
                .map(OffsetDateTime::unix_timestamp)
        });
        Ok(LinkToken {
            token: raw.link_token,
            hosted_link_url,
            expires_at,
        })
    }

    /// Has the browser session finished? Poll this every few seconds after opening the page.
    pub async fn link_session(&self, link_token: &str) -> Result<LinkSession, PlaidError> {
        let raw: LinkTokenGet = self
            .call("/link/token/get", json!({ "link_token": link_token }))
            .await?;
        let public = raw
            .link_sessions
            .iter()
            .filter_map(|s| s.results.as_ref())
            .flat_map(|r| r.item_add_results.iter())
            .find_map(|i| i.public_token.clone());
        Ok(match public {
            Some(public_token) => LinkSession::Finished { public_token },
            None => LinkSession::Waiting,
        })
    }

    pub async fn exchange(&self, public_token: &str) -> Result<Exchange, PlaidError> {
        let raw: RawExchange = self
            .call(
                "/item/public_token/exchange",
                json!({ "public_token": public_token }),
            )
            .await?;
        Ok(Exchange {
            access_token: raw.access_token,
            item_id: raw.item_id,
        })
    }

    pub async fn accounts(&self, access_token: &str) -> Result<Vec<AccountBalance>, PlaidError> {
        let raw: RawAccounts = self
            .call("/accounts/get", json!({ "access_token": access_token }))
            .await?;
        Ok(raw
            .accounts
            .into_iter()
            .map(|a| AccountBalance {
                name: if a.name.is_empty() {
                    a.official_name.unwrap_or_default()
                } else {
                    a.name
                },
                account_id: a.account_id,
                mask: a.mask,
                kind: a.kind,
                currency: a.balances.iso_currency_code,
                current: a.balances.current,
            })
            .collect())
    }

    /// Read what is new since `req.cursor`, all pages of it.
    pub async fn sync(&self, req: &SyncRequest) -> Result<SyncOutcome, PlaidError> {
        let mut restarts = 0;
        'again: loop {
            let mut cursor = req.cursor.clone();
            let (mut transactions, mut skipped, mut modified, mut removed) =
                (Vec::new(), 0usize, 0usize, 0usize);
            for _ in 0..MAX_PAGES {
                let mut body = json!({ "access_token": req.access_token, "count": PAGE_SIZE });
                if let Some(c) = cursor.as_deref().filter(|c| !c.is_empty()) {
                    body["cursor"] = json!(c);
                }
                let page: RawSyncPage = match self.call("/transactions/sync", body).await {
                    Err(e) if e.mutated_during_paging() && restarts < MAX_RESTARTS => {
                        restarts += 1;
                        continue 'again;
                    }
                    other => other?,
                };
                for raw in &page.added {
                    if !req.account_ids.is_empty() && !req.account_ids.contains(&raw.account_id) {
                        continue;
                    }
                    match map_transaction(raw) {
                        Mapped::Booked(tx) => transactions.push(tx),
                        Mapped::Skipped => skipped += 1,
                    }
                }
                modified += page.modified.len();
                removed += page.removed.len();
                cursor = Some(page.next_cursor);
                if !page.has_more {
                    let accounts = self.accounts(&req.access_token).await?;
                    let (balance, balance_date) = Self::balance(&accounts, &req.account_ids);
                    return Ok(SyncOutcome {
                        transactions,
                        skipped,
                        modified,
                        removed,
                        next_cursor: cursor.unwrap_or_default(),
                        balance,
                        balance_date,
                        accounts,
                    });
                }
            }
            return Err(PlaidError::Unreadable(
                "too many pages of transactions".into(),
            ));
        }
    }

    /// The sum of the current balances of the included checking and savings accounts in euro.
    fn balance(accounts: &[AccountBalance], only: &[String]) -> (Option<Money>, Option<Date>) {
        let mut total = 0i64;
        let mut any = false;
        for a in accounts {
            let included = only.is_empty() || only.contains(&a.account_id);
            let euro = a
                .currency
                .as_deref()
                .is_some_and(|c| c.eq_ignore_ascii_case("EUR"));
            if included && euro && a.kind == "depository" {
                if let Some(current) = a.current {
                    total += (current * 100.0).round() as i64;
                    any = true;
                }
            }
        }
        if any {
            (
                Some(Money::from_cents(total)),
                Some(OffsetDateTime::now_utc().date()),
            )
        } else {
            (None, None)
        }
    }

    /// Tell Plaid to forget the connection (it stops billing for it, too).
    pub async fn remove_item(&self, access_token: &str) -> Result<(), PlaidError> {
        let _: Value = self
            .call("/item/remove", json!({ "access_token": access_token }))
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::FakePlaidHttp;

    fn client(fake: FakePlaidHttp) -> (PlaidClient, Arc<FakePlaidHttp>) {
        let fake = Arc::new(fake);
        let c = PlaidClient::new(
            PlaidConfig {
                client_id: "client-123".into(),
                secret: Zeroizing::new("super-secret-value".into()),
                environment: PlaidEnvironment::Sandbox,
                base_url: None,
            },
            fake.clone(),
        );
        (c, fake)
    }

    fn request() -> LinkRequest {
        LinkRequest {
            user_id: "giro".into(),
            country_codes: vec!["DE".into()],
            language: "de".into(),
            days_requested: 9999,
            completion_redirect_uri: None,
        }
    }

    const TX_PAGE_1: &str = r#"{"added":[
        {"account_id":"acc1","amount":12.94,"iso_currency_code":"EUR","date":"2026-10-14","name":"Lidl","pending":false},
        {"account_id":"acc2","amount":99.0,"iso_currency_code":"EUR","date":"2026-10-14","name":"Other account","pending":false},
        {"account_id":"acc1","amount":3.0,"iso_currency_code":"EUR","date":"2026-10-15","name":"Pending","pending":true}],
        "modified":[],"removed":[],"next_cursor":"c1","has_more":true}"#;
    const TX_PAGE_2: &str = r#"{"added":[
        {"account_id":"acc1","amount":-2650.0,"iso_currency_code":"EUR","date":"2026-10-01","name":"Gehalt","pending":false}],
        "modified":[{"transaction_id":"m"}],"removed":[{"transaction_id":"r"},{"transaction_id":"s"}],
        "next_cursor":"c2","has_more":false}"#;
    const ACCOUNTS: &str = r#"{"accounts":[
        {"account_id":"acc1","name":"Giro","mask":"0000","type":"depository","balances":{"current":1234.56,"iso_currency_code":"EUR"}},
        {"account_id":"acc2","name":"Tagesgeld","mask":"1111","type":"depository","balances":{"current":100.0,"iso_currency_code":"EUR"}},
        {"account_id":"acc3","name":"Kreditkarte","type":"credit","balances":{"current":50.0,"iso_currency_code":"EUR"}}]}"#;

    #[tokio::test]
    async fn the_link_token_asks_for_hosted_link_and_transactions_and_clamps_the_history() {
        let (c, fake) = client(FakePlaidHttp::new().answer(
            "/link/token/create",
            200,
            r#"{"link_token":"link-sandbox-1","hosted_link_url":"https://secure.plaid.com/hl/abc","expiration":"2026-10-16T10:30:00Z"}"#,
        ));
        let t = c.create_link_token(&request()).await.unwrap();
        assert_eq!(t.token, "link-sandbox-1");
        assert_eq!(t.hosted_link_url, "https://secure.plaid.com/hl/abc");
        assert_eq!(t.expires_at, Some(1_792_146_600));
        let body = fake.body_of(0);
        assert_eq!(body["products"][0], "transactions");
        assert_eq!(body["country_codes"][0], "DE");
        assert_eq!(body["transactions"]["days_requested"], 730);
        assert!(body["hosted_link"].is_object());
        assert_eq!(body["user"]["client_user_id"], "giro");
    }

    #[tokio::test]
    async fn without_a_hosted_link_url_the_answer_explains_what_to_enable() {
        let (c, _) = client(FakePlaidHttp::new().answer(
            "/link/token/create",
            200,
            r#"{"link_token":"link-sandbox-1"}"#,
        ));
        let e = c.create_link_token(&request()).await.unwrap_err();
        assert!(e.to_string().contains("Hosted Link"), "{e}");
    }

    #[tokio::test]
    async fn a_link_session_is_waiting_until_it_has_a_public_token() {
        let (c, _) = client(
            FakePlaidHttp::new()
                .answer("/link/token/get", 200, r#"{"link_sessions":[]}"#)
                .answer(
                    "/link/token/get",
                    200,
                    r#"{"link_sessions":[{"finished_at":"2026-10-16T09:00:00Z","results":{"item_add_results":[{"public_token":"public-sandbox-9"}]}}]}"#,
                ),
        );
        assert_eq!(c.link_session("t").await.unwrap(), LinkSession::Waiting);
        assert_eq!(
            c.link_session("t").await.unwrap(),
            LinkSession::Finished {
                public_token: "public-sandbox-9".into()
            }
        );
    }

    #[tokio::test]
    async fn sync_reads_every_page_filters_accounts_and_reports_a_balance() {
        let (c, fake) = client(
            FakePlaidHttp::new()
                .answer("/transactions/sync", 200, TX_PAGE_1)
                .answer("/transactions/sync", 200, TX_PAGE_2)
                .answer("/accounts/get", 200, ACCOUNTS),
        );
        let out = c
            .sync(&SyncRequest {
                access_token: "access-1".into(),
                cursor: Some("start".into()),
                account_ids: vec!["acc1".into()],
            })
            .await
            .unwrap();
        // acc2 is filtered out, the pending one is skipped
        assert_eq!(out.transactions.len(), 2);
        assert_eq!(out.transactions[0].amount.cents(), -1294);
        assert_eq!(out.transactions[1].amount.cents(), 265_000);
        assert_eq!(out.skipped, 1);
        assert_eq!((out.modified, out.removed), (1, 2));
        assert_eq!(out.next_cursor, "c2");
        // only the included checking account counts; the credit card does not
        assert_eq!(out.balance.unwrap().cents(), 123_456);
        assert!(out.balance_date.is_some());
        // the saved cursor starts the first page, the page's cursor the next one
        assert_eq!(fake.body_of(0)["cursor"], "start");
        assert_eq!(fake.body_of(1)["cursor"], "c1");
        assert_eq!(
            fake.paths(),
            ["/transactions/sync", "/transactions/sync", "/accounts/get"]
        );
    }

    #[tokio::test]
    async fn a_first_sync_sends_no_cursor() {
        let (c, fake) = client(
            FakePlaidHttp::new()
                .answer("/transactions/sync", 200, TX_PAGE_2)
                .answer("/accounts/get", 200, ACCOUNTS),
        );
        c.sync(&SyncRequest {
            access_token: "a".into(),
            cursor: None,
            account_ids: vec![],
        })
        .await
        .unwrap();
        assert!(fake.body_of(0).get("cursor").is_none());
    }

    #[tokio::test]
    async fn paging_starts_again_when_the_data_changes_underneath() {
        let (c, fake) = client(
            FakePlaidHttp::new()
                .answer("/transactions/sync", 200, TX_PAGE_1)
                .answer(
                    "/transactions/sync",
                    400,
                    r#"{"error_type":"TRANSACTIONS_ERROR","error_code":"TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION","error_message":"changed"}"#,
                )
                .answer("/transactions/sync", 200, TX_PAGE_2)
                .answer("/accounts/get", 200, ACCOUNTS),
        );
        let out = c
            .sync(&SyncRequest {
                access_token: "a".into(),
                cursor: Some("start".into()),
                account_ids: vec![],
            })
            .await
            .unwrap();
        // page 1 was thrown away with the restart, so its transactions are not counted twice
        assert_eq!(out.transactions.len(), 1);
        assert_eq!(fake.body_of(2)["cursor"], "start");
    }

    #[tokio::test]
    async fn plaid_errors_are_classified_and_never_show_the_secret() {
        let (c, fake) = client(FakePlaidHttp::new().answer(
            "/transactions/sync",
            400,
            r#"{"error_type":"ITEM_ERROR","error_code":"ITEM_LOGIN_REQUIRED","error_message":"the login details of this item have changed","display_message":"Please sign in again"}"#,
        ));
        let e = c
            .sync(&SyncRequest {
                access_token: "a".into(),
                cursor: None,
                account_ids: vec![],
            })
            .await
            .unwrap_err();
        assert!(e.needs_relink());
        assert!(e.to_string().contains("sign in again"));
        for text in [e.to_string(), format!("{c:?}"), format!("{:?}", c.cfg)] {
            assert!(!text.contains("super-secret-value"), "{text}");
        }
        assert!(
            fake.body_of(0).get("secret").is_none(),
            "the fake strips credentials"
        );

        let (c, _) = client(FakePlaidHttp::new().answer(
            "/accounts/get",
            400,
            r#"{"error_type":"INVALID_INPUT","error_code":"INVALID_API_KEYS","error_message":"invalid"}"#,
        ));
        assert!(c.accounts("a").await.unwrap_err().bad_keys());
    }

    #[tokio::test]
    async fn an_answer_that_is_not_plaid_json_is_reported_not_panicked_on() {
        let (c, _) =
            client(FakePlaidHttp::new().answer("/item/public_token/exchange", 200, "<html>"));
        assert!(matches!(
            c.exchange("p").await.unwrap_err(),
            PlaidError::Unreadable(_)
        ));
        let (c, _) = client(FakePlaidHttp::new().answer("/item/remove", 502, "bad gateway"));
        let e = c.remove_item("a").await.unwrap_err();
        assert!(e.to_string().contains("HTTP_502"), "{e}");
    }

    #[test]
    fn environments_parse_and_have_their_own_hosts() {
        assert_eq!(
            PlaidEnvironment::parse(" Production "),
            Some(PlaidEnvironment::Production)
        );
        assert_eq!(PlaidEnvironment::parse("development"), None);
        assert!(PlaidEnvironment::Sandbox.base_url().contains("sandbox"));
    }
}
