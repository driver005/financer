//! Automatic receipt import for Financer: three sources (an IMAP mailbox, the Lidl Plus
//! account via Lidl's own sign-in page, a watched folder) feed one store of receipts, so that
//! "what I normally buy" and per-store spending have item-level data.
//!
//! Everything that talks to the outside world sits behind a trait ([`mail::Mailbox`],
//! [`lidl::LidlApi`]); the tests use fakes with real-looking data, and nothing in this crate
//! was ever run against a real mailbox or retailer.

pub mod brand;
pub mod config;
pub mod docs;
pub mod email;
pub mod error;
pub mod folder;
pub mod ingest;
pub mod lidl;
pub mod mail;
pub mod matching;
pub mod message;
pub mod reader;
pub mod secret;
pub mod summary;
pub mod syncer;
pub mod testing;
pub mod text;

pub use config::{
    EmailConfig, FolderConfig, LidlPlusConfig, OnDone, ReceiptSourcesConfig, SenderRule,
    SourceKind,
};
pub use reader::{ReadError, ReadReceipt, ReceiptReader, Trust};
pub use ingest::{Ingest, Stored};
pub use matching::{Linker, Matcher};
pub use secret::SecretBox;
pub use syncer::{
    ReceiptSyncer, SourceHealth, SourceStatus, SyncDeps, SyncNowError, SyncReport,
};
