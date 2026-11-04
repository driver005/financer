use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, BankData, BankError, MockBank, TokenHash};
use financer_core::{Money, Transaction};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use time::macros::date;
use tower::ServiceExt;

const TOKEN: &str = "test-token";
const PIN: &str = "98765-secret-pin";

struct BankFixture;

impl BankFixture {
    fn tx(d: time::Date, who: &str, cents: i64) -> Transaction {
        Transaction {
            booking_date: d,
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

    async fn app_with(bank: Option<MockBank>, ttl: Option<Duration>) -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mut state = AppState::new(store).with_connection_poll(Duration::from_millis(10));
        if let Some(b) = bank {
            state = state.with_bank(Arc::new(b));
        }
        if let Some(t) = ttl {
            state = state.with_sync_ttl(t);
        }
        Api::router(state, TokenHash::new(TOKEN))
    }

    async fn send(
        app: &Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, String) {
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
        let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = res.status();
        (
            status,
            String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec())
                .unwrap(),
        )
    }

    fn json_of(s: &str) -> Value {
        serde_json::from_str(s).unwrap_or(Value::Null)
    }

    /// The same request for every provider: here a FinTS login sent with the request.
    fn request() -> Value {
        json!({
            "kind": "fints",
            "login": {"blz": "37050198", "user_id": "login-name", "iban": "DE89 3704 0044 0532 0130 00"},
            "pin": PIN,
            "days": 30
        })
    }

    async fn start(app: &Router, body: Value) -> (StatusCode, Value) {
        let (status, text) = Self::send(app, Method::POST, "/v1/bank/sync", Some(body)).await;
        (status, Self::json_of(&text))
    }

    /// Poll the sync until nothing is left to wait for, as the app does.
    async fn settle(app: &Router, id: &str) -> Value {
        for _ in 0..300 {
            let (status, text) =
                Self::send(app, Method::GET, &format!("/v1/bank/sync/{id}"), None).await;
            assert_eq!(status, StatusCode::OK, "{text}");
            let v = Self::json_of(&text);
            if !matches!(
                v["state"].as_str(),
                Some("syncing" | "needs_approval" | "needs_link")
            ) {
                return v;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the sync never settled");
    }

    fn id_of(started: &Value) -> String {
        started["id"].as_str().unwrap().to_string()
    }

    fn never_approved() -> MockBank {
        MockBank::new("x", (0..500).map(|_| Err(BankError::TanPending)).collect())
    }
}

#[tokio::test]
async fn full_sync_waits_for_approval_then_imports() {
    let app = BankFixture::app_with(
        Some(MockBank::new(
            "Bitte in der S-pushTAN-App bestätigen",
            vec![Err(BankError::TanPending), Ok(BankFixture::data())],
        )),
        None,
    )
    .await;

    let (status, started) = BankFixture::start(&app, BankFixture::request()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(started["state"], "needs_approval");
    assert_eq!(started["message"], "Bitte in der S-pushTAN-App bestätigen");
    assert_eq!(started["kind"], "fints");
    assert!(
        started["connection"].is_null(),
        "a login sent with the request"
    );
    assert!(started["expires_at"].as_i64().unwrap() > 1_700_000_000);
    let id = BankFixture::id_of(&started);

    // the server waits for the approval itself; the app only asks how it is going
    let done = BankFixture::settle(&app, &id).await;
    assert_eq!(done["state"], "idle");
    let r = &done["result"];
    assert_eq!(
        (
            r["imported"].clone(),
            r["duplicates"].clone(),
            r["skipped"].clone()
        ),
        (json!(2), json!(0), json!(1))
    );
    assert_eq!(r["balance_cents"], 123_456);

    // transactions are categorized like CSV imports
    let (_, list) = BankFixture::send(&app, Method::GET, "/v1/transactions", None).await;
    let list = BankFixture::json_of(&list);
    let rewe = list
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["counterparty"] == "REWE Markt")
        .unwrap();
    assert_eq!(rewe["category"], "groceries");

    // status: balance and non-secret prefill, never the PIN
    let (_, status_body) = BankFixture::send(&app, Method::GET, "/v1/bank/status", None).await;
    let st = BankFixture::json_of(&status_body);
    assert_eq!(
        (
            st["configured"].clone(),
            st["blz"].clone(),
            st["iban"].clone()
        ),
        (
            json!(true),
            json!("37050198"),
            json!("DE89370400440532013000")
        )
    );
    assert_eq!(st["balance_cents"], 123_456);
    assert!(st["last_sync_at"].as_i64().unwrap() > 1_700_000_000);
}

#[tokio::test]
async fn the_pin_never_appears_in_any_response() {
    let app = BankFixture::app_with(
        Some(MockBank::new("Bestätigen", vec![Ok(BankFixture::data())])),
        None,
    )
    .await;
    let mut seen = Vec::new();
    let (_, text) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    let id = BankFixture::id_of(&BankFixture::json_of(&text));
    seen.push(text);
    BankFixture::settle(&app, &id).await;
    seen.push(
        BankFixture::send(&app, Method::GET, &format!("/v1/bank/sync/{id}"), None)
            .await
            .1,
    );
    for uri in [
        "/v1/bank/status",
        "/v1/bank/connections",
        "/v1/bank/providers",
        "/v1/settings",
        "/v1/transactions",
    ] {
        seen.push(BankFixture::send(&app, Method::GET, uri, None).await.1);
    }
    assert!(
        seen.iter().all(|s| !s.contains(PIN)),
        "PIN leaked into a response"
    );
}

#[tokio::test]
async fn unknown_and_forgotten_syncs_are_404() {
    let app = BankFixture::app_with(Some(BankFixture::never_approved()), None).await;
    for (method, uri) in [
        (Method::GET, "/v1/bank/sync/nope"),
        (Method::POST, "/v1/bank/sync/nope/cancel"),
    ] {
        assert_eq!(
            BankFixture::send(&app, method, uri, None).await.0,
            StatusCode::NOT_FOUND,
            "{uri}"
        );
    }
}

#[tokio::test]
async fn an_approval_that_never_comes_ends_in_an_error() {
    let app = BankFixture::app_with(
        Some(BankFixture::never_approved()),
        Some(Duration::from_millis(60)),
    )
    .await;
    let (_, started) = BankFixture::start(&app, BankFixture::request()).await;
    assert_eq!(started["state"], "needs_approval");
    let done = BankFixture::settle(&app, &BankFixture::id_of(&started)).await;
    assert_eq!(done["state"], "error");
    assert!(done["message"]
        .as_str()
        .unwrap()
        .contains("did not arrive in time"));
    assert_eq!(done["result"]["ok"], false);
}

#[tokio::test]
async fn cancelling_stops_the_wait() {
    let app = BankFixture::app_with(Some(BankFixture::never_approved()), None).await;
    let (_, started) = BankFixture::start(&app, BankFixture::request()).await;
    let id = BankFixture::id_of(&started);
    let (status, text) = BankFixture::send(
        &app,
        Method::POST,
        &format!("/v1/bank/sync/{id}/cancel"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(BankFixture::json_of(&text)["state"], "idle");
}

#[tokio::test]
async fn a_new_login_replaces_the_one_that_is_waiting() {
    let app = BankFixture::app_with(Some(BankFixture::never_approved()), None).await;
    let (_, a) = BankFixture::start(&app, BankFixture::request()).await;
    let first = BankFixture::id_of(&a);
    let (_, b) = BankFixture::start(&app, BankFixture::request()).await;
    let second = BankFixture::id_of(&b);
    assert_ne!(first, second);
    assert_eq!(
        BankFixture::send(&app, Method::GET, &format!("/v1/bank/sync/{first}"), None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        BankFixture::send(&app, Method::GET, &format!("/v1/bank/sync/{second}"), None)
            .await
            .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn bank_failures_are_reported_with_their_reason() {
    // a rejected approval: the dialog is dropped
    let app = BankFixture::app_with(
        Some(MockBank::new(
            "x",
            vec![Err(BankError::Rejected("TAN abgelehnt".into()))],
        )),
        None,
    )
    .await;
    let (_, started) = BankFixture::start(&app, BankFixture::request()).await;
    let done = BankFixture::settle(&app, &BankFixture::id_of(&started)).await;
    assert_eq!(done["state"], "error");
    assert!(done["message"].as_str().unwrap().contains("TAN abgelehnt"));

    // a connection failure while waiting
    let app = BankFixture::app_with(
        Some(MockBank::new(
            "x",
            vec![Err(BankError::Connection("timeout".into()))],
        )),
        None,
    )
    .await;
    let (_, started) = BankFixture::start(&app, BankFixture::request()).await;
    let done = BankFixture::settle(&app, &BankFixture::id_of(&started)).await;
    assert_eq!(done["state"], "error");
    assert!(done["message"].as_str().unwrap().contains("timeout"));
}

#[tokio::test]
async fn without_a_product_id_the_server_explains_what_is_missing() {
    let app = BankFixture::app_with(None, None).await;
    let (status, body) = BankFixture::start(&app, BankFixture::request()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.to_string().contains("product id"));
    let (_, st) = BankFixture::send(&app, Method::GET, "/v1/bank/status", None).await;
    assert_eq!(BankFixture::json_of(&st)["configured"], false);
}

#[tokio::test]
async fn missing_fields_are_rejected_before_contacting_the_bank() {
    let bank = Arc::new(MockBank::new("x", vec![]));
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let app = Api::router(
        AppState::new(store).with_bank(bank.clone()),
        TokenHash::new(TOKEN),
    );
    for bad in [
        json!({"kind": "fints", "login": {"blz": "", "user_id": "u", "iban": "i"}, "pin": "p"}),
        json!({"kind": "fints", "login": {"blz": "1", "user_id": "u", "iban": "i"}, "pin": ""}),
        json!({"kind": "fints", "login": {"blz": "1", "user_id": "u", "iban": "i"}}),
        json!({"kind": "fints", "pin": "p"}),
        json!({"pin": "p"}),
    ] {
        let (status, body) = BankFixture::start(&app, bad.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {body}");
    }
    assert!(
        bank.started.lock().unwrap().is_empty(),
        "the bank was not asked"
    );
}

#[tokio::test]
async fn only_fints_takes_a_login_in_the_request() {
    let app = BankFixture::app_with(Some(MockBank::new("x", vec![])), None).await;
    for kind in ["plaid", "gocardless", "finapi", "csv", "nope"] {
        let mut body = BankFixture::request();
        body["kind"] = json!(kind);
        let (status, text) = BankFixture::start(&app, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{kind}: {text}");
    }
}

#[tokio::test]
async fn syncing_twice_does_not_duplicate_transactions() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let state = AppState::new(store).with_connection_poll(Duration::from_millis(10));
    for round in 0..2 {
        // a fresh scripted bank per round, on the same store
        let app = Api::router(
            state
                .clone()
                .with_bank(Arc::new(MockBank::new("x", vec![Ok(BankFixture::data())]))),
            TokenHash::new(TOKEN),
        );
        let (_, started) = BankFixture::start(&app, BankFixture::request()).await;
        let done = BankFixture::settle(&app, &BankFixture::id_of(&started)).await;
        assert_eq!(
            done["result"]["imported"],
            if round == 0 { 2 } else { 0 },
            "round {round}"
        );
    }
    let app = Api::router(state, TokenHash::new(TOKEN));
    let (_, list) = BankFixture::send(&app, Method::GET, "/v1/transactions", None).await;
    assert_eq!(BankFixture::json_of(&list).as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn two_wrong_pins_pause_syncing_to_protect_the_account() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let bank = Arc::new(MockBank::failing_start(|| BankError::WrongPin));
    let app = Api::router(
        AppState::new(store)
            .with_bank(bank.clone())
            .with_sync_ttl(Duration::from_secs(60)),
        TokenHash::new(TOKEN),
    );

    for attempt in 1..=2 {
        let (status, body) = BankFixture::start(&app, BankFixture::request()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "attempt {attempt}");
        assert!(
            body.to_string().contains("lock"),
            "the message warns about lockout: {body}"
        );
    }
    // third try: refused locally, the bank is not contacted again
    let (status, body) = BankFixture::start(&app, BankFixture::request()).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(body.to_string().contains("paused"));
    assert_eq!(bank.started.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn the_pause_ends_after_its_time() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let failing = Arc::new(MockBank::failing_start(|| BankError::WrongPin));
    let app = Api::router(
        AppState::new(store)
            .with_pin_pause(Duration::from_millis(60))
            .with_bank(failing),
        TokenHash::new(TOKEN),
    );
    for _ in 0..2 {
        BankFixture::start(&app, BankFixture::request()).await;
    }
    assert_eq!(
        BankFixture::start(&app, BankFixture::request()).await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
    // the pause is counted in whole minutes, so it ends a little later than 60 ms
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert_eq!(
        BankFixture::start(&app, BankFixture::request()).await.0,
        StatusCode::BAD_REQUEST,
        "after the pause one more try reaches the bank"
    );
}

#[tokio::test]
async fn a_locked_account_pauses_immediately() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let app = Api::router(
        AppState::new(store).with_bank(Arc::new(MockBank::failing_start(|| BankError::Locked))),
        TokenHash::new(TOKEN),
    );
    assert_eq!(
        BankFixture::start(&app, BankFixture::request()).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        BankFixture::start(&app, BankFixture::request()).await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
}

const CSV: &str = "\"Auftragskonto\";\"Buchungstag\";\"Valutadatum\";\"Buchungstext\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"BIC (SWIFT-Code)\";\"Betrag\";\"Waehrung\";\"Info\"\n\"DE89370400440532013000\";\"02.03.26\";\"02.03.26\";\"KARTENZAHLUNG\";\"REWE SAGT DANKE\";\"REWE Markt GmbH\";\"\";\"\";\"-23,47\";\"EUR\";\"Umsatz gebucht\"\n";

async fn upload(app: &Router, kind: &str, body: &str) -> (StatusCode, Value) {
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/v1/bank/import/{kind}"))
                .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                .header(header::CONTENT_TYPE, "text/csv")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn a_file_goes_through_the_same_api_and_the_same_import() {
    let app = BankFixture::app_with(None, None).await;
    let (status, report) = upload(&app, "csv", CSV).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (report["imported"].clone(), report["duplicates"].clone()),
        (json!(1), json!(0))
    );
    // the same file again: nothing new
    let (_, again) = upload(&app, "csv", CSV).await;
    assert_eq!(
        (again["imported"].clone(), again["duplicates"].clone()),
        (json!(0), json!(1))
    );
    // not a file this provider reads, or a provider that takes none
    assert_eq!(
        upload(&app, "csv", "not;a;sparkasse\nexport").await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(upload(&app, "fints", CSV).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(upload(&app, "plaid", CSV).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(upload(&app, "nope", CSV).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_provider_list_says_what_exists_how_it_works_and_what_is_set_up() {
    let without = BankFixture::app_with(None, None).await;
    let with = BankFixture::app_with(Some(MockBank::new("x", vec![])), None).await;
    for (app, fints_ready) in [(&without, false), (&with, true)] {
        let (status, text) = BankFixture::send(app, Method::GET, "/v1/bank/providers", None).await;
        assert_eq!(status, StatusCode::OK);
        let list = BankFixture::json_of(&text);
        let row = |kind: &str| {
            list.as_array()
                .unwrap()
                .iter()
                .find(|p| p["kind"] == kind)
                .unwrap()
                .clone()
        };
        assert_eq!(row("csv")["flow"], "file");
        assert_eq!(row("csv")["available"], true, "a file needs no setup");
        assert_eq!(row("fints")["flow"], "approval");
        assert_eq!(row("fints")["available"], fints_ready);
        for kind in ["plaid", "gocardless", "finapi"] {
            assert_eq!(row(kind)["flow"], "link", "{kind}");
            assert_eq!(row(kind)["available"], false, "{kind}");
        }
        assert_eq!(list.as_array().unwrap().len(), 5);
    }
}
