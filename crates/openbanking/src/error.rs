use std::fmt;

/// What can go wrong when talking to an aggregator. Messages never contain keys, tokens or
/// passwords.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OpenError {
    #[error("could not reach {provider}: {message}")]
    Connection {
        provider: &'static str,
        message: String,
    },
    #[error("{provider} sent an answer this app does not understand: {message}")]
    Unreadable {
        provider: &'static str,
        message: String,
    },
    #[error("{0}")]
    Api(ApiError),
    /// The sign-in was rejected, expired or aborted on the provider's page.
    #[error("{provider}: {message}")]
    LinkFailed {
        provider: &'static str,
        message: String,
    },
}

/// An error answer of the provider's API.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub provider: &'static str,
    pub status: u16,
    pub code: String,
    pub message: String,
    /// The call that failed was the one that trades the server's own keys for a token.
    pub keys_rejected: bool,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} refused the request ({}): {}",
            self.provider,
            if self.code.is_empty() {
                format!("HTTP {}", self.status)
            } else {
                self.code.clone()
            },
            self.message.chars().take(300).collect::<String>()
        )
    }
}

impl OpenError {
    pub(crate) fn connection(provider: &'static str, message: impl ToString) -> Self {
        OpenError::Connection {
            provider,
            message: message.to_string(),
        }
    }

    pub(crate) fn unreadable(provider: &'static str, message: impl ToString) -> Self {
        OpenError::Unreadable {
            provider,
            message: message.to_string(),
        }
    }

    /// The stored access is no longer valid (consent expired or withdrawn, user gone): sign in
    /// again.
    pub fn needs_relink(&self) -> bool {
        matches!(self, OpenError::Api(a) if !a.keys_rejected && matches!(a.status, 401 | 403 | 404 | 410))
    }

    /// The server's own keys were refused.
    pub fn bad_keys(&self) -> bool {
        matches!(self, OpenError::Api(a) if a.keys_rejected)
    }

    /// Too many requests: try again later.
    pub fn rate_limited(&self) -> bool {
        matches!(self, OpenError::Api(a) if a.status == 429)
    }
}
