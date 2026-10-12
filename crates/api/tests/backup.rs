use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";
const PASSPHRASE: &str = "correct horse battery";

struct BackupFixture;

impl BackupFixture {
    async fn app() -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        Api::router(AppState::new(store), TokenHash::new(TOKEN))
    }

    async fn send(
        app: &Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
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
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn seeded() -> Router {
        let a = Self::app().await;
        let csv = "\"Buchungstag\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"Betrag\"\n\
\"02.03.26\";\"Kartenzahlung\";\"REWE Markt\";\"\";\"-23,47\"\n\
\"28.03.26\";\"Gehalt\";\"Arbeitgeber AG\";\"DE02120300000000202051\";\"2.500,00\"\n";
        let res = a
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/transactions/import")
                    .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                    .header(header::CONTENT_TYPE, "text/csv")
                    .body(Body::from(csv))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        Self::send(
            &a,
            Method::PUT,
            "/v1/budget/envelopes",
            Some(json!([{"category":"groceries","limit_cents":40000}])),
        )
        .await;
        a
    }

    async fn count(app: &Router) -> usize {
        Self::send(app, Method::GET, "/v1/transactions", None)
            .await
            .1
            .as_array()
            .unwrap()
            .len()
    }
}

#[tokio::test]
async fn a_backup_round_trips_to_a_fresh_backend() {
    let a = BackupFixture::seeded().await;
    let (status, backup) = BackupFixture::send(
        &a,
        Method::POST,
        "/v1/backup/create",
        Some(json!({"passphrase": PASSPHRASE})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(backup["transactions"], json!(2));
    let data = backup["data_base64"].as_str().unwrap();
    // it is encrypted: no readable data and no passphrase in the response
    assert!(!data.contains("REWE") && !data.contains(PASSPHRASE));

    let b = BackupFixture::app().await;
    let (status, report) = BackupFixture::send(
        &b,
        Method::POST,
        "/v1/backup/restore",
        Some(json!({"passphrase": PASSPHRASE, "data_base64": data})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(report["transactions_added"], json!(2));
    assert_eq!(report["budget_envelopes"], json!(1));
    assert_eq!(BackupFixture::count(&b).await, 2);

    // restoring again is harmless
    let (_, again) = BackupFixture::send(
        &b,
        Method::POST,
        "/v1/backup/restore",
        Some(json!({"passphrase": PASSPHRASE, "data_base64": data})),
    )
    .await;
    assert_eq!(again["transactions_added"], json!(0));
    assert_eq!(BackupFixture::count(&b).await, 2);
}

#[tokio::test]
async fn a_wrong_passphrase_or_damaged_file_fails_and_changes_nothing() {
    let a = BackupFixture::seeded().await;
    let (_, backup) = BackupFixture::send(
        &a,
        Method::POST,
        "/v1/backup/create",
        Some(json!({"passphrase": PASSPHRASE})),
    )
    .await;
    let data = backup["data_base64"].as_str().unwrap().to_string();
    let b = BackupFixture::app().await;

    let (status, err) = BackupFixture::send(
        &b,
        Method::POST,
        "/v1/backup/restore",
        Some(json!({"passphrase": "wrong passphrase", "data_base64": data})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        !err.to_string().contains("wrong passphrase"),
        "the passphrase is never echoed"
    );

    // flip one character in the middle of the file
    let mut damaged: Vec<u8> = data.clone().into_bytes();
    let mid = damaged.len() / 2;
    damaged[mid] = if damaged[mid] == b'A' { b'B' } else { b'A' };
    for bad in [
        String::from_utf8(damaged).unwrap(),
        data[..data.len() / 2].to_string(),
        "not base64 !!!".to_string(),
        String::new(),
        "AAAA".to_string(),
    ] {
        let (status, _) = BackupFixture::send(
            &b,
            Method::POST,
            "/v1/backup/restore",
            Some(json!({"passphrase": PASSPHRASE, "data_base64": bad})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    assert_eq!(BackupFixture::count(&b).await, 0);
}

#[tokio::test]
async fn short_passphrases_are_refused_and_routes_need_the_token() {
    let a = BackupFixture::app().await;
    let (status, _) = BackupFixture::send(
        &a,
        Method::POST,
        "/v1/backup/create",
        Some(json!({"passphrase": "short"})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    for uri in ["/v1/backup/create", "/v1/backup/restore"] {
        let res = a
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{uri}");
    }
}
