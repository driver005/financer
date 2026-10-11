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
        let mut state = AppState::new(store);
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

    fn request() -> Value {
        json!({"blz": "37050198", "user_id": "login-name", "pin": PIN, "iban": "DE89 3704 0044 0532 0130 00", "days": 30})
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

    let (status, body) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let started = BankFixture::json_of(&body);
    assert_eq!(
        started["challenge"],
        "Bitte in der S-pushTAN-App bestätigen"
    );
    let id = started["sync_id"].as_str().unwrap().to_string();

    // not approved yet -> 409, and the sync stays alive
    let (status, body) = BankFixture::send(
        &app,
        Method::POST,
        &format!("/v1/bank/sync/{id}/confirm"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(BankFixture::json_of(&body)["error"]
        .as_str()
        .unwrap()
        .contains("waiting"));

    let (status, body) = BankFixture::send(
        &app,
        Method::POST,
        &format!("/v1/bank/sync/{id}/confirm"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let done = BankFixture::json_of(&body);
    assert_eq!(
        (
            done["imported"].clone(),
            done["duplicates"].clone(),
            done["skipped"].clone()
        ),
        (json!(2), json!(0), json!(1))
    );
    assert_eq!(done["balance_cents"], 123_456);

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

    // a finished sync cannot be confirmed twice
    assert_eq!(
        BankFixture::send(
            &app,
            Method::POST,
            &format!("/v1/bank/sync/{id}/confirm"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_pin_never_appears_in_any_response() {
    let app = BankFixture::app_with(
        Some(MockBank::new("Bestätigen", vec![Ok(BankFixture::data())])),
        None,
    )
    .await;
    let mut seen = Vec::new();
    let (_, b) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    let id = BankFixture::json_of(&b)["sync_id"]
        .as_str()
        .unwrap()
        .to_string();
    seen.push(b);
    seen.push(
        BankFixture::send(
            &app,
            Method::POST,
            &format!("/v1/bank/sync/{id}/confirm"),
            None,
        )
        .await
        .1,
    );
    for uri in ["/v1/bank/status", "/v1/settings", "/v1/transactions"] {
        seen.push(BankFixture::send(&app, Method::GET, uri, None).await.1);
    }
    assert!(
        seen.iter().all(|s| !s.contains(PIN)),
        "PIN leaked into a response"
    );
}

#[tokio::test]
async fn unknown_wrong_and_expired_syncs_are_404() {
    let app = BankFixture::app_with(
        Some(MockBank::new("x", vec![Ok(BankFixture::data())])),
        Some(Duration::from_millis(50)),
    )
    .await;
    assert_eq!(
        BankFixture::send(&app, Method::POST, "/v1/bank/sync/nope/confirm", None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    let (_, b) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    let id = BankFixture::json_of(&b)["sync_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        BankFixture::send(&app, Method::POST, "/v1/bank/sync/other-id/confirm", None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    tokio::time::sleep(Duration::from_millis(120)).await;
    assert_eq!(
        BankFixture::send(
            &app,
            Method::POST,
            &format!("/v1/bank/sync/{id}/confirm"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn a_new_sync_replaces_the_pending_one() {
    let app = BankFixture::app_with(
        Some(MockBank::new("x", vec![Ok(BankFixture::data())])),
        None,
    )
    .await;
    let (_, a) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    let first = BankFixture::json_of(&a)["sync_id"]
        .as_str()
        .unwrap()
        .to_string();
    let (_, b) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    let second = BankFixture::json_of(&b)["sync_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(first, second);
    assert_eq!(
        BankFixture::send(
            &app,
            Method::POST,
            &format!("/v1/bank/sync/{first}/confirm"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn bank_failures_map_to_clear_statuses() {
    // rejected approval: dialog is dropped
    let app = BankFixture::app_with(
        Some(MockBank::new(
            "x",
            vec![Err(BankError::Rejected("TAN abgelehnt".into()))],
        )),
        None,
    )
    .await;
    let (_, b) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    let id = BankFixture::json_of(&b)["sync_id"]
        .as_str()
        .unwrap()
        .to_string();
    let (status, body) = BankFixture::send(
        &app,
        Method::POST,
        &format!("/v1/bank/sync/{id}/confirm"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("TAN abgelehnt"));
    assert_eq!(
        BankFixture::send(
            &app,
            Method::POST,
            &format!("/v1/bank/sync/{id}/confirm"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    // connection failure -> 502
    let app = BankFixture::app_with(
        Some(MockBank::new(
            "x",
            vec![Err(BankError::Connection("timeout".into()))],
        )),
        None,
    )
    .await;
    let (_, b) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    let id = BankFixture::json_of(&b)["sync_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        BankFixture::send(
            &app,
            Method::POST,
            &format!("/v1/bank/sync/{id}/confirm"),
            None
        )
        .await
        .0,
        StatusCode::BAD_GATEWAY
    );
}

#[tokio::test]
async fn without_a_product_id_the_server_explains_what_is_missing() {
    let app = BankFixture::app_with(None, None).await;
    let (status, body) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.contains("product id"));
    let (_, st) = BankFixture::send(&app, Method::GET, "/v1/bank/status", None).await;
    assert_eq!(BankFixture::json_of(&st)["configured"], false);
}

#[tokio::test]
async fn missing_fields_are_rejected_before_contacting_the_bank() {
    let bank = MockBank::new("x", vec![]);
    let app = BankFixture::app_with(Some(bank), None).await;
    for bad in [
        json!({"blz": "", "user_id": "u", "pin": "p", "iban": "i"}),
        json!({"blz": "1", "user_id": "u", "pin": "", "iban": "i"}),
    ] {
        assert_eq!(
            BankFixture::send(&app, Method::POST, "/v1/bank/sync", Some(bad))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
}

#[tokio::test]
async fn syncing_twice_does_not_duplicate_transactions() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let state = AppState::new(store);
    for round in 0..2 {
        // a fresh scripted bank per round, on the same store
        let app = Api::router(
            state
                .clone()
                .with_bank(Arc::new(MockBank::new("x", vec![Ok(BankFixture::data())]))),
            TokenHash::new(TOKEN),
        );
        let (_, b) = BankFixture::send(
            &app,
            Method::POST,
            "/v1/bank/sync",
            Some(BankFixture::request()),
        )
        .await;
        let id = BankFixture::json_of(&b)["sync_id"]
            .as_str()
            .unwrap()
            .to_string();
        let (_, done) = BankFixture::send(
            &app,
            Method::POST,
            &format!("/v1/bank/sync/{id}/confirm"),
            None,
        )
        .await;
        assert_eq!(
            BankFixture::json_of(&done)["imported"],
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
        let (status, body) = BankFixture::send(
            &app,
            Method::POST,
            "/v1/bank/sync",
            Some(BankFixture::request()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "attempt {attempt}");
        assert!(
            body.contains("lock"),
            "the message warns about lockout: {body}"
        );
    }
    // third try: refused locally, the bank is not contacted again
    let (status, body) = BankFixture::send(
        &app,
        Method::POST,
        "/v1/bank/sync",
        Some(BankFixture::request()),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(body.contains("paused"));
    assert_eq!(bank.started.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn the_pause_ends_and_a_good_login_resets_the_count() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let failing = Arc::new(MockBank::failing_start(|| BankError::WrongPin));
    let state = AppState::new(store).with_pin_pause(Duration::from_millis(60));
    let app = Api::router(state.clone().with_bank(failing), TokenHash::new(TOKEN));
    for _ in 0..2 {
        BankFixture::send(
            &app,
            Method::POST,
            "/v1/bank/sync",
            Some(BankFixture::request()),
        )
        .await;
    }
    assert_eq!(
        BankFixture::send(
            &app,
            Method::POST,
            "/v1/bank/sync",
            Some(BankFixture::request())
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );

    tokio::time::sleep(Duration::from_millis(120)).await;
    // after the pause one more try reaches the bank (and fails again: strike one of a new round)
    assert_eq!(
        BankFixture::send(
            &app,
            Method::POST,
            "/v1/bank/sync",
            Some(BankFixture::request())
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    // a successful login in between resets the count
    let good = Api::router(
        state.with_bank(Arc::new(MockBank::new("x", vec![Ok(BankFixture::data())]))),
        TokenHash::new(TOKEN),
    );
    assert_eq!(
        BankFixture::send(
            &good,
            Method::POST,
            "/v1/bank/sync",
            Some(BankFixture::request())
        )
        .await
        .0,
        StatusCode::OK
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
        BankFixture::send(
            &app,
            Method::POST,
            "/v1/bank/sync",
            Some(BankFixture::request())
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        BankFixture::send(
            &app,
            Method::POST,
            "/v1/bank/sync",
            Some(BankFixture::request())
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
}
