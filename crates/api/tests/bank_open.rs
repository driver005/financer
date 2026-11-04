//! GoCardless and finAPI as bank connection providers, through the real routes: linking on the
//! provider's page, the sealed credential, sync, scheduling, sign in again, disconnect. The
//! providers are scripted stand-ins; nothing here touches the network.

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, BankConnection, BankProvider, TokenHash};
use financer_openbanking::testing::FakeHttp;
use financer_openbanking::{Finapi, FinapiConfig, FinapiEnvironment, GoCardless, GoCardlessConfig};
use financer_receipt_sources::SecretBox;
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";
const SERVER_SECRET: &str = "0123456789abcdef-server-secret";
const GC_KEY: &str = "gocardless-secret-key-1234";

const GC_TOKEN: &str = r#"{"access":"gc-access-token","access_expires":86400}"#;
const REQ_CREATED: &str = r#"{"id":"requisition-VERY-SECRET","status":"CR","link":"https://ob.gocardless.com/psd2/start/x/Y"}"#;
const REQ_WAITING: &str = r#"{"id":"requisition-VERY-SECRET","status":"UA"}"#;
const REQ_LINKED: &str =
    r#"{"id":"requisition-VERY-SECRET","status":"LN","accounts":["acc1","acc2"]}"#;
const REQ_EXPIRED: &str = r#"{"id":"requisition-VERY-SECRET","status":"EX","accounts":[]}"#;
const TXS: &str = r#"{"transactions":{"booked":[
    {"bookingDate":"2026-10-14","transactionAmount":{"amount":"-12.94","currency":"EUR"},"creditorName":"Lidl Dienstleistung GmbH","remittanceInformationUnstructured":"Kartenzahlung"},
    {"bookingDate":"2026-10-01","transactionAmount":{"amount":"2650.00","currency":"EUR"},"debtorName":"Arbeitgeber AG","remittanceInformationUnstructured":"Gehalt Oktober"}],
    "pending":[]}}"#;
const NO_TXS: &str = r#"{"transactions":{"booked":[],"pending":[]}}"#;

fn gocardless_script(fake: FakeHttp) -> FakeHttp {
    fake.answer("POST /api/v2/token/new/", 200, GC_TOKEN)
        .answer("POST /api/v2/requisitions/", 201, REQ_CREATED)
        .answer("GET /api/v2/requisitions/requisition-VERY-SECRET/", 200, REQ_WAITING)
        .answer("GET /api/v2/requisitions/requisition-VERY-SECRET/", 200, REQ_LINKED)
        .answer("GET /api/v2/accounts/acc1/details/", 200, r#"{"account":{"iban":"DE89370400440532013000","name":"Giro"}}"#)
        .answer("GET /api/v2/accounts/acc2/details/", 200, r#"{"account":{"name":"Tagesgeld"}}"#)
        .answer("GET /api/v2/accounts/acc1/balances/", 200, r#"{"balances":[{"balanceType":"closingBooked","balanceAmount":{"amount":"1234.56","currency":"EUR"}}]}"#)
        .answer("GET /api/v2/accounts/acc2/balances/", 200, r#"{"balances":[]}"#)
        .answer("GET /api/v2/accounts/acc1/transactions/", 200, TXS)
        .answer("GET /api/v2/accounts/acc2/transactions/", 200, NO_TXS)
}

fn connection(name: &str, kind: BankProvider, hours: u32) -> BankConnection {
    BankConnection {
        name: name.into(),
        kind,
        account_ids: vec![],
        institution: (kind == BankProvider::GoCardless).then(|| "SPARKASSE_X".to_string()),
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
    fake: Arc<FakeHttp>,
    store: Store,
}

impl Fixture {
    async fn new(fake: FakeHttp, connections: Vec<BankConnection>) -> Fixture {
        Self::build(fake, connections, true, true).await
    }

    async fn build(
        fake: FakeHttp,
        connections: Vec<BankConnection>,
        configured: bool,
        with_secrets: bool,
    ) -> Fixture {
        let fake = Arc::new(fake);
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mut state = AppState::new(store.clone())
            .with_bank_connections(connections)
            .with_connection_poll(Duration::from_millis(10));
        if with_secrets {
            state = state.with_secret_box(SecretBox::new(SERVER_SECRET).unwrap());
        }
        if configured {
            state = state
                .with_provider(Arc::new(GoCardless::new(
                    GoCardlessConfig::new("secret-id".into(), GC_KEY.into()),
                    fake.clone(),
                )))
                .with_provider(Arc::new(Finapi::new(
                    FinapiConfig::new("cid".into(), "csecret".into(), FinapiEnvironment::Sandbox),
                    fake.clone(),
                )));
        }
        Fixture {
            app: Api::router(state.clone(), TokenHash::new(TOKEN)),
            state,
            fake,
            store,
        }
    }

    async fn json(&self, method: Method, uri: &str) -> (StatusCode, Value) {
        self.send(method, uri, None).await
    }

    async fn send(&self, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
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
        let req = req.body(body).unwrap();
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
        self.send(
            Method::POST,
            "/v1/bank/sync",
            Some(json!({ "connection": name })),
        )
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
}

#[tokio::test]
async fn a_gocardless_connection_is_listed_unlinked() {
    let f = Fixture::new(
        FakeHttp::new(),
        vec![connection("Giro", BankProvider::GoCardless, 12)],
    )
    .await;
    let c = f.connection("Giro").await;
    assert_eq!(c["kind"], "gocardless");
    assert_eq!(c["linked"], false);
    assert_eq!(c["state"], "idle");
    assert_eq!(c["accounts"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn linking_gocardless_shows_the_page_then_imports_and_keeps_the_credential_sealed() {
    let f = Fixture::new(
        gocardless_script(FakeHttp::new()),
        vec![connection("Giro", BankProvider::GoCardless, 0)],
    )
    .await;
    let (status, c) = f.sync("Giro").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c["state"], "needs_link");
    assert_eq!(c["link_url"], "https://ob.gocardless.com/psd2/start/x/Y");

    let c = f.wait_for("Giro", "idle").await;
    assert_eq!(c["linked"], true);
    assert_eq!(c["last_result"]["ok"], true);
    assert_eq!(c["last_result"]["imported"], 2);
    assert_eq!(c["balance_cents"], 123_456);
    let accounts = c["accounts"].as_array().unwrap();
    assert_eq!(accounts.len(), 2);
    assert_eq!(accounts[0]["name"], "Giro");
    assert_eq!(accounts[0]["mask"], "3000");
    assert_eq!(f.transactions().await.len(), 2);

    // what is stored is sealed, and nothing secret is in any answer
    let stored = f
        .store
        .get_setting("bankconn.giro.gocardless_access")
        .await
        .unwrap()
        .unwrap();
    assert!(!stored.contains("VERY-SECRET"), "{stored}");
    assert!(!c.to_string().contains("VERY-SECRET"));
    assert!(!c.to_string().contains(GC_KEY));
    let _ = &f.state;
}

#[tokio::test]
async fn a_second_sync_reads_without_asking_for_a_new_sign_in() {
    let f = Fixture::new(
        gocardless_script(FakeHttp::new()),
        vec![connection("Giro", BankProvider::GoCardless, 0)],
    )
    .await;
    f.sync("Giro").await;
    f.wait_for("Giro", "idle").await;
    let (_, c) = f.sync("Giro").await;
    assert_eq!(c["state"], "syncing");
    let c = f.wait_for("Giro", "idle").await;
    assert_eq!(f.fake.count("POST /api/v2/requisitions/"), 1);
    // the same bookings again are recognised, not doubled
    assert_eq!(c["last_result"]["imported"], 0);
    assert_eq!(c["last_result"]["duplicates"], 2);
    assert_eq!(f.transactions().await.len(), 2);
}

#[tokio::test]
async fn an_unconfigured_provider_says_where_to_configure_it() {
    let f = Fixture::build(
        FakeHttp::new(),
        vec![connection("Giro", BankProvider::GoCardless, 0)],
        false,
        true,
    )
    .await;
    let (status, body) = f.sync("Giro").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.to_string().contains("bank.gocardless"), "{body}");
}

#[tokio::test]
async fn without_a_server_secret_nothing_is_started() {
    let f = Fixture::build(
        gocardless_script(FakeHttp::new()),
        vec![connection("Giro", BankProvider::GoCardless, 0)],
        true,
        false,
    )
    .await;
    let (status, body) = f.sync("Giro").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.to_string().contains("FINANCER_SECRET_KEY"), "{body}");
    assert_eq!(f.fake.keys().len(), 0);
}

#[tokio::test]
async fn a_gocardless_connection_without_a_bank_explains_it() {
    let mut c = connection("Giro", BankProvider::GoCardless, 0);
    c.institution = None;
    let f = Fixture::new(gocardless_script(FakeHttp::new()), vec![c]).await;
    let (status, body) = f.sync("Giro").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.to_string().contains("institution"), "{body}");
    let c = f.connection("Giro").await;
    assert_eq!(c["state"], "error");
}

#[tokio::test]
async fn rejected_keys_are_reported_as_a_server_setup_problem() {
    let fake = FakeHttp::new().answer(
        "POST /api/v2/token/new/",
        401,
        r#"{"summary":"Invalid token","detail":"No active account found"}"#,
    );
    let f = Fixture::new(fake, vec![connection("Giro", BankProvider::GoCardless, 0)]).await;
    let (status, body) = f.sync("Giro").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body.to_string().contains("refused the keys"), "{body}");
}

#[tokio::test]
async fn an_expired_consent_drops_the_credential_and_asks_to_link_again() {
    let fake = gocardless_script(FakeHttp::new())
        // the second read finds the consent gone
        .answer(
            "GET /api/v2/requisitions/requisition-VERY-SECRET/",
            200,
            REQ_LINKED,
        )
        .answer(
            "GET /api/v2/requisitions/requisition-VERY-SECRET/",
            200,
            REQ_EXPIRED,
        );
    let f = Fixture::new(fake, vec![connection("Giro", BankProvider::GoCardless, 0)]).await;
    f.sync("Giro").await;
    f.wait_for("Giro", "idle").await;
    f.sync("Giro").await;
    let c = f.wait_for("Giro", "error").await;
    assert!(c["message"].as_str().unwrap().contains("Sync now"), "{c}");
    assert_eq!(c["linked"], false);
}

#[tokio::test]
async fn disconnecting_forgets_the_credential_and_tells_the_provider() {
    let fake = gocardless_script(FakeHttp::new()).answer(
        "DELETE /api/v2/requisitions/requisition-VERY-SECRET/",
        200,
        "{}",
    );
    let f = Fixture::new(fake, vec![connection("Giro", BankProvider::GoCardless, 0)]).await;
    f.sync("Giro").await;
    f.wait_for("Giro", "idle").await;
    let (status, c) = f
        .json(Method::POST, "/v1/bank/connections/Giro/disconnect")
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c["linked"], false);
    assert_eq!(c["accounts"].as_array().unwrap().len(), 0);
    assert_eq!(f.fake.count("DELETE /api/v2/requisitions/"), 1);
    // imported transactions stay
    assert_eq!(f.transactions().await.len(), 2);
}

#[tokio::test]
async fn only_a_linked_connection_syncs_on_schedule() {
    let f = Fixture::new(
        gocardless_script(FakeHttp::new()),
        vec![connection("Giro", BankProvider::GoCardless, 6)],
    )
    .await;
    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 0, "not linked yet");
    f.sync("Giro").await;
    f.wait_for("Giro", "idle").await;
    // just synced: not due again
    assert_eq!(Api::run_due_bank_syncs(&f.state).await, 0);
}

#[tokio::test]
async fn finapi_links_on_its_web_form_and_imports() {
    let fake = FakeHttp::new()
        .answer("POST /api/v2/oauth/token", 200, r#"{"access_token":"tok"}"#)
        .answer("POST /api/v2/users", 201, "{}")
        .answer(
            "POST /api/webForms/bankConnectionImport",
            201,
            r#"{"id":"wf-1","url":"https://webform-sandbox.finapi.io/wf/wf-1"}"#,
        )
        .answer("GET /api/webForms/wf-1", 200, r#"{"status":"IN_PROGRESS"}"#)
        .answer("GET /api/webForms/wf-1", 200, r#"{"status":"COMPLETED"}"#)
        .answer(
            "GET /api/v2/accounts",
            200,
            r#"{"accounts":[{"id":11,"accountName":"Girokonto","iban":"DE89370400440532013000","accountCurrency":"EUR","balance":500.25}]}"#,
        )
        .answer(
            "GET /api/v2/transactions",
            200,
            r#"{"transactions":[{"id":1,"accountId":11,"amount":-9.99,"currency":"EUR","purpose":"Abo","counterpartName":"Streaming","bankBookingDate":"2026-10-03"}],"paging":{"page":1,"perPage":500,"pageCount":1,"totalCount":1}}"#,
        );
    let f = Fixture::new(fake, vec![connection("Fin", BankProvider::Finapi, 0)]).await;
    let (status, c) = f.sync("Fin").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c["kind"], "finapi");
    assert_eq!(c["state"], "needs_link");
    assert_eq!(c["link_url"], "https://webform-sandbox.finapi.io/wf/wf-1");
    let c = f.wait_for("Fin", "idle").await;
    assert_eq!(c["linked"], true);
    assert_eq!(c["balance_cents"], 50_025);
    assert_eq!(c["accounts"][0]["id"], "11");
    assert_eq!(f.transactions().await.len(), 1);
    // the generated finAPI password never reaches an answer or the settings in the clear
    let stored = f
        .store
        .get_setting("bankconn.fin.finapi_access")
        .await
        .unwrap()
        .unwrap();
    assert!(!stored.contains("financer-"), "{stored}");
}

#[tokio::test]
async fn fints_cannot_be_disconnected() {
    let f = Fixture::new(
        FakeHttp::new(),
        vec![connection("Sparkasse", BankProvider::Fints, 0)],
    )
    .await;
    let (status, _) = f
        .json(Method::POST, "/v1/bank/connections/Sparkasse/disconnect")
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
