//! GoCardless Bank Account Data (formerly Nordigen): `bankaccountdata.gocardless.com/api/v2`.
//!
//! The flow: trade the secret id and key for an access token; create a requisition for the bank
//! (an `institution_id`) with a return address; open its `link` in a browser and sign in to your
//! bank there; poll the requisition until its status is `LN` (linked); then read the accounts of
//! the requisition. The requisition id is the credential. Consent lasts about 90 days, after
//! which the requisition expires (`EX`) and you link again.
//!
//! Note: GoCardless closed new sign-ups for this product in July 2025; the keys must come from
//! an account created before that.

use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use financer_core::{Money, Transaction};
use serde::Deserialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use crate::error::{ApiError, ErrorKind, OpenError};
use crate::http::{Answer, OpenHttp, Request};
use crate::types::{
    mask_of, BeginRequest, FetchRequest, Fetched, LinkedAccount, Poll, ProviderKind, Step,
};
use crate::{cents_of, date_text, parse_date, Provider};

const NAME: &str = "GoCardless";
const DEFAULT_BASE: &str = "https://bankaccountdata.gocardless.com";
/// Where the bank sends the browser when no return address is configured.
const DEFAULT_REDIRECT: &str = "https://bankaccountdata.gocardless.com/";
const BALANCE_ORDER: &[&str] = &[
    "closingBooked",
    "interimBooked",
    "interimAvailable",
    "expected",
];

#[derive(Clone)]
pub struct GoCardlessConfig {
    pub secret_id: String,
    pub secret_key: Zeroizing<String>,
    /// Language of the bank's sign-in page, as two letters (`de`).
    pub language: String,
    /// Where the bank's page sends the browser when you are done.
    pub redirect_uri: Option<String>,
    /// For tests and proxies.
    pub base_url: Option<String>,
}

impl GoCardlessConfig {
    pub fn new(secret_id: String, secret_key: String) -> Self {
        Self {
            secret_id,
            secret_key: Zeroizing::new(secret_key),
            language: "de".into(),
            redirect_uri: None,
            base_url: None,
        }
    }
}

impl fmt::Debug for GoCardlessConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GoCardlessConfig")
            .field("secret_id", &"<redacted>")
            .field("secret_key", &"<redacted>")
            .finish()
    }
}

pub struct GoCardless {
    cfg: GoCardlessConfig,
    http: Arc<dyn OpenHttp>,
    /// `(access token, unix seconds when it stops being good)`.
    token: Mutex<Option<(Zeroizing<String>, i64)>>,
}

impl fmt::Debug for GoCardless {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("GoCardless")
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Deserialize)]
struct TokenAnswer {
    access: String,
    #[serde(default)]
    access_expires: Option<i64>,
}

#[derive(Deserialize)]
struct Requisition {
    #[serde(default)]
    id: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    link: Option<String>,
    #[serde(default)]
    accounts: Vec<String>,
}

impl GoCardless {
    pub fn new(cfg: GoCardlessConfig, http: Arc<dyn OpenHttp>) -> Self {
        Self {
            cfg,
            http,
            token: Mutex::new(None),
        }
    }

    fn url(&self, path: &str) -> String {
        let base = self
            .cfg
            .base_url
            .as_deref()
            .unwrap_or(DEFAULT_BASE)
            .trim_end_matches('/');
        format!("{base}{path}")
    }

    /// A refused token call means wrong keys; a 401, 403, 404 or 410 elsewhere means the access
    /// is gone; 429 is the daily limit.
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
        let field = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        OpenError::Api(ApiError {
            provider: NAME,
            status: answer.status,
            code: field("summary"),
            message: match (field("detail"), field("summary")) {
                (d, _) if !d.is_empty() => d,
                (_, s) if !s.is_empty() => s,
                _ => "no details".to_string(),
            },
            kind: Self::kind_of(answer.status, keys),
        })
    }

    async fn send(&self, request: Request) -> Result<Answer, OpenError> {
        self.http
            .send(request)
            .await
            .map_err(|m| OpenError::connection(NAME, m))
    }

    /// A valid access token, asked for again a minute before the old one runs out.
    async fn access(&self) -> Result<Zeroizing<String>, OpenError> {
        if let Some((token, until)) = self.token.lock().expect("token lock").as_ref() {
            if *until > now() + 60 {
                return Ok(token.clone());
            }
        }
        let body = json!({
            "secret_id": self.cfg.secret_id,
            "secret_key": self.cfg.secret_key.as_str(),
        });
        let answer = self
            .send(Request::post_json(
                self.url("/api/v2/token/new/"),
                None,
                body,
            ))
            .await?;
        if answer.status != 200 {
            return Err(Self::api_error(&answer, true));
        }
        let t: TokenAnswer = serde_json::from_str(&answer.body)
            .map_err(|e| OpenError::unreadable(NAME, format!("token: {e}")))?;
        let token = Zeroizing::new(t.access);
        *self.token.lock().expect("token lock") =
            Some((token.clone(), now() + t.access_expires.unwrap_or(86_400)));
        Ok(token)
    }

    async fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, OpenError> {
        let token = self.access().await?;
        let answer = self
            .send(Request::get(self.url(path), Some(token.as_str())))
            .await?;
        if answer.status != 200 {
            return Err(Self::api_error(&answer, false));
        }
        serde_json::from_str(&answer.body)
            .map_err(|e| OpenError::unreadable(NAME, format!("{path}: {e}")))
    }

    async fn requisition(&self, id: &str) -> Result<Requisition, OpenError> {
        self.get(&format!("/api/v2/requisitions/{id}/")).await
    }
}

#[async_trait]
impl Provider for GoCardless {
    fn kind(&self) -> ProviderKind {
        ProviderKind::GoCardless
    }

    async fn begin(&self, req: &BeginRequest) -> Result<Step, OpenError> {
        let institution = req.institution.as_deref().filter(|i| !i.is_empty()).ok_or_else(|| {
            OpenError::LinkFailed {
                provider: NAME,
                message: "no bank chosen: set `institution` on the connection (an institution id such as SPARKASSE_DE... from GoCardless's institutions list)".into(),
            }
        })?;
        let token = self.access().await?;
        let body = json!({
            "redirect": self.cfg.redirect_uri.as_deref().unwrap_or(DEFAULT_REDIRECT),
            "institution_id": institution,
            "reference": format!("{}-{}", req.reference.to_lowercase().replace(' ', "-"), now()),
            "user_language": self.cfg.language.to_uppercase(),
        });
        let answer = self
            .send(Request::post_json(
                self.url("/api/v2/requisitions/"),
                Some(token.as_str()),
                body,
            ))
            .await?;
        if !(200..300).contains(&answer.status) {
            return Err(Self::api_error(&answer, false));
        }
        let r: Requisition = serde_json::from_str(&answer.body)
            .map_err(|e| OpenError::unreadable(NAME, format!("requisition: {e}")))?;
        let url = r
            .link
            .filter(|l| !l.is_empty())
            .ok_or_else(|| OpenError::unreadable(NAME, "the requisition has no link"))?;
        Ok(Step::Link {
            url,
            session: r.id,
            // the link is good for a while; the engine caps the wait
            expires_at: Some(now() + 1800),
        })
    }

    async fn poll(&self, session: &str) -> Result<Poll, OpenError> {
        let r = self.requisition(session).await?;
        match r.status.as_str() {
            "LN" => Ok(Poll::Linked {
                credential: session.to_string(),
            }),
            "RJ" => Err(OpenError::LinkFailed {
                provider: NAME,
                message: "the sign-in was rejected by your bank".into(),
            }),
            "EX" | "SU" => Err(OpenError::LinkFailed {
                provider: NAME,
                message: "the sign-in expired or was suspended".into(),
            }),
            _ => Ok(Poll::Waiting),
        }
    }

    async fn fetch(&self, req: &FetchRequest) -> Result<Fetched, OpenError> {
        let r = self.requisition(&req.credential).await?;
        match r.status.as_str() {
            "LN" => {}
            "EX" | "RJ" | "SU" => {
                // the consent is gone: surface it as "sign in again"
                return Err(OpenError::Api(ApiError {
                    provider: NAME,
                    status: 410,
                    code: "EXPIRED".into(),
                    message: "the consent for this bank expired".into(),
                    kind: ErrorKind::Relink,
                }));
            }
            other => {
                return Err(OpenError::LinkFailed {
                    provider: NAME,
                    message: format!("the sign-in is not finished (status {other})"),
                })
            }
        }
        let mut out = Fetched::default();
        let mut balance: Option<i64> = None;
        for account in r
            .accounts
            .iter()
            .filter(|a| req.account_ids.is_empty() || req.account_ids.iter().any(|w| w == *a))
        {
            let details: Value = self
                .get(&format!("/api/v2/accounts/{account}/details/"))
                .await
                .unwrap_or(Value::Null);
            let d = details.get("account").unwrap_or(&details);
            let text = |k: &str| {
                d.get(k)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            };
            let iban = text("iban").or_else(|| text("bban"));
            out.accounts.push(LinkedAccount {
                id: account.clone(),
                name: text("name")
                    .or_else(|| text("product"))
                    .or_else(|| text("ownerName"))
                    .or(iban)
                    .unwrap_or("Account")
                    .to_string(),
                mask: iban.and_then(mask_of),
                kind: text("cashAccountType").unwrap_or("account").to_string(),
            });

            let balances: Value = self
                .get(&format!("/api/v2/accounts/{account}/balances/"))
                .await?;
            if let Some((cents, date)) = Self::pick_balance(&balances) {
                *balance.get_or_insert(0) += cents;
                if let Some(date) = date {
                    out.balance_date = out.balance_date.max(Some(date));
                }
            }

            let today = time::OffsetDateTime::now_utc().date();
            let txs: Value = self
                .get(&format!(
                    "/api/v2/accounts/{account}/transactions/?date_from={}&date_to={}",
                    date_text(req.since),
                    date_text(today)
                ))
                .await?;
            for raw in txs
                .pointer("/transactions/booked")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                match Self::map_transaction(raw) {
                    Some(t) => out.transactions.push(t),
                    None => out.skipped += 1,
                }
            }
        }
        out.balance = balance.map(Money::from_cents);
        Ok(out)
    }

    async fn revoke(&self, credential: &str) -> Result<(), OpenError> {
        let token = self.access().await?;
        let answer = self
            .send(Request::delete(
                self.url(&format!("/api/v2/requisitions/{credential}/")),
                Some(token.as_str()),
            ))
            .await?;
        if (200..300).contains(&answer.status) || answer.status == 404 {
            Ok(())
        } else {
            Err(Self::api_error(&answer, false))
        }
    }
}

impl GoCardless {
    /// The best balance of an account in euro, as cents and the date it is from.
    fn pick_balance(balances: &Value) -> Option<(i64, Option<time::Date>)> {
        let list = balances.get("balances")?.as_array()?;
        let euro = |b: &&Value| {
            b.pointer("/balanceAmount/currency")
                .and_then(Value::as_str)
                .is_none_or(|c| c.eq_ignore_ascii_case("EUR"))
        };
        for kind in BALANCE_ORDER {
            if let Some(b) = list
                .iter()
                .filter(euro)
                .find(|b| b.get("balanceType").and_then(Value::as_str) == Some(kind))
            {
                let cents = cents_of(b.pointer("/balanceAmount/amount")?)?;
                let date = b
                    .get("referenceDate")
                    .and_then(Value::as_str)
                    .and_then(parse_date);
                return Some((cents, date));
            }
        }
        None
    }

    /// `None`: skipped (another currency or no readable date or amount).
    pub(crate) fn map_transaction(raw: &Value) -> Option<Transaction> {
        let currency = raw
            .pointer("/transactionAmount/currency")
            .and_then(Value::as_str);
        if currency.is_some_and(|c| !c.eq_ignore_ascii_case("EUR")) {
            return None;
        }
        let amount = cents_of(raw.pointer("/transactionAmount/amount")?)?;
        let date = ["bookingDate", "valueDate", "bookingDateTime"]
            .iter()
            .find_map(|k| raw.get(*k).and_then(Value::as_str).and_then(parse_date))?;
        let text = |k: &str| {
            raw.get(k)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
        };
        let outgoing = amount < 0;
        let (name, iban) = if outgoing {
            (text("creditorName"), raw.pointer("/creditorAccount/iban"))
        } else {
            (text("debtorName"), raw.pointer("/debtorAccount/iban"))
        };
        let purpose = text("remittanceInformationUnstructured")
            .map(str::to_string)
            .or_else(|| {
                let parts: Vec<&str> = raw
                    .get("remittanceInformationUnstructuredArray")
                    .and_then(Value::as_array)?
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .collect();
                (!parts.is_empty()).then(|| parts.join(" "))
            })
            .or_else(|| text("additionalInformation").map(str::to_string))
            .unwrap_or_default();
        Some(Transaction {
            booking_date: date,
            amount: Money::from_cents(amount),
            counterparty: name
                .map(str::to_string)
                .unwrap_or_else(|| purpose.chars().take(60).collect()),
            purpose,
            counterparty_iban: iban.and_then(Value::as_str).map(str::to_string),
            category: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::FakeHttp;

    fn client(fake: FakeHttp) -> (GoCardless, Arc<FakeHttp>) {
        let fake = Arc::new(fake);
        (
            GoCardless::new(
                GoCardlessConfig::new("id".into(), "key".into()),
                fake.clone(),
            ),
            fake,
        )
    }

    const TOKEN: &str =
        r#"{"access":"tok","access_expires":86400,"refresh":"r","refresh_expires":1}"#;

    fn req() -> BeginRequest {
        BeginRequest {
            reference: "Girokonto".into(),
            institution: Some("SPARKASSE_X".into()),
            days: 90,
            login: None,
        }
    }

    #[tokio::test]
    async fn begin_creates_a_requisition_and_returns_the_bank_link() {
        let (c, fake) = client(
            FakeHttp::new()
                .answer("POST /api/v2/token/new/", 200, TOKEN)
                .answer(
                    "POST /api/v2/requisitions/",
                    201,
                    r#"{"id":"req-1","status":"CR","link":"https://ob.gocardless.com/psd2/start/req-1/X"}"#,
                ),
        );
        let Step::Link { url, session, .. } = c.begin(&req()).await.unwrap() else {
            panic!("a link");
        };
        assert_eq!(session, "req-1");
        assert!(url.starts_with("https://ob.gocardless.com/"));
        let body = fake.call(1).body;
        assert_eq!(body["institution_id"], "SPARKASSE_X");
        assert_eq!(body["user_language"], "DE");
        assert!(body["reference"]
            .as_str()
            .unwrap()
            .starts_with("girokonto-"));
        // the call carried the token, and the fake never shows the keys
        assert!(fake.call(1).bearer);
        assert!(fake.call(0).body.get("secret_key").is_none());
    }

    #[tokio::test]
    async fn begin_without_a_bank_explains_what_is_missing() {
        let (c, fake) = client(FakeHttp::new());
        let mut r = req();
        r.institution = None;
        let e = c.begin(&r).await.unwrap_err();
        assert!(e.to_string().contains("institution"));
        assert_eq!(fake.calls.lock().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn the_token_is_reused_between_calls() {
        let (c, fake) = client(
            FakeHttp::new()
                .answer("POST /api/v2/token/new/", 200, TOKEN)
                .answer(
                    "GET /api/v2/requisitions/r/",
                    200,
                    r#"{"id":"r","status":"UA"}"#,
                ),
        );
        assert_eq!(c.poll("r").await.unwrap(), Poll::Waiting);
        assert_eq!(c.poll("r").await.unwrap(), Poll::Waiting);
        assert_eq!(fake.count("POST /api/v2/token/new/"), 1);
    }

    #[tokio::test]
    async fn poll_follows_the_requisition_status() {
        for (status, done, failed) in [
            ("LN", true, false),
            ("RJ", false, true),
            ("EX", false, true),
            ("GC", false, false),
        ] {
            let (c, _) = client(
                FakeHttp::new()
                    .answer("POST /api/v2/token/new/", 200, TOKEN)
                    .answer(
                        "GET /api/v2/requisitions/r/",
                        200,
                        &format!(r#"{{"id":"r","status":"{status}"}}"#),
                    ),
            );
            let got = c.poll("r").await;
            match (done, failed) {
                (true, _) => assert_eq!(
                    got.unwrap(),
                    Poll::Linked {
                        credential: "r".into()
                    }
                ),
                (_, true) => assert!(matches!(got, Err(OpenError::LinkFailed { .. }))),
                _ => assert_eq!(got.unwrap(), Poll::Waiting),
            }
        }
    }

    #[tokio::test]
    async fn wrong_keys_are_named_as_such() {
        let (c, _) = client(FakeHttp::new().answer(
            "POST /api/v2/token/new/",
            401,
            r#"{"summary":"Invalid token","detail":"No active account found with the given credentials","status_code":401}"#,
        ));
        let e = c.poll("r").await.unwrap_err();
        assert!(e.bad_keys());
        assert!(!e.needs_relink());
    }

    #[tokio::test]
    async fn fetch_reads_accounts_balances_and_booked_transactions() {
        let (c, fake) = client(
            FakeHttp::new()
                .answer("POST /api/v2/token/new/", 200, TOKEN)
                .answer("GET /api/v2/requisitions/r/", 200, r#"{"id":"r","status":"LN","accounts":["a1","a2"]}"#)
                .answer("GET /api/v2/accounts/a1/details/", 200, r#"{"account":{"iban":"DE89370400440532013000","name":"Giro","cashAccountType":"CACC"}}"#)
                .answer("GET /api/v2/accounts/a2/details/", 404, r#"{"summary":"Not found"}"#)
                .answer("GET /api/v2/accounts/a1/balances/", 200, r#"{"balances":[{"balanceType":"interimAvailable","balanceAmount":{"amount":"900.00","currency":"EUR"}},{"balanceType":"closingBooked","balanceAmount":{"amount":"1234.56","currency":"EUR"},"referenceDate":"2026-05-02"}]}"#)
                .answer("GET /api/v2/accounts/a2/balances/", 200, r#"{"balances":[{"balanceType":"closingBooked","balanceAmount":{"amount":"10.00","currency":"EUR"}}]}"#)
                .answer("GET /api/v2/accounts/a1/transactions/", 200, r#"{"transactions":{"booked":[
                    {"bookingDate":"2026-05-01","transactionAmount":{"amount":"-12.94","currency":"EUR"},"creditorName":"REWE Markt","creditorAccount":{"iban":"DE02120300000000202051"},"remittanceInformationUnstructured":"Kartenzahlung"},
                    {"bookingDate":"2026-05-02","transactionAmount":{"amount":"2650.00","currency":"EUR"},"debtorName":"Arbeitgeber","remittanceInformationUnstructuredArray":["Gehalt","Mai"]},
                    {"bookingDate":"2026-05-02","transactionAmount":{"amount":"-5.00","currency":"USD"},"creditorName":"Shop"},
                    {"transactionAmount":{"amount":"-1.00","currency":"EUR"}}
                  ],"pending":[{"bookingDate":"2026-05-03","transactionAmount":{"amount":"-3.00","currency":"EUR"}}]}}"#)
                .answer("GET /api/v2/accounts/a2/transactions/", 200, r#"{"transactions":{"booked":[]}}"#),
        );
        let out = c
            .fetch(&FetchRequest {
                credential: "r".into(),
                account_ids: vec![],
                since: time::macros::date!(2026 - 03 - 01),
                cursor: None,
            })
            .await
            .unwrap();
        assert_eq!(out.accounts.len(), 2);
        assert_eq!(out.accounts[0].name, "Giro");
        assert_eq!(out.accounts[0].mask.as_deref(), Some("3000"));
        assert_eq!(out.accounts[1].name, "Account");
        // 1234.56 (closing booked beats interim available) + 10.00
        assert_eq!(out.balance, Some(Money::from_cents(124_456)));
        assert_eq!(out.balance_date, Some(time::macros::date!(2026 - 05 - 02)));
        assert_eq!(out.transactions.len(), 2);
        assert_eq!(out.skipped, 2);
        let rewe = &out.transactions[0];
        assert_eq!(rewe.amount.cents(), -1294);
        assert_eq!(rewe.counterparty, "REWE Markt");
        assert_eq!(
            rewe.counterparty_iban.as_deref(),
            Some("DE02120300000000202051")
        );
        assert_eq!(out.transactions[1].counterparty, "Arbeitgeber");
        assert_eq!(out.transactions[1].purpose, "Gehalt Mai");
        let asked = fake.keys();
        assert!(asked
            .iter()
            .any(|k| k.contains("a1/transactions/?date_from=2026-03-01&date_to=")));
    }

    #[tokio::test]
    async fn fetch_can_be_limited_to_some_accounts() {
        let (c, fake) = client(
            FakeHttp::new()
                .answer("POST /api/v2/token/new/", 200, TOKEN)
                .answer(
                    "GET /api/v2/requisitions/r/",
                    200,
                    r#"{"id":"r","status":"LN","accounts":["a1","a2"]}"#,
                )
                .answer(
                    "GET /api/v2/accounts/a2/details/",
                    200,
                    r#"{"account":{"name":"Tagesgeld"}}"#,
                )
                .answer(
                    "GET /api/v2/accounts/a2/balances/",
                    200,
                    r#"{"balances":[]}"#,
                )
                .answer(
                    "GET /api/v2/accounts/a2/transactions/",
                    200,
                    r#"{"transactions":{"booked":[]}}"#,
                ),
        );
        let out = c
            .fetch(&FetchRequest {
                credential: "r".into(),
                account_ids: vec!["a2".into()],
                since: time::macros::date!(2026 - 03 - 01),
                cursor: None,
            })
            .await
            .unwrap();
        assert_eq!(out.accounts.len(), 1);
        assert_eq!(out.balance, None);
        assert_eq!(fake.count("GET /api/v2/accounts/a1"), 0);
    }

    #[tokio::test]
    async fn an_expired_consent_asks_to_sign_in_again() {
        let (c, _) = client(
            FakeHttp::new()
                .answer("POST /api/v2/token/new/", 200, TOKEN)
                .answer(
                    "GET /api/v2/requisitions/r/",
                    200,
                    r#"{"id":"r","status":"EX","accounts":[]}"#,
                ),
        );
        let e = c
            .fetch(&FetchRequest {
                credential: "r".into(),
                account_ids: vec![],
                since: time::macros::date!(2026 - 03 - 01),
                cursor: None,
            })
            .await
            .unwrap_err();
        assert!(e.needs_relink());
    }

    #[tokio::test]
    async fn rate_limits_are_recognised() {
        let (c, _) = client(
            FakeHttp::new()
                .answer("POST /api/v2/token/new/", 200, TOKEN)
                .answer("GET /api/v2/requisitions/r/", 429, r#"{"summary":"Rate limit exceeded","detail":"The rate limit for this resource is 4/day"}"#),
        );
        let e = c.poll("r").await.unwrap_err();
        assert!(e.rate_limited());
        assert!(!e.needs_relink());
    }

    #[test]
    fn debug_output_hides_the_keys() {
        let cfg = GoCardlessConfig::new("my-id".into(), "my-key".into());
        let shown = format!("{cfg:?}");
        assert!(!shown.contains("my-id") && !shown.contains("my-key"));
    }
}
