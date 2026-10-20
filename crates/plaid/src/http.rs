//! The only place that touches the network. Tests plug in [`crate::testing::FakePlaidHttp`].

use std::time::Duration;

use async_trait::async_trait;

use crate::PlaidError;

#[derive(Clone, PartialEq, Eq)]
pub struct HttpAnswer {
    pub status: u16,
    pub body: String,
}

impl std::fmt::Debug for HttpAnswer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpAnswer")
            .field("status", &self.status)
            .field("body_len", &self.body.len())
            .finish()
    }
}

#[async_trait]
pub trait PlaidHttp: Send + Sync {
    /// POST a JSON body. The body holds the client id and secret, so implementations must never
    /// log it.
    async fn post_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<HttpAnswer, PlaidError>;
}

/// The real thing: HTTPS with a sensible timeout.
pub struct ReqwestPlaidHttp {
    client: reqwest::Client,
}

impl ReqwestPlaidHttp {
    pub fn new() -> Result<Self, PlaidError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(40))
            .user_agent("financer/0.1 (personal finance app)")
            .build()
            .map_err(|e| PlaidError::Connection(e.to_string()))?;
        Ok(Self { client })
    }
}

#[async_trait]
impl PlaidHttp for ReqwestPlaidHttp {
    async fn post_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<HttpAnswer, PlaidError> {
        let res = self
            .client
            .post(url)
            .json(body)
            .send()
            .await
            // reqwest errors can include the url, never the body
            .map_err(|e| PlaidError::Connection(e.without_url().to_string()))?;
        let status = res.status().as_u16();
        let body = res
            .text()
            .await
            .map_err(|e| PlaidError::Connection(e.without_url().to_string()))?;
        Ok(HttpAnswer { status, body })
    }
}
