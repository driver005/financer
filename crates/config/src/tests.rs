use std::path::{Path, PathBuf};

use crate::*;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
/// A valid IBAN (the standard example).
const IBAN: &str = "DE89 3704 0044 0532 0130 00";

struct Fixture;

impl Fixture {
    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write(dir: &Path, name: &str, text: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, text).unwrap();
        path
    }

    /// Load `text` as the file `financer.toml` in a fresh folder with this environment.
    fn load(text: &str, env: &[(&str, &str)]) -> Result<Loaded, ConfigError> {
        let dir = Self::dir();
        let path = Self::write(dir.path(), "financer.toml", text);
        Loader::load(Some(&path), &MapEnv::new(env), dir.path())
    }

    fn ok(text: &str, env: &[(&str, &str)]) -> Loaded {
        Self::load(text, env).unwrap_or_else(|e| panic!("{e}"))
    }

    fn err(text: &str, env: &[(&str, &str)]) -> String {
        Self::load(text, env).expect_err("should fail").to_string()
    }

    fn account(extra: &str) -> String {
        format!(
            "[[bank.accounts]]\nname = \"Giro\"\nbank_code = \"37050198\"\nlogin = \"me\"\niban = \"{IBAN}\"\n{extra}\n"
        )
    }
}

#[test]
fn without_a_file_the_defaults_are_todays_behavior() {
    let dir = Fixture::dir();
    let loaded = Loader::load(None, &MapEnv::default(), dir.path()).unwrap();
    let c = &loaded.config;
    assert_eq!(loaded.path, None);
    assert_eq!(c.server.bind.value, "127.0.0.1:8080");
    assert_eq!(c.database.url.value, "sqlite://financer.db?mode=rwc");
    assert_eq!(c.server.refresh_hours.value, 24);
    assert_eq!(c.server.web_dir.value, None);
    assert!(c.server.cors_origins.value.is_empty());
    assert_eq!(c.prices.sources_file.value, None);
    assert!(c.auth.api_token.value.is_none());
    assert!(c.llm.anthropic_api_key.value.is_none());
    assert!(c.llm.openai_api_key.value.is_none());
    assert_eq!(c.llm.provider.value, None);
    assert!(c.bank.fints_product_id.value.is_none());
    assert!(c.bank.accounts.is_empty());
    assert!(c.stores.is_empty());
    assert_eq!(c.server.bind.source, Source::Default);
}

#[test]
fn every_environment_variable_still_works_on_its_own() {
    let dir = Fixture::dir();
    let env = MapEnv::new(&[
        ("FINANCER_API_TOKEN", TOKEN),
        ("FINANCER_DATABASE_URL", "postgres://u:p@h/db"),
        ("FINANCER_WEB_DIR", "/srv/web"),
        ("FINANCER_CORS_ORIGIN", "http://a:1, http://b:2,"),
        ("FINANCER_BIND", "0.0.0.0:9000"),
        ("FINANCER_PRICE_SOURCES", "/etc/sources.json"),
        ("FINANCER_REFRESH_HOURS", " 6 "),
        ("FINANCER_FINTS_PRODUCT_ID", "PRODUCT"),
        ("FINANCER_ANTHROPIC_API_KEY", "sk-ant"),
        ("FINANCER_OPENAI_API_KEY", "sk-oai"),
        ("FINANCER_LLM_PROVIDER", "openai"),
    ]);
    let c = Loader::load(None, &env, dir.path()).unwrap().config;
    assert_eq!(c.auth.api_token.value.unwrap().expose(), TOKEN);
    assert_eq!(c.database.url.value, "postgres://u:p@h/db");
    assert_eq!(c.server.web_dir.value.as_deref(), Some("/srv/web"));
    assert_eq!(c.server.cors_origins.value, ["http://a:1", "http://b:2"]);
    assert_eq!(c.server.bind.value, "0.0.0.0:9000");
    assert_eq!(
        c.prices.sources_file.value.as_deref(),
        Some("/etc/sources.json")
    );
    assert_eq!(c.server.refresh_hours.value, 6);
    assert_eq!(c.bank.fints_product_id.value.unwrap().expose(), "PRODUCT");
    assert_eq!(c.llm.anthropic_api_key.value.unwrap().expose(), "sk-ant");
    assert_eq!(c.llm.openai_api_key.value.unwrap().expose(), "sk-oai");
    assert_eq!(c.llm.provider.value, Some(ProviderChoice::OpenAi));
    assert_eq!(c.server.bind.source, Source::Env("FINANCER_BIND".into()));
}

#[test]
fn a_bad_refresh_hours_names_the_variable() {
    let dir = Fixture::dir();
    let env = MapEnv::new(&[("FINANCER_REFRESH_HOURS", "daily")]);
    let e = Loader::load(None, &env, dir.path())
        .unwrap_err()
        .to_string();
    assert!(e.contains("FINANCER_REFRESH_HOURS"), "{e}");
    assert!(e.contains("whole number"), "{e}");
}

#[test]
fn precedence_is_environment_then_file_then_default() {
    let text = r#"
        [server]
        bind = "10.0.0.1:1111"
        refresh_hours = 12
        [database]
        url = "sqlite://from-file.db"
    "#;
    // file only
    let c = Fixture::ok(text, &[]).config;
    assert_eq!(c.server.bind.value, "10.0.0.1:1111");
    assert_eq!(c.server.bind.source, Source::File);
    assert_eq!(c.server.refresh_hours.value, 12);
    assert_eq!(c.database.url.value, "sqlite://from-file.db");
    // not in the file: default
    assert_eq!(c.server.web_dir.source, Source::Default);
    // environment beats the file for some settings only
    let c = Fixture::ok(text, &[("FINANCER_BIND", "0.0.0.0:2222")]).config;
    assert_eq!(c.server.bind.value, "0.0.0.0:2222");
    assert_eq!(c.server.bind.source, Source::Env("FINANCER_BIND".into()));
    assert_eq!(c.server.refresh_hours.source, Source::File);
}

#[test]
fn a_blank_environment_variable_does_not_override_the_file() {
    // docker compose passes unset variables through as empty strings
    let text = "[server]\nrefresh_hours = 3\nbind = \"1.2.3.4:5\"\n";
    let c = Fixture::ok(
        text,
        &[("FINANCER_REFRESH_HOURS", ""), ("FINANCER_BIND", "  ")],
    )
    .config;
    assert_eq!(c.server.refresh_hours.value, 3);
    assert_eq!(c.server.bind.value, "1.2.3.4:5");
}

#[test]
fn the_file_is_found_in_the_documented_order() {
    let dir = Fixture::dir();
    let a = Fixture::write(dir.path(), "a.toml", "[server]\nbind = \"1.1.1.1:1\"\n");
    let b = Fixture::write(dir.path(), "b.toml", "[server]\nbind = \"2.2.2.2:2\"\n");
    Fixture::write(
        dir.path(),
        "financer.toml",
        "[server]\nbind = \"3.3.3.3:3\"\n",
    );
    let env_b = MapEnv::new(&[("FINANCER_CONFIG", b.to_str().unwrap())]);

    // 1. --config beats FINANCER_CONFIG beats ./financer.toml
    let l = Loader::load(Some(&a), &env_b, dir.path()).unwrap();
    assert_eq!(l.config.server.bind.value, "1.1.1.1:1");
    assert_eq!(l.path.as_deref(), Some(a.as_path()));
    // 2. FINANCER_CONFIG
    let l = Loader::load(None, &env_b, dir.path()).unwrap();
    assert_eq!(l.config.server.bind.value, "2.2.2.2:2");
    // 3. ./financer.toml
    let l = Loader::load(None, &MapEnv::default(), dir.path()).unwrap();
    assert_eq!(l.config.server.bind.value, "3.3.3.3:3");
    // a blank FINANCER_CONFIG (compose passes empty strings) is not "a file"
    let blank = MapEnv::new(&[("FINANCER_CONFIG", "")]);
    let l = Loader::load(None, &blank, dir.path()).unwrap();
    assert_eq!(l.config.server.bind.value, "3.3.3.3:3");
}

#[test]
fn a_file_that_was_asked_for_must_exist() {
    let dir = Fixture::dir();
    let missing = dir.path().join("nope.toml");
    let e = Loader::load(Some(&missing), &MapEnv::default(), dir.path()).unwrap_err();
    assert!(e.to_string().contains("nope.toml"), "{e}");
    let env = MapEnv::new(&[("FINANCER_CONFIG", missing.to_str().unwrap())]);
    assert!(Loader::load(None, &env, dir.path()).is_err());
}

#[test]
fn environment_references_are_expanded_in_any_string() {
    let text = r#"
        [auth]
        api_token = "${MY_TOKEN}"
        [database]
        url = "postgres://financer:${DB_PASS}@db/${DB_NAME:-financer}"
        [server]
        cors_origins = ["http://${HOST_A}:8081"]
    "#;
    let c = Fixture::ok(
        text,
        &[
            ("MY_TOKEN", TOKEN),
            ("DB_PASS", "s3cret"),
            ("HOST_A", "localhost"),
        ],
    )
    .config;
    assert_eq!(c.auth.api_token.value.unwrap().expose(), TOKEN);
    assert_eq!(
        c.database.url.value,
        "postgres://financer:s3cret@db/financer"
    );
    assert_eq!(c.server.cors_origins.value, ["http://localhost:8081"]);
}

#[test]
fn an_unset_reference_without_default_is_an_error_with_its_line() {
    let text = "[server]\nbind = \"0.0.0.0:8080\"\n\n[auth]\napi_token = \"${NOT_THERE}\"\n";
    let e = Fixture::err(text, &[]);
    assert!(e.contains("NOT_THERE"), "{e}");
    assert!(e.contains("auth.api_token"), "{e}");
    assert!(e.contains("line 5"), "{e}");
    // a blank variable counts as unset
    let e = Fixture::err(text, &[("NOT_THERE", "")]);
    assert!(e.contains("NOT_THERE"), "{e}");
    // ...unless there is a default
    let with_default = text.replace(
        "${NOT_THERE}",
        "${NOT_THERE:-fallback-value-fallback-value-xx}",
    );
    let c = Fixture::ok(&with_default, &[]).config;
    assert_eq!(
        c.auth.api_token.value.unwrap().expose(),
        "fallback-value-fallback-value-xx"
    );
}

#[test]
fn interpolation_syntax_edge_cases() {
    let env = MapEnv::new(&[("A", "1")]);
    let x = |s: &str| Interpolator::expand(s, &env).unwrap();
    assert_eq!(x("plain"), "plain");
    assert_eq!(x("${A}${A}"), "11");
    assert_eq!(x("$${A}"), "${A}"); // escaped
    assert_eq!(x("cost: $5"), "cost: $5");
    assert_eq!(x("${B:-}"), ""); // empty default
    assert_eq!(x("${B:-a:-b}"), "a:-b");
    assert_eq!(x("${not a name}"), "${not a name}"); // not a reference, kept as written
    assert_eq!(x("${A"), "${A");
    assert!(Interpolator::has_reference("x${A}"));
    assert!(!Interpolator::has_reference("x$${A}"));
    assert!(!Interpolator::has_reference("abc"));
}

#[test]
fn an_unknown_key_is_an_error_that_names_it() {
    for (text, key) in [
        ("[server]\nbnd = \"x\"\n", "bnd"),
        ("[serverr]\nbind = \"x\"\n", "serverr"),
        ("[llm]\nclaude_key = \"x\"\n", "claude_key"),
        ("top_level = 1\n", "top_level"),
        ("[bank]\nproduct = \"x\"\n", "product"),
        (&Fixture::account("pin = \"1234\""), "pin"),
        (
            "[[stores]]\nchain = \"rewe\"\nmatch = \"x\"\nalias = 1\n",
            "alias",
        ),
    ] {
        let e = Fixture::err(text, &[]);
        assert!(e.contains(&format!("`{key}`")), "{key}: {e}");
        assert!(e.contains("line"), "line number expected: {e}");
    }
}

#[test]
fn receipts_table_is_typed_and_rejects_unknown_keys() {
    let c = Fixture::ok(
        "[receipts.email]\nhost = \"imap.example.org\"\nusername = \"me@example.org\"\n[receipts.lidl_plus]\nenabled = true\n[receipts.folder]\npath = \"scans\"\n",
        &[],
    )
    .config;
    let r = &c.receipts.value;
    assert_eq!(r.email.as_ref().unwrap().port, 993);
    assert!(r.lidl_plus.enabled);
    assert_eq!(c.receipts.source, Source::File);
    // a relative folder is relative to the config file
    assert!(r.folder.as_ref().unwrap().path.is_absolute());
    for text in [
        "[receipts]\nbogus = 1\n",
        "[receipts.email]\nhost = \"h\"\nusername = \"u\"\npassword = \"x\"\n",
        "[receipts.lidl_plus]\nenable = true\n",
    ] {
        assert!(Fixture::load(text, &[]).is_err(), "{text}");
    }
    let e = Fixture::err("[receipts.folder]\npath = \"\"\n", &[]);
    assert!(e.contains("receipts.folder.path"), "{e}");
}

#[test]
fn receipts_strings_can_refer_to_the_environment() {
    let c = Fixture::ok(
        "[receipts.email]\nhost = \"${IMAP_HOST}\"\nusername = \"me\"\n",
        &[("IMAP_HOST", "imap.example.org")],
    )
    .config;
    assert_eq!(c.receipts.value.email.unwrap().host, "imap.example.org");
}

#[test]
fn receipts_environment_wins_and_is_attributed() {
    let c = Fixture::ok(
        "[receipts.lidl_plus]\nenabled = false\n",
        &[("FINANCER_RECEIPTS_LIDL_PLUS", "1")],
    )
    .config;
    assert!(c.receipts.value.lidl_plus.enabled);
    assert_eq!(
        c.receipts.source,
        Source::Env("FINANCER_RECEIPTS_LIDL_PLUS".into())
    );
    let none = Fixture::ok("", &[]).config;
    assert_eq!(none.receipts.source, Source::Default);
    assert!(!none.receipts.value.any_enabled());
}

#[test]
fn receipts_warnings_name_the_missing_password_variable() {
    let text = "[receipts.email]\nhost = \"h\"\nusername = \"u\"\npassword_env = \"MY_MAIL_PW\"\n";
    let loaded = Fixture::ok(text, &[]);
    assert!(
        loaded.warnings.iter().any(|w| w.contains("MY_MAIL_PW")),
        "{:?}",
        loaded.warnings
    );
    let set = Fixture::ok(text, &[("MY_MAIL_PW", "x")]);
    assert!(!set.warnings.iter().any(|w| w.contains("MY_MAIL_PW")));
}

#[test]
fn print_config_hides_the_mail_login_and_never_has_a_password() {
    let loaded = Fixture::ok(
        "[receipts.email]\nhost = \"imap.example.org\"\nusername = \"jane.doe@example.org\"\n",
        &[("FINANCER_IMAP_PASSWORD", "hunter2-hunter2")],
    );
    let out = Renderer::render(&loaded);
    assert!(out.contains("j***@example.org"), "{out}");
    assert!(!out.contains("jane.doe") && !out.contains("hunter2"), "{out}");
    assert!(out.contains("password_env = \"FINANCER_IMAP_PASSWORD\""));
}

#[test]
fn wrong_types_and_syntax_errors_come_with_a_line_number() {
    let e = Fixture::err("[server]\nrefresh_hours = \"often\"\n", &[]);
    assert!(e.contains("line 2"), "{e}");
    let e = Fixture::err("[server\nbind = 1\n", &[]);
    assert!(e.contains("line 1"), "{e}");
}

#[test]
fn the_token_can_come_from_a_file_next_to_the_config() {
    let dir = Fixture::dir();
    Fixture::write(dir.path(), "token.txt", &format!("{TOKEN}\n"));
    let path = Fixture::write(
        dir.path(),
        "financer.toml",
        "[auth]\napi_token_file = \"token.txt\"\n",
    );
    let l = Loader::load(Some(&path), &MapEnv::default(), dir.path()).unwrap();
    assert_eq!(
        l.config.auth.api_token.value.as_ref().unwrap().expose(),
        TOKEN
    );
    // the environment variable still wins
    let env = MapEnv::new(&[(
        "FINANCER_API_TOKEN",
        "from-env-from-env-from-env-from-env-xx",
    )]);
    let l = Loader::load(Some(&path), &env, dir.path()).unwrap();
    assert_eq!(
        l.config.auth.api_token.value.unwrap().expose(),
        "from-env-from-env-from-env-from-env-xx"
    );
    // both keys together are ambiguous
    let both = Fixture::write(
        dir.path(),
        "both.toml",
        "[auth]\napi_token = \"abc\"\napi_token_file = \"token.txt\"\n",
    );
    let e = Loader::load(Some(&both), &MapEnv::default(), dir.path()).unwrap_err();
    assert!(e.to_string().contains("not both"), "{e}");
    // a missing token file is an error that names it
    let missing = Fixture::write(
        dir.path(),
        "m.toml",
        "[auth]\napi_token_file = \"gone.txt\"\n",
    );
    let e = Loader::load(Some(&missing), &MapEnv::default(), dir.path()).unwrap_err();
    assert!(e.to_string().contains("gone.txt"), "{e}");
}

#[test]
fn paths_in_the_file_are_relative_to_the_file() {
    let dir = Fixture::dir();
    let path = Fixture::write(
        dir.path(),
        "financer.toml",
        "[prices]\nsources_file = \"sources.json\"\n[server]\nweb_dir = \"/abs/web\"\n",
    );
    let c = Loader::load(Some(&path), &MapEnv::default(), Path::new("/elsewhere"))
        .unwrap()
        .config;
    assert_eq!(
        c.prices.sources_file.value.unwrap(),
        dir.path().join("sources.json").to_string_lossy()
    );
    assert_eq!(c.server.web_dir.value.as_deref(), Some("/abs/web"));
}

#[test]
fn the_provider_is_checked() {
    let c = Fixture::ok("[llm]\nprovider = \"OpenAI\"\n", &[]).config;
    assert_eq!(c.llm.provider.value, Some(ProviderChoice::OpenAi));
    assert_eq!(c.llm.provider.source, Source::File);
    let c = Fixture::ok(
        "[llm]\nprovider = \"openai\"\n",
        &[("FINANCER_LLM_PROVIDER", "claude")],
    )
    .config;
    assert_eq!(c.llm.provider.value, Some(ProviderChoice::Claude));
    let e = Fixture::err("[llm]\nprovider = \"gemini\"\n", &[]);
    assert!(e.contains("llm.provider") && e.contains("gemini"), "{e}");
}

#[test]
fn bank_accounts_are_read_and_checked() {
    let text = Fixture::account(
        "pin_env = \"SPARKASSE_PIN\"\nsync_every_hours = 12\nsince_days = 30\nkind = \"fints\"",
    );
    let l = Fixture::ok(&text, &[("SPARKASSE_PIN", "1234")]);
    let a = &l.config.bank.accounts[0];
    assert_eq!(a.name, "Giro");
    assert_eq!(a.sync_every_hours, 12);
    assert_eq!(a.since_days, Some(30));
    assert_eq!(a.pin_env.as_deref(), Some("SPARKASSE_PIN"));
    // accounts without a product id: a warning, not an error
    assert!(
        l.warnings.iter().any(|w| w.contains("product id")),
        "{:?}",
        l.warnings
    );
    // pin_env that is not set right now: a warning
    let l = Fixture::ok(&text, &[]);
    assert!(
        l.warnings.iter().any(|w| w.contains("SPARKASSE_PIN")),
        "{:?}",
        l.warnings
    );

    // defaults: manual only, kind fints
    let l = Fixture::ok(&Fixture::account(""), &[]);
    assert_eq!(l.config.bank.accounts[0].sync_every_hours, 0);
    assert_eq!(l.config.bank.accounts[0].kind, "fints");

    for (extra, needle) in [
        ("kind = \"hbci\"", "bank.accounts[0].kind"),
        ("fints_url = \"ftp://x\"", "bank.accounts[0].fints_url"),
        (
            "fints_url = \"https://bank.example/fints\"",
            "bank.accounts[0].bic",
        ),
        ("pin_env = \"my pin\"", "bank.accounts[0].pin_env"),
        ("pin_env = \"1234\"", "bank.accounts[0].pin_env"),
        ("since_days = 0", "bank.accounts[0].since_days"),
        ("since_days = 9999", "bank.accounts[0].since_days"),
    ] {
        let e = Fixture::err(&Fixture::account(extra), &[]);
        assert!(e.contains(needle), "{extra}: {e}");
    }
    let bad_code = Fixture::account("").replace("37050198", "3705");
    assert!(Fixture::err(&bad_code, &[]).contains("bank_code"));
    let bad_iban = Fixture::account("").replace("0130 00", "0130 01");
    assert!(Fixture::err(&bad_iban, &[]).contains("bank.accounts[0].iban"));
    let twice = format!("{}{}", Fixture::account(""), Fixture::account(""));
    let e = Fixture::err(&twice, &[]);
    assert!(
        e.contains("bank.accounts[1].name") && e.contains("twice"),
        "{e}"
    );
}

#[test]
fn iban_check() {
    assert!(Validator::iban_ok("DE89370400440532013000"));
    assert!(Validator::iban_ok("de89 3704 0044 0532 0130 00"));
    assert!(Validator::iban_ok("GB82 WEST 1234 5698 7654 32"));
    assert!(!Validator::iban_ok("DE89370400440532013001"));
    assert!(!Validator::iban_ok("DE89"));
    assert!(!Validator::iban_ok(""));
    assert!(!Validator::iban_ok("1234567890123456"));
}

#[test]
fn store_aliases_are_read_and_checked() {
    let text = r#"
        [[stores]]
        chain = "edeka"
        match = "Mueller Frischemarkt"

        [[stores]]
        chain = "Bio Company"
        match = ["BIO COMPANY", "Biocompany GmbH"]
    "#;
    let c = Fixture::ok(text, &[]).config;
    assert_eq!(c.stores.len(), 2);
    assert_eq!(c.stores[0].patterns.to_vec(), ["Mueller Frischemarkt"]);
    assert_eq!(c.stores[1].patterns.to_vec().len(), 2);

    for (text, needle) in [
        (
            "[[stores]]\nchain = \"x\"\nmatch = \"abcdef\"\n",
            "stores[0].chain",
        ),
        (
            "[[stores]]\nchain = \"other\"\nmatch = \"abcdef\"\n",
            "reserved",
        ),
        (
            "[[stores]]\nchain = \"rewe\"\nmatch = \"ab\"\n",
            "stores[0].match",
        ),
        (
            "[[stores]]\nchain = \"rewe\"\nmatch = []\n",
            "stores[0].match",
        ),
    ] {
        let e = Fixture::err(text, &[]);
        assert!(e.contains(needle), "{text}: {e}");
    }
}

#[test]
fn rendering_hides_every_secret_and_says_where_values_come_from() {
    let text = format!(
        r#"
        [auth]
        api_token = "{TOKEN}"
        [database]
        url = "postgres://financer:db-password-123@db/financer"
        [llm]
        anthropic_api_key = "sk-ant-literal-secret"
        [bank]
        fints_product_id = "PRODUCT-ID-XYZ"
        {}
        "#,
        Fixture::account("pin_env = \"SPARKASSE_PIN\"")
    );
    let l = Fixture::ok(
        &text,
        &[
            ("FINANCER_OPENAI_API_KEY", "sk-oai-env-secret"),
            ("FINANCER_BIND", "0.0.0.0:1"),
        ],
    );
    let out = Renderer::render(&l);
    for secret in [
        TOKEN,
        "db-password-123",
        "sk-ant-literal-secret",
        "sk-oai-env-secret",
        "PRODUCT-ID-XYZ",
        "3704",   // IBAN
        "\"me\"", // login
    ] {
        assert!(!out.contains(secret), "{secret} leaked:\n{out}");
    }
    assert!(
        out.contains("bind = \"0.0.0.0:1\"   # env FINANCER_BIND"),
        "{out}"
    );
    assert!(out.contains("# file"), "{out}");
    assert!(out.contains("# default"), "{out}");
    assert!(
        out.contains("openai_api_key = \"<hidden>\"   # env FINANCER_OPENAI_API_KEY"),
        "{out}"
    );
    assert!(out.contains("pin_env = \"SPARKASSE_PIN\""), "{out}");
    // Debug output of the whole configuration is redacted as well
    let debug = format!("{:?}", l.config);
    assert!(
        !debug.contains(TOKEN) && !debug.contains("sk-ant-literal-secret"),
        "{debug}"
    );
}

#[cfg(unix)]
#[test]
fn a_world_readable_file_with_literal_secrets_gets_a_warning() {
    use std::os::unix::fs::PermissionsExt;
    let dir = Fixture::dir();
    let text = format!("[auth]\napi_token = \"{TOKEN}\"\n");
    let path = Fixture::write(dir.path(), "financer.toml", &text);

    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    let l = Loader::load(Some(&path), &MapEnv::default(), dir.path()).unwrap();
    assert!(
        l.warnings.iter().any(|w| w.contains("chmod 600")),
        "{:?}",
        l.warnings
    );
    assert!(l.warnings.iter().all(|w| !w.contains(TOKEN)));

    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let l = Loader::load(Some(&path), &MapEnv::default(), dir.path()).unwrap();
    assert!(
        l.warnings.iter().all(|w| !w.contains("other users")),
        "{:?}",
        l.warnings
    );

    // references only: nothing to warn about, whatever the mode
    std::fs::write(&path, "[auth]\napi_token = \"${FINANCER_API_TOKEN}\"\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    let env = MapEnv::new(&[("FINANCER_API_TOKEN", TOKEN)]);
    let l = Loader::load(Some(&path), &env, dir.path()).unwrap();
    assert!(l.warnings.is_empty(), "{:?}", l.warnings);
}

#[test]
fn problems_for_server_catch_a_missing_or_short_token_and_bad_urls() {
    let dir = Fixture::dir();
    let c = Loader::load(None, &MapEnv::default(), dir.path())
        .unwrap()
        .config;
    let p = c.problems_for_server();
    assert!(p.iter().any(|m| m.contains("no API token")), "{p:?}");

    let env = MapEnv::new(&[("FINANCER_API_TOKEN", "short")]);
    let p = Loader::load(None, &env, dir.path())
        .unwrap()
        .config
        .problems_for_server();
    assert!(p.iter().any(|m| m.contains("at least 32")), "{p:?}");

    let env = MapEnv::new(&[
        ("FINANCER_API_TOKEN", TOKEN),
        ("FINANCER_DATABASE_URL", "mysql://x"),
        ("FINANCER_WEB_DIR", "/definitely/not/here"),
        ("FINANCER_PRICE_SOURCES", "/definitely/not/here.json"),
        ("FINANCER_CORS_ORIGIN", "localhost:8081"),
    ]);
    let p = Loader::load(None, &env, dir.path())
        .unwrap()
        .config
        .problems_for_server();
    for needle in [
        "database.url",
        "server.web_dir",
        "prices.sources_file",
        "server.cors_origins",
    ] {
        assert!(p.iter().any(|m| m.contains(needle)), "{needle}: {p:?}");
    }

    let env = MapEnv::new(&[("FINANCER_API_TOKEN", TOKEN)]);
    let p = Loader::load(None, &env, dir.path())
        .unwrap()
        .config
        .problems_for_server();
    assert!(p.is_empty(), "{p:?}");
}

#[test]
fn database_passwords_are_hidden_in_the_rendered_url() {
    assert_eq!(
        Renderer::hide_password("postgres://u:pw@host/db"),
        "postgres://u:<hidden>@host/db"
    );
    assert_eq!(
        Renderer::hide_password("sqlite://x.db?mode=rwc"),
        "sqlite://x.db?mode=rwc"
    );
    assert_eq!(
        Renderer::hide_password("postgres://u@host/db"),
        "postgres://u@host/db"
    );
}

const EXAMPLE: &str = include_str!("../../../financer.example.toml");

#[test]
fn the_example_file_changes_nothing_as_shipped() {
    let l = Fixture::ok(EXAMPLE, &[]);
    assert_eq!(l.config.server.bind.source, Source::Default);
    assert!(l.config.bank.accounts.is_empty());
    assert!(l.warnings.is_empty(), "{:?}", l.warnings);
}

#[test]
fn every_option_in_the_example_file_is_real() {
    // `#key = value` lines are options; `# text` lines are prose
    let uncommented: String = EXAMPLE
        .lines()
        .filter(|l| !l.contains("api_token_file")) // either api_token or api_token_file
        .map(|l| match l.strip_prefix('#') {
            Some(rest) if !rest.is_empty() && !rest.starts_with(' ') => rest,
            _ => l,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let env = [
        ("FINANCER_API_TOKEN", TOKEN),
        ("ANTHROPIC_API_KEY", "sk-a"),
        ("OPENAI_API_KEY", "sk-o"),
        ("FINTS_PRODUCT_ID", "PID"),
        ("SPARKASSE_PIN", "1234"),
    ];
    let l = Fixture::ok(&uncommented, &env);
    let c = &l.config;
    assert_eq!(c.server.cors_origins.value, ["http://localhost:8081"]);
    assert_eq!(c.server.refresh_hours.source, Source::File);
    assert!(c.auth.api_token.value.is_some());
    assert_eq!(c.llm.provider.value, Some(ProviderChoice::Claude));
    assert_eq!(c.bank.accounts.len(), 1);
    assert_eq!(c.bank.accounts[0].sync_every_hours, 12);
    assert_eq!(c.stores.len(), 2);
    assert!(l.warnings.is_empty(), "{:?}", l.warnings);
}
