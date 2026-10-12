//! Configuration of the three receipt sources.
//!
//! [`ReceiptSourcesConfig`] is the `[receipts]` table of the server's TOML file; the config loader
//! embeds it as one field. It can also be built from environment variables
//! ([`ReceiptSourcesConfig::from_env`]) until that loader exists. Secrets never live in this
//! structure: the mailbox password is read from the environment variable named by
//! `password_env`, and the Lidl Plus token lives encrypted in the database.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Environment variable holding the mailbox password unless `password_env` says otherwise.
pub const DEFAULT_PASSWORD_ENV: &str = "FINANCER_IMAP_PASSWORD";

/// The three kinds of source. The key is also the `source` stored on a receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Email,
    LidlPlus,
    Folder,
}

impl SourceKind {
    pub const ALL: [SourceKind; 3] = [SourceKind::Email, SourceKind::LidlPlus, SourceKind::Folder];

    /// `email`, `lidl_plus` or `folder`.
    pub fn key(self) -> &'static str {
        match self {
            SourceKind::Email => "email",
            SourceKind::LidlPlus => "lidl_plus",
            SourceKind::Folder => "folder",
        }
    }

    pub fn from_key(key: &str) -> Option<SourceKind> {
        Self::ALL.into_iter().find(|k| k.key() == key)
    }
}

/// Which sender addresses count as which retailer's receipts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SenderRule {
    /// Brand the mails belong to (`rewe`, `lidl`, `edeka`, ...), or `auto` to work it out from
    /// the receipt itself (for mails you forward to yourself).
    #[serde(default = "default_auto")]
    pub retailer: String,
    /// Exact addresses (`ebon@example.de`) or domains (`rewe.de` matches `mail.rewe.de` too).
    pub from: Vec<String>,
    /// When not empty, the subject must contain one of these (case-insensitive).
    #[serde(default)]
    pub subject_contains: Vec<String>,
}

fn default_auto() -> String {
    "auto".into()
}

impl SenderRule {
    fn new(retailer: &str, from: &[&str]) -> Self {
        SenderRule {
            retailer: retailer.into(),
            from: from.iter().map(|s| s.to_string()).collect(),
            subject_contains: Vec::new(),
        }
    }

    /// The rules used when `senders` is not set: the German retailers' own domains. These
    /// addresses are a best guess, not verified against real mail (see docs/RECEIPT_SOURCES.md).
    pub fn defaults() -> Vec<SenderRule> {
        vec![
            Self::new("rewe", &["rewe.de", "rewe-group.com"]),
            Self::new("lidl", &["lidl.de", "lidl.com", "lidlplus.com"]),
            Self::new("kaufland", &["kaufland.de"]),
            Self::new("edeka", &["edeka.de"]),
            Self::new("dm", &["dm.de"]),
            Self::new("rossmann", &["rossmann.de"]),
            Self::new("penny", &["penny.de"]),
            Self::new("netto", &["netto-online.de"]),
        ]
    }

    /// Does `from` (an email address) belong to this rule?
    pub fn matches_sender(&self, from: &str) -> bool {
        let addr = from.trim().to_lowercase();
        let addr = match (addr.rfind('<'), addr.rfind('>')) {
            (Some(a), Some(b)) if a < b => addr[a + 1..b].trim().to_string(),
            _ => addr,
        };
        let Some((_, domain)) = addr.rsplit_once('@') else {
            return false;
        };
        self.from.iter().any(|p| {
            let p = p.trim().to_lowercase();
            if p.is_empty() {
                false
            } else if p.contains('@') && !p.starts_with('@') {
                addr == p
            } else {
                let d = p.trim_start_matches('@');
                domain == d || domain.ends_with(&format!(".{d}"))
            }
        })
    }

    pub fn matches_subject(&self, subject: &str) -> bool {
        if self.subject_contains.is_empty() {
            return true;
        }
        let s = subject.to_lowercase();
        self.subject_contains
            .iter()
            .any(|w| s.contains(&w.to_lowercase()))
    }
}

/// `[receipts.email]`: read receipt mails over IMAP (implicit TLS).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailConfig {
    /// Switch the source off without deleting its settings.
    #[serde(default = "yes")]
    pub enabled: bool,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    /// Name of the environment variable that holds the password (never the password itself).
    #[serde(default = "default_password_env")]
    pub password_env: String,
    #[serde(default = "default_folder")]
    pub folder: String,
    #[serde(default = "default_poll_minutes")]
    pub poll_minutes: u64,
    /// Mark processed receipt mails as read. Off by default: the mailbox is only read.
    #[serde(default)]
    pub mark_seen: bool,
    /// On the first run, only look at mails this many days old or newer.
    #[serde(default = "default_max_age_days")]
    pub max_age_days: u32,
    /// Which senders are receipt mails. Empty means the built-in German defaults.
    #[serde(default)]
    pub senders: Vec<SenderRule>,
}

fn yes() -> bool {
    true
}
fn default_port() -> u16 {
    993
}
fn default_password_env() -> String {
    DEFAULT_PASSWORD_ENV.into()
}
fn default_folder() -> String {
    "INBOX".into()
}
fn default_poll_minutes() -> u64 {
    30
}
fn default_max_age_days() -> u32 {
    90
}

impl EmailConfig {
    /// The sender rules in force: the configured ones, or the defaults.
    pub fn effective_senders(&self) -> Vec<SenderRule> {
        if self.senders.is_empty() {
            SenderRule::defaults()
        } else {
            self.senders.clone()
        }
    }

    pub fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_secs(self.poll_minutes.clamp(1, 24 * 60) * 60)
    }
}

/// `[receipts.lidl_plus]`: experimental, unofficial, off by default.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LidlPlusConfig {
    pub enabled: bool,
    /// Two-letter country code of your Lidl Plus account (`DE`, `AT`, ...).
    pub country: String,
    /// Language code (`de`, `en`, ...).
    pub language: String,
    pub poll_hours: u64,
    /// Overrides for the constants in `lidl::consts` (only if Lidl changes them).
    pub client_id: Option<String>,
    pub authorize_url: Option<String>,
    pub token_url: Option<String>,
    pub tickets_url: Option<String>,
    pub redirect_uri: Option<String>,
    pub scope: Option<String>,
}

impl Default for LidlPlusConfig {
    fn default() -> Self {
        LidlPlusConfig {
            enabled: false,
            country: "DE".into(),
            language: "de".into(),
            poll_hours: 12,
            client_id: None,
            authorize_url: None,
            token_url: None,
            tickets_url: None,
            redirect_uri: None,
            scope: None,
        }
    }
}

impl LidlPlusConfig {
    pub fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_secs(self.poll_hours.clamp(1, 24 * 14) * 3600)
    }
}

/// What to do with a file after importing it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnDone {
    /// Leave it where it is; its content hash is remembered in the database.
    #[default]
    Keep,
    /// Move it to a `done/` subfolder.
    Move,
}

/// `[receipts.folder]`: import receipts dropped into a directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderConfig {
    #[serde(default = "yes")]
    pub enabled: bool,
    pub path: PathBuf,
    #[serde(default = "default_poll_seconds")]
    pub poll_seconds: u64,
    #[serde(default)]
    pub on_done: OnDone,
}

fn default_poll_seconds() -> u64 {
    60
}

impl FolderConfig {
    pub fn poll_interval(&self) -> std::time::Duration {
        std::time::Duration::from_secs(self.poll_seconds.clamp(10, 24 * 3600))
    }
}

/// The `[receipts]` table.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ReceiptSourcesConfig {
    pub email: Option<EmailConfig>,
    pub lidl_plus: LidlPlusConfig,
    pub folder: Option<FolderConfig>,
}

impl ReceiptSourcesConfig {
    /// True when at least one source is switched on.
    pub fn any_enabled(&self) -> bool {
        self.email.as_ref().is_some_and(|e| e.enabled)
            || self.lidl_plus.enabled
            || self.folder.as_ref().is_some_and(|f| f.enabled)
    }

    /// Settings problems worth refusing to start with, in plain language.
    pub fn problems(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(e) = self.email.as_ref().filter(|e| e.enabled) {
            if e.host.trim().is_empty() {
                out.push("receipts.email.host is empty".into());
            }
            if e.username.trim().is_empty() {
                out.push("receipts.email.username is empty".into());
            }
            if e.port == 0 {
                out.push("receipts.email.port must not be 0".into());
            }
            if e.password_env.trim().is_empty() {
                out.push("receipts.email.password_env is empty".into());
            }
        }
        if self.lidl_plus.enabled {
            let c = &self.lidl_plus;
            if c.country.trim().len() != 2 || !c.country.bytes().all(|b| b.is_ascii_alphabetic()) {
                out.push("receipts.lidl_plus.country must be a two-letter code such as DE".into());
            }
            if c.language.trim().len() != 2 || !c.language.bytes().all(|b| b.is_ascii_alphabetic())
            {
                out.push("receipts.lidl_plus.language must be a two-letter code such as de".into());
            }
        }
        if let Some(f) = self.folder.as_ref().filter(|f| f.enabled) {
            if f.path.as_os_str().is_empty() {
                out.push("receipts.folder.path is empty".into());
            }
        }
        out
    }

    /// Build from the process environment (see [`Self::from_env_with`]).
    pub fn from_env() -> Result<Self, String> {
        Self::from_env_with(|k| std::env::var(k).ok())
    }

    /// Build from variables, until the TOML loader embeds this type:
    ///
    /// - `FINANCER_RECEIPTS_IMAP_HOST` (enables the mailbox), `_PORT`, `_USERNAME`, `_FOLDER`,
    ///   `_POLL_MINUTES`, `_MARK_SEEN` (`1`/`true`), `_MAX_AGE_DAYS`, `_PASSWORD_ENV`
    ///   (the *name* of the variable holding the password, default `FINANCER_IMAP_PASSWORD`),
    ///   `_SENDERS` (`rewe=rewe.de,rewe-group.com;lidl=lidl.de`)
    /// - `FINANCER_RECEIPTS_LIDL_PLUS` (`1` enables), `FINANCER_RECEIPTS_LIDL_COUNTRY`,
    ///   `_LANGUAGE`, `_POLL_HOURS`
    /// - `FINANCER_RECEIPTS_FOLDER` (the path; enables), `_POLL_SECONDS`, `_ON_DONE` (`keep`/`move`)
    pub fn from_env_with(get: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let var = |k: &str| get(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        fn num<T: std::str::FromStr>(name: &str, v: Option<String>) -> Result<Option<T>, String> {
            v.map(|s| {
                s.parse::<T>()
                    .map_err(|_| format!("{name} must be a whole number"))
            })
            .transpose()
        }
        fn flag(v: Option<String>) -> bool {
            v.is_some_and(|s| matches!(s.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        }

        let mut cfg = ReceiptSourcesConfig::default();

        if let Some(host) = var("FINANCER_RECEIPTS_IMAP_HOST") {
            let username = var("FINANCER_RECEIPTS_IMAP_USERNAME")
                .ok_or("FINANCER_RECEIPTS_IMAP_USERNAME is not set")?;
            let mut senders = Vec::new();
            if let Some(spec) = var("FINANCER_RECEIPTS_IMAP_SENDERS") {
                for part in spec.split(';').filter(|p| !p.trim().is_empty()) {
                    let (retailer, from) = part
                        .split_once('=')
                        .ok_or("FINANCER_RECEIPTS_IMAP_SENDERS: use retailer=domain,domain;...")?;
                    senders.push(SenderRule {
                        retailer: retailer.trim().to_lowercase(),
                        from: from
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect(),
                        subject_contains: Vec::new(),
                    });
                }
            }
            cfg.email = Some(EmailConfig {
                enabled: true,
                host,
                port: num("FINANCER_RECEIPTS_IMAP_PORT", var("FINANCER_RECEIPTS_IMAP_PORT"))?
                    .unwrap_or_else(default_port),
                username,
                password_env: var("FINANCER_RECEIPTS_IMAP_PASSWORD_ENV")
                    .unwrap_or_else(default_password_env),
                folder: var("FINANCER_RECEIPTS_IMAP_FOLDER").unwrap_or_else(default_folder),
                poll_minutes: num(
                    "FINANCER_RECEIPTS_IMAP_POLL_MINUTES",
                    var("FINANCER_RECEIPTS_IMAP_POLL_MINUTES"),
                )?
                .unwrap_or_else(default_poll_minutes),
                mark_seen: flag(var("FINANCER_RECEIPTS_IMAP_MARK_SEEN")),
                max_age_days: num(
                    "FINANCER_RECEIPTS_IMAP_MAX_AGE_DAYS",
                    var("FINANCER_RECEIPTS_IMAP_MAX_AGE_DAYS"),
                )?
                .unwrap_or_else(default_max_age_days),
                senders,
            });
        }

        if flag(var("FINANCER_RECEIPTS_LIDL_PLUS")) {
            let mut l = LidlPlusConfig {
                enabled: true,
                ..Default::default()
            };
            if let Some(c) = var("FINANCER_RECEIPTS_LIDL_COUNTRY") {
                l.country = c.to_uppercase();
            }
            if let Some(c) = var("FINANCER_RECEIPTS_LIDL_LANGUAGE") {
                l.language = c.to_lowercase();
            }
            if let Some(h) = num(
                "FINANCER_RECEIPTS_LIDL_POLL_HOURS",
                var("FINANCER_RECEIPTS_LIDL_POLL_HOURS"),
            )? {
                l.poll_hours = h;
            }
            cfg.lidl_plus = l;
        }

        if let Some(path) = var("FINANCER_RECEIPTS_FOLDER") {
            let on_done = match var("FINANCER_RECEIPTS_FOLDER_ON_DONE").as_deref() {
                None | Some("keep") => OnDone::Keep,
                Some("move") => OnDone::Move,
                Some(_) => return Err("FINANCER_RECEIPTS_FOLDER_ON_DONE must be keep or move".into()),
            };
            cfg.folder = Some(FolderConfig {
                enabled: true,
                path: PathBuf::from(path),
                poll_seconds: num(
                    "FINANCER_RECEIPTS_FOLDER_POLL_SECONDS",
                    var("FINANCER_RECEIPTS_FOLDER_POLL_SECONDS"),
                )?
                .unwrap_or_else(default_poll_seconds),
                on_done,
            });
        }

        let problems = cfg.problems();
        if let Some(p) = problems.first() {
            return Err(p.clone());
        }
        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| m.get(k).cloned()
    }

    #[test]
    fn nothing_configured_means_nothing_enabled() {
        let c = ReceiptSourcesConfig::from_env_with(env(&[])).unwrap();
        assert_eq!(c, ReceiptSourcesConfig::default());
        assert!(!c.any_enabled());
        assert!(!c.lidl_plus.enabled, "Lidl Plus is off unless asked for");
    }

    #[test]
    fn toml_table_with_defaults_and_unknown_keys_rejected() {
        let c: ReceiptSourcesConfig = toml::from_str(
            "[email]\nhost = \"imap.example.org\"\nusername = \"me@example.org\"\n",
        )
        .unwrap();
        let e = c.email.unwrap();
        assert_eq!(
            (e.port, e.folder.as_str(), e.poll_minutes, e.mark_seen, e.max_age_days),
            (993, "INBOX", 30, false, 90)
        );
        assert_eq!(e.password_env, DEFAULT_PASSWORD_ENV);
        assert_eq!(e.effective_senders(), SenderRule::defaults());

        assert!(toml::from_str::<ReceiptSourcesConfig>("[email]\nhost = \"x\"\nusername = \"u\"\npassword = \"nope\"\n").is_err());
        assert!(toml::from_str::<ReceiptSourcesConfig>("bogus = 1\n").is_err());
        assert!(toml::from_str::<ReceiptSourcesConfig>("[lidl_plus]\nenabled = true\nnope = 1\n").is_err());
        // host and username have no defaults
        assert!(toml::from_str::<ReceiptSourcesConfig>("[email]\nhost = \"x\"\n").is_err());
    }

    #[test]
    fn env_builds_each_source() {
        let c = ReceiptSourcesConfig::from_env_with(env(&[
            ("FINANCER_RECEIPTS_IMAP_HOST", "imap.example.org"),
            ("FINANCER_RECEIPTS_IMAP_USERNAME", "me@example.org"),
            ("FINANCER_RECEIPTS_IMAP_PORT", "1993"),
            ("FINANCER_RECEIPTS_IMAP_MARK_SEEN", "true"),
            (
                "FINANCER_RECEIPTS_IMAP_SENDERS",
                "rewe=rewe.de, ebon@mail.rewe.de ; lidl=lidl.de",
            ),
            ("FINANCER_RECEIPTS_LIDL_PLUS", "1"),
            ("FINANCER_RECEIPTS_LIDL_COUNTRY", "at"),
            ("FINANCER_RECEIPTS_FOLDER", "/data/receipts"),
            ("FINANCER_RECEIPTS_FOLDER_ON_DONE", "move"),
        ]))
        .unwrap();
        let e = c.email.as_ref().unwrap();
        assert_eq!((e.port, e.mark_seen), (1993, true));
        assert_eq!(e.senders.len(), 2);
        assert_eq!(e.senders[0].from, vec!["rewe.de", "ebon@mail.rewe.de"]);
        assert_eq!(c.lidl_plus.country, "AT");
        assert!(c.lidl_plus.enabled);
        let f = c.folder.as_ref().unwrap();
        assert_eq!((f.path.to_str(), f.on_done), (Some("/data/receipts"), OnDone::Move));
        assert!(c.any_enabled());
    }

    #[test]
    fn env_errors_are_plain() {
        let e = ReceiptSourcesConfig::from_env_with(env(&[("FINANCER_RECEIPTS_IMAP_HOST", "h")]))
            .unwrap_err();
        assert!(e.contains("USERNAME"), "{e}");
        let e = ReceiptSourcesConfig::from_env_with(env(&[
            ("FINANCER_RECEIPTS_IMAP_HOST", "h"),
            ("FINANCER_RECEIPTS_IMAP_USERNAME", "u"),
            ("FINANCER_RECEIPTS_IMAP_PORT", "abc"),
        ]))
        .unwrap_err();
        assert!(e.contains("PORT"), "{e}");
        let e = ReceiptSourcesConfig::from_env_with(env(&[
            ("FINANCER_RECEIPTS_LIDL_PLUS", "1"),
            ("FINANCER_RECEIPTS_LIDL_COUNTRY", "Germany"),
        ]))
        .unwrap_err();
        assert!(e.contains("country"), "{e}");
    }

    #[test]
    fn sender_rules_match_addresses_and_domains() {
        let r = SenderRule {
            retailer: "rewe".into(),
            from: vec!["rewe.de".into(), "ebon@shop.example.com".into()],
            subject_contains: vec!["eBon".into()],
        };
        assert!(r.matches_sender("ebon@mailing.rewe.de"));
        assert!(r.matches_sender("Rewe <noreply@REWE.de>"));
        assert!(r.matches_sender("ebon@shop.example.com"));
        assert!(!r.matches_sender("other@shop.example.com"));
        assert!(!r.matches_sender("x@notrewe.de"), "a longer domain is not a match");
        assert!(!r.matches_sender("x@rewe.de.evil.example"));
        assert!(!r.matches_sender("no-address"));
        assert!(r.matches_subject("Ihr REWE eBon vom 02.03."));
        assert!(!r.matches_subject("Angebote der Woche"));
    }
}
