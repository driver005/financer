//! REST API shared by the hosted server and the embedded on-phone backend.

mod auth;
mod dto;
mod routes;

use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use financer_store::Store;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;

pub use auth::TokenHash;

/// Largest request body accepted (CSV exports of many years stay well below this).
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
}

#[derive(OpenApi)]
#[openapi(
    info(title = "Financer API", version = "0.1.0"),
    paths(
        routes::health,
        routes::import_transactions,
        routes::list_transactions,
        routes::recurring,
        routes::disposable,
        routes::get_envelopes,
        routes::put_envelopes,
        routes::budget_status,
    ),
    components(schemas(
        dto::TransactionDto,
        dto::ImportReport,
        dto::SkippedRowDto,
        dto::RecurringDto,
        dto::EnvelopeDto,
        dto::EnvelopeStatusDto,
        dto::DisposableDto,
        dto::ErrorBody,
    )),
    modifiers(&BearerAuth)
)]
pub struct ApiDoc;

struct BearerAuth;

impl utoipa::Modify for BearerAuth {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(HttpBuilder::new().scheme(HttpAuthScheme::Bearer).build()),
        );
    }
}

/// Build the router. `/health` is open; everything under `/v1` needs the bearer token.
pub fn router(state: AppState, token: TokenHash) -> Router {
    let v1 = Router::new()
        .route("/transactions", get(routes::list_transactions))
        .route("/transactions/import", post(routes::import_transactions))
        .route("/recurring", get(routes::recurring))
        .route("/budget/disposable", get(routes::disposable))
        .route(
            "/budget/envelopes",
            get(routes::get_envelopes).put(routes::put_envelopes),
        )
        .route("/budget/status", get(routes::budget_status))
        .layer(middleware::from_fn_with_state(token, auth::require_token));

    Router::new()
        .route("/health", get(routes::health))
        .nest("/v1", v1)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub fn openapi_json() -> String {
    ApiDoc::openapi()
        .to_pretty_json()
        .expect("OpenAPI document serializes")
}
