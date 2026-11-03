//! A client for any call to the server: the request goes in as method, path and bytes, the answer
//! comes back as status and bytes. The finance app and the shopping assistant use it for all their
//! traffic (their typed TypeScript clients decide what to ask and read the answer); mail has typed
//! calls of its own ([`crate::mail::MailSdk`]). Either way the network, TLS and the token are handled
//! here, in Rust.

use std::sync::Arc;

use crate::error::SdkError;
use crate::transport::{Request, Transport};

/// One request, as bytes.
#[derive(Debug, Clone, uniffi::Record)]
pub struct RawRequest {
    pub method: String,
    /// Path and query, e.g. `/v1/transactions?x=1`.
    pub path: String,
    /// The type of the body when it is not JSON (`text/csv`).
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

/// An answer, whatever its status: a refusal is for the caller to read, not an error here. Only
/// not reaching the server is an error ([`SdkError::Network`]).
#[derive(Debug, Clone, uniffi::Record)]
pub struct RawResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

#[derive(uniffi::Object)]
pub struct ApiClient {
    transport: Arc<dyn Transport>,
}

impl ApiClient {
    pub fn with_transport(transport: Arc<dyn Transport>) -> Arc<ApiClient> {
        Arc::new(ApiClient { transport })
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl ApiClient {
    /// A client of the server at `base_url`, logged in with its token.
    #[cfg(feature = "http")]
    #[uniffi::constructor]
    pub fn new(base_url: String, token: String) -> Arc<ApiClient> {
        ApiClient::with_transport(Arc::new(crate::transport::HttpTransport::new(
            &base_url, &token,
        )))
    }

    pub async fn send(&self, request: RawRequest) -> Result<RawResponse, SdkError> {
        let res = self
            .transport
            .send(Request {
                method: request.method,
                path: request.path,
                body: (!request.body.is_empty()).then_some(request.body),
                content_type: request.content_type,
            })
            .await?;
        Ok(RawResponse {
            status: res.status,
            body: res.body,
        })
    }

    /// Whether the server answers at `/health` (open, no token needed).
    pub async fn health(&self) -> bool {
        matches!(
            self.transport.send(Request { method: "GET".into(), path: "/health".into(), body: None, content_type: None }).await,
            Ok(r) if (200..300).contains(&r.status)
        )
    }
}
