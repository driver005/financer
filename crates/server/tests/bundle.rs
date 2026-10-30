//! The bundled build: one server, one token, two apps.
#![cfg(feature = "shop")]

use std::sync::{Arc, RwLock};

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use financer_api::{Api, AppState, TokenHash};
use financer_prices::FakeHttp;
use financer_shop_api::core::Registry;
use financer_shop_api::sources::Crawler;
use financer_shop_api::store::ShopStore;
use financer_shop_api::{ShopApi, ShopConfig, ShopState};
use financer_store::Store;
use tower::ServiceExt;

const TOKEN: &str = "a-long-enough-bundle-token-0123456789abcdef";

async fn app() -> axum::Router {
    let finance = AppState::new(Store::connect("sqlite::memory:").await.unwrap());
    let shop_store = ShopStore::connect("sqlite::memory:").await.unwrap();
    let registry = Arc::new(RwLock::new(Registry::builtin()));
    let crawler = Crawler::new(Arc::new(FakeHttp::default()), registry.clone(), vec![]);
    let shop = ShopState::new(shop_store, registry, crawler, ShopConfig::default());
    Api::router_with(
        finance,
        TokenHash::new(TOKEN),
        vec![("shop", ShopApi::router(shop))],
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
async fn one_token_opens_both_apps_and_nothing_else_does() {
    let app = app().await;
    assert_eq!(get(&app, "/health", None).await, StatusCode::OK);
    assert_eq!(
        get(&app, "/v1/transactions", None).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&app, "/v1/shop/info", None).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&app, "/v1/shop/info", Some("wrong")).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&app, "/v1/transactions", Some(TOKEN)).await,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, "/v1/shop/info", Some(TOKEN)).await,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, "/v1/shop/categories", Some(TOKEN)).await,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, "/v1/shop/nothing-here", Some(TOKEN)).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&app, "/v1/nothing-here", Some(TOKEN)).await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn without_the_shop_the_finance_api_is_unchanged() {
    let finance = AppState::new(Store::connect("sqlite::memory:").await.unwrap());
    let app = Api::router(finance, TokenHash::new(TOKEN));
    assert_eq!(
        get(&app, "/v1/transactions", Some(TOKEN)).await,
        StatusCode::OK
    );
    assert_eq!(
        get(&app, "/v1/shop/info", Some(TOKEN)).await,
        StatusCode::NOT_FOUND
    );
}
