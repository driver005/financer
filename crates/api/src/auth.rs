use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// SHA-256 of the API token. Only the hash is kept in memory; the token itself is never
/// stored by the server.
#[derive(Clone)]
pub struct TokenHash(Arc<[u8; 32]>);

impl TokenHash {
    pub fn new(token: &str) -> Self {
        TokenHash(Arc::new(Sha256::digest(token.as_bytes()).into()))
    }

    fn matches(&self, presented: &str) -> bool {
        let digest: [u8; 32] = Sha256::digest(presented.as_bytes()).into();
        digest.ct_eq(&*self.0).into()
    }
}

/// Rejects every request without `Authorization: Bearer <token>`.
pub async fn require_token(
    State(expected): State<TokenHash>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let presented = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match presented {
        Some(token) if expected.matches(token) => Ok(next.run(req).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_only_the_right_token() {
        let h = TokenHash::new("s3cret-token");
        assert!(h.matches("s3cret-token"));
        assert!(!h.matches("s3cret-token "));
        assert!(!h.matches(""));
    }
}
