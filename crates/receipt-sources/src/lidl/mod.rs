//! Lidl Plus receipts, the unofficial way: you sign in on Lidl's own page, the server keeps only
//! the refresh token (encrypted), and reads your receipts with it.
//!
//! The protocol was worked out by the open-source client <https://github.com/Andre0512/lidl-plus>;
//! this is a separate implementation (see [`consts`]). It is off by default and may stop working
//! whenever Lidl changes anything.

pub mod client;
pub mod consts;
pub mod http;
pub mod pkce;
pub mod service;
pub mod ticket;

pub use client::{Endpoints, LidlClient, Tokens};
pub use http::{HttpRequest, HttpResponse, LidlHttp, Method, ReqwestLidlHttp};
pub use service::{Connection, LidlPlus, StartInfo};
pub use ticket::{Ticket, TicketItem, TicketSummary};

/// What can go wrong talking to Lidl or finishing a sign-in. The texts are shown to the user.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LidlError {
    #[error("Lidl Plus is set up wrongly: {0}")]
    Config(String),
    #[error("internal error: {0}")]
    Internal(String),
    #[error("that address cannot be used: {0}")]
    BadCallback(String),
    #[error("Lidl's page reported: {0}")]
    SignInRefused(String),
    #[error("this sign-in is unknown or has expired; start again")]
    UnknownSignIn,
    #[error("cannot reach Lidl: {0}")]
    Network(String),
    #[error("Lidl answered with status {0}")]
    Status(u16),
    #[error("unexpected answer from Lidl: {0}")]
    BadResponse(String),
    #[error("Lidl no longer accepts the saved sign-in; sign in again")]
    NeedsSignIn,
    #[error("Lidl Plus is not connected")]
    NotConnected,
}
