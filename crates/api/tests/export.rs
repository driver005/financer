use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{router, AppState, LlmKeys, MockBank, TokenHash};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";

async fn app() -> Router {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let state = AppState::new(store)
        .with_llm_keys(LlmKeys {
            claude: Some("sk-claude-very-secret".into()),
            openai: None,
        })
        .with_bank(Arc::new(MockBank::new("x", vec![])));
    router(state, TokenHash::new(TOKEN))
}

async fn send(
    app: &Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
    csv: Option<&str>,
) -> (StatusCode, String) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
    let body = match (body, csv) {
        (Some(b), _) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        (None, Some(c)) => {
            req = req.header(header::CONTENT_TYPE, "text/csv");
            Body::from(c.to_string())
        }
        _ => Body::empty(),
    };
    let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status();
    (
        status,
        String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap(),
    )
}

fn j(s: &str) -> Value {
    serde_json::from_str(s).unwrap_or(Value::Null)
}

const CSV: &str = "\"Buchungstag\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"Betrag\"\n\
\"02.03.26\";\"Kartenzahlung\";\"REWE Markt\";\"\";\"-23,47\"\n\
\"28.03.26\";\"Gehalt\";\"Arbeitgeber AG\";\"DE02120300000000202051\";\"2.500,00\"\n";

const RECEIPT: &str =
    "REWE Markt GmbH\nVOLLMILCH 1,19 B\nSPAGHETTI 500G 0,89 A\nSUMME 2,08\n02.03.26\n";

async fn seeded() -> Router {
    let a = app().await;
    send(&a, Method::POST, "/v1/transactions/import", None, Some(CSV)).await;
    send(
        &a,
        Method::PUT,
        "/v1/budget/envelopes",
        Some(json!([{"category":"groceries","limit_cents":40000}])),
        None,
    )
    .await;
    send(
        &a,
        Method::PUT,
        "/v1/basket",
        Some(json!([{"item":"milch","quantity":2}])),
        None,
    )
    .await;
    send(
        &a,
        Method::POST,
        "/v1/receipts",
        Some(json!({"text": RECEIPT})),
        None,
    )
    .await;
    send(
        &a,
        Method::PUT,
        "/v1/settings",
        Some(json!({"habit_mode":"receipts","llm_provider":"open_ai","llm_model":"gpt-x"})),
        None,
    )
    .await;
    a
}

#[tokio::test]
async fn export_then_import_moves_everything_to_a_fresh_backend() {
    let a = seeded().await;
    let (status, exported) = send(&a, Method::GET, "/v1/export", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let doc = j(&exported);
    assert_eq!(
        (
            doc["version"].clone(),
            doc["transactions"].as_array().unwrap().len()
        ),
        (json!(1), 2)
    );

    let b = app().await;
    let (status, report) = send(&b, Method::POST, "/v1/import", Some(doc.clone()), None).await;
    assert_eq!(status, StatusCode::OK);
    let r = j(&report);
    assert_eq!(
        (
            r["transactions_added"].clone(),
            r["receipts_added"].clone(),
            r["budget_envelopes"].clone(),
            r["basket_items"].clone()
        ),
        (json!(2), json!(1), json!(1), json!(1))
    );

    // the new backend now holds the same data
    let (_, a_tx) = send(&a, Method::GET, "/v1/transactions", None, None).await;
    let (_, b_tx) = send(&b, Method::GET, "/v1/transactions", None, None).await;
    let strip = |s: &str| -> Vec<Value> {
        j(s).as_array()
            .unwrap()
            .iter()
            .map(|t| {
                let mut t = t.clone();
                t.as_object_mut().unwrap().remove("id");
                t
            })
            .collect()
    };
    assert_eq!(strip(&a_tx), strip(&b_tx));
    // the new backend exports exactly what the old one did
    let again = j(&send(&b, Method::GET, "/v1/export", None, None).await.1);
    for part in ["budget", "basket", "receipts", "settings", "transactions"] {
        assert_eq!(again[part], doc[part], "{part} differs after the move");
    }
    let (_, st) = send(&b, Method::GET, "/v1/settings", None, None).await;
    assert_eq!(
        (j(&st)["habit_mode"].clone(), j(&st)["llm_provider"].clone()),
        (json!("receipts"), json!("open_ai"))
    );
}

#[tokio::test]
async fn importing_twice_changes_nothing() {
    let a = seeded().await;
    let doc = j(&send(&a, Method::GET, "/v1/export", None, None).await.1);
    let b = app().await;
    send(&b, Method::POST, "/v1/import", Some(doc.clone()), None).await;
    let (_, second) = send(&b, Method::POST, "/v1/import", Some(doc), None).await;
    let r = j(&second);
    assert_eq!(
        (
            r["transactions_added"].clone(),
            r["transactions_known"].clone()
        ),
        (json!(0), json!(2))
    );
    assert_eq!(
        (r["receipts_added"].clone(), r["receipts_known"].clone()),
        (json!(0), json!(1))
    );
    assert_eq!(
        j(&send(&b, Method::GET, "/v1/transactions", None, None)
            .await
            .1)
        .as_array()
        .unwrap()
        .len(),
        2
    );
}

#[tokio::test]
async fn an_invalid_file_changes_nothing() {
    let a = seeded().await;
    let mut doc = j(&send(&a, Method::GET, "/v1/export", None, None).await.1);
    let b = app().await;

    doc["basket"] = json!([{"item": "kaviar", "quantity": 1}]);
    assert_eq!(
        send(&b, Method::POST, "/v1/import", Some(doc.clone()), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        j(&send(&b, Method::GET, "/v1/transactions", None, None)
            .await
            .1)
        .as_array()
        .unwrap()
        .len(),
        0,
        "validated before anything is written"
    );

    doc["basket"] = json!([]);
    doc["version"] = json!(2);
    assert_eq!(
        send(&b, Method::POST, "/v1/import", Some(doc.clone()), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );

    doc["version"] = json!(1);
    doc["receipts"][0]["receipt"] = json!({"nonsense": true});
    assert_eq!(
        send(&b, Method::POST, "/v1/import", Some(doc.clone()), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );

    doc["receipts"] = json!([]);
    doc["settings"]["habit_mode"] = json!("magic");
    assert_eq!(
        send(&b, Method::POST, "/v1/import", Some(doc), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        j(&send(&b, Method::GET, "/v1/transactions", None, None)
            .await
            .1)
        .as_array()
        .unwrap()
        .len(),
        0
    );
}

#[tokio::test]
async fn the_export_contains_no_secrets() {
    let a = seeded().await;
    // a finished bank sync leaves non-secret prefill settings only; make sure none of it is exported
    let (_, body) = send(&a, Method::GET, "/v1/export", None, None).await;
    for secret in ["sk-claude-very-secret", TOKEN, "bank_", "pin"] {
        assert!(
            !body.to_lowercase().contains(&secret.to_lowercase()),
            "export leaks {secret:?}"
        );
    }
}

#[tokio::test]
async fn export_routes_need_the_token() {
    let a = app().await;
    for (m, uri) in [(Method::GET, "/v1/export"), (Method::POST, "/v1/import")] {
        let res = a
            .clone()
            .oneshot(
                Request::builder()
                    .method(m)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{uri}");
    }
}
