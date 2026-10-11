use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";

struct ApiFixture;

impl ApiFixture {
    async fn app() -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        Api::router(AppState::new(store), TokenHash::new(TOKEN))
    }

    async fn call(
        app: &Router,
        method: Method,
        uri: &str,
        body: Body,
        content_type: Option<&str>,
        auth: bool,
    ) -> (StatusCode, Vec<u8>) {
        let mut req = Request::builder().method(method).uri(uri);
        if auth {
            req = req.header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        }
        if let Some(ct) = content_type {
            req = req.header(header::CONTENT_TYPE, ct);
        }
        let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = res.status();
        (
            status,
            res.into_body().collect().await.unwrap().to_bytes().to_vec(),
        )
    }

    async fn get_json(app: &Router, uri: &str) -> (StatusCode, Value) {
        let (s, b) = Self::call(app, Method::GET, uri, Body::empty(), None, true).await;
        (s, serde_json::from_slice(&b).unwrap_or(Value::Null))
    }

    fn csv() -> String {
        let mut out = String::from(
            "\"Auftragskonto\";\"Buchungstag\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"Betrag\"\n",
        );
        for (d, who, purpose, amount) in [
            ("01.01.26", "Vermieter", "Miete Januar", "-800,00"),
            ("01.02.26", "Vermieter", "Miete Februar", "-800,00"),
            ("01.03.26", "Vermieter", "Miete Maerz", "-800,00"),
            ("28.01.26", "Arbeitgeber AG", "Gehalt", "2.500,00"),
            ("27.02.26", "Arbeitgeber AG", "Gehalt", "2.500,00"),
            ("28.03.26", "Arbeitgeber AG", "Gehalt", "2.500,00"),
            ("02.03.26", "REWE Markt", "Kartenzahlung", "-23,47"),
            ("09.03.26", "LIDL", "Kartenzahlung", "-31,03"),
        ] {
            out.push_str(&format!(
                "\"DE89370400440532013000\";\"{d}\";\"{purpose}\";\"{who}\";\"\";\"{amount}\"\n"
            ));
        }
        out
    }
}

#[tokio::test]
async fn health_is_open_but_v1_needs_the_token() {
    let app = ApiFixture::app().await;
    let (s, b) = ApiFixture::call(&app, Method::GET, "/health", Body::empty(), None, false).await;
    assert_eq!((s, b.as_slice()), (StatusCode::OK, b"ok".as_slice()));

    let (s, _) = ApiFixture::call(
        &app,
        Method::GET,
        "/v1/transactions",
        Body::empty(),
        None,
        false,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let req = Request::builder()
        .uri("/v1/transactions")
        .header(header::AUTHORIZATION, "Bearer wrong")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn import_categorizes_and_dedupes() {
    let app = ApiFixture::app().await;
    let (s, b) = ApiFixture::call(
        &app,
        Method::POST,
        "/v1/transactions/import",
        Body::from(ApiFixture::csv()),
        Some("text/csv"),
        true,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let report: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!(report["imported"], 8);
    assert_eq!(report["duplicates"], 0);

    let (_, b) = ApiFixture::call(
        &app,
        Method::POST,
        "/v1/transactions/import",
        Body::from(ApiFixture::csv()),
        Some("text/csv"),
        true,
    )
    .await;
    let again: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!(again["imported"], 0);
    assert_eq!(again["duplicates"], 8);

    let (s, list) = ApiFixture::get_json(&app, "/v1/transactions").await;
    assert_eq!(s, StatusCode::OK);
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 8);
    let rewe = list
        .iter()
        .find(|t| t["counterparty"] == "REWE Markt")
        .unwrap();
    assert_eq!(rewe["category"], "groceries");
    assert_eq!(rewe["amount_cents"], -2347);
    assert_eq!(rewe["booking_date"], "2026-03-02");
}

#[tokio::test]
async fn import_rejects_other_files() {
    let app = ApiFixture::app().await;
    let (s, b) = ApiFixture::call(
        &app,
        Method::POST,
        "/v1/transactions/import",
        Body::from("a;b\n1;2\n"),
        Some("text/csv"),
        true,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(String::from_utf8_lossy(&b).contains("not a Sparkasse CSV export"));
}

#[tokio::test]
async fn recurring_and_disposable_income() {
    let app = ApiFixture::app().await;
    ApiFixture::call(
        &app,
        Method::POST,
        "/v1/transactions/import",
        Body::from(ApiFixture::csv()),
        Some("text/csv"),
        true,
    )
    .await;

    let (_, rec) = ApiFixture::get_json(&app, "/v1/recurring").await;
    let rec = rec.as_array().unwrap();
    assert_eq!(rec.len(), 2);
    assert!(rec.iter().all(|r| r["cadence"] == "monthly"));

    let (_, d) = ApiFixture::get_json(&app, "/v1/budget/disposable").await;
    assert_eq!(d["monthly_income_cents"], 250_000);
    assert_eq!(d["monthly_fixed_costs_cents"], 80_000);
    assert_eq!(d["disposable_cents"], 170_000);
}

#[tokio::test]
async fn envelopes_and_status() {
    let app = ApiFixture::app().await;
    ApiFixture::call(
        &app,
        Method::POST,
        "/v1/transactions/import",
        Body::from(ApiFixture::csv()),
        Some("text/csv"),
        true,
    )
    .await;

    let put = json!([{"category": "groceries", "limit_cents": 40000}, {"category": "dining", "limit_cents": 5000}]);
    let (s, _) = ApiFixture::call(
        &app,
        Method::PUT,
        "/v1/budget/envelopes",
        Body::from(put.to_string()),
        Some("application/json"),
        true,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (_, status) = ApiFixture::get_json(&app, "/v1/budget/status?year=2026&month=3").await;
    let groceries = status
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["category"] == "groceries")
        .unwrap();
    assert_eq!(groceries["spent_cents"], 2347 + 3103);
    assert_eq!(groceries["remaining_cents"], 40000 - 2347 - 3103);

    let (s, _) = ApiFixture::get_json(&app, "/v1/budget/status?year=2026&month=13").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let dup = json!([{"category": "groceries", "limit_cents": 1}, {"category": "groceries", "limit_cents": 2}]);
    let (s, _) = ApiFixture::call(
        &app,
        Method::PUT,
        "/v1/budget/envelopes",
        Body::from(dup.to_string()),
        Some("application/json"),
        true,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let neg = json!([{"category": "groceries", "limit_cents": -1}]);
    let (s, _) = ApiFixture::call(
        &app,
        Method::PUT,
        "/v1/budget/envelopes",
        Body::from(neg.to_string()),
        Some("application/json"),
        true,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[test]
fn openapi_document_lists_every_route() {
    let doc: Value = serde_json::from_str(&financer_api::Api::openapi_json()).unwrap();
    let paths = doc["paths"].as_object().unwrap();
    for p in [
        "/health",
        "/v1/export",
        "/v1/import",
        "/v1/bank/sync",
        "/v1/bank/sync/{id}/confirm",
        "/v1/bank/status",
        "/v1/prices",
        "/v1/prices/best",
        "/v1/prices/refresh",
        "/v1/catalog",
        "/v1/basket",
        "/v1/receipts",
        "/v1/receipts/scan",
        "/v1/receipts/{id}",
        "/v1/affordability",
        "/v1/recipes",
        "/v1/recipes/ideas",
        "/v1/settings",
        "/v1/transactions",
        "/v1/transactions/import",
        "/v1/recurring",
        "/v1/budget/disposable",
        "/v1/budget/envelopes",
        "/v1/budget/status",
    ] {
        assert!(paths.contains_key(p), "missing {p}");
    }
}

#[tokio::test]
async fn too_many_wrong_tokens_lock_the_api_even_for_the_right_one() {
    let app = ApiFixture::app().await;
    let wrong = || {
        Request::builder()
            .uri("/v1/transactions")
            .header(header::AUTHORIZATION, "Bearer nope")
            .body(Body::empty())
            .unwrap()
    };
    for _ in 0..20 {
        assert_eq!(
            app.clone().oneshot(wrong()).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        app.clone().oneshot(wrong()).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    ); // 21st trips the lock
    let res = app.clone().oneshot(wrong()).await.unwrap();
    assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(res.headers().get(header::RETRY_AFTER).is_some());

    let (status, _) = ApiFixture::call(
        &app,
        Method::GET,
        "/v1/transactions",
        Body::empty(),
        None,
        true,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "a locked API refuses everyone for the lockout period"
    );

    // /health stays open for uptime checks
    let (status, _) =
        ApiFixture::call(&app, Method::GET, "/health", Body::empty(), None, false).await;
    assert_eq!(status, StatusCode::OK);
}
