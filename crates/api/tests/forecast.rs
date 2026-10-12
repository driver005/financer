//! The end-of-period forecast through the real router on SQLite.

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";

struct ForecastFixture;

impl ForecastFixture {
    async fn app() -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        Api::router(AppState::new(store), TokenHash::new(TOKEN))
    }

    async fn send(
        app: &Router,
        method: Method,
        uri: &str,
        body: Body,
        content_type: Option<&str>,
        auth: bool,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if auth {
            req = req.header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        }
        if let Some(ct) = content_type {
            req = req.header(header::CONTENT_TYPE, ct);
        }
        let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn get(app: &Router, uri: &str) -> (StatusCode, Value) {
        Self::send(app, Method::GET, uri, Body::empty(), None, true).await
    }

    async fn put(app: &Router, uri: &str, body: Value) -> (StatusCode, Value) {
        Self::send(
            app,
            Method::PUT,
            uri,
            Body::from(body.to_string()),
            Some("application/json"),
            true,
        )
        .await
    }

    /// Salary around the 28th and rent on the 1st (Dec to Feb), rent paid on 1 March and two
    /// grocery shops in March; the March salary has not arrived.
    async fn with_history() -> Router {
        let app = Self::app().await;
        let mut csv = String::from(
            "\"Auftragskonto\";\"Buchungstag\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"Betrag\"\n",
        );
        for (d, who, purpose, amount) in [
            ("01.12.25", "Vermieter", "Miete Dezember", "-800,00"),
            ("01.01.26", "Vermieter", "Miete Januar", "-800,00"),
            ("01.02.26", "Vermieter", "Miete Februar", "-800,00"),
            ("01.03.26", "Vermieter", "Miete Maerz", "-800,00"),
            ("28.12.25", "Arbeitgeber AG", "Gehalt", "2.500,00"),
            ("28.01.26", "Arbeitgeber AG", "Gehalt", "2.500,00"),
            ("27.02.26", "Arbeitgeber AG", "Gehalt", "2.500,00"),
            ("02.03.26", "REWE Markt", "Kartenzahlung", "-23,47"),
            ("09.03.26", "LIDL", "Kartenzahlung", "-31,03"),
        ] {
            csv.push_str(&format!(
                "\"DE89370400440532013000\";\"{d}\";\"{purpose}\";\"{who}\";\"\";\"{amount}\"\n"
            ));
        }
        let (s, _) = Self::send(
            &app,
            Method::POST,
            "/v1/transactions/import",
            Body::from(csv),
            Some("text/csv"),
            true,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        app
    }
}

#[tokio::test]
async fn an_empty_database_gives_a_calm_forecast() {
    let app = ForecastFixture::app().await;
    let (s, f) = ForecastFixture::get(&app, "/v1/forecast?date=2026-03-10").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(f["level"], "ok");
    assert_eq!(f["reason"], "no_data");
    assert_eq!(f["period_start"], "2026-03-01");
    assert_eq!(f["period_end"], "2026-03-31");
    assert_eq!(f["days_through"], 10);
    assert_eq!(f["projected_leftover_cents"], 0);
    assert!(f["grocery_run_out"].is_null());
    assert!(f["grocery_limit_cents"].is_null());
}

#[tokio::test]
async fn projects_the_period_from_the_pace_and_the_income_still_to_come() {
    let app = ForecastFixture::with_history().await;
    let (s, f) = ForecastFixture::get(&app, "/v1/forecast?date=2026-03-10").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(f["income_detected"], true);
    assert_eq!(f["income_received_cents"], 0);
    assert_eq!(f["income_upcoming_cents"], 250000);
    assert_eq!(f["next_income_date"], "2026-03-27");
    // rent 800 and 54,50 of groceries
    assert_eq!(f["spent_so_far_cents"], 85450);
    assert_eq!(f["grocery_spent_cents"], 5450);
    assert_eq!(f["grocery_daily_cents"], 545);
    assert_eq!(f["days_after_today"], 21);
    assert_eq!(f["projected_extra_spend_cents"], 5450 * 21 / 10);
    assert_eq!(
        f["projected_leftover_cents"],
        250000 - 85450 - 5450 * 21 / 10
    );
    assert_eq!(f["level"], "ok");
    assert_eq!(f["reason"], "income_pending");
}

#[tokio::test]
async fn a_small_grocery_budget_runs_out_on_a_date_and_a_payday_moves_the_period() {
    let app = ForecastFixture::with_history().await;
    let (s, _) = ForecastFixture::put(
        &app,
        "/v1/budget/envelopes",
        json!([{"category": "groceries", "limit_cents": 10000}]),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, f) = ForecastFixture::get(&app, "/v1/forecast?date=2026-03-10").await;
    assert_eq!(f["grocery_limit_cents"], 10000);
    // 54,50 of 100 at 5,45 a day: k = ceil(4550 * 10 / 5450) = 9 days after the 10th
    assert_eq!(f["grocery_run_out"], "2026-03-19");
    assert_eq!(f["grocery_exhausted"], false);
    assert_eq!(f["level"], "watch");
    assert_eq!(f["reason"], "groceries_run_out");

    // payday 25: on 10 March the period started on 25 February
    let (s, _) = ForecastFixture::put(&app, "/v1/settings", json!({ "payday": 25 })).await;
    assert_eq!(s, StatusCode::OK);
    let (_, f) = ForecastFixture::get(&app, "/v1/forecast?date=2026-03-10").await;
    assert_eq!(f["payday"], 25);
    assert_eq!(f["period_start"], "2026-02-25");
    assert_eq!(f["period_end"], "2026-03-24");
    assert_eq!(f["days_through"], 14);
}

#[tokio::test]
async fn rejects_a_bad_date_and_needs_the_token() {
    let app = ForecastFixture::app().await;
    let (s, _) = ForecastFixture::get(&app, "/v1/forecast?date=nope").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = ForecastFixture::send(
        &app,
        Method::GET,
        "/v1/forecast",
        Body::empty(),
        None,
        false,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}
