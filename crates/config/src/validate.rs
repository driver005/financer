//! Checks that go beyond the shape of the file. Every message names the offending key.

use std::collections::HashSet;

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
            if a.kind != "fints" {
                errors.push(format!(
                    "{}: {:?} is not supported; the only kind is \"fints\"",
                    key("kind"),
                    a.kind
                ));
            }
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
