//! Settings > Server settings: what the form shows for each key of the server's `financer.toml`,
//! which edits are pending, what gets sent when you save, and the words around it.
//!
//! The server describes the keys (label, kind, range, where the value comes from); this module only
//! knows the kinds, so a key added on the server shows up in the app without a new release. Keys,
//! rows and drafts are plain JSON here, exactly the shapes the server and the form already use.
//! Waiting for the restart (a poll with a clock) stays in TypeScript.

use serde_json::{json, Map, Value};

// ---- reading JSON the way the form needs it ----

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn truthy_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    str_of(v, key).filter(|s| !s.is_empty())
}

fn bool_of(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn items<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn is_nullish(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null))
}

/// JavaScript's `String(v)` for the values a config can hold.
fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else {
                let f = n.as_f64().unwrap_or(f64::NAN);
                if f.fract() == 0.0 && f.abs() < 1e21 {
                    format!("{}", f as i128)
                } else {
                    f.to_string()
                }
            }
        }
        Value::Array(a) => a.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

fn as_strings(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a.iter().map(js_string).collect(),
        Some(Value::String(s)) if !s.trim().is_empty() => vec![s.clone()],
        _ => vec![],
    }
}

fn strings_value(v: Vec<String>) -> Value {
    Value::Array(v.into_iter().map(Value::String).collect())
}

fn blank(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }
}

fn capitalised(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

// ---- names ----

/// What a table's entries are called, for "Add account" and "Remove account".
pub fn entry_noun(path: &str) -> &'static str {
    match path {
        "bank.accounts" => "account",
        "stores" => "store name",
        "receipts.email.senders" => "sender",
        _ => "entry",
    }
}

/// "Account 2: Giro" for the heading of a table entry (the first column names it when it has a value).
pub fn entry_title(path: &str, fields: &[Value], row: &Value, index: usize) -> String {
    let noun = entry_noun(path);
    let name = fields
        .first()
        .and_then(|f| str_of(f, "key"))
        .and_then(|k| row.get(k))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let suffix = if name.is_empty() {
        String::new()
    } else {
        format!(": {name}")
    };
    format!("{} {}{}", capitalised(noun), index + 1, suffix)
}

// ---- reading a key ----

/// The default of a column, as a choice's starting value.
fn field_default(f: &Value) -> String {
    if let Some(d) = f.get("default").and_then(Value::as_str) {
        return d.to_string();
    }
    items(f, "options")
        .first()
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// One table entry from the server, as text fields and lists.
pub fn row_from_server(key: &Value, raw: &Value) -> Value {
    let mut row = Map::new();
    for f in items(key, "fields") {
        let name = str_of(f, "key").unwrap_or("").to_string();
        let v = raw.get(&name);
        let value = match str_of(f, "kind").unwrap_or("") {
            "list" => strings_value(as_strings(v)),
            "toggle" => Value::Bool(if is_nullish(v) {
                str_of(f, "default") == Some("on")
            } else {
                v == Some(&Value::Bool(true))
            }),
            "choice" => match v {
                Some(Value::String(s)) if !s.is_empty() => Value::String(s.clone()),
                _ => Value::String(field_default(f)),
            },
            _ => Value::String(match v {
                None | Some(Value::Null) => String::new(),
                Some(x) => js_string(x),
            }),
        };
        row.insert(name, value);
    }
    Value::Object(row)
}

/// A new, empty entry; a choice starts on its default (an account on FinTS).
pub fn empty_row(key: &Value) -> Value {
    row_from_server(key, &json!({}))
}

/// The value the server has now, in the shape the form edits.
pub fn server_value(key: &Value) -> Value {
    let v = key.get("value");
    match str_of(key, "kind").unwrap_or("") {
        "secret" => json!(""),
        "toggle" => Value::Bool(if is_nullish(v) {
            str_of(key, "default") == Some("on")
        } else {
            v == Some(&Value::Bool(true))
        }),
        "choice" => match v {
            Some(Value::String(s)) if !s.is_empty() => Value::String(s.clone()),
            _ => Value::String(field_default(key)),
        },
        "list" => strings_value(as_strings(v)),
        "table" => match v {
            Some(Value::Array(rows)) => {
                Value::Array(rows.iter().map(|r| row_from_server(key, r)).collect())
            }
            _ => json!([]),
        },
        _ => Value::String(match v {
            None | Some(Value::Null) => String::new(),
            Some(x) => js_string(x),
        }),
    }
}

fn draft_set(draft: &Value) -> Map<String, Value> {
    draft
        .get("set")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn draft_reset(draft: &Value) -> Vec<String> {
    items(draft, "reset")
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

fn make_draft(set: Map<String, Value>, reset: Vec<String>) -> Value {
    json!({ "set": set, "reset": reset })
}

/// What the form shows for a key: the pending edit if there is one, else what the server has.
pub fn editor_value(key: &Value, draft: &Value) -> Value {
    let path = str_of(key, "path").unwrap_or("");
    match draft_set(draft).get(path) {
        Some(Value::Null) => {
            if str_of(key, "kind") == Some("secret") {
                json!("")
            } else {
                server_value(key)
            }
        }
        Some(pending) => pending.clone(),
        None => server_value(key),
    }
}

// ---- editing ----

/// The draft with this key set to `value`; setting it back to what the server has drops the edit.
pub fn set_value(draft: &Value, key: &Value, value: &Value) -> Value {
    let path = str_of(key, "path").unwrap_or("").to_string();
    let secret = str_of(key, "kind") == Some("secret");
    let mut set = draft_set(draft);
    // an edit that equals what the server has (or an empty secret) is no edit
    if (!secret && *value == server_value(key)) || (secret && value == &json!("")) {
        set.remove(&path);
    } else {
        set.insert(path.clone(), value.clone());
    }
    let reset = draft_reset(draft)
        .into_iter()
        .filter(|p| *p != path)
        .collect();
    make_draft(set, reset)
}

/// Clear a secret (the server forgets it).
pub fn clear_secret(draft: &Value, key: &Value) -> Value {
    let path = str_of(key, "path").unwrap_or("").to_string();
    let mut set = draft_set(draft);
    set.insert(path.clone(), Value::Null);
    let reset = draft_reset(draft)
        .into_iter()
        .filter(|p| *p != path)
        .collect();
    make_draft(set, reset)
}

/// Drop the value set from the app so the file's, or the default, applies again.
pub fn reset_key(draft: &Value, key: &Value) -> Value {
    let path = str_of(key, "path").unwrap_or("").to_string();
    let mut set = draft_set(draft);
    set.remove(&path);
    let mut reset = draft_reset(draft);
    if str_of(key, "source") == Some("app") && !reset.contains(&path) {
        reset.push(path);
    }
    make_draft(set, reset)
}

/// Undo an edit or a reset of one key.
pub fn discard_key(draft: &Value, key: &Value) -> Value {
    let path = str_of(key, "path").unwrap_or("").to_string();
    let mut set = draft_set(draft);
    set.remove(&path);
    let reset = draft_reset(draft)
        .into_iter()
        .filter(|p| *p != path)
        .collect();
    make_draft(set, reset)
}

pub fn is_dirty(path: &str, draft: &Value) -> bool {
    draft_set(draft).contains_key(path) || draft_reset(draft).iter().any(|p| p == path)
}

pub fn change_count(draft: &Value) -> usize {
    draft_set(draft).len() + draft_reset(draft).len()
}

/// Whether this key can be edited here: not while an environment variable decides it.
pub fn editable(key: &Value) -> bool {
    !bool_of(key, "locked")
}

// ---- what is sent ----

/// Whether a column applies to this entry (a FinTS column of a Plaid account does not). A column can
/// apply to several values of the other one, written as a comma-separated list.
pub fn field_visible(key: &Value, field: &Value, row: &Value) -> bool {
    let Some(when) = truthy_str(field, "when_field") else {
        return true;
    };
    let actual = match row.get(when) {
        Some(v) if !v.is_null() => js_string(v),
        _ => items(key, "fields")
            .iter()
            .find(|f| str_of(f, "key") == Some(when))
            .map(field_default)
            .unwrap_or_default(),
    };
    str_of(field, "when_value")
        .unwrap_or("")
        .split(',')
        .any(|v| v.trim() == actual)
}

fn number_value(text: &str) -> Value {
    if let Ok(i) = text.parse::<i64>() {
        return json!(i);
    }
    match text.parse::<f64>() {
        Ok(f) if f.is_finite() => json!(f),
        _ => Value::Null,
    }
}

/// A scalar the way the server wants it; `None` for "leave it out" (JSON null).
fn wire_scalar(kind: &str, v: Option<&Value>) -> Value {
    if kind == "toggle" {
        // off is the default, so it is left out
        return if v == Some(&Value::Bool(true)) {
            Value::Bool(true)
        } else {
            Value::Null
        };
    }
    if blank(v) {
        return Value::Null;
    }
    let v = v.unwrap();
    match kind {
        "number" => number_value(js_string(v).trim()),
        "list" => strings_value(
            as_strings(Some(v))
                .into_iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        ),
        _ => match v {
            Value::String(s) => Value::String(s.trim().to_string()),
            other => other.clone(),
        },
    }
}

/// One entry as the server wants it: only the columns that apply and have a value.
pub fn row_to_wire(key: &Value, row: &Value) -> Value {
    let mut out = Map::new();
    for f in items(key, "fields") {
        if !field_visible(key, f, row) {
            continue;
        }
        let name = str_of(f, "key").unwrap_or("");
        let v = wire_scalar(str_of(f, "kind").unwrap_or(""), row.get(name));
        let empty_list = matches!(&v, Value::Array(a) if a.is_empty());
        if !v.is_null() && !empty_list {
            out.insert(name.to_string(), v);
        }
    }
    Value::Object(out)
}

/// The value to send for an edited key; `null` clears it.
pub fn wire_value(key: &Value, value: &Value) -> Value {
    if value.is_null() {
        return Value::Null;
    }
    match str_of(key, "kind").unwrap_or("") {
        "toggle" => Value::Bool(value == &Value::Bool(true)),
        "table" => {
            let rows: Vec<Value> = value
                .as_array()
                .map(|a| a.iter().map(|r| row_to_wire(key, r)).collect())
                .unwrap_or_default();
            if rows.is_empty() {
                Value::Null
            } else {
                Value::Array(rows)
            }
        }
        "list" => match wire_scalar("list", Some(value)) {
            Value::Array(a) if !a.is_empty() => Value::Array(a),
            _ => Value::Null,
        },
        kind => wire_scalar(kind, Some(value)),
    }
}

fn all_keys(view: &Value) -> Vec<&Value> {
    items(view, "groups")
        .iter()
        .flat_map(|g| items(g, "keys").iter())
        .collect()
}

/// The request body for saving the draft.
pub fn to_change(view: &Value, draft: &Value) -> Value {
    let keys = all_keys(view);
    let mut set = Map::new();
    for (path, value) in draft_set(draft) {
        if let Some(key) = keys
            .iter()
            .find(|k| str_of(k, "path") == Some(path.as_str()))
        {
            set.insert(path, wire_value(key, &value));
        }
    }
    let reset: Vec<String> = draft_reset(draft)
        .into_iter()
        .filter(|p| keys.iter().any(|k| str_of(k, "path") == Some(p.as_str())))
        .collect();
    json!({ "set": set, "reset": reset })
}

// ---- checking before saving ----

fn number_problem(
    label: &str,
    v: Option<&Value>,
    min: Option<i64>,
    max: Option<i64>,
) -> Option<String> {
    if blank(v) {
        return None;
    }
    let text = js_string(v.unwrap());
    let text = text.trim();
    let digits = text.strip_prefix('-').unwrap_or(text);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Some(format!("{label}: enter a whole number"));
    }
    let n: f64 = text.parse().unwrap_or(f64::NAN);
    if let Some(min) = min {
        if n < min as f64 {
            return Some(format!("{label}: at least {min}"));
        }
    }
    if let Some(max) = max {
        if n > max as f64 {
            return Some(format!("{label}: at most {max}"));
        }
    }
    None
}

/// What is wrong with the edit of a key, in a few words; `None` when it is fine. The server checks again.
pub fn problem_for(key: &Value, value: &Value) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let label = str_of(key, "label").unwrap_or("");
    let min = key.get("min").and_then(Value::as_i64);
    let max = key.get("max").and_then(Value::as_i64);
    match str_of(key, "kind").unwrap_or("") {
        "number" => number_problem(label, Some(value), min, max),
        "choice" => {
            let s = value.as_str()?;
            let options: Vec<&str> = items(key, "options")
                .iter()
                .filter_map(Value::as_str)
                .collect();
            if !s.is_empty() && !options.contains(&s) {
                Some(format!("{label}: choose one of {}", options.join(", ")))
            } else {
                None
            }
        }
        "table" => {
            let path = str_of(key, "path").unwrap_or("");
            for (i, row) in value
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[])
                .iter()
                .enumerate()
            {
                for f in items(key, "fields") {
                    if !field_visible(key, f, row) {
                        continue;
                    }
                    let v = row.get(str_of(f, "key").unwrap_or(""));
                    let where_ = entry_title(path, &[], row, i);
                    let flabel = str_of(f, "label").unwrap_or("");
                    if bool_of(f, "required") && blank(v) {
                        return Some(format!("{where_}: {flabel} is needed"));
                    }
                    if str_of(f, "kind") == Some("number") {
                        let fmin = f.get("min").and_then(Value::as_i64);
                        let fmax = f.get("max").and_then(Value::as_i64);
                        if let Some(p) = number_problem(flabel, v, fmin, fmax) {
                            return Some(format!("{where_}: {p}"));
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Problems with all pending edits, by key.
pub fn draft_problems(view: &Value, draft: &Value) -> Value {
    let set = draft_set(draft);
    let mut out = Map::new();
    for key in all_keys(view) {
        let path = str_of(key, "path").unwrap_or("");
        if let Some(value) = set.get(path) {
            if let Some(p) = problem_for(key, value) {
                out.insert(path.to_string(), Value::String(p));
            }
        }
    }
    Value::Object(out)
}

/// The warnings of the keys being changed (the listen address, the token, the database).
pub fn warnings_for(view: &Value, draft: &Value) -> Value {
    Value::Array(
        all_keys(view)
            .into_iter()
            .filter_map(|k| {
                let warning = truthy_str(k, "warning")?;
                if is_dirty(str_of(k, "path").unwrap_or(""), draft) {
                    Some(json!({ "label": str_of(k, "label").unwrap_or(""), "warning": warning }))
                } else {
                    None
                }
            })
            .collect(),
    )
}

/// The new API token typed into the form, if there is one. The app then switches to it after the restart.
pub fn new_token(draft: &Value) -> Option<String> {
    let set = draft_set(draft);
    let t = set.get("auth.api_token")?.as_str()?.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

// ---- words ----

/// Where the value of a key comes from, in plain words.
pub fn source_label(key: &Value) -> String {
    match str_of(key, "source").unwrap_or("") {
        "env" => format!(
            "Set by {} on the server",
            truthy_str(key, "env")
                .or_else(|| str_of(key, "env"))
                .unwrap_or("an environment variable")
        ),
        "app" => {
            if bool_of(key, "is_set") {
                "Set in the app".into()
            } else {
                "Cleared in the app".into()
            }
        }
        "file" => "From financer.toml".into(),
        _ => match truthy_str(key, "default") {
            Some(d) => format!("Default: {d}"),
            None => "Not set".into(),
        },
    }
}

pub fn source_tone(key: &Value) -> &'static str {
    if bool_of(key, "locked") {
        return "locked";
    }
    match str_of(key, "source") {
        Some("app") => "app",
        Some("file") => "file",
        _ => "default",
    }
}

/// A few words for the value of a key, when it is shown without its editor.
pub fn value_summary(key: &Value) -> String {
    let kind = str_of(key, "kind").unwrap_or("");
    if !bool_of(key, "is_set") {
        return match truthy_str(key, "default") {
            Some(d) if kind != "secret" => d.to_string(),
            _ => "Not set".into(),
        };
    }
    let v = key.get("value");
    match kind {
        "secret" => str_of(key, "preview").unwrap_or("Set").to_string(),
        "toggle" => if v == Some(&Value::Bool(true)) {
            "On"
        } else {
            "Off"
        }
        .into(),
        "list" => as_strings(v).join(", "),
        "table" => {
            let n = v.and_then(Value::as_array).map_or(0, Vec::len);
            let noun = entry_noun(str_of(key, "path").unwrap_or(""));
            if n == 1 {
                format!("{n} {noun}")
            } else {
                format!("{n} {noun}s")
            }
        }
        _ => match v {
            None | Some(Value::Null) => String::new(),
            Some(x) => js_string(x),
        },
    }
}

/// "3 of 7 set", and how many of them you changed.
pub fn group_summary(group: &Value, draft: &Value) -> String {
    let keys = items(group, "keys");
    let set = keys.iter().filter(|k| bool_of(k, "is_set")).count();
    let changed = keys
        .iter()
        .filter(|k| is_dirty(str_of(k, "path").unwrap_or(""), draft))
        .count();
    let base = if set == 0 {
        "Nothing set".to_string()
    } else {
        format!("{set} of {} set", keys.len())
    };
    if changed > 0 {
        format!("{base}, {changed} changed")
    } else {
        base
    }
}

/// The one line the save button area says.
pub fn save_summary(draft: &Value) -> String {
    let n = change_count(draft);
    if n == 1 {
        "1 change not saved".into()
    } else {
        format!("{n} changes not saved")
    }
}

pub fn saved_text(saved: &Value) -> String {
    if !bool_of(saved, "restarting") {
        return "Nothing needed changing.".into();
    }
    let n = items(saved, "changed").len();
    format!(
        "{} saved. The server is restarting to use {}.",
        if n == 1 {
            "1 setting".to_string()
        } else {
            format!("{n} settings")
        },
        if n == 1 { "it" } else { "them" }
    )
}

/// What to say when the server did not come back.
pub fn timeout_text(changed_listen_address: bool) -> &'static str {
    if changed_listen_address {
        "The server did not answer at the old address. If you changed where it listens, set the new address under Settings > Backend."
    } else {
        "The server did not come back within a minute. Check that it is running, then open this screen again."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account_key() -> Value {
        json!({
            "path": "bank.accounts", "label": "Accounts", "kind": "table", "options": [], "source": "app",
            "locked": false, "is_set": false,
            "fields": [
                { "key": "name", "label": "Name", "kind": "text", "options": [], "required": true },
                { "key": "provider", "label": "Provider", "kind": "choice", "options": ["fints", "plaid"], "default": "fints", "required": false },
                { "key": "blz", "label": "BLZ", "kind": "text", "options": [], "required": true, "when_field": "provider", "when_value": "fints" },
                { "key": "days", "label": "Days", "kind": "number", "options": [], "required": false, "min": 1, "max": 90 },
            ],
        })
    }

    #[test]
    fn rows_start_on_defaults_and_hide_columns_that_do_not_apply() {
        let key = account_key();
        let row = empty_row(&key);
        assert_eq!(row["provider"], "fints");
        assert!(field_visible(&key, &items(&key, "fields")[2], &row));
        let plaid = json!({ "name": "A", "provider": "plaid", "blz": "123" });
        assert_eq!(
            row_to_wire(&key, &plaid),
            json!({ "name": "A", "provider": "plaid" })
        );
    }

    #[test]
    fn an_edit_that_matches_the_server_is_dropped() {
        let key = json!({ "path": "port", "label": "Port", "kind": "number", "options": [], "source": "file", "locked": false, "is_set": true, "value": 8080, "fields": [] });
        let draft = json!({ "set": {}, "reset": [] });
        let edited = set_value(&draft, &key, &json!("9090"));
        assert_eq!(change_count(&edited), 1);
        let back = set_value(&edited, &key, &json!("8080"));
        assert_eq!(change_count(&back), 0);
    }

    #[test]
    fn numbers_and_tables_are_checked_with_words() {
        let key = account_key();
        let rows = json!([{ "name": "", "provider": "fints", "blz": "1", "days": "" }]);
        assert_eq!(
            problem_for(&key, &rows).as_deref(),
            Some("Account 1: Name is needed")
        );
        let rows = json!([{ "name": "Giro", "provider": "fints", "blz": "1", "days": "99" }]);
        assert_eq!(
            problem_for(&key, &rows).as_deref(),
            Some("Account 1: Days: at most 90")
        );
        let rows = json!([{ "name": "Giro", "provider": "fints", "blz": "1", "days": "x" }]);
        assert_eq!(
            problem_for(&key, &rows).as_deref(),
            Some("Account 1: Days: enter a whole number")
        );
    }

    #[test]
    fn wire_values_follow_the_kind() {
        let toggle = json!({ "path": "t", "kind": "toggle", "fields": [] });
        assert_eq!(wire_value(&toggle, &json!(true)), json!(true));
        assert_eq!(wire_value(&toggle, &Value::Null), Value::Null);
        let list = json!({ "path": "l", "kind": "list", "fields": [] });
        assert_eq!(wire_value(&list, &json!([" a ", ""])), json!(["a"]));
        assert_eq!(wire_value(&list, &json!([])), Value::Null);
        let num = json!({ "path": "n", "kind": "number", "fields": [] });
        assert_eq!(wire_value(&num, &json!(" 42 ")), json!(42));
    }

    #[test]
    fn words() {
        assert_eq!(
            save_summary(&json!({ "set": {}, "reset": [] })),
            "0 changes not saved"
        );
        assert_eq!(
            saved_text(&json!({ "changed": ["a", "b"], "restarting": true })),
            "2 settings saved. The server is restarting to use them."
        );
        assert_eq!(
            saved_text(&json!({ "changed": [], "restarting": false })),
            "Nothing needed changing."
        );
    }
}
