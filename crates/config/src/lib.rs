//! Configuration of the hosted server.
//!
//! Settings come from `financer.toml` and from `FINANCER_*` environment variables; for every
//! setting the environment variable wins over the file, and the file over the default. Without
//! a file the environment alone works exactly as it did before the file existed.
//!
//! The on-phone (embedded) backend does not read any of this.

mod env;
mod file;
mod interpolate;
mod load;
mod render;
#[cfg(test)]
mod tests;
mod validate;

use std::fmt;

pub use env::{Env, MapEnv, ProcessEnv};
pub use file::{BankAccount, FileConfig, OneOrMany, StoreAlias};
pub use interpolate::Interpolator;
pub use load::{
    AuthSettings, BankSettings, Config, DatabaseSettings, LlmSettings, Loaded, Loader,
    PlaidSettings, PricesSettings, ProviderChoice, Secret, ServerSettings, Setting, Source,
    DEFAULT_BIND, DEFAULT_DATABASE_URL, DEFAULT_FILE, DEFAULT_REFRESH_HOURS, MIN_TOKEN_LEN,
};
pub use render::Renderer;
pub use validate::Validator;

/// One or more readable problems with the configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    pub problems: Vec<String>,
}

impl ConfigError {
    pub(crate) fn one(message: String) -> Self {
        Self {
            problems: vec![message],
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (i, p) in self.problems.iter().enumerate() {
            if i > 0 {
                writeln!(f)?;
            }
            write!(f, "{p}")?;
        }
        Ok(())
    }
}

impl std::error::Error for ConfigError {}
