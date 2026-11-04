//! Kaufland Card receipts, the unofficial way: you sign in on Kaufland's own page, the server
//! keeps only the refresh token (encrypted), and reads your digital receipts with it.
//!
//! The protocol was worked out by the open-source project Bonfire (see [`consts`]); this is a
//! separate implementation. It is off by default and may stop working whenever Kaufland changes
//! anything. It reuses the sign-in building blocks of the Lidl Plus source (PKCE, the HTTP seam
//! and the token type).

pub mod client;
pub mod consts;
pub mod service;
pub mod transaction;

pub use client::{Endpoints, KauflandClient};
pub use service::{KauflandCard, StartInfo};
pub use transaction::Transaction;

use crate::lidl::LidlError;

/// What can go wrong talking to Kaufland or finishing a sign-in. The texts are shown to the user.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum KauflandError {
    #[error("Kaufland is set up wrongly: {0}")]
    Config(String),
    #[error("internal error: {0}")]
    Internal(String),
    #[error("that address cannot be used: {0}")]
    BadCallback(String),
    #[error("Kaufland's page reported: {0}")]
    SignInRefused(String),
    #[error("this sign-in is unknown or has expired; start again")]
    UnknownSignIn,
    #[error("cannot reach Kaufland: {0}")]
    Network(String),
    #[error("Kaufland answered with status {0}")]
    Status(u16),
    #[error("unexpected answer from Kaufland: {0}")]
    BadResponse(String),
    #[error("Kaufland no longer accepts the saved sign-in; sign in again")]
    NeedsSignIn,
    #[error("Kaufland is not connected")]
    NotConnected,
}

/// The shared sign-in helpers speak [`LidlError`]; their words carry over unchanged.
impl From<LidlError> for KauflandError {
    fn from(e: LidlError) -> Self {
        match e {
            LidlError::Config(s) => KauflandError::Config(s),
            LidlError::Internal(s) => KauflandError::Internal(s),
            LidlError::BadCallback(s) => KauflandError::BadCallback(s),
            LidlError::SignInRefused(s) => KauflandError::SignInRefused(s),
            LidlError::UnknownSignIn => KauflandError::UnknownSignIn,
            LidlError::Network(s) => KauflandError::Network(s),
            LidlError::Status(s) => KauflandError::Status(s),
            LidlError::BadResponse(s) => KauflandError::BadResponse(s),
            LidlError::NeedsSignIn => KauflandError::NeedsSignIn,
            LidlError::NotConnected => KauflandError::NotConnected,
        }
    }
}
