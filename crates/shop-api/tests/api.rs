use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_prices::FakeHttp;
use financer_shop_api::notify::testing::FakePoster;
use financer_shop_api::notify::{ExpoNotifier, Notifier};
use financer_shop_api::{ShopApi, ShopConfig, ShopState};
use financer_shop_core::Registry;
use financer_shop_sources::{parse_sources, Crawler};
use financer_shop_store::ShopStore;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const PHONES: &str = "\
name;price;link;brand;ean;uvp;Akkukapazität;Arbeitsspeicher;Speicher;Update-Garantie;Betriebssystem;Erscheinungsdatum;Geekbench
Budget Phone B1;199,00;https://feed.test/b1;Brandless;;249,00;5000 mAh;4 GB;64 GB;3;Android 14;2026-01;2500
Mid Phone M2;449,00;https://feed.test/m2;Midco;;;5000 mAh;8 GB;128 GB;6;Android 15;2026-05;4500
Flagship F3;1099,00;https://feed.test/f3;Topco;;;5200 mAh;12 GB;256 GB;7;Android 15;2026-09;8500
Apple iPhone Z;999,00;https://feed.test/ip;Apple;;;3900 mAh;8 GB;256 GB;7;iOS 19;2026-09;8000
";

const PLANS: &str = "\
name;price;link;monthly;term;promo_n;promo;setup;Datenvolumen;Netz;5G;EU-Roaming
Flex 10;0;https://tel.test/flex10;14,99;0;;;0;10 GB;o2;ja;ja
Teaser 30;0;https://tel.test/teaser30;24,99;24;6;0,00;39,99;30 GB;telekom;ja;ja
Max Unlimited;0;https://tel.test/max;49,99;24;;;0;unbegrenzt;telekom;ja;ja
";

fn sources() -> Vec<financer_shop_sources::SourceConfig> {
    parse_sources(
        r#"[
          {"name": "phones", "kind": "feed", "feed_url": "https://feed.test/phones.csv", "category": "smartphone", "shop": "PhoneShop",
           "mapping": {"title": "name", "price": "price", "url": "link", "brand": "brand", "list_price": "uvp"}},
          {"name": "plans", "kind": "feed", "feed_url": "https://tel.test/plans.csv", "category": "mobile_plan", "shop": "TelcoShop",
           "mapping": {"title": "name", "price": "price", "url": "link", "monthly": "monthly", "min_term_months": "term",
                       "promo_months": "promo_n", "promo_monthly": "promo", "setup": "setup"}}
        ]"#,
    )
    .unwrap()
}

struct Harness {
    app: Router,
    state: ShopState,
    now: Arc<AtomicI64>,
    poster: Arc<FakePoster>,
}

async fn harness() -> Harness {
    let http = Arc::new(FakeHttp::with(vec![
        ("https://feed.test/phones.csv", 200, PHONES),
        ("https://tel.test/plans.csv", 200, PLANS),
    ]));
    let store = ShopStore::connect("sqlite::memory:").await.unwrap();
    let registry = Arc::new(RwLock::new(Registry::builtin()));
    let now = Arc::new(AtomicI64::new(1_790_000_000));
    let clock = now.clone();
    let c2 = now.clone();
    let crawler = Crawler::new(http, registry.clone(), sources())
        .with_clock(move || c2.load(Ordering::SeqCst));
    let poster = Arc::new(FakePoster::default());
    let expo: Arc<dyn Notifier> = Arc::new(ExpoNotifier {
        poster: poster.clone(),
        endpoint: ExpoNotifier::ENDPOINT.into(),
    });
    let state = ShopState::new(
        store,
        registry,
        crawler,
        ShopConfig {
            continuous: true,
            ..ShopConfig::default()
        },
    )
    .with_clock(move || clock.load(Ordering::SeqCst))
    .with_notifiers(vec![expo]);
    Harness {
        app: ShopApi::router(state.clone()),
        state,
        now,
        poster,
    }
}

async fn call(
    app: &Router,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(path);
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

async fn index(h: &Harness, query: &str) -> Value {
    let (status, job) = call(
        &h.app,
        Method::POST,
        "/index",
        Some(json!({ "query": query })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{job}");
    let id = job["id"].as_str().unwrap().to_string();
    for _ in 0..200 {
        let (_, v) = call(&h.app, Method::GET, &format!("/index/{id}"), None).await;
        if matches!(
            v["progress"]["phase"].as_str(),
            Some("done" | "failed" | "cancelled")
        ) {
            return v;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("index job did not finish");
}

#[tokio::test]
async fn nothing_is_known_until_the_index_is_built_and_then_search_ranks_with_reasons() {
    let h = harness().await;
    let (_, before) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "beste handy" })),
    )
    .await;
    assert_eq!(before["items"].as_array().unwrap().len(), 0);
    assert_eq!(
        before["catalogue"]["stale"], true,
        "the app should offer to build the index"
    );

    let job = index(&h, "handy").await;
    assert_eq!(job["progress"]["phase"], "done");
    assert_eq!(job["progress"]["percent"], 100);
    assert_eq!(job["report"]["new_products"], 4, "{job}");

    let (status, found) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "beste handy unter 1000 €" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(found["category"], "smartphone");
    assert_eq!(found["parsed"]["max_price_cents"], 100_000);
    let items = found["items"].as_array().unwrap();
    assert_eq!(
        items.len(),
        3,
        "the 1099 EUR flagship is over the limit: {found}"
    );
    assert!(found["excluded"][0]["reasons"][0]
        .as_str()
        .unwrap()
        .contains("price limit"));
    let first = &items[0];
    assert!(
        first["ranked"]["score"].as_f64().unwrap() > items[2]["ranked"]["score"].as_f64().unwrap()
    );
    assert!(!first["ranked"]["breakdown"].as_array().unwrap().is_empty());
    assert!(first["ranked"]["tier"].is_string());
    for pick in ["best_overall", "best_value", "cheapest_good", "premium"] {
        assert!(found["picks"][pick].is_string(), "{pick}: {found}");
    }
    assert_eq!(found["catalogue"]["products_in_category"], 4);
    assert_eq!(found["catalogue"]["stale"], false);
}

#[tokio::test]
async fn weights_and_ecosystem_preferences_change_the_answer_and_profiles_are_saved() {
    let h = harness().await;
    index(&h, "handy").await;

    let (_, base) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "handy" })),
    )
    .await;
    let base_top = base["items"][0]["product"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let apple_fan = json!({ "preferences": { "ecosystem": { "prefer": ["apple"] } }, "weights": { "ecosystem": 30 } });
    let (_, fan) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "handy", "profile": apple_fan })),
    )
    .await;
    assert_eq!(fan["items"][0]["product"]["brand"], "Apple", "{fan}");
    assert!(fan["items"][0]["ranked"]["breakdown"]
        .as_array()
        .unwrap()
        .iter()
        .any(|b| b["key"] == "ecosystem"));
    assert_ne!(base_top, fan["items"][0]["product"]["id"].as_str().unwrap());

    let (status, _) = call(&h.app, Method::PUT, "/profiles/apple-fan", Some(apple_fan)).await;
    assert_eq!(status, StatusCode::OK);
    let (_, by_name) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "handy", "profile_name": "apple-fan" })),
    )
    .await;
    assert_eq!(by_name["items"][0]["product"]["brand"], "Apple");
    let (status, _) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "handy", "profile_name": "nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, listed) = call(&h.app, Method::GET, "/profiles", None).await;
    assert_eq!(listed[0]["name"], "apple-fan");
}

#[tokio::test]
async fn criteria_and_attributes_are_expandable_through_the_api() {
    let h = harness().await;
    index(&h, "handy").await;

    // 1. a new category that extends smartphone, with a criterion over a brand-new attribute
    let custom = json!({
        "id": "kid_phone", "name": "Phone for a child", "extends": "smartphone", "keywords": ["kinderhandy"],
        "attributes": [{ "key": "parental_controls", "label": "Parental controls", "kind": "bool", "aliases": ["Kindersicherung"] }],
        "criteria": [{ "key": "parental", "label": "Parental controls", "kind": "flag", "attribute": "parental_controls", "weight": 5 }]
    });
    let (status, detail) = call(&h.app, Method::PUT, "/categories/kid_phone", Some(custom)).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert!(
        detail["resolved"]["criteria"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["key"] == "battery"),
        "inherits"
    );
    assert_eq!(detail["customized"], true);

    // 2. a mistake is explained, not stored
    let bad = json!({ "id": "bad", "name": "Bad", "criteria": [{ "key": "x", "label": "X", "kind": "number", "attribute": "ghost" }] });
    let (status, err) = call(&h.app, Method::PUT, "/categories/bad", Some(bad)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err["problems"][0].as_str().unwrap().contains("ghost"));
    assert_eq!(
        call(&h.app, Method::GET, "/categories/bad", None).await.0,
        StatusCode::NOT_FOUND
    );

    // 3. a person adds a spec the page never had, and it changes the ranking of a product
    let (_, found) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "handy" })),
    )
    .await;
    let mid = found["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["product"]["title"] == "Mid Phone M2")
        .unwrap();
    let id = mid["product"]["id"].as_str().unwrap().to_string();
    let score_before = mid["ranked"]["score"].as_f64().unwrap();
    let (status, edited) = call(
        &h.app,
        Method::PUT,
        &format!("/products/{id}"),
        Some(json!({ "attributes": { "camera_score": "95", "my_note": "friend recommends", "update_years": 7 } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(
        edited["attributes"]["camera_score"], 95.0,
        "a number attribute typed as text is read as a number"
    );
    assert_eq!(edited["attributes"]["my_note"], "friend recommends");
    let (_, again) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "handy" })),
    )
    .await;
    let mid2 = again["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["product"]["id"] == id.as_str())
        .unwrap();
    assert!(mid2["ranked"]["score"].as_f64().unwrap() > score_before);

    // 4. a criterion added just for this search, written as a formula over specs
    let profile = json!({ "extra_criteria": [{ "key": "bang", "label": "Battery per euro", "kind": "formula", "expr": "battery_mah / price", "weight": 30 }] });
    let (_, f) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "handy", "profile": profile })),
    )
    .await;
    assert_eq!(f["items"][0]["product"]["title"], "Budget Phone B1");
    assert!(f["items"][0]["ranked"]["breakdown"]
        .as_array()
        .unwrap()
        .iter()
        .any(|b| b["key"] == "bang"));

    // 5. removing the override returns to the built-ins
    assert_eq!(
        call(&h.app, Method::DELETE, "/categories/kid_phone", None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&h.app, Method::DELETE, "/categories/smartphone", None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (_, cats) = call(&h.app, Method::GET, "/categories", None).await;
    assert!(cats
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["id"] != "kid_phone"));
}

#[tokio::test]
async fn compare_lays_products_side_by_side() {
    let h = harness().await;
    index(&h, "handy").await;
    let (_, all) = call(&h.app, Method::GET, "/products?category=smartphone", None).await;
    let ids: Vec<String> = all
        .as_array()
        .unwrap()
        .iter()
        .take(2)
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    let (status, c) = call(
        &h.app,
        Method::POST,
        "/compare",
        Some(json!({ "product_ids": ids })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{c}");
    assert_eq!(c["columns"].as_array().unwrap().len(), 2);
    assert_eq!(c["rows"][0]["key"], "price");
    assert!(c["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["key"] == "battery"));
    assert!(c["winner"].is_string());
    assert_eq!(
        call(
            &h.app,
            Method::POST,
            "/compare",
            Some(json!({ "product_ids": [ids[0].clone()] }))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &h.app,
            Method::POST,
            "/compare",
            Some(json!({ "product_ids": [ids[0].clone(), "x:nope"] }))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn subscriptions_are_ranked_by_real_cost_and_savings_against_the_current_plan() {
    let h = harness().await;
    index(&h, "handytarif").await;

    let (status, _) = call(
        &h.app,
        Method::PUT,
        "/my/mobile_plan",
        Some(json!({ "name": "Old plan", "monthly_cents": 3999 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        call(
            &h.app,
            Method::PUT,
            "/my/smartphone",
            Some(json!({ "monthly_cents": 1 }))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    let profile = json!({ "weights": { "data": 4 }, "constraints": [{ "attribute": "data_gb", "op": "gte", "value": 20 }] });
    let (_, found) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "handytarif", "profile": profile })),
    )
    .await;
    assert_eq!(found["category"], "mobile_plan");
    let items = found["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "Flex 10 has too little data: {found}");
    let teaser = items
        .iter()
        .find(|i| i["product"]["title"] == "Teaser 30")
        .unwrap();
    // 24 months: 6 free + 18 * 24.99 + 39.99 fee = 489.81 -> 20.41 a month
    assert_eq!(teaser["ranked"]["price_cents"], (48_981 + 12) / 24);
    assert_eq!(teaser["saving"]["current"], "Old plan");
    assert_eq!(
        teaser["saving"]["per_month_cents"],
        3999 - (48_981 + 12) / 24
    );
    let (_, plan) = call(&h.app, Method::GET, "/my/mobile_plan", None).await;
    assert_eq!(plan["monthly_cents"], 3999);
}

#[tokio::test]
async fn deals_watches_and_messages_work_end_to_end() {
    let h = harness().await;
    index(&h, "handy").await;
    let (_, found) = call(
        &h.app,
        Method::POST,
        "/search",
        Some(json!({ "query": "mid phone" })),
    )
    .await;
    let id = found["items"][0]["product"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // a watch needs a reason
    assert_eq!(
        call(
            &h.app,
            Method::POST,
            "/watches",
            Some(json!({ "name": "w", "query": "mid phone" }))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, w) = call(
        &h.app,
        Method::POST,
        "/watches",
        Some(json!({ "name": "Mid phone", "query": "mid phone", "max_price_cents": 40000 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{w}");
    let (_, n) = call(&h.app, Method::GET, "/notifications", None).await;
    assert_eq!(
        n["items"].as_array().unwrap().len(),
        0,
        "449 EUR is above the 400 EUR target"
    );

    // the shop drops the price (a new crawl, a day later)
    h.now.fetch_add(86_400, Ordering::SeqCst);
    let mut product = h.state.store.get_product(&id).await.unwrap().unwrap();
    product.offers[0].price_cents = 38_900;
    product.offers[0].seen_at = h.state.now();
    h.state
        .store
        .upsert_product(product, h.state.now())
        .await
        .unwrap();
    assert_eq!(h.state.check_watches().await.unwrap(), 1);
    assert_eq!(
        h.state.check_watches().await.unwrap(),
        0,
        "the same price is announced once"
    );

    let (_, n) = call(&h.app, Method::GET, "/notifications", None).await;
    assert_eq!(n["unread"], 1);
    assert_eq!(
        n["items"][0]["message"],
        "Mid Phone M2 is 389,00 EUR at PhoneShop"
    );
    assert_eq!(n["items"][0]["event"]["kind"], "below_target");
    let last = n["last_id"].as_i64().unwrap();
    let (_, none) = call(
        &h.app,
        Method::GET,
        &format!("/notifications?after={last}"),
        None,
    )
    .await;
    assert_eq!(none["items"].as_array().unwrap().len(), 0);

    // push: the app registers a token, the server sends through Expo
    assert_eq!(
        call(
            &h.app,
            Method::POST,
            "/push-tokens",
            Some(json!({ "token": "nonsense" }))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &h.app,
            Method::POST,
            "/push-tokens",
            Some(json!({ "token": "ExponentPushToken[abc]" }))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(h.state.deliver_pending().await.unwrap(), 1);
    {
        let reqs = h.poster.requests.lock().unwrap();
        assert_eq!(reqs.len(), 1);
        assert!(reqs[0].2.contains("ExponentPushToken[abc]") && reqs[0].2.contains("389,00 EUR"));
    }
    assert_eq!(
        h.state.deliver_pending().await.unwrap(),
        0,
        "delivered messages are not sent again"
    );

    let (_, read) = call(
        &h.app,
        Method::POST,
        "/notifications/read",
        Some(json!({ "up_to": last })),
    )
    .await;
    assert_eq!(read["unread"], 0);

    // a bigger drop later is announced again, a wobble is not
    h.now.fetch_add(86_400, Ordering::SeqCst);
    let mut product = h.state.store.get_product(&id).await.unwrap().unwrap();
    product.offers[0].price_cents = 38_700;
    h.state
        .store
        .upsert_product(product.clone(), h.state.now())
        .await
        .unwrap();
    assert_eq!(
        h.state.check_watches().await.unwrap(),
        0,
        "388,00 -> 387,00 is not worth a message"
    );
    product.offers[0].price_cents = 35_000;
    h.state
        .store
        .upsert_product(product, h.state.now())
        .await
        .unwrap();
    assert_eq!(h.state.check_watches().await.unwrap(), 1);
}

#[tokio::test]
async fn the_deals_list_uses_the_price_history_not_the_shops_was_price() {
    let h = harness().await;
    index(&h, "handy").await;
    let (_, d) = call(&h.app, Method::GET, "/deals", None).await;
    // the budget phone shows a struck-through 249 EUR price, which is a "Good" claim at best
    let items = d.as_array().unwrap();
    assert_eq!(items.len(), 1, "{d}");
    assert_eq!(items[0]["product"]["title"], "Budget Phone B1");
    assert_eq!(items[0]["deal"]["verdict"], "good");
    assert_eq!(items[0]["deal"]["all_time_low"], false);
}

#[tokio::test]
async fn manual_products_can_be_added_edited_and_deleted() {
    let h = harness().await;
    let body = json!({
        "category": "smartphone", "title": "Fairphone 5", "brand": "Fairphone",
        "attributes": { "Battery": "x" },
        "offers": [{ "shop": "Fairphone", "url": "https://shop.fairphone.com", "price_cents": 59900 }]
    });
    // "Battery" is a fine key, but an invalid one is refused
    assert_eq!(
        call(
            &h.app,
            Method::POST,
            "/products",
            Some(
                json!({ "category": "smartphone", "title": "X", "attributes": { "bad key!": 1 } })
            )
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &h.app,
            Method::POST,
            "/products",
            Some(json!({ "category": "nope", "title": "X" }))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, p) = call(&h.app, Method::POST, "/products", Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{p}");
    assert_eq!(p["id"], "smartphone:fairphone-5");
    assert_eq!(p["offers"][0]["seen_at"], h.state.now());
    let (status, detail) = call(
        &h.app,
        Method::GET,
        "/products/smartphone:fairphone-5",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["history"].as_array().unwrap().len(), 1);
    assert!(detail["schema"]["criteria"].as_array().unwrap().len() > 5);
    assert_eq!(
        call(
            &h.app,
            Method::DELETE,
            "/products/smartphone:fairphone-5",
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(
            &h.app,
            Method::GET,
            "/products/smartphone:fairphone-5",
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn index_jobs_report_problems_and_can_be_cancelled() {
    let h = harness().await;
    assert_eq!(
        call(
            &h.app,
            Method::POST,
            "/index",
            Some(json!({ "query": "  " }))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&h.app, Method::GET, "/index/nope", None).await.0,
        StatusCode::NOT_FOUND
    );

    // no sources configured: a clear refusal, not a job that silently does nothing
    let store = ShopStore::connect("sqlite::memory:").await.unwrap();
    let registry = Arc::new(RwLock::new(Registry::builtin()));
    let crawler = Crawler::new(Arc::new(FakeHttp::default()), registry.clone(), vec![]);
    let empty = ShopApi::router(ShopState::new(
        store,
        registry,
        crawler,
        ShopConfig::default(),
    ));
    let (status, err) = call(
        &empty,
        Method::POST,
        "/index",
        Some(json!({ "query": "handy" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err["error"].as_str().unwrap().contains("no shop sources"));

    let (_, info) = call(&h.app, Method::GET, "/info", None).await;
    assert_eq!(info["mode"], "server");
    assert_eq!(info["sources"].as_array().unwrap().len(), 2);
    assert_eq!(info["notifiers"][0], "expo");
}

#[tokio::test]
async fn the_standalone_server_requires_the_token() {
    let h = harness().await;
    let app = ShopApi::standalone(
        h.state.clone(),
        "a-long-enough-token-for-the-test-0123456789",
    );
    let (status, _) = call(&app, Method::GET, "/health", None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(&app, Method::GET, "/v1/shop/info", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let req = Request::builder()
        .uri("/v1/shop/info")
        .header(
            header::AUTHORIZATION,
            "Bearer a-long-enough-token-for-the-test-0123456789",
        )
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn the_continuous_loop_crawls_checks_watches_and_prunes() {
    let h = harness().await;
    // the server needs no search: standing sources are crawled by themselves
    let visited = h.state.tick(50).await.unwrap();
    assert_eq!(visited, 2);
    assert_eq!(h.state.store.count_products(None).await.unwrap(), 7);
    assert_eq!(
        h.state.tick(50).await.unwrap(),
        0,
        "nothing is due again yet"
    );
    // a month and a half later the shops have stopped listing the Budget Phone: its offer goes
    h.now.fetch_add(46 * 86_400, Ordering::SeqCst);
    assert_eq!(h.state.tick(50).await.unwrap(), 2);
}
