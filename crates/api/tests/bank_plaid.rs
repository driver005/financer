//! Plaid as a bank connection provider: linking on Plaid's page, the sealed access token, sync by
//! cursor, scheduling, sign-in again, disconnect. Plaid is a scripted stand-in; nothing here
//! touches the network.

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, BankConnection, BankProvider, PlaidSetup, TokenHash};
use financer_plaid::testing::FakePlaidHttp;
use financer_plaid::{PlaidClient, PlaidConfig, PlaidEnvironment};
use financer_receipt_sources::SecretBox;
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";
const SERVER_SECRET: &str = "0123456789abcdef-server-secret";
const ACCESS: &str = "access-sandbox-VERY-SECRET-TOKEN";
const PLAID_SECRET: &str = "plaid-secret-value-1234";

const LINK_CREATED: &str = r#"{"link_token":"link-sandbox-1","hosted_link_url":"https://secure.plaid.com/hl/abc","expiration":"2099-01-01T00:00:00Z"}"#;
const LINK_EXPIRED: &str = r#"{"link_token":"link-sandbox-1","hosted_link_url":"https://secure.plaid.com/hl/abc","expiration":"2020-01-01T00:00:00Z"}"#;
const LINK_WAITING: &str = r#"{"link_sessions":[]}"#;
const LINK_DONE: &str =
    r#"{"link_sessions":[{"results":{"item_add_results":[{"public_token":"public-sandbox-9"}]}}]}"#;
const EXCHANGED: &str = r#"{"access_token":"access-sandbox-VERY-SECRET-TOKEN","item_id":"item-1"}"#;
const PAGE: &str = r#"{"added":[
    {"account_id":"acc1","amount":12.94,"iso_currency_code":"EUR","date":"2026-10-14","name":"Lidl Dienstleistung GmbH","pending":false},
    {"account_id":"acc1","amount":-2650.0,"iso_currency_code":"EUR","date":"2026-10-01","name":"Arbeitgeber AG Gehalt","pending":false},
    {"account_id":"acc2","amount":5.0,"iso_currency_code":"EUR","date":"2026-10-12","name":"Other account","pending":false}],
    "modified":[],"removed":[],"next_cursor":"cursor-1","has_more":false}"#;
const EMPTY_PAGE: &str =
    r#"{"added":[],"modified":[],"removed":[],"next_cursor":"cursor-2","has_more":false}"#;
const ACCOUNTS: &str = r#"{"accounts":[
    {"account_id":"acc1","name":"Giro","mask":"0000","type":"depository","balances":{"current":1234.56,"iso_currency_code":"EUR"}},
    {"account_id":"acc2","name":"Tagesgeld","mask":"1111","type":"depository","balances":{"current":100.0,"iso_currency_code":"EUR"}}]}"#;
const LOGIN_REQUIRED: &str =
    r#"{"error_type":"ITEM_ERROR","error_code":"ITEM_LOGIN_REQUIRED","error_message":"changed"}"#;

/// The usual script: link, exchange, one page of transactions, accounts.
fn linking(fake: FakePlaidHttp) -> FakePlaidHttp {
    fake.answer("/link/token/create", 200, LINK_CREATED)
        .answer("/link/token/get", 200, LINK_WAITING)
        .answer("/link/token/get", 200, LINK_DONE)
        .answer("/item/public_token/exchange", 200, EXCHANGED)
        .answer("/transactions/sync", 200, PAGE)
        .answer("/accounts/get", 200, ACCOUNTS)
}

fn plaid_connection(name: &str, hours: u32, account_ids: &[&str]) -> BankConnection {
    BankConnection {
        name: name.into(),
        kind: BankProvider::Plaid,
        account_ids: account_ids.iter().map(|s| s.to_string()).collect(),
        bank_code: String::new(),
        login: String::new(),
        iban: String::new(),
        bic: None,
        fints_url: None,
        pin_env: None,
        sync_every_hours: hours,
        since_days: Some(60),
    }
}

struct Fixture {
    app: Router,
    state: AppState,
    plaid: Arc<FakePlaidHttp>,
    store: Store,
}

impl Fixture {
    async fn new(plaid: FakePlaidHttp, connections: Vec<BankConnection>) -> Fixture {
        Self::build(plaid, connections, true, true).await
    }

    async fn build(
        plaid: FakePlaidHttp,
        connections: Vec<BankConnection>,
        with_plaid: bool,
        with_secrets: bool,
    ) -> Fixture {
        let plaid = Arc::new(plaid);
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mut state = AppState::new(store.clone())
            .with_bank_connections(connections)
            .with_connection_poll(Duration::from_millis(10));
        if with_secrets {
            state = state.with_secret_box(SecretBox::new(SERVER_SECRET).unwrap());
        }
        if with_plaid {
            state = state.with_plaid(PlaidSetup {
                client: Arc::new(PlaidClient::new(
                    PlaidConfig::new(
                        "client-1".into(),
                        PLAID_SECRET.into(),
                        PlaidEnvironment::Sandbox,
                    ),
                    plaid.clone(),
                )),
                country_codes: vec!["DE".into()],
                language: "de".into(),
                redirect_uri: None,
            });
        }
        Fixture {
            app: Api::router(state.clone(), TokenHash::new(TOKEN)),
            state,
            plaid,
            store,
        }
    }

    async fn json(&self, method: Method, uri: &str) -> (StatusCode, Value) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn connection(&self, name: &str) -> Value {
        let (_, list) = self.json(Method::GET, "/v1/bank/connections").await;
        list.as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .cloned()
            .unwrap_or(Value::Null)
    }

    async fn wait_for(&self, name: &str, state: &str) -> Value {
        for _ in 0..400 {
            let c = self.connection(name).await;
            if c["state"] == state {
                return c;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "{name} never reached {state}: {}",
            self.connection(name).await
        );
    }

    async fn sync(&self, name: &str) -> (StatusCode, Value) {
        self.json(Method::POST, &format!("/v1/bank/connections/{name}/sync"))
            .await
    }

    async fn transactions(&self) -> Vec<Value> {
        self.json(Method::GET, "/v1/transactions")
            .await
            .1
            .as_array()
            .unwrap()
            .clone()
    }

    /// Link and finish the first sync.
    async fn linked(plaid: FakePlaidHttp, connections: Vec<BankConnection>) -> Fixture {
        let f = Fixture::new(plaid, connections).await;
        let name = f.state_first_name();
        assert_eq!(f.sync(&name).await.0, StatusCode::OK);
        f.wait_for(&name, "idle").await;
        f
    }

    fn state_first_name(&self) -> String {
        // the tests name their one connection "PlaidGiro"
        "PlaidGiro".into()
    }
}

#[tokio::test]
async fn a_plaid_connection_is_listed_unlinked_and_without_secrets() {
    let f = Fixture::new(
        FakePlaidHttp::new(),
        vec![plaid_connection("PlaidGiro", 12, &[])],
    )
    .await;
    let (status, list) = f.json(Method::GET, "/v1/bank/connections").await;
    assert_eq!(status, StatusCode::OK);
    let c = &list[0];
    assert_eq!(c["kind"], "plaid");
    assert_eq!(c["linked"], false);
    assert_eq!(c["state"], "idle");
    assert_eq!(c["bank_code"], "");
    assert_eq!(
        c["sync_due"], false,
        "Plaid needs no PIN, so nothing is waiting for one"
    );
    assert!(c["link_url"].is_null());
    assert_eq!(c["accounts"], json!([]));
}

#[tokio::test]
async fn signing_in_on_plaids_page_links_the_connection_and_imports() {
    let f = Fixture::new(
        linking(FakePlaidHttp::new()),
        vec![plaid_connection("PlaidGiro", 0, &["acc1"])],
    )
    .await;
    let (status, c) = f.sync("PlaidGiro").await;
    assert_eq!(status, StatusCode::OK);
    // the app is told where to sign in
    assert_eq!(c["state"], "needs_link");
    assert_eq!(c["link_url"], "https://secure.plaid.com/hl/abc");
    assert!(c["approval_expires_at"].is_number());
    assert_eq!(c["linked"], false);

    let done = f.wait_for("PlaidGiro", "idle").await;
    assert_eq!(done["linked"], true);
    assert!(done["link_url"].is_null());
    assert_eq!(done["last_result"]["ok"], true);
    // only acc1 was asked for: its two transactions, not the one of acc2
    assert_eq!(done["last_result"]["imported"], 2);
    assert_eq!(f.transactions().await.len(), 2);
    assert_eq!(done["balance_cents"], 123_456);
    assert_eq!(done["accounts"][0]["id"], "acc1");
    assert_eq!(done["accounts"][1]["mask"], "1111");
    // the link asked for transactions and the connection's history
    assert_eq!(f.plaid.body_of(0)["transactions"]["days_requested"], 60);
    // the first read starts from the beginning
    let sync_at = f
        .plaid
        .paths()
        .iter()
        .position(|p| p == "/transactions/sync")
        .unwrap();
    assert!(f.plaid.body_of(sync_at).get("cursor").is_none());
}

#[tokio::test]
async fn the_access_token_is_stored_sealed_and_never_listed() {
    let f = Fixture::linked(
        linking(FakePlaidHttp::new()),
        vec![plaid_connection("PlaidGiro", 0, &[])],
    )
    .await;
    let stored = f
        .store
        .get_setting("bankconn.plaidgiro.plaid_access")
        .await
        .unwrap()
        .unwrap();
    assert!(stored.starts_with("v1."), "{stored}");
    assert!(
        !stored.contains(ACCESS) && !stored.contains("VERY-SECRET"),
        "{stored}"
    );
    let (_, text) = (
        StatusCode::OK,
        serde_json::to_string(&f.connection("PlaidGiro").await).unwrap(),
    );
    for secret in [
        ACCESS,
        "VERY-SECRET",
        PLAID_SECRET,
        "public-sandbox-9",
        "link-sandbox-1",
        &stored,
    ] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
}

#[tokio::test]
async fn a_linked_connection_syncs_again_without_a_new_sign_in_and_by_cursor() {
    let plaid = linking(FakePlaidHttp::new()).answer("/transactions/sync", 200, EMPTY_PAGE);
    let f = Fixture::linked(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    let before = f
        .plaid
        .paths()
        .iter()
        .filter(|p| *p == "/link/token/create")
        .count();
    assert_eq!(before, 1);

    let (status, c) = f.sync("PlaidGiro").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c["state"], "syncing", "no page to open, it just reads");
    f.wait_for("PlaidGiro", "idle").await;
    let paths = f.plaid.paths();
    assert_eq!(
        paths.iter().filter(|p| *p == "/link/token/create").count(),
        1,
        "{paths:?}"
    );
    // the cursor of the first read starts the second
    let last_sync = paths
        .iter()
        .rposition(|p| p == "/transactions/sync")
        .unwrap();
    assert_eq!(f.plaid.body_of(last_sync)["cursor"], "cursor-1");
    // and the access token it sent is the one that was kept
    assert_eq!(f.plaid.body_of(last_sync)["access_token"], ACCESS);
}

#[tokio::test]
async fn syncing_the_same_period_twice_does_not_double_the_transactions() {
    let plaid = linking(FakePlaidHttp::new()).answer("/transactions/sync", 200, PAGE);
    let f = Fixture::linked(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    assert_eq!(f.transactions().await.len(), 3);
    f.sync("PlaidGiro").await;
    let c = f.wait_for("PlaidGiro", "idle").await;
    assert_eq!(c["last_result"]["imported"], 0);
    assert_eq!(c["last_result"]["duplicates"], 3);
    assert_eq!(f.transactions().await.len(), 3);
}

#[tokio::test]
async fn cancelling_the_sign_in_stops_waiting() {
    let plaid = FakePlaidHttp::new()
        .answer("/link/token/create", 200, LINK_CREATED)
        .answer("/link/token/get", 200, LINK_WAITING);
    let f = Fixture::new(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    f.sync("PlaidGiro").await;
    f.wait_for("PlaidGiro", "needs_link").await;
    let (status, c) = f
        .json(Method::POST, "/v1/bank/connections/PlaidGiro/cancel")
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c["state"], "idle");
    assert!(c["link_url"].is_null());
    assert_eq!(c["linked"], false);
    // it can start again afterwards
    assert_eq!(f.sync("PlaidGiro").await.1["state"], "needs_link");
}

#[tokio::test]
async fn an_expired_sign_in_page_ends_in_an_error_that_says_what_to_do() {
    let plaid = FakePlaidHttp::new()
        .answer("/link/token/create", 200, LINK_EXPIRED)
        .answer("/link/token/get", 200, LINK_WAITING);
    let f = Fixture::new(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    f.sync("PlaidGiro").await;
    let c = f.wait_for("PlaidGiro", "error").await;
    assert!(c["message"].as_str().unwrap().contains("expired"), "{c}");
    assert_eq!(c["linked"], false);
}

#[tokio::test]
async fn a_bank_that_wants_a_new_sign_in_unlinks_the_connection() {
    let plaid = linking(FakePlaidHttp::new()).answer("/transactions/sync", 400, LOGIN_REQUIRED);
    let f = Fixture::linked(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    f.sync("PlaidGiro").await;
    let c = f.wait_for("PlaidGiro", "error").await;
    assert!(
        c["message"].as_str().unwrap().contains("sign in again"),
        "{c}"
    );
    assert_eq!(c["linked"], false, "the old access is useless now");
    let stored = f
        .store
        .get_setting("bankconn.plaidgiro.plaid_access")
        .await
        .unwrap();
    assert!(stored.is_none_or(|s| s.is_empty()));
}

#[tokio::test]
async fn disconnect_tells_plaid_forgets_the_access_and_keeps_the_transactions() {
    let plaid = linking(FakePlaidHttp::new()).answer("/item/remove", 200, r#"{"removed":true}"#);
    let f = Fixture::linked(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    assert_eq!(f.transactions().await.len(), 3);
    let (status, c) = f
        .json(Method::POST, "/v1/bank/connections/PlaidGiro/disconnect")
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c["linked"], false);
    assert_eq!(c["accounts"], json!([]));
    assert!(f.plaid.paths().contains(&"/item/remove".to_string()));
    let removed_at = f
        .plaid
        .paths()
        .iter()
        .position(|p| p == "/item/remove")
        .unwrap();
    assert_eq!(f.plaid.body_of(removed_at)["access_token"], ACCESS);
    assert_eq!(f.transactions().await.len(), 3, "imported rows stay");
}

#[tokio::test]
async fn disconnect_still_forgets_when_plaid_cannot_be_reached() {
    let plaid = linking(FakePlaidHttp::new()).answer("/item/remove", 502, "bad gateway");
    let f = Fixture::linked(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    let (status, c) = f
        .json(Method::POST, "/v1/bank/connections/PlaidGiro/disconnect")
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c["linked"], false);
}

#[tokio::test]
async fn only_a_plaid_connection_can_be_disconnected() {
    let f = Fixture::new(
        FakePlaidHttp::new(),
        vec![
            plaid_connection("PlaidGiro", 0, &[]),
            BankConnection {
                kind: BankProvider::Fints,
                ..plaid_connection("Sparkasse", 0, &[])
            },
        ],
    )
    .await;
    assert_eq!(
        f.json(Method::POST, "/v1/bank/connections/Sparkasse/disconnect")
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        f.json(Method::POST, "/v1/bank/connections/Nope/disconnect")
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn without_plaid_keys_on_the_server_the_answer_says_how_to_set_it_up() {
    let f = Fixture::build(
        FakePlaidHttp::new(),
        vec![plaid_connection("PlaidGiro", 0, &[])],
        false,
        true,
    )
    .await;
    let (status, body) = f.sync("PlaidGiro").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.to_string().contains("bank.plaid"), "{body}");
}

#[tokio::test]
async fn without_a_server_secret_the_access_token_is_not_kept_at_all() {
    let f = Fixture::build(
        FakePlaidHttp::new(),
        vec![plaid_connection("PlaidGiro", 0, &[])],
        true,
        false,
    )
    .await;
    let (status, body) = f.sync("PlaidGiro").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.to_string().contains("FINANCER_SECRET_KEY"), "{body}");
    assert!(f.plaid.paths().is_empty(), "nothing was sent to Plaid");
}

#[tokio::test]
async fn a_failure_to_reach_plaid_while_linking_is_reported_and_leaves_the_connection_usable() {
    let plaid = FakePlaidHttp::new().answer("/link/token/create", 500, "oops");
    let f = Fixture::new(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    let (status, _) = f.sync("PlaidGiro").await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    let c = f.connection("PlaidGiro").await;
    assert_eq!(c["state"], "error");
    assert!(c["message"].as_str().unwrap().contains("Plaid"), "{c}");
}

#[tokio::test]
async fn the_scheduler_syncs_linked_plaid_connections_by_itself_and_leaves_unlinked_ones() {
    let plaid = linking(FakePlaidHttp::new()).answer("/transactions/sync", 200, EMPTY_PAGE);
    let f = Fixture::linked(
        plaid,
        vec![
            plaid_connection("PlaidGiro", 12, &[]),
            plaid_connection("Other", 12, &[]),
        ],
    )
    .await;
    // "PlaidGiro" is linked and was just synced: not due yet; "Other" was never linked
    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 0);
    // after the interval it is due (last attempt moved back); still only the linked one starts
    f.store
        .set_setting("bankconn.plaidgiro.last_attempt_at", "0")
        .await
        .unwrap();
    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 1);
    f.wait_for("PlaidGiro", "idle").await;
    assert_eq!(f.connection("Other").await["state"], "idle");
}

#[tokio::test]
async fn two_syncs_cannot_run_at_once() {
    let plaid = FakePlaidHttp::new()
        .answer("/link/token/create", 200, LINK_CREATED)
        .answer("/link/token/get", 200, LINK_WAITING);
    let f = Fixture::new(plaid, vec![plaid_connection("PlaidGiro", 0, &[])]).await;
    assert_eq!(f.sync("PlaidGiro").await.0, StatusCode::OK);
    assert_eq!(f.sync("PlaidGiro").await.0, StatusCode::CONFLICT);
}
