//! The shopping assistant inside the app. The same router as the server, called in-process.
//!
//! Unlike the server it never searches by itself: nothing runs until the person searches, and
//! then the app starts an index job (`POST /v1/shop/index`) and follows its progress
//! (`GET /v1/shop/index/{id}`), which is what the progress notification shows.

use std::sync::Arc;

use axum::Router;
use financer_shop_api::llm::{LlmSettings, Provider};
use financer_shop_api::prices::Http;
use financer_shop_api::sources::parse_sources;
use financer_shop_api::{ShopApi, ShopSetup, ShopState};

use crate::{dispatch, EmbeddedError, HttpRequest, HttpResponse};

/// What the app tells the shopping backend when it starts.
#[derive(Debug, Clone, uniffi::Record)]
pub struct ShopStartConfig {
    /// Absolute path of the SQLite file (app document directory). A file of its own, so the shop
    /// can be installed without the finance app and removed without touching its data.
    pub db_path: String,
    /// The shop sources, as the JSON array described in docs/SHOP.md.
    pub sources_json: Option<String>,
    pub claude_api_key: Option<String>,
    pub openai_api_key: Option<String>,
}

#[derive(uniffi::Object)]
pub struct ShopBackend {
    router: Router,
    state: ShopState,
}

impl ShopBackend {
    pub async fn start_with(
        config: ShopStartConfig,
        http: Option<Arc<dyn Http>>,
    ) -> Result<Arc<ShopBackend>, EmbeddedError> {
        if config.db_path.trim().is_empty() {
            return Err(EmbeddedError::Config {
                message: "db_path is empty".into(),
            });
        }
        let sources = match config.sources_json.as_deref().map(str::trim) {
            None | Some("") => Vec::new(),
            Some(json) => {
                parse_sources(json).map_err(|message| EmbeddedError::Config { message })?
            }
        };
        let key = |k: Option<String>| k.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
        let llm = match (key(config.claude_api_key), key(config.openai_api_key)) {
            (Some(api_key), _) => Some(LlmSettings {
                provider: Provider::Claude,
                model: String::new(),
                api_key,
                base_url: None,
            }),
            (None, Some(api_key)) => Some(LlmSettings {
                provider: Provider::OpenAi,
                model: String::new(),
                api_key,
                base_url: None,
            }),
            _ => None,
        };
        let setup = ShopSetup::integrated(
            &format!("sqlite://{}?mode=rwc", config.db_path),
            sources,
            llm,
        );
        let store = setup
            .open_store()
            .await
            .map_err(|message| EmbeddedError::Database { message })?;
        let state = setup
            .start(store, http)
            .await
            .map_err(|message| EmbeddedError::Failed { message })?;
        let router = Router::new().nest("/v1/shop", ShopApi::router(state.clone()));
        Ok(Arc::new(ShopBackend { router, state }))
    }

    pub async fn handle_request(&self, req: HttpRequest) -> HttpResponse {
        dispatch(&self.router, None, req).await
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl ShopBackend {
    #[uniffi::constructor]
    pub async fn start(config: ShopStartConfig) -> Result<Arc<ShopBackend>, EmbeddedError> {
        ShopBackend::start_with(config, None).await
    }

    pub async fn handle(&self, request: HttpRequest) -> HttpResponse {
        self.handle_request(request).await
    }

    /// Look at the watches against what the last searches found; returns how many new deal
    /// messages there are. Cheap, makes no network request.
    pub async fn check_deals(&self) -> Result<u32, EmbeddedError> {
        self.state
            .check_watches()
            .await
            .map(|n| n as u32)
            .map_err(|e| EmbeddedError::Failed {
                message: e.to_string(),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use financer_shop_api::prices::FakeHttp;
    use serde_json::{json, Value};

    fn temp_db(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!(
            "financer-embedded-shop-{}-{name}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("shop.db").display().to_string()
    }

    fn request(method: &str, path: &str, body: Option<Value>) -> HttpRequest {
        HttpRequest {
            method: method.into(),
            path_and_query: path.into(),
            content_type: body.as_ref().map(|_| "application/json".into()),
            body: body.map(|b| b.to_string().into_bytes()).unwrap_or_default(),
        }
    }

    async fn call(b: &ShopBackend, method: &str, path: &str, body: Option<Value>) -> (u16, Value) {
        let res = b.handle_request(request(method, path, body)).await;
        (
            res.status,
            serde_json::from_slice(&res.body).unwrap_or(Value::Null),
        )
    }

    const FEED: &str = "name,price,link,brand,Akkukapazität\nGoogle Pixel 9,649.00,https://f.test/1,Google,4700 mAh\nSamsung Galaxy S25,799.00,https://f.test/2,Samsung,4000 mAh\n";

    fn sources() -> String {
        json!([{ "name": "feed", "kind": "feed", "feed_url": "https://f.test/all.csv", "category": "smartphone",
                 "mapping": { "title": "name", "price": "price", "url": "link", "brand": "brand" } }])
        .to_string()
    }

    #[tokio::test]
    async fn the_shop_answers_in_process_without_a_token_and_does_nothing_until_asked() {
        let fake = Arc::new(FakeHttp::with(vec![("https://f.test/all.csv", 200, FEED)]));
        let http: Arc<dyn Http> = fake.clone();
        let backend = ShopBackend::start_with(
            ShopStartConfig {
                db_path: temp_db("flow"),
                sources_json: Some(sources()),
                claude_api_key: None,
                openai_api_key: None,
            },
            Some(http),
        )
        .await
        .unwrap();

        let (status, info) = call(&backend, "GET", "/v1/shop/info", None).await;
        assert_eq!(
            (status, info["mode"].as_str(), info["products"].as_u64()),
            (200, Some("integrated"), Some(0))
        );
        // give the background a moment: an integrated backend must not read anything on its own
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(
            fake.log.lock().unwrap().is_empty(),
            "nothing is fetched until the person searches"
        );

        let (status, job) = call(
            &backend,
            "POST",
            "/v1/shop/index",
            Some(json!({ "query": "pixel" })),
        )
        .await;
        assert_eq!(status, 202, "{job}");
        let id = job["id"].as_str().unwrap().to_string();
        let mut last = Value::Null;
        for _ in 0..200 {
            let (_, v) = call(&backend, "GET", &format!("/v1/shop/index/{id}"), None).await;
            if v["progress"]["phase"] == "done" {
                last = v;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(last["progress"]["percent"], 100, "{last}");
        assert_eq!(
            fake.log.lock().unwrap().len(),
            1,
            "one search read the one feed"
        );

        let (_, found) = call(
            &backend,
            "POST",
            "/v1/shop/search",
            Some(json!({ "query": "pixel" })),
        )
        .await;
        assert_eq!(found["items"].as_array().unwrap().len(), 1);
        assert_eq!(found["items"][0]["product"]["title"], "Google Pixel 9");
        assert_eq!(backend.check_deals().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn bad_configuration_and_bad_requests_are_errors_not_panics() {
        let cfg = |db: &str, sources: Option<&str>| ShopStartConfig {
            db_path: db.into(),
            sources_json: sources.map(str::to_string),
            claude_api_key: None,
            openai_api_key: None,
        };
        assert!(matches!(
            ShopBackend::start_with(cfg("", None), None).await,
            Err(EmbeddedError::Config { .. })
        ));
        assert!(matches!(
            ShopBackend::start_with(cfg(&temp_db("bad"), Some("{nope")), None).await,
            Err(EmbeddedError::Config { .. })
        ));

        let backend = ShopBackend::start_with(cfg(&temp_db("ok"), None), None)
            .await
            .unwrap();
        assert_eq!(call(&backend, "GET", "/v1/shop/nothing", None).await.0, 404);
        assert_eq!(
            call(&backend, "GET", "/health", None).await.0,
            404,
            "only the shop is served here"
        );
        let (status, err) = call(
            &backend,
            "POST",
            "/v1/shop/index",
            Some(json!({ "query": "x" })),
        )
        .await;
        assert_eq!(status, 422);
        assert!(err["error"].as_str().unwrap().contains("no shop sources"));
        assert_eq!(
            backend
                .handle_request(request("GET", "http://evil/x", None))
                .await
                .status,
            400
        );
    }
}
