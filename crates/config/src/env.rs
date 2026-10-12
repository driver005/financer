//! Access to environment variables, behind a trait so tests do not touch the real environment.

use std::collections::HashMap;

pub trait Env {
    /// The variable's value, or `None` when it is not set.
    fn var(&self, name: &str) -> Option<String>;

    /// The value when it is set and not blank. Docker compose passes unset variables through as
    /// empty strings, so blank has to mean "not configured".
    fn nonempty(&self, name: &str) -> Option<String> {
        self.var(name).filter(|v| !v.trim().is_empty())
    }
}

/// The real process environment.
pub struct ProcessEnv;

impl Env for ProcessEnv {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }
}

/// A fixed set of variables (tests).
#[derive(Default, Clone)]
pub struct MapEnv(pub HashMap<String, String>);

impl MapEnv {
    pub fn new(pairs: &[(&str, &str)]) -> Self {
        Self(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }
}

impl Env for MapEnv {
    fn var(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned()
    }
}
