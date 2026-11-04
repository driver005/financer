//! The mail client's API: one router, mounted at `/v1/mail` inside the finance server (behind its
//! token), plus the sync and the background poller that fill it. See docs/MAIL.md.

pub mod compose;
pub mod config;
pub mod parse;
mod routes;
pub mod smtp;
pub mod state;
pub mod sync;
pub mod testing;
mod view;

use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post, put};
use axum::Router;
use tower_http::trace::TraceLayer;

pub use config::{MailConfig, MailSetup, SmtpSecurity};
pub use financer_mail_core as core;
pub use financer_mail_store as store;
pub use smtp::{SendError, Sender, SmtpSender};
pub use state::{MailState, SyncReport};

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

pub struct MailApi;

impl MailApi {
    /// The routes, without authentication and without a prefix: mount them with
    /// `nest_service("/mail", MailApi::router(state))` under an authenticated `/v1`.
    pub fn router(state: MailState) -> Router {
        Router::new()
            .route("/info", get(routes::info))
            .route("/sync", post(routes::sync))
            .route("/conversations", get(routes::list_conversations))
            .route("/conversations/{key}", get(routes::get_conversation))
            .route("/conversations/{key}/read", post(routes::mark_read))
            .route("/messages/{id}", get(routes::get_message))
            .route(
                "/templates",
                get(routes::list_templates).post(routes::create_template),
            )
            .route(
                "/templates/{id}",
                put(routes::update_template).delete(routes::delete_template),
            )
            .route("/compose/preview", post(routes::preview))
            .route("/send", post(routes::send))
            .route(
                "/events",
                get(routes::list_events).post(routes::create_event),
            )
            .route("/events/{id}", delete(routes::remove_event))
            .route("/events/{id}/restore", post(routes::restore_event))
            .fallback(|| async { axum::http::StatusCode::NOT_FOUND })
            .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
            .layer(TraceLayer::new_for_http())
            .with_state(state)
    }
}
