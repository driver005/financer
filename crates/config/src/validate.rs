//! Checks that go beyond the shape of the file. Every message names the offending key.

use std::collections::HashSet;

use financer_receipt_sources::ReceiptSourcesConfig;

use crate::file::{BankAccount, StoreAlias};
use crate::load::{Config, MIN_TOKEN_LEN};
use crate::Env;

pub struct Validator;

impl Validator {
    /// Longest allowed `since_days` (what the sync accepts).
    pub const MAX_SINCE_DAYS: u32 = 365;
    /// A year of hours is already "almost never".
    pub const MAX_SYNC_HOURS: u32 = 24 * 366;

    /// `[[bank.accounts]]`: errors stop the server, warnings do not.
    pub fn accounts(
        accounts: &[BankAccount],
        env: &dyn Env,
        errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        let mut names = HashSet::new();
        for (i, a) in accounts.iter().enumerate() {
            let key = |field: &str| format!("bank.accounts[{i}].{field}");
            let name = a.name.trim();
            if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
                errors.push(format!(
                    "{}: must be 1 to 60 characters without control characters",
                    key("name")
                ));
            } else if !names.insert(name.to_lowercase()) {
                errors.push(format!("{}: {name:?} is used twice", key("name")));
            }
            match a.kind.as_str() {
                "fints" => Self::fints_account(a, env, &key, errors, warnings),
                "plaid" => Self::plaid_account(a, &key, errors, warnings),
                other => errors.push(format!(
                    "{}: {other:?} is not supported; use \"fints\" or \"plaid\"",
                    key("kind")
                )),
            }
            if a.sync_every_hours > Self::MAX_SYNC_HOURS {
                errors.push(format!(
                    "{}: at most {} (use 0 for manual syncs only)",
                    key("sync_every_hours"),
                    Self::MAX_SYNC_HOURS
                ));
            }
            if let Some(d) = a.since_days {
                if !(1..=Self::MAX_SINCE_DAYS).contains(&d) {
                    errors.push(format!(
                        "{}: must be between 1 and {}",
                        key("since_days"),
                        Self::MAX_SINCE_DAYS
                    ));
                }
            }
        }
    }

    /// The checks of a `kind = "fints"` account: bank code, login, IBAN, FinTS address, PIN variable.
    fn fints_account(
        a: &BankAccount,
        env: &dyn Env,
        key: &dyn Fn(&str) -> String,
        errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        let name = a.name.trim();
        let code = a.bank_code.trim();
        if code.len() != 8 || !code.chars().all(|c| c.is_ascii_digit()) {
            errors.push(format!(
                "{}: a bank code has 8 digits (for example 37050198)",
                key("bank_code")
            ));
        }
        if a.login.trim().is_empty() {
            errors.push(format!("{}: must not be empty", key("login")));
        }
        if !Self::iban_ok(&a.iban) {
            errors.push(format!(
                "{}: not a valid IBAN (check the digits)",
                key("iban")
            ));
        }
        let url = a
            .fints_url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty());
        if let Some(url) = url {
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                errors.push(format!("{}: must start with https://", key("fints_url")));
            }
            if a.bic.as_deref().map(str::trim).unwrap_or("").is_empty() {
                errors.push(format!(
                    "{}: needed together with fints_url (the bank's BIC)",
                    key("bic")
                ));
            }
        }
        if let Some(var) = a
            .pin_env
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            let valid = var
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && var.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !valid {
                errors.push(format!(
                    "{}: {var:?} is not an environment variable name (the PIN itself must not be written in the file)",
                    key("pin_env")
                ));
            } else if env.nonempty(var).is_none() {
                warnings.push(format!(
                    "{}: the environment variable {var} is not set right now; scheduled syncs for {name:?} cannot log in until it is",
                    key("pin_env")
                ));
            }
        }
        if !a.account_ids.is_empty() {
            warnings.push(format!(
                "{}: only used by kind = \"plaid\"; ignored for a FinTS account",
                key("account_ids")
            ));
        }
    }

    /// The checks of a `kind = "plaid"` account: nothing to type in the file, because you pick the
    /// bank in Plaid's own window; the FinTS fields would only mislead.
    fn plaid_account(
        a: &BankAccount,
        key: &dyn Fn(&str) -> String,
        errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        for (field, set) in [
            ("bank_code", !a.bank_code.trim().is_empty()),
            ("login", !a.login.trim().is_empty()),
            ("iban", !a.iban.trim().is_empty()),
            (
                "fints_url",
                a.fints_url.as_deref().is_some_and(|u| !u.trim().is_empty()),
            ),
            (
                "bic",
                a.bic.as_deref().is_some_and(|u| !u.trim().is_empty()),
            ),
            (
                "pin_env",
                a.pin_env.as_deref().is_some_and(|u| !u.trim().is_empty()),
            ),
        ] {
            if set {
                warnings.push(format!(
                    "{}: only used by kind = \"fints\"; ignored for a Plaid account (you sign in on Plaid's page)",
                    key(field)
                ));
            }
        }
        for (i, id) in a.account_ids.iter().enumerate() {
            let id = id.trim();
            if id.is_empty()
                || id.len() > 100
                || !id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                errors.push(format!(
                    "{}[{i}]: not a Plaid account id (letters, digits, - and _ only)",
                    key("account_ids")
                ));
            }
        }
    }

    /// `[bank.plaid]`: the server-wide Plaid account.
    pub fn plaid(bank: &crate::BankSettings, errors: &mut Vec<String>, warnings: &mut Vec<String>) {
        let p = &bank.plaid;
        if !matches!(p.environment.value.as_str(), "sandbox" | "production") {
            errors.push(format!(
                "bank.plaid.environment: {:?} is not known; use \"sandbox\" or \"production\"",
                p.environment.value
            ));
        }
        for c in &p.country_codes {
            if c.len() != 2 || !c.chars().all(|ch| ch.is_ascii_uppercase()) {
                errors.push(format!(
                    "bank.plaid.country_codes: {c:?} is not a two-letter country code (for example \"DE\")"
                ));
            }
        }
        if p.language.len() != 2 || !p.language.chars().all(|c| c.is_ascii_lowercase()) {
            errors.push(format!(
                "bank.plaid.language: {:?} is not a two-letter language code (for example \"de\")",
                p.language
            ));
        }
        if let Some(uri) = p.redirect_uri.as_deref() {
            if !uri.starts_with("https://") {
                errors.push("bank.plaid.redirect_uri: must start with https://".to_string());
            }
        }
        let wanted = bank.accounts.iter().any(|a| a.kind == "plaid");
        if wanted && !p.configured() {
            warnings.push(
                "bank.accounts with kind \"plaid\" are configured but bank.plaid.client_id / bank.plaid.secret are not set (or FINANCER_PLAID_CLIENT_ID / FINANCER_PLAID_SECRET); syncing them stays off until they are"
                    .to_string(),
            );
        }
        if wanted && p.configured() && p.environment.value == "sandbox" {
            warnings.push(
                "bank.plaid.environment is \"sandbox\": Plaid only offers its test bank (user_good / pass_good); set \"production\" to link your real bank"
                    .to_string(),
            );
        }
    }

    /// `[receipts]`: things that are likely wrong but do not stop the server.
    pub fn receipts(cfg: &ReceiptSourcesConfig, env: &dyn Env, warnings: &mut Vec<String>) {
        if let Some(e) = cfg
            .email
            .as_ref()
            .filter(|e| e.enabled && e.password.as_deref().is_none_or(|p| p.trim().is_empty()))
        {
            let var = e.password_env.trim();
            let valid = var
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && var.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !valid {
                warnings.push(format!(
                    "receipts.email.password_env: {var:?} is not an environment variable name (the password itself must not be written in the file)"
                ));
            } else if env.nonempty(var).is_none() {
                warnings.push(format!(
                    "receipts.email.password_env: the environment variable {var} is not set right now; the mailbox cannot be read until it is"
                ));
            }
        }
        if let Some(f) = cfg.folder.as_ref().filter(|f| f.enabled) {
            if !f.path.is_dir() {
                warnings.push(format!(
                    "receipts.folder.path: {} is not a folder (yet); nothing is imported until it exists",
                    f.path.display()
                ));
            }
        }
    }

    /// IBAN with the ISO 7064 mod-97 check (spaces allowed).
    pub fn iban_ok(iban: &str) -> bool {
        let s: String = iban
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
            .to_ascii_uppercase();
        if !(15..=34).contains(&s.len()) || !s.chars().all(|c| c.is_ascii_alphanumeric()) {
            return false;
        }
        let b = s.as_bytes();
        if !(b[0].is_ascii_uppercase() && b[1].is_ascii_uppercase())
            || !(b[2].is_ascii_digit() && b[3].is_ascii_digit())
        {
            return false;
        }
        let mut rem: u32 = 0;
        for c in s[4..].chars().chain(s[..4].chars()) {
            let n = c.to_digit(36).expect("alphanumeric");
            rem = if n >= 10 {
                (rem * 100 + n) % 97
            } else {
                (rem * 10 + n) % 97
            };
        }
        rem == 1
    }

    /// `[[prices.sources]]`: the shape is checked by serde; this is what it cannot say.
    pub fn price_sources(sources: &[financer_prices::SourceConfig], errors: &mut Vec<String>) {
        use financer_prices::SourceConfig;
        for (i, source) in sources.iter().enumerate() {
            let at = |field: &str| format!("prices.sources[{i}].{field}");
            match source {
                SourceConfig::JsonLd { urls, .. } | SourceConfig::LlmPage { urls, .. } => {
                    if urls.is_empty() {
                        errors.push(format!("{}: needs at least one page address", at("urls")));
                    }
                    for url in urls {
                        if !(url.starts_with("https://") || url.starts_with("http://"))
                            || url.chars().any(char::is_whitespace)
                        {
                            errors.push(format!(
                                "{}: {url:?} is not a web address (start with https://)",
                                at("urls")
                            ));
                        }
                    }
                }
                SourceConfig::OpenPrices {
                    items,
                    max_age_days,
                } => {
                    if items.is_empty() {
                        errors.push(format!("{}: needs at least one item", at("items")));
                    }
                    for item in items {
                        if item.item.trim().is_empty() {
                            errors.push(format!("{}: an item name is empty", at("items")));
                        }
                        let code = item.barcode.trim();
                        if !(8..=14).contains(&code.len())
                            || !code.bytes().all(|b| b.is_ascii_digit())
                        {
                            errors.push(format!(
                                "{}: {:?} is not a barcode (8 to 14 digits)",
                                at("items"),
                                item.barcode
                            ));
                        }
                    }
                    if !(1..=365).contains(max_age_days) {
                        errors.push(format!("{}: must be between 1 and 365", at("max_age_days")));
                    }
                }
            }
        }
    }

    /// `[[stores]]`.
    pub fn stores(stores: &[StoreAlias], errors: &mut Vec<String>) {
        let letters = |s: &str| s.chars().filter(|c| c.is_alphabetic()).count();
        for (i, s) in stores.iter().enumerate() {
            if letters(&s.chain) < 2 {
                errors.push(format!(
                    "stores[{i}].chain: needs a chain name such as \"rewe\" or \"Bio Company\""
                ));
            } else if s.chain.trim().eq_ignore_ascii_case("other") {
                errors.push(format!(
                    "stores[{i}].chain: \"other\" is reserved for unmatched grocery spending"
                ));
            }
            let patterns = s.patterns.to_vec();
            if patterns.is_empty() {
                errors.push(format!("stores[{i}].match: needs at least one text"));
            }
            for p in patterns {
                if letters(&p) < 3 {
                    errors.push(format!(
                        "stores[{i}].match: {p:?} is too short to be safe (at least 3 letters)"
                    ));
                }
            }
        }
    }
}

impl Config {
    /// Everything the server needs before it can start: a token, a database address it can
    /// open, and the files named in the configuration. Empty means ready.
    pub fn problems_for_server(&self) -> Vec<String> {
        let mut problems = Vec::new();
        match &self.auth.api_token.value {
            None => problems.push(
                "no API token: set FINANCER_API_TOKEN, or auth.api_token / auth.api_token_file in financer.toml"
                    .to_string(),
            ),
            Some(t) if t.expose().len() < MIN_TOKEN_LEN => problems.push(format!(
                "the API token must be at least {MIN_TOKEN_LEN} characters"
            )),
            Some(_) => {}
        }
        let url = &self.database.url.value;
        if !(url.starts_with("sqlite:")
            || url.starts_with("postgres:")
            || url.starts_with("postgresql:"))
        {
            problems.push(format!(
                "database.url: must start with sqlite: or postgres: ({})",
                self.database.url.source
            ));
        }
        if let Some(dir) = &self.server.web_dir.value {
            if !std::path::Path::new(dir).join("index.html").is_file() {
                problems.push(format!(
                    "server.web_dir: {dir} has no index.html ({})",
                    self.server.web_dir.source
                ));
            }
        }
        if let Some(f) = &self.prices.sources_file.value {
            if !std::path::Path::new(f).is_file() {
                problems.push(format!(
                    "prices.sources_file: cannot find {f} ({})",
                    self.prices.sources_file.source
                ));
            }
        }
        for o in &self.server.cors_origins.value {
            if !(o.starts_with("http://") || o.starts_with("https://")) {
                problems.push(format!(
                    "server.cors_origins: {o:?} is not an origin like http://localhost:8081"
                ));
            }
        }
        problems
    }
}
