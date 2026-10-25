use financer_core::{Money, Transaction};
use serde::Deserialize;
use time::Date;

/// What to ask Plaid for when a connection is linked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkRequest {
    /// Any stable id for you, e.g. the connection name. Plaid shows it nowhere.
    pub user_id: String,
    pub country_codes: Vec<String>,
    pub language: String,
    /// How far back the first read reaches (Plaid allows up to 730; its default is 90).
    pub days_requested: u32,
    /// Where Plaid's page sends the browser when you are done; optional.
    pub completion_redirect_uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkToken {
    pub token: String,
    /// Plaid's own page, to open in the browser.
    pub hosted_link_url: String,
    /// Unix seconds; empty when Plaid did not say.
    pub expires_at: Option<i64>,
}

/// The state of a hosted link session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkSession {
    /// Not finished yet.
    Waiting,
    /// Done: swap this for an access token with [`crate::PlaidClient::exchange`].
    Finished { public_token: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exchange {
    pub access_token: String,
    pub item_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AccountBalance {
    pub account_id: String,
    pub name: String,
    /// Last digits of the account number, if Plaid has them.
    pub mask: Option<String>,
    pub kind: String,
    pub currency: Option<String>,
    pub current: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncRequest {
    pub access_token: String,
    pub cursor: Option<String>,
    /// Only these accounts (Plaid account ids); empty = all.
    pub account_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SyncOutcome {
    /// Booked transactions in EUR, as Financer transactions. Pending ones are left out: they
    /// change when they book, and Plaid then sends the booked one as new.
    pub transactions: Vec<Transaction>,
    /// Not imported: other currencies and transactions that are still pending.
    pub skipped: usize,
    pub modified: usize,
    pub removed: usize,
    /// Save this and pass it next time to read only what is new.
    pub next_cursor: String,
    /// Sum of the current balances of the included checking and savings accounts, in EUR.
    pub balance: Option<Money>,
    pub balance_date: Option<Date>,
    pub accounts: Vec<AccountBalance>,
}

// ---- Plaid's JSON ------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub(crate) struct LinkTokenCreate {
    pub link_token: String,
    #[serde(default)]
    pub hosted_link_url: Option<String>,
    #[serde(default)]
    pub expiration: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LinkTokenGet {
    #[serde(default)]
    pub link_sessions: Vec<RawLinkSession>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawLinkSession {
    #[serde(default)]
    pub results: Option<RawResults>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawResults {
    #[serde(default)]
    pub item_add_results: Vec<RawItemAdd>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawItemAdd {
    #[serde(default)]
    pub public_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawExchange {
    pub access_token: String,
    pub item_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawSyncPage {
    #[serde(default)]
    pub added: Vec<RawTransaction>,
    #[serde(default)]
    pub modified: Vec<serde_json::Value>,
    #[serde(default)]
    pub removed: Vec<serde_json::Value>,
    pub next_cursor: String,
    #[serde(default)]
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawTransaction {
    pub account_id: String,
    /// Plaid: positive = money leaving the account.
    pub amount: f64,
    #[serde(default)]
    pub iso_currency_code: Option<String>,
    pub date: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub merchant_name: Option<String>,
    #[serde(default)]
    pub pending: bool,
    #[serde(default)]
    pub payment_meta: Option<RawPaymentMeta>,
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct RawPaymentMeta {
    #[serde(default)]
    pub payee: Option<String>,
    #[serde(default)]
    pub reference_number: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawAccounts {
    #[serde(default)]
    pub accounts: Vec<RawAccount>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawAccount {
    pub account_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub official_name: Option<String>,
    #[serde(default)]
    pub mask: Option<String>,
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub balances: RawBalances,
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct RawBalances {
    #[serde(default)]
    pub current: Option<f64>,
    #[serde(default)]
    pub iso_currency_code: Option<String>,
}
