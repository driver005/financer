//! The generic client against the real finance router (with the mail API mounted beside it, as in
//! the bundled server): bytes in, status and bytes out, and the token handled the way the server wants.

use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{header, Request as HttpRequest};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_mail_api::store::MailStore;
use financer_mail_api::{MailApi, MailState};
use financer_sdk::{ApiClient, RawRequest, SdkError, Transport};
use financer_store::Store;
use http_body_util::BodyExt;
use tower::ServiceExt;

const TOKEN: &str = "a-long-enough-token-for-the-raw-client-0123456789";

/// The server's router in the same process, sending the token like the network transport does.
struct InProcess(Router);

#[async_trait]
impl Transport for InProcess {
    async fn send(&self, r: financer_sdk::Request) -> Result<financer_sdk::Response, SdkError> {
        let mut req = HttpRequest::builder()
            .method(r.method.as_str())
            .uri(r.path.as_str())
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        let body = match r.body {
            Some(b) => {
                req = req.header(
                    header::CONTENT_TYPE,
                    r.content_type.as_deref().unwrap_or("application/json"),
                );
                Body::from(b)
            }
            None => Body::empty(),
        };
        let res = self
            .0
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .map_err(|e| SdkError::Network {
                message: e.to_string(),
            })?;
        let status = res.status().as_u16();
        let body = res
            .into_body()
            .collect()
            .await
            .map_err(|e| SdkError::Network {
                message: e.to_string(),
            })?
            .to_bytes()
            .to_vec();
        Ok(financer_sdk::Response { status, body })
    }
}

async fn client() -> Arc<ApiClient> {
    let finance = AppState::new(Store::connect("sqlite::memory:").await.unwrap());
    let mail = MailState::new(MailStore::connect("sqlite::memory:").await.unwrap(), None);
    let app = Api::router_with(
        finance,
        TokenHash::new(TOKEN),
        vec![("mail", MailApi::router(mail))],
    );
    ApiClient::with_transport(Arc::new(InProcess(app)))
}

fn req(method: &str, path: &str, content_type: Option<&str>, body: &str) -> RawRequest {
    RawRequest {
        method: method.into(),
        path: path.into(),
        content_type: content_type.map(Into::into),
        body: body.as_bytes().to_vec(),
    }
}

fn text(b: &[u8]) -> String {
    String::from_utf8(b.to_vec()).unwrap()
}

#[tokio::test]
async fn reads_and_writes_the_finance_api() {
    let c = client().await;
    let r = c
        .send(req("GET", "/v1/transactions", None, ""))
        .await
        .unwrap();
    assert_eq!((r.status, text(&r.body)), (200, "[]".to_string()));
    assert!(c.health().await);

    // a body that is not JSON keeps its type
    let csv = "Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung\n";
    let r = c
        .send(req(
            "POST",
            "/v1/transactions/import",
            Some("text/csv"),
            csv,
        ))
        .await
        .unwrap();
    assert_eq!(r.status, 200, "{}", text(&r.body));
    assert!(text(&r.body).contains("imported"), "{}", text(&r.body));

    let r = c
        .send(req(
            "PUT",
            "/v1/budget/envelopes",
            None,
            r#"[{"category":"groceries","limit_cents":40000}]"#,
        ))
        .await
        .unwrap();
    assert_eq!(r.status, 200, "{}", text(&r.body));
    let r = c
        .send(req("GET", "/v1/budget/envelopes", None, ""))
        .await
        .unwrap();
    assert!(text(&r.body).contains("40000"));
}

#[tokio::test]
async fn a_refusal_is_an_answer_not_an_error() {
    let c = client().await;
    let r = c
        .send(req("GET", "/v1/prices/ean/12345", None, ""))
        .await
        .unwrap();
    assert_eq!(r.status, 400, "an invalid barcode: {}", text(&r.body));
    assert!(text(&r.body).contains("error"));
    assert_eq!(
        c.send(req("GET", "/v1/nothing-here", None, ""))
            .await
            .unwrap()
            .status,
        404
    );
    assert_eq!(
        c.send(req("DELETE", "/v1/receipts/9999", None, ""))
            .await
            .unwrap()
            .status,
        404
    );
}

#[tokio::test]
async fn the_apps_beside_the_finance_api_are_reached_the_same_way() {
    let c = client().await;
    let r = c.send(req("GET", "/v1/mail/info", None, "")).await.unwrap();
    assert_eq!(r.status, 200);
    assert!(text(&r.body).contains("\"configured\":false"));
}

#[cfg(feature = "http")]
#[tokio::test]
async fn over_a_real_socket_with_the_token_and_without_it() {
    let finance = AppState::new(Store::connect("sqlite::memory:").await.unwrap());
    let app = Api::router(finance, TokenHash::new(TOKEN));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let ok = ApiClient::new(format!("http://127.0.0.1:{port}/"), TOKEN.into());
    assert!(ok.health().await);
    assert_eq!(
        ok.send(req("GET", "/v1/transactions", None, ""))
            .await
            .unwrap()
            .status,
        200
    );
    let wrong = ApiClient::new(
        format!("http://127.0.0.1:{port}"),
        "wrong-token-wrong-token-wrong-token-1234".into(),
    );
    assert_eq!(
        wrong
            .send(req("GET", "/v1/transactions", None, ""))
            .await
            .unwrap()
            .status,
        401
    );
    assert!(wrong.health().await, "/health needs no token");

    let nobody = ApiClient::new("http://127.0.0.1:9".into(), TOKEN.into());
    assert!(!nobody.health().await);
    match nobody
        .send(req("GET", "/v1/transactions", None, ""))
        .await
        .unwrap_err()
    {
        SdkError::Network { message } => assert!(!message.contains(TOKEN), "{message}"),
        other => panic!("{other:?}"),
    }
}
