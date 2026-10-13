//! The receipt source endpoints, against a fake mailbox, a fake Lidl and a temporary folder.
//! Nothing here talks to a real mail server or retailer.

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_core::{Money, Transaction};
use financer_receipt_sources::config::{EmailConfig, FolderConfig, LidlPlusConfig, OnDone};
use financer_receipt_sources::lidl::Method as LidlMethod;
use financer_receipt_sources::testing::{
    lidl_fixtures as fx, rewe_ebon_pdf, FakeLidlHttp, FakeMailbox, MailBuilder,
};
use financer_receipt_sources::{ReceiptSourcesConfig, ReceiptSyncer, SyncDeps};
use financer_store::Store;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const TOKEN: &str = "test-token";
const SECRET: &str = "0123456789abcdef0123456789abcdef";

struct Fixture {
    app: Router,
    store: Store,
    mailbox: FakeMailbox,
    http: Arc<FakeLidlHttp>,
    dir: std::path::PathBuf,
}

impl Fixture {
    async fn with(lidl: bool) -> Fixture {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "financer-api-receipts-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mailbox = FakeMailbox::new(1);
        let http = Arc::new(FakeLidlHttp::default());
        let cfg = ReceiptSourcesConfig {
            email: Some(EmailConfig {
                enabled: true,
                host: "imap.example.org".into(),
                port: 993,
                username: "me@example.org".into(),
                password_env: "PW".into(),
                folder: "INBOX".into(),
                poll_minutes: 30,
                mark_seen: false,
                max_age_days: 90,
                senders: Vec::new(),
            }),
            lidl_plus: LidlPlusConfig {
                enabled: lidl,
                ..Default::default()
            },
            folder: Some(FolderConfig {
                enabled: true,
                path: dir.clone(),
                poll_seconds: 60,
                on_done: OnDone::Keep,
            }),
        };
        let syncer = ReceiptSyncer::new(
            store.clone(),
            cfg,
            SyncDeps {
                connector: Arc::new(mailbox.clone()),
                lidl_http: http.clone(),
                env: Arc::new(|k| (k == "PW").then(|| "mail-password-xyz".to_string())),
                lidl_gap: Duration::ZERO,
            },
            SECRET,
            &[],
        )
        .unwrap();
        let app = Api::router(
            AppState::new(store.clone()).with_receipt_syncer(syncer),
            TokenHash::new(TOKEN),
        );
        Fixture {
            app,
            store,
            mailbox,
            http,
            dir,
        }
    }

    async fn send(
        &self,
        method: Method,
        uri: &str,
        body: Option<Value>,
        token: bool,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        }
        let body = match body {
            Some(v) => {
                req = req.header(header::CONTENT_TYPE, "application/json");
                Body::from(v.to_string())
            }
            None => Body::empty(),
        };
        let res = self
            .app
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn get(&self, uri: &str) -> (StatusCode, Value) {
        self.send(Method::GET, uri, None, true).await
    }

    async fn post(&self, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        self.send(Method::POST, uri, body, true).await
    }

    fn ebon_mail() -> Vec<u8> {
        MailBuilder::new("ebon@mailing.rewe.de", "Dein REWE eBon")
            .attach("ebon.pdf", "application/pdf", rewe_ebon_pdf())
            .build()
    }

    fn source<'a>(list: &'a Value, name: &str) -> &'a Value {
        list.as_array()
            .unwrap()
            .iter()
            .find(|s| s["source"] == name)
            .unwrap()
    }

    fn serve_tickets(&self) {
        let h = &self.http;
        h.respond(LidlMethod::Get, "pageNumber=1", 200, fx::TICKETS_PAGE_1);
        h.respond(LidlMethod::Get, "pageNumber=2", 200, fx::TICKETS_PAGE_2);
        h.respond(
            LidlMethod::Get,
            "/tickets/FIXTURE-TICKET-0001",
            200,
            fx::TICKET_1,
        );
        h.respond(
            LidlMethod::Get,
            "/tickets/FIXTURE-TICKET-0002",
            200,
            fx::TICKET_2,
        );
        h.respond(
            LidlMethod::Get,
            "/tickets/FIXTURE-TICKET-0003",
            200,
            fx::TICKET_3,
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[tokio::test]
async fn without_a_syncer_every_source_is_disabled_and_lidl_refuses() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    let f = Fixture {
        app: Api::router(AppState::new(store.clone()), TokenHash::new(TOKEN)),
        store,
        mailbox: FakeMailbox::new(1),
        http: Arc::new(FakeLidlHttp::default()),
        dir: std::env::temp_dir().join("financer-api-receipts-none"),
    };
    let (status, list) = f.get("/v1/receipts/sources").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 3);
    assert!(list
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["state"] == "disabled" && s["enabled"] == false));
    let (status, report) = f.post("/v1/receipts/sync", None).await;
    assert_eq!(
        (status, report["imported"].as_i64()),
        (StatusCode::OK, Some(0))
    );
    let (status, body) = f.post("/v1/receipts/lidl/start", None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body["error"].as_str().unwrap().contains("not switched on"));
    let (status, st) = f.get("/v1/receipts/lidl/status").await;
    assert_eq!(
        (status, st["state"].as_str(), st["enabled"].as_bool()),
        (StatusCode::OK, Some("disabled"), Some(false))
    );
}

#[tokio::test]
async fn every_route_needs_the_token() {
    let f = Fixture::with(true).await;
    for (method, uri) in [
        (Method::GET, "/v1/receipts/sources"),
        (Method::POST, "/v1/receipts/sync"),
        (Method::POST, "/v1/receipts/lidl/start"),
        (Method::POST, "/v1/receipts/lidl/finish"),
        (Method::GET, "/v1/receipts/lidl/status"),
        (Method::DELETE, "/v1/receipts/lidl"),
    ] {
        let (status, _) = f.send(method.clone(), uri, None, false).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

#[tokio::test]
async fn sync_imports_from_mail_and_folder_links_to_the_payment_and_lists_provenance() {
    let f = Fixture::with(false).await;
    f.mailbox.deliver(Fixture::ebon_mail(), 2);
    std::fs::write(
        f.dir.join("edeka.txt"),
        "EDEKA Müller\nBrot 2,49 A\nSumme 2,49\n05.03.2026 09:10",
    )
    .unwrap();
    let old = std::time::SystemTime::now() - Duration::from_secs(60);
    std::fs::File::options()
        .write(true)
        .open(f.dir.join("edeka.txt"))
        .unwrap()
        .set_modified(old)
        .unwrap();
    f.store
        .insert_new_transactions(&[Transaction {
            booking_date: time::macros::date!(2026 - 03 - 03),
            amount: Money::from_cents(-784),
            counterparty: "REWE SAGT DANKE".into(),
            purpose: "Kartenzahlung".into(),
            counterparty_iban: None,
            category: None,
        }])
        .await
        .unwrap();

    let (status, report) = f.post("/v1/receipts/sync", None).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(
        (report["imported"].as_i64(), report["linked"].as_i64()),
        (Some(2), Some(1))
    );
    let email = Fixture::source(&report["sources"], "email");
    assert_eq!(
        (email["state"].as_str(), email["last_imported"].as_i64()),
        (Some("ok"), Some(1))
    );
    assert_eq!(email["detail"], "imap.example.org:993 INBOX");

    let (_, list) = f.get("/v1/receipts/sources").await;
    assert_eq!(Fixture::source(&list, "folder")["imported_total"], 1);
    assert_eq!(Fixture::source(&list, "lidl_plus")["state"], "disabled");

    // receipts show where they came from and which payment they belong to
    let (_, receipts) = f.get("/v1/receipts").await;
    let receipts = receipts.as_array().unwrap();
    assert_eq!(receipts.len(), 2);
    let rewe = receipts.iter().find(|r| r["chain"] == "rewe").unwrap();
    assert_eq!(rewe["source"], "email");
    assert!(rewe["transaction_id"].as_i64().is_some());
    assert_eq!(rewe["total_cents"], 784);
    assert_eq!(rewe["items"].as_array().unwrap().len(), 5);
    let other = receipts.iter().find(|r| r["source"] == "folder").unwrap();
    assert!(other["transaction_id"].is_null());

    // only one source on request, and a bad name is a 400
    let (status, one) = f
        .post("/v1/receipts/sync", Some(json!({"source": "folder"})))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(one["imported"], 0);
    let (status, _) = f
        .post(
            "/v1/receipts/sync",
            Some(json!({"source": "carrier-pigeon"})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_failing_source_reports_the_error_without_the_password() {
    let f = Fixture::with(false).await;
    f.mailbox
        .fail_next_connect("connection refused by mail-password-xyz host");
    let (_, report) = f
        .post("/v1/receipts/sync", Some(json!({"source": "email"})))
        .await;
    let email = Fixture::source(&report["sources"], "email");
    assert_eq!(email["state"], "error");
    assert!(email["last_error"]
        .as_str()
        .unwrap()
        .contains("connection refused"));
    // the password must not be in any response
    let (_, list) = f.get("/v1/receipts/sources").await;
    let text = list.to_string();
    assert!(
        !text.contains("mail-password-xyz") && !text.contains("me@example.org"),
        "{text}"
    );
}

#[tokio::test]
async fn lidl_sign_in_on_lidls_own_page_then_sync_status_and_disconnect() {
    let f = Fixture::with(true).await;
    let (_, st) = f.get("/v1/receipts/lidl/status").await;
    assert_eq!(
        (st["enabled"].as_bool(), st["state"].as_str()),
        (Some(true), Some("never"))
    );

    let (status, start) = f.post("/v1/receipts/lidl/start", None).await;
    assert_eq!(status, StatusCode::OK);
    let url = start["authorization_url"].as_str().unwrap();
    assert!(
        url.starts_with("https://accounts.lidl.com/connect/authorize?"),
        "{url}"
    );
    assert!(url.contains("code_challenge_method=S256") && !url.contains("code_verifier"));
    assert_eq!(start["callback_scheme"], "com.lidlplus.app");
    assert_eq!(f.http.requests().len(), 0, "starting contacts nobody");

    // wrong things first
    let state = start["state"].as_str().unwrap().to_string();
    let (status, body) = f
        .post(
            "/v1/receipts/lidl/finish",
            Some(json!({"state": "unknown", "callback_url": "com.lidlplus.app://callback?code=A"})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("start again"));
    let (status, _) = f
        .post(
            "/v1/receipts/lidl/finish",
            Some(json!({"state": state, "callback_url": "https://evil.example/?code=A"})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // the real thing (a new start, since a failed finish uses the first one up)
    let (_, start) = f.post("/v1/receipts/lidl/start", None).await;
    let state = start["state"].as_str().unwrap();
    f.http
        .respond(LidlMethod::Post, "/connect/token", 200, fx::TOKEN);
    f.serve_tickets();
    let (status, st) = f
        .post(
            "/v1/receipts/lidl/finish",
            Some(json!({
                "state": state,
                "callback_url": format!("com.lidlplus.app://callback?code=FIXTURECODE&state={state}")
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{st}");
    assert_eq!(st["state"], "connected");
    assert_eq!(st["receipts"], 2, "the first sync ran right away");
    assert!(st["connected_at"].as_i64().is_some() && st["last_sync"].as_i64().is_some());
    let text = st.to_string();
    assert!(!text.contains("fixture-refresh-token") && !text.contains("fixture-access-token"));

    let (_, receipts) = f.get("/v1/receipts").await;
    assert!(receipts
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["source"] == "lidl_plus" && r["chain"] == "lidl"));

    // the token is not stored in the clear
    let row = f.store.source_state("lidl_plus").await.unwrap().unwrap();
    assert!(row.secret.unwrap().starts_with("v1."));
    assert!(!row.state.contains("fixture"));

    let (status, _) = f
        .send(Method::DELETE, "/v1/receipts/lidl", None, true)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, st) = f.get("/v1/receipts/lidl/status").await;
    assert_eq!(
        (st["state"].as_str(), st["receipts"].as_i64()),
        (Some("never"), Some(2))
    );
    assert!(f.store.source_state("lidl_plus").await.unwrap().is_none());
}

#[tokio::test]
async fn lidl_trouble_is_a_clear_error_status() {
    let f = Fixture::with(true).await;
    let (_, start) = f.post("/v1/receipts/lidl/start", None).await;
    f.http.respond(LidlMethod::Post, "/connect/token", 503, "");
    let (status, body) = f
        .post(
            "/v1/receipts/lidl/finish",
            Some(json!({"state": start["state"], "callback_url": "com.lidlplus.app://callback?code=A"})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(body["error"].as_str().unwrap().contains("503"));
    let (_, st) = f.get("/v1/receipts/lidl/status").await;
    assert_eq!(st["state"], "never");
}
