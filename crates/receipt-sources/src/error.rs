use financer_store::StoreError;

/// Why a source run failed. The text is shown to the user, so it never carries secrets.
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("database error: {0}")]
    Store(#[from] StoreError),
    #[error("{0}")]
    Other(String),
}

impl SyncError {
    pub fn other(msg: impl Into<String>) -> Self {
        SyncError::Other(msg.into())
    }

    /// At most 300 characters, one line.
    pub fn to_user_text(&self) -> String {
        self.to_string()
            .replace('\n', " ")
            .chars()
            .take(300)
            .collect()
    }
}
