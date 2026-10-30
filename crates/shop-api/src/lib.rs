//! The shopping assistant's API. One router, mounted at `/v1/shop` either by the standalone
//! shopping server or inside the finance server, so the app talks to both the same way.

mod auth;
pub mod jobs;
pub mod notify;
mod routes;
pub mod setup;
pub mod state;

use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{get, post, put};
use axum::Router;
use tower_http::trace::TraceLayer;

pub use auth::ShopToken;
pub use financer_llm as llm;
pub use financer_prices as prices;
pub use financer_shop_core as core;
pub use financer_shop_sources as sources;
pub use financer_shop_store as store;
pub use routes::{MyPlan, SearchRequest, SearchResponse};
pub use setup::{NotifierSetup, ShopSetup};
pub use state::{IndexRefusal, ShopConfig, ShopState, Snapshot};

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

/// The shopping routes, without authentication and without a prefix. Mount them with
/// `nest_service("/shop", ShopApi::router(state))` under an authenticated `/v1`.
pub struct ShopApi;

impl ShopApi {
    pub fn router(state: ShopState) -> Router {
        Router::new()
            .route("/info", get(routes::info))
            .route("/categories", get(routes::list_categories))
            .route(
                "/categories/{id}",
                get(routes::get_category)
                    .put(routes::put_category)
                    .delete(routes::delete_category),
            )
            .route("/search", post(routes::search))
            .route("/compare", post(routes::compare_products))
            .route(
                "/products",
                get(routes::list_products).post(routes::add_product),
            )
            .route(
                "/products/{id}",
                get(routes::get_product)
                    .put(routes::edit_product)
                    .delete(routes::delete_product),
            )
            .route("/profiles", get(routes::list_profiles))
            .route(
                "/profiles/{name}",
                put(routes::put_profile).delete(routes::delete_profile),
            )
            .route(
                "/my/{category}",
                get(routes::get_my_plan).put(routes::put_my_plan),
            )
            .route("/index", get(routes::list_index).post(routes::start_index))
            .route(
                "/index/{id}",
                get(routes::get_index).delete(routes::cancel_index),
            )
            .route(
                "/watches",
                get(routes::list_watches).post(routes::create_watch),
            )
            .route(
                "/watches/{id}",
                put(routes::update_watch).delete(routes::delete_watch),
            )
            .route("/deals", get(routes::deals))
            .route("/notifications", get(routes::notifications))
            .route("/notifications/read", post(routes::mark_read))
            .route(
                "/push-tokens",
                post(routes::add_push_token).delete(routes::remove_push_token),
            )
            .fallback(|| async { axum::http::StatusCode::NOT_FOUND })
            .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
            .with_state(state)
    }

    /// The standalone server: `/health` open, everything under `/v1/shop` behind the token.
    pub fn standalone(state: ShopState, token: &str) -> Router {
        let guarded = Self::router(state).layer(middleware::from_fn_with_state(
            ShopToken::new(token),
            auth::require,
        ));
        Router::new()
            .route("/health", get(|| async { "ok" }))
            .nest("/v1/shop", guarded)
            .layer(TraceLayer::new_for_http())
    }
}
