use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_store::Store;
use http_body_util::BodyExt;
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

const TOKEN: &str = "test-token";

struct WebFixture;

impl WebFixture {
    async fn app_with_web() -> (Router, std::path::PathBuf) {
        // tests run in parallel and each removes its dir, so every call gets its own
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "financer-web-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("index.html"), "<html>FINANCER-APP</html>").unwrap();
        std::fs::write(dir.join("assets/app.js"), "console.log('app')").unwrap();
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let app = Api::router(AppState::new(store), TokenHash::new(TOKEN));
        (Api::with_web_app(app, &dir), dir)
    }

    async fn get(app: &Router, uri: &str, auth: bool) -> (StatusCode, String) {
        let mut req = Request::builder().uri(uri);
        if auth {
            req = req.header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        }
        let res = app
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let body = res.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8_lossy(&body).into_owned())
    }
}

#[tokio::test]
async fn serves_files_and_falls_back_to_index_for_app_routes() {
    let (app, dir) = WebFixture::app_with_web().await;
    let (s, b) = WebFixture::get(&app, "/", false).await;
    assert_eq!((s, b.contains("FINANCER-APP")), (StatusCode::OK, true));
    let (s, b) = WebFixture::get(&app, "/assets/app.js", false).await;
    assert_eq!((s, b.as_str()), (StatusCode::OK, "console.log('app')"));
    // a reload on an app route must still load the app
    let (s, b) = WebFixture::get(&app, "/settings", false).await;
    assert_eq!((s, b.contains("FINANCER-APP")), (StatusCode::OK, true));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_api_is_unchanged_next_to_the_web_app() {
    let (app, dir) = WebFixture::app_with_web().await;
    // still open, and still protected
    assert_eq!(
        WebFixture::get(&app, "/health", false).await.0,
        StatusCode::OK
    );
    assert_eq!(
        WebFixture::get(&app, "/v1/transactions", false).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        WebFixture::get(&app, "/v1/transactions", true).await.0,
        StatusCode::OK
    );
    // an unknown API path is never answered with the web page
    for auth in [false, true] {
        let (s, b) = WebFixture::get(&app, "/v1/does-not-exist", auth).await;
        assert_ne!(s, StatusCode::OK, "auth={auth}");
        assert!(!b.contains("FINANCER-APP"), "auth={auth}: {b}");
    }
    std::fs::remove_dir_all(dir).ok();
}
