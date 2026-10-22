//! `--print-config`: the effective configuration as TOML-like text with every secret hidden and
//! the origin of each value noted.

use std::fmt::Write;
use std::path::Path;

use crate::load::{Config, Loaded, Secret, Setting};

pub struct Renderer;

impl Renderer {
    const HIDDEN: &'static str = "\"<hidden>\"";

    pub fn render(loaded: &Loaded) -> String {
        let c = &loaded.config;
        let mut out = String::new();
        let from = loaded
            .path
            .as_deref()
            .map(Path::display)
            .map(|d| d.to_string())
            .unwrap_or_else(|| "no config file; environment and defaults only".into());
        let _ = writeln!(out, "# effective configuration ({from})");
        let _ = writeln!(
            out,
            "# secrets are hidden; the comment on each line says where the value came from\n"
        );

        let _ = writeln!(out, "[server]");
        Self::line(
            &mut out,
            "bind",
            Self::q(&c.server.bind.value),
            &c.server.bind,
        );
        Self::line(
            &mut out,
            "web_dir",
            Self::opt(&c.server.web_dir.value),
            &c.server.web_dir,
        );
        let origins = format!(
            "[{}]",
            c.server
                .cors_origins
                .value
                .iter()
                .map(|o| Self::q(o))
                .collect::<Vec<_>>()
                .join(", ")
        );
        Self::line(&mut out, "cors_origins", origins, &c.server.cors_origins);
        Self::line(
            &mut out,
            "refresh_hours",
            c.server.refresh_hours.value.to_string(),
            &c.server.refresh_hours,
        );

        let _ = writeln!(out, "\n[auth]");
        Self::line(
            &mut out,
            "api_token",
            Self::secret(&c.auth.api_token.value),
            &c.auth.api_token,
        );

        let _ = writeln!(out, "\n[database]");
        Self::line(
            &mut out,
            "url",
            Self::q(&Self::hide_password(&c.database.url.value)),
            &c.database.url,
        );

        let _ = writeln!(out, "\n[prices]");
        Self::line(
            &mut out,
            "sources_file",
            Self::opt(&c.prices.sources_file.value),
            &c.prices.sources_file,
        );

        let _ = writeln!(out, "\n[llm]");
        Self::line(
            &mut out,
            "anthropic_api_key",
            Self::secret(&c.llm.anthropic_api_key.value),
            &c.llm.anthropic_api_key,
        );
        Self::line(
            &mut out,
            "openai_api_key",
            Self::secret(&c.llm.openai_api_key.value),
            &c.llm.openai_api_key,
        );
        Self::line(
            &mut out,
            "provider",
            c.llm
                .provider
                .value
                .map(|p| Self::q(p.as_str()))
                .unwrap_or_else(|| "(not set)".into()),
            &c.llm.provider,
        );

        let _ = writeln!(out, "\n[bank]");
        Self::line(
            &mut out,
            "fints_product_id",
            Self::secret(&c.bank.fints_product_id.value),
            &c.bank.fints_product_id,
        );
        Self::plaid(&mut out, c);
        Self::accounts(&mut out, c);
        Self::stores(&mut out, c);
        Self::receipts(&mut out, c);
        out
    }

    /// `user@example.org` -> `u***@example.org`.
    fn mask_login(login: &str) -> String {
        match login.split_once('@') {
            Some((user, domain)) => {
                format!("{}***@{domain}", user.chars().next().unwrap_or('*'))
            }
            None => "<hidden>".to_string(),
        }
    }

    fn receipts(out: &mut String, c: &Config) {
        let r = &c.receipts.value;
        let src = &c.receipts.source;
        let _ = writeln!(out, "\n[receipts.email]   # {src}");
        match &r.email {
            None => {
                let _ = writeln!(out, "# not configured");
            }
            Some(e) => {
                let _ = writeln!(out, "enabled = {}", e.enabled);
                let _ = writeln!(out, "host = {}", Self::q(&e.host));
                let _ = writeln!(out, "port = {}", e.port);
                let _ = writeln!(
                    out,
                    "username = {}",
                    Self::q(&Self::mask_login(&e.username))
                );
                let _ = writeln!(
                    out,
                    "password_env = {}   # read from that variable unless a password was entered in the app",
                    Self::q(&e.password_env)
                );
                if e.password.is_some() {
                    let _ = writeln!(out, "password = {}", Self::HIDDEN);
                }
                let _ = writeln!(out, "folder = {}", Self::q(&e.folder));
                let _ = writeln!(out, "poll_minutes = {}", e.poll_minutes);
                let _ = writeln!(out, "mark_seen = {}", e.mark_seen);
                let _ = writeln!(out, "max_age_days = {}", e.max_age_days);
                let senders = if e.senders.is_empty() {
                    "(built-in German retailers)".to_string()
                } else {
                    e.senders
                        .iter()
                        .map(|s| format!("{}: {}", s.retailer, s.from.join(", ")))
                        .collect::<Vec<_>>()
                        .join("; ")
                };
                let _ = writeln!(out, "# senders: {senders}");
            }
        }
        let l = &r.lidl_plus;
        let _ = writeln!(out, "\n[receipts.lidl_plus]   # {src}");
        let _ = writeln!(out, "enabled = {}", l.enabled);
        let _ = writeln!(out, "country = {}", Self::q(&l.country));
        let _ = writeln!(out, "language = {}", Self::q(&l.language));
        let _ = writeln!(out, "poll_hours = {}", l.poll_hours);
        let overridden = [
            ("client_id", &l.client_id),
            ("authorize_url", &l.authorize_url),
            ("token_url", &l.token_url),
            ("tickets_url", &l.tickets_url),
            ("redirect_uri", &l.redirect_uri),
            ("scope", &l.scope),
        ];
        for (name, v) in overridden {
            if let Some(v) = v {
                let _ = writeln!(
                    out,
                    "{name} = {}   # overrides the built-in value",
                    Self::q(v)
                );
            }
        }
        let _ = writeln!(
            out,
            "# the refresh token is kept encrypted in the database, never in this file"
        );
        let _ = writeln!(out, "\n[receipts.folder]   # {src}");
        match &r.folder {
            None => {
                let _ = writeln!(out, "# not configured");
            }
            Some(f) => {
                let _ = writeln!(out, "enabled = {}", f.enabled);
                let _ = writeln!(out, "path = {}", Self::q(&f.path.to_string_lossy()));
                let _ = writeln!(out, "poll_seconds = {}", f.poll_seconds);
                let _ = writeln!(
                    out,
                    "on_done = {:?}",
                    format!("{:?}", f.on_done).to_lowercase()
                );
            }
        }
    }

    /// `[bank.plaid]`: shown only when something about it is set. The client id and the secret
    /// are never printed.
    fn plaid(out: &mut String, c: &Config) {
        let p = &c.bank.plaid;
        let used = p.configured()
            || p.client_id.value.is_some()
            || p.secret.value.is_some()
            || c.bank.accounts.iter().any(|a| a.kind == "plaid");
        if !used {
            return;
        }
        let _ = writeln!(out, "\n[bank.plaid]");
        Self::line(
            out,
            "client_id",
            Self::secret(&p.client_id.value),
            &p.client_id,
        );
        Self::line(out, "secret", Self::secret(&p.secret.value), &p.secret);
        Self::line(
            out,
            "environment",
            Self::q(&p.environment.value),
            &p.environment,
        );
        let _ = writeln!(
            out,
            "country_codes = [{}]",
            p.country_codes
                .iter()
                .map(|c| Self::q(c))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let _ = writeln!(out, "language = {}", Self::q(&p.language));
    }

    fn accounts(out: &mut String, c: &Config) {
        for a in &c.bank.accounts {
            let _ = writeln!(out, "\n[[bank.accounts]]   # {}", c.bank.accounts_source);
            let _ = writeln!(out, "name = {}", Self::q(&a.name));
            let _ = writeln!(out, "kind = {}", Self::q(&a.kind));
            if a.kind == "plaid" {
                if !a.account_ids.is_empty() {
                    let _ = writeln!(
                        out,
                        "account_ids = {}   # {} account(s)",
                        Self::HIDDEN,
                        a.account_ids.len()
                    );
                }
                let _ = writeln!(out, "sync_every_hours = {}", a.sync_every_hours);
                if let Some(d) = a.since_days {
                    let _ = writeln!(out, "since_days = {d}");
                }
                continue;
            }
            let _ = writeln!(out, "bank_code = {}", Self::q(&a.bank_code));
            let _ = writeln!(out, "login = {}", Self::HIDDEN);
            let _ = writeln!(out, "iban = {}", Self::HIDDEN);
            if let Some(url) = &a.fints_url {
                let _ = writeln!(out, "fints_url = {}", Self::q(url));
            }
            match &a.pin_env {
                Some(var) => {
                    let _ = writeln!(out, "pin_env = {}", Self::q(var));
                }
                None => {
                    let _ = writeln!(out, "# pin_env not set: the PIN is typed in the app");
                }
            }
            let _ = writeln!(out, "sync_every_hours = {}", a.sync_every_hours);
            if let Some(d) = a.since_days {
                let _ = writeln!(out, "since_days = {d}");
            }
        }
    }

    fn stores(out: &mut String, c: &Config) {
        for s in &c.stores {
            let _ = writeln!(out, "\n[[stores]]   # {}", c.stores_source);
            let _ = writeln!(out, "chain = {}", Self::q(&s.chain));
            let list = s
                .patterns
                .to_vec()
                .iter()
                .map(|p| Self::q(p))
                .collect::<Vec<_>>()
                .join(", ");
            let _ = writeln!(out, "match = [{list}]");
        }
    }

    fn line<T>(out: &mut String, key: &str, value: String, setting: &Setting<T>) {
        let _ = writeln!(out, "{key} = {value}   # {}", setting.source);
    }

    fn q(s: &str) -> String {
        format!("{s:?}")
    }

    fn opt(v: &Option<String>) -> String {
        v.as_deref()
            .map(Self::q)
            .unwrap_or_else(|| "(not set)".into())
    }

    fn secret(v: &Option<Secret>) -> String {
        match v {
            Some(_) => Self::HIDDEN.to_string(),
            None => "(not set)".into(),
        }
    }

    /// `postgres://user:pass@host/db` -> `postgres://user:<hidden>@host/db`.
    pub fn hide_password(url: &str) -> String {
        let Some((scheme, rest)) = url.split_once("://") else {
            return url.to_string();
        };
        let Some((auth, host)) = rest.split_once('@') else {
            return url.to_string();
        };
        match auth.split_once(':') {
            Some((user, _)) => format!("{scheme}://{user}:<hidden>@{host}"),
            None => url.to_string(),
        }
    }
}
