//! Settings of the mail client, read from `FINANCER_MAIL_*` environment variables (like the shopping
//! assistant). The mailbox password is only ever read from the environment and never stored.

use financer_mail_core::{Address, Zone};

/// How the SMTP connection is secured. Plain connections are not supported on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtpSecurity {
    /// TLS from the first byte (port 465).
    Tls,
    /// Start plain, upgrade with STARTTLS before logging in (port 587).
    StartTls,
}

#[derive(Clone)]
pub struct MailConfig {
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: SmtpSecurity,
    pub username: String,
    pub password: String,
    /// The address mail is sent from; also how your own messages are recognised.
    pub address: Address,
    /// Further addresses that are also you (aliases).
    pub aliases: Vec<String>,
    pub inbox: String,
    pub sent: String,
    /// Minutes between background syncs; 0 syncs only when asked.
    pub poll_minutes: u64,
    /// On the first sync, how far back to read.
    pub max_age_days: u32,
    /// The zone of the calendar.
    pub zone: Zone,
    pub zone_name: String,
}

impl std::fmt::Debug for MailConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MailConfig")
            .field("imap_host", &self.imap_host)
            .field("smtp_host", &self.smtp_host)
            .field("username", &self.username)
            .field("password", &"<redacted>")
            .field("address", &self.address.email)
            .finish_non_exhaustive()
    }
}

impl MailConfig {
    /// Every address that is you.
    pub fn my_addresses(&self) -> Vec<String> {
        let mut all = vec![self.address.email.clone()];
        all.extend(self.aliases.iter().cloned());
        all
    }
}

/// What the environment asked for.
#[derive(Debug, Clone)]
pub struct MailSetup {
    pub database_url: String,
    /// `None` until a mailbox is configured; the templates and the calendar still work.
    pub config: Option<MailConfig>,
}

impl MailSetup {
    /// Read `FINANCER_MAIL_*` settings. `default_database` is used when none is given.
    ///
    /// | Variable | Meaning |
    /// |---|---|
    /// | `FINANCER_MAIL_DATABASE_URL` | `sqlite://...` or `postgres://...` |
    /// | `FINANCER_MAIL_IMAP_HOST`, `_IMAP_PORT` | the incoming server, TLS only (default port 993) |
    /// | `FINANCER_MAIL_SMTP_HOST`, `_SMTP_PORT`, `_SMTP_SECURITY` | the outgoing server (default: `imap.` becomes `smtp.`, port 465; `tls` or `starttls`, `starttls` for port 587) |
    /// | `FINANCER_MAIL_USERNAME`, `FINANCER_MAIL_PASSWORD` | the login (use an app password) |
    /// | `FINANCER_MAIL_ADDRESS`, `FINANCER_MAIL_NAME`, `FINANCER_MAIL_ALIASES` | who you are (address defaults to the username) |
    /// | `FINANCER_MAIL_INBOX`, `FINANCER_MAIL_SENT` | folder names (`INBOX`, `Sent`) |
    /// | `FINANCER_MAIL_POLL_MINUTES`, `FINANCER_MAIL_MAX_AGE_DAYS` | background sync (5; 0 = off) and first-sync history (90) |
    /// | `FINANCER_MAIL_TIMEZONE` | the calendar's zone, a European one (default `Europe/Berlin`) |
    pub fn from_lookup(
        get: &dyn Fn(&str) -> Option<String>,
        default_database: &str,
    ) -> Result<MailSetup, String> {
        let var = |k: &str| {
            get(k)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let number = |k: &str, default: u64, max: u64| match var(k) {
            None => Ok(default),
            Some(v) => match v.parse::<u64>() {
                Ok(n) if n <= max => Ok(n),
                _ => Err(format!("{k}: {v:?} is not a number between 0 and {max}")),
            },
        };
        let database_url =
            var("FINANCER_MAIL_DATABASE_URL").unwrap_or_else(|| default_database.to_string());
        let Some(imap_host) = var("FINANCER_MAIL_IMAP_HOST") else {
            return Ok(MailSetup {
                database_url,
                config: None,
            });
        };
        let username = var("FINANCER_MAIL_USERNAME")
            .ok_or("FINANCER_MAIL_USERNAME is needed with FINANCER_MAIL_IMAP_HOST")?;
        let password = var("FINANCER_MAIL_PASSWORD")
            .ok_or("FINANCER_MAIL_PASSWORD is needed with FINANCER_MAIL_IMAP_HOST")?;
        let address_text = var("FINANCER_MAIL_ADDRESS").unwrap_or_else(|| username.clone());
        let address = Address::new(var("FINANCER_MAIL_NAME").as_deref(), &address_text)
            .ok_or_else(|| format!("FINANCER_MAIL_ADDRESS: {address_text:?} is not an email address (set it when the username is not one)"))?;
        let aliases = var("FINANCER_MAIL_ALIASES")
            .map(|v| {
                Address::parse_list(&v)
                    .into_iter()
                    .map(|a| a.email)
                    .collect()
            })
            .unwrap_or_default();
        let imap_port = number("FINANCER_MAIL_IMAP_PORT", 993, 65535)? as u16;
        let smtp_port = number("FINANCER_MAIL_SMTP_PORT", 465, 65535)? as u16;
        let smtp_security = match var("FINANCER_MAIL_SMTP_SECURITY")
            .map(|v| v.to_lowercase())
            .as_deref()
        {
            None => {
                if smtp_port == 587 {
                    SmtpSecurity::StartTls
                } else {
                    SmtpSecurity::Tls
                }
            }
            Some("tls" | "ssl") => SmtpSecurity::Tls,
            Some("starttls") => SmtpSecurity::StartTls,
            Some(other) => {
                return Err(format!(
                    "FINANCER_MAIL_SMTP_SECURITY: {other:?} is not tls or starttls"
                ))
            }
        };
        let smtp_host = var("FINANCER_MAIL_SMTP_HOST").unwrap_or_else(|| {
            match imap_host.strip_prefix("imap.") {
                Some(rest) => format!("smtp.{rest}"),
                None => imap_host.clone(),
            }
        });
        let zone_name =
            var("FINANCER_MAIL_TIMEZONE").unwrap_or_else(|| "Europe/Berlin".to_string());
        let zone = Zone::from_name(&zone_name).ok_or_else(|| {
            format!("FINANCER_MAIL_TIMEZONE: {zone_name:?} is not known here (use a European zone such as Europe/Berlin, or UTC)")
        })?;
        Ok(MailSetup {
            database_url,
            config: Some(MailConfig {
                imap_host,
                imap_port,
                smtp_host,
                smtp_port,
                smtp_security,
                username,
                password,
                address,
                aliases,
                inbox: var("FINANCER_MAIL_INBOX").unwrap_or_else(|| "INBOX".into()),
                sent: var("FINANCER_MAIL_SENT").unwrap_or_else(|| "Sent".into()),
                poll_minutes: number("FINANCER_MAIL_POLL_MINUTES", 5, 24 * 60)?,
                max_age_days: number("FINANCER_MAIL_MAX_AGE_DAYS", 90, 3650)? as u32,
                zone,
                zone_name,
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn setup(vars: &[(&str, &str)]) -> Result<MailSetup, String> {
        let map: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        MailSetup::from_lookup(&|k| map.get(k).cloned(), "sqlite://default.db?mode=rwc")
    }

    #[test]
    fn nothing_configured_still_gives_a_database() {
        let s = setup(&[]).unwrap();
        assert!(s.config.is_none());
        assert_eq!(s.database_url, "sqlite://default.db?mode=rwc");
        assert_eq!(
            setup(&[("FINANCER_MAIL_DATABASE_URL", "postgres://x")])
                .unwrap()
                .database_url,
            "postgres://x"
        );
    }

    #[test]
    fn a_minimal_mailbox_gets_sensible_defaults() {
        let c = setup(&[
            ("FINANCER_MAIL_IMAP_HOST", "imap.example.org"),
            ("FINANCER_MAIL_USERNAME", "paul@example.org"),
            ("FINANCER_MAIL_PASSWORD", "app-password"),
        ])
        .unwrap()
        .config
        .unwrap();
        assert_eq!(
            (c.imap_port, c.smtp_port, c.smtp_security),
            (993, 465, SmtpSecurity::Tls)
        );
        assert_eq!(c.smtp_host, "smtp.example.org");
        assert_eq!(c.address.email, "paul@example.org");
        assert_eq!(
            (
                c.inbox.as_str(),
                c.sent.as_str(),
                c.poll_minutes,
                c.max_age_days
            ),
            ("INBOX", "Sent", 5, 90)
        );
        assert_eq!(c.zone, Zone::BERLIN);
    }

    #[test]
    fn port_587_means_starttls_and_everything_can_be_set() {
        let c = setup(&[
            ("FINANCER_MAIL_IMAP_HOST", "mail.example.org"),
            ("FINANCER_MAIL_USERNAME", "paul"),
            ("FINANCER_MAIL_PASSWORD", "pw"),
            ("FINANCER_MAIL_ADDRESS", "paul@example.org"),
            ("FINANCER_MAIL_NAME", "Paul Meier"),
            ("FINANCER_MAIL_ALIASES", "p@example.org, paul@other.de"),
            ("FINANCER_MAIL_SMTP_PORT", "587"),
            ("FINANCER_MAIL_SENT", "Gesendet"),
            ("FINANCER_MAIL_TIMEZONE", "Europe/London"),
        ])
        .unwrap()
        .config
        .unwrap();
        assert_eq!(c.smtp_security, SmtpSecurity::StartTls);
        assert_eq!(c.smtp_host, "mail.example.org");
        assert_eq!(c.address.header(), "Paul Meier <paul@example.org>");
        assert_eq!(
            c.my_addresses(),
            ["paul@example.org", "p@example.org", "paul@other.de"]
        );
        assert_eq!(c.sent, "Gesendet");
        assert_eq!(c.zone, Zone::Eu { std_hours: 0 });
    }

    #[test]
    fn mistakes_are_named() {
        let base = [
            ("FINANCER_MAIL_IMAP_HOST", "imap.x.de"),
            ("FINANCER_MAIL_USERNAME", "paul"),
            ("FINANCER_MAIL_ADDRESS", "paul@x.de"),
            ("FINANCER_MAIL_PASSWORD", "pw"),
        ];
        let with = |extra: (&'static str, &'static str)| {
            let mut v = base.to_vec();
            v.push(extra);
            setup(&v)
        };
        assert!(with(("FINANCER_MAIL_ADDRESS", "nonsense"))
            .unwrap_err()
            .contains("not an email address"));
        assert!(with(("FINANCER_MAIL_SMTP_SECURITY", "plain"))
            .unwrap_err()
            .contains("tls or starttls"));
        assert!(with(("FINANCER_MAIL_IMAP_PORT", "abc"))
            .unwrap_err()
            .contains("FINANCER_MAIL_IMAP_PORT"));
        assert!(with(("FINANCER_MAIL_TIMEZONE", "Asia/Tokyo"))
            .unwrap_err()
            .contains("European"));
        assert!(setup(&[("FINANCER_MAIL_IMAP_HOST", "imap.x.de")])
            .unwrap_err()
            .contains("USERNAME"));
        assert!(setup(&[
            ("FINANCER_MAIL_IMAP_HOST", "imap.x.de"),
            ("FINANCER_MAIL_USERNAME", "p@x.de")
        ])
        .unwrap_err()
        .contains("PASSWORD"));
    }

    #[test]
    fn the_password_is_never_in_debug_output() {
        let c = setup(&[
            ("FINANCER_MAIL_IMAP_HOST", "imap.x.de"),
            ("FINANCER_MAIL_USERNAME", "p@x.de"),
            ("FINANCER_MAIL_PASSWORD", "hunter2secret"),
        ])
        .unwrap()
        .config
        .unwrap();
        assert!(!format!("{c:?}").contains("hunter2secret"));
    }
}
