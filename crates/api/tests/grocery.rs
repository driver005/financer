use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{
    router, AppState, FakeHttp, LlmKeys, MockProvider, PriceSourceConfig, TokenHash,
};
use financer_core::Chain;
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";

fn page(items: &[(&str, &str, &str)]) -> String {
    let products: Vec<String> = items
        .iter()
        .map(|(name, price, size)| {
            format!(
                r#"{{"@type":"Product","name":"{name}","size":"{size}","offers":{{"@type":"Offer","price":"{price}","priceCurrency":"EUR"}}}}"#
            )
        })
        .collect();
    format!(
        r#"<script type="application/ld+json">[{}]</script>"#,
        products.join(",")
    )
}

fn sources() -> Vec<PriceSourceConfig> {
    vec![
        PriceSourceConfig::JsonLd {
            chain: Chain::Aldi,
            urls: vec!["https://aldi.test/offers".into()],
            is_offer: true,
        },
        PriceSourceConfig::JsonLd {
            chain: Chain::Lidl,
            urls: vec!["https://lidl.test/offers".into()],
            is_offer: false,
        },
    ]
}

fn fake_web() -> Arc<FakeHttp> {
    Arc::new(FakeHttp::with(vec![
        (
            "https://aldi.test/offers",
            200,
            &page(&[
                ("Vollmilch", "0.89", "1 l"),
                ("Spaghetti", "0.89", "500 g"),
                ("Playstation", "499.00", "1 Stück"),
            ]),
        ),
        (
            "https://lidl.test/offers",
            200,
            &page(&[
                ("Vollmilch", "0.99", "1 l"),
                ("Spaghetti", "1.58", "1 kg"),
                ("Passierte Tomaten", "0.55", "500 ml"),
            ]),
        ),
    ]))
}

async fn app_with(state: impl FnOnce(AppState) -> AppState) -> Router {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    router(state(AppState::new(store)), TokenHash::new(TOKEN))
}

async fn app() -> Router {
    app_with(|s| s.with_http(fake_web()).with_price_sources(sources())).await
}

async fn send(app: &Router, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
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

async fn get(app: &Router, uri: &str) -> (StatusCode, Value) {
    send(app, Method::GET, uri, None).await
}

#[tokio::test]
async fn refresh_needs_sources() {
    let app = app_with(|s| s).await;
    let (status, body) = send(&app, Method::POST, "/v1/prices/refresh", None).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body["error"].as_str().unwrap().contains("no price sources"));
}

#[tokio::test]
async fn refresh_normalizes_and_prices_are_comparable() {
    let app = app().await;
    let (status, report) = send(&app, Method::POST, "/v1/prices/refresh", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(report["stored"], 5);
    assert_eq!(report["unmatched"], 1); // the Playstation
    assert!(report["sources"]
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["ok"] == true));

    let (_, milk) = get(&app, "/v1/prices?item=milch").await;
    let milk = milk.as_array().unwrap();
    assert_eq!(milk.len(), 2);
    assert_eq!(
        (milk[0]["chain"].as_str(), milk[0]["price_cents"].as_i64()),
        (Some("aldi"), Some(89))
    );
    assert_eq!(milk[0]["reference_pack"], "1 l");
    assert_eq!(milk[0]["is_offer"], true);

    // Lidl sells 1 kg for 1,58: per 500 g reference pack that is 0,79, cheaper than Aldi's 0,89
    let (_, pasta) = get(&app, "/v1/prices?item=nudeln").await;
    let pasta = pasta.as_array().unwrap();
    assert_eq!(
        (pasta[0]["chain"].as_str(), pasta[0]["price_cents"].as_i64()),
        (Some("lidl"), Some(79))
    );
    assert_eq!(pasta[0]["shelf_price_cents"], 158);
}

#[tokio::test]
async fn a_failing_source_keeps_its_old_prices() {
    let http = fake_web();
    let app = app_with(|s| s.with_http(http.clone()).with_price_sources(sources())).await;
    send(&app, Method::POST, "/v1/prices/refresh", None).await;

    http.routes.lock().unwrap().insert(
        "https://lidl.test/offers".into(),
        Ok(financer_prices::HttpResponse {
            status: 503,
            body: String::new(),
        }),
    );
    let (status, report) = send(&app, Method::POST, "/v1/prices/refresh", None).await;
    assert_eq!(status, StatusCode::OK);
    let lidl = report["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "json-ld:lidl")
        .unwrap();
    assert_eq!(lidl["ok"], false);
    assert_eq!(
        report["stored"], 5,
        "Lidl's earlier prices must survive a failed refresh"
    );
}

#[tokio::test]
async fn basket_validation_and_affordability() {
    let app = app().await;
    send(&app, Method::POST, "/v1/prices/refresh", None).await;

    for bad in [
        json!([{"item": "kaviar", "quantity": 1}]),
        json!([{"item": "milch", "quantity": 0}]),
        json!([{"item": "milch", "quantity": 1}, {"item": "milch", "quantity": 2}]),
    ] {
        assert_eq!(
            send(&app, Method::PUT, "/v1/basket", Some(bad)).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let (status, basket) = send(
        &app,
        Method::PUT,
        "/v1/basket",
        Some(json!([{"item":"milch","quantity":2},{"item":"nudeln","quantity":1}])),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(basket["source"], "manual");
    assert_eq!(basket["items"][0]["name"], "Milch");

    // basket: 2 milk + 1 pasta. Aldi 2*0,89+0,89 = 2,67; Lidl 2*0,99+0,79 = 2,77
    let (status, a) = get(&app, "/v1/affordability?budget_cents=1000").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(a["budget_source"], "request");
    let aldi = a["per_chain"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["chain"] == "aldi")
        .unwrap();
    assert_eq!(
        (
            aldi["basket_cents"].as_i64(),
            aldi["baskets"].as_i64(),
            aldi["days_covered"].as_i64()
        ),
        (Some(267), Some(3), Some(21))
    );
    let plan = &a["plan"];
    // cheapest split: milk at Aldi (178), pasta at Lidl (79) = 2,57, saving 10 cents vs all-Aldi: below the 50 cent threshold
    assert_eq!(plan["total_cents"], 267);
    assert_eq!(plan["stops"].as_array().unwrap().len(), 1);
    assert!(a["staples"].as_array().unwrap().len() <= 20);

    assert_eq!(
        get(&app, "/v1/affordability?budget_cents=-5").await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn affordability_defaults_to_the_groceries_envelope() {
    let app = app().await;
    send(&app, Method::POST, "/v1/prices/refresh", None).await;
    // no limit yet
    let (status, body) = get(&app, "/v1/affordability").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("groceries limit"));

    send(
        &app,
        Method::PUT,
        "/v1/budget/envelopes",
        Some(json!([{"category":"groceries","limit_cents":30000}])),
    )
    .await;
    let (status, a) = get(&app, "/v1/affordability").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(a["budget_source"], "groceries_envelope");
    assert_eq!(a["budget_cents"], 30000); // nothing spent yet
    assert_eq!(a["basket_source"], "starter"); // no habits known yet
}

const RECEIPT: &str =
    "REWE Markt GmbH\nVOLLMILCH 1,19 B\nSPAGHETTI 500G 0,89 A\nSUMME 2,08\n02.03.26\n";

#[tokio::test]
async fn receipts_feed_the_basket() {
    let app = app().await;
    let (status, r) = send(
        &app,
        Method::POST,
        "/v1/receipts",
        Some(json!({"text": RECEIPT})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (
            r["reconciles"].clone(),
            r["duplicate"].clone(),
            r["chain"].clone()
        ),
        (json!(true), json!(false), json!("rewe"))
    );
    assert_eq!(r["items"].as_array().unwrap().len(), 2);
    let id = r["id"].as_i64().unwrap();

    let (_, again) = send(
        &app,
        Method::POST,
        "/v1/receipts",
        Some(json!({"text": RECEIPT})),
    )
    .await;
    assert_eq!(again["duplicate"], true);
    assert_eq!(
        get(&app, "/v1/receipts").await.1.as_array().unwrap().len(),
        1
    );

    assert_eq!(
        send(
            &app,
            Method::POST,
            "/v1/receipts",
            Some(json!({"text": "hello world"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    // habit mode decides where the basket comes from
    assert_eq!(get(&app, "/v1/basket").await.1["source"], "starter");
    send(
        &app,
        Method::PUT,
        "/v1/settings",
        Some(json!({"habit_mode": "receipts"})),
    )
    .await;
    let (_, basket) = get(&app, "/v1/basket").await;
    assert_eq!(basket["source"], "receipts");
    let keys: Vec<_> = basket["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["item"].as_str().unwrap())
        .collect();
    assert_eq!(keys, vec!["milch", "nudeln"]);

    assert_eq!(
        send(&app, Method::DELETE, &format!("/v1/receipts/{id}"), None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        send(&app, Method::DELETE, &format!("/v1/receipts/{id}"), None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(get(&app, "/v1/basket").await.1["source"], "starter"); // nothing left to learn from
}

#[tokio::test]
async fn recipes_rank_by_what_you_buy() {
    let app = app().await;
    send(&app, Method::POST, "/v1/prices/refresh", None).await;
    send(&app, Method::PUT, "/v1/basket", Some(json!([
        {"item":"nudeln","quantity":1},{"item":"tomaten-passiert","quantity":1},{"item":"zwiebeln","quantity":1},{"item":"knoblauch","quantity":1}
    ]))).await;
    let (status, r) = get(&app, "/v1/recipes?limit=3").await;
    assert_eq!(status, StatusCode::OK);
    let first = &r[0];
    assert_eq!(first["id"], "spaghetti-tomatensosse");
    assert_eq!(first["coverage_percent"], 100);
    assert!(first["ingredients"][0]["name"].as_str().is_some());
    assert_eq!(r.as_array().unwrap().len(), 3);

    let (_, veg) = get(&app, "/v1/recipes?tag=vegan&limit=50").await;
    assert!(veg
        .as_array()
        .unwrap()
        .iter()
        .all(|x| x["tags"].as_array().unwrap().contains(&json!("vegan"))));
}

const IDEAS: &str = r#"{"recipes":[{"title":"Nudelpfanne","summary":"Schnell","minutes":20,"servings":2,
    "ingredients":[{"name":"Nudeln","amount":"250 g"}],"steps":["Kochen"]}]}"#;

#[tokio::test]
async fn ideas_need_a_key_and_use_the_selected_provider() {
    // no key
    let app = app().await;
    let (status, body) = send(&app, Method::POST, "/v1/recipes/ideas", Some(json!({}))).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("FINANCER_ANTHROPIC_API_KEY"));

    // key + mock provider; switching to OpenAI asks for the OpenAI key
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen2 = seen.clone();
    let app = app_with(|s| {
        s.with_llm_keys(LlmKeys {
            claude: Some("sk-claude".into()),
            openai: None,
        })
        .with_llm_factory(Arc::new(move |settings| {
            seen2
                .lock()
                .unwrap()
                .push((settings.provider, settings.model.clone()));
            Ok(Box::new(MockProvider::with_answers(vec![Ok(IDEAS.into())])))
        }))
    })
    .await;
    let (status, ideas) = send(
        &app,
        Method::POST,
        "/v1/recipes/ideas",
        Some(json!({"count": 2, "diet": "vegetarisch"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ideas[0]["title"], "Nudelpfanne");
    assert_eq!(seen.lock().unwrap()[0].0, financer_llm::Provider::Claude);

    send(
        &app,
        Method::PUT,
        "/v1/settings",
        Some(json!({"llm_provider": "open_ai", "llm_model": "gpt-5.4-mini"})),
    )
    .await;
    let (status, body) = send(&app, Method::POST, "/v1/recipes/ideas", Some(json!({}))).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("FINANCER_OPENAI_API_KEY"));
}

#[tokio::test]
async fn provider_failures_are_bad_gateway() {
    let app = app_with(|s| {
        s.with_llm_keys(LlmKeys {
            claude: Some("k".into()),
            openai: None,
        })
        .with_llm_factory(Arc::new(|_| {
            Ok(Box::new(MockProvider::with_answers(vec![Err(
                "overloaded".into(),
            )])))
        }))
    })
    .await;
    let (status, _) = send(&app, Method::POST, "/v1/recipes/ideas", Some(json!({}))).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn settings_are_validated_and_never_expose_keys() {
    let app = app_with(|s| {
        s.with_llm_keys(LlmKeys {
            claude: Some("sk-very-secret".into()),
            openai: None,
        })
    })
    .await;
    let (status, s) = get(&app, "/v1/settings").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (s["habit_mode"].clone(), s["llm_provider"].clone()),
        (json!("manual"), json!("claude"))
    );
    assert_eq!(
        (
            s["claude_key_configured"].clone(),
            s["openai_key_configured"].clone()
        ),
        (json!(true), json!(false))
    );
    assert!(!s.to_string().contains("sk-very-secret"));

    for bad in [
        json!({"habit_mode": "magic"}),
        json!({"llm_provider": "gemini"}),
        json!({"llm_model": "x\ny"}),
    ] {
        assert_eq!(
            send(&app, Method::PUT, "/v1/settings", Some(bad)).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let (_, s) = send(
        &app,
        Method::PUT,
        "/v1/settings",
        Some(json!({"habit_mode": "spending", "llm_provider": "open_ai"})),
    )
    .await;
    assert_eq!(
        (s["habit_mode"].clone(), s["llm_provider"].clone()),
        (json!("spending"), json!("open_ai"))
    );
}

#[tokio::test]
async fn catalog_and_best_prices() {
    let app = app().await;
    let (_, cat) = get(&app, "/v1/catalog").await;
    assert!(cat
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["key"] == "milch" && i["reference_pack"] == "1 l"));

    send(&app, Method::POST, "/v1/prices/refresh", None).await;
    send(
        &app,
        Method::PUT,
        "/v1/basket",
        Some(json!([{"item":"milch","quantity":1}])),
    )
    .await;
    let (_, best) = get(&app, "/v1/prices/best").await;
    assert_eq!(
        (
            best[0]["chain"].clone(),
            best[0]["price_cents"].clone(),
            best[0]["saving_vs_next_cents"].clone()
        ),
        (json!("aldi"), json!(89), json!(10))
    );
}

#[tokio::test]
async fn new_routes_need_the_token() {
    let app = app().await;
    for uri in [
        "/v1/prices",
        "/v1/basket",
        "/v1/receipts",
        "/v1/recipes",
        "/v1/settings",
        "/v1/affordability",
        "/v1/catalog",
    ] {
        let res = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{uri}");
    }
}
