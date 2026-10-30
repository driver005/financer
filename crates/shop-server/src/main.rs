//! The standalone shopping assistant server.
//!
//! It crawls the configured sources all the time, like a small search engine, keeps price
//! history, and tells you about deals (ntfy, the app's push, or a webhook). The app talks to it
//! under `/v1/shop` with a bearer token. Settings are `FINANCER_SHOP_*` environment variables
//! (the list is on [`ShopSetup::from_lookup`], and in docs/SHOP.md).
//!
//! - `FINANCER_SHOP_API_TOKEN`   required, at least 32 characters
//! - `FINANCER_SHOP_BIND`        listen address, default `127.0.0.1:8090` (put HTTPS in front)
//! - `FINANCER_SHOP_WEB_DIR`     serve a built web app at `/`
//!
//! Commands: `--check-config` validates the settings and exits 0 or 1; `--probe "pixel 9"` reads
//! the sources once for that search into a throwaway database and prints what it found.

use financer_shop_api::{ShopApi, ShopSetup};
use financer_shop_sources::{Cancel, IndexRequest, ProgressTx};
use financer_shop_store::{ShopStore, StoreSink};
use tracing_subscriber::EnvFilter;

const DEFAULT_DATABASE: &str = "sqlite://financer-shop.db?mode=rwc";
const DEFAULT_BIND: &str = "127.0.0.1:8090";

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn setup() -> Result<ShopSetup, String> {
    ShopSetup::from_lookup(&|k| std::env::var(k).ok(), DEFAULT_DATABASE)
}

async fn probe(query: &str) -> Result<(), String> {
    let setup = setup()?;
    if setup.sources.is_empty() {
        return Err(
            "no sources: set FINANCER_SHOP_SOURCES to a JSON file (see docs/SHOP.md)".into(),
        );
    }
    let store = ShopStore::connect("sqlite::memory:")
        .await
        .map_err(|e| e.to_string())?;
    let state = setup.start(store.clone(), None).await?;
    let (tx, rx) = ProgressTx::new();
    let request = IndexRequest {
        query: query.to_string(),
        ..IndexRequest::default()
    };
    let sink = StoreSink::new(store.clone());
    let report = state
        .crawler
        .index_query(&sink, &request, &tx, &Cancel::new())
        .await;
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
    );
    let last = rx.borrow().clone();
    println!(
        "{}: {}",
        serde_json::to_string(&last.phase).unwrap_or_default(),
        last.message
    );
    for p in store.list_products(None).await.map_err(|e| e.to_string())? {
        let best = p.offers.iter().map(|o| o.comparable_cents(24)).min();
        println!(
            "  {}  {} ({} specs, {} offers, best {:?})",
            p.id,
            p.title,
            p.attributes.len(),
            p.offers.len(),
            best
        );
    }
    Ok(())
}

async fn run() -> Result<(), String> {
    let setup = setup()?;
    let token = env("FINANCER_SHOP_API_TOKEN").ok_or("FINANCER_SHOP_API_TOKEN is not set")?;
    if token.chars().count() < 32 {
        return Err("FINANCER_SHOP_API_TOKEN must have at least 32 characters".into());
    }
    let bind = env("FINANCER_SHOP_BIND").unwrap_or_else(|| DEFAULT_BIND.to_string());
    let store = setup.open_store().await?;
    let state = setup.start(store, None).await?;
    if setup.sources.is_empty() {
        tracing::warn!(
            "no sources are configured (FINANCER_SHOP_SOURCES): there is nothing to crawl"
        );
    }
    if setup.spawn_background(&state) {
        tracing::info!(sources = setup.sources.len(), "continuous crawl started");
    }
    let mut app = ShopApi::standalone(state, &token);
    if let Some(dir) = env("FINANCER_SHOP_WEB_DIR") {
        use tower_http::services::{ServeDir, ServeFile};
        tracing::info!("serving the web app from {dir}");
        app = app.fallback_service(
            ServeDir::new(&dir).fallback(ServeFile::new(format!("{dir}/index.html"))),
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

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let result = match args.first().map(String::as_str) {
        Some("--check-config") => setup().map(|s| {
            println!(
                "ok: {} source(s), database {}",
                s.sources.len(),
                s.database_url
            );
        }),
        Some("--probe") => match args.get(1) {
            Some(q) => probe(q).await,
            None => Err("--probe needs a search, e.g. --probe \"pixel 9\"".into()),
        },
        Some(other) => Err(format!("unknown argument {other:?}")),
        None => run().await,
    };
    if let Err(e) = result {
        eprintln!("financer-shop-server: {e}");
        std::process::exit(1);
    }
}
