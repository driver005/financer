//! The Financer backend inside the app. The same router as the hosted server, called in-process:
//! there is no listening socket, so nothing else on the phone can reach it.
//!
//! Bindings (Kotlin, Swift, TypeScript) are generated from this crate with UniFFI; see
//! docs/EMBEDDED.md. The types below are plain Rust and are tested natively.

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode, Uri};
use axum::Router;
use financer_api::{Api, AppState, LlmKeys, PriceSourceConfig, TokenHash};
use financer_fints::FintsBank;
use financer_prices::{PoliteHttp, ReqwestHttp};
use financer_receipt_sources::{LidlPlusConfig, ReceiptSourcesConfig, ReceiptSyncer};
use financer_store::Store;
use http_body_util::BodyExt;
use time::OffsetDateTime;
use tower::ServiceExt;

uniffi::setup_scaffolding!();

const USER_AGENT: &str =
    "financer-personal/0.1 (personal use; +https://github.com/driver005/financer)";
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// What the app tells the backend when it starts. Keys live in the app's secure storage and are
/// passed in; there is no server environment on the phone.
#[derive(Debug, Clone, uniffi::Record)]
pub struct StartConfig {
    /// Absolute path of the SQLite file (app document directory).
    pub db_path: String,
    pub claude_api_key: Option<String>,
    pub openai_api_key: Option<String>,
    /// FinTS product id from the Deutsche Kreditwirtschaft; enables live bank sync.
    pub fints_product_id: Option<String>,
    /// The price sources file contents (JSON array, see docs/PRICES.md).
    pub price_sources_json: Option<String>,
    /// Switch on receipt import from Lidl Plus (you sign in on Lidl's own page from the app).
    /// Needs `device_secret`.
    pub lidl_plus: bool,
    /// Two-letter country (`DE`) and language (`de`) of the Lidl Plus account; default DE / de.
    pub lidl_country: Option<String>,
    pub lidl_language: Option<String>,
    /// Hours between Lidl Plus syncs when the app asks (default 12).
    pub lidl_poll_hours: Option<u32>,
    /// A secret the app keeps in the phone's secure storage and passes on every start (make one
    /// with `generate_device_secret`). It encrypts the Lidl Plus sign-in in the database, so the
    /// database alone, e.g. in a phone backup, does not give it away. It must not change.
    pub device_secret: Option<String>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct HttpRequest {
    pub method: String,
    /// Path and query, e.g. `/v1/transactions?x=1`.
    pub path_and_query: String,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum EmbeddedError {
    #[error("invalid configuration: {message}")]
    Config { message: String },
    #[error("could not open the database: {message}")]
    Database { message: String },
    #[error("{message}")]
    Failed { message: String },
}

#[derive(uniffi::Object)]
pub struct Backend {
    router: Router,
    state: AppState,
    /// The receipt import, when a source is switched on.
    receipts: Option<Arc<ReceiptSyncer>>,
    /// Random per start; the backend adds it to every in-process request, so the unchanged
    /// router (which requires a token) can be reused.
    token: String,
}

impl HttpResponse {
    fn error(status: StatusCode, message: &str) -> HttpResponse {
        HttpResponse {
            status: status.as_u16(),
            content_type: Some("application/json".into()),
            body: serde_json::json!({ "error": message })
                .to_string()
                .into_bytes(),
        }
    }
}

impl Backend {
    pub async fn start_with(config: StartConfig) -> Result<Arc<Backend>, EmbeddedError> {
        if config.db_path.trim().is_empty() {
            return Err(EmbeddedError::Config {
                message: "db_path is empty".into(),
            });
        }
        let sources: Vec<PriceSourceConfig> =
            match config.price_sources_json.as_deref().map(str::trim) {
                None | Some("") => Vec::new(),
                Some(json) => serde_json::from_str(json).map_err(|e| EmbeddedError::Config {
                    message: format!("price sources: {e}"),
                })?,
            };
        let store = Store::connect(&format!("sqlite://{}?mode=rwc", config.db_path))
            .await
            .map_err(|e| EmbeddedError::Database {
                message: e.to_string(),
            })?;

        let receipt_store = store.clone();
        let http = ReqwestHttp::new(USER_AGENT).map_err(|e| EmbeddedError::Failed {
            message: e.to_string(),
        })?;
        let mut state = AppState::new(store)
            .with_http(Arc::new(PoliteHttp::new(
                http,
                "financer",
                Duration::from_secs(3),
            )))
            .with_price_sources(sources)
            .with_llm_keys(LlmKeys {
                claude: config.claude_api_key.filter(|k| !k.trim().is_empty()),
                openai: config.openai_api_key.filter(|k| !k.trim().is_empty()),
            });
        if let Some(id) = config.fints_product_id.filter(|k| !k.trim().is_empty()) {
            state = state.with_bank(Arc::new(FintsBank::new(&id)));
        }

        let mut cfg = ReceiptSourcesConfig::default();
        if config.lidl_plus {
            cfg.lidl_plus = LidlPlusConfig {
                enabled: true,
                country: config
                    .lidl_country
                    .filter(|c| !c.trim().is_empty())
                    .unwrap_or_else(|| "DE".into()),
                language: config
                    .lidl_language
                    .filter(|c| !c.trim().is_empty())
                    .unwrap_or_else(|| "de".into()),
                poll_hours: config.lidl_poll_hours.map_or(12, u64::from),
                ..LidlPlusConfig::default()
            };
        }
        let receipts = match config.device_secret.as_deref().map(str::trim) {
            Some(secret) if !secret.is_empty() => {
                ReceiptSyncer::for_device(receipt_store, cfg, secret, &[])
                    .map_err(|message| EmbeddedError::Config { message })?
            }
            _ if cfg.any_enabled() => {
                return Err(EmbeddedError::Config {
                    message: "receipt import needs a device secret from the app".into(),
                })
            }
            _ => None,
        };
        if let Some(syncer) = &receipts {
            state = state.with_receipt_syncer(syncer.clone());
        }

        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let router = Api::router(state.clone(), TokenHash::new(&token));
        Ok(Arc::new(Backend {
            router,
            state,
            receipts,
            token,
        }))
    }

    /// Serve one request. Never panics: malformed input becomes a 4xx response.
    pub async fn handle_request(&self, req: HttpRequest) -> HttpResponse {
        let Ok(method) = Method::from_bytes(req.method.trim().to_uppercase().as_bytes()) else {
            return HttpResponse::error(StatusCode::BAD_REQUEST, "invalid HTTP method");
        };
        let Ok(uri) = req.path_and_query.parse::<Uri>() else {
            return HttpResponse::error(StatusCode::BAD_REQUEST, "invalid path");
        };
        if uri.scheme().is_some()
            || uri.authority().is_some()
            || !req.path_and_query.starts_with('/')
        {
            return HttpResponse::error(StatusCode::BAD_REQUEST, "path must start with /");
        }
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token));
        if let Some(ct) = req.content_type.as_deref() {
            builder = builder.header(header::CONTENT_TYPE, ct);
        }
        let Ok(request) = builder.body(Body::from(req.body)) else {
            return HttpResponse::error(StatusCode::BAD_REQUEST, "invalid request");
        };
        match self.router.clone().oneshot(request).await {
            Ok(res) => {
                let status = res.status().as_u16();
                let content_type = res
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                match res.into_body().collect().await.map(|b| b.to_bytes()) {
                    Ok(bytes) if bytes.len() <= MAX_RESPONSE_BYTES => HttpResponse {
                        status,
                        content_type,
                        body: bytes.to_vec(),
                    },
                    _ => HttpResponse::error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "response could not be read",
                    ),
                }
            }
            Err(never) => match never {},
        }
    }

    /// Import new receipts from the switched-on sources whose turn it is (call on app open and
    /// from the OS background task slot, right after `refresh`). Cheap when nothing is due, and
    /// it does nothing until you have signed in to Lidl Plus. Returns a one-line summary.
    pub async fn sync_receipts(&self) -> Result<String, EmbeddedError> {
        let Some(syncer) = &self.receipts else {
            return Ok("receipt import is off".into());
        };
        let due = syncer
            .due(OffsetDateTime::now_utc().unix_timestamp())
            .await
            .map_err(|e| EmbeddedError::Failed {
                message: e.to_string(),
            })?;
        if due.is_empty() {
            return Ok("no receipts due".into());
        }
        match syncer.sync_now(None).await {
            Ok(report) => Ok(format!(
                "{} new receipts, {} linked to a payment",
                report.imported, report.linked
            )),
            Err(e) => Err(EmbeddedError::Failed {
                message: e.to_string(),
            }),
        }
    }

    /// Refresh prices now (call on app open and from the OS background task slot). Returns a
    /// one-line summary.
    pub async fn refresh(&self) -> Result<String, EmbeddedError> {
        Api::refresh_prices_summary(&self.state)
            .await
            .map_err(|message| EmbeddedError::Failed { message })
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl Backend {
    #[uniffi::constructor]
    pub async fn start(config: StartConfig) -> Result<Arc<Backend>, EmbeddedError> {
        Backend::start_with(config).await
    }

    pub async fn handle(&self, request: HttpRequest) -> HttpResponse {
        self.handle_request(request).await
    }

    pub async fn refresh_prices(&self) -> Result<String, EmbeddedError> {
        self.refresh().await
    }

    pub async fn sync_receipts_now(&self) -> Result<String, EmbeddedError> {
        self.sync_receipts().await
    }
}

/// A new random secret for `StartConfig::device_secret` (64 hex characters). The app makes one
/// once, keeps it in secure storage and passes the same one on every start.
#[uniffi::export]
pub fn generate_device_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builders and readers shared by the tests.
    struct Fixtures;

    impl Fixtures {
        fn temp_db(name: &str) -> String {
            let dir = std::env::temp_dir()
                .join(format!("financer-embedded-{}-{name}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            dir.join("app.db").display().to_string()
        }

        fn config(name: &str) -> StartConfig {
            StartConfig {
                db_path: Self::temp_db(name),
                claude_api_key: None,
                openai_api_key: None,
                fints_product_id: None,
                price_sources_json: None,
                lidl_plus: false,
                lidl_country: None,
                lidl_language: None,
                lidl_poll_hours: None,
                device_secret: None,
            }
        }

        fn with_lidl(name: &str) -> StartConfig {
            StartConfig {
                lidl_plus: true,
                device_secret: Some(generate_device_secret()),
                ..Self::config(name)
            }
        }

        fn get(path: &str) -> HttpRequest {
            HttpRequest {
                method: "GET".into(),
                path_and_query: path.into(),
                content_type: None,
                body: vec![],
            }
        }

        fn json(r: &HttpResponse) -> serde_json::Value {
            serde_json::from_slice(&r.body).unwrap_or(serde_json::Value::Null)
        }
    }

    const CSV: &str = "\"Buchungstag\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"Betrag\"\n\
\"02.03.26\";\"Kartenzahlung\";\"REWE Markt\";\"\";\"-23,47\"\n";

    #[tokio::test]
    async fn serves_the_same_api_in_process() {
        let b = Backend::start_with(Fixtures::config("api")).await.unwrap();
        let health = b.handle_request(Fixtures::get("/health")).await;
        assert_eq!(
            (health.status, health.body.as_slice()),
            (200, b"ok".as_slice())
        );

        let import = b
            .handle_request(HttpRequest {
                method: "post".into(), // case-insensitive
                path_and_query: "/v1/transactions/import".into(),
                content_type: Some("text/csv".into()),
                body: CSV.as_bytes().to_vec(),
            })
            .await;
        assert_eq!(import.status, 200);
        assert_eq!(Fixtures::json(&import)["imported"], 1);

        let list = b.handle_request(Fixtures::get("/v1/transactions")).await;
        assert_eq!(list.content_type.as_deref(), Some("application/json"));
        assert_eq!(Fixtures::json(&list)[0]["category"], "groceries");
    }

    #[tokio::test]
    async fn data_persists_across_restarts() {
        let cfg = Fixtures::config("persist");
        let first = Backend::start_with(cfg.clone()).await.unwrap();
        first
            .handle_request(HttpRequest {
                method: "POST".into(),
                path_and_query: "/v1/transactions/import".into(),
                content_type: Some("text/csv".into()),
                body: CSV.as_bytes().to_vec(),
            })
            .await;
        drop(first);
        let second = Backend::start_with(cfg).await.unwrap();
        assert_eq!(
            Fixtures::json(
                &second
                    .handle_request(Fixtures::get("/v1/transactions"))
                    .await
            )
            .as_array()
            .unwrap()
            .len(),
            1
        );
    }

    #[tokio::test]
    async fn malformed_requests_become_4xx_not_panics() {
        let b = Backend::start_with(Fixtures::config("bad")).await.unwrap();
        for (method, path) in [
            ("GE T", "/health"),
            ("GET", "http://evil.test/health"),
            ("GET", "health"),
            ("GET", "/v1/transactions\n"),
        ] {
            let r = b
                .handle_request(HttpRequest {
                    method: method.into(),
                    path_and_query: path.into(),
                    content_type: None,
                    body: vec![],
                })
                .await;
            assert_eq!(r.status, 400, "{method} {path:?}");
        }
        assert_eq!(b.handle_request(Fixtures::get("/nope")).await.status, 404);
    }

    #[tokio::test]
    async fn keys_and_sources_are_passed_in_and_never_leak() {
        let mut cfg = Fixtures::config("keys");
        cfg.claude_api_key = Some("sk-claude-secret".into());
        cfg.price_sources_json = Some(
            r#"[{"type":"json_ld","chain":"rewe","urls":["https://example.invalid/x"]}]"#.into(),
        );
        let b = Backend::start_with(cfg).await.unwrap();
        let settings = b.handle_request(Fixtures::get("/v1/settings")).await;
        let v = Fixtures::json(&settings);
        assert_eq!(
            (
                v["claude_key_configured"].clone(),
                v["price_sources"].clone()
            ),
            (serde_json::json!(true), serde_json::json!(1))
        );
        assert!(!String::from_utf8_lossy(&settings.body).contains("sk-claude-secret"));
    }

    #[tokio::test]
    async fn bad_configuration_is_reported() {
        let mut cfg = Fixtures::config("cfg");
        cfg.db_path = "  ".into();
        assert!(matches!(
            Backend::start_with(cfg).await,
            Err(EmbeddedError::Config { .. })
        ));

        let mut cfg = Fixtures::config("cfg2");
        cfg.price_sources_json = Some("[{\"type\":\"bogus\"}]".into());
        assert!(matches!(
            Backend::start_with(cfg).await,
            Err(EmbeddedError::Config { .. })
        ));

        let mut cfg = Fixtures::config("cfg3");
        cfg.db_path = "/nonexistent-dir-xyz/sub/app.db".into();
        assert!(matches!(
            Backend::start_with(cfg).await,
            Err(EmbeddedError::Database { .. })
        ));
    }

    #[tokio::test]
    async fn refresh_without_sources_explains_itself() {
        let b = Backend::start_with(Fixtures::config("refresh"))
            .await
            .unwrap();
        let err = b.refresh().await.unwrap_err();
        assert!(err.to_string().contains("no price sources"));
    }

    #[tokio::test]
    async fn receipt_import_is_off_by_default() {
        let b = Backend::start_with(Fixtures::config("receipts-off"))
            .await
            .unwrap();
        assert_eq!(b.sync_receipts().await.unwrap(), "receipt import is off");
        let status = b
            .handle_request(Fixtures::get("/v1/receipts/lidl/status"))
            .await;
        assert_eq!(status.status, 200);
        assert_eq!(Fixtures::json(&status)["state"], "disabled");
        // the answer says what to do, without pointing at a server config the phone does not have
        let start = b
            .handle_request(HttpRequest {
                method: "POST".into(),
                path_and_query: "/v1/receipts/lidl/start".into(),
                content_type: None,
                body: vec![],
            })
            .await;
        assert_eq!(start.status, 409);
        let message = Fixtures::json(&start)["error"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(message, "Lidl Plus is not switched on");
    }

    #[tokio::test]
    async fn lidl_plus_can_be_switched_on_on_the_phone() {
        let b = Backend::start_with(Fixtures::with_lidl("receipts-lidl"))
            .await
            .unwrap();
        let status = b
            .handle_request(Fixtures::get("/v1/receipts/lidl/status"))
            .await;
        let status = Fixtures::json(&status);
        assert_eq!(status["enabled"], true);
        assert_eq!(status["state"], "never"); // on, but nobody has signed in yet

        // the sign-in page address comes from the backend; nothing is contacted here
        let start = b
            .handle_request(HttpRequest {
                method: "POST".into(),
                path_and_query: "/v1/receipts/lidl/start".into(),
                content_type: None,
                body: vec![],
            })
            .await;
        assert_eq!(start.status, 200);
        let start = Fixtures::json(&start);
        assert!(start["authorization_url"]
            .as_str()
            .unwrap()
            .starts_with("https://accounts.lidl.com/"));
        assert!(start["state"].as_str().is_some_and(|s| !s.is_empty()));

        // nothing to sync until someone has signed in, and this must not reach the network
        assert_eq!(b.sync_receipts().await.unwrap(), "no receipts due");
    }

    #[tokio::test]
    async fn receipt_import_needs_a_device_secret() {
        let cfg = StartConfig {
            lidl_plus: true,
            device_secret: None,
            ..Fixtures::config("receipts-nosecret")
        };
        let err = Backend::start_with(cfg).await.err().unwrap();
        assert!(matches!(err, EmbeddedError::Config { .. }));
        assert!(err.to_string().contains("device secret"));

        let short = StartConfig {
            lidl_plus: true,
            device_secret: Some("short".into()),
            ..Fixtures::config("receipts-shortsecret")
        };
        assert!(matches!(
            Backend::start_with(short).await.err().unwrap(),
            EmbeddedError::Config { .. }
        ));
    }

    #[test]
    fn device_secrets_are_long_and_different() {
        let (a, b) = (generate_device_secret(), generate_device_secret());
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    /// Everything the screens read must work on the phone too: a piece of setup that only the
    /// server does (a scheduler, a config section) would show up here as a 5xx.
    #[tokio::test]
    async fn every_read_endpoint_answers_without_a_server_error() {
        let b = Backend::start_with(Fixtures::with_lidl("all-gets"))
            .await
            .unwrap();
        let doc: serde_json::Value = serde_json::from_str(&Api::openapi_json()).unwrap();
        let mut checked = Vec::new();
        for (path, item) in doc["paths"].as_object().unwrap() {
            // `{id}` paths need a real id; they are covered by their own tests
            if item.get("get").is_none() || path.contains('{') {
                continue;
            }
            let res = b.handle_request(Fixtures::get(path)).await;
            assert!(
                res.status < 500,
                "GET {path} answered {} on the phone: {}",
                res.status,
                String::from_utf8_lossy(&res.body)
            );
            checked.push(path.clone());
        }
        // a few that must exist, so the loop above cannot pass by finding nothing
        for must in [
            "/v1/transactions",
            "/v1/forecast",
            "/v1/spending/stores",
            "/v1/bank/connections",
            "/v1/receipts/sources",
            "/v1/meal-plan/pantry",
        ] {
            assert!(checked.iter().any(|p| p == must), "{must} was not checked");
        }
        assert!(
            checked.len() >= 20,
            "only {} endpoints checked",
            checked.len()
        );
    }
}
