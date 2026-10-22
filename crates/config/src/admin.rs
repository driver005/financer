//! What the settings screen of the app talks to: the list of keys with their current values and
//! where each one comes from, and the change that saves new values.
//!
//! A saved change goes to the settings file ([`SettingsFile`]) and takes effect when the server
//! restarts (the caller does that). Before anything is written the change is checked the way the
//! server would check it at start, so a mistake is reported next to the field instead of
//! stopping the server.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::schema::{Field, Key, Kind, GROUPS, KEYS};
use crate::settings_file::{now, Pending, SettingsFile, Stored};
use crate::{Env, Loader, Overlay, Renderer};

/// One column of a table key.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FieldView {
    pub key: String,
    pub label: String,
    pub help: String,
    /// `text`, `path`, `secret`, `number`, `toggle`, `choice` or `list`.
    pub kind: String,
    pub options: Vec<String>,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub required: bool,
    pub default: Option<String>,
    pub placeholder: Option<String>,
    /// Shown only while this other field of the row has `when_value` (one value, or several
    /// separated by commas).
    pub when_field: Option<String>,
    pub when_value: Option<String>,
}

/// One key with what it is now.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct KeyView {
    /// Dotted path, as in the file.
    pub path: String,
    pub label: String,
    pub help: String,
    /// `text`, `path`, `secret`, `number`, `toggle`, `choice`, `list` or `table`.
    pub kind: String,
    pub options: Vec<String>,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub default: Option<String>,
    pub placeholder: Option<String>,
    /// The environment variable that overrides this key.
    pub env: Option<String>,
    /// Said before saving.
    pub warning: Option<String>,
    /// Where the value in force comes from: `default`, `file`, `app` or `env`.
    pub source: String,
    /// The environment variable is set, so the app cannot change it.
    pub locked: bool,
    /// Has a value (not blank).
    pub is_set: bool,
    /// The value in force; never present for a secret.
    pub value: Option<Value>,
    /// A secret that is safe to show in part (a database address without its password).
    pub preview: Option<String>,
    pub fields: Vec<FieldView>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct GroupView {
    pub id: String,
    pub title: String,
    pub hint: String,
    pub icon: String,
    pub keys: Vec<KeyView>,
}

/// The whole settings screen.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ConfigView {
    /// Where the app's edits are kept.
    pub settings_file: String,
    /// The server may write that file; without it nothing can be saved.
    pub writable: bool,
    /// A change is saved but the server has not yet started with it. The app waits for this to
    /// turn false (or `state` to turn `rolled_back`) after it saved something.
    pub applying: bool,
    /// `ok`, or `rolled_back` when the last change did not start and was undone.
    pub state: String,
    pub message: Option<String>,
    /// Problems with the configuration as it is now.
    pub problems: Vec<String>,
    pub warnings: Vec<String>,
    pub groups: Vec<GroupView>,
}

/// What to change: `set` writes values (`null` clears one), `reset` removes the app's value so the
/// file's, or the default, applies again.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Change {
    #[serde(default)]
    pub set: BTreeMap<String, Value>,
    #[serde(default)]
    pub reset: Vec<String>,
}

/// A change that was saved.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Update {
    /// The keys whose value is different now. Empty means nothing needs a restart.
    pub changed: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateError {
    /// The change is not acceptable; one problem per line, naming the key.
    Invalid(Vec<String>),
    /// The change touches a key an environment variable decides.
    Locked(Vec<String>),
    /// The settings file could not be written.
    Storage(String),
}

pub struct Admin {
    config_arg: Option<PathBuf>,
    cwd: PathBuf,
    env: Arc<dyn Env + Send + Sync>,
    file: SettingsFile,
    lock: Mutex<()>,
}

impl Admin {
    pub fn new(
        config_arg: Option<PathBuf>,
        cwd: PathBuf,
        env: Arc<dyn Env + Send + Sync>,
        file: SettingsFile,
    ) -> Self {
        Self {
            config_arg,
            cwd,
            env,
            file,
            lock: Mutex::new(()),
        }
    }

    pub fn file(&self) -> &SettingsFile {
        &self.file
    }

    fn load(&self, overlay: &Overlay) -> Result<crate::Loaded, crate::ConfigError> {
        Loader::load_with(self.config_arg.as_deref(), &*self.env, &self.cwd, overlay)
    }

    fn file_doc(&self) -> Result<toml::Value, crate::ConfigError> {
        Loader::file_layer(self.config_arg.as_deref(), &*self.env, &self.cwd).map(|l| l.doc)
    }

    // -------------------------------------------------------------------------------- view

    pub fn view(&self) -> ConfigView {
        let mut problems = Vec::new();
        let stored = self.file.read().unwrap_or_else(|e| {
            problems.push(e);
            Stored::default()
        });
        let overlay = Overlay::new(stored.values.clone());
        let doc = self.file_doc().unwrap_or_else(|e| {
            problems.extend(e.problems);
            toml::Value::Table(toml::map::Map::new())
        });
        let mut warnings = Vec::new();
        match self.load(&overlay) {
            Ok(loaded) => {
                warnings = loaded.warnings;
                problems.extend(loaded.config.problems_for_server());
            }
            Err(e) => problems.extend(e.problems),
        }
        problems.dedup();
        let env: &dyn Env = &*self.env;
        let groups = GROUPS
            .iter()
            .map(|g| GroupView {
                id: g.id.into(),
                title: g.title.into(),
                hint: g.hint.into(),
                icon: g.icon.into(),
                keys: KEYS
                    .iter()
                    .filter(|k| k.group == g.id)
                    .map(|k| Self::key_view(k, env, &overlay, &doc))
                    .collect(),
            })
            .collect();
        let (state, message) = match &stored.last_error {
            Some(e) => ("rolled_back", Some(e.message.clone())),
            None => ("ok", None),
        };
        ConfigView {
            settings_file: self.file.path().display().to_string(),
            writable: self.file.writable(),
            applying: stored.pending.is_some(),
            state: state.into(),
            message,
            problems,
            warnings,
            groups,
        }
    }

    fn key_view(key: &Key, env: &dyn Env, overlay: &Overlay, doc: &toml::Value) -> KeyView {
        let from_env = key
            .env
            .and_then(|name| env.nonempty(name).map(|v| Self::from_env(key, &v)));
        let (source, raw) = if let Some(v) = from_env {
            ("env", Some(v))
        } else if let Some(v) = overlay.get(key.path) {
            ("app", Some(v.clone()))
        } else if let Some(v) = Self::lookup(doc, key.path) {
            ("file", Some(v))
        } else {
            ("default", None)
        };
        let raw = raw.map(|v| Self::for_view(key, v));
        let is_set = raw.as_ref().is_some_and(|v| !Self::blank(v));
        let secret = key.kind == Kind::Secret;
        let preview = (secret && key.path == "database.url" && is_set)
            .then(|| {
                raw.as_ref()
                    .and_then(Value::as_str)
                    .map(Renderer::hide_password)
            })
            .flatten();
        KeyView {
            path: key.path.into(),
            label: key.label.into(),
            help: key.help.into(),
            kind: key.kind.name().into(),
            options: key.options.iter().map(|s| s.to_string()).collect(),
            min: Self::bound(key.kind, key.min, true),
            max: Self::bound(key.kind, key.max, false),
            default: Some(key.default.to_string()).filter(|d| !d.is_empty()),
            placeholder: Some(key.placeholder.to_string()).filter(|d| !d.is_empty()),
            env: key.env.map(String::from),
            warning: key.warning.map(String::from),
            source: source.into(),
            locked: key.env.is_some_and(|n| env.nonempty(n).is_some()),
            is_set,
            value: if secret { None } else { raw },
            preview,
            fields: key.fields.iter().map(Self::field_view).collect(),
        }
    }

    fn field_view(f: &Field) -> FieldView {
        FieldView {
            key: f.key.into(),
            label: f.label.into(),
            help: f.help.into(),
            kind: f.kind.name().into(),
            options: f.options.iter().map(|s| s.to_string()).collect(),
            min: Self::bound(f.kind, f.min, true),
            max: Self::bound(f.kind, f.max, false),
            required: f.required,
            default: Some(f.default.to_string()).filter(|d| !d.is_empty()),
            placeholder: Some(f.placeholder.to_string()).filter(|d| !d.is_empty()),
            when_field: f.when.map(|(k, _)| k.to_string()),
            when_value: f.when.map(|(_, v)| v.to_string()),
        }
    }

    /// Only numbers have a range worth showing.
    fn bound(kind: Kind, v: i64, is_min: bool) -> Option<i64> {
        (kind == Kind::Int && (is_min || v != i64::MAX)).then_some(v)
    }

    /// The value of `path` in a TOML document, as JSON.
    fn lookup(doc: &toml::Value, path: &str) -> Option<Value> {
        let mut cur = doc;
        for part in path.split('.') {
            cur = cur.get(part)?;
        }
        serde_json::to_value(cur).ok()
    }

    fn blank(v: &Value) -> bool {
        match v {
            Value::Null => true,
            Value::String(s) => s.trim().is_empty(),
            Value::Array(a) => a.is_empty(),
            _ => false,
        }
    }

    /// An environment variable's text as the value of the key.
    fn from_env(key: &Key, text: &str) -> Value {
        let t = text.trim();
        match key.kind {
            Kind::Int => t
                .parse::<i64>()
                .map(Value::from)
                .unwrap_or_else(|_| Value::String(t.into())),
            Kind::Bool => Value::Bool(matches!(
                t.to_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )),
            Kind::Choice => Value::String(t.to_lowercase()),
            Kind::List => Value::Array(
                t.split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(Value::from)
                    .collect(),
            ),
            Kind::Table => Self::senders_from_env(t),
            _ => Value::String(t.into()),
        }
    }

    /// `rewe=rewe.de,rewe-group.com;lidl=lidl.de`.
    fn senders_from_env(spec: &str) -> Value {
        Value::Array(
            spec.split(';')
                .filter_map(|part| part.split_once('='))
                .map(|(retailer, from)| {
                    let mut row = Map::new();
                    row.insert(
                        "retailer".into(),
                        Value::from(retailer.trim().to_lowercase()),
                    );
                    row.insert(
                        "from".into(),
                        Value::Array(
                            from.split(',')
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(Value::from)
                                .collect(),
                        ),
                    );
                    Value::Object(row)
                })
                .collect(),
        )
    }

    /// The file lets a list be written as one text (`match = "x"`); the app always gets a list.
    fn for_view(key: &Key, v: Value) -> Value {
        match (key.kind, v) {
            (Kind::List, Value::String(s)) => Value::Array(vec![Value::String(s)]),
            (Kind::Table, Value::Array(rows)) => Value::Array(
                rows.into_iter()
                    .map(|row| match row {
                        Value::Object(mut obj) => {
                            for f in key.fields.iter().filter(|f| f.kind == Kind::List) {
                                match (obj.get(f.key).cloned(), f.pair) {
                                    (Some(Value::String(s)), None) => {
                                        obj.insert(
                                            f.key.into(),
                                            Value::Array(vec![Value::String(s)]),
                                        );
                                    }
                                    (Some(Value::Array(items)), Some((left, right))) => {
                                        obj.insert(
                                            f.key.into(),
                                            Value::Array(
                                                items
                                                    .iter()
                                                    .filter_map(|i| Self::pair_text(i, left, right))
                                                    .map(Value::String)
                                                    .collect(),
                                            ),
                                        );
                                    }
                                    _ => {}
                                }
                            }
                            Value::Object(obj)
                        }
                        other => other,
                    })
                    .collect(),
            ),
            (_, other) => other,
        }
    }

    /// `{ "item": "milch", "barcode": "4012…" }` -> `milch=4012…`.
    fn pair_text(v: &Value, left: &str, right: &str) -> Option<String> {
        let obj = v.as_object()?;
        Some(format!(
            "{}={}",
            obj.get(left)?.as_str()?,
            obj.get(right)?.as_str()?
        ))
    }

    /// `milch=4012…` -> `{ "item": "milch", "barcode": "4012…" }`.
    fn pair_object(text: &str, left: &str, right: &str, label: &str) -> Result<Value, String> {
        let (l, r) = text
            .split_once('=')
            .map(|(l, r)| (l.trim(), r.trim()))
            .filter(|(l, r)| !l.is_empty() && !r.is_empty())
            .ok_or_else(|| format!("{label}: write each entry as {left}={right}, not {text:?}"))?;
        let mut obj = Map::new();
        obj.insert(left.into(), Value::from(l));
        obj.insert(right.into(), Value::from(r));
        Ok(Value::Object(obj))
    }

    // -------------------------------------------------------------------------------- update

    /// Check and save `change`. The caller restarts the server when `changed` is not empty.
    pub fn update(&self, change: &Change) -> Result<Update, UpdateError> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut stored = self.file.read().map_err(UpdateError::Storage)?;
        let before = stored.values.clone();
        let doc = self
            .file_doc()
            .unwrap_or_else(|_| toml::Value::Table(toml::map::Map::new()));

        let mut problems = Vec::new();
        let mut locked = Vec::new();
        let mut next = before.clone();
        let paths = change.set.keys().chain(change.reset.iter());
        for path in paths {
            match crate::schema::key(path) {
                None => problems.push(format!("{path}: not a setting of this server")),
                Some(k) => {
                    if let Some(var) = k.env.filter(|n| self.env.nonempty(n).is_some()) {
                        locked.push(format!(
                            "{}: set by the environment variable {var} on the server; change it there",
                            k.label
                        ));
                    }
                }
            }
        }
        if !locked.is_empty() {
            return Err(UpdateError::Locked(locked));
        }
        if !problems.is_empty() {
            return Err(UpdateError::Invalid(problems));
        }
        for path in &change.reset {
            next.remove(path);
        }
        for (path, value) in &change.set {
            let key = crate::schema::key(path).expect("checked above");
            let in_file = Self::lookup(&doc, path).is_some_and(|v| !Self::blank(&v));
            match Self::normalize(key, value, in_file) {
                Ok(Some(v)) => {
                    next.insert(path.clone(), v);
                }
                Ok(None) => {
                    next.remove(path);
                }
                Err(e) => problems.push(e),
            }
        }
        if !problems.is_empty() {
            return Err(UpdateError::Invalid(problems));
        }

        // the server would refuse to start with this: say so now
        let candidate = Overlay::new(next.clone());
        let loaded = self.load(&candidate).map_err(|e| {
            UpdateError::Invalid(e.problems.iter().map(|p| Self::friendly(p)).collect())
        })?;
        let server_problems = loaded.config.problems_for_server();
        if !server_problems.is_empty() {
            return Err(UpdateError::Invalid(server_problems));
        }

        let changed: Vec<String> = before
            .keys()
            .chain(next.keys())
            .filter(|k| before.get(*k) != next.get(*k))
            .cloned()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        if changed.is_empty() {
            return Ok(Update {
                changed,
                warnings: loaded.warnings,
            });
        }
        // an update on top of one that has not proved itself keeps the last good values
        let previous = stored
            .pending
            .take()
            .map(|p| p.previous)
            .unwrap_or_else(|| before.clone());
        stored.values = next;
        stored.pending = Some(Pending {
            previous,
            attempts: 0,
            at: now(),
        });
        stored.last_error = None;
        self.file.write(&stored).map_err(UpdateError::Storage)?;
        Ok(Update {
            changed,
            warnings: loaded.warnings,
        })
    }

    /// `<file>: missing field `host`\nin `receipts.email`` -> `receipts.email.host: required`.
    fn friendly(problem: &str) -> String {
        if let Some((_, rest)) = problem.split_once("missing field `") {
            let field = rest.split('`').next().unwrap_or("");
            return match rest
                .split_once("in `")
                .and_then(|(_, s)| s.split('`').next())
            {
                Some(section) => format!("{section}.{field}: required"),
                None => format!("{field}: required"),
            };
        }
        problem.trim().to_string()
    }

    /// The value to store for `key`, or `None` when the app's entry should go away.
    /// `in_file` says the file already gives the key a value (clearing it then has to be
    /// written down as an empty value).
    fn normalize(key: &Key, value: &Value, in_file: bool) -> Result<Option<Value>, String> {
        let label = key.path;
        match key.kind {
            Kind::Table => {
                let rows = match value {
                    Value::Null => Vec::new(),
                    Value::Array(rows) => rows.clone(),
                    _ => return Err(format!("{label}: must be a list of entries")),
                };
                let mut out = Vec::new();
                for (i, row) in rows.iter().enumerate() {
                    out.push(Self::row(key, i, row)?);
                }
                Ok(Self::or_cleared(Value::Array(out), in_file))
            }
            Kind::Text | Kind::Path | Kind::Secret | Kind::List => {
                let v = Self::scalar(key.kind, key.options, key.min, key.max, label, value)?;
                Ok(match v {
                    Some(v) => Some(v),
                    None if in_file && key.kind == Kind::List => Some(Value::Array(Vec::new())),
                    None if in_file => Some(Value::String(String::new())),
                    None => None,
                })
            }
            Kind::Int | Kind::Bool | Kind::Choice => {
                Self::scalar(key.kind, key.options, key.min, key.max, label, value)
            }
        }
    }

    fn or_cleared(v: Value, in_file: bool) -> Option<Value> {
        match &v {
            Value::Array(a) if a.is_empty() && !in_file => None,
            _ => Some(v),
        }
    }

    /// One row of a table key.
    fn row(key: &Key, index: usize, value: &Value) -> Result<Value, String> {
        let at = |name: &str| format!("{}[{index}].{name}", key.path);
        let obj = value
            .as_object()
            .ok_or_else(|| format!("{}[{index}]: must be an object", key.path))?;
        let mut out = Map::new();
        for (name, v) in obj {
            let field = key
                .field(name)
                .ok_or_else(|| format!("{}[{index}]: unknown field {name:?}", key.path))?;
            if let Some(v) = Self::scalar(
                field.kind,
                field.options,
                field.min,
                field.max,
                &at(name),
                v,
            )? {
                out.insert(name.clone(), v);
            }
        }
        for f in key.fields.iter().filter(|f| f.required) {
            if let Some((other, _)) = f.when {
                let actual = out
                    .get(other)
                    .and_then(Value::as_str)
                    .or_else(|| key.field(other).map(|o| o.default))
                    .unwrap_or("");
                if !f.applies_to(actual) {
                    continue;
                }
            }
            if !out.contains_key(f.key) {
                return Err(format!("{}: {} is required", at(f.key), f.label));
            }
        }
        // entries written `left=right` are stored as objects
        for f in key.fields.iter().filter(|f| f.pair.is_some()) {
            if let (Some((left, right)), Some(Value::Array(items))) =
                (f.pair, out.get(f.key).cloned())
            {
                let objects = items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|t| Self::pair_object(t, left, right, &at(f.key)))
                    .collect::<Result<Vec<_>, _>>()?;
                out.insert(f.key.into(), Value::Array(objects));
            }
        }
        Ok(Value::Object(out))
    }

    /// A single value checked against its kind; `None` means blank.
    fn scalar(
        kind: Kind,
        options: &[&str],
        min: i64,
        max: i64,
        label: &str,
        value: &Value,
    ) -> Result<Option<Value>, String> {
        let one_line = |s: &str| -> Result<(), String> {
            if s.chars().any(char::is_control) {
                Err(format!("{label}: must be a single line of text"))
            } else {
                Ok(())
            }
        };
        match (kind, value) {
            (_, Value::Null) => Ok(None),
            (Kind::Text | Kind::Path | Kind::Secret, Value::String(s)) => {
                let s = s.trim();
                one_line(s)?;
                Ok((!s.is_empty()).then(|| Value::String(s.into())))
            }
            (Kind::Int, Value::Number(n)) => {
                let n = n
                    .as_i64()
                    .ok_or_else(|| format!("{label}: must be a whole number"))?;
                Self::in_range(label, n, min, max)
            }
            (Kind::Int, Value::String(s)) if s.trim().is_empty() => Ok(None),
            (Kind::Int, Value::String(s)) => {
                let n = s
                    .trim()
                    .parse::<i64>()
                    .map_err(|_| format!("{label}: must be a whole number"))?;
                Self::in_range(label, n, min, max)
            }
            (Kind::Bool, Value::Bool(b)) => Ok(Some(Value::Bool(*b))),
            (Kind::Choice, Value::String(s)) => {
                let s = s.trim().to_lowercase();
                if s.is_empty() {
                    Ok(None)
                } else if options.contains(&s.as_str()) {
                    Ok(Some(Value::String(s)))
                } else {
                    Err(format!("{label}: use one of {}", options.join(", ")))
                }
            }
            (Kind::List, Value::Array(items)) => {
                let mut out = Vec::new();
                for item in items {
                    let Value::String(s) = item else {
                        return Err(format!("{label}: every entry must be text"));
                    };
                    let s = s.trim();
                    one_line(s)?;
                    if !s.is_empty() {
                        out.push(Value::String(s.into()));
                    }
                }
                Ok((!out.is_empty()).then_some(Value::Array(out)))
            }
            (Kind::List, Value::String(s)) => Self::scalar(
                kind,
                options,
                min,
                max,
                label,
                &Value::Array(vec![Value::String(s.clone())]),
            ),
            (Kind::Table, _) => Err(format!("{label}: a list of entries cannot be nested")),
            (k, _) => Err(format!("{label}: expected a {}", k.name())),
        }
    }

    fn in_range(label: &str, n: i64, min: i64, max: i64) -> Result<Option<Value>, String> {
        if n < min || n > max {
            let top = if max == i64::MAX {
                String::new()
            } else {
                format!(" and {max}")
            };
            return Err(format!("{label}: must be between {min}{top}"));
        }
        Ok(Some(Value::from(n)))
    }
}
