//! Payday-based budget periods and "safe to spend today" through the real router.

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";

struct PeriodFixture;

impl PeriodFixture {
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

    async fn set_payday(app: &Router, payday: i64) {
        let (s, _) = Self::put(app, "/v1/settings", json!({ "payday": payday })).await;
        assert_eq!(s, StatusCode::OK);
    }

    /// Salary on the 28th, rent on the 1st (Jan to Mar 2026) and two grocery shops in March.
    async fn with_history() -> Router {
        let app = Self::app().await;
        let mut csv = String::from(
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

    fn groceries_spent(status: &Value) -> Option<i64> {
        status
            .as_array()?
            .iter()
            .find(|e| e["category"] == "groceries")
            .and_then(|e| e["spent_cents"].as_i64())
    }
}

#[tokio::test]
async fn payday_defaults_to_the_calendar_month_and_validates() {
    let app = PeriodFixture::app().await;
    let (s, settings) = PeriodFixture::get(&app, "/v1/settings").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(settings["payday"], 1);

    PeriodFixture::set_payday(&app, 25).await;
    let (_, settings) = PeriodFixture::get(&app, "/v1/settings").await;
    assert_eq!(settings["payday"], 25);

    for bad in [0, 29, 31, -3, 1000] {
        let (s, body) = PeriodFixture::put(&app, "/v1/settings", json!({ "payday": bad })).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "payday {bad}");
        assert!(body["error"].as_str().unwrap().contains("1 to 28"));
    }
    // a rejected value changes nothing, and other settings keep working
    let (_, settings) = PeriodFixture::get(&app, "/v1/settings").await;
    assert_eq!(settings["payday"], 25);
    let (s, settings) =
        PeriodFixture::put(&app, "/v1/settings", json!({ "habit_mode": "receipts" })).await;
    assert_eq!((s, settings["payday"].as_i64()), (StatusCode::OK, Some(25)));
}

#[tokio::test]
async fn period_endpoint_follows_the_payday() {
    let app = PeriodFixture::app().await;
    let (s, p) = PeriodFixture::get(&app, "/v1/budget/period?date=2026-10-11").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        (p["start"].as_str(), p["end"].as_str(), p["days"].as_u64()),
        (Some("2026-10-01"), Some("2026-10-31"), Some(31))
    );
    assert_eq!(p["days_left"], 21);

    PeriodFixture::set_payday(&app, 25).await;
    let (_, p) = PeriodFixture::get(&app, "/v1/budget/period?date=2026-10-11").await;
    assert_eq!(p["start"], "2026-09-25");
    assert_eq!(p["end"], "2026-10-24");
    assert_eq!(p["days"], 30);
    assert_eq!(p["days_left"], 14);
    assert_eq!(p["payday"], 25);

    let (_, prev) =
        PeriodFixture::get(&app, "/v1/budget/period?period=previous&date=2026-10-11").await;
    assert_eq!(prev["start"], "2026-08-25");
    assert_eq!(prev["end"], "2026-09-24");
    assert_eq!(prev["days_left"], 0);

    // across the year end
    let (_, p) = PeriodFixture::get(&app, "/v1/budget/period?date=2027-01-03").await;
    assert_eq!(p["start"], "2026-12-25");
    assert_eq!(p["end"], "2027-01-24");

    // no date means today, which is always inside the period it reports
    let (_, p) = PeriodFixture::get(&app, "/v1/budget/period").await;
    assert!(p["days_left"].as_u64().unwrap() >= 1);

    let (s, _) = PeriodFixture::get(&app, "/v1/budget/period?date=not-a-date").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn month_based_status_is_unchanged_at_payday_one_and_shifts_with_a_payday() {
    let app = PeriodFixture::with_history().await;
    let (s, _) = PeriodFixture::put(
        &app,
        "/v1/budget/envelopes",
        json!([{"category": "groceries", "limit_cents": 40000}]),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, st) = PeriodFixture::get(&app, "/v1/budget/status?year=2026&month=3").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(PeriodFixture::groceries_spent(&st), Some(5450));
    let (_, st) = PeriodFixture::get(&app, "/v1/budget/status?year=2026&month=2").await;
    assert_eq!(PeriodFixture::groceries_spent(&st), Some(0));

    // payday 10: the "March" period runs 10 Mar to 9 Apr, so the 9 March shop belongs to February's
    PeriodFixture::set_payday(&app, 10).await;
    let (_, st) = PeriodFixture::get(&app, "/v1/budget/status?year=2026&month=3").await;
    assert_eq!(PeriodFixture::groceries_spent(&st), Some(0));
    let (_, st) = PeriodFixture::get(&app, "/v1/budget/status?year=2026&month=2").await;
    assert_eq!(PeriodFixture::groceries_spent(&st), Some(5450));
    let (_, st) =
        PeriodFixture::get(&app, "/v1/budget/status?period=previous&date=2026-03-20").await;
    assert_eq!(PeriodFixture::groceries_spent(&st), Some(5450));
    let (_, st) =
        PeriodFixture::get(&app, "/v1/budget/status?period=current&date=2026-03-20").await;
    assert_eq!(PeriodFixture::groceries_spent(&st), Some(0));

    // bad combinations stay 400
    for uri in [
        "/v1/budget/status?year=2026",
        "/v1/budget/status?month=3",
        "/v1/budget/status?year=2026&month=13",
        "/v1/budget/status?year=2026&month=3&period=current",
    ] {
        let (s, _) = PeriodFixture::get(&app, uri).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{uri}");
    }
}

#[tokio::test]
async fn safe_to_spend_explains_itself() {
    let app = PeriodFixture::with_history().await;
    let (s, _) = PeriodFixture::put(
        &app,
        "/v1/budget/envelopes",
        json!([{"category": "groceries", "limit_cents": 40000}]),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = PeriodFixture::get(&app, "/v1/budget/safe-to-spend?date=2026-03-30").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["period_start"], "2026-03-01");
    assert_eq!(v["period_end"], "2026-03-31");
    assert_eq!(v["days_left"], 2);
    assert_eq!(v["days_total"], 31);
    assert_eq!(v["income_detected"], true);
    assert_eq!(v["income_received_cents"], 250_000);
    assert_eq!(v["income_upcoming_cents"], 0);
    assert_eq!(v["income_cents"], 250_000);
    // rent 800 + groceries 23,47 + 31,03
    assert_eq!(v["spent_so_far_cents"], 85_450);
    assert_eq!(v["fixed_costs_due_cents"], 0);
    // groceries: 400 planned, 54,50 spent
    assert_eq!(v["envelope_headroom_cents"], 34_550);
    assert_eq!(v["available_cents"], 250_000 - 85_450 - 34_550);
    assert_eq!(v["daily_cents"], 130_000 / 2);
    assert_eq!(v["pace"], "on_track");
    assert_eq!(v["payday"], 1);

    // the same day with a payday of 25 is in the period 25 Mar to 24 Apr: salary (28 Mar) is in it
    PeriodFixture::set_payday(&app, 25).await;
    let (_, v) = PeriodFixture::get(&app, "/v1/budget/safe-to-spend?date=2026-03-30").await;
    assert_eq!(v["period_start"], "2026-03-25");
    assert_eq!(v["period_end"], "2026-04-24");
    assert_eq!(v["days_left"], 26);
    assert_eq!(v["spent_so_far_cents"], 0);
    assert_eq!(v["income_received_cents"], 250_000);
    // rent is next due on 1 April
    assert_eq!(v["fixed_costs_due_cents"], 80_000);
}

#[tokio::test]
async fn safe_to_spend_without_data_is_zero_and_says_why() {
    let app = PeriodFixture::app().await;
    let (s, v) = PeriodFixture::get(&app, "/v1/budget/safe-to-spend?date=2026-03-10").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["income_detected"], false);
    assert_eq!(v["daily_cents"], 0);
    assert_eq!(v["available_cents"], 0);
    assert_eq!(v["pace"], "unknown");
}

#[tokio::test]
async fn the_new_endpoints_need_the_token() {
    let app = PeriodFixture::app().await;
    for uri in ["/v1/budget/period", "/v1/budget/safe-to-spend"] {
        let (s, _) = PeriodFixture::send(&app, Method::GET, uri, Body::empty(), None, false).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "{uri}");
    }
}
