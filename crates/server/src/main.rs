//! The Financer server.
//!
//! Configuration comes from `financer.toml` and `FINANCER_*` environment variables (the
//! environment wins; see docs/CONFIG.md and `financer.example.toml`). The file is looked up as
//! `--config <path>`, `FINANCER_CONFIG`, `./financer.toml`; without one the environment alone
//! works as it always did.
//!
//! - `FINANCER_API_TOKEN`          required, at least 32 characters; the app sends it as a bearer token
//! - `FINANCER_DATABASE_URL`       `postgres://user:pass@host/db` or `sqlite://path?mode=rwc`
//!   (default `sqlite://financer.db?mode=rwc`)
//! - `FINANCER_WEB_DIR`           serve a built web app (`expo export --platform web`) at `/`
//! - `FINANCER_CORS_ORIGIN`        development only: allow browsers on these origins (comma-separated,
//!   e.g. `http://localhost:8081`) to call the API, for the hot-reloading web app (`make web`)
//! - `FINANCER_BIND`               listen address (default `127.0.0.1:8080`; put HTTPS in front)
//! - `FINANCER_PRICE_SOURCES`      path to a JSON file listing price sources (see docs/PRICES.md)
//! - `FINANCER_REFRESH_HOURS`      hours between automatic price refreshes (default 24, 0 = off)
//! - `FINANCER_FINTS_PRODUCT_ID`   FinTS product id from the Deutsche Kreditwirtschaft; enables live Sparkasse sync
//! - `FINANCER_ANTHROPIC_API_KEY`  enables recipe ideas with Claude
//! - `FINANCER_OPENAI_API_KEY`     enables recipe ideas with OpenAI
//! - `FINANCER_LLM_PROVIDER`       `claude` or `openai`: the provider used until the app chooses one
//! - `FINANCER_CONFIG`             path of the config file
//!
//! Commands: `--print-openapi` prints the OpenAPI document; `--probe-prices` fetches every
//! configured price source once and reports what it found, without touching the database;
//! `--print-config` shows the effective configuration with secrets hidden; `--check-config`
//! validates it and exits 0 or 1.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use financer_api::{Api, AppState, BankConnection, LlmKeys, PriceSourceConfig, TokenHash};
use financer_config::{Config, Loaded, Loader, ProcessEnv, ProviderChoice, Renderer};
use financer_core::StoreAlias;
use financer_prices::{PoliteHttp, ReqwestHttp, Sources};
use financer_store::Store;
use tracing_subscriber::EnvFilter;

const USER_AGENT: &str =
    "financer-personal/0.1 (personal use; +https://github.com/driver005/financer)";
const AGENT_TOKEN: &str = "financer";
/// Pause between requests to the same host.
const REQUEST_GAP: Duration = Duration::from_secs(3);

/// What the command line asked for.
struct Cli {
    config: Option<PathBuf>,
    print_openapi: bool,
    probe_prices: bool,
    print_config: bool,
    check_config: bool,
}

impl Cli {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut cli = Cli {
            config: None,
            print_openapi: false,
            probe_prices: false,
            print_config: false,
            check_config: false,
        };
        let mut it = args.iter().skip(1);
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--print-openapi" => cli.print_openapi = true,
                "--probe-prices" => cli.probe_prices = true,
                "--print-config" => cli.print_config = true,
                "--check-config" => cli.check_config = true,
                "--config" => {
                    let path = it.next().ok_or("--config needs a path")?;
                    cli.config = Some(PathBuf::from(path));
                }
                other => match other.strip_prefix("--config=") {
                    Some(path) if !path.is_empty() => cli.config = Some(PathBuf::from(path)),
                    _ => return Err(format!("unknown argument {other:?}")),
                },
            }
        }
        Ok(cli)
    }
}

/// The `financer-server` binary: reads its configuration and serves the API.
struct Server;

impl Server {
    /// Entry point: handles the command line, then runs the server (or a probe) to completion.
    async fn cli() {
        let args: Vec<String> = std::env::args().collect();
        let cli = match Cli::parse(&args) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("financer-server: {e}");
                std::process::exit(2);
            }
        };
        if cli.print_openapi {
            println!("{}", Api::openapi_json());
            return;
        }
        if cli.print_config || cli.check_config {
            std::process::exit(Self::inspect_config(&cli));
        }

        tracing_subscriber::fmt()
            .with_env_filter(
                EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
            )
            .init();

        let result = match Self::load(&cli) {
            Ok(loaded) if cli.probe_prices => Self::probe(&loaded.config).await,
            Ok(loaded) => Self::run(loaded).await,
            Err(e) => Err(e),
        };
        if let Err(e) = result {
            eprintln!("financer-server: {e}");
            std::process::exit(1);
        }
    }

    fn load(cli: &Cli) -> Result<Loaded, String> {
        let cwd = std::env::current_dir().map_err(|e| format!("no working directory: {e}"))?;
        Loader::load(cli.config.as_deref(), &ProcessEnv, &cwd).map_err(|e| e.to_string())
    }

    /// `--print-config` and `--check-config`. Returns the exit code.
    fn inspect_config(cli: &Cli) -> i32 {
        let loaded = match Self::load(cli) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("config error: {e}");
                return 1;
            }
        };
        for w in &loaded.warnings {
            eprintln!("warning: {w}");
        }
        let mut problems = loaded.config.problems_for_server();
        if problems.is_empty() {
            // the price sources file exists; check that it parses
            if let Err(e) = Self::load_sources(&loaded.config) {
                problems.push(e);
            }
        }
        if cli.print_config {
            print!("{}", Renderer::render(&loaded));
        }
        for p in &problems {
            eprintln!("config error: {p}");
        }
        if !problems.is_empty() {
            return 1;
        }
        if cli.check_config {
            match &loaded.path {
                Some(p) => println!("config ok ({})", p.display()),
                None => println!("config ok (no config file; environment and defaults)"),
            }
        }
        0
    }

    fn load_sources(config: &Config) -> Result<Vec<PriceSourceConfig>, String> {
        let Some(path) = config.prices.sources_file.value.clone() else {
            return Ok(Vec::new());
        };
        let text = std::fs::read_to_string(&path).map_err(|e| {
            format!(
                "cannot read the price sources file {path} ({}): {e}",
                config.prices.sources_file.source
            )
        })?;
        serde_json::from_str(&text).map_err(|e| format!("invalid price sources in {path}: {e}"))
    }

    fn polite_http() -> Result<Arc<PoliteHttp<ReqwestHttp>>, String> {
        let inner = ReqwestHttp::new(USER_AGENT).map_err(|e| e.to_string())?;
        Ok(Arc::new(PoliteHttp::new(inner, AGENT_TOKEN, REQUEST_GAP)))
    }

    fn llm_provider(choice: ProviderChoice) -> financer_llm::Provider {
        match choice {
            ProviderChoice::Claude => financer_llm::Provider::Claude,
            ProviderChoice::OpenAi => financer_llm::Provider::OpenAi,
        }
    }

    fn store_aliases(config: &Config) -> Vec<StoreAlias> {
        config
            .stores
            .iter()
            .map(|s| StoreAlias {
                chain: s.chain.clone(),
                patterns: s.patterns.to_vec(),
            })
            .collect()
    }

    fn bank_connections(config: &Config) -> Vec<BankConnection> {
        config
            .bank
            .accounts
            .iter()
            .map(|a| BankConnection {
                name: a.name.trim().to_string(),
                bank_code: a.bank_code.trim().to_string(),
                login: a.login.trim().to_string(),
                iban: a.iban.split_whitespace().collect(),
                bic: a.bic.clone().filter(|b| !b.trim().is_empty()),
                fints_url: a.fints_url.clone().filter(|u| !u.trim().is_empty()),
                pin_env: a.pin_env.clone().filter(|v| !v.trim().is_empty()),
                sync_every_hours: a.sync_every_hours,
                since_days: a.since_days,
            })
            .collect()
    }

    fn secret(s: &financer_config::Setting<Option<financer_config::Secret>>) -> Option<String> {
        s.value.as_ref().map(|k| k.expose().to_string())
    }

    async fn run(loaded: Loaded) -> Result<(), String> {
        let config = &loaded.config;
        match &loaded.path {
            Some(p) => tracing::info!("configuration from {}", p.display()),
            None => tracing::info!("no config file; using environment variables and defaults"),
        }
        for w in &loaded.warnings {
            tracing::warn!("{w}");
        }
        let problems = config.problems_for_server();
        if !problems.is_empty() {
            return Err(problems.join("\n"));
        }
        let token = Self::secret(&config.auth.api_token).ok_or("no API token")?;
        let db_url = config.database.url.value.clone();
        let bind = config.server.bind.value.clone();
        let refresh_hours = config.server.refresh_hours.value;
        let sources = Self::load_sources(config)?;

        let store = Store::connect(&db_url)
            .await
            .map_err(|e| format!("cannot open database: {e}"))?;
        tracing::info!(backend = ?store.backend(), price_sources = sources.len(), "database ready");

        let mut state = AppState::new(store)
            .with_http(Self::polite_http()?)
            .with_price_sources(sources.clone())
            .with_llm_keys(LlmKeys {
                claude: Self::secret(&config.llm.anthropic_api_key),
                openai: Self::secret(&config.llm.openai_api_key),
            })
            .with_default_llm_provider(config.llm.provider.value.map(Self::llm_provider))
            .with_store_aliases(&Self::store_aliases(config))
            .with_bank_connections(Self::bank_connections(config));

        if let Some(product_id) = Self::secret(&config.bank.fints_product_id) {
            state = state.with_bank(Arc::new(financer_fints::FintsBank::new(&product_id)));
            tracing::info!("live bank sync enabled (FinTS)");
        }

        if !config.bank.accounts.is_empty() {
            if Self::secret(&config.bank.fints_product_id).is_some() {
                tracing::info!(
                    "{} bank connection(s) from the config file; scheduled syncs wait for your approval in the banking app",
                    config.bank.accounts.len()
                );
                tokio::spawn(Api::run_bank_scheduler(state.clone()));
            } else {
                tracing::warn!(
                    "bank accounts are configured but there is no FinTS product id, so they cannot sync"
                );
            }
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
        if let Some(dir) = &config.server.web_dir.value {
            tracing::info!("serving the web app from {dir}");
            app = Api::with_web_app(app, dir);
        }
        let origins = &config.server.cors_origins.value;
        if !origins.is_empty() {
            let list = origins
                .iter()
                .map(|o| {
                    o.parse::<axum::http::HeaderValue>()
                        .map_err(|_| format!("server.cors_origins: bad origin {o:?}"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            tracing::warn!(
                "CORS is open for {} (development setting)",
                origins.join(",")
            );
            app = app.layer(
                tower_http::cors::CorsLayer::new()
                    .allow_origin(list)
                    .allow_methods(tower_http::cors::Any)
                    .allow_headers(tower_http::cors::Any),
            );
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
    async fn probe(config: &Config) -> Result<(), String> {
        let configs = Self::load_sources(config)?;
        if configs.is_empty() {
            return Err(
                "no price sources: set FINANCER_PRICE_SOURCES (or prices.sources_file in financer.toml) to a JSON file, see docs/PRICES.md"
                    .into(),
            );
        }
        let http = Self::polite_http()?;
        // pages read by a model use the first provider that has a key
        let llm: Option<Arc<dyn financer_llm::LlmProvider>> = [
            (
                financer_llm::Provider::Claude,
                Self::secret(&config.llm.anthropic_api_key),
            ),
            (
                financer_llm::Provider::OpenAi,
                Self::secret(&config.llm.openai_api_key),
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
