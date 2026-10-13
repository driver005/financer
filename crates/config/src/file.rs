//! The shape of `financer.toml` exactly as written in the file. Unknown keys are an error
//! everywhere, including under `[receipts]`.

use financer_receipt_sources::ReceiptSourcesConfig;
use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FileConfig {
    pub server: FileServer,
    pub auth: FileAuth,
    pub database: FileDatabase,
    pub prices: FilePrices,
    pub llm: FileLlm,
    pub bank: FileBank,
    pub stores: Vec<StoreAlias>,
    /// Automatic receipt import (mailbox, Lidl Plus, watched folder).
    pub receipts: ReceiptSourcesConfig,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FileServer {
    pub bind: Option<String>,
    pub web_dir: Option<String>,
    pub cors_origins: Option<Vec<String>>,
    pub refresh_hours: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FileAuth {
    pub api_token: Option<String>,
    pub api_token_file: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FileDatabase {
    pub url: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FilePrices {
    pub sources_file: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FileLlm {
    pub anthropic_api_key: Option<String>,
    pub openai_api_key: Option<String>,
    pub provider: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FileBank {
    pub fints_product_id: Option<String>,
    pub accounts: Vec<BankAccount>,
}

/// One `[[bank.accounts]]` entry. The PIN is never part of it: it comes from the environment
/// variable named by `pin_env`, or is typed into the app.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BankAccount {
    pub name: String,
    /// Only `fints` exists today.
    #[serde(default = "BankAccount::default_kind")]
    pub kind: String,
    pub bank_code: String,
    /// The online banking login name.
    pub login: String,
    /// The account to read (FinTS needs it to pick the account).
    pub iban: String,
    /// Only needed together with `fints_url`.
    #[serde(default)]
    pub bic: Option<String>,
    /// Leave out to look the bank up by its bank code.
    #[serde(default)]
    pub fints_url: Option<String>,
    /// Name of an environment variable that holds the PIN.
    #[serde(default)]
    pub pin_env: Option<String>,
    /// Hours between automatic syncs; 0 (the default) means only when you ask.
    #[serde(default)]
    pub sync_every_hours: u32,
    /// How many days the first import reaches back (default 90).
    #[serde(default)]
    pub since_days: Option<u32>,
}

impl BankAccount {
    fn default_kind() -> String {
        "fints".into()
    }
}

/// `[[stores]]`: bank texts that belong to a shop chain.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoreAlias {
    /// A built-in chain (`rewe`, `lidl`, ...) or a name of your own.
    pub chain: String,
    /// Text that appears in the booking's counterparty or purpose.
    #[serde(rename = "match")]
    pub patterns: OneOrMany,
}

/// `match = "text"` or `match = ["one", "two"]`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

impl OneOrMany {
    pub fn to_vec(&self) -> Vec<String> {
        match self {
            OneOrMany::One(s) => vec![s.clone()],
            OneOrMany::Many(v) => v.clone(),
        }
    }
}
