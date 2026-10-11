//! Configuration (environment variables):
//!
//! - `FINANCER_API_TOKEN`    required, at least 32 characters; the app sends it as a bearer token
//! - `FINANCER_DATABASE_URL` `postgres://user:pass@host/db` or `sqlite://path?mode=rwc`
//!   (default `sqlite://financer.db?mode=rwc`)
//! - `FINANCER_BIND`         listen address (default `127.0.0.1:8080`; put HTTPS in front)
//!
//! `financer-server --print-openapi` prints the OpenAPI document and exits.

use financer_api::{router, AppState, TokenHash};
use financer_store::Store;
use tracing_subscriber::EnvFilter;

const MIN_TOKEN_LEN: usize = 32;

#[tokio::main]
async fn main() {
    if std::env::args().any(|a| a == "--print-openapi") {
        println!("{}", financer_api::openapi_json());
        return;
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    if let Err(e) = run().await {
        eprintln!("financer-server: {e}");
        std::process::exit(1);
    }
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

    let store = Store::connect(&db_url)
        .await
        .map_err(|e| format!("cannot open database: {e}"))?;
    tracing::info!(backend = ?store.backend(), "database ready");

    let app = router(AppState { store }, TokenHash::new(&token));
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
