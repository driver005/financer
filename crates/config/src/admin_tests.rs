use std::path::Path;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::*;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
const IBAN: &str = "DE89 3704 0044 0532 0130 00";

/// An admin over a fresh folder with this config file and environment.
struct Rig {
    dir: tempfile::TempDir,
    admin: Admin,
}

impl Rig {
    fn new(file_text: &str, env: &[(&str, &str)]) -> Self {
        let mut all = vec![("FINANCER_API_TOKEN", TOKEN)];
        all.extend_from_slice(env);
        Self::with_env(file_text, &all)
    }

    /// Exactly this environment (no token unless it brings one).
    fn with_env(file_text: &str, env: &[(&str, &str)]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("financer.toml");
        std::fs::write(&config, file_text).unwrap();
        let all = env.to_vec();
        let admin = Admin::new(
            Some(config),
            dir.path().to_path_buf(),
            Arc::new(MapEnv::new(&all)),
            SettingsFile::at(dir.path().join(SETTINGS_FILE_NAME)),
        );
        Self { dir, admin }
    }

    fn set(&self, pairs: &[(&str, Value)]) -> Result<Update, UpdateError> {
        self.admin.update(&Change {
            set: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            reset: Vec::new(),
        })
    }

    fn reset(&self, paths: &[&str]) -> Result<Update, UpdateError> {
        self.admin.update(&Change {
            set: Default::default(),
            reset: paths.iter().map(|p| p.to_string()).collect(),
        })
    }

    fn key(&self, path: &str) -> KeyView {
        self.admin
            .view()
            .groups
            .into_iter()
            .flat_map(|g| g.keys)
            .find(|k| k.path == path)
            .unwrap_or_else(|| panic!("{path} is not in the view"))
    }

    fn problems(r: Result<Update, UpdateError>) -> Vec<String> {
        match r {
            Err(UpdateError::Invalid(p)) => p,
            other => panic!("expected invalid, got {other:?}"),
        }
    }

    fn settings_text(&self) -> String {
        std::fs::read_to_string(self.dir.path().join(SETTINGS_FILE_NAME)).unwrap_or_default()
    }
}

// ------------------------------------------------------------------ the schema covers the file

/// The fields serde accepts in a section, found by asking for one that does not exist: the error
/// lists them.
fn real_fields(doc: &str) -> Vec<String> {
    let err = toml::from_str::<FileConfig>(doc)
        .expect_err("a made-up key must be rejected")
        .to_string();
    let after = err
        .split("expected one of ")
        .nth(1)
        .or_else(|| err.split("expected ").nth(1))
        .unwrap_or_else(|| panic!("no list of fields in: {err}"));
    after
        .lines()
        .next()
        .unwrap()
        .split('`')
        .skip(1)
        .step_by(2)
        .map(String::from)
        .collect()
}

#[test]
fn every_key_of_the_file_can_be_set_from_the_app() {
    // (section path, a document that fails on a made-up key inside that section)
    let sections: &[(&str, &str)] = &[
        ("", "__x = 1"),
        ("server", "[server]\n__x = 1"),
        ("auth", "[auth]\n__x = 1"),
        ("database", "[database]\n__x = 1"),
        ("prices", "[prices]\n__x = 1"),
        ("llm", "[llm]\n__x = 1"),
        ("bank", "[bank]\n__x = 1"),
        ("bank.plaid", "[bank.plaid]\n__x = 1"),
        ("bank.accounts", "[[bank.accounts]]\n__x = 1"),
        ("stores", "[[stores]]\n__x = 1"),
        ("receipts", "[receipts]\n__x = 1"),
        ("receipts.email", "[receipts.email]\n__x = 1"),
        (
            "receipts.email.senders",
            "[[receipts.email.senders]]\n__x = 1",
        ),
        ("receipts.lidl_plus", "[receipts.lidl_plus]\n__x = 1"),
        ("receipts.folder", "[receipts.folder]\n__x = 1"),
    ];
    let mut missing = Vec::new();
    // the probe itself works: it finds fields we know exist
    assert!(real_fields("[server]\n__x = 1").contains(&"bind".to_string()));
    assert!(real_fields("[[bank.accounts]]\n__x = 1").contains(&"sync_every_hours".to_string()));
    assert!(real_fields("[receipts.email]\n__x = 1").contains(&"password".to_string()));
    for (section, doc) in sections {
        let fields = real_fields(doc);
        assert!(!fields.is_empty(), "no fields found for [{section}]");
        for field in fields {
            let path = if section.is_empty() {
                field.clone()
            } else {
                format!("{section}.{field}")
            };
            let is_table = KEYS
                .iter()
                .find(|k| k.path == *section && k.kind == Kind::Table);
            let covered = match is_table {
                // a row of a table key: the column must be described
                Some(k) => k.field(&field).is_some(),
                None => {
                    schema_key(&path).is_some()
                        // a section: its own keys are checked in their turn
                        || KEYS.iter().any(|k| k.path.starts_with(&format!("{path}.")))
                }
            };
            if !covered {
                missing.push(path);
            }
        }
    }
    assert!(
        missing.is_empty(),
        "these keys of financer.toml cannot be set from the app; describe them in schema.rs: {missing:?}"
    );
}

#[test]
fn every_described_key_is_a_real_key() {
    // a document with every key set to a sample value must be accepted by the strict parser
    let mut doc = toml::Value::Table(Default::default());
    let mut overlay = Overlay::default();
    for k in KEYS {
        overlay.set(k.path, sample(k));
    }
    overlay.apply(&mut doc).unwrap();
    let parsed: Result<FileConfig, _> = doc.try_into();
    parsed.unwrap_or_else(|e| panic!("a described key is not in the file format: {e}"));
}

/// A value of the right shape for a key.
fn sample(k: &Key) -> Value {
    match k.kind {
        Kind::Text | Kind::Path | Kind::Secret => json!("x"),
        Kind::Int => json!(k.min.max(1)),
        Kind::Bool => json!(true),
        Kind::Choice => json!(k.options[0]),
        Kind::List => json!(["x"]),
        Kind::Table => json!([row(k)]),
    }
}

fn row(k: &Key) -> Value {
    let mut obj = serde_json::Map::new();
    for f in k.fields {
        obj.insert(
            f.key.to_string(),
            match (f.kind, f.pair) {
                (Kind::Int, _) => json!(f.min.max(1)),
                (Kind::Bool, _) => json!(true),
                (Kind::Choice, _) => json!(f.options[0]),
                (Kind::List, Some(_)) => json!([{"item": "x", "barcode": "x"}]),
                (Kind::List, None) => json!(["x"]),
                _ => json!("x"),
            },
        );
    }
    Value::Object(obj)
}

#[test]
fn the_environment_variables_in_the_schema_are_the_ones_the_loader_reads() {
    let loader = include_str!("load.rs");
    let receipts = include_str!("../../receipt-sources/src/config.rs");
    for k in KEYS {
        let Some(var) = k.env else { continue };
        let literal = format!("\"{var}\"");
        assert!(
            loader.contains(&literal) || receipts.contains(&literal),
            "{}: nothing reads {var}",
            k.path
        );
    }
    // and the other way round: every variable the loader reads is named by a key
    for text in [loader, receipts] {
        for word in text.split('"') {
            let looks_like_var = word.starts_with("FINANCER_")
                && word
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
            let known = KEYS.iter().any(|k| k.env == Some(word))
                || [
                    "FINANCER_CONFIG",
                    "FINANCER_SETTINGS_FILE",
                    "FINANCER_SECRET_KEY",
                    "FINANCER_RECEIPTS_IMAP_PASSWORD",
                    "FINANCER_IMAP_PASSWORD",
                ]
                .contains(&word);
            if looks_like_var && !known {
                // test code and doc comments may mention variables; only reads count
                assert!(
                    !text.contains(&format!("var(\"{word}\")"))
                        && !text.contains(&format!("nonempty(\"{word}\")")),
                    "{word} is read but no key in schema.rs names it"
                );
            }
        }
    }
}

#[test]
fn keys_and_groups_are_consistent() {
    let mut seen = std::collections::HashSet::new();
    for k in KEYS {
        assert!(seen.insert(k.path), "{} is described twice", k.path);
        assert!(
            GROUPS.iter().any(|g| g.id == k.group),
            "{}: unknown group {}",
            k.path,
            k.group
        );
        assert!(!k.label.is_empty(), "{} has no label", k.path);
        assert_eq!(k.kind == Kind::Choice, !k.options.is_empty(), "{}", k.path);
        assert_eq!(k.kind == Kind::Table, !k.fields.is_empty(), "{}", k.path);
        for f in k.fields {
            assert_ne!(f.kind, Kind::Table, "{}.{} nests a table", k.path, f.key);
            if let Some((other, _)) = f.when {
                assert!(
                    k.field(other).is_some(),
                    "{}.{}: when {other}",
                    k.path,
                    f.key
                );
            }
        }
    }
    for g in GROUPS {
        assert!(
            KEYS.iter().any(|k| k.group == g.id),
            "group {} is empty",
            g.id
        );
    }
}

// ------------------------------------------------------------------ the layers

#[test]
fn the_app_sits_between_the_file_and_the_environment() {
    let file = "[llm]\nprovider = \"claude\"\n[server]\nrefresh_hours = 6\n";
    let rig = Rig::new(file, &[("FINANCER_BIND", "0.0.0.0:9")]);
    // file only
    let v = rig.key("server.refresh_hours");
    assert_eq!(
        (v.source.as_str(), v.value.clone()),
        ("file", Some(json!(6)))
    );
    assert_eq!(rig.key("server.web_dir").source, "default");

    rig.set(&[
        ("server.refresh_hours", json!(12)),
        ("llm.provider", json!("openai")),
    ])
    .unwrap();
    let v = rig.key("server.refresh_hours");
    assert_eq!((v.source.as_str(), v.value), ("app", Some(json!(12))));

    // the loader agrees, and says where each value came from
    let overlay = rig.admin.file().overlay();
    let loaded = Loader::load_with(
        Some(&rig.dir.path().join("financer.toml")),
        &MapEnv::new(&[
            ("FINANCER_API_TOKEN", TOKEN),
            ("FINANCER_BIND", "0.0.0.0:9"),
        ]),
        rig.dir.path(),
        &overlay,
    )
    .unwrap();
    let c = &loaded.config;
    assert_eq!(c.server.refresh_hours.value, 12);
    assert_eq!(c.server.refresh_hours.source, Source::App);
    assert_eq!(c.llm.provider.value, Some(ProviderChoice::OpenAi));
    assert_eq!(c.llm.provider.source, Source::App);
    assert_eq!(c.server.bind.source, Source::Env("FINANCER_BIND".into()));
    assert!(Renderer::render(&loaded).contains("refresh_hours = 12   # app"));

    // the environment still wins, and then the app cannot change the key
    let bind = rig.key("server.bind");
    assert_eq!((bind.source.as_str(), bind.locked), ("env", true));
    assert_eq!(bind.value, Some(json!("0.0.0.0:9")));
    let Err(UpdateError::Locked(why)) = rig.set(&[("server.bind", json!("1.2.3.4:5"))]) else {
        panic!("a key decided by the environment must be refused");
    };
    assert!(why[0].contains("FINANCER_BIND"), "{why:?}");
}

#[test]
fn reset_gives_the_file_back_and_clearing_blanks_a_file_value() {
    let rig = Rig::new("[prices]\nsources_file = \"a.json\"\n", &[]);
    std::fs::write(rig.dir.path().join("a.json"), "[]").unwrap();
    std::fs::write(rig.dir.path().join("b.json"), "[]").unwrap();
    rig.set(&[("prices.sources_file", json!("b.json"))])
        .unwrap();
    assert_eq!(rig.key("prices.sources_file").source, "app");
    rig.reset(&["prices.sources_file"]).unwrap();
    let k = rig.key("prices.sources_file");
    assert_eq!(k.source, "file");
    assert!(k.value.unwrap().as_str().unwrap().ends_with("a.json"));

    // clearing a key the file sets is written down as a blank value
    rig.set(&[("prices.sources_file", Value::Null)]).unwrap();
    let k = rig.key("prices.sources_file");
    assert_eq!((k.source.as_str(), k.is_set), ("app", false));
    // clearing a key nothing sets just removes the entry
    let rig = Rig::new("", &[]);
    rig.set(&[("llm.provider", json!("openai"))]).unwrap();
    rig.set(&[("llm.provider", Value::Null)]).unwrap();
    assert_eq!(rig.key("llm.provider").source, "default");
    assert!(!rig.settings_text().contains("llm.provider"));
}

#[test]
fn secrets_are_never_sent_back() {
    let rig = Rig::new("", &[]);
    rig.set(&[
        ("llm.anthropic_api_key", json!("sk-ant-very-secret")),
        ("bank.plaid.secret", json!("plaid-very-secret")),
        ("receipts.email.host", json!("imap.example.org")),
        ("receipts.email.username", json!("me@example.org")),
        ("receipts.email.password", json!("mailbox-very-secret")),
        (
            "database.url",
            json!("postgres://me:db-very-secret@host/db"),
        ),
    ])
    .unwrap();
    let view = rig.admin.view();
    let text = serde_json::to_string(&view).unwrap();
    for secret in [
        "sk-ant-very-secret",
        "plaid-very-secret",
        "mailbox-very-secret",
        "db-very-secret",
    ] {
        assert!(!text.contains(secret), "{secret} leaked into the view");
    }
    let k = rig.key("llm.anthropic_api_key");
    assert!(k.is_set && k.value.is_none() && k.source == "app");
    // the database address shows without its password
    assert_eq!(
        rig.key("database.url").preview.as_deref(),
        Some("postgres://me:<hidden>@host/db")
    );
    // and a secret from the environment is "set" without its value
    let rig = Rig::new("", &[("FINANCER_OPENAI_API_KEY", "sk-env-secret")]);
    let k = rig.key("llm.openai_api_key");
    assert!(k.is_set && k.locked && k.value.is_none());
    assert!(!serde_json::to_string(&rig.admin.view())
        .unwrap()
        .contains("sk-env-secret"));
}

// ------------------------------------------------------------------ saving

#[test]
fn a_bad_value_is_refused_with_the_key_named_and_nothing_is_written() {
    let rig = Rig::new("", &[]);
    for (path, value, needle) in [
        (
            "server.refresh_hours",
            json!(-1),
            "server.refresh_hours: must be between",
        ),
        ("server.refresh_hours", json!("many"), "whole number"),
        ("llm.provider", json!("gemini"), "use one of claude, openai"),
        (
            "bank.plaid.environment",
            json!("moon"),
            "use one of sandbox, production",
        ),
        ("server.web_dir", json!("line\nbreak"), "single line"),
        (
            "receipts.email.port",
            json!(70000),
            "must be between 1 and 65535",
        ),
        ("llm.anthropic_api_key", json!(5), "expected a secret"),
        (
            "server.cors_origins",
            json!(["http://ok", 3]),
            "every entry must be text",
        ),
        ("no.such.key", json!(1), "not a setting of this server"),
    ] {
        let problems = Rig::problems(rig.set(&[(path, value)]));
        assert!(
            problems.iter().any(|p| p.contains(needle)),
            "{path}: {problems:?} should mention {needle:?}"
        );
    }
    assert_eq!(rig.settings_text(), "", "a refused change writes nothing");
}

#[test]
fn what_the_server_would_refuse_to_start_with_is_refused_now() {
    // the token comes from the file here, so the app may change it
    let rig = Rig::with_env(&format!("[auth]\napi_token = \"{TOKEN}\"\n"), &[]);
    let p = Rig::problems(rig.set(&[("auth.api_token", json!("short"))]));
    assert!(p[0].contains("at least 32 characters"), "{p:?}");
    let p = Rig::problems(rig.set(&[("database.url", json!("mysql://nope"))]));
    assert!(p[0].contains("database.url"), "{p:?}");
    let p = Rig::problems(rig.set(&[("server.web_dir", json!("/no/such/folder"))]));
    assert!(p[0].contains("server.web_dir"), "{p:?}");
    let p = Rig::problems(rig.set(&[("server.cors_origins", json!(["localhost"]))]));
    assert!(p[0].contains("cors_origins"), "{p:?}");
    let p = Rig::problems(rig.set(&[("bank.plaid.redirect_uri", json!("http://x"))]));
    assert!(p[0].contains("https://"), "{p:?}");
    // a half-filled mailbox cannot be saved either
    let p = Rig::problems(rig.set(&[("receipts.email.host", json!("imap.example.org"))]));
    assert!(
        p.iter().any(|m| m == "receipts.email.username: required"),
        "{p:?}"
    );
    assert_eq!(rig.settings_text(), "");
    // and the token itself can be replaced by a good one
    let new = "f".repeat(40);
    rig.set(&[("auth.api_token", json!(new))]).unwrap();
    assert_eq!(rig.key("auth.api_token").source, "app");
}

#[test]
fn accounts_and_store_names_are_saved_as_lists_and_checked_row_by_row() {
    let rig = Rig::new("", &[]);
    let u = rig
        .set(&[(
            "bank.accounts",
            json!([
                {"name": "Giro", "kind": "fints", "bank_code": "37050198", "login": "me", "iban": IBAN,
                 "pin_env": "SPARKASSE_PIN", "sync_every_hours": 12},
                {"name": "Plaid Giro", "kind": "plaid", "sync_every_hours": 6, "account_ids": ["abc123"]},
            ]),
        ),
        (
            "stores",
            json!([{"chain": "Bio Company", "match": ["BIO COMPANY"]}]),
        )])
        .unwrap();
    assert_eq!(u.changed, ["bank.accounts", "stores"]);
    let overlay = rig.admin.file().overlay();
    let loaded = Loader::load_with(
        Some(&rig.dir.path().join("financer.toml")),
        &MapEnv::new(&[("FINANCER_API_TOKEN", TOKEN)]),
        rig.dir.path(),
        &overlay,
    )
    .unwrap();
    assert_eq!(loaded.config.bank.accounts.len(), 2);
    assert_eq!(loaded.config.bank.accounts[1].kind, "plaid");
    assert_eq!(loaded.config.bank.accounts_source, Source::App);
    assert_eq!(loaded.config.stores[0].chain, "Bio Company");
    assert_eq!(rig.key("bank.accounts").source, "app");

    // mistakes name the row and the column
    let p = Rig::problems(rig.set(&[(
        "bank.accounts",
        json!([{"name": "A", "bank_code": "1", "login": "l", "iban": IBAN}]),
    )]));
    assert!(
        p.iter()
            .any(|m| m.contains("bank.accounts[0].bank_code") && m.contains("8 digits")),
        "{p:?}"
    );
    let p = Rig::problems(rig.set(&[("bank.accounts", json!([{"name": "A", "kind": "fints"}]))]));
    assert!(
        p.iter()
            .any(|m| m.contains("bank.accounts[0].bank_code") && m.contains("required")),
        "{p:?}"
    );
    let p = Rig::problems(rig.set(&[(
        "bank.accounts",
        json!([{"name": "A", "kind": "plaid", "wat": 1}]),
    )]));
    assert!(p.iter().any(|m| m.contains("unknown field")), "{p:?}");
    let p = Rig::problems(rig.set(&[(
        "bank.accounts",
        json!([{"name": "A", "kind": "plaid"}, {"name": "a", "kind": "plaid"}]),
    )]));
    assert!(p.iter().any(|m| m.contains("used twice")), "{p:?}");
    let p = Rig::problems(rig.set(&[("stores", json!([{"chain": "x", "match": []}]))]));
    assert!(p.iter().any(|m| m.contains("stores[0]")), "{p:?}");
    // the accounts that were saved are still the ones in the file
    assert_eq!(
        rig.admin
            .file()
            .overlay()
            .get("bank.accounts")
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );

    // a Plaid account needs none of the FinTS columns, and an empty list removes the entry
    rig.set(&[("bank.accounts", json!([]))]).unwrap();
    assert_eq!(rig.key("bank.accounts").source, "default");
}

#[test]
fn the_mailbox_can_be_set_up_key_by_key_with_its_password() {
    let rig = Rig::new("", &[]);
    rig.set(&[
        ("receipts.email.host", json!("imap.example.org")),
        ("receipts.email.username", json!("me@example.org")),
        ("receipts.email.password", json!("hunter2-secret")),
        ("receipts.email.poll_minutes", json!(15)),
        (
            "receipts.email.senders",
            json!([{"retailer": "rewe", "from": ["rewe.de"]}]),
        ),
        ("receipts.lidl_plus.enabled", json!(true)),
        (
            "receipts.folder.path",
            json!(rig.dir.path().to_str().unwrap()),
        ),
        ("receipts.folder.on_done", json!("move")),
    ])
    .unwrap();
    let loaded = Loader::load_with(
        Some(&rig.dir.path().join("financer.toml")),
        &MapEnv::new(&[("FINANCER_API_TOKEN", TOKEN)]),
        rig.dir.path(),
        &rig.admin.file().overlay(),
    )
    .unwrap();
    let r = &loaded.config.receipts;
    assert_eq!(r.source, Source::App);
    let e = r.value.email.as_ref().unwrap();
    assert_eq!(
        (e.host.as_str(), e.poll_minutes, e.port),
        ("imap.example.org", 15, 993)
    );
    assert_eq!(e.password.as_deref(), Some("hunter2-secret"));
    assert_eq!(e.senders[0].from, ["rewe.de"]);
    assert!(r.value.lidl_plus.enabled);
    // no warning about a missing password variable, because the password was typed
    assert!(
        !loaded.warnings.iter().any(|w| w.contains("password_env")),
        "{:?}",
        loaded.warnings
    );
    // and it never appears in the printed configuration
    let printed = Renderer::render(&loaded);
    assert!(!printed.contains("hunter2-secret"), "{printed}");
    assert!(printed.contains("password = \"<hidden>\""), "{printed}");
}

#[test]
fn nothing_to_change_means_nothing_to_restart() {
    let rig = Rig::new("", &[]);
    let u = rig.set(&[("server.refresh_hours", json!(24))]).unwrap();
    assert_eq!(
        u.changed,
        ["server.refresh_hours"],
        "first time it is a change"
    );
    let u = rig.set(&[("server.refresh_hours", json!(24))]).unwrap();
    assert!(u.changed.is_empty(), "the same value again is not");
    let u = rig.reset(&["llm.provider"]).unwrap();
    assert!(u.changed.is_empty());
}

// ------------------------------------------------------------------ the settings file

#[test]
fn the_settings_file_is_private_and_found_next_to_the_database() {
    let rig = Rig::new("", &[]);
    rig.set(&[("server.refresh_hours", json!(3))]).unwrap();
    let path = rig.dir.path().join(SETTINGS_FILE_NAME);
    assert!(path.is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "secrets live in this file");
    }
    assert!(!rig.dir.path().join("financer.settings.json.tmp").exists());

    let cwd = Path::new("/srv/app");
    let env = MapEnv::default();
    for (url, want) in [
        (
            "sqlite:///data/financer.db?mode=rwc",
            "/data/financer.settings.json",
        ),
        (
            "sqlite://data/financer.db?mode=rwc",
            "/srv/app/data/financer.settings.json",
        ),
        (
            "sqlite://financer.db?mode=rwc",
            "/srv/app/financer.settings.json",
        ),
        ("sqlite::memory:", "/srv/app/financer.settings.json"),
        ("postgres://u:p@h/db", "/srv/app/financer.settings.json"),
    ] {
        assert_eq!(
            SettingsFile::locate(&env, url, cwd).path(),
            Path::new(want),
            "{url}"
        );
    }
    let env = MapEnv::new(&[("FINANCER_SETTINGS_FILE", "/etc/f/s.json")]);
    assert_eq!(
        SettingsFile::locate(&env, "sqlite:///data/x.db", cwd).path(),
        Path::new("/etc/f/s.json")
    );
}

#[test]
fn a_change_that_does_not_start_is_undone() {
    let rig = Rig::new("", &[]);
    let file = rig.admin.file();
    rig.set(&[("server.refresh_hours", json!(6))]).unwrap();
    assert!(rig.admin.view().applying, "saved, not yet started with");
    confirm_start(file); // proves itself
    assert_eq!(file.read().unwrap().pending, None);
    assert!(!rig.admin.view().applying);

    // now a change that fails to start
    rig.set(&[("server.refresh_hours", json!(7))]).unwrap();
    let begin = file.begin();
    assert!(begin.applying && !begin.rolled_back);
    assert_eq!(begin.overlay.get("server.refresh_hours"), Some(&json!(7)));
    assert!(file.fail("cannot bind 0.0.0.0:80: permission denied"));
    // the previous value is back and the app can say why
    assert_eq!(file.overlay().get("server.refresh_hours"), Some(&json!(6)));
    let view = rig.admin.view();
    assert_eq!(view.state, "rolled_back");
    assert!(view.message.unwrap().contains("permission denied"));
    // starting again is plain; the next change clears the message
    assert!(!file.begin().applying);
    rig.set(&[("server.refresh_hours", json!(8))]).unwrap();
    assert_eq!(rig.admin.view().state, "ok");
}

fn confirm_start(file: &SettingsFile) {
    let begin = file.begin();
    assert!(begin.applying);
    file.confirm();
}

#[test]
fn a_change_that_keeps_crashing_without_a_word_is_undone_too() {
    let rig = Rig::new("", &[]);
    let file = rig.admin.file();
    rig.set(&[("server.refresh_hours", json!(9))]).unwrap();
    // two starts that never reach confirm() or fail()
    assert!(file.begin().applying);
    assert!(file.begin().applying);
    let third = file.begin();
    assert!(third.rolled_back && !third.applying);
    assert!(third.overlay.get("server.refresh_hours").is_none());
    assert_eq!(rig.admin.view().state, "rolled_back");
}

#[test]
fn a_second_change_before_the_first_proved_itself_keeps_the_last_good_values() {
    let rig = Rig::new("", &[]);
    let file = rig.admin.file();
    rig.set(&[("server.refresh_hours", json!(1))]).unwrap();
    confirm_start(file);
    rig.set(&[("server.refresh_hours", json!(2))]).unwrap();
    rig.set(&[("server.refresh_hours", json!(3))]).unwrap();
    assert!(file.fail("boom"));
    assert_eq!(file.overlay().get("server.refresh_hours"), Some(&json!(1)));
}

#[test]
fn failing_without_a_pending_change_is_not_a_rollback() {
    let rig = Rig::new("", &[]);
    assert!(!rig.admin.file().fail("anything"));
}

#[test]
fn a_broken_settings_file_is_set_aside_not_overwritten() {
    let rig = Rig::new("", &[]);
    let path = rig.dir.path().join(SETTINGS_FILE_NAME);
    std::fs::write(&path, "{ this is not json").unwrap();
    let begin = rig.admin.file().begin();
    assert!(begin.overlay.is_empty());
    assert!(
        begin.warnings.iter().any(|w| w.contains("not valid JSON")),
        "{:?}",
        begin.warnings
    );
    assert!(rig
        .dir
        .path()
        .join("financer.settings.json.broken")
        .is_file());
    // saving still works afterwards
    rig.set(&[("server.refresh_hours", json!(5))]).unwrap();
}

#[test]
fn an_unwritable_place_is_reported_with_the_way_out() {
    let dir = tempfile::tempdir().unwrap();
    let admin = Admin::new(
        None,
        dir.path().to_path_buf(),
        Arc::new(MapEnv::new(&[("FINANCER_API_TOKEN", TOKEN)])),
        SettingsFile::at(dir.path().join("no-such-folder").join("s.json")),
    );
    assert!(!admin.view().writable);
    let r = admin.update(&Change {
        set: [("server.refresh_hours".to_string(), json!(5))].into(),
        reset: vec![],
    });
    let Err(UpdateError::Storage(m)) = r else {
        panic!("{r:?}")
    };
    assert!(m.contains("FINANCER_SETTINGS_FILE"), "{m}");
}

// ------------------------------------------------------------------ the view

#[test]
fn the_view_lists_every_group_and_key_with_defaults_and_ranges() {
    let rig = Rig::new("", &[]);
    let view = rig.admin.view();
    assert_eq!(view.groups.len(), GROUPS.len());
    assert_eq!(view.state, "ok");
    assert!(view.writable);
    assert!(view.problems.is_empty(), "{:?}", view.problems);
    let total: usize = view.groups.iter().map(|g| g.keys.len()).sum();
    assert_eq!(total, KEYS.len());

    let hours = rig.key("server.refresh_hours");
    assert_eq!(hours.kind, "number");
    assert_eq!((hours.min, hours.default.as_deref()), (Some(0), Some("24")));
    assert!(!hours.is_set && hours.value.is_none());
    let provider = rig.key("llm.provider");
    assert_eq!(provider.options, ["claude", "openai"]);
    let accounts = rig.key("bank.accounts");
    assert_eq!(accounts.kind, "table");
    let iban = accounts.fields.iter().find(|f| f.key == "iban").unwrap();
    assert_eq!(iban.when_field.as_deref(), Some("kind"));
    assert_eq!(iban.when_value.as_deref(), Some("fints"));
    assert!(rig.key("server.bind").warning.is_some());
}

#[test]
fn the_view_reads_lists_and_tables_from_the_file_too() {
    let rig = Rig::new(
        "[server]\ncors_origins = [\"http://localhost:8081\"]\n\
         [[stores]]\nchain = \"edeka\"\nmatch = \"Mueller Frischemarkt\"\n",
        &[
            (
                "FINANCER_RECEIPTS_IMAP_SENDERS",
                "rewe=rewe.de,rewe-group.com;lidl=lidl.de",
            ),
            ("FINANCER_RECEIPTS_IMAP_HOST", "imap.example.org"),
            ("FINANCER_RECEIPTS_IMAP_USERNAME", "me@example.org"),
        ],
    );
    assert_eq!(
        rig.key("server.cors_origins").value,
        Some(json!(["http://localhost:8081"]))
    );
    // a text written for a list is shown as a list
    assert_eq!(
        rig.key("stores").value,
        Some(json!([{"chain": "edeka", "match": ["Mueller Frischemarkt"]}]))
    );
    let senders = rig.key("receipts.email.senders");
    assert_eq!(senders.source, "env");
    assert_eq!(
        senders.value,
        Some(json!([
            {"retailer": "rewe", "from": ["rewe.de", "rewe-group.com"]},
            {"retailer": "lidl", "from": ["lidl.de"]},
        ]))
    );
    assert!(senders.locked);
}

#[test]
fn a_broken_file_is_reported_not_hidden() {
    let rig = Rig::new("[server]\nnope = 1\n", &[]);
    let view = rig.admin.view();
    assert!(
        view.problems.iter().any(|p| p.contains("nope")),
        "{:?}",
        view.problems
    );
    assert_eq!(view.groups.len(), GROUPS.len(), "the screen is still drawn");
}

// ------------------------------------------------------------------ price sources

#[test]
fn every_field_of_a_price_source_is_a_column_of_the_schema() {
    let k = schema_key("prices.sources").unwrap();
    let kinds = k.field("type").unwrap().options;
    assert_eq!(kinds, ["json_ld", "llm_page", "open_prices"]);
    let mut seen = std::collections::BTreeSet::new();
    for kind in kinds {
        // a source with every column that applies to this kind, written as the file has it
        let mut obj = serde_json::Map::new();
        obj.insert("type".into(), json!(kind));
        for f in k.fields.iter().filter(|f| f.applies_to(kind)) {
            if f.key == "type" {
                continue;
            }
            let v = match (f.kind, f.pair) {
                (Kind::List, Some(_)) => json!([{"item": "milch", "barcode": "4012345678901"}]),
                (Kind::List, None) => json!(["https://example.org/offers"]),
                (Kind::Bool, _) => json!(true),
                (Kind::Int, _) => json!(f.min.max(1)),
                (Kind::Choice, _) => json!(f.options[0]),
                _ => json!("x"),
            };
            obj.insert(f.key.into(), v);
        }
        let parsed: financer_prices::SourceConfig = serde_json::from_value(Value::Object(obj))
            .unwrap_or_else(|e| {
                panic!("{kind}: the schema describes a column the source does not have: {e}")
            });
        // what the source has again: every key must be a column
        let back = serde_json::to_value(&parsed).unwrap();
        for name in back.as_object().unwrap().keys() {
            assert!(
                k.field(name).is_some(),
                "{kind} has a field {name:?} that the schema does not describe"
            );
            seen.insert(name.clone());
        }
    }
    // nothing described that no kind has
    for f in k.fields {
        assert!(
            seen.contains(f.key),
            "column {} belongs to no source kind",
            f.key
        );
    }
}

#[test]
fn price_sources_are_saved_with_their_item_pairs_and_checked() {
    let rig = Rig::new("", &[]);
    rig.set(&[(
        "prices.sources",
        json!([
            {"type": "open_prices", "items": ["milch = 4012345678901", "eier=4012345678902"], "max_age_days": 30},
            {"type": "llm_page", "chain": "kaufland", "urls": ["https://example.org/angebote"], "is_offer": true},
            {"type": "json_ld", "chain": "rewe", "urls": ["https://example.org/a", "https://example.org/b"]},
        ]),
    )])
    .unwrap();
    // stored the way the file would write it
    let stored = rig.admin.file().overlay();
    assert_eq!(
        stored.get("prices.sources").unwrap()[0],
        json!({"type": "open_prices", "items": [
            {"item": "milch", "barcode": "4012345678901"},
            {"item": "eier", "barcode": "4012345678902"}], "max_age_days": 30})
    );
    // and shown the way the form edits it
    let k = rig.key("prices.sources");
    assert_eq!(k.source, "app");
    assert_eq!(
        k.value.as_ref().unwrap()[0]["items"],
        json!(["milch=4012345678901", "eier=4012345678902"])
    );
    // the loader has three sources, the server would use them with the file's
    let loaded = Loader::load_with(
        Some(&rig.dir.path().join("financer.toml")),
        &MapEnv::new(&[("FINANCER_API_TOKEN", TOKEN)]),
        rig.dir.path(),
        &stored,
    )
    .unwrap();
    assert_eq!(loaded.config.prices.sources.len(), 3);
    assert_eq!(loaded.config.prices.sources_source, Source::App);
    assert!(Renderer::render(&loaded).contains("[[prices.sources]]   # app"));
}

#[test]
fn a_price_source_is_checked_row_by_row() {
    let rig = Rig::new("", &[]);
    for (rows, needle) in [
        (
            json!([{"type": "json_ld", "chain": "rewe"}]),
            "prices.sources[0].urls: Pages is required",
        ),
        (
            json!([{"type": "json_ld", "chain": "rewe", "urls": ["ftp://x"]}]),
            "not a web address",
        ),
        (
            json!([{"type": "open_prices"}]),
            "prices.sources[0].items: Items is required",
        ),
        (
            json!([{"type": "open_prices", "items": ["milch"]}]),
            "write each entry as item=barcode",
        ),
        (
            json!([{"type": "open_prices", "items": ["milch=12"]}]),
            "not a barcode",
        ),
        (
            json!([{"type": "open_prices", "items": ["milch=4012345678901"], "max_age_days": 999}]),
            "must be between 1 and 365",
        ),
        (
            json!([{"type": "whatever", "urls": ["https://x"]}]),
            "use one of json_ld, llm_page, open_prices",
        ),
        (
            json!([{"type": "json_ld", "chain": "tesco", "urls": ["https://x.org"]}]),
            "use one of rewe, lidl, aldi, kaufland",
        ),
    ] {
        let problems = Rig::problems(rig.set(&[("prices.sources", rows.clone())]));
        assert!(
            problems.iter().any(|p| p.contains(needle)),
            "{rows}: {problems:?} should mention {needle:?}"
        );
    }
    assert_eq!(rig.settings_text(), "");
}

#[test]
fn price_sources_from_the_file_are_shown_and_the_app_replaces_them() {
    let rig = Rig::new(
        "[[prices.sources]]\ntype = \"json_ld\"\nchain = \"lidl\"\nurls = [\"https://example.org/lidl\"]\n\
         [[prices.sources]]\ntype = \"open_prices\"\nitems = [{ item = \"milch\", barcode = \"4012345678901\" }]\n",
        &[],
    );
    let k = rig.key("prices.sources");
    assert_eq!(k.source, "file");
    assert_eq!(k.value.as_ref().unwrap().as_array().unwrap().len(), 2);
    assert_eq!(
        k.value.as_ref().unwrap()[1]["items"],
        json!(["milch=4012345678901"])
    );
    // clearing the list blanks what the file has
    rig.set(&[("prices.sources", Value::Null)]).unwrap();
    let loaded = Loader::load_with(
        Some(&rig.dir.path().join("financer.toml")),
        &MapEnv::new(&[("FINANCER_API_TOKEN", TOKEN)]),
        rig.dir.path(),
        &rig.admin.file().overlay(),
    )
    .unwrap();
    assert!(loaded.config.prices.sources.is_empty());
}
