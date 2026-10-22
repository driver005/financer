//! The server's configuration as a settings screen: `GET /v1/server-config` lists every key of
//! `financer.toml` with its value and where it comes from, `PUT /v1/server-config` saves a change.
//!
//! A saved change is written to the server's settings file and takes effect when the server
//! restarts, which it does by itself a moment after answering. The on-phone backend has no
//! configuration file, so there these endpoints do not exist (404) and the app hides the screen.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use financer_config::{Admin, Change, ConfigView, UpdateError};
use serde::Serialize;
use utoipa::ToSchema;

use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

/// How long the server waits after answering before it restarts, so the answer gets out first.
pub(crate) const DEFAULT_RESTART_DELAY: Duration = Duration::from_millis(600);

/// What the endpoints need: the configuration admin and a way to restart the server.
pub(crate) struct ConfigControl {
    pub admin: Arc<Admin>,
    pub restart: Arc<dyn Fn() + Send + Sync>,
    pub delay: Duration,
    /// Set once a restart is on its way; further changes wait for it.
    pub restarting: AtomicBool,
}

/// A change was saved.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConfigSaved {
    /// The keys whose value is different now.
    pub changed: Vec<String>,
    /// Things that are legal but probably not what you want.
    pub warnings: Vec<String>,
    /// The server is restarting to apply the change (a few seconds). False when nothing changed.
    pub restarting: bool,
}

/// A change was refused; nothing was saved.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConfigProblems {
    /// The problems as one text.
    pub error: String,
    /// One entry per problem, naming the key.
    pub problems: Vec<String>,
}

impl ConfigProblems {
    fn response(status: StatusCode, problems: Vec<String>) -> Response {
        let error = problems.join("\n");
        (status, Json(ConfigProblems { error, problems })).into_response()
    }
}

fn control(state: &AppState) -> Result<&Arc<ConfigControl>, ApiError> {
    state.config_control.as_ref().ok_or(ApiError::NotFound)
}

/// Every setting of the server with its value (secrets only as "set"), the place it comes from
/// and what the app may change.
#[utoipa::path(
    get,
    path = "/v1/server-config",
    responses(
        (status = 200, body = ConfigView),
        (status = 404, description = "This backend has no server configuration (the on-phone one)", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn get_config(State(state): State<AppState>) -> Result<Json<ConfigView>, ApiError> {
    let control = control(&state)?.clone();
    let view = tokio::task::spawn_blocking(move || control.admin.view())
        .await
        .map_err(|_| ApiError::Internal)?;
    Ok(Json(view))
}

/// Save new values (`set`; `null` clears one) and drop values set earlier from the app (`reset`).
/// Everything is checked the way the server checks its configuration at start; one mistake and
/// nothing is saved. The server restarts to apply the change; if the changed settings do not
/// start, the previous ones come back by themselves.
#[utoipa::path(
    put,
    path = "/v1/server-config",
    request_body = Change,
    responses(
        (status = 200, body = ConfigSaved),
        (status = 409, description = "A key is decided by an environment variable, or a restart is under way", body = ConfigProblems),
        (status = 422, description = "The change was refused", body = ConfigProblems),
        (status = 404, description = "This backend has no server configuration", body = ErrorBody),
        (status = 503, description = "The settings file cannot be written", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn put_config(
    State(state): State<AppState>,
    Json(change): Json<Change>,
) -> Result<Response, ApiError> {
    let control = control(&state)?.clone();
    if control.restarting.load(Ordering::SeqCst) {
        return Ok(ConfigProblems::response(
            StatusCode::CONFLICT,
            vec!["The server is restarting; try again in a few seconds.".into()],
        ));
    }
    let worker = control.clone();
    let result = tokio::task::spawn_blocking(move || worker.admin.update(&change))
        .await
        .map_err(|_| ApiError::Internal)?;
    let update = match result {
        Ok(u) => u,
        Err(UpdateError::Invalid(problems)) => {
            return Ok(ConfigProblems::response(
                StatusCode::UNPROCESSABLE_ENTITY,
                problems,
            ))
        }
        Err(UpdateError::Locked(problems)) => {
            return Ok(ConfigProblems::response(StatusCode::CONFLICT, problems))
        }
        Err(UpdateError::Storage(m)) => {
            tracing::error!("cannot save the server settings: {m}");
            return Err(ApiError::Unavailable(m));
        }
    };
    let restarting = !update.changed.is_empty();
    if restarting && !control.restarting.swap(true, Ordering::SeqCst) {
        tracing::info!(changed = ?update.changed, "settings changed from the app; restarting");
        let restart = control.restart.clone();
        let delay = control.delay;
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            restart();
        });
    }
    Ok(Json(ConfigSaved {
        changed: update.changed,
        warnings: update.warnings,
        restarting,
    })
    .into_response())
}
