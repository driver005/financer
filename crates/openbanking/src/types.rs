use std::fmt;

use financer_core::{Money, Transaction};
use time::Date;

/// Every way transactions come in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ProviderKind {
    /// The export file of your online banking.
    Csv,
    /// Your bank directly (FinTS): a PIN and an approval in the banking app per sync.
    Fints,
    /// Plaid: sign in once on its page.
    Plaid,
    /// GoCardless Bank Account Data: sign in once on your bank's page.
    GoCardless,
    /// finAPI: pick your bank and sign in once on its web form.
    Finapi,
}

/// How a provider gets its data, which is what decides how an app talks to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flow {
    /// You hand over a file.
    File,
    /// A PIN, then an approval in the banking app, for every sync.
    Approval,
    /// Sign in once on the provider's page; later syncs need nothing.
    Link,
}

impl ProviderKind {
    pub const ALL: [ProviderKind; 5] = [
        ProviderKind::Csv,
        ProviderKind::Fints,
        ProviderKind::GoCardless,
        ProviderKind::Plaid,
        ProviderKind::Finapi,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ProviderKind::Csv => "csv",
            ProviderKind::Fints => "fints",
            ProviderKind::Plaid => "plaid",
            ProviderKind::GoCardless => "gocardless",
            ProviderKind::Finapi => "finapi",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s.trim())
    }

    /// For messages.
    pub fn label(self) -> &'static str {
        match self {
            ProviderKind::Csv => "CSV import",
            ProviderKind::Fints => "FinTS",
            ProviderKind::Plaid => "Plaid",
            ProviderKind::GoCardless => "GoCardless",
            ProviderKind::Finapi => "finAPI",
        }
    }

    pub fn flow(self) -> Flow {
        match self {
            ProviderKind::Csv => Flow::File,
            ProviderKind::Fints => Flow::Approval,
            _ => Flow::Link,
        }
    }

    /// Plaid, GoCardless and finAPI: sign in once on the provider's page, no PIN, no approval.
    pub fn links_once(self) -> bool {
        self.flow() == Flow::Link
    }
}

impl fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The online banking login of a FinTS sync. The PIN and the login are secrets: they are never
/// stored, logged or part of `Debug`.
#[derive(Clone)]
pub struct Login {
    /// Bank code (BLZ), e.g. `37050198`.
    pub blz: String,
    pub user_id: String,
    pub pin: String,
    pub iban: String,
    /// Leave empty to use the bank's own BIC.
    pub bic: String,
    /// The bank's FinTS address, for a bank that is not in the built-in list (then `bic` is
    /// needed too). `None` looks the bank code up.
    pub fints_url: Option<String>,
}

impl fmt::Debug for Login {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Login")
            .field("blz", &self.blz)
            .field("user_id", &"<redacted>")
            .field("pin", &"<redacted>")
            .field("iban", &"<redacted>")
            .finish()
    }
}

/// Start a sign-in or a sync.
#[derive(Debug, Clone, Default)]
pub struct BeginRequest {
    /// A stable label for the connection (its name).
    pub reference: String,
    /// GoCardless: the bank to connect (`institution_id`); the others let you pick on their page.
    pub institution: Option<String>,
    /// How far back the read reaches.
    pub days: u32,
    /// FinTS only.
    pub login: Option<Login>,
}

/// What the person has to do next, or that nothing is needed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Open this page in a browser and sign in to your bank; then `poll` until it is linked.
    Link {
        url: String,
        /// Opaque; hand it to `poll`.
        session: String,
        /// Unix seconds; `None` when the provider did not say.
        expires_at: Option<i64>,
    },
    /// Approve in your banking app; then `poll` until the data comes.
    Approval {
        message: String,
        session: String,
        expires_at: Option<i64>,
    },
    /// Nothing to approve (the bank needs no approval for this sync): `poll` right away.
    Fetching { session: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Poll {
    Waiting,
    /// Signed in: keep this (sealed) and use it for every `fetch`.
    Linked {
        credential: String,
    },
    /// The approval came and the data with it.
    Data(Fetched),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchRequest {
    pub credential: String,
    /// Only these accounts; empty = all.
    pub account_ids: Vec<String>,
    /// Read bookings from this day on.
    pub since: Date,
    /// Where the last read ended, for a provider that reads by cursor (Plaid).
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedAccount {
    pub id: String,
    pub name: String,
    /// The last digits of the IBAN or account number.
    pub mask: Option<String>,
    pub kind: String,
}

/// What a read brought.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Fetched {
    pub balance: Option<Money>,
    pub balance_date: Option<Date>,
    /// Booked transactions only (pending ones would change when they book).
    pub transactions: Vec<Transaction>,
    /// Transactions skipped, e.g. because they are not in EUR.
    pub skipped: usize,
    pub accounts: Vec<LinkedAccount>,
    /// Save this after the import succeeded and hand it to the next `fetch`.
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedRow {
    /// 1-based line number in the file (the header is line 1).
    pub line: u64,
    pub reason: String,
}

/// What a file import read.
#[derive(Debug, Default)]
pub struct Parsed {
    pub transactions: Vec<Transaction>,
    pub skipped: Vec<SkippedRow>,
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
