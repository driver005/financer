//! Open banking aggregators as bank connection providers.
//!
//! Both [`gocardless::GoCardless`] and [`finapi::Finapi`] work the same way for the app: you sign
//! in to your bank once on the provider's own page, the server keeps a sealed credential, and from
//! then on it reads transactions whenever it is asked. They implement [`LinkProvider`]; the API
//! crate drives either one with the same code. All network access goes through [`OpenHttp`], so
//! tests run without a network.

pub mod error;
pub mod finapi;
pub mod gocardless;
pub mod http;
pub mod testing;
pub mod types;

use async_trait::async_trait;

pub use error::{ApiError, OpenError};
pub use finapi::{Finapi, FinapiConfig, FinapiEnvironment};
pub use gocardless::{GoCardless, GoCardlessConfig};
pub use http::{OpenHttp, ReqwestHttp};
pub use types::{FetchRequest, Fetched, LinkPoll, LinkRequest, LinkStart, LinkedAccount};

#[async_trait]
pub trait LinkProvider: Send + Sync {
    /// For messages: "GoCardless" or "finAPI".
    fn name(&self) -> &'static str;

    /// Start a sign-in: open [`LinkStart::url`] in a browser.
    async fn begin(&self, req: &LinkRequest) -> Result<LinkStart, OpenError>;

    /// Has the browser session finished? Poll every few seconds after opening the page.
    async fn poll(&self, session: &str) -> Result<LinkPoll, OpenError>;

    /// Read balance, accounts and transactions with a credential from [`LinkPoll::Done`].
    async fn fetch(&self, req: &FetchRequest) -> Result<Fetched, OpenError>;

    /// Tell the provider to drop the connection. Best effort.
    async fn revoke(&self, credential: &str) -> Result<(), OpenError>;
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
