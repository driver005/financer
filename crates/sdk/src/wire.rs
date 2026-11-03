//! The one object the apps hold: a server connection that answers every call of the finance API,
//! the shopping assistant and the mail client by name.
//!
//! The arguments go in as a JSON object and the answer comes back as JSON text, the shapes the
//! server itself speaks (`snake_case`, numbers as numbers), so the screens read them as they always
//! did. What is *not* left to the app is everything else: which path and verb a call uses, how the
//! values are encoded, whether the answer is what this SDK expects, how a refusal is read, and the
//! network with its token. Every call passes through the typed records of this crate.

use std::sync::Arc;

use crate::error::SdkError;
use crate::finance::FinanceSdk;
use crate::mail::MailSdk;
use crate::shop::ShopSdk;
use crate::transport::{Request, Transport};

#[derive(uniffi::Object)]
pub struct Wire {
    transport: Arc<dyn Transport>,
    finance: Arc<FinanceSdk>,
    shop: Arc<ShopSdk>,
    mail: Arc<MailSdk>,
}

impl Wire {
    /// A connection that carries its requests with `transport` (the server's router, in tests).
    pub fn with_transport(transport: Arc<dyn Transport>) -> Arc<Wire> {
        Arc::new(Wire {
            finance: FinanceSdk::with_transport(transport.clone()),
            shop: ShopSdk::with_transport(transport.clone()),
            mail: MailSdk::with_transport(transport.clone()),
            transport,
        })
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl Wire {
    /// The server at `base_url`, logged in with its token.
    #[cfg(feature = "http")]
    #[uniffi::constructor]
    pub fn new(base_url: String, token: String) -> Arc<Wire> {
        Wire::with_transport(Arc::new(crate::transport::HttpTransport::new(
            &base_url, &token,
        )))
    }

    /// One call: `app` is `finance`, `shop` or `mail`; `op` names the call; `args` is a JSON object.
    /// The answer is JSON text (`null` for a call that answers nothing). A refusal is an
    /// [`SdkError::Api`] with the server's words; not reaching the server is [`SdkError::Network`].
    pub async fn call(&self, app: String, op: String, args: String) -> Result<String, SdkError> {
        match app.as_str() {
            "finance" => self.finance.dispatch(&op, &args).await,
            "shop" => self.shop.dispatch(&op, &args).await,
            "mail" => self.mail.dispatch(&op, &args).await,
            other => Err(SdkError::Decode {
                message: format!("unknown app {other}"),
            }),
        }
    }

    /// Whether the server answers at `/health` (open, no token needed).
    pub async fn health(&self) -> bool {
        matches!(
            self.transport
                .send(Request {
                    method: "GET".into(),
                    path: "/health".into(),
                    body: None,
                    content_type: None,
                })
                .await,
            Ok(r) if (200..300).contains(&r.status)
        )
    }
}
