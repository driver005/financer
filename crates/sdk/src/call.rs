//! What every typed call does the same way: build the request, carry it, turn a refusal into an
//! error with the server's reasons, and read the answer.

use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::SdkError;
use crate::transport::{Request, Transport};

/// Percent-encodes a value for a path segment or a query value.
pub(crate) fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `?a=1&b=2` from the pairs that have a value, or nothing.
pub(crate) fn query(pairs: &[(&str, Option<String>)]) -> String {
    let parts: Vec<String> = pairs
        .iter()
        .filter_map(|(k, v)| {
            v.as_ref()
                .filter(|v| !v.is_empty())
                .map(|v| format!("{k}={}", encode(v)))
        })
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!("?{}", parts.join("&"))
    }
}

#[derive(Clone)]
pub(crate) struct Caller {
    transport: Arc<dyn Transport>,
}

impl Caller {
    pub(crate) fn new(transport: Arc<dyn Transport>) -> Caller {
        Caller { transport }
    }

    async fn send(
        &self,
        method: &str,
        path: String,
        body: Option<Vec<u8>>,
        content_type: Option<String>,
    ) -> Result<Vec<u8>, SdkError> {
        let res = self
            .transport
            .send(Request {
                method: method.to_string(),
                path,
                body,
                content_type,
            })
            .await?;
        if !(200..300).contains(&res.status) {
            return Err(SdkError::from_response(res.status, &res.body));
        }
        Ok(res.body)
    }

    /// A call with a JSON body (or none).
    pub(crate) async fn json(
        &self,
        method: &str,
        path: String,
        body: Option<&impl Serialize>,
    ) -> Result<Vec<u8>, SdkError> {
        let body = match body {
            Some(b) => Some(serde_json::to_vec(b).map_err(|e| SdkError::Decode {
                message: e.to_string(),
            })?),
            None => None,
        };
        self.send(method, path, body, None).await
    }

    /// A call whose body is bytes of another type (a bank's CSV export).
    pub(crate) async fn raw(
        &self,
        method: &str,
        path: String,
        content_type: &str,
        body: Vec<u8>,
    ) -> Result<Vec<u8>, SdkError> {
        self.send(method, path, Some(body), Some(content_type.to_string()))
            .await
    }

    pub(crate) fn decode<T: DeserializeOwned>(&self, bytes: Vec<u8>) -> Result<T, SdkError> {
        serde_json::from_slice(&bytes).map_err(|e| SdkError::Decode {
            message: e.to_string(),
        })
    }
}

/// The arguments of a [`dispatch`](crate::FinanceSdk::dispatch) call: a JSON object, or nothing.
pub(crate) fn parse_args<T: DeserializeOwned>(args: &str) -> Result<T, SdkError> {
    let args = if args.trim().is_empty() { "{}" } else { args };
    serde_json::from_str(args).map_err(|e| SdkError::Decode {
        message: format!("the arguments were not understood: {e}"),
    })
}

/// The server's answer as it wrote it, after checking that it is what this SDK expects.
pub(crate) fn answer<T: DeserializeOwned>(raw: Vec<u8>) -> Result<String, SdkError> {
    serde_json::from_slice::<T>(&raw).map_err(|e| SdkError::Decode {
        message: e.to_string(),
    })?;
    String::from_utf8(raw).map_err(|e| SdkError::Decode {
        message: e.to_string(),
    })
}

/// A typed answer as JSON text (the calls whose record types are the wire shape).
pub(crate) fn to_json<T: Serialize>(value: &T) -> Result<String, SdkError> {
    serde_json::to_string(value).map_err(|e| SdkError::Decode {
        message: e.to_string(),
    })
}
