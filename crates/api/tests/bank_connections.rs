//! Bank connections from the server configuration: listing, syncing with the PIN from the app or
//! the environment, the wait for pushTAN approval, idempotent import, and the scheduler. The bank
//! is a scripted stand-in; nothing here talks to a real bank.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, BankConnection, BankData, BankError, TokenHash};
use financer_core::{Money, Transaction};
use financer_fints::{BankClient, PendingSync, SyncParams, TanChallenge};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use time::macros::date;
use tower::ServiceExt;

const TOKEN: &str = "test-token";
const PIN: &str = "98765-secret-pin";
const ENV_PIN: &str = "55555-env-secret-pin";

type Script = Vec<Result<BankData, BankError>>;
/// What a login sent: (pin, user, days, bank address).
type Login = (String, String, u32, Option<String>);

/// A bank that answers each login with the next script. Once a script is used up, `confirm` keeps
/// answering "not approved yet".
struct ScriptedBank {
    logins: Mutex<VecDeque<Result<Script, BankError>>>,
    seen: Mutex<Vec<Login>>,
}

impl ScriptedBank {
    fn new(logins: Vec<Result<Script, BankError>>) -> Arc<Self> {
        Arc::new(Self {
            logins: Mutex::new(logins.into()),
            seen: Mutex::new(Vec::new()),
        })
    }

    fn logins_seen(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
}

struct ScriptedPending(VecDeque<Result<BankData, BankError>>);

#[async_trait]
impl PendingSync for ScriptedPending {
    async fn confirm(&mut self) -> Result<BankData, BankError> {
        self.0.pop_front().unwrap_or(Err(BankError::TanPending))
    }
}

/// Lets the test keep a handle on the bank the app state owns.
struct Shared(Arc<ScriptedBank>);

#[async_trait]
impl BankClient for Shared {
    async fn start(
        &self,
        params: &SyncParams,
    ) -> Result<(Box<dyn PendingSync>, TanChallenge), BankError> {
        let bank = &self.0;
        bank.seen.lock().unwrap().push((
            params.pin.clone(),
            params.user_id.clone(),
            params.days,
            params.fints_url.clone(),
        ));
        let next = bank.logins.lock().unwrap().pop_front();
        match next {
            Some(Ok(script)) => Ok((
                Box::new(ScriptedPending(script.into())),
                TanChallenge {
                    text: "Bitte in der S-pushTAN-App bestätigen".into(),
                    no_tan_required: false,
                },
            )),
            Some(Err(e)) => Err(e),
            None => Err(BankError::Connection("no more logins scripted".into())),
        }
    }
}

struct Fixture {
    app: Router,
    state: AppState,
    bank: Arc<ScriptedBank>,
}

impl Fixture {
    fn tx(day: time::Date, who: &str, cents: i64) -> Transaction {
        Transaction {
            booking_date: day,
            amount: Money::from_cents(cents),
            counterparty: who.into(),
            purpose: "Kartenzahlung".into(),
            counterparty_iban: None,
            category: None,
        }
    }

    fn data() -> BankData {
        BankData {
            balance: Some(Money::from_cents(123_456)),
            balance_date: Some(date!(2026 - 03 - 09)),
            transactions: vec![
                Self::tx(date!(2026 - 03 - 02), "REWE Markt", -2347),
                Self::tx(date!(2026 - 03 - 03), "Arbeitgeber AG Gehalt", 250_000),
            ],
            skipped: 1,
        }
    }

    /// Approved after one "not yet" answer.
    fn approved_after_a_wait() -> Result<Script, BankError> {
        Ok(vec![Err(BankError::TanPending), Ok(Self::data())])
    }

    fn connection(name: &str, hours: u32, pin_env: Option<&str>) -> BankConnection {
        BankConnection {
            name: name.into(),
            bank_code: "37050198".into(),
            login: "login-name-123".into(),
            iban: "DE89 3704 0044 0532 0130 00".into(),
            bic: None,
            fints_url: None,
            pin_env: pin_env.map(str::to_string),
            sync_every_hours: hours,
            since_days: Some(30),
        }
    }

    async fn new(
        logins: Vec<Result<Script, BankError>>,
        connections: Vec<BankConnection>,
        tweak: impl FnOnce(AppState) -> AppState,
    ) -> Fixture {
        let bank = ScriptedBank::new(logins);
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let state = tweak(
            AppState::new(store)
                .with_bank(Arc::new(Shared(bank.clone())))
                .with_bank_connections(connections)
                .with_connection_poll(Duration::from_millis(10))
                .with_pin_lookup(|var| (var == "SPARKASSE_PIN").then(|| ENV_PIN.to_string())),
        );
        Fixture {
            app: Api::router(state.clone(), TokenHash::new(TOKEN)),
            state,
            bank,
        }
    }

    async fn send(&self, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, String) {
        let mut req = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        let body = match body {
            Some(b) => {
                req = req.header(header::CONTENT_TYPE, "application/json");
                Body::from(b.to_string())
            }
            None => Body::empty(),
        };
        let res = self
            .app
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    async fn json(&self, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let (s, text) = self.send(method, uri, body).await;
        (s, serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    async fn connection_json(&self, name: &str) -> Value {
        let (_, list) = self.json(Method::GET, "/v1/bank/connections", None).await;
        list.as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .cloned()
            .unwrap_or(Value::Null)
    }

    async fn wait_for_state(&self, name: &str, state: &str) -> Value {
        for _ in 0..300 {
            let c = self.connection_json(name).await;
            if c["state"] == state {
                return c;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "{name} never reached {state}: {}",
            self.connection_json(name).await
        );
    }

    async fn transactions(&self) -> Vec<Value> {
        let (_, t) = self.json(Method::GET, "/v1/transactions", None).await;
        t.as_array().unwrap().clone()
    }

    async fn sync(&self, name: &str, pin: Option<&str>) -> (StatusCode, Value) {
        self.json(
            Method::POST,
            &format!("/v1/bank/connections/{name}/sync"),
            pin.map(|p| json!({ "pin": p })),
        )
        .await
    }
}

#[tokio::test]
async fn lists_connections_without_secrets() {
    let f = Fixture::new(
        vec![],
        vec![
            Fixture::connection("Giro", 12, Some("SPARKASSE_PIN")),
            Fixture::connection("Tagesgeld", 0, None),
        ],
        |s| s,
    )
    .await;
    let (status, text) = f.send(Method::GET, "/v1/bank/connections", None).await;
    assert_eq!(status, StatusCode::OK);
    for secret in [
        "login-name-123",
        "DE89370400440532013000",
        "0044 0532",
        ENV_PIN,
        "SPARKASSE_PIN",
    ] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
    let list: Value = serde_json::from_str(&text).unwrap();
    let giro = &list[0];
    assert_eq!(giro["name"], "Giro");
    assert_eq!(giro["kind"], "fints");
    assert_eq!(giro["bank_code"], "37050198");
    assert_eq!(giro["login_masked"], "lo****");
    assert_eq!(giro["iban_masked"], "DE89****3000");
    assert_eq!(giro["state"], "idle");
    assert_eq!(giro["pin_from_env"], true);
    assert_eq!(giro["sync_every_hours"], 12);
    assert_eq!(giro["sync_due"], false); // the server has the PIN: it starts by itself
    assert!(giro["next_sync_at"].as_i64().is_some());
    assert_eq!(giro["last_sync_at"], Value::Null);
    let tages = &list[1];
    assert_eq!(tages["pin_from_env"], false);
    assert_eq!(tages["next_sync_at"], Value::Null); // manual only
    assert_eq!(tages["sync_due"], false);
}

#[tokio::test]
async fn without_a_configuration_the_list_is_empty() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let app = Api::router(AppState::new(store), TokenHash::new(TOKEN));
    let res = app
        .oneshot(
            Request::builder()
                .uri("/v1/bank/connections")
                .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"[]");
}

#[tokio::test]
async fn needs_the_token() {
    let f = Fixture::new(vec![], vec![Fixture::connection("Giro", 0, None)], |s| s).await;
    for (method, uri) in [
        (Method::GET, "/v1/bank/connections"),
        (Method::POST, "/v1/bank/connections/Giro/sync"),
        (Method::POST, "/v1/bank/connections/Giro/cancel"),
    ] {
        let res = f
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{uri}");
    }
}

#[tokio::test]
async fn a_synced_connection_waits_for_approval_then_imports_without_leaking_the_pin() {
    let f = Fixture::new(
        vec![Fixture::approved_after_a_wait()],
        vec![Fixture::connection("Giro", 0, None)],
        |s| s,
    )
    .await;
    let mut responses = Vec::new();

    let (status, text) = f
        .send(
            Method::POST,
            "/v1/bank/connections/Giro/sync",
            Some(json!({ "pin": PIN })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    responses.push(text.clone());
    let started: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(started["state"], "needs_approval");
    assert_eq!(started["message"], "Bitte in der S-pushTAN-App bestätigen");
    assert!(started["approval_expires_at"].as_i64().unwrap() > 1_700_000_000);

    // the server polls the bank itself; no further call from the app is needed
    let done = f.wait_for_state("Giro", "idle").await;
    responses.push(done.to_string());
    assert_eq!(done["last_result"]["ok"], true);
    assert_eq!(done["last_result"]["imported"], 2);
    assert_eq!(done["last_result"]["duplicates"], 0);
    assert_eq!(done["last_result"]["skipped"], 1);
    assert_eq!(done["message"], Value::Null);
    assert!(done["last_sync_at"].as_i64().unwrap() > 1_700_000_000);
    assert_eq!(done["balance_cents"], 123_456);
    assert_eq!(done["balance_date"], "2026-03-09");

    // categorized like a CSV import
    let txs = f.transactions().await;
    assert_eq!(txs.len(), 2);
    let rewe = txs
        .iter()
        .find(|t| t["counterparty"] == "REWE Markt")
        .unwrap();
    assert_eq!(rewe["category"], "groceries");

    // the bank got the typed PIN and the configured first-import range
    let seen = f.bank.seen.lock().unwrap().clone();
    assert_eq!(
        seen,
        vec![(PIN.to_string(), "login-name-123".to_string(), 30, None)]
    );

    for uri in [
        "/v1/bank/connections",
        "/v1/bank/status",
        "/v1/settings",
        "/v1/transactions",
    ] {
        responses.push(f.send(Method::GET, uri, None).await.1);
    }
    assert!(responses.iter().all(|r| !r.contains(PIN)), "PIN leaked");
}

#[tokio::test]
async fn syncing_the_same_period_twice_imports_nothing_new() {
    let f = Fixture::new(
        vec![Ok(vec![Ok(Fixture::data())]), Ok(vec![Ok(Fixture::data())])],
        vec![Fixture::connection("Giro", 0, None)],
        |s| s,
    )
    .await;
    assert_eq!(f.sync("Giro", Some(PIN)).await.0, StatusCode::OK);
    let first = f.wait_for_state("Giro", "idle").await;
    assert_eq!(first["last_result"]["imported"], 2);

    assert_eq!(f.sync("Giro", Some(PIN)).await.0, StatusCode::OK);
    // wait for the second result (the state passes through needs_approval and back to idle)
    for _ in 0..300 {
        let c = f.connection_json("Giro").await;
        if c["state"] == "idle"
            && c["last_result"]["at"].as_i64() >= first["last_result"]["at"].as_i64()
            && c["last_result"]["duplicates"] == 2
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let second = f.connection_json("Giro").await;
    assert_eq!(second["last_result"]["imported"], 0);
    assert_eq!(second["last_result"]["duplicates"], 2);
    assert_eq!(f.transactions().await.len(), 2);

    // the second sync reads only a few days back: since the last sync plus an overlap
    let seen = f.bank.seen.lock().unwrap().clone();
    assert_eq!(seen[0].2, 30);
    assert_eq!(seen[1].2, 8);
}

#[tokio::test]
async fn the_pin_comes_from_the_environment_variable_when_there_is_one() {
    let f = Fixture::new(
        vec![Ok(vec![Ok(Fixture::data())])],
        vec![Fixture::connection("Giro", 0, Some("SPARKASSE_PIN"))],
        |s| s,
    )
    .await;
    let (status, started) = f.sync("Giro", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!started.to_string().contains(ENV_PIN));
    f.wait_for_state("Giro", "idle").await;
    assert_eq!(f.bank.seen.lock().unwrap()[0].0, ENV_PIN);
}

#[tokio::test]
async fn a_missing_pin_is_a_clear_400_and_nothing_is_started() {
    let f = Fixture::new(
        vec![],
        vec![
            Fixture::connection("Typed", 0, None),
            Fixture::connection("Env", 0, Some("OTHER_PIN_VARIABLE")),
        ],
        |s| s,
    )
    .await;
    let (status, body) = f.sync("Typed", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("enter your PIN"));
    let (status, body) = f.sync("Env", Some("")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("OTHER_PIN_VARIABLE"));
    assert_eq!(f.bank.logins_seen(), 0);
    assert_eq!(f.connection_json("Typed").await["state"], "idle");
}

#[tokio::test]
async fn unknown_connections_and_a_missing_product_id() {
    let f = Fixture::new(vec![], vec![Fixture::connection("Giro", 0, None)], |s| s).await;
    assert_eq!(f.sync("Nope", Some(PIN)).await.0, StatusCode::NOT_FOUND);
    let (status, _) = f
        .json(Method::POST, "/v1/bank/connections/Nope/cancel", None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // connections configured but no bank client (no FinTS product id)
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let state =
        AppState::new(store).with_bank_connections(vec![Fixture::connection("Giro", 1, Some("X"))]);
    let app = Api::router(state.clone(), TokenHash::new(TOKEN));
    let res = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/v1/bank/connections/Giro/sync")
                .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"pin": PIN}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(Api::run_due_bank_syncs(&state).await, 0);
}

#[tokio::test]
async fn names_are_matched_without_regard_to_case_and_a_second_start_conflicts() {
    let f = Fixture::new(
        vec![Ok(vec![])], // never approved
        vec![Fixture::connection("Giro Konto", 0, None)],
        |s| s,
    )
    .await;
    let (status, _) = f.sync("giro%20konto", Some(PIN)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = f.sync("Giro%20Konto", Some(PIN)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body["error"].as_str().unwrap().contains("already running"));
    assert_eq!(f.bank.logins_seen(), 1);
}

#[tokio::test]
async fn cancelling_stops_the_wait() {
    let f = Fixture::new(
        vec![Ok(vec![Ok(Fixture::data())])],
        vec![Fixture::connection("Giro", 0, None)],
        |s| s.with_connection_poll(Duration::from_millis(200)),
    )
    .await;
    f.sync("Giro", Some(PIN)).await;
    assert_eq!(f.connection_json("Giro").await["state"], "needs_approval");
    let (status, c) = f
        .json(Method::POST, "/v1/bank/connections/Giro/cancel", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c["state"], "idle");
    tokio::time::sleep(Duration::from_millis(500)).await;
    // the approval never got collected: nothing imported
    assert!(f.transactions().await.is_empty());
    assert_eq!(f.connection_json("Giro").await["state"], "idle");
}

#[tokio::test]
async fn an_approval_that_never_comes_ends_in_an_error_that_can_be_retried() {
    let f = Fixture::new(
        vec![Ok(vec![]), Ok(vec![Ok(Fixture::data())])],
        vec![Fixture::connection("Giro", 0, None)],
        |s| s.with_sync_ttl(Duration::from_millis(60)),
    )
    .await;
    f.sync("Giro", Some(PIN)).await;
    let c = f.wait_for_state("Giro", "error").await;
    assert!(c["message"]
        .as_str()
        .unwrap()
        .contains("did not arrive in time"));
    assert_eq!(c["last_result"]["ok"], false);

    // an error from a timeout is not a refused login: syncing again works
    assert_eq!(f.sync("Giro", Some(PIN)).await.0, StatusCode::OK);
    let ok = f.wait_for_state("Giro", "idle").await;
    assert_eq!(ok["last_result"]["ok"], true);
}

#[tokio::test]
async fn bank_errors_are_reported_with_the_http_status_of_the_manual_flow() {
    let f = Fixture::new(
        vec![
            Err(BankError::Connection("down".into())),
            Err(BankError::Rejected("Konto nicht freigegeben".into())),
        ],
        vec![Fixture::connection("Giro", 0, None)],
        |s| s,
    )
    .await;
    let (status, body) = f.sync("Giro", Some(PIN)).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(!body.to_string().contains(PIN));
    let c = f.connection_json("Giro").await;
    assert_eq!(c["state"], "error");
    assert!(c["message"].as_str().unwrap().contains("down"));

    let (status, _) = f.sync("Giro", Some(PIN)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(f.connection_json("Giro").await["message"]
        .as_str()
        .unwrap()
        .contains("Konto nicht freigegeben"));
}

#[tokio::test]
async fn the_scheduler_starts_due_connections_by_itself_and_then_waits_for_approval() {
    let f = Fixture::new(
        vec![Fixture::approved_after_a_wait()],
        vec![
            Fixture::connection("Auto", 6, Some("SPARKASSE_PIN")),
            Fixture::connection("Manual", 0, Some("SPARKASSE_PIN")),
            Fixture::connection("Typed", 6, None),
        ],
        |s| s.with_connection_poll(Duration::from_millis(150)),
    )
    .await;
    // Typed is due too, but the server has no PIN for it: the app has to start it
    let typed = f.connection_json("Typed").await;
    assert_eq!(typed["sync_due"], true);
    assert_eq!(f.connection_json("Auto").await["sync_due"], false);

    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 1);
    let auto = f.connection_json("Auto").await;
    assert_eq!(auto["state"], "needs_approval");
    assert_eq!(f.bank.seen.lock().unwrap()[0].0, ENV_PIN);
    assert_eq!(f.connection_json("Manual").await["state"], "idle");
    assert_eq!(f.connection_json("Typed").await["state"], "idle");

    // running: not started a second time
    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 0);
    assert_eq!(f.bank.logins_seen(), 1);

    // approved and imported; the next one is six hours away
    let done = f.wait_for_state("Auto", "idle").await;
    assert_eq!(done["last_result"]["imported"], 2);
    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 0);
    assert_eq!(f.bank.logins_seen(), 1);
    let next = done["next_sync_at"].as_i64().unwrap();
    let last = done["last_sync_at"].as_i64().unwrap();
    assert!((next - last - 6 * 3600).abs() < 60, "{next} {last}");
}

#[tokio::test]
async fn a_refused_login_is_never_retried_by_the_scheduler() {
    let f = Fixture::new(
        vec![Err(BankError::WrongPin), Ok(vec![Ok(Fixture::data())])],
        vec![Fixture::connection("Auto", 1, Some("SPARKASSE_PIN"))],
        |s| s,
    )
    .await;
    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 0); // started, but the bank said no
    let c = f.connection_json("Auto").await;
    assert_eq!(c["state"], "error");
    assert!(c["message"].as_str().unwrap().contains("PIN"));
    assert_eq!(f.bank.logins_seen(), 1);

    // nothing retries it, however often the scheduler looks
    for _ in 0..3 {
        assert_eq!(Api::run_due_bank_syncs(&f.state).await, 0);
    }
    assert_eq!(f.bank.logins_seen(), 1);
    assert_eq!(f.connection_json("Auto").await["state"], "error");

    // a sync by hand with a corrected PIN works and re-arms the schedule
    assert_eq!(f.sync("Auto", Some(PIN)).await.0, StatusCode::OK);
    let ok = f.wait_for_state("Auto", "idle").await;
    assert_eq!(ok["last_result"]["ok"], true);
    assert_eq!(f.transactions().await.len(), 2);
}

#[tokio::test]
async fn a_failed_scheduled_attempt_waits_for_the_next_interval() {
    let f = Fixture::new(
        vec![Err(BankError::Connection("bank unreachable".into()))],
        vec![Fixture::connection("Auto", 1, Some("SPARKASSE_PIN"))],
        |s| s,
    )
    .await;
    Api::run_due_bank_syncs(&f.state).await;
    assert_eq!(f.connection_json("Auto").await["state"], "error");
    // an unreachable bank is not a reason to hammer it every minute
    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 0);
    assert_eq!(f.bank.logins_seen(), 1);
}

#[tokio::test]
async fn the_configured_bank_address_is_passed_on() {
    let mut conn = Fixture::connection("Giro", 0, None);
    conn.fints_url = Some("https://fints.example.invalid/fints".into());
    conn.bic = Some("GENODEF1XXX".into());
    let f = Fixture::new(vec![Ok(vec![Ok(Fixture::data())])], vec![conn], |s| s).await;
    f.sync("Giro", Some(PIN)).await;
    f.wait_for_state("Giro", "idle").await;
    assert_eq!(
        f.bank.seen.lock().unwrap()[0].3.as_deref(),
        Some("https://fints.example.invalid/fints")
    );
}
