use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_core::{Money, Transaction};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::Value;
use time::macros::date;
use time::Date;
use tower::ServiceExt;

const TOKEN: &str = "test-token";

struct WatchFixture;

impl WatchFixture {
    fn tx(d: Date, who: &str, cents: i64) -> Transaction {
        Transaction {
            booking_date: d,
            amount: Money::from_cents(cents),
            counterparty: who.into(),
            purpose: "Lastschrift".into(),
            counterparty_iban: None,
            category: None,
        }
    }

    /// Netflix (steady), Spotify (price hike in the last booking), an old gym membership that
    /// stopped, and a double charge at an electronics shop.
    fn history() -> Vec<Transaction> {
        vec![
            Self::tx(date!(2026 - 06 - 05), "Netflix", -1299),
            Self::tx(date!(2026 - 07 - 05), "Netflix", -1299),
            Self::tx(date!(2026 - 08 - 05), "Netflix", -1299),
            Self::tx(date!(2026 - 09 - 05), "Netflix", -1299),
            Self::tx(date!(2026 - 07 - 15), "Spotify", -999),
            Self::tx(date!(2026 - 08 - 15), "Spotify", -999),
            Self::tx(date!(2026 - 09 - 15), "Spotify", -1199),
            Self::tx(date!(2026 - 01 - 10), "Fitness Studio", -2990),
            Self::tx(date!(2026 - 02 - 10), "Fitness Studio", -2990),
            Self::tx(date!(2026 - 03 - 10), "Fitness Studio", -2990),
            Self::tx(date!(2026 - 09 - 20), "Elektro Markt", -12999),
            Self::tx(date!(2026 - 09 - 22), "Elektro Markt", -12999),
        ]
    }

    async fn app() -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        store
            .insert_new_transactions(&Self::history())
            .await
            .unwrap();
        Api::router(AppState::new(store), TokenHash::new(TOKEN))
    }

    async fn call(app: &Router, method: Method, uri: &str, auth: bool) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if auth {
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
        Self::call(app, Method::GET, uri, true).await
    }
}

#[tokio::test]
async fn subscriptions_report_calendar_hike_and_stale() {
    let app = WatchFixture::app().await;
    let (s, body) = WatchFixture::get(&app, "/v1/subscriptions?as_of=2026-09-25&days=30").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(body["as_of"], "2026-09-25");
    assert_eq!(body["days"], 30);

    // Netflix and Spotify are active; the gym stopped in March
    let active: Vec<&str> = body["active"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["counterparty"].as_str().unwrap())
        .collect();
    assert_eq!(active, vec!["Netflix", "Spotify"]);
    assert_eq!(body["monthly_total_cents"], 1299 + 1199);

    // 5 Oct Netflix, 15 Oct Spotify at the new price
    let upcoming = body["upcoming"].as_array().unwrap();
    assert_eq!(upcoming.len(), 2);
    assert_eq!(upcoming[0]["date"], "2026-10-05");
    assert_eq!(upcoming[0]["counterparty"], "Netflix");
    assert_eq!(upcoming[0]["amount_cents"], 1299);
    assert_eq!(upcoming[0]["cadence"], "monthly");
    assert_eq!(upcoming[0]["overdue"], false);
    assert_eq!(upcoming[1]["date"], "2026-10-15");
    assert_eq!(upcoming[1]["amount_cents"], 1199);

    let hikes = body["price_hikes"].as_array().unwrap();
    assert_eq!(hikes.len(), 1);
    assert_eq!(hikes[0]["counterparty"], "Spotify");
    assert_eq!(hikes[0]["old_amount_cents"], 999);
    assert_eq!(hikes[0]["new_amount_cents"], 1199);
    assert_eq!(hikes[0]["delta_cents"], 200);
    assert_eq!(hikes[0]["percent_bp"], 2002);
    assert_eq!(hikes[0]["since"], "2026-09-15");

    let stale = body["stale"].as_array().unwrap();
    assert_eq!(stale.len(), 1);
    assert_eq!(stale[0]["subscription"]["counterparty"], "Fitness Studio");
    assert_eq!(stale[0]["periods_missed"], 6);
    assert!(body["duplicates"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn the_calendar_horizon_is_adjustable_and_bounded() {
    let app = WatchFixture::app().await;
    let (_, short) = WatchFixture::get(&app, "/v1/subscriptions?as_of=2026-09-25&days=5").await;
    assert!(short["upcoming"].as_array().unwrap().is_empty());
    let (_, long) = WatchFixture::get(&app, "/v1/subscriptions?as_of=2026-09-25&days=70").await;
    assert_eq!(long["upcoming"].as_array().unwrap().len(), 4);
    let (_, huge) = WatchFixture::get(&app, "/v1/subscriptions?as_of=2026-09-25&days=99999").await;
    assert_eq!(huge["days"], 366);
    let (s, _) = WatchFixture::get(&app, "/v1/subscriptions?as_of=not-a-date").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // without as_of it uses today, which is long after the test data: everything is stale
    let (s, now) = WatchFixture::get(&app, "/v1/subscriptions").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(now["days"], 30);
}

#[tokio::test]
async fn alerts_list_dismiss_and_stay_dismissed() {
    let app = WatchFixture::app().await;
    let (s, body) = WatchFixture::get(&app, "/v1/alerts?as_of=2026-09-25").await;
    assert_eq!(s, StatusCode::OK);
    // the double charge, and the first payment to the shop (newest first)
    assert_eq!(body["unread_count"], 2);
    let alerts = body["alerts"].as_array().unwrap();
    assert_eq!(alerts.len(), 2);
    assert_eq!(alerts[1]["kind"], "new_merchant");
    assert_eq!(alerts[1]["booking_date"], "2026-09-20");
    let alert = &alerts[0];
    assert_eq!(alert["kind"], "duplicate_charge");
    assert_eq!(alert["severity"], "high");
    assert_eq!(alert["counterparty"], "Elektro Markt");
    assert_eq!(alert["amount_cents"], 12999);
    assert_eq!(alert["booking_date"], "2026-09-22");
    assert_eq!(alert["dismissed"], false);
    assert!(alert["reason"].as_str().unwrap().contains("129.99 EUR"));
    let id = alert["id"].as_str().unwrap().to_string();

    let uri = format!("/v1/alerts/{id}/dismiss");
    let (s, done) = WatchFixture::call(&app, Method::POST, &uri, true).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(done["dismissed"], true);
    assert_eq!(done["id"], id.as_str());
    // twice is fine
    let (s, _) = WatchFixture::call(&app, Method::POST, &uri, true).await;
    assert_eq!(s, StatusCode::OK);

    let (_, after) = WatchFixture::get(&app, "/v1/alerts?as_of=2026-09-25").await;
    assert_eq!(after["unread_count"], 1);
    assert_eq!(after["alerts"].as_array().unwrap().len(), 1);
    assert_eq!(after["alerts"][0]["kind"], "new_merchant");

    let (_, all) =
        WatchFixture::get(&app, "/v1/alerts?as_of=2026-09-25&include_dismissed=true").await;
    assert_eq!(all["unread_count"], 1);
    assert_eq!(all["alerts"].as_array().unwrap().len(), 2);
    assert_eq!(all["alerts"][0]["dismissed"], true);
    assert_eq!(all["alerts"][0]["id"], id.as_str());
}

#[tokio::test]
async fn alerts_outside_the_lookback_window_are_not_listed() {
    let app = WatchFixture::app().await;
    let (_, body) = WatchFixture::get(&app, "/v1/alerts?as_of=2027-03-01").await;
    assert_eq!(body["unread_count"], 0);
    let (_, wide) = WatchFixture::get(&app, "/v1/alerts?as_of=2027-03-01&lookback_days=365").await;
    assert_eq!(wide["unread_count"], 2);
}

#[tokio::test]
async fn dismissing_an_unknown_alert_is_404_and_everything_needs_the_token() {
    let app = WatchFixture::app().await;
    let (s, _) =
        WatchFixture::call(&app, Method::POST, "/v1/alerts/dup-deadbeef/dismiss", true).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    for (method, uri) in [
        (Method::GET, "/v1/subscriptions"),
        (Method::GET, "/v1/alerts"),
        (Method::POST, "/v1/alerts/x/dismiss"),
    ] {
        let (s, _) = WatchFixture::call(&app, method, uri, false).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "{uri}");
    }
}
