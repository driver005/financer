//! Finding, reading and merging the configuration: environment variable > config file > default.

use std::fmt;
use std::path::{Path, PathBuf};

use crate::file::{BankAccount, FileConfig, StoreAlias};
use crate::interpolate::Interpolator;
use crate::{ConfigError, Env};

/// Name of the file looked up in the working directory.
pub const DEFAULT_FILE: &str = "financer.toml";

pub const DEFAULT_BIND: &str = "127.0.0.1:8080";
pub const DEFAULT_DATABASE_URL: &str = "sqlite://financer.db?mode=rwc";
pub const DEFAULT_REFRESH_HOURS: u64 = 24;
/// The shortest API token the server accepts.
pub const MIN_TOKEN_LEN: usize = 32;

/// Where an effective value came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    Default,
    File,
    /// The environment variable of this name.
    Env(String),
}

impl fmt::Display for Source {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Source::Default => write!(f, "default"),
            Source::File => write!(f, "file"),
            Source::Env(name) => write!(f, "env {name}"),
        }
    }
}

/// A value together with the place it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Setting<T> {
    pub value: T,
    pub source: Source,
}

/// A string that must never be printed or logged.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The secret itself. Call this only where it is actually used.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Secret(<redacted>)")
    }
}

/// Which LLM provider to use when the app has not chosen one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderChoice {
    Claude,
    OpenAi,
}

impl ProviderChoice {
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderChoice::Claude => "claude",
            ProviderChoice::OpenAi => "open_ai",
        }
    }

    fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "claude" => Ok(Self::Claude),
            "openai" | "open_ai" => Ok(Self::OpenAi),
            other => Err(format!(
                "unknown provider {other:?}; use \"claude\" or \"openai\""
            )),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ServerSettings {
    pub bind: Setting<String>,
    pub web_dir: Setting<Option<String>>,
    pub cors_origins: Setting<Vec<String>>,
    pub refresh_hours: Setting<u64>,
}

#[derive(Debug, Clone)]
pub struct AuthSettings {
    pub api_token: Setting<Option<Secret>>,
}

#[derive(Debug, Clone)]
pub struct DatabaseSettings {
    pub url: Setting<String>,
}

#[derive(Debug, Clone)]
pub struct PricesSettings {
    pub sources_file: Setting<Option<String>>,
}

#[derive(Debug, Clone)]
pub struct LlmSettings {
    pub anthropic_api_key: Setting<Option<Secret>>,
    pub openai_api_key: Setting<Option<Secret>>,
    pub provider: Setting<Option<ProviderChoice>>,
}

#[derive(Debug, Clone)]
pub struct BankSettings {
    pub fints_product_id: Setting<Option<Secret>>,
    pub accounts: Vec<BankAccount>,
}

/// The effective configuration.
#[derive(Debug, Clone)]
pub struct Config {
    pub server: ServerSettings,
    pub auth: AuthSettings,
    pub database: DatabaseSettings,
    pub prices: PricesSettings,
    pub llm: LlmSettings,
    pub bank: BankSettings,
    pub stores: Vec<StoreAlias>,
}

/// A configuration plus where it was read from.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub config: Config,
    /// The file that was read, if any.
    pub path: Option<PathBuf>,
    /// Things worth telling the operator that do not stop the server.
    pub warnings: Vec<String>,
}

/// How a file was asked for.
enum Wanted {
    /// `--config` or `FINANCER_CONFIG`: it must exist.
    Explicit(PathBuf),
    /// `./financer.toml`: used when present.
    Implicit(PathBuf),
    None,
}

pub struct Loader;

impl Loader {
    /// Load the configuration. `config_arg` is the value of `--config`; `cwd` is where
    /// `financer.toml` is looked for. Order of the file: `--config`, `FINANCER_CONFIG`,
    /// `./financer.toml`, none (then the environment and defaults alone apply).
    pub fn load(
        config_arg: Option<&Path>,
        env: &dyn Env,
        cwd: &Path,
    ) -> Result<Loaded, ConfigError> {
        let wanted = if let Some(p) = config_arg {
            Wanted::Explicit(p.to_path_buf())
        } else if let Some(p) = env.nonempty("FINANCER_CONFIG") {
            Wanted::Explicit(PathBuf::from(p))
        } else if cwd.join(DEFAULT_FILE).is_file() {
            Wanted::Implicit(cwd.join(DEFAULT_FILE))
        } else {
            Wanted::None
        };
        match wanted {
            Wanted::None => Self::resolve(FileConfig::default(), None, env, Vec::new()),
            Wanted::Explicit(path) | Wanted::Implicit(path) => {
                let text = std::fs::read_to_string(&path).map_err(|e| {
                    ConfigError::one(format!("cannot read config file {}: {e}", path.display()))
                })?;
                let mut warnings = Vec::new();
                let file = Self::parse(&text, &path, env, &mut warnings)?;
                Self::resolve(file, Some(path), env, warnings)
            }
        }
    }

    /// Parse and expand `text`. `path` is only used in messages.
    pub fn parse(
        text: &str,
        path: &Path,
        env: &dyn Env,
        warnings: &mut Vec<String>,
    ) -> Result<FileConfig, ConfigError> {
        let shown = path.display();
        // First pass on the text as written: syntax errors and unknown keys carry line numbers.
        let raw: FileConfig = toml::from_str(text)
            .map_err(|e| ConfigError::one(format!("{shown}: {}", e.to_string().trim_end())))?;
        if let Some(name) = Self::literal_secrets(&raw) {
            warnings.push(format!(
                "{shown} holds {name} as plain text; prefer ${{ENV_VAR}} references and keep the file private (chmod 600)"
            ));
            #[cfg(unix)]
            Self::warn_if_readable(path, warnings);
        }

        // Second pass: the same document with `${NAME}` references replaced. The reserved
        // [receipts] table is left alone.
        let mut value: toml::Value = toml::from_str(text)
            .map_err(|e| ConfigError::one(format!("{shown}: {}", e.to_string().trim_end())))?;
        if let Some(table) = value.as_table_mut() {
            table.remove("receipts");
        }
        Interpolator::expand_value(&mut value, env, "").map_err(|(key, missing)| {
            let line = Self::line_of(text, &missing.name)
                .map(|l| format!(" (line {l})"))
                .unwrap_or_default();
            ConfigError::one(format!(
                "{shown}: {key}{line} refers to ${{{name}}}, but the environment variable {name} is not set (write ${{{name}:-fallback}} to give it a default)",
                name = missing.name
            ))
        })?;
        let mut expanded: FileConfig = value
            .try_into()
            .map_err(|e| ConfigError::one(format!("{shown}: {e}")))?;
        expanded.receipts = raw.receipts;
        Ok(expanded)
    }

    /// The name of the first secret key that holds a literal value instead of a reference.
    fn literal_secrets(file: &FileConfig) -> Option<&'static str> {
        let literal = |v: &Option<String>| {
            v.as_deref()
                .is_some_and(|s| !s.trim().is_empty() && !Interpolator::has_reference(s))
        };
        if literal(&file.auth.api_token) {
            Some("auth.api_token")
        } else if literal(&file.llm.anthropic_api_key) {
            Some("llm.anthropic_api_key")
        } else if literal(&file.llm.openai_api_key) {
            Some("llm.openai_api_key")
        } else if literal(&file.bank.fints_product_id) {
            Some("bank.fints_product_id")
        } else {
            None
        }
    }

    #[cfg(unix)]
    fn warn_if_readable(path: &Path, warnings: &mut Vec<String>) {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mode = meta.permissions().mode();
            if mode & 0o077 != 0 {
                warnings.push(format!(
                    "{} can be read by other users (mode {:o}) and contains secrets; run chmod 600 on it",
                    path.display(),
                    mode & 0o777
                ));
            }
        }
    }

    /// The 1-based line of the first `${NAME` in the text.
    fn line_of(text: &str, name: &str) -> Option<usize> {
        let needle = format!("${{{name}");
        text.lines()
            .position(|l| l.contains(&needle))
            .map(|i| i + 1)
    }

    fn non_empty(v: Option<String>) -> Option<String> {
        v.filter(|s| !s.trim().is_empty())
    }

    /// Relative paths written in the file are relative to the file's folder.
    fn file_path(base: Option<&Path>, value: &str) -> String {
        let p = Path::new(value);
        match base {
            Some(dir) if p.is_relative() => dir.join(p).to_string_lossy().into_owned(),
            _ => value.to_string(),
        }
    }

    /// One setting: the environment variable if set, else the file's value, else the default.
    fn pick<T>(
        env: &dyn Env,
        var: &str,
        file: Option<T>,
        default: T,
        parse: impl Fn(&str) -> Result<T, String>,
        errors: &mut Vec<String>,
    ) -> Setting<T> {
        if let Some(raw) = env.nonempty(var) {
            match parse(&raw) {
                Ok(value) => {
                    return Setting {
                        value,
                        source: Source::Env(var.to_string()),
                    }
                }
                Err(e) => errors.push(format!("{var}: {e}")),
            }
        }
        match file {
            Some(value) => Setting {
                value,
                source: Source::File,
            },
            None => Setting {
                value: default,
                source: Source::Default,
            },
        }
    }

    fn opt_string(
        env: &dyn Env,
        var: &str,
        file: Option<String>,
        base: Option<&Path>,
        is_path: bool,
    ) -> Setting<Option<String>> {
        if let Some(v) = env.nonempty(var) {
            return Setting {
                value: Some(v),
                source: Source::Env(var.to_string()),
            };
        }
        match Self::non_empty(file) {
            Some(v) => Setting {
                value: Some(if is_path {
                    Self::file_path(base, &v)
                } else {
                    v
                }),
                source: Source::File,
            },
            None => Setting {
                value: None,
                source: Source::Default,
            },
        }
    }

    fn secret(env: &dyn Env, var: &str, file: Option<String>) -> Setting<Option<Secret>> {
        let s = Self::opt_string(env, var, file, None, false);
        Setting {
            value: s.value.map(Secret::new),
            source: s.source,
        }
    }

    fn resolve(
        file: FileConfig,
        path: Option<PathBuf>,
        env: &dyn Env,
        warnings: Vec<String>,
    ) -> Result<Loaded, ConfigError> {
        let base = path.as_deref().and_then(Path::parent).map(|p| {
            if p.as_os_str().is_empty() {
                Path::new(".")
            } else {
                p
            }
        });
        let mut errors = Vec::new();

        let server = ServerSettings {
            bind: Self::pick(
                env,
                "FINANCER_BIND",
                Self::non_empty(file.server.bind),
                DEFAULT_BIND.to_string(),
                |s| Ok(s.trim().to_string()),
                &mut errors,
            ),
            web_dir: Self::opt_string(env, "FINANCER_WEB_DIR", file.server.web_dir, base, true),
            cors_origins: Self::pick(
                env,
                "FINANCER_CORS_ORIGIN",
                file.server
                    .cors_origins
                    .map(|v| v.into_iter().filter(|o| !o.trim().is_empty()).collect()),
                Vec::new(),
                |s| {
                    Ok(s.split(',')
                        .map(|o| o.trim().to_string())
                        .filter(|o| !o.is_empty())
                        .collect())
                },
                &mut errors,
            ),
            refresh_hours: Self::pick(
                env,
                "FINANCER_REFRESH_HOURS",
                file.server.refresh_hours,
                DEFAULT_REFRESH_HOURS,
                |s| {
                    s.trim()
                        .parse()
                        .map_err(|_| "must be a whole number".to_string())
                },
                &mut errors,
            ),
        };

        // The token: environment, then [auth] api_token, then the contents of api_token_file.
        let mut api_token = Self::secret(env, "FINANCER_API_TOKEN", file.auth.api_token.clone());
        let token_file = Self::non_empty(file.auth.api_token_file);
        if let Some(tf) = &token_file {
            if Self::non_empty(file.auth.api_token.clone()).is_some() {
                errors.push("auth: set either api_token or api_token_file, not both".to_string());
            } else if api_token.value.is_none() {
                let full = Self::file_path(base, tf);
                match std::fs::read_to_string(&full) {
                    Ok(content) if !content.trim().is_empty() => {
                        api_token = Setting {
                            value: Some(Secret::new(content.trim())),
                            source: Source::File,
                        };
                    }
                    Ok(_) => errors.push(format!("auth.api_token_file {full} is empty")),
                    Err(e) => errors.push(format!("auth.api_token_file: cannot read {full}: {e}")),
                }
            }
        }

        let database = DatabaseSettings {
            url: Self::pick(
                env,
                "FINANCER_DATABASE_URL",
                Self::non_empty(file.database.url),
                DEFAULT_DATABASE_URL.to_string(),
                |s| Ok(s.trim().to_string()),
                &mut errors,
            ),
        };
        let prices = PricesSettings {
            sources_file: Self::opt_string(
                env,
                "FINANCER_PRICE_SOURCES",
                file.prices.sources_file,
                base,
                true,
            ),
        };

        let provider_file = Self::non_empty(file.llm.provider).and_then(|p| {
            ProviderChoice::parse(&p)
                .map_err(|e| errors.push(format!("llm.provider: {e}")))
                .ok()
        });
        let llm = LlmSettings {
            anthropic_api_key: Self::secret(
                env,
                "FINANCER_ANTHROPIC_API_KEY",
                file.llm.anthropic_api_key,
            ),
            openai_api_key: Self::secret(env, "FINANCER_OPENAI_API_KEY", file.llm.openai_api_key),
            provider: Self::pick(
                env,
                "FINANCER_LLM_PROVIDER",
                provider_file.map(Some),
                None,
                |s| ProviderChoice::parse(s).map(Some),
                &mut errors,
            ),
        };

        let bank = BankSettings {
            fints_product_id: Self::secret(
                env,
                "FINANCER_FINTS_PRODUCT_ID",
                file.bank.fints_product_id,
            ),
            accounts: file.bank.accounts,
        };

        let mut warnings = warnings;
        crate::Validator::accounts(&bank.accounts, env, &mut errors, &mut warnings);
        if !bank.accounts.is_empty() && bank.fints_product_id.value.is_none() {
            warnings.push(
                "bank.accounts are configured but no FinTS product id is set (bank.fints_product_id or FINANCER_FINTS_PRODUCT_ID); syncing stays off until it is"
                    .to_string(),
            );
        }
        crate::Validator::stores(&file.stores, &mut errors);

        if !errors.is_empty() {
            return Err(ConfigError { problems: errors });
        }
        Ok(Loaded {
            config: Config {
                server,
                auth: AuthSettings { api_token },
                database,
                prices,
                llm,
                bank,
                stores: file.stores,
            },
            path,
            warnings,
        })
    }
}
