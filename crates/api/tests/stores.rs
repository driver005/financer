//! Spending per supermarket chain through the real router.

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_core::{Category, Money, StoreAlias, Transaction};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use time::Date;
use tower::ServiceExt;

const TOKEN: &str = "test-token";

struct StoreFixture;

impl StoreFixture {
    fn tx(day: &str, who: &str, cents: i64, category: Category) -> Transaction {
        let format = time::macros::format_description!("[year]-[month]-[day]");
        Transaction {
            booking_date: Date::parse(day, format).unwrap(),
            amount: Money::from_cents(cents),
            counterparty: who.into(),
            purpose: "Kartenzahlung".into(),
            counterparty_iban: None,
            category: Some(category),
        }
    }

    /// September (previous period) and October (running period at 2026-10-11).
    fn history() -> Vec<Transaction> {
        use Category::*;
        vec![
            // September
            Self::tx("2026-09-02", "LIDL SAGT DANKE//Berlin/DE", -4500, Groceries),
            Self::tx("2026-09-04", "REWE Markt GmbH", -6000, Groceries),
            Self::tx("2026-09-05", "ALDI SAGT DANKE", -500, Groceries),
            Self::tx("2026-09-20", "LIDL SAGT DANKE//Berlin/DE", -9000, Groceries), // after day 11
            // October
            Self::tx("2026-10-02", "LIDL SAGT DANKE//Berlin/DE", -2000, Groceries),
            Self::tx("2026-10-03", "LIDL SAGT DANKE//Berlin/DE", -1000, Groceries),
            Self::tx("2026-10-04", "REWE Markt GmbH", -6000, Groceries),
            Self::tx("2026-10-05", "Hofladen Maier", -1000, Groceries),
            Self::tx("2026-10-06", "dm-drogerie markt GmbH", -2000, Shopping),
            Self::tx("2026-10-07", "Amazon EU S.a.r.l.", -5000, Shopping),
            Self::tx("2026-10-08", "REWE Markt GmbH", 1500, Groceries), // refund, not counted
            Self::tx("2026-10-20", "LIDL SAGT DANKE//Berlin/DE", -777, Groceries), // after "today"
        ]
    }

    async fn app(aliases: &[StoreAlias]) -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        store
            .insert_new_transactions(&Self::history())
            .await
            .unwrap();
        Api::router(
            AppState::new(store).with_store_aliases(aliases),
            TokenHash::new(TOKEN),
        )
    }

    async fn request(
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

    async fn get(app: &Router, uri: &str) -> (StatusCode, Value) {
        Self::request(app, Method::GET, uri, None).await
    }
}

fn ids(v: &Value) -> Vec<String> {
    v["chains"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["chain"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn ranks_chains_with_shares_visits_and_change() {
    let app = StoreFixture::app(&[]).await;
    let (status, r) =
        StoreFixture::get(&app, "/v1/spending/stores?period=current&date=2026-10-11").await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(r["start"], "2026-10-01");
    assert_eq!(r["end"], "2026-10-31");
    assert_eq!(r["compare_start"], "2026-09-01");
    assert_eq!(r["compare_end"], "2026-09-11"); // the same 11 days, not the whole of September
    assert_eq!(r["compare_is_partial"], true);
    // 2000 + 1000 + 6000 + 1000 (hofladen) + 2000 (dm); Amazon is not a store; the 20th is the future
    // of the reference date but still inside the period, so it counts: 777 more at Lidl
    assert_eq!(r["total_cents"], 12_777);
    assert_eq!(r["previous_total_cents"], 11_000);

    assert_eq!(ids(&r), ["rewe", "lidl", "dm"]);
    let rewe = &r["chains"][0];
    assert_eq!(rewe["name"], "REWE");
    assert_eq!(rewe["total_cents"], 6000);
    assert_eq!(rewe["visits"], 1);
    assert_eq!(rewe["average_basket_cents"], 6000);
    assert_eq!(rewe["share_permille"], 470); // 6000 / 12777
    assert_eq!(rewe["last_visit"], "2026-10-04");
    assert_eq!(rewe["change_cents"], 0);
    assert_eq!(rewe["change_permille"], 0);

    let lidl = &r["chains"][1];
    assert_eq!(lidl["total_cents"], 3777);
    assert_eq!(lidl["visits"], 3);
    assert_eq!(lidl["average_basket_cents"], 1259);
    assert_eq!(lidl["last_visit"], "2026-10-20");
    assert_eq!(lidl["previous_total_cents"], 4500);
    assert_eq!(lidl["previous_visits"], 1);
    assert_eq!(lidl["change_cents"], -723);
    assert_eq!(lidl["change_permille"], -161);

    let dm = &r["chains"][2];
    assert_eq!(dm["change_permille"], Value::Null); // nothing at dm to compare with

    let other = &r["other"];
    assert_eq!(other["chain"], "other");
    assert_eq!(other["total_cents"], 1000);
    assert_eq!(other["visits"], 1);
}

#[tokio::test]
async fn previous_and_last_n_periods() {
    let app = StoreFixture::app(&[]).await;
    let (_, r) =
        StoreFixture::get(&app, "/v1/spending/stores?period=previous&date=2026-10-11").await;
    assert_eq!(
        (r["start"].as_str(), r["end"].as_str()),
        (Some("2026-09-01"), Some("2026-09-30"))
    );
    assert_eq!(r["compare_is_partial"], false);
    assert_eq!(ids(&r), ["lidl", "rewe", "aldi"]);
    assert_eq!(r["chains"][0]["total_cents"], 13_500);
    assert_eq!(r["chains"][0]["visits"], 2);
    assert_eq!(r["total_cents"], 20_000);
    assert_eq!(r["other"]["visits"], 0);
    assert_eq!(r["other"]["average_basket_cents"], 0);

    let (_, r) = StoreFixture::get(
        &app,
        "/v1/spending/stores?period=last_n&n=2&date=2026-10-11",
    )
    .await;
    assert_eq!(r["start"], "2026-09-01");
    assert_eq!(r["end"], "2026-10-31");
    assert_eq!(r["periods"], 2);
    assert_eq!(r["total_cents"], 20_000 + 12_777);
    // default n is 3
    let (_, r) = StoreFixture::get(&app, "/v1/spending/stores?period=last_n&date=2026-10-11").await;
    assert_eq!(r["periods"], 3);
    assert_eq!(r["start"], "2026-08-01");
}

#[tokio::test]
async fn follows_the_payday_setting() {
    let app = StoreFixture::app(&[]).await;
    let (s, _) = StoreFixture::request(
        &app,
        Method::PUT,
        "/v1/settings",
        Some(json!({"payday": 5})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // payday 5: 5 Oct - 4 Nov; the REWE visit on the 4th belongs to the period before
    let (_, r) = StoreFixture::get(&app, "/v1/spending/stores?date=2026-10-11").await;
    assert_eq!(r["start"], "2026-10-05");
    assert_eq!(r["end"], "2026-11-04");
    assert_eq!(ids(&r), ["dm", "lidl"]);
    assert_eq!(r["chains"][0]["total_cents"], 2000);
    assert_eq!(r["other"]["total_cents"], 1000);
}

#[tokio::test]
async fn aliases_from_the_configuration_apply() {
    let app = StoreFixture::app(&[
        StoreAlias {
            chain: "Hofladen Maier".into(),
            patterns: vec!["hofladen maier".into()],
        },
        StoreAlias {
            chain: "aldi".into(),
            patterns: vec!["Discounter Ecke".into()],
        },
    ])
    .await;
    let (_, r) = StoreFixture::get(&app, "/v1/spending/stores?date=2026-10-11").await;
    let chains = ids(&r);
    assert!(chains.contains(&"hofladen-maier".to_string()), "{chains:?}");
    assert_eq!(r["other"]["total_cents"], 0);
    let farm = r["chains"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["chain"] == "hofladen-maier")
        .unwrap();
    assert_eq!(farm["name"], "Hofladen Maier");
    assert_eq!(farm["total_cents"], 1000);
}

#[tokio::test]
async fn lists_the_purchases_behind_a_total() {
    let app = StoreFixture::app(&[]).await;
    let (status, list) = StoreFixture::get(
        &app,
        "/v1/spending/stores/lidl/transactions?date=2026-10-11",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let rows = list.as_array().unwrap();
    let days: Vec<_> = rows
        .iter()
        .map(|t| t["booking_date"].as_str().unwrap())
        .collect();
    assert_eq!(days, ["2026-10-20", "2026-10-03", "2026-10-02"]); // newest first, this period only
    assert!(rows.iter().all(|t| t["amount_cents"].as_i64().unwrap() < 0));
    assert!(rows[0]["id"].is_i64());

    let (_, list) = StoreFixture::get(
        &app,
        "/v1/spending/stores/other/transactions?date=2026-10-11",
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["counterparty"], "Hofladen Maier");

    // the refund is not a visit
    let (_, list) = StoreFixture::get(
        &app,
        "/v1/spending/stores/rewe/transactions?date=2026-10-11",
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);

    // a known chain without purchases is an empty list; an unknown one is a 404
    let (status, list) = StoreFixture::get(
        &app,
        "/v1/spending/stores/tegut/transactions?date=2026-10-11",
    )
    .await;
    assert_eq!((status, list), (StatusCode::OK, json!([])));
    let (status, _) = StoreFixture::get(&app, "/v1/spending/stores/not-a-shop/transactions").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // same period rules as the summary
    let (_, list) = StoreFixture::get(
        &app,
        "/v1/spending/stores/lidl/transactions?period=previous&date=2026-10-11",
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn validates_input_and_needs_the_token() {
    let app = StoreFixture::app(&[]).await;
    for q in ["n=0&period=last_n", "n=25&period=last_n"] {
        let (status, body) = StoreFixture::get(&app, &format!("/v1/spending/stores?{q}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{q}");
        assert!(body["error"].as_str().unwrap().contains("between 1 and 24"));
    }
    let (status, _) = StoreFixture::get(&app, "/v1/spending/stores?period=sometimes").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/spending/stores")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_empty_database_is_a_valid_empty_report() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let app = Api::router(AppState::new(store), TokenHash::new(TOKEN));
    let (status, r) = StoreFixture::get(&app, "/v1/spending/stores").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(r["chains"], json!([]));
    assert_eq!(r["total_cents"], 0);
    assert_eq!(r["other"]["chain"], "other");
}
