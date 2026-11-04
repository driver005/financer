//! finAPI (`finapi.io`), through its Web Form 2.0 for the bank sign-in.
//!
//! The flow: trade the client id and secret for a client token; create a finAPI user for this
//! connection (a random id and password that only this server knows); trade those for a user
//! token; create a bank-connection-import web form and open its URL in a browser, where you pick
//! your bank and sign in; poll the form until it is completed; then read accounts and
//! transactions with the user token. The user id and password (sealed by the caller) are the
//! credential. Deleting the user removes everything finAPI holds for it.
//!
//! Needs a finAPI customer agreement; the sandbox works with test banks. The request bodies follow
//! finAPI's public documentation as far as it could be checked; the web form address and the form
//! status names can be adjusted in [`FinapiConfig`].

use std::fmt;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use financer_core::{Money, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use crate::error::{ApiError, ErrorKind, OpenError};
use crate::http::{Answer, OpenHttp, Request};
use crate::types::{
    mask_of, BeginRequest, FetchRequest, Fetched, LinkedAccount, Poll, ProviderKind, Step,
};
use crate::{cents_of, date_text, parse_date, Provider};

const NAME: &str = "finAPI";
const PAGE_SIZE: u32 = 500;
const MAX_PAGES: u32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FinapiEnvironment {
    /// finAPI's test banks: no real account involved.
    #[default]
    Sandbox,
    Live,
}

impl FinapiEnvironment {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "sandbox" => Some(Self::Sandbox),
            "live" | "production" => Some(Self::Live),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Sandbox => "sandbox",
            Self::Live => "live",
        }
    }

    fn api(self) -> &'static str {
        match self {
            Self::Sandbox => "https://sandbox.finapi.io",
            Self::Live => "https://live.finapi.io",
        }
    }

    fn web_form(self) -> &'static str {
        match self {
            Self::Sandbox => "https://webform-sandbox.finapi.io",
            Self::Live => "https://webform-live.finapi.io",
        }
    }
}

#[derive(Clone)]
pub struct FinapiConfig {
    pub client_id: String,
    pub client_secret: Zeroizing<String>,
    pub environment: FinapiEnvironment,
    /// Where the web form sends the browser when you are done.
    pub redirect_uri: Option<String>,
    /// For tests and proxies.
    pub api_url: Option<String>,
    pub web_form_url: Option<String>,
}

impl FinapiConfig {
    pub fn new(client_id: String, client_secret: String, environment: FinapiEnvironment) -> Self {
        Self {
            client_id,
            client_secret: Zeroizing::new(client_secret),
            environment,
            redirect_uri: None,
            api_url: None,
            web_form_url: None,
        }
    }
}

impl fmt::Debug for FinapiConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FinapiConfig")
            .field("client_id", &"<redacted>")
            .field("client_secret", &"<redacted>")
            .field("environment", &self.environment)
            .finish()
    }
}

pub struct Finapi {
    cfg: FinapiConfig,
    http: Arc<dyn OpenHttp>,
}

impl fmt::Debug for Finapi {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Finapi({})", self.cfg.environment.name())
    }
}

/// What the caller keeps (sealed): the finAPI user of this connection.
#[derive(Serialize, Deserialize)]
struct User {
    id: String,
    password: String,
}

/// What `poll` needs while the web form is open.
#[derive(Serialize, Deserialize)]
struct Session {
    user: User,
    form: String,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Finapi {
    pub fn new(cfg: FinapiConfig, http: Arc<dyn OpenHttp>) -> Self {
        Self { cfg, http }
    }

    fn api(&self, path: &str) -> String {
        let base = self
            .cfg
            .api_url
            .as_deref()
            .unwrap_or(self.cfg.environment.api())
            .trim_end_matches('/');
        format!("{base}{path}")
    }

    fn form(&self, path: &str) -> String {
        let base = self
            .cfg
            .web_form_url
            .as_deref()
            .unwrap_or(self.cfg.environment.web_form())
            .trim_end_matches('/');
        format!("{base}{path}")
    }

    async fn send(&self, request: Request) -> Result<Answer, OpenError> {
        self.http
            .send(request)
            .await
            .map_err(|m| OpenError::connection(NAME, m))
    }

    fn kind_of(status: u16, keys: bool) -> ErrorKind {
        match status {
            _ if keys => ErrorKind::BadKeys,
            429 => ErrorKind::RateLimited,
            401 | 403 | 404 | 410 => ErrorKind::Relink,
            _ => ErrorKind::Other,
        }
    }

    fn api_error(answer: &Answer, keys: bool) -> OpenError {
        let v: Value = serde_json::from_str(&answer.body).unwrap_or(Value::Null);
        // finAPI: {"errors":[{"message":"...","code":"...","type":"..."}]} or OAuth's {"error":..}
        let first = v.pointer("/errors/0");
        let field = |from: Option<&Value>, k: &str| {
            from.and_then(|e| e.get(k))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        };
        let code = match (field(first, "code"), field(Some(&v), "error")) {
            (c, _) if !c.is_empty() => c,
            (_, e) => e,
        };
        let message = match (
            field(first, "message"),
            field(Some(&v), "error_description"),
        ) {
            (m, _) if !m.is_empty() => m,
            (_, d) if !d.is_empty() => d,
            _ => "no details".to_string(),
        };
        OpenError::Api(ApiError {
            provider: NAME,
            status: answer.status,
            code,
            message,
            kind: Self::kind_of(answer.status, keys),
        })
    }

    async fn token(
        &self,
        mut fields: Vec<(String, String)>,
        keys: bool,
    ) -> Result<Zeroizing<String>, OpenError> {
        fields.push(("client_id".into(), self.cfg.client_id.clone()));
        fields.push((
            "client_secret".into(),
            self.cfg.client_secret.as_str().to_string(),
        ));
        let answer = self
            .send(Request::post_form(self.api("/api/v2/oauth/token"), fields))
            .await?;
        if answer.status != 200 {
            return Err(Self::api_error(&answer, keys));
        }
        let v: Value = serde_json::from_str(&answer.body)
            .map_err(|e| OpenError::unreadable(NAME, format!("token: {e}")))?;
        v.get("access_token")
            .and_then(Value::as_str)
            .map(|t| Zeroizing::new(t.to_string()))
            .ok_or_else(|| OpenError::unreadable(NAME, "token: no access_token"))
    }

    async fn client_token(&self) -> Result<Zeroizing<String>, OpenError> {
        self.token(
            vec![("grant_type".into(), "client_credentials".into())],
            true,
        )
        .await
    }

    async fn user_token(&self, user: &User) -> Result<Zeroizing<String>, OpenError> {
        // a wrong user means "sign in again", not wrong keys: the client keys already passed
        self.token(
            vec![
                ("grant_type".into(), "password".into()),
                ("username".into(), user.id.clone()),
                ("password".into(), user.password.clone()),
            ],
            false,
        )
        .await
    }

    async fn get(&self, token: &str, url: String) -> Result<Value, OpenError> {
        let answer = self.send(Request::get(url.clone(), Some(token))).await?;
        if answer.status != 200 {
            return Err(Self::api_error(&answer, false));
        }
        serde_json::from_str(&answer.body).map_err(|e| {
            OpenError::unreadable(
                NAME,
                format!("{}: {e}", url.split('?').next().unwrap_or("")),
            )
        })
    }
}

#[async_trait]
impl Provider for Finapi {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Finapi
    }

    async fn begin(&self, _req: &BeginRequest) -> Result<Step, OpenError> {
        let client = self.client_token().await?;
        let user = User {
            id: format!("financer-{}", uuid::Uuid::new_v4().simple()),
            password: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        };
        let created = self
            .send(Request::post_json(
                self.api("/api/v2/users"),
                Some(client.as_str()),
                json!({ "id": user.id, "password": user.password, "isAutoUpdateEnabled": false }),
            ))
            .await?;
        if !(200..300).contains(&created.status) {
            return Err(Self::api_error(&created, false));
        }
        let user_token = self.user_token(&user).await?;
        let mut body = json!({});
        if let Some(uri) = self.cfg.redirect_uri.as_deref().filter(|u| !u.is_empty()) {
            body["redirectUrl"] = json!(uri);
        }
        let answer = self
            .send(Request::post_json(
                self.form("/api/webForms/bankConnectionImport"),
                Some(user_token.as_str()),
                body,
            ))
            .await?;
        if !(200..300).contains(&answer.status) {
            // do not leave a user behind that nobody can reach again
            let _ = self.delete_user(&user).await;
            return Err(Self::api_error(&answer, false));
        }
        let v: Value = serde_json::from_str(&answer.body)
            .map_err(|e| OpenError::unreadable(NAME, format!("web form: {e}")))?;
        let text = |keys: &[&str]| {
            keys.iter()
                .find_map(|k| v.get(*k).and_then(Value::as_str))
                .map(str::to_string)
        };
        let (Some(url), Some(form)) = (text(&["url", "webFormUrl"]), text(&["id", "webFormId"]))
        else {
            let _ = self.delete_user(&user).await;
            return Err(OpenError::unreadable(NAME, "web form: no id or url"));
        };
        Ok(Step::Link {
            url,
            session: serde_json::to_string(&Session { user, form })
                .map_err(|e| OpenError::unreadable(NAME, e))?,
            expires_at: Some(now() + 1800),
        })
    }

    async fn poll(&self, session: &str) -> Result<Poll, OpenError> {
        let s: Session = serde_json::from_str(session)
            .map_err(|e| OpenError::unreadable(NAME, format!("session: {e}")))?;
        let token = self.user_token(&s.user).await?;
        let v = self
            .get(&token, self.form(&format!("/api/webForms/{}", s.form)))
            .await?;
        let status = v
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        match status.as_str() {
            "COMPLETED" => Ok(Poll::Linked {
                credential: serde_json::to_string(&s.user)
                    .map_err(|e| OpenError::unreadable(NAME, e))?,
            }),
            "ABORTED" | "FAILED" | "EXPIRED" | "CANCELED" | "CANCELLED" => {
                let _ = self.delete_user(&s.user).await;
                Err(OpenError::LinkFailed {
                    provider: NAME,
                    message: format!("the sign-in did not finish ({})", status.to_lowercase()),
                })
            }
            _ => Ok(Poll::Waiting),
        }
    }

    async fn fetch(&self, req: &FetchRequest) -> Result<Fetched, OpenError> {
        let user: User = serde_json::from_str(&req.credential)
            .map_err(|e| OpenError::unreadable(NAME, format!("credential: {e}")))?;
        let token = self.user_token(&user).await?;
        let mut out = Fetched::default();

        let accounts = self.get(&token, self.api("/api/v2/accounts")).await?;
        let mut ids: Vec<i64> = Vec::new();
        let mut balance: Option<i64> = None;
        for a in accounts
            .get("accounts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(id) = a.get("id").and_then(Value::as_i64) else {
                continue;
            };
            let id_text = id.to_string();
            if !req.account_ids.is_empty() && !req.account_ids.contains(&id_text) {
                continue;
            }
            let text = |k: &str| {
                a.get(k)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            };
            let number = text("iban").or_else(|| text("accountNumber"));
            out.accounts.push(LinkedAccount {
                id: id_text,
                name: text("accountName")
                    .or_else(|| text("accountHolderName"))
                    .or(number)
                    .unwrap_or("Account")
                    .to_string(),
                mask: number.and_then(mask_of),
                kind: text("accountTypeName")
                    .or_else(|| text("accountType"))
                    .unwrap_or("account")
                    .to_string(),
            });
            let euro = text("accountCurrency").is_none_or(|c| c.eq_ignore_ascii_case("EUR"));
            if euro {
                if let Some(c) = a.get("balance").and_then(cents_of) {
                    *balance.get_or_insert(0) += c;
                }
            }
            ids.push(id);
        }
        out.balance = balance.map(Money::from_cents);
        if ids.is_empty() {
            return Ok(out);
        }
        out.balance_date = Some(time::OffsetDateTime::now_utc().date());

        let id_list = ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
        for page in 1..=MAX_PAGES {
            let v = self
                .get(
                    &token,
                    self.api(&format!(
                        "/api/v2/transactions?accountIds={id_list}&minBankBookingDate={}&view=userView&perPage={PAGE_SIZE}&page={page}",
                        date_text(req.since)
                    )),
                )
                .await?;
            for raw in v
                .get("transactions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                match Self::map_transaction(raw) {
                    Some(t) => out.transactions.push(t),
                    None => out.skipped += 1,
                }
            }
            let pages = v
                .pointer("/paging/pageCount")
                .and_then(Value::as_u64)
                .unwrap_or(1);
            if u64::from(page) >= pages {
                break;
            }
        }
        Ok(out)
    }

    async fn revoke(&self, credential: &str) -> Result<(), OpenError> {
        let user: User = serde_json::from_str(credential)
            .map_err(|e| OpenError::unreadable(NAME, format!("credential: {e}")))?;
        self.delete_user(&user).await
    }
}

impl Finapi {
    async fn delete_user(&self, user: &User) -> Result<(), OpenError> {
        let token = self.user_token(user).await?;
        let answer = self
            .send(Request::delete(
                self.api("/api/v2/users"),
                Some(token.as_str()),
            ))
            .await?;
        if (200..300).contains(&answer.status) || answer.status == 404 {
            Ok(())
        } else {
            Err(Self::api_error(&answer, false))
        }
    }

    /// `None`: skipped (another currency, or no readable date or amount).
    pub(crate) fn map_transaction(raw: &Value) -> Option<Transaction> {
        let currency = raw.get("currency").and_then(Value::as_str);
        if currency.is_some_and(|c| !c.eq_ignore_ascii_case("EUR")) {
            return None;
        }
        let amount = cents_of(raw.get("amount")?)?;
        let date = ["bankBookingDate", "finapiBookingDate", "valueDate"]
            .iter()
            .find_map(|k| raw.get(*k).and_then(Value::as_str).and_then(parse_date))?;
        let text = |k: &str| {
            raw.get(k)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
        };
        let purpose = text("purpose").unwrap_or_default().to_string();
        Some(Transaction {
            booking_date: date,
            amount: Money::from_cents(amount),
            counterparty: text("counterpartName")
                .map(str::to_string)
                .unwrap_or_else(|| purpose.chars().take(60).collect()),
            purpose,
            counterparty_iban: text("counterpartIban").map(str::to_string),
            category: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::FakeHttp;

    const TOKEN: &str = r#"{"access_token":"tok","token_type":"bearer","expires_in":3600}"#;

    fn client(fake: FakeHttp) -> (Finapi, Arc<FakeHttp>) {
        let fake = Arc::new(fake);
        let mut cfg = FinapiConfig::new("cid".into(), "csecret".into(), FinapiEnvironment::Sandbox);
        cfg.redirect_uri = Some("https://example.org/done".into());
        (Finapi::new(cfg, fake.clone()), fake)
    }

    fn req() -> BeginRequest {
        BeginRequest {
            reference: "Giro".into(),
            institution: None,
            days: 90,
            login: None,
        }
    }

    fn credential() -> String {
        r#"{"id":"u1","password":"pw"}"#.into()
    }

    #[tokio::test]
    async fn begin_creates_a_user_and_a_web_form() {
        let (c, fake) = client(
            FakeHttp::new()
                .answer("POST /api/v2/oauth/token", 200, TOKEN)
                .answer("POST /api/v2/users", 201, r#"{"id":"x"}"#)
                .answer(
                    "POST /api/webForms/bankConnectionImport",
                    201,
                    r#"{"id":"wf-1","url":"https://webform-sandbox.finapi.io/wf/wf-1","status":"NOT_YET_OPENED"}"#,
                ),
        );
        let Step::Link { url, session, .. } = c.begin(&req()).await.unwrap() else {
            panic!("a link");
        };
        assert_eq!(url, "https://webform-sandbox.finapi.io/wf/wf-1");
        let session: Session = serde_json::from_str(&session).unwrap();
        assert_eq!(session.form, "wf-1");
        assert!(session.user.id.starts_with("financer-"));
        // the user is created with the client token and with credentials the server invented
        let created = fake
            .keys()
            .iter()
            .position(|k| k == "POST /api/v2/users")
            .unwrap();
        assert!(fake.call(created).bearer);
        assert!(
            fake.call(created).body.get("password").is_none(),
            "the fake hides it"
        );
        let form = fake
            .keys()
            .iter()
            .position(|k| k.contains("webForms"))
            .unwrap();
        assert_eq!(
            fake.call(form).body["redirectUrl"],
            "https://example.org/done"
        );
        // client token, user, user token, web form
        assert_eq!(fake.count("POST /api/v2/oauth/token"), 2);
    }

    #[tokio::test]
    async fn wrong_client_keys_are_named_as_such() {
        let (c, _) = client(FakeHttp::new().answer(
            "POST /api/v2/oauth/token",
            401,
            r#"{"error":"invalid_client","error_description":"Bad client credentials"}"#,
        ));
        let e = c.begin(&req()).await.unwrap_err();
        assert!(e.bad_keys());
    }

    #[tokio::test]
    async fn a_failed_web_form_does_not_leave_the_user_behind() {
        let (c, fake) = client(
            FakeHttp::new()
                .answer("POST /api/v2/oauth/token", 200, TOKEN)
                .answer("POST /api/v2/users", 201, "{}")
                .answer(
                    "POST /api/webForms/bankConnectionImport",
                    400,
                    r#"{"errors":[{"message":"Not allowed","code":"BAD"}]}"#,
                )
                .answer("DELETE /api/v2/users", 200, "{}"),
        );
        assert!(c.begin(&req()).await.is_err());
        assert_eq!(fake.count("DELETE /api/v2/users"), 1);
    }

    #[tokio::test]
    async fn poll_follows_the_form_status() {
        let session = serde_json::to_string(&Session {
            user: User {
                id: "u1".into(),
                password: "pw".into(),
            },
            form: "wf-1".into(),
        })
        .unwrap();
        for (status, expect) in [
            ("COMPLETED", "done"),
            ("NOT_YET_OPENED", "wait"),
            ("IN_PROGRESS", "wait"),
            ("ABORTED", "fail"),
        ] {
            let (c, _) = client(
                FakeHttp::new()
                    .answer("POST /api/v2/oauth/token", 200, TOKEN)
                    .answer(
                        "GET /api/webForms/wf-1",
                        200,
                        &format!(r#"{{"status":"{status}"}}"#),
                    )
                    .answer("DELETE /api/v2/users", 200, "{}"),
            );
            let got = c.poll(&session).await;
            match expect {
                "done" => assert!(matches!(got, Ok(Poll::Linked { .. }))),
                "wait" => assert_eq!(got.unwrap(), Poll::Waiting),
                _ => assert!(matches!(got, Err(OpenError::LinkFailed { .. }))),
            }
        }
    }

    #[tokio::test]
    async fn fetch_reads_accounts_and_pages_of_transactions() {
        let (c, fake) = client(
            FakeHttp::new()
                .answer("POST /api/v2/oauth/token", 200, TOKEN)
                .answer("GET /api/v2/accounts", 200, r#"{"accounts":[
                    {"id":11,"accountName":"Girokonto","iban":"DE89370400440532013000","accountTypeName":"Checking","accountCurrency":"EUR","balance":1234.5},
                    {"id":12,"accountName":"Dollar","accountCurrency":"USD","balance":9.0}]}"#)
                .answer("GET /api/v2/transactions?accountIds=11,12&minBankBookingDate=2026-03-01&view=userView&perPage=500&page=1", 200,
                    r#"{"transactions":[
                      {"id":1,"accountId":11,"amount":-12.94,"currency":"EUR","purpose":"Kartenzahlung","counterpartName":"REWE Markt","counterpartIban":"DE02120300000000202051","bankBookingDate":"2026-05-01"},
                      {"id":2,"accountId":11,"amount":2650,"purpose":"Gehalt Mai","bankBookingDate":"2026-05-02 00:00:00.000"}],
                      "paging":{"page":1,"perPage":500,"pageCount":2,"totalCount":3}}"#)
                .answer("GET /api/v2/transactions?accountIds=11,12&minBankBookingDate=2026-03-01&view=userView&perPage=500&page=2", 200,
                    r#"{"transactions":[{"id":3,"accountId":12,"amount":-5,"currency":"USD","bankBookingDate":"2026-05-03"}],
                      "paging":{"page":2,"perPage":500,"pageCount":2,"totalCount":3}}"#),
        );
        let out = c
            .fetch(&FetchRequest {
                credential: credential(),
                account_ids: vec![],
                since: time::macros::date!(2026 - 03 - 01),
                cursor: None,
            })
            .await
            .unwrap();
        assert_eq!(out.accounts.len(), 2);
        assert_eq!(out.accounts[0].mask.as_deref(), Some("3000"));
        // the dollar account is listed but not added to the euro balance
        assert_eq!(out.balance, Some(Money::from_cents(123_450)));
        assert_eq!(out.transactions.len(), 2);
        assert_eq!(out.skipped, 1);
        assert_eq!(out.transactions[0].counterparty, "REWE Markt");
        assert_eq!(out.transactions[0].amount.cents(), -1294);
        assert_eq!(out.transactions[1].counterparty, "Gehalt Mai");
        assert_eq!(out.transactions[1].amount.cents(), 265_000);
        assert_eq!(fake.count("GET /api/v2/transactions"), 2);
    }

    #[tokio::test]
    async fn a_rejected_user_asks_to_sign_in_again() {
        let (c, _) = client(FakeHttp::new().answer(
            "POST /api/v2/oauth/token",
            400,
            r#"{"error":"invalid_grant","error_description":"Bad credentials"}"#,
        ));
        // first the call is refused as 400; a 401 is what a deleted user gets
        let e = c
            .fetch(&FetchRequest {
                credential: credential(),
                account_ids: vec![],
                since: time::macros::date!(2026 - 03 - 01),
                cursor: None,
            })
            .await
            .unwrap_err();
        assert!(!e.bad_keys());
        let (c, _) = client(FakeHttp::new().answer("POST /api/v2/oauth/token", 401, "{}"));
        let e = c
            .fetch(&FetchRequest {
                credential: credential(),
                account_ids: vec![],
                since: time::macros::date!(2026 - 03 - 01),
                cursor: None,
            })
            .await
            .unwrap_err();
        assert!(e.needs_relink());
        assert!(!e.bad_keys());
    }

    #[tokio::test]
    async fn revoke_deletes_the_user() {
        let (c, fake) = client(
            FakeHttp::new()
                .answer("POST /api/v2/oauth/token", 200, TOKEN)
                .answer("DELETE /api/v2/users", 200, "{}"),
        );
        c.revoke(&credential()).await.unwrap();
        assert_eq!(fake.count("DELETE /api/v2/users"), 1);
    }

    #[test]
    fn debug_output_hides_the_keys() {
        let cfg = FinapiConfig::new("my-id".into(), "my-secret".into(), FinapiEnvironment::Live);
        let shown = format!("{cfg:?}");
        assert!(!shown.contains("my-id") && !shown.contains("my-secret"));
    }
}
