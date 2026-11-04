//! The mail client inside the finance server: one token opens both, nothing else does.
#![cfg(feature = "mail")]

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use financer_api::{Api, AppState, TokenHash};
use financer_mail_api::store::MailStore;
use financer_mail_api::{MailApi, MailState};
use financer_store::Store;
use tower::ServiceExt;

const TOKEN: &str = "a-long-enough-mail-token-0123456789abcdef";

async fn app() -> axum::Router {
    let finance = AppState::new(Store::connect("sqlite::memory:").await.unwrap());
    let mail = MailState::new(MailStore::connect("sqlite::memory:").await.unwrap(), None);
    Api::router_with(
        finance,
        TokenHash::new(TOKEN),
        vec![("mail", MailApi::router(mail))],
    )
}

async fn get(app: &axum::Router, path: &str, token: Option<&str>) -> StatusCode {
    let mut req = Request::builder().uri(path);
    if let Some(t) = token {
        req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    app.clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn the_mail_api_sits_behind_the_servers_token() {
    let app = app().await;
    assert_eq!(
        get(&app, "/v1/mail/info", None).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&app, "/v1/mail/conversations", Some("wrong")).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&app, "/v1/mail/info", Some(TOKEN)).await,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, "/v1/mail/conversations", Some(TOKEN)).await,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, "/v1/mail/templates", Some(TOKEN)).await,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, "/v1/mail/nothing-here", Some(TOKEN)).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&app, "/v1/transactions", Some(TOKEN)).await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn without_the_mail_client_the_finance_api_is_unchanged() {
    let finance = AppState::new(Store::connect("sqlite::memory:").await.unwrap());
    let app = Api::router(finance, TokenHash::new(TOKEN));
    assert_eq!(
        get(&app, "/v1/transactions", Some(TOKEN)).await,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, "/v1/mail/info", Some(TOKEN)).await,
        StatusCode::NOT_FOUND
    );
}
