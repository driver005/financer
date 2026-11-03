use financer_core::{Money, Transaction};
use time::Date;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkRequest {
    /// A stable label for the connection (its name).
    pub reference: String,
    /// GoCardless: the bank to connect (`institution_id`); finAPI lets you pick on its page.
    pub institution: Option<String>,
    pub language: String,
    /// How far back the first read reaches.
    pub days: u32,
    /// Where the provider's page sends the browser when you are done.
    pub redirect_uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkStart {
    /// The provider's own page, to open in the browser.
    pub url: String,
    /// Opaque; hand it to `poll`.
    pub session: String,
    /// Unix seconds; empty when the provider did not say.
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkPoll {
    Waiting,
    /// Done: keep this (sealed) and use it for every `fetch`.
    Done { credential: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchRequest {
    pub credential: String,
    /// Only these accounts; empty = all.
    pub account_ids: Vec<String>,
    /// Read bookings from this day on.
    pub since: Date,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedAccount {
    pub id: String,
    pub name: String,
    /// The last digits of the IBAN or account number.
    pub mask: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Fetched {
    pub balance: Option<Money>,
    pub balance_date: Option<Date>,
    pub transactions: Vec<Transaction>,
    pub skipped: usize,
    pub accounts: Vec<LinkedAccount>,
}

pub(crate) fn mask_of(number: &str) -> Option<String> {
    let clean: String = number.chars().filter(|c| !c.is_whitespace()).collect();
    (clean.chars().count() >= 4).then(|| {
        clean
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    })
}
