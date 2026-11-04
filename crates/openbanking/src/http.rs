//! The only place that touches the network. Tests plug in [`crate::testing::FakeHttp`].

use std::time::Duration;

use async_trait::async_trait;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Delete,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Delete => "DELETE",
        }
    }
}

#[derive(Clone)]
pub enum Body {
    None,
    Json(serde_json::Value),
    Form(Vec<(String, String)>),
}

/// One call. Bodies and the `bearer` token hold secrets, so implementations must never log them.
#[derive(Clone)]
pub struct Request {
    pub method: Method,
    pub url: String,
    pub bearer: Option<String>,
    pub body: Body,
}

impl Request {
    pub fn get(url: impl Into<String>, bearer: Option<&str>) -> Self {
        Self {
            method: Method::Get,
            url: url.into(),
            bearer: bearer.map(str::to_string),
            body: Body::None,
        }
    }

    pub fn post_json(
        url: impl Into<String>,
        bearer: Option<&str>,
        body: serde_json::Value,
    ) -> Self {
        Self {
            method: Method::Post,
            url: url.into(),
            bearer: bearer.map(str::to_string),
            body: Body::Json(body),
        }
    }

    pub fn post_form(url: impl Into<String>, fields: Vec<(String, String)>) -> Self {
        Self {
            method: Method::Post,
            url: url.into(),
            bearer: None,
            body: Body::Form(fields),
        }
    }

    pub fn delete(url: impl Into<String>, bearer: Option<&str>) -> Self {
        Self {
            method: Method::Delete,
            url: url.into(),
            bearer: bearer.map(str::to_string),
            body: Body::None,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct Answer {
    pub status: u16,
    pub body: String,
}

impl std::fmt::Debug for Answer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Answer")
            .field("status", &self.status)
            .field("body_len", &self.body.len())
            .finish()
    }
}

#[async_trait]
pub trait OpenHttp: Send + Sync {
    /// `Err` holds a message without the address or any secret.
    async fn send(&self, request: Request) -> Result<Answer, String>;
}

/// The real thing: HTTPS with a sensible timeout.
pub struct ReqwestHttp {
    client: reqwest::Client,
}

impl ReqwestHttp {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(40))
            .user_agent("financer/0.1 (personal finance app)")
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { client })
    }
}

#[async_trait]
impl OpenHttp for ReqwestHttp {
    async fn send(&self, request: Request) -> Result<Answer, String> {
        let mut builder = match request.method {
            Method::Get => self.client.get(&request.url),
            Method::Post => self.client.post(&request.url),
            Method::Delete => self.client.delete(&request.url),
        };
        if let Some(token) = &request.bearer {
            builder = builder.bearer_auth(token);
        }
        builder = match &request.body {
            Body::None => builder,
            Body::Json(v) => builder.json(v),
            Body::Form(fields) => builder.form(fields),
        };
        let res = builder
            .send()
            .await
            // reqwest errors can include the url, never the body
            .map_err(|e| e.without_url().to_string())?;
        let status = res.status().as_u16();
        let body = res.text().await.map_err(|e| e.without_url().to_string())?;
        Ok(Answer { status, body })
    }
}
