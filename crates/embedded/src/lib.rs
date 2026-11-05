//! The Financer backend inside the app. The same router as the hosted server, called in-process:
//! there is no listening socket, so nothing else on the phone can reach it.
//!
//! Bindings (Kotlin, Swift, TypeScript) are generated from this crate with UniFFI; see
//! docs/EMBEDDED.md. The types below are plain Rust and are tested natively.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock, Weak};

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode, Uri};
use axum::Router;
use financer_api::{Api, TokenHash};
use financer_config::{Admin, Change, Env, Loader, MapEnv, Overlay, SettingsFile};
use financer_host::{assemble, HostOptions, Tasks};
use financer_receipt_sources::ReceiptSyncer;
use financer_store::Store;
use http_body_util::BodyExt;
use time::OffsetDateTime;
use tower::ServiceExt;

#[cfg(feature = "shop")]
pub mod shop;

uniffi::setup_scaffolding!();

const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// What the app tells the backend when it starts.
///
/// The backend is configured exactly like the server: the same settings (`docs/CONFIG.md`), kept in
/// a settings file next to the database, and changed from the app's Server settings screen. Only
/// two things come from the app: where the database is, and the secret that seals the stored
/// logins. The other fields are the values the app used to keep itself; they are read once, when
/// there is no settings file yet, and then belong to the settings file.
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
    /// Switch on receipt import from the Kaufland Card (you sign in on Kaufland's own page from
    /// the app). Needs `device_secret`; country, language and interval follow the Lidl Plus ones.
    pub kaufland: bool,
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
    /// The backend refused a call (`status` is the HTTP status it would have answered with).
    #[error("{message}")]
    Refused {
        status: u16,
        message: String,
        /// One entry per thing to fix when it refused a form.
        problems: Vec<String>,
    },
}

impl EmbeddedError {
    /// A refusal keeps its status and words; anything else is a failure.
    pub(crate) fn from_sdk(e: financer_sdk::SdkError) -> EmbeddedError {
        match e {
            financer_sdk::SdkError::Api {
                status,
                message,
                problems,
            } => EmbeddedError::Refused {
                status,
                message,
                problems,
            },
            other => EmbeddedError::Failed {
                message: other.to_string(),
            },
        }
    }
}

/// One running assembly of the backend. A saved setting builds a new one and swaps it in.
struct Live {
    router: Router,
    state: financer_api::AppState,
    /// The receipt import, when a source is switched on.
    receipts: Option<Arc<ReceiptSyncer>>,
    /// The background work of this assembly; dropped (and so stopped) with it.
    _tasks: Tasks,
}

/// What an assembly is built from: the settings and what the host decides.
struct Ctx {
    /// Random per start; the backend adds it to every in-process request, so the unchanged
    /// router (which requires a token) can be reused.
    token: String,
    /// The settings screen's backend: the same one the server has.
    admin: Arc<Admin>,
    env: Arc<MapEnv>,
    data_dir: PathBuf,
    /// Seals the stored bank access and receipt sign-ins; from the app's secure storage.
    secret: String,
    /// Whether the app gave a secret of its own (something sealed needs one).
    has_device_secret: bool,
}

#[derive(uniffi::Object)]
pub struct Backend {
    live: RwLock<Arc<Live>>,
    ctx: Arc<Ctx>,
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

/// The SDK's transport over this backend's router.
pub(crate) struct InProcess {
    pub(crate) router: Router,
    /// The token the router requires (the finance backend adds its own); none for the shop's.
    pub(crate) token: Option<String>,
}

#[async_trait::async_trait]
impl financer_sdk::Transport for InProcess {
    async fn send(
        &self,
        r: financer_sdk::Request,
    ) -> Result<financer_sdk::Response, financer_sdk::SdkError> {
        let res = dispatch(
            &self.router,
            self.token.as_deref(),
            HttpRequest {
                method: r.method,
                path_and_query: r.path,
                content_type: r.content_type,
                body: r.body.unwrap_or_default(),
            },
        )
        .await;
        Ok(financer_sdk::Response {
            status: res.status,
            body: res.body,
        })
    }
}

impl Ctx {
    /// Build one assembly from the settings in `overlay`.
    async fn build(
        &self,
        overlay: &Overlay,
        restart: &Arc<dyn Fn() + Send + Sync>,
    ) -> Result<Live, EmbeddedError> {
        let loaded = Loader::load_with(None, &*self.env, &self.data_dir, overlay).map_err(|e| {
            EmbeddedError::Config {
                message: e.to_string(),
            }
        })?;
        let problems = loaded.config.problems_for_server();
        if !problems.is_empty() {
            return Err(EmbeddedError::Config {
                message: problems.join("\n"),
            });
        }
        // Anything that seals a login needs the app's own secret: without it a stored sign-in
        // could not be opened again after the next start.
        let seals = loaded.config.receipts.value.any_enabled()
            || loaded.config.bank.plaid.configured()
            || loaded.config.bank.gocardless.configured()
            || loaded.config.bank.finapi.configured();
        if seals && !self.has_device_secret {
            return Err(EmbeddedError::Config {
                message: "receipt import and bank links need a device secret from the app".into(),
            });
        }
        let store = Store::connect(&loaded.config.database.url.value)
            .await
            .map_err(|e| EmbeddedError::Database {
                message: e.to_string(),
            })?;
        let assembled = assemble(
            &loaded.config,
            store,
            HostOptions {
                secret: self.secret.clone(),
                admin: Some((self.admin.clone(), restart.clone())),
            },
        )
        .await
        .map_err(|message| EmbeddedError::Config { message })?;
        let router = Api::router(assembled.state.clone(), TokenHash::new(&self.token));
        Ok(Live {
            router,
            state: assembled.state,
            receipts: assembled.receipts,
            _tasks: assembled.tasks,
        })
    }
}

impl Backend {
    pub async fn start_with(config: StartConfig) -> Result<Arc<Backend>, EmbeddedError> {
        if config.db_path.trim().is_empty() {
            return Err(EmbeddedError::Config {
                message: "db_path is empty".into(),
            });
        }
        let db_path = PathBuf::from(config.db_path.trim());
        let data_dir = db_path
            .parent()
            .filter(|d| !d.as_os_str().is_empty())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        // no process environment on the phone: the configuration sees only these
        let db_url = format!("sqlite://{}?mode=rwc", db_path.display());
        let env = Arc::new(MapEnv::new(&[
            ("FINANCER_DATABASE_URL", &db_url),
            ("FINANCER_API_TOKEN", &token),
        ]));
        let file = SettingsFile::locate(&*env, &db_url, &data_dir);
        let admin = Arc::new(Admin::new(
            None,
            data_dir.clone(),
            env.clone() as Arc<dyn Env + Send + Sync>,
            file,
        ));
        let device_secret = config
            .device_secret
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        // what the app kept in its own settings before this backend had the server's
        let seeded = Self::seed_from_legacy(&admin, &config)?;

        let secret = device_secret.clone().unwrap_or_else(|| token.clone());
        let ctx = Arc::new(Ctx {
            token,
            admin,
            env,
            data_dir,
            secret,
            has_device_secret: device_secret.is_some(),
        });
        let slot: Arc<OnceLock<Weak<Backend>>> = Arc::new(OnceLock::new());
        let restart: Arc<dyn Fn() + Send + Sync> = {
            let slot = slot.clone();
            Arc::new(move || {
                if let Some(backend) = slot.get().and_then(Weak::upgrade) {
                    tokio::spawn(async move { backend.reload().await });
                }
            })
        };

        // the same start as the server's: a changed setting that does not start is rolled back
        let begin = ctx.admin.file().begin();
        let live = match ctx.build(&begin.overlay, &restart).await {
            Ok(live) => live,
            // the app's own old values do not start: say so, and let the next start seed again
            Err(e) if seeded => {
                let _ = std::fs::remove_file(ctx.admin.file().path());
                return Err(e);
            }
            Err(e) if begin.applying && ctx.admin.file().fail(&e.to_string()) => {
                let begin = ctx.admin.file().begin();
                ctx.build(&begin.overlay, &restart).await?
            }
            Err(e) => return Err(e),
        };
        ctx.admin.file().confirm();
        let backend = Arc::new(Backend {
            live: RwLock::new(Arc::new(live)),
            ctx,
        });
        let _ = slot.set(Arc::downgrade(&backend));
        Ok(backend)
    }

    /// Apply a saved setting: build a new assembly and swap it in, going back to the previous
    /// settings when the new ones do not start (as the server does).
    async fn reload(self: &Arc<Self>) {
        let restart = self.restart_hook();
        let begin = self.ctx.admin.file().begin();
        let built = match self.ctx.build(&begin.overlay, &restart).await {
            Ok(live) => Some(live),
            Err(e) if begin.applying && self.ctx.admin.file().fail(&e.to_string()) => {
                let begin = self.ctx.admin.file().begin();
                self.ctx.build(&begin.overlay, &restart).await.ok()
            }
            Err(_) => None,
        };
        if let Some(live) = built {
            *self.live.write().unwrap_or_else(|p| p.into_inner()) = Arc::new(live);
            self.ctx.admin.file().confirm();
        }
    }

    /// What a saved setting calls to have the backend rebuilt.
    fn restart_hook(self: &Arc<Self>) -> Arc<dyn Fn() + Send + Sync> {
        let weak = Arc::downgrade(self);
        Arc::new(move || {
            if let Some(backend) = weak.upgrade() {
                tokio::spawn(async move { backend.reload().await });
            }
        })
    }

    fn live(&self) -> Arc<Live> {
        self.live.read().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// The old on-phone values become settings, once: when there is no settings file yet.
    fn seed_from_legacy(admin: &Admin, config: &StartConfig) -> Result<bool, EmbeddedError> {
        if admin.file().path().exists() {
            return Ok(false);
        }
        fn text(v: &Option<String>) -> Option<&str> {
            v.as_deref().map(str::trim).filter(|s| !s.is_empty())
        }
        let mut set = std::collections::BTreeMap::new();
        let mut put = |key: &str, value: serde_json::Value| {
            set.insert(key.to_string(), value);
        };
        if let Some(k) = text(&config.claude_api_key) {
            put("llm.anthropic_api_key", k.into());
        }
        if let Some(k) = text(&config.openai_api_key) {
            put("llm.openai_api_key", k.into());
        }
        if let Some(k) = text(&config.fints_product_id) {
            put("bank.fints_product_id", k.into());
        }
        if let Some(json) = text(&config.price_sources_json) {
            let sources: serde_json::Value =
                serde_json::from_str(json).map_err(|e| EmbeddedError::Config {
                    message: format!("price sources: {e}"),
                })?;
            put("prices.sources", sources);
        }
        for (on, key) in [
            (config.lidl_plus, "lidl_plus"),
            (config.kaufland, "kaufland"),
        ] {
            if !on {
                continue;
            }
            put(&format!("receipts.{key}.enabled"), true.into());
            if let Some(c) = text(&config.lidl_country) {
                put(&format!("receipts.{key}.country"), c.into());
            }
            if let Some(l) = text(&config.lidl_language) {
                put(&format!("receipts.{key}.language"), l.into());
            }
            if let Some(h) = config.lidl_poll_hours {
                put(&format!("receipts.{key}.poll_hours"), h.into());
            }
        }
        if set.is_empty() {
            return Ok(false);
        }
        admin
            .update(&Change {
                set,
                reset: Vec::new(),
            })
            .map(|_| true)
            .map_err(|e| EmbeddedError::Config {
                message: format!("{e:?}"),
            })
    }

    fn wire(&self) -> Arc<financer_sdk::Wire> {
        financer_sdk::Wire::with_transport(Arc::new(InProcess {
            router: self.live().router.clone(),
            token: Some(self.ctx.token.clone()),
        }))
    }

    /// Serve one request. Never panics: malformed input becomes a 4xx response.
    pub async fn handle_request(&self, req: HttpRequest) -> HttpResponse {
        dispatch(&self.live().router, Some(&self.ctx.token), req).await
    }

    /// Import new receipts from the switched-on sources whose turn it is (call on app open and
    /// from the OS background task slot, right after `refresh`). Cheap when nothing is due, and
    /// it does nothing until you have signed in to Lidl Plus. Returns a one-line summary.
    pub async fn sync_receipts(&self) -> Result<String, EmbeddedError> {
        let live = self.live();
        let Some(syncer) = &live.receipts else {
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
        Api::refresh_prices_summary(&self.live().state)
            .await
            .map_err(|message| EmbeddedError::Failed { message })
    }
}

/// Hand one request to a router in-process. `token` is added as the bearer token when the router
/// wants one (the finance router does; the shopping router has no authentication in-process).
pub(crate) async fn dispatch(
    router: &Router,
    token: Option<&str>,
    req: HttpRequest,
) -> HttpResponse {
    let Ok(method) = Method::from_bytes(req.method.trim().to_uppercase().as_bytes()) else {
        return HttpResponse::error(StatusCode::BAD_REQUEST, "invalid HTTP method");
    };
    let Ok(uri) = req.path_and_query.parse::<Uri>() else {
        return HttpResponse::error(StatusCode::BAD_REQUEST, "invalid path");
    };
    if uri.scheme().is_some() || uri.authority().is_some() || !req.path_and_query.starts_with('/') {
        return HttpResponse::error(StatusCode::BAD_REQUEST, "path must start with /");
    }
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    if let Some(ct) = req.content_type.as_deref() {
        builder = builder.header(header::CONTENT_TYPE, ct);
    }
    let Ok(request) = builder.body(Body::from(req.body)) else {
        return HttpResponse::error(StatusCode::BAD_REQUEST, "invalid request");
    };
    match router.clone().oneshot(request).await {
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

#[uniffi::export(async_runtime = "tokio")]
impl Backend {
    #[uniffi::constructor]
    pub async fn start(config: StartConfig) -> Result<Arc<Backend>, EmbeddedError> {
        Backend::start_with(config).await
    }

    pub async fn handle(&self, request: HttpRequest) -> HttpResponse {
        self.handle_request(request).await
    }

    /// One call of the finance, shopping or mail API by name (`app` is `finance`, `shop` or `mail`;
    /// `args` is a JSON object), answered as JSON text. The same typed calls as the app makes to a
    /// server, over the in-process router.
    pub async fn call(
        &self,
        app: String,
        op: String,
        args: String,
    ) -> Result<String, EmbeddedError> {
        self.wire()
            .call(app, op, args)
            .await
            .map_err(EmbeddedError::from_sdk)
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
    use std::time::Duration;

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
                kaufland: false,
                device_secret: None,
            }
        }

        /// A fixed secret, so the same database can be started again with it.
        const SECRET: &'static str =
            "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";

        fn with_secret(name: &str) -> StartConfig {
            StartConfig {
                device_secret: Some(Self::SECRET.into()),
                ..Self::config(name)
            }
        }

        /// The same database again, with the same secret as `with_secret` made for it.
        fn with_secret_at(db_path: &str) -> StartConfig {
            StartConfig {
                db_path: db_path.into(),
                device_secret: Some(Self::SECRET.into()),
                ..Self::config("unused")
            }
        }

        fn with_kaufland(name: &str) -> StartConfig {
            StartConfig {
                kaufland: true,
                device_secret: Some(generate_device_secret()),
                ..Self::config(name)
            }
        }

        fn with_lidl(name: &str) -> StartConfig {
            StartConfig {
                lidl_plus: true,
                device_secret: Some(generate_device_secret()),
                ..Self::config(name)
            }
        }

        /// A request with a JSON body.
        fn put(path: &str, body: serde_json::Value) -> HttpRequest {
            HttpRequest {
                method: "PUT".into(),
                path_and_query: path.into(),
                content_type: Some("application/json".into()),
                body: body.to_string().into_bytes(),
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
                path_and_query: "/v1/bank/import/csv".into(),
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

    fn base64_of(bytes: &[u8]) -> String {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for c in bytes.chunks(3) {
            let n = (u32::from(c[0]) << 16)
                | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
                | u32::from(*c.get(2).unwrap_or(&0));
            for i in 0..4 {
                if i <= c.len() {
                    out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    #[tokio::test]
    async fn the_apps_typed_calls_run_over_the_in_process_router() {
        let b = Backend::start_with(Fixtures::config("typed"))
            .await
            .unwrap();
        let csv = serde_json::json!({ "kind": "csv", "csv_base64": base64_of(CSV.as_bytes()) })
            .to_string();
        let report = b
            .call("finance".into(), "import_file".into(), csv)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&report).unwrap()["imported"],
            1
        );
        let list = b
            .call("finance".into(), "list_transactions".into(), "{}".into())
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&list).unwrap()[0]["category"],
            "groceries"
        );

        // a refusal keeps its status and words
        let refused = b
            .call(
                "finance".into(),
                "ean_lookup".into(),
                r#"{"ean":"123"}"#.into(),
            )
            .await
            .unwrap_err();
        assert!(
            matches!(refused, EmbeddedError::Refused { status: 400, .. }),
            "{refused:?}"
        );
        // an app this build does not have is a 404 from the router
        let none = b
            .call("mail".into(), "info".into(), "{}".into())
            .await
            .unwrap_err();
        assert!(
            matches!(none, EmbeddedError::Refused { status: 404, .. }),
            "{none:?}"
        );
    }

    #[tokio::test]
    async fn data_persists_across_restarts() {
        let cfg = Fixtures::config("persist");
        let first = Backend::start_with(cfg.clone()).await.unwrap();
        first
            .handle_request(HttpRequest {
                method: "POST".into(),
                path_and_query: "/v1/bank/import/csv".into(),
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
            .handle_request(Fixtures::get("/v1/receipts/sources/lidl_plus"))
            .await;
        assert_eq!(status.status, 200);
        assert_eq!(Fixtures::json(&status)["state"], "disabled");
        // the answer says what to do, without pointing at a server config the phone does not have
        let start = b
            .handle_request(HttpRequest {
                method: "POST".into(),
                path_and_query: "/v1/receipts/sources/lidl_plus/connect".into(),
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
            .handle_request(Fixtures::get("/v1/receipts/sources/lidl_plus"))
            .await;
        let status = Fixtures::json(&status);
        assert_eq!(status["enabled"], true);
        assert_eq!(status["state"], "not_connected"); // on, but nobody has signed in yet

        // the sign-in page address comes from the backend; nothing is contacted here
        let start = b
            .handle_request(HttpRequest {
                method: "POST".into(),
                path_and_query: "/v1/receipts/sources/lidl_plus/connect".into(),
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
    async fn kaufland_can_be_switched_on_on_the_phone() {
        let b = Backend::start_with(Fixtures::with_kaufland("receipts-kaufland"))
            .await
            .unwrap();
        let status = b
            .handle_request(Fixtures::get("/v1/receipts/sources/kaufland_card"))
            .await;
        let status = Fixtures::json(&status);
        assert_eq!(status["enabled"], true);
        assert_eq!(status["state"], "not_connected");
        let start = b
            .handle_request(HttpRequest {
                method: "POST".into(),
                path_and_query: "/v1/receipts/sources/kaufland_card/connect".into(),
                content_type: None,
                body: vec![],
            })
            .await;
        assert_eq!(start.status, 200);
        let start = Fixtures::json(&start);
        assert!(start["authorization_url"]
            .as_str()
            .unwrap()
            .starts_with("https://account.kaufland.com/"));
        assert_eq!(start["callback_scheme"], "com.kaufland.kaufland");
        // Lidl Plus stays off
        let lidl = b
            .handle_request(Fixtures::get("/v1/receipts/sources/lidl_plus"))
            .await;
        assert_eq!(Fixtures::json(&lidl)["state"], "disabled");
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

    /// The `/v1/server-config` key by its path.
    fn config_key(view: &serde_json::Value, path: &str) -> serde_json::Value {
        view["groups"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["keys"].as_array().unwrap().iter())
            .find(|k| k["path"] == path)
            .unwrap_or_else(|| panic!("no key {path}"))
            .clone()
    }

    /// Wait until `ready` holds for what the backend answers (a saved setting rebuilds it a
    /// moment after the answer).
    async fn eventually<F: Fn(&serde_json::Value) -> bool>(
        b: &Backend,
        path: &str,
        ready: F,
    ) -> serde_json::Value {
        for _ in 0..80 {
            let res = b.handle_request(Fixtures::get(path)).await;
            let v = Fixtures::json(&res);
            if ready(&v) {
                return v;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("{path} never became ready");
    }

    #[tokio::test]
    async fn the_phone_has_the_servers_settings_screen() {
        let b = Backend::start_with(Fixtures::with_secret("settings-screen"))
            .await
            .unwrap();
        let res = b.handle_request(Fixtures::get("/v1/server-config")).await;
        assert_eq!(res.status, 200, "{}", String::from_utf8_lossy(&res.body));
        let view = Fixtures::json(&res);
        // the same keys as the server, with what the host decides locked
        assert_eq!(config_key(&view, "bank.plaid.client_id")["locked"], false);
        assert_eq!(config_key(&view, "database.url")["locked"], true);
        assert_eq!(config_key(&view, "auth.api_token")["locked"], true);
        // the token is never shown
        assert!(!String::from_utf8_lossy(&res.body).contains(&b.ctx.token));
    }

    #[tokio::test]
    async fn a_bank_provider_set_up_in_the_app_is_available_after_the_backend_rebuilds() {
        let b = Backend::start_with(Fixtures::with_secret("plaid-on-the-phone"))
            .await
            .unwrap();
        let providers =
            Fixtures::json(&b.handle_request(Fixtures::get("/v1/bank/providers")).await);
        let plaid = |v: &serde_json::Value| {
            v.as_array()
                .unwrap()
                .iter()
                .find(|p| p["kind"] == "plaid")
                .unwrap()["available"]
                .as_bool()
                .unwrap()
        };
        assert!(!plaid(&providers));

        let saved = b
            .handle_request(Fixtures::put(
                "/v1/server-config",
                serde_json::json!({ "set": {
                    "bank.plaid.client_id": "client-id",
                    "bank.plaid.secret": "plaid-secret",
                    "bank.plaid.environment": "sandbox",
                }}),
            ))
            .await;
        assert_eq!(
            saved.status,
            200,
            "{}",
            String::from_utf8_lossy(&saved.body)
        );
        assert_eq!(Fixtures::json(&saved)["restarting"], true);
        eventually(&b, "/v1/bank/providers", plaid).await;
        // the data stayed, and the screen shows the new value as set
        let view = Fixtures::json(&b.handle_request(Fixtures::get("/v1/server-config")).await);
        assert_eq!(config_key(&view, "bank.plaid.client_id")["is_set"], true);
    }

    #[tokio::test]
    async fn a_setting_that_does_not_start_is_rolled_back_like_on_the_server() {
        // no device secret: receipt import cannot start, so the change is undone
        let b = Backend::start_with(Fixtures::config("setting-rolls-back"))
            .await
            .unwrap();
        let saved = b
            .handle_request(Fixtures::put(
                "/v1/server-config",
                serde_json::json!({ "set": { "receipts.lidl_plus.enabled": true } }),
            ))
            .await;
        assert_eq!(
            saved.status,
            200,
            "{}",
            String::from_utf8_lossy(&saved.body)
        );
        // give the rebuild time to try, fail and go back
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let view = Fixtures::json(&b.handle_request(Fixtures::get("/v1/server-config")).await);
        // back to the previous setting: not switched on
        assert_ne!(
            config_key(&view, "receipts.lidl_plus.enabled")["value"],
            serde_json::json!(true)
        );
        // and it still answers
        assert_eq!(
            b.handle_request(Fixtures::get("/v1/transactions"))
                .await
                .status,
            200
        );
    }

    #[tokio::test]
    async fn what_the_app_kept_before_becomes_the_settings_once() {
        let mut cfg = Fixtures::with_secret("legacy-values");
        cfg.claude_api_key = Some("sk-ant-old".into());
        cfg.fints_product_id = Some("PRODUCT-ID".into());
        let db = cfg.db_path.clone();
        let b = Backend::start_with(cfg).await.unwrap();
        let view = Fixtures::json(&b.handle_request(Fixtures::get("/v1/server-config")).await);
        assert_eq!(config_key(&view, "llm.anthropic_api_key")["is_set"], true);
        assert_eq!(config_key(&view, "bank.fints_product_id")["is_set"], true);

        // changed on the settings screen, then started again with the old values still passed:
        // the settings file wins
        b.handle_request(Fixtures::put(
            "/v1/server-config",
            serde_json::json!({ "set": { "llm.anthropic_api_key": null } }),
        ))
        .await;
        tokio::time::sleep(Duration::from_millis(1500)).await;
        drop(b);
        let again = StartConfig {
            claude_api_key: Some("sk-ant-old".into()),
            ..Fixtures::with_secret_at(&db)
        };
        let b = Backend::start_with(again).await.unwrap();
        let view = Fixtures::json(&b.handle_request(Fixtures::get("/v1/server-config")).await);
        assert_eq!(config_key(&view, "llm.anthropic_api_key")["is_set"], false);
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
            "/v1/pantry",
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
