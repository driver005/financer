use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, FakeHttp, PriceSourceConfig, TokenHash};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use time::macros::format_description;
use time::{Duration, OffsetDateTime};
use tower::ServiceExt;

const TOKEN: &str = "test-token";
/// A valid EAN-13.
const MILK: &str = "4006381333931";

/// Test fixtures: fake Open Prices answers, an in-memory app and request helpers.
struct Fixture;

impl Fixture {
    fn day(days_ago: i64) -> String {
        (OffsetDateTime::now_utc().date() - Duration::days(days_ago))
            .format(format_description!("[year]-[month]-[day]"))
            .unwrap()
    }

    fn observation(code: &str, price: f64, days_ago: i64, brand: Option<&str>) -> Value {
        let mut o = json!({
            "product_code": code, "price": price, "currency": "EUR", "date": Self::day(days_ago),
            "product": {"code": code, "product_name": "Vollmilch 3,5%",
                        "product_quantity": 1, "product_quantity_unit": "l"},
        });
        if let Some(b) = brand {
            o["location"] = json!({ "osm_brand": b, "osm_name": format!("{b} Markt") });
        }
        o
    }

    fn open_prices_body(items: Vec<Value>) -> String {
        json!({ "items": items }).to_string()
    }

    fn url(code: &str) -> String {
        format!(
            "https://prices.openfoodfacts.org/api/v1/prices?product_code={code}&currency=EUR&order_by=-date&size=20"
        )
    }

    fn milk_answer() -> String {
        Self::open_prices_body(vec![
            Self::observation(MILK, 1.29, 3, Some("REWE")),
            Self::observation(MILK, 0.99, 5, Some("ALDI SÜD")),
            Self::observation(MILK, 1.09, 6, Some("Lidl")),
            Self::observation(MILK, 1.05, 20, Some("REWE")), // older: the newer Rewe price counts
            Self::observation(MILK, 0.89, 4, Some("Edeka")), // not one of the four chains
            Self::observation(MILK, 0.79, 400, Some("Lidl")), // far too old
        ])
    }

    fn open_prices(barcode: &str) -> PriceSourceConfig {
        serde_json::from_value(json!({
            "type": "open_prices", "max_age_days": 60,
            "items": [{"item": "milch", "barcode": barcode}]
        }))
        .unwrap()
    }

    async fn app(http: Arc<FakeHttp>, sources: Vec<PriceSourceConfig>) -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        Api::router(
            AppState::new(store)
                .with_http(http)
                .with_price_sources(sources),
            TokenHash::new(TOKEN),
        )
    }

    async fn send(app: &Router, method: Method, uri: &str, token: bool) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        }
        let res = app
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn get(app: &Router, uri: &str) -> (StatusCode, Value) {
        Self::send(app, Method::GET, uri, true).await
    }
}

fn chains(body: &Value) -> Vec<(String, i64)> {
    body["chains"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["chain"].as_str().unwrap().to_string(),
                c["price_cents"].as_i64().unwrap(),
            )
        })
        .collect()
}

#[tokio::test]
async fn invalid_barcodes_are_a_clear_400_and_never_a_500() {
    let app = Fixture::app(Arc::new(FakeHttp::default()), vec![]).await;
    for (code, needle) in [
        ("4006381333932", "check digit"),
        ("12345", "digits"),
        ("40063813339A1", "digits only"),
        ("14006381333938", "digits"),
        ("%20", "digits only"),
        ("0000000000000000000000000000", "digits"),
        ("%F0%9F%A5%9B", "digits only"),
    ] {
        let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{code}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{code}");
        assert!(
            body["error"].as_str().unwrap().contains(needle),
            "{code}: {body}"
        );
    }
}

#[tokio::test]
async fn the_lookup_needs_the_token() {
    let app = Fixture::app(Arc::new(FakeHttp::default()), vec![]).await;
    let (status, _) =
        Fixture::send(&app, Method::GET, &format!("/v1/prices/ean/{MILK}"), false).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_valid_barcode_nobody_knows_is_an_empty_result_with_a_reason() {
    // nothing stored, no Open Prices source: no network call is made either
    let http = Arc::new(FakeHttp::default());
    let app = Fixture::app(http.clone(), vec![]).await;
    let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{MILK}")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["chains"].as_array().unwrap().is_empty());
    assert!(body["observations"].as_array().unwrap().is_empty());
    assert_eq!(body["cheapest"], Value::Null);
    assert_eq!(body["live_lookup"], false);
    assert_eq!(body["ean"], MILK);
    assert_eq!(body["kind"], "ean13");
    let notes = body["notes"].to_string();
    assert!(notes.contains("No Open Prices source"), "{notes}");
    assert!(notes.contains("No stored price"), "{notes}");
    assert!(http.log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn open_prices_give_a_price_per_chain_unit_prices_and_the_cheapest() {
    let http = Arc::new(FakeHttp::with(vec![(
        &Fixture::url(MILK),
        200,
        &Fixture::milk_answer(),
    )]));
    let app = Fixture::app(http, vec![Fixture::open_prices(MILK)]).await;
    let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{MILK}")).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    assert_eq!(body["live_lookup"], true);
    assert_eq!(body["product_name"], "Vollmilch 3,5%");
    assert_eq!(body["pack"], "1 l");
    assert_eq!(body["item"], "milch");
    assert_eq!(body["reference_pack"], "1 l");
    // newest price per chain, cheapest first; Edeka is not one of the four chains
    assert_eq!(
        chains(&body),
        vec![
            ("aldi".to_string(), 99),
            ("lidl".to_string(), 109),
            ("rewe".to_string(), 129)
        ]
    );
    assert_eq!(body["compared_by"], "unit_price");
    assert_eq!(body["cheapest"], "aldi");
    assert!(body["tied_cheapest"].as_array().unwrap().is_empty());
    let aldi = &body["chains"][0];
    assert_eq!(aldi["scope"], "product");
    assert_eq!(aldi["unit"], "l");
    assert_eq!(aldi["unit_price_cents"], 99);
    assert_eq!(aldi["observed_on"], Fixture::day(5));
    // every observation within 60 days is listed, newest first; the 400-day-old one is not
    let obs = body["observations"].as_array().unwrap();
    assert_eq!(obs.len(), 5);
    assert_eq!(obs[0]["date"], Fixture::day(3));
    assert_eq!(obs[0]["chain"], "rewe");
    assert!(obs.iter().any(|o| o["chain"] == Value::Null)); // Edeka
}

#[tokio::test]
async fn upc_a_and_ean13_with_a_leading_zero_are_the_same_product() {
    let upc = "036000291452";
    let ean13 = "0036000291452";
    let answer =
        Fixture::open_prices_body(vec![Fixture::observation(ean13, 1.49, 2, Some("Kaufland"))]);
    // Open Prices is asked with the 13-digit form
    let http = Arc::new(FakeHttp::with(vec![(&Fixture::url(ean13), 200, &answer)]));
    let app = Fixture::app(http, vec![Fixture::open_prices(ean13)]).await;
    for code in [upc, ean13] {
        let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{code}")).await;
        assert_eq!(status, StatusCode::OK, "{code}");
        assert_eq!(body["ean"], ean13);
        assert_eq!(chains(&body), vec![("kaufland".to_string(), 149)], "{code}");
    }
    let (_, body) = Fixture::get(&app, &format!("/v1/prices/ean/{upc}")).await;
    assert_eq!(body["kind"], "upc_a");
    // a single chain is the only known price, which is also the cheapest of what is known
    assert_eq!(body["cheapest"], "kaufland");
}

#[tokio::test]
async fn stored_prices_are_still_shown_when_open_prices_is_down() {
    let url = Fixture::url(MILK);
    let http = Arc::new(FakeHttp::with(vec![(&url, 200, &Fixture::milk_answer())]));
    let app = Fixture::app(http.clone(), vec![Fixture::open_prices(MILK)]).await;
    let (status, report) = Fixture::send(&app, Method::POST, "/v1/prices/refresh", true).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert!(report["stored"].as_i64().unwrap() >= 3);

    // the service goes away after the refresh
    http.routes
        .lock()
        .unwrap()
        .insert(url, Err("offline".into()));
    let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{MILK}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["live_lookup"], false);
    assert!(body["observations"].as_array().unwrap().is_empty());
    let notes = body["notes"].to_string();
    assert!(notes.contains("could not be reached"), "{notes}");
    assert!(notes.contains("not necessarily this brand"), "{notes}");
    // stored prices of the milk item, per reference pack, cheapest first
    assert_eq!(body["item"], "milch");
    assert_eq!(body["product_name"], "Vollmilch 3,5%");
    let got = chains(&body);
    assert_eq!(got.first().map(|c| c.0.as_str()), Some("aldi"));
    assert_eq!(body["cheapest"], "aldi");
    assert!(body["chains"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["scope"] == "item"));
}

#[tokio::test]
async fn an_error_answer_from_open_prices_is_reported_not_raised() {
    let http = Arc::new(FakeHttp::with(vec![(&Fixture::url(MILK), 503, "")]));
    let app = Fixture::app(http, vec![Fixture::open_prices(MILK)]).await;
    let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{MILK}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["live_lookup"], false);
    assert!(body["notes"].to_string().contains("answered 503"));
}

#[tokio::test]
async fn a_barcode_without_any_observation_says_so() {
    let http = Arc::new(FakeHttp::with(vec![(
        &Fixture::url(MILK),
        200,
        r#"{"items":[],"total":0}"#,
    )]));
    let app = Fixture::app(http, vec![Fixture::open_prices(MILK)]).await;
    let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{MILK}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["live_lookup"], true);
    assert!(body["chains"].as_array().unwrap().is_empty());
    assert!(body["notes"].to_string().contains("No recent price"));
}

#[tokio::test]
async fn garbage_from_open_prices_is_an_empty_result() {
    let http = Arc::new(FakeHttp::with(vec![(
        &Fixture::url(MILK),
        200,
        "<html>not json</html>",
    )]));
    let app = Fixture::app(http, vec![Fixture::open_prices(MILK)]).await;
    let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{MILK}")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["chains"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn observations_of_an_unconfigured_barcode_still_rank_by_the_product_name() {
    // not in the source's barcode list: the item is recognised from the product name
    let other = "5449000000996";
    let answer = Fixture::open_prices_body(vec![
        Fixture::observation(other, 1.19, 1, Some("Lidl")),
        Fixture::observation(other, 1.19, 1, Some("Aldi")),
    ]);
    let http = Arc::new(FakeHttp::with(vec![(&Fixture::url(other), 200, &answer)]));
    let app = Fixture::app(http, vec![Fixture::open_prices(MILK)]).await;
    let (status, body) = Fixture::get(&app, &format!("/v1/prices/ean/{other}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["item"], "milch");
    // a tie has no single winner
    assert_eq!(body["cheapest"], Value::Null);
    assert_eq!(body["tied_cheapest"].as_array().unwrap().len(), 2);
}
