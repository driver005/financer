//! Plaid as a bank connection provider.
//!
//! Plaid works differently from FinTS: there is no PIN and no approval per sync. You sign in to
//! your bank once on Plaid's own page ("hosted link"), the server swaps the result for an access
//! token and keeps that (sealed), and from then on it reads new transactions by cursor whenever it
//! is asked. All network access goes through [`PlaidHttp`], so tests run without a network.

pub mod client;
pub mod error;
pub mod http;
pub mod map;
pub mod testing;
pub mod types;

pub use client::{PlaidClient, PlaidConfig, PlaidEnvironment};
pub use error::PlaidError;
pub use http::{PlaidHttp, ReqwestPlaidHttp};
pub use types::{
    AccountBalance, Exchange, LinkRequest, LinkSession, LinkToken, SyncOutcome, SyncRequest,
};
