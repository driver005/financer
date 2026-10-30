//! Bearer-token check for the standalone server. In the bundled server the finance API's own
//! check already covers these routes.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

const MAX_FAILURES: usize = 20;
const WINDOW: Duration = Duration::from_secs(60);
const LOCKOUT: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct ShopToken {
    hash: Arc<[u8; 32]>,
    failures: Arc<Mutex<(VecDeque<Instant>, Option<Instant>)>>,
}

impl ShopToken {
    pub fn new(token: &str) -> ShopToken {
        ShopToken {
            hash: Arc::new(Sha256::digest(token.as_bytes()).into()),
            failures: Arc::new(Mutex::new((VecDeque::new(), None))),
        }
    }

    fn matches(&self, presented: &str) -> bool {
        let digest: [u8; 32] = Sha256::digest(presented.as_bytes()).into();
        digest.ct_eq(&*self.hash).into()
    }

    fn locked(&self) -> bool {
        let mut g = self.failures.lock().expect("limiter lock");
        match g.1 {
            Some(until) if until > Instant::now() => true,
            Some(_) => {
                *g = (VecDeque::new(), None);
                false
            }
            None => false,
        }
    }

    fn fail(&self) {
        let mut g = self.failures.lock().expect("limiter lock");
        let now = Instant::now();
        g.0.push_back(now);
        while g.0.front().is_some_and(|t| now.duration_since(*t) > WINDOW) {
            g.0.pop_front();
        }
        if g.0.len() > MAX_FAILURES {
            g.1 = Some(now + LOCKOUT);
        }
    }
}

pub async fn require(State(token): State<ShopToken>, req: Request, next: Next) -> Response {
    if token.locked() {
        return (StatusCode::TOO_MANY_REQUESTS, "too many failed attempts").into_response();
    }
    let presented = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match presented {
        Some(t) if token.matches(t) => next.run(req).await,
        _ => {
            token.fail();
            StatusCode::UNAUTHORIZED.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_right_token_matches_and_many_failures_lock() {
        let t = ShopToken::new("s3cret");
        assert!(t.matches("s3cret") && !t.matches("s3cret ") && !t.matches(""));
        assert!(!t.locked());
        for _ in 0..=MAX_FAILURES {
            t.fail();
        }
        assert!(t.locked());
    }
}
