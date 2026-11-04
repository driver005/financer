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
    /// `[[prices.sources]]`: price sources written in place (the same entries as in the JSON
    /// file). They are used together with the ones from `sources_file`.
    pub sources: Vec<financer_prices::SourceConfig>,
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
    /// `[bank.plaid]`: the Plaid account the server uses for every `kind = "plaid"` connection.
    pub plaid: FilePlaid,
    /// `[bank.gocardless]`: GoCardless Bank Account Data for every `kind = "gocardless"` connection.
    pub gocardless: FileGoCardless,
    /// `[bank.finapi]`: finAPI for every `kind = "finapi"` connection.
    pub finapi: FileFinapi,
    pub accounts: Vec<BankAccount>,
}

/// `[bank.plaid]`. The client id and the secret come from your Plaid dashboard; write them as
/// `${PLAID_CLIENT_ID}` / `${PLAID_SECRET}` so they stay out of the file.
#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FilePlaid {
    pub client_id: Option<String>,
    pub secret: Option<String>,
    /// `sandbox` (Plaid's test bank, the default) or `production`.
    pub environment: Option<String>,
    /// Countries whose banks you can pick in Plaid's window, e.g. `["DE"]` (the default).
    pub country_codes: Vec<String>,
    /// Language of Plaid's window, e.g. `de` (the default) or `en`.
    pub language: Option<String>,
    /// Where Plaid's page sends the browser when you are done. Optional; without it the page
    /// just says you can close it.
    pub redirect_uri: Option<String>,
}

/// `[bank.gocardless]`. The secret id and key come from GoCardless's Bank Account Data portal;
/// write them as `${GOCARDLESS_SECRET_ID}` / `${GOCARDLESS_SECRET_KEY}` so they stay out of the
/// file.
#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FileGoCardless {
    pub secret_id: Option<String>,
    pub secret_key: Option<String>,
    /// Language of the bank's sign-in page, e.g. `de` (the default) or `en`.
    pub language: Option<String>,
    /// Where the bank's page sends the browser when you are done. Optional.
    pub redirect_uri: Option<String>,
}

/// `[bank.finapi]`. The client id and secret come from your finAPI client; write them as
/// `${FINAPI_CLIENT_ID}` / `${FINAPI_CLIENT_SECRET}` so they stay out of the file.
#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FileFinapi {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    /// `sandbox` (finAPI's test banks, the default) or `live`.
    pub environment: Option<String>,
    /// Where the web form sends the browser when you are done. Optional.
    pub redirect_uri: Option<String>,
}

/// One `[[bank.accounts]]` entry. The PIN is never part of it: it comes from the environment
/// variable named by `pin_env`, or is typed into the app.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BankAccount {
    pub name: String,
    /// The provider: `fints` (the default; your bank directly, with a PIN and an approval in the
    /// banking app), `plaid`, `gocardless` or `finapi` (you sign in once on the provider's page, no
    /// PIN, no approval per sync).
    #[serde(default = "BankAccount::default_kind")]
    pub kind: String,
    /// FinTS only: the 8-digit bank code.
    #[serde(default)]
    pub bank_code: String,
    /// FinTS only: the online banking login name.
    #[serde(default)]
    pub login: String,
    /// FinTS only: the account to read (FinTS needs it to pick the account).
    #[serde(default)]
    pub iban: String,
    /// Plaid, GoCardless, finAPI: read only these accounts (the ids the app shows after linking).
    /// Leave out to read every account you linked.
    #[serde(default)]
    pub account_ids: Vec<String>,
    /// GoCardless only: the bank to connect, an institution id from GoCardless's list (for
    /// example `SPARKASSE_...`). finAPI and Plaid let you pick the bank on their page.
    #[serde(default)]
    pub institution: Option<String>,
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
