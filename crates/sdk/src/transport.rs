//! How a request reaches the server. The SDK builds the request and reads the answer; a transport
//! only carries the bytes. The network one is [`HttpTransport`]; the app that runs the backend inside
//! the phone, and the tests, pass one that calls the server's router in the same process.

use async_trait::async_trait;

use crate::error::SdkError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    /// Path and query, e.g. `/v1/mail/conversations?by=topic`.
    pub path: String,
    /// A body, if there is one (JSON unless `content_type` says otherwise).
    pub body: Option<Vec<u8>>,
    /// The body's type when it is not JSON (`text/csv` for a bank export).
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

/// The browser's futures are not `Send`; everywhere else they are.
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
pub trait Transport: Send + Sync {
    async fn send(&self, request: Request) -> Result<Response, SdkError>;
}

/// The server over the network, with the bearer token.
#[cfg(feature = "http")]
pub struct HttpTransport {
    base: String,
    token: String,
    client: reqwest::Client,
}

#[cfg(feature = "http")]
impl HttpTransport {
    pub fn new(base_url: &str, token: &str) -> HttpTransport {
        HttpTransport {
            base: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
            client: reqwest::Client::new(),
        }
    }

    /// Server text without the token, short enough for a screen.
    fn clean(&self, e: impl std::fmt::Display) -> String {
        let mut s = e.to_string();
        if self.token.len() >= 4 {
            s = s.replace(&self.token, "***");
        }
        s.chars().take(200).collect()
    }
}

#[cfg(feature = "http")]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl Transport for HttpTransport {
    async fn send(&self, request: Request) -> Result<Response, SdkError> {
        let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| {
            SdkError::Network {
                message: format!("{:?} is not an HTTP method", request.method),
            }
        })?;
        let mut builder = self
            .client
            .request(method, format!("{}{}", self.base, request.path))
            .bearer_auth(&self.token);
        if let Some(body) = request.body {
            builder = builder
                .header("Content-Type", "application/json")
                .body(body);
        }
        let res = builder.send().await.map_err(|e| SdkError::Network {
            message: self.clean(e),
        })?;
        let status = res.status().as_u16();
        let body = res
            .bytes()
            .await
            .map_err(|e| SdkError::Network {
                message: self.clean(e),
            })?
            .to_vec();
        Ok(Response { status, body })
    }
}
