//! All network access of the Lidl Plus source goes through [`LidlHttp`]. Tests plug in a fake;
//! only the real server builds [`ReqwestLidlHttp`].

use std::time::Duration;

use async_trait::async_trait;

use super::LidlError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

#[derive(Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    /// `application/x-www-form-urlencoded` body, for POST.
    pub form: Vec<(String, String)>,
}

impl std::fmt::Debug for HttpRequest {
    /// Headers and form values carry tokens: never printed.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpRequest")
            .field("method", &self.method)
            .field("url", &self.url)
            .field("headers", &self.headers.iter().map(|(k, _)| k).collect::<Vec<_>>())
            .field("form", &self.form.iter().map(|(k, _)| k).collect::<Vec<_>>())
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

impl std::fmt::Debug for HttpResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpResponse")
            .field("status", &self.status)
            .field("body_len", &self.body.len())
            .finish()
    }
}

#[async_trait]
pub trait LidlHttp: Send + Sync {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, LidlError>;
}

/// Largest response read.
const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

pub struct ReqwestLidlHttp {
    client: reqwest::Client,
}

impl ReqwestLidlHttp {
    pub fn new(user_agent: &str) -> Result<Self, LidlError> {
        let client = reqwest::Client::builder()
            .user_agent(user_agent)
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| LidlError::Internal(e.to_string()))?;
        Ok(ReqwestLidlHttp { client })
    }
}

#[async_trait]
impl LidlHttp for ReqwestLidlHttp {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, LidlError> {
        let mut b = match req.method {
            Method::Get => self.client.get(&req.url),
            Method::Post => self
                .client
                .post(&req.url)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(
                    url::form_urlencoded::Serializer::new(String::new())
                        .extend_pairs(&req.form)
                        .finish(),
                ),
        };
        for (k, v) in &req.headers {
            b = b.header(k, v);
        }
        let res = b
            .send()
            .await
            // the error text can contain the URL but never headers or the form
            .map_err(|e| LidlError::Network(e.without_url().to_string()))?;
        let status = res.status().as_u16();
        let bytes = res
            .bytes()
            .await
            .map_err(|e| LidlError::Network(e.without_url().to_string()))?;
        if bytes.len() > MAX_BODY_BYTES {
            return Err(LidlError::BadResponse("the answer is unexpectedly large".into()));
        }
        Ok(HttpResponse {
            status,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        })
    }
}
