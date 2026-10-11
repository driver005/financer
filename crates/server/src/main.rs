//! Configuration (environment variables):
//!
//! - `FINANCER_API_TOKEN`          required, at least 32 characters; the app sends it as a bearer token
//! - `FINANCER_DATABASE_URL`       `postgres://user:pass@host/db` or `sqlite://path?mode=rwc`
//!   (default `sqlite://financer.db?mode=rwc`)
//! - `FINANCER_WEB_DIR`           serve a built web app (`expo export --platform web`) at `/`
//! - `FINANCER_BIND`               listen address (default `127.0.0.1:8080`; put HTTPS in front)
//! - `FINANCER_PRICE_SOURCES`      path to a JSON file listing price sources (see docs/PRICES.md)
//! - `FINANCER_REFRESH_HOURS`      hours between automatic price refreshes (default 24, 0 = off)
//! - `FINANCER_FINTS_PRODUCT_ID`   FinTS product id from the Deutsche Kreditwirtschaft; enables live Sparkasse sync
//! - `FINANCER_ANTHROPIC_API_KEY`  enables recipe ideas with Claude
//! - `FINANCER_OPENAI_API_KEY`     enables recipe ideas with OpenAI
//!
//! Commands: `--print-openapi` prints the OpenAPI document; `--probe-prices` fetches every
//! configured price source once and reports what it found, without touching the database.

use std::sync::Arc;
use std::time::Duration;

use financer_api::{Api, AppState, LlmKeys, PriceSourceConfig, TokenHash};
use financer_prices::{PoliteHttp, ReqwestHttp, Sources};
use financer_store::Store;
use tracing_subscriber::EnvFilter;

const MIN_TOKEN_LEN: usize = 32;
const USER_AGENT: &str =
    "financer-personal/0.1 (personal use; +https://github.com/driver005/financer)";
const AGENT_TOKEN: &str = "financer";
/// Pause between requests to the same host.
const REQUEST_GAP: Duration = Duration::from_secs(3);

/// The `financer-server` binary: reads its configuration from the environment and serves the API.
struct Server;

impl Server {
    /// Entry point: handles the command line, then runs the server (or a probe) to completion.
    async fn cli() {
        let args: Vec<String> = std::env::args().collect();
        if args.iter().any(|a| a == "--print-openapi") {
            println!("{}", Api::openapi_json());
            return;
        }

        tracing_subscriber::fmt()
            .with_env_filter(
                EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
            )
            .init();

        let result = if args.iter().any(|a| a == "--probe-prices") {
            Self::probe().await
        } else {
            Self::run().await
        };
        if let Err(e) = result {
            eprintln!("financer-server: {e}");
            std::process::exit(1);
        }
    }

    fn load_sources() -> Result<Vec<PriceSourceConfig>, String> {
        // an empty value (e.g. passed through by docker compose) means "not configured"
        let Some(path) = Self::env_key("FINANCER_PRICE_SOURCES") else {
            return Ok(Vec::new());
        };
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("cannot read FINANCER_PRICE_SOURCES {path}: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("invalid price sources in {path}: {e}"))
    }

    fn polite_http() -> Result<Arc<PoliteHttp<ReqwestHttp>>, String> {
        let inner = ReqwestHttp::new(USER_AGENT).map_err(|e| e.to_string())?;
        Ok(Arc::new(PoliteHttp::new(inner, AGENT_TOKEN, REQUEST_GAP)))
    }

    fn env_key(name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|k| !k.trim().is_empty())
    }

    async fn run() -> Result<(), String> {
        let token = std::env::var("FINANCER_API_TOKEN")
            .map_err(|_| "FINANCER_API_TOKEN is not set".to_string())?;
        if token.len() < MIN_TOKEN_LEN {
            return Err(format!(
                "FINANCER_API_TOKEN must be at least {MIN_TOKEN_LEN} characters"
            ));
        }
        let db_url = std::env::var("FINANCER_DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://financer.db?mode=rwc".into());
        let bind = std::env::var("FINANCER_BIND").unwrap_or_else(|_| "127.0.0.1:8080".into());
        let refresh_hours: u64 = match std::env::var("FINANCER_REFRESH_HOURS") {
            Ok(v) => v
                .trim()
                .parse()
                .map_err(|_| "FINANCER_REFRESH_HOURS must be a whole number".to_string())?,
            Err(_) => 24,
        };
        let sources = Self::load_sources()?;

        let store = Store::connect(&db_url)
            .await
            .map_err(|e| format!("cannot open database: {e}"))?;
        tracing::info!(backend = ?store.backend(), price_sources = sources.len(), "database ready");

        let mut state = AppState::new(store)
            .with_http(Self::polite_http()?)
            .with_price_sources(sources.clone())
            .with_llm_keys(LlmKeys {
                claude: Self::env_key("FINANCER_ANTHROPIC_API_KEY"),
                openai: Self::env_key("FINANCER_OPENAI_API_KEY"),
            });

        if let Some(product_id) = Self::env_key("FINANCER_FINTS_PRODUCT_ID") {
            state = state.with_bank(Arc::new(financer_fints::FintsBank::new(&product_id)));
            tracing::info!("live bank sync enabled (FinTS)");
        }

        if refresh_hours > 0 && !sources.is_empty() {
            let state = state.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(30)).await;
                loop {
                    match Api::refresh_prices_summary(&state).await {
                        Ok(summary) => tracing::info!("price refresh: {summary}"),
                        Err(e) => tracing::warn!("price refresh failed: {e}"),
                    }
                    tokio::time::sleep(Duration::from_secs(refresh_hours * 3600)).await;
                }
            });
        }

        let mut app = Api::router(state, TokenHash::new(&token));
        if let Some(dir) = std::env::var("FINANCER_WEB_DIR")
            .ok()
            .filter(|d| !d.is_empty())
        {
            if !std::path::Path::new(&dir).join("index.html").is_file() {
                return Err(format!("FINANCER_WEB_DIR={dir} has no index.html"));
            }
            tracing::info!("serving the web app from {dir}");
            app = Api::with_web_app(app, dir);
        }
        let listener = tokio::net::TcpListener::bind(&bind)
            .await
            .map_err(|e| format!("cannot bind {bind}: {e}"))?;
        tracing::info!("listening on {bind}");
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await
            .map_err(|e| e.to_string())
    }

    /// Fetch every configured source once and print what came back. This is how to check, from
    /// the machine that will run the server, which retailer pages are reachable and parsable.
    async fn probe() -> Result<(), String> {
        let configs = Self::load_sources()?;
        if configs.is_empty() {
            return Err(
                "no price sources: set FINANCER_PRICE_SOURCES to a JSON file (see docs/PRICES.md)"
                    .into(),
            );
        }
        let http = Self::polite_http()?;
        // pages read by a model use the first provider that has a key in the environment
        let llm: Option<Arc<dyn financer_llm::LlmProvider>> = [
            (
                financer_llm::Provider::Claude,
                Self::env_key("FINANCER_ANTHROPIC_API_KEY"),
            ),
            (
                financer_llm::Provider::OpenAi,
                Self::env_key("FINANCER_OPENAI_API_KEY"),
            ),
        ]
        .into_iter()
        .find_map(|(provider, key)| {
            let settings = financer_llm::LlmSettings {
                provider,
                model: String::new(),
                api_key: key?,
                base_url: None,
            };
            financer_llm::ProviderFactory::create(&settings)
                .ok()
                .map(Arc::from)
        });
        let sources = Sources::build(&configs, time::OffsetDateTime::now_utc().date(), llm);
        let result = Sources::refresh(&sources, http.as_ref()).await;

        let samples: Vec<_> = result
            .quotes
            .iter()
            .take(5)
            .map(|q| {
                format!(
                    "{} @ {:?}: {} for {} ({})",
                    q.quote.item, q.quote.chain, q.quote.price, q.product_name, q.shelf_price
                )
            })
            .collect();
        let report = serde_json::json!({
            "sources": result.sources,
            "quotes_usable": result.quotes.len(),
            "skipped": result.normalize,
            "samples": samples,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
        );
        if result.sources.iter().any(|s| !s.ok) {
            return Err("at least one source failed".into());
        }
        Ok(())
    }
}

#[tokio::main]
async fn main() {
    Server::cli().await
}
