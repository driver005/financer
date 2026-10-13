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
        Self::accounts(&mut out, c);
        Self::stores(&mut out, c);
        let _ = writeln!(out, "\n[receipts]\n# reserved");
        out
    }

    fn accounts(out: &mut String, c: &Config) {
        for a in &c.bank.accounts {
            let _ = writeln!(out, "\n[[bank.accounts]]   # file");
            let _ = writeln!(out, "name = {}", Self::q(&a.name));
            let _ = writeln!(out, "kind = {}", Self::q(&a.kind));
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
            let _ = writeln!(out, "\n[[stores]]   # file");
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
