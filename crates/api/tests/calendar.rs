use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";

struct Fixture;

impl Fixture {
    async fn app() -> Router {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        Api::router(AppState::new(store), TokenHash::new(TOKEN))
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

    fn event(calendar: i64, title: &str, date: &str) -> Value {
        json!({
            "calendar_id": calendar, "title": title, "all_day": false,
            "start_date": date, "start_time": "09:00", "end_date": date, "end_time": "10:30",
            "repeat": { "kind": "none", "interval": 1, "weekdays": [] },
            "reminders": [10]
        })
    }
}

#[tokio::test]
async fn a_new_database_has_one_calendar_and_the_last_one_stays() {
    let app = Fixture::app().await;
    let (s, cals) = Fixture::call(&app, Method::GET, "/v1/calendar/calendars", None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(cals.as_array().unwrap().len(), 1);
    assert_eq!(cals[0]["name"], "Personal");
    let id = cals[0]["id"].as_i64().unwrap();
    let (s, _) = Fixture::call(
        &app,
        Method::DELETE,
        &format!("/v1/calendar/calendars/{id}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn calendars_are_added_changed_and_deleted_and_bad_ones_are_refused() {
    let app = Fixture::app().await;
    let (s, work) = Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/calendars",
        Some(json!({ "name": " Work ", "tone": "info", "visible": true })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(work["name"], "Work");
    let id = work["id"].as_i64().unwrap();
    let (s, _) = Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/calendars",
        Some(json!({ "name": "", "tone": "info", "visible": true })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/calendars",
        Some(json!({ "name": "X", "tone": "pink", "visible": true })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, changed) = Fixture::call(
        &app,
        Method::PUT,
        &format!("/v1/calendar/calendars/{id}"),
        Some(json!({ "name": "Job", "tone": "danger", "visible": false })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        (changed["name"].as_str(), changed["visible"].as_bool()),
        (Some("Job"), Some(false))
    );
    let (s, _) = Fixture::call(
        &app,
        Method::PUT,
        "/v1/calendar/calendars/999",
        Some(json!({ "name": "Job", "tone": "danger", "visible": false })),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = Fixture::call(
        &app,
        Method::DELETE,
        &format!("/v1/calendar/calendars/{id}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn events_are_created_listed_by_range_changed_and_deleted() {
    let app = Fixture::app().await;
    let (_, cals) = Fixture::call(&app, Method::GET, "/v1/calendar/calendars", None).await;
    let cal = cals[0]["id"].as_i64().unwrap();
    let (s, e) = Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/events",
        Some(Fixture::event(cal, "Dentist", "2026-11-10")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(e["start_time"], "09:00");
    let id = e["id"].as_i64().unwrap();
    Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/events",
        Some(Fixture::event(cal, "Later", "2027-01-10")),
    )
    .await;

    let (s, list) = Fixture::call(
        &app,
        Method::GET,
        "/v1/calendar/events?from=2026-11-01&to=2026-11-30",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 1);

    let mut changed = Fixture::event(cal, "Dentist (moved)", "2026-11-12");
    changed["location"] = json!("Main street 1");
    let (s, saved) = Fixture::call(
        &app,
        Method::PUT,
        &format!("/v1/calendar/events/{id}"),
        Some(changed),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        (saved["title"].as_str(), saved["location"].as_str()),
        (Some("Dentist (moved)"), Some("Main street 1"))
    );
    let (s, got) = Fixture::call(
        &app,
        Method::GET,
        &format!("/v1/calendar/events/{id}"),
        None,
    )
    .await;
    assert_eq!(
        (s, got["start_date"].as_str()),
        (StatusCode::OK, Some("2026-11-12"))
    );

    let (s, _) = Fixture::call(
        &app,
        Method::DELETE,
        &format!("/v1/calendar/events/{id}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = Fixture::call(
        &app,
        Method::GET,
        &format!("/v1/calendar/events/{id}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn bad_events_are_refused_with_a_reason() {
    let app = Fixture::app().await;
    let (_, cals) = Fixture::call(&app, Method::GET, "/v1/calendar/calendars", None).await;
    let cal = cals[0]["id"].as_i64().unwrap();
    let post = |body: Value| {
        let app = app.clone();
        async move { Fixture::call(&app, Method::POST, "/v1/calendar/events", Some(body)).await }
    };

    let mut e = Fixture::event(cal, "  ", "2026-11-10");
    assert_eq!(
        post(e.clone()).await.0,
        StatusCode::BAD_REQUEST,
        "empty title"
    );
    e = Fixture::event(999, "x", "2026-11-10");
    assert_eq!(post(e).await.0, StatusCode::BAD_REQUEST, "unknown calendar");
    e = Fixture::event(cal, "x", "2026-11-10");
    e["end_time"] = json!("08:00");
    assert_eq!(
        post(e).await.0,
        StatusCode::BAD_REQUEST,
        "ends before it starts"
    );
    e = Fixture::event(cal, "x", "2026-11-10");
    e["start_time"] = json!("9 o'clock");
    assert_eq!(post(e).await.0, StatusCode::BAD_REQUEST, "not a time");
    e = Fixture::event(cal, "x", "2026-11-10");
    e["start_time"] = Value::Null;
    assert_eq!(
        post(e).await.0,
        StatusCode::BAD_REQUEST,
        "timed event without a time"
    );
    e = Fixture::event(cal, "x", "2026-11-10");
    e["repeat"] = json!({ "kind": "weekly", "interval": 0, "weekdays": [] });
    assert_eq!(post(e).await.0, StatusCode::BAD_REQUEST, "interval 0");
    e = Fixture::event(cal, "x", "2026-11-10");
    e["repeat"] = json!({ "kind": "daily", "interval": 1, "weekdays": ["MO"] });
    assert_eq!(
        post(e).await.0,
        StatusCode::BAD_REQUEST,
        "weekdays on a daily repeat"
    );
    e = Fixture::event(cal, "x", "2026-11-10");
    e["repeat"] = json!({ "kind": "daily", "interval": 1, "weekdays": [], "until": "2026-12-01", "count": 3 });
    assert_eq!(
        post(e).await.0,
        StatusCode::BAD_REQUEST,
        "until and count together"
    );
    e = Fixture::event(cal, "x", "2026-11-10");
    e["reminders"] = json!([5, 5]);
    assert_eq!(
        post(e).await.0,
        StatusCode::BAD_REQUEST,
        "the same reminder twice"
    );

    let (s, _) = Fixture::call(
        &app,
        Method::GET,
        "/v1/calendar/events?from=2026-11-30&to=2026-11-01",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "backwards range");
    let (s, _) = Fixture::call(
        &app,
        Method::GET,
        "/v1/calendar/events?from=2020-01-01&to=2026-11-01",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "range too long");
}

#[tokio::test]
async fn a_repeating_event_keeps_its_rule_and_one_occurrence_can_be_deleted() {
    let app = Fixture::app().await;
    let (_, cals) = Fixture::call(&app, Method::GET, "/v1/calendar/calendars", None).await;
    let cal = cals[0]["id"].as_i64().unwrap();
    let mut gym = Fixture::event(cal, "Gym", "2026-11-02");
    gym["repeat"] =
        json!({ "kind": "weekly", "interval": 1, "weekdays": ["MO", "TH"], "count": 10 });
    let (s, saved) = Fixture::call(&app, Method::POST, "/v1/calendar/events", Some(gym)).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(saved["repeat"]["weekdays"], json!(["MO", "TH"]));
    let id = saved["id"].as_i64().unwrap();

    let (s, after) = Fixture::call(
        &app,
        Method::POST,
        &format!("/v1/calendar/events/{id}/exceptions"),
        Some(json!({ "date": "2026-11-09" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(after["exceptions"], json!(["2026-11-09"]));
    // the same day again changes nothing
    let (_, again) = Fixture::call(
        &app,
        Method::POST,
        &format!("/v1/calendar/events/{id}/exceptions"),
        Some(json!({ "date": "2026-11-09" })),
    )
    .await;
    assert_eq!(again["exceptions"], json!(["2026-11-09"]));

    // a single event has no occurrences to delete
    let (_, single) = Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/events",
        Some(Fixture::event(cal, "Once", "2026-11-05")),
    )
    .await;
    let sid = single["id"].as_i64().unwrap();
    let (s, _) = Fixture::call(
        &app,
        Method::POST,
        &format!("/v1/calendar/events/{sid}/exceptions"),
        Some(json!({ "date": "2026-11-05" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn the_calendar_is_part_of_the_export_and_importing_twice_adds_nothing() {
    let app = Fixture::app().await;
    let (_, cals) = Fixture::call(&app, Method::GET, "/v1/calendar/calendars", None).await;
    let cal = cals[0]["id"].as_i64().unwrap();
    let (_, work) = Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/calendars",
        Some(json!({ "name": "Work", "tone": "info", "visible": true })),
    )
    .await;
    Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/events",
        Some(Fixture::event(cal, "Dentist", "2026-11-10")),
    )
    .await;
    Fixture::call(
        &app,
        Method::POST,
        "/v1/calendar/events",
        Some(Fixture::event(
            work["id"].as_i64().unwrap(),
            "Standup",
            "2026-11-11",
        )),
    )
    .await;
    let (s, export) = Fixture::call(&app, Method::GET, "/v1/export", None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(export["events"].as_array().unwrap().len(), 2);
    assert_eq!(export["events"][1]["calendar"], "Work");

    // a fresh backend gets the calendars and events, once
    let fresh = Fixture::app().await;
    let (s, report) = Fixture::call(&fresh, Method::POST, "/v1/import", Some(export.clone())).await;
    assert_eq!(s, StatusCode::OK, "{report}");
    assert_eq!(report["events_added"], 2);
    let (_, report) = Fixture::call(&fresh, Method::POST, "/v1/import", Some(export)).await;
    assert_eq!(report["events_added"], 0);
    let (_, cals) = Fixture::call(&fresh, Method::GET, "/v1/calendar/calendars", None).await;
    assert_eq!(cals.as_array().unwrap().len(), 2);
    let (_, events) = Fixture::call(
        &fresh,
        Method::GET,
        "/v1/calendar/events?from=2026-11-01&to=2026-11-30",
        None,
    )
    .await;
    assert_eq!(events.as_array().unwrap().len(), 2);
}

#[test]
fn the_calendar_routes_are_in_the_openapi_document() {
    let doc: Value = serde_json::from_str(&financer_api::Api::openapi_json()).unwrap();
    let paths = doc["paths"].as_object().unwrap();
    for p in [
        "/v1/calendar/calendars",
        "/v1/calendar/calendars/{id}",
        "/v1/calendar/events",
        "/v1/calendar/events/{id}",
        "/v1/calendar/events/{id}/exceptions",
    ] {
        assert!(paths.contains_key(p), "missing {p}");
    }
}
