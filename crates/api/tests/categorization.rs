use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, LlmKeys, MockProvider, TokenHash};
use financer_llm::{LlmError, LlmProvider};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";
const IBAN: &str = "DE02120300000000202051";
const PURPOSE: &str = "SECRETPURPOSE4711";

/// Shares one mock between requests so a test can look at what the model was sent.
struct SharedMock(Arc<MockProvider>);

#[async_trait::async_trait]
impl LlmProvider for SharedMock {
    async fn complete_json(&self, system: &str, user: &str) -> Result<String, LlmError> {
        self.0.complete_json(system, user).await
    }
}

/// App, request helpers and sample bank data.
struct Fixture;

impl Fixture {
    async fn app() -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        Api::router(AppState::new(store), TokenHash::new(TOKEN))
    }

    async fn app_with_llm(answers: Vec<Result<String, String>>) -> (Router, Arc<MockProvider>) {
        let mock = Arc::new(MockProvider::with_answers(answers));
        let shared = mock.clone();
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let state = AppState::new(store)
            .with_llm_keys(LlmKeys {
                claude: Some("k".into()),
                openai: None,
            })
            .with_llm_factory(Arc::new(move |_| Ok(Box::new(SharedMock(shared.clone())))));
        (Api::router(state, TokenHash::new(TOKEN)), mock)
    }

    async fn call(
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

    async fn get(app: &Router, uri: &str) -> Value {
        let (status, body) = Self::call(app, Method::GET, uri, None).await;
        assert_eq!(status, StatusCode::OK, "{uri}: {body}");
        body
    }

    async fn import(app: &Router, rows: &[(&str, &str, &str, &str, &str)]) -> Value {
        let mut csv = String::from(
            "\"Auftragskonto\";\"Buchungstag\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"Betrag\"\n",
        );
        for (date, who, purpose, iban, amount) in rows {
            csv.push_str(&format!(
                "\"DE89370400440532013000\";\"{date}\";\"{purpose}\";\"{who}\";\"{iban}\";\"{amount}\"\n"
            ));
        }
        let req = Request::builder()
            .method(Method::POST)
            .uri("/v1/transactions/import")
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .header(header::CONTENT_TYPE, "text/csv")
            .body(Body::from(csv))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// Rewe, a kiosk twice and a shop nothing knows, all in March 2026.
    async fn bank() -> Router {
        let app = Self::app().await;
        Self::import_sample(&app).await;
        app
    }

    async fn import_sample(app: &Router) {
        Self::import(
            app,
            &[
                ("02.03.26", "REWE Markt", "Kartenzahlung", "", "-50,00"),
                ("03.03.26", "Kiosk Meier 12", "Kartenzahlung", "", "-4,50"),
                ("04.03.26", "Kiosk Meier 99", "Kartenzahlung", "", "-3,00"),
                ("05.03.26", "Zebra Laden", PURPOSE, IBAN, "-43,21"),
            ],
        )
        .await;
    }

    async fn txs(app: &Router) -> Vec<Value> {
        Self::get(app, "/v1/transactions")
            .await
            .as_array()
            .unwrap()
            .clone()
    }

    async fn id_of(app: &Router, counterparty: &str) -> i64 {
        Self::txs(app)
            .await
            .iter()
            .find(|t| {
                t["counterparty"]
                    .as_str()
                    .unwrap()
                    .starts_with(counterparty)
            })
            .unwrap()["id"]
            .as_i64()
            .unwrap()
    }

    async fn category_of(app: &Router, counterparty: &str) -> Value {
        Self::txs(app)
            .await
            .iter()
            .find(|t| {
                t["counterparty"]
                    .as_str()
                    .unwrap()
                    .starts_with(counterparty)
            })
            .unwrap()["category"]
            .clone()
    }

    async fn spent(app: &Router, category: &str) -> i64 {
        Self::call(
            app,
            Method::PUT,
            "/v1/budget/envelopes",
            Some(json!([{"category": category, "limit_cents": 100_000}])),
        )
        .await;
        let status = Self::get(app, "/v1/budget/status?year=2026&month=3").await;
        status[0]["spent_cents"].as_i64().unwrap()
    }
}

#[tokio::test]
async fn rules_crud_validation_and_reorder() {
    let app = Fixture::app().await;
    let (s, a) = Fixture::call(
        &app,
        Method::POST,
        "/v1/rules",
        Some(json!({"pattern": "kiosk", "kind": "contains", "category": "dining"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(a["sign"], Value::Null);
    let (_, b) = Fixture::call(
        &app,
        Method::POST,
        "/v1/rules",
        Some(
            json!({"pattern": "zebra", "kind": "starts_with", "sign": "expense",
                    "min_cents": 100, "max_cents": 9999, "category": "leisure"}),
        ),
    )
    .await;
    assert_eq!(b["min_cents"], 100);
    let (id_a, id_b) = (a["id"].as_i64().unwrap(), b["id"].as_i64().unwrap());

    let list = Fixture::get(&app, "/v1/rules").await;
    assert_eq!(list[0]["id"], id_a);
    assert_eq!(list[1]["id"], id_b);

    let (s, c) = Fixture::call(
        &app,
        Method::PUT,
        &format!("/v1/rules/{id_a}"),
        Some(json!({"pattern": "  Kiosk Meier ", "kind": "equals", "category": "shopping"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        (c["pattern"].clone(), c["kind"].clone()),
        (json!("Kiosk Meier"), json!("equals"))
    );

    // validation
    for bad in [
        json!({"pattern": "  12 ", "kind": "contains", "category": "dining"}),
        json!({"pattern": "x", "kind": "contains", "min_cents": 10, "max_cents": 5, "category": "dining"}),
        json!({"pattern": "x", "kind": "contains", "min_cents": -5, "category": "dining"}),
    ] {
        let (s, e) = Fixture::call(&app, Method::POST, "/v1/rules", Some(bad)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{e}");
    }
    let (s, _) = Fixture::call(
        &app,
        Method::PUT,
        "/v1/rules/999",
        Some(json!({"pattern": "x", "kind": "contains", "category": "dining"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // reorder
    let (s, reordered) = Fixture::call(
        &app,
        Method::POST,
        "/v1/rules/reorder",
        Some(json!({"ids": [id_b, id_a]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(reordered[0]["id"], id_b);
    let (s, _) = Fixture::call(
        &app,
        Method::POST,
        "/v1/rules/reorder",
        Some(json!({"ids": [id_b]})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // delete
    let (s, _) = Fixture::call(&app, Method::DELETE, &format!("/v1/rules/{id_a}"), None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = Fixture::call(&app, Method::DELETE, &format!("/v1/rules/{id_a}"), None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(
        Fixture::get(&app, "/v1/rules")
            .await
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn user_rules_apply_on_import_and_win_over_built_in_rules() {
    let app = Fixture::app().await;
    Fixture::call(
        &app,
        Method::POST,
        "/v1/rules",
        Some(json!({"pattern": "kiosk", "kind": "contains", "category": "dining"})),
    )
    .await;
    // "rewe" is groceries by the built-in rules; the user says leisure
    Fixture::call(
        &app,
        Method::POST,
        "/v1/rules",
        Some(json!({"pattern": "rewe", "kind": "starts_with", "category": "leisure"})),
    )
    .await;
    Fixture::import_sample(&app).await;
    assert_eq!(Fixture::category_of(&app, "Kiosk Meier 12").await, "dining");
    assert_eq!(Fixture::category_of(&app, "REWE").await, "leisure");
    assert_eq!(Fixture::category_of(&app, "Zebra").await, "other");
}

#[tokio::test]
async fn apply_rules_to_existing_transactions_counts_changes_and_spares_manual_ones() {
    let app = Fixture::bank().await;
    assert_eq!(Fixture::category_of(&app, "Kiosk Meier 12").await, "other");
    Fixture::call(
        &app,
        Method::POST,
        "/v1/rules",
        Some(json!({"pattern": "kiosk", "kind": "contains", "category": "dining"})),
    )
    .await;
    // a hand-made choice must survive
    let kiosk99 = Fixture::id_of(&app, "Kiosk Meier 99").await;
    let (s, _) = Fixture::call(
        &app,
        Method::PUT,
        &format!("/v1/transactions/{kiosk99}/category"),
        Some(json!({"category": "health"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, report) = Fixture::call(&app, Method::POST, "/v1/rules/apply", None).await;
    assert_eq!((s, report["changed"].clone()), (StatusCode::OK, json!(1)));
    assert_eq!(Fixture::category_of(&app, "Kiosk Meier 12").await, "dining");
    assert_eq!(Fixture::category_of(&app, "Kiosk Meier 99").await, "health");
    let (_, again) = Fixture::call(&app, Method::POST, "/v1/rules/apply", None).await;
    assert_eq!(again["changed"], 0);
}

#[tokio::test]
async fn recategorizing_can_remember_the_merchant() {
    let app = Fixture::bank().await;
    // without `remember` only this transaction changes and no rule appears
    let kiosk12 = Fixture::id_of(&app, "Kiosk Meier 12").await;
    let (s, r) = Fixture::call(
        &app,
        Method::PUT,
        &format!("/v1/transactions/{kiosk12}/category"),
        Some(json!({"category": "dining"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(r["transaction"]["category"], "dining");
    assert_eq!(
        (r["rule"].clone(), r["others_changed"].clone()),
        (Value::Null, json!(0))
    );
    assert!(Fixture::get(&app, "/v1/rules")
        .await
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(Fixture::category_of(&app, "Kiosk Meier 99").await, "other");

    // with `remember` the merchant gets a rule and the sibling follows
    let (_, r) = Fixture::call(
        &app,
        Method::PUT,
        &format!("/v1/transactions/{kiosk12}/category"),
        Some(json!({"category": "leisure", "remember": true})),
    )
    .await;
    assert_eq!(r["rule"]["pattern"], "kiosk meier");
    assert_eq!(r["rule"]["kind"], "equals");
    assert_eq!(r["others_changed"], 1);
    assert_eq!(
        Fixture::category_of(&app, "Kiosk Meier 99").await,
        "leisure"
    );

    // correcting again updates the same rule instead of adding another
    Fixture::call(
        &app,
        Method::PUT,
        &format!("/v1/transactions/{kiosk12}/category"),
        Some(json!({"category": "shopping", "remember": true})),
    )
    .await;
    let rules = Fixture::get(&app, "/v1/rules").await;
    assert_eq!(rules.as_array().unwrap().len(), 1);
    assert_eq!(rules[0]["category"], "shopping");

    // future imports follow the learned rule
    Fixture::import(
        &app,
        &[("20.03.26", "KIOSK MEIER 5", "Kartenzahlung", "", "-2,00")],
    )
    .await;
    assert_eq!(
        Fixture::category_of(&app, "KIOSK MEIER 5").await,
        "shopping"
    );

    let (s, _) = Fixture::call(
        &app,
        Method::PUT,
        "/v1/transactions/9999/category",
        Some(json!({"category": "dining"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn splits_must_add_up_and_category_totals_use_the_parts() {
    let app = Fixture::bank().await;
    // March groceries: the whole Rewe booking (50,00)
    assert_eq!(Fixture::spent(&app, "groceries").await, 5000);

    let rewe = Fixture::id_of(&app, "REWE").await;
    let uri = format!("/v1/transactions/{rewe}/split");
    let (s, e) = Fixture::call(
        &app,
        Method::PUT,
        &uri,
        Some(json!({"parts": [
            {"amount_cents": -3000, "category": "groceries"},
            {"amount_cents": -1999, "category": "shopping"}]})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{e}");
    assert_eq!(Fixture::spent(&app, "groceries").await, 5000); // nothing changed

    for bad in [
        json!({"parts": [{"amount_cents": -5000, "category": "groceries"}]}),
        json!({"parts": [{"amount_cents": -6000, "category": "groceries"},
                         {"amount_cents": 1000, "category": "shopping"}]}),
    ] {
        let (s, _) = Fixture::call(&app, Method::PUT, &uri, Some(bad)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    let (s, split) = Fixture::call(
        &app,
        Method::PUT,
        &uri,
        Some(json!({"parts": [
            {"amount_cents": -3000, "category": "groceries", "note": "food"},
            {"amount_cents": -2000, "category": "shopping"}]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(split["transaction_id"], rewe);
    assert_eq!(split["parts"][0]["note"], "food");

    // the bank record is untouched, the totals use the parts
    assert_eq!(Fixture::category_of(&app, "REWE").await, "groceries");
    assert_eq!(Fixture::spent(&app, "groceries").await, 3000);
    assert_eq!(Fixture::spent(&app, "shopping").await, 2000);
    let listed = Fixture::get(&app, "/v1/transactions/splits").await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["parts"].as_array().unwrap().len(), 2);

    // removing the split counts the booking as a whole again
    let (s, _) = Fixture::call(&app, Method::DELETE, &uri, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(Fixture::spent(&app, "groceries").await, 5000);
    let (s, _) = Fixture::call(&app, Method::DELETE, &uri, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = Fixture::call(
        &app,
        Method::PUT,
        "/v1/transactions/9999/split",
        Some(json!({"parts": [{"amount_cents": -1, "category": "dining"},
                              {"amount_cents": -1, "category": "dining"}]})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

const SUGGESTIONS: &str = r#"```json
{"suggestions":[
 {"merchant":"Kiosk Meier","category":"Dining"},
 {"merchant":"zebra laden","category":"shopping"},
 {"merchant":"never sent","category":"dining"},
 {"merchant":"kiosk meier","category":"health"},
 {"merchant":"rewe markt","category":"income"}
]}
```"#;

#[tokio::test]
async fn llm_fallback_sends_only_merchant_names_and_returns_vetted_suggestions() {
    let (app, mock) = Fixture::app_with_llm(vec![Ok(SUGGESTIONS.into())]).await;
    Fixture::import_sample(&app).await;

    let (s, body) = Fixture::call(
        &app,
        Method::POST,
        "/v1/transactions/categorize-unknown",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{body}");
    // Rewe is already groceries, so only the kiosk and the zebra shop are unknown
    assert_eq!(body["merchants_sent"], 2);
    let suggestions = body["suggestions"].as_array().unwrap();
    assert_eq!(
        suggestions.len(),
        2,
        "unsent merchants, repeats and disallowed categories are dropped: {body}"
    );
    assert_eq!(
        (
            suggestions[0]["merchant"].clone(),
            suggestions[0]["category"].clone(),
            suggestions[0]["transactions"].clone()
        ),
        (json!("kiosk meier"), json!("dining"), json!(2))
    );
    assert_eq!(suggestions[1]["merchant"], "zebra laden");

    // privacy: names and categories only
    let sent = {
        let requests = mock.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        format!("{} {}", requests[0].0, requests[0].1)
    };
    assert!(sent.contains("kiosk meier") && sent.contains("zebra laden"));
    assert!(sent.contains("groceries") && sent.contains("dining"));
    for secret in [
        IBAN, PURPOSE, "4,50", "43,21", "450", "4321", "2026", "DE89", "rewe", "REWE",
    ] {
        assert!(!sent.contains(secret), "{secret} must not be sent: {sent}");
    }

    // nothing changed yet
    assert_eq!(Fixture::category_of(&app, "Zebra").await, "other");
    assert!(Fixture::get(&app, "/v1/rules")
        .await
        .as_array()
        .unwrap()
        .is_empty());

    // accepting creates rules and recategorizes
    let (s, report) = Fixture::call(
        &app,
        Method::POST,
        "/v1/transactions/categorize-unknown/accept",
        Some(json!({"suggestions": [
            {"merchant": "kiosk meier", "category": "dining"},
            {"merchant": "zebra laden", "category": "shopping"}]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        (
            report["rules_saved"].clone(),
            report["transactions_changed"].clone()
        ),
        (json!(2), json!(3))
    );
    assert_eq!(Fixture::category_of(&app, "Kiosk Meier 99").await, "dining");
    assert_eq!(Fixture::category_of(&app, "Zebra").await, "shopping");
    assert_eq!(
        Fixture::get(&app, "/v1/rules")
            .await
            .as_array()
            .unwrap()
            .len(),
        2
    );

    // all merchants are placed now: asking again calls no model
    let (s, again) = Fixture::call(
        &app,
        Method::POST,
        "/v1/transactions/categorize-unknown",
        None,
    )
    .await;
    assert_eq!(
        (s, again["merchants_sent"].clone()),
        (StatusCode::OK, json!(0))
    );
    assert_eq!(mock.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn accepting_rejects_categories_suggestions_cannot_use() {
    let app = Fixture::bank().await;
    for bad in [
        json!({"merchant": "zebra", "category": "income"}),
        json!({"merchant": "zebra", "category": "other"}),
        json!({"merchant": "1234", "category": "dining"}),
    ] {
        let (s, _) = Fixture::call(
            &app,
            Method::POST,
            "/v1/transactions/categorize-unknown/accept",
            Some(json!({"suggestions": [bad]})),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }
    assert!(Fixture::get(&app, "/v1/rules")
        .await
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn llm_fallback_failures_are_reported_not_hidden() {
    // no key configured
    let app = Fixture::bank().await;
    let (s, _) = Fixture::call(
        &app,
        Method::POST,
        "/v1/transactions/categorize-unknown",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);

    // provider failure and nonsense answers
    for answer in [
        Err("overloaded".to_string()),
        Ok("I cannot help".to_string()),
    ] {
        let (app, _) = Fixture::app_with_llm(vec![answer]).await;
        Fixture::import_sample(&app).await;
        let (s, _) = Fixture::call(
            &app,
            Method::POST,
            "/v1/transactions/categorize-unknown",
            None,
        )
        .await;
        assert_eq!(s, StatusCode::BAD_GATEWAY);
    }
}

#[tokio::test]
async fn new_routes_need_the_token() {
    let app = Fixture::app().await;
    for (method, uri) in [
        (Method::GET, "/v1/rules"),
        (Method::POST, "/v1/rules"),
        (Method::PUT, "/v1/rules/1"),
        (Method::DELETE, "/v1/rules/1"),
        (Method::POST, "/v1/rules/apply"),
        (Method::POST, "/v1/rules/reorder"),
        (Method::PUT, "/v1/transactions/1/category"),
        (Method::PUT, "/v1/transactions/1/split"),
        (Method::DELETE, "/v1/transactions/1/split"),
        (Method::GET, "/v1/transactions/splits"),
        (Method::POST, "/v1/transactions/categorize-unknown"),
        (Method::POST, "/v1/transactions/categorize-unknown/accept"),
    ] {
        let res = app
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
