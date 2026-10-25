use std::fmt;

/// What can go wrong when talking to Plaid. Messages never contain tokens or secrets.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlaidError {
    #[error("Plaid is not configured on the server (bank.plaid in financer.toml, see docs/BANK_PROVIDERS.md)")]
    NotConfigured,
    #[error("could not reach Plaid: {0}")]
    Connection(String),
    #[error("Plaid sent an answer this app does not understand: {0}")]
    Unreadable(String),
    #[error("{0}")]
    Api(ApiError),
}

/// An error answer of the Plaid API (`error_type`, `error_code`, `error_message`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub status: u16,
    pub kind: String,
    pub code: String,
    pub message: String,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Plaid refused the request ({}): {}",
            self.code,
            self.message.chars().take(300).collect::<String>()
        )
    }
}

impl PlaidError {
    /// The bank wants you to sign in again (password changed, consent expired): link once more.
    pub fn needs_relink(&self) -> bool {
        matches!(self, PlaidError::Api(a) if a.code == "ITEM_LOGIN_REQUIRED"
            || a.code == "INVALID_ACCESS_TOKEN"
            || a.code == "ITEM_NOT_FOUND"
            || a.code == "PENDING_EXPIRATION")
    }

    /// Plaid has not finished its first read of the bank yet: try again in a little while.
    pub fn not_ready(&self) -> bool {
        matches!(self, PlaidError::Api(a) if a.code == "PRODUCT_NOT_READY")
    }

    /// The server's Plaid keys are wrong.
    pub fn bad_keys(&self) -> bool {
        matches!(self, PlaidError::Api(a) if a.code == "INVALID_API_KEYS"
            || a.code == "INVALID_CLIENT_ID"
            || a.code == "INVALID_SECRET")
    }

    /// The data changed while paging; start the page again from the saved cursor.
    pub fn mutated_during_paging(&self) -> bool {
        matches!(self, PlaidError::Api(a) if a.code == "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")
    }
}
