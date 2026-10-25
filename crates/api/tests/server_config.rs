//! The server configuration as a settings screen: listing every key, saving a change, refusing a
//! bad one, and restarting once after a good one. The restart itself is a counter here.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_config::{Admin, MapEnv, SettingsFile, SETTINGS_FILE_NAME};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";
const SERVER_TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

struct Fixture {
    app: Router,
    dir: tempfile::TempDir,
    restarts: Arc<AtomicUsize>,
}

impl Fixture {
    async fn new(env: &[(&str, &str)]) -> Fixture {
        Self::build(env, true, None).await
    }

    async fn build(env: &[(&str, &str)], with_admin: bool, settings: Option<&str>) -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let mut vars = vec![("FINANCER_API_TOKEN", SERVER_TOKEN)];
        vars.extend_from_slice(env);
        let settings_path = match settings {
            Some(p) => dir.path().join(p),
            None => dir.path().join(SETTINGS_FILE_NAME),
        };
        let admin = Arc::new(Admin::new(
            None,
            dir.path().to_path_buf(),
            Arc::new(MapEnv::new(&vars)),
            SettingsFile::at(settings_path),
        ));
        let restarts = Arc::new(AtomicUsize::new(0));
        let mut state = AppState::new(Store::connect("sqlite::memory:").await.unwrap());
        if with_admin {
            let counter = restarts.clone();
            state = state
                .with_config_admin(admin, move || {
                    counter.fetch_add(1, Ordering::SeqCst);
                })
                .with_restart_delay(Duration::from_millis(20));
        }
        Fixture {
            app: Api::router(state, TokenHash::new(TOKEN)),
            dir,
            restarts,
        }
    }

    async fn send(
        &self,
        method: Method,
        body: Option<Value>,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri("/v1/server-config");
        if let Some(t) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let req = match body {
            Some(b) => req
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn get(&self) -> (StatusCode, Value) {
        self.send(Method::GET, None, Some(TOKEN)).await
    }

    async fn put(&self, body: Value) -> (StatusCode, Value) {
        self.send(Method::PUT, Some(body), Some(TOKEN)).await
    }

    async fn key(&self, path: &str) -> Value {
        let (_, view) = self.get().await;
        view["groups"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["keys"].as_array().unwrap().iter())
            .find(|k| k["path"] == path)
            .unwrap_or_else(|| panic!("{path} missing"))
            .clone()
    }

    async fn restarts_within(&self, ms: u64) -> usize {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        self.restarts.load(Ordering::SeqCst)
    }

    fn settings_text(&self) -> String {
        std::fs::read_to_string(self.dir.path().join(SETTINGS_FILE_NAME)).unwrap_or_default()
    }
}

#[tokio::test]
async fn needs_the_token() {
    let f = Fixture::new(&[]).await;
    let (s, _) = f.send(Method::GET, None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = f
        .send(Method::PUT, Some(json!({"set": {}})), Some("wrong"))
        .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(f.settings_text(), "");
}

#[tokio::test]
async fn the_phone_backend_has_none() {
    let f = Fixture::build(&[], false, None).await;
    let (s, _) = f.get().await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = f.put(json!({"set": {"server.refresh_hours": 3}})).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn lists_every_group_and_key_with_where_it_comes_from() {
    let f = Fixture::new(&[("FINANCER_BIND", "0.0.0.0:80")]).await;
    let (s, view) = f.get().await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(view["state"], "ok");
    assert_eq!(view["writable"], true);
    let groups = view["groups"].as_array().unwrap();
    assert!(groups.len() >= 10);
    let ids: Vec<_> = groups.iter().map(|g| g["id"].as_str().unwrap()).collect();
    for want in [
        "server", "access", "database", "prices", "ai", "bank", "accounts", "stores", "email",
        "lidl", "folder",
    ] {
        assert!(ids.contains(&want), "{want} missing from {ids:?}");
    }
    let bind = f.key("server.bind").await;
    assert_eq!(
        (bind["source"].as_str(), bind["locked"].as_bool()),
        (Some("env"), Some(true))
    );
    assert_eq!(bind["env"], "FINANCER_BIND");
    assert_eq!(bind["value"], "0.0.0.0:80");
    let hours = f.key("server.refresh_hours").await;
    assert_eq!(hours["source"], "default");
    assert_eq!(hours["default"], "24");
    assert_eq!(f.key("bank.accounts").await["kind"], "table");
    // the token is set (by the environment) but never shown
    let token = f.key("auth.api_token").await;
    assert_eq!(token["is_set"], true);
    assert!(token["value"].is_null());
    assert!(!view.to_string().contains(SERVER_TOKEN));
}

#[tokio::test]
async fn a_change_is_saved_shown_and_applied_by_one_restart() {
    let f = Fixture::new(&[]).await;
    let (s, body) = f
        .put(json!({"set": {
            "server.refresh_hours": 6,
            "llm.anthropic_api_key": "sk-ant-the-secret-value",
            "bank.plaid.client_id": "client-123",
            "bank.plaid.secret": "plaid-the-secret-value",
        }}))
        .await;
    assert_eq!(s, StatusCode::OK, "{body}");
    assert_eq!(body["restarting"], true);
    let changed: Vec<_> = body["changed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(
        changed,
        [
            "bank.plaid.client_id",
            "bank.plaid.secret",
            "llm.anthropic_api_key",
            "server.refresh_hours"
        ]
    );
    // exactly one restart, after the answer
    assert_eq!(f.restarts_within(150).await, 1);

    // saved, and shown without the secrets; the view says the server has not confirmed it yet
    let (_, view) = f.get().await;
    assert_eq!(
        (view["applying"].as_bool(), view["state"].as_str()),
        (Some(true), Some("ok"))
    );
    let hours = f.key("server.refresh_hours").await;
    assert_eq!(
        (hours["source"].as_str(), hours["value"].as_i64()),
        (Some("app"), Some(6))
    );
    let key = f.key("llm.anthropic_api_key").await;
    assert_eq!(
        (key["is_set"].as_bool(), key["source"].as_str()),
        (Some(true), Some("app"))
    );
    let (_, view) = f.get().await;
    assert!(!view.to_string().contains("the-secret-value"));
    let file = f.settings_text();
    assert!(
        file.contains("sk-ant-the-secret-value"),
        "the server keeps what you typed"
    );
    assert!(
        file.contains("\"pending\""),
        "until the restart proves itself: {file}"
    );
}

#[tokio::test]
async fn a_second_change_while_restarting_waits() {
    let f = Fixture::new(&[]).await;
    let (s, _) = f.put(json!({"set": {"server.refresh_hours": 6}})).await;
    assert_eq!(s, StatusCode::OK);
    let (s, body) = f.put(json!({"set": {"server.refresh_hours": 7}})).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert!(
        body["problems"][0].as_str().unwrap().contains("restarting"),
        "{body}"
    );
    assert_eq!(f.restarts_within(150).await, 1, "still just one restart");
}

#[tokio::test]
async fn a_change_that_changes_nothing_does_not_restart() {
    let f = Fixture::new(&[]).await;
    let (s, body) = f.put(json!({"set": {}, "reset": ["llm.provider"]})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        (
            body["restarting"].as_bool(),
            body["changed"].as_array().unwrap().len()
        ),
        (Some(false), 0)
    );
    assert_eq!(f.restarts_within(100).await, 0);
    assert_eq!(f.settings_text(), "");
}

#[tokio::test]
async fn a_mistake_saves_nothing_and_names_the_key() {
    let f = Fixture::new(&[]).await;
    let (s, body) = f
        .put(json!({"set": {
            "server.refresh_hours": 6,
            "llm.provider": "gemini",
            "receipts.email.port": 99999,
        }}))
        .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let problems: Vec<_> = body["problems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(
        problems.iter().any(|p| p.starts_with("llm.provider:")),
        "{problems:?}"
    );
    assert!(
        problems
            .iter()
            .any(|p| p.starts_with("receipts.email.port:")),
        "{problems:?}"
    );
    // the same text, ready to show
    assert_eq!(body["error"].as_str().unwrap(), problems.join("\n"));
    assert_eq!(f.restarts_within(100).await, 0);
    assert_eq!(
        f.settings_text(),
        "",
        "the good value next to the bad ones was not saved either"
    );
    assert_eq!(f.key("server.refresh_hours").await["source"], "default");
}

#[tokio::test]
async fn a_setting_the_environment_decides_cannot_be_changed() {
    let f = Fixture::new(&[("FINANCER_LLM_PROVIDER", "openai")]).await;
    let (s, body) = f.put(json!({"set": {"llm.provider": "claude"}})).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("FINANCER_LLM_PROVIDER"),
        "{body}"
    );
    assert_eq!(f.restarts_within(100).await, 0);
    assert_eq!(f.key("llm.provider").await["locked"], true);
}

#[tokio::test]
async fn accounts_are_saved_as_a_list_and_checked_per_row() {
    let f = Fixture::new(&[]).await;
    let (s, body) = f
        .put(json!({"set": {"bank.accounts": [
            {"name": "Plaid Giro", "kind": "plaid", "sync_every_hours": 12}
        ]}}))
        .await;
    assert_eq!(s, StatusCode::OK, "{body}");
    let accounts = f.key("bank.accounts").await;
    assert_eq!(accounts["source"], "app");
    assert_eq!(accounts["value"][0]["name"], "Plaid Giro");

    // (a fresh server: the first one is busy restarting)
    let f = Fixture::new(&[]).await;
    let (s, body) = f
        .put(json!({"set": {"bank.accounts": [{"name": "Giro", "kind": "fints", "bank_code": "123", "login": "me", "iban": "x"}]}}))
        .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let text = body["error"].as_str().unwrap();
    assert!(
        text.contains("bank.accounts[0].bank_code") && text.contains("bank.accounts[0].iban"),
        "{text}"
    );
}

#[tokio::test]
async fn a_place_that_cannot_be_written_is_explained() {
    let f = Fixture::build(&[], true, Some("missing-folder/settings.json")).await;
    let (_, view) = f.get().await;
    assert_eq!(view["writable"], false);
    let (s, body) = f.put(json!({"set": {"server.refresh_hours": 6}})).await;
    assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("FINANCER_SETTINGS_FILE"),
        "{body}"
    );
    assert_eq!(
        f.restarts_within(100).await,
        0,
        "no restart for a change that was not saved"
    );
}

#[tokio::test]
async fn a_body_that_is_not_a_change_is_a_client_error() {
    let f = Fixture::new(&[]).await;
    let (s, _) = f.put(json!({"set": [1, 2]})).await;
    assert!(s.is_client_error(), "{s}");
    let (s, _) = f.put(json!("nope")).await;
    assert!(s.is_client_error(), "{s}");
    assert_eq!(f.restarts_within(50).await, 0);
}
