use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::time::Instant;

/// More than this many wrong tokens within [`WINDOW`] locks the API for [`LOCKOUT`].
const MAX_FAILURES: usize = 20;
const WINDOW: Duration = Duration::from_secs(60);
const LOCKOUT: Duration = Duration::from_secs(60);

struct Limiter {
    failures: VecDeque<Instant>,
    locked_until: Option<Instant>,
}

/// SHA-256 of the API token plus a failure limiter. Only the hash is kept in memory; the token
/// itself is never stored by the server.
///
/// The limit is global, not per client: behind a reverse proxy every request has the proxy's
/// address, and there is a single user. The cost is that someone who spams wrong tokens can lock
/// you out for a minute at a time; with a 32+ character random token guessing is hopeless
/// either way, so this exists to bound the work and the log noise.
#[derive(Clone)]
pub struct TokenHash {
    hash: Arc<[u8; 32]>,
    limiter: Arc<Mutex<Limiter>>,
}

impl TokenHash {
    pub fn new(token: &str) -> Self {
        TokenHash {
            hash: Arc::new(Sha256::digest(token.as_bytes()).into()),
            limiter: Arc::new(Mutex::new(Limiter {
                failures: VecDeque::new(),
                locked_until: None,
            })),
        }
    }

    fn matches(&self, presented: &str) -> bool {
        let digest: [u8; 32] = Sha256::digest(presented.as_bytes()).into();
        digest.ct_eq(&*self.hash).into()
    }

    /// Seconds until the lock ends, if locked.
    fn locked_for(&self) -> Option<u64> {
        let mut l = self.limiter.lock().expect("limiter lock");
        let now = Instant::now();
        match l.locked_until {
            Some(until) if until > now => Some((until - now).as_secs() + 1),
            Some(_) => {
                l.locked_until = None;
                l.failures.clear();
                None
            }
            None => None,
        }
    }

    fn record_failure(&self) {
        let mut l = self.limiter.lock().expect("limiter lock");
        let now = Instant::now();
        l.failures.push_back(now);
        while l
            .failures
            .front()
            .is_some_and(|t| now.duration_since(*t) > WINDOW)
        {
            l.failures.pop_front();
        }
        if l.failures.len() > MAX_FAILURES {
            l.locked_until = Some(now + LOCKOUT);
        }
    }
}

/// The bearer-token middleware.
pub struct TokenAuth;

impl TokenAuth {
    /// Rejects every request without `Authorization: Bearer <token>`; answers 429 while locked out.
    pub async fn require(State(expected): State<TokenHash>, req: Request, next: Next) -> Response {
        if let Some(wait) = expected.locked_for() {
            let mut res =
                (StatusCode::TOO_MANY_REQUESTS, "too many failed attempts").into_response();
            if let Ok(v) = HeaderValue::from_str(&wait.to_string()) {
                res.headers_mut().insert(header::RETRY_AFTER, v);
            }
            return res;
        }
        let presented = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        match presented {
            Some(token) if expected.matches(token) => next.run(req).await,
            _ => {
                expected.record_failure();
                StatusCode::UNAUTHORIZED.into_response()
            }
        }
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

    #[tokio::test(start_paused = true)]
    async fn locks_after_too_many_failures_and_recovers() {
        let h = TokenHash::new("t");
        for _ in 0..MAX_FAILURES {
            h.record_failure();
            assert!(
                h.locked_for().is_none(),
                "must not lock before the limit is exceeded"
            );
        }
        h.record_failure();
        let wait = h.locked_for().expect("locked after exceeding the limit");
        assert!((1..=LOCKOUT.as_secs() + 1).contains(&wait));

        tokio::time::advance(LOCKOUT + Duration::from_secs(1)).await;
        assert!(h.locked_for().is_none(), "lock ends by itself");
        h.record_failure();
        assert!(
            h.locked_for().is_none(),
            "counter starts fresh after a lock"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn old_failures_age_out_of_the_window() {
        let h = TokenHash::new("t");
        for _ in 0..MAX_FAILURES {
            h.record_failure();
        }
        tokio::time::advance(WINDOW + Duration::from_secs(1)).await;
        for _ in 0..MAX_FAILURES {
            h.record_failure();
        }
        assert!(
            h.locked_for().is_none(),
            "failures spread over more than a window must not lock"
        );
    }
}
