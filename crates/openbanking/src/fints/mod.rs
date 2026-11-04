//! FinTS (your bank directly): a PIN, and an approval in the banking app for every sync.

pub mod bank;
#[cfg(feature = "live")]
pub mod live;
pub mod provider;

pub use bank::{
    BankClient, BankData, BankError, MockBank, PendingSync, SyncParams, TanChallenge,
    UnconfiguredBank,
};
#[cfg(feature = "live")]
pub use live::FintsBank;
pub use provider::{FintsProvider, DEFAULT_PIN_PAUSE};
