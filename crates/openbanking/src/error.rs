use std::fmt;

/// What can go wrong with any provider. The texts never contain keys, tokens, passwords or PINs.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OpenError {
    /// The provider is not set up on the server; the text says where.
    #[error("{0}")]
    NotConfigured(String),
    /// The bank refused the login (wrong PIN, locked access). Nothing retries after this by itself.
    #[error("{message}")]
    Refused { message: String, locked: bool },
    /// The request was refused as it is (an unsupported approval method, a bad file).
    #[error("{0}")]
    Rejected(String),
    /// Too many failed logins in a row: syncing is paused to keep online banking from locking.
    #[error("syncing is paused for about {minutes} more minute(s) after failed logins, to keep your online banking from being locked. Check your PIN and login first")]
    Paused { minutes: u64 },
    /// The bank or the service could not be reached or failed; the text is shown as it is.
    #[error("{0}")]
    Upstream(String),
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

/// What kind of refusal an API answer was, as far as the app has to treat it differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ErrorKind {
    #[default]
    Other,
    /// The stored access is no longer valid (consent expired or withdrawn, user gone): sign in again.
    Relink,
    /// The server's own keys were refused.
    BadKeys,
    /// The provider has not finished its first read of the bank yet: try again in a little while.
    NotReady,
    /// Too many requests: try again later.
    RateLimited,
}

/// An error answer of a provider's API.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub provider: &'static str,
    pub status: u16,
    pub code: String,
    pub message: String,
    pub kind: ErrorKind,
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
    pub fn connection(provider: &'static str, message: impl ToString) -> Self {
        OpenError::Connection {
            provider,
            message: message.to_string(),
        }
    }

    pub fn unreadable(provider: &'static str, message: impl ToString) -> Self {
        OpenError::Unreadable {
            provider,
            message: message.to_string(),
        }
    }

    fn kind(&self) -> ErrorKind {
        match self {
            OpenError::Api(a) => a.kind,
            _ => ErrorKind::Other,
        }
    }

    /// The stored access is no longer valid: sign in again.
    pub fn needs_relink(&self) -> bool {
        self.kind() == ErrorKind::Relink
    }

    /// The server's own keys were refused.
    pub fn bad_keys(&self) -> bool {
        self.kind() == ErrorKind::BadKeys
    }

    /// The provider is still reading the bank for the first time.
    pub fn not_ready(&self) -> bool {
        self.kind() == ErrorKind::NotReady
    }

    /// Too many requests: try again later.
    pub fn rate_limited(&self) -> bool {
        self.kind() == ErrorKind::RateLimited
    }

    /// The bank refused the login: nothing retries by itself until you sync by hand.
    pub fn refused(&self) -> bool {
        matches!(self, OpenError::Refused { .. })
    }

    /// Syncing is paused after repeated wrong PINs.
    pub fn paused(&self) -> bool {
        matches!(self, OpenError::Paused { .. })
    }
}
