//! Every way transactions come in, behind one [`Provider`] trait: your online banking's CSV file,
//! FinTS (your bank directly), Plaid, GoCardless Bank Account Data and finAPI.
//!
//! The app and the API talk to all of them the same way. A provider has a [`Flow`]:
//!
//! - **File** ([`ProviderKind::Csv`]): `import` reads a file.
//! - **Approval** ([`ProviderKind::Fints`]): `begin` logs in and asks for an approval in the banking
//!   app, `poll` waits for it and brings the data.
//! - **Link** (Plaid, GoCardless, finAPI): `begin` returns a page to sign in on, `poll` waits until
//!   you are done and hands over a credential, which later `fetch` calls use.
//!
//! All network access goes through [`OpenHttp`], so tests run without a network.

pub mod error;
pub mod finapi;
pub mod fints;
pub mod gocardless;
pub mod http;
pub mod plaid;
pub mod sparkasse_csv;
pub mod testing;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;

pub use error::{ApiError, ErrorKind, OpenError};
pub use finapi::{Finapi, FinapiConfig, FinapiEnvironment};
pub use fints::FintsProvider;
pub use gocardless::{GoCardless, GoCardlessConfig};
pub use http::{OpenHttp, ReqwestHttp};
pub use plaid::{PlaidConfig, PlaidEnvironment, PlaidProvider};
pub use sparkasse_csv::{CsvProvider, SparkasseCsv};
pub use types::{
    BeginRequest, FetchRequest, Fetched, Flow, LinkedAccount, Login, Parsed, Poll, ProviderKind,
    SkippedRow, Step,
};

#[async_trait]
pub trait Provider: Send + Sync {
    fn kind(&self) -> ProviderKind;

    /// Start a sign-in or a sync; see [`Step`].
    async fn begin(&self, _req: &BeginRequest) -> Result<Step, OpenError> {
        Err(self.unsupported("signing in"))
    }

    /// Has the person finished? Poll every few seconds after [`Provider::begin`].
    async fn poll(&self, _session: &str) -> Result<Poll, OpenError> {
        Err(self.unsupported("signing in"))
    }

    /// Read balance, accounts and transactions with a credential from [`Poll::Linked`].
    async fn fetch(&self, _req: &FetchRequest) -> Result<Fetched, OpenError> {
        Err(self.unsupported("reading with a stored credential"))
    }

    /// Read a file that was handed over.
    async fn import(&self, _bytes: &[u8]) -> Result<Parsed, OpenError> {
        Err(self.unsupported("importing a file"))
    }

    /// The person gave up on a started sign-in or approval: forget its session.
    async fn cancel(&self, _session: &str) {}

    /// Tell the provider to drop the connection. Best effort.
    async fn revoke(&self, _credential: &str) -> Result<(), OpenError> {
        Ok(())
    }

    #[doc(hidden)]
    fn unsupported(&self, what: &str) -> OpenError {
        OpenError::Rejected(format!("{} does not support {what}", self.kind().label()))
    }
}

/// The providers a server has set up. CSV import needs nothing, so it is always there.
#[derive(Clone)]
pub struct Providers {
    map: HashMap<ProviderKind, Arc<dyn Provider>>,
}

impl Default for Providers {
    fn default() -> Self {
        let mut map: HashMap<ProviderKind, Arc<dyn Provider>> = HashMap::new();
        map.insert(ProviderKind::Csv, Arc::new(CsvProvider));
        Self { map }
    }
}

impl Providers {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add (or replace) the provider of its kind.
    pub fn with(mut self, provider: Arc<dyn Provider>) -> Self {
        self.map.insert(provider.kind(), provider);
        self
    }

    pub fn get(&self, kind: ProviderKind) -> Option<Arc<dyn Provider>> {
        self.map.get(&kind).cloned()
    }

    pub fn has(&self, kind: ProviderKind) -> bool {
        self.map.contains_key(&kind)
    }
}

/// `1234.5` or `"1234.50"` as cents, without floating point errors.
pub(crate) fn cents_of(value: &serde_json::Value) -> Option<i64> {
    let text = match value {
        serde_json::Value::String(s) => s.trim().to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => return None,
    };
    financer_core::Money::parse(&text).ok().map(|m| m.cents())
}

pub(crate) fn parse_date(s: &str) -> Option<time::Date> {
    const FORMAT: &[time::format_description::BorrowedFormatItem<'static>] =
        time::macros::format_description!("[year]-[month]-[day]");
    // finAPI sends "2024-05-02 00:00:00.000"; the date is the first ten characters
    time::Date::parse(s.get(..10)?, FORMAT).ok()
}

pub(crate) fn date_text(d: time::Date) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), d.month() as u8, d.day())
}
