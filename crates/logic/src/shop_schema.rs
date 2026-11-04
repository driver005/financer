//! Editing a category definition. The server validates for real; these helpers build well-formed
//! pieces so the editor cannot send nonsense, and give the form quick feedback.

use regex::Regex;
use serde_json::{json, Map, Value};
use unicode_normalization::UnicodeNormalization;

use crate::js::{list, text};

/// `Battery life (h)` -> `battery_life_h`.
pub fn slug_key(label: &str) -> String {
    let folded: String = label
        .to_lowercase()
        .nfkd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .collect::<String>()
        .replace('ß', "ss");
    let mut out = String::new();
    let mut pending = false;
    for c in folded.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if pending && !out.is_empty() {
                out.push('_');
            }
            pending = false;
            out.push(c);
        } else {
            pending = true;
        }
    }
    out.chars().take(40).collect()
}

pub fn unique_key(base: &str, taken: &[String]) -> String {
    let slug = slug_key(base);
    let root = if slug.is_empty() {
        "item".to_string()
    } else {
        slug
    };
    if !taken.contains(&root) {
        return root;
    }
    let mut i = 2;
    loop {
        let candidate = format!("{root}_{i}");
        if !taken.contains(&candidate) {
            return candidate;
        }
        i += 1;
    }
}

pub fn new_category(name: &str, extends_id: Option<&str>) -> Value {
    let slug = slug_key(name);
    let id = if slug.is_empty() {
        "category".to_string()
    } else if slug.starts_with(|c: char| c.is_ascii_digit()) {
        format!("c_{slug}")
    } else {
        slug
    };
    json!({
        "id": id,
        "name": name.trim(),
        "kind": "product",
        "extends": extends_id,
        "keywords": [name.trim().to_lowercase()],
        "attributes": [],
        "criteria": [],
    })
}

fn keys_of(schema: &Value, field: &str) -> Vec<String> {
    list(schema, field)
        .iter()
        .filter_map(|x| text(x, "key").map(str::to_string))
        .collect()
}

fn with_field(schema: &Value, field: &str, value: Value) -> Value {
    let mut out = schema.as_object().cloned().unwrap_or_default();
    out.insert(field.into(), value);
    Value::Object(out)
}

pub fn add_attribute(schema: &Value, label: &str, kind: &str, unit: Option<&str>) -> Value {
    let key = unique_key(label, &keys_of(schema, "attributes"));
    let mut def = Map::new();
    def.insert("key".into(), json!(key));
    def.insert("label".into(), json!(label.trim()));
    def.insert("kind".into(), json!(kind));
    if let Some(u) = unit.map(str::trim).filter(|u| !u.is_empty()) {
        def.insert("unit".into(), json!(u));
    }
    def.insert("aliases".into(), json!([]));
    let mut attrs = list(schema, "attributes").to_vec();
    attrs.push(Value::Object(def));
    json!({ "schema": with_field(schema, "attributes", Value::Array(attrs)), "key": key })
}

fn map_attributes(schema: &Value, f: impl Fn(&Value) -> Value) -> Value {
    with_field(
        schema,
        "attributes",
        Value::Array(list(schema, "attributes").iter().map(f).collect()),
    )
}

fn aliases(d: &Value) -> Vec<Value> {
    list(d, "aliases").to_vec()
}

/// Another name pages use for the attribute: the crawler then files that spec under it.
pub fn add_alias(schema: &Value, key: &str, alias: &str) -> Value {
    let a = alias.trim();
    if a.is_empty() {
        return schema.clone();
    }
    map_attributes(schema, |d| {
        let has = aliases(d).iter().any(|x| {
            x.as_str()
                .is_some_and(|x| x.to_lowercase() == a.to_lowercase())
        });
        if text(d, "key") == Some(key) && !has {
            let mut list = aliases(d);
            list.push(json!(a));
            with_field(d, "aliases", Value::Array(list))
        } else {
            d.clone()
        }
    })
}

/// Take a name back off an attribute.
pub fn remove_alias(schema: &Value, key: &str, alias: &str) -> Value {
    map_attributes(schema, |d| {
        if text(d, "key") == Some(key) {
            let kept: Vec<Value> = aliases(d)
                .into_iter()
                .filter(|x| {
                    x.as_str()
                        .is_none_or(|x| x.to_lowercase() != alias.to_lowercase())
                })
                .collect();
            with_field(d, "aliases", Value::Array(kept))
        } else {
            d.clone()
        }
    })
}

/// A criterion from a template: `{ kind: "number" | "flag" | "formula" | "match", ... }`.
pub fn add_criterion(schema: &Value, label: &str, t: &Value, weight: f64) -> Result<Value, String> {
    let key = unique_key(label, &keys_of(schema, "criteria"));
    let label = label.trim();
    let get = |k: &str| t.get(k).cloned().unwrap_or(Value::Null);
    let def = match text(t, "kind").unwrap_or("") {
        "number" => {
            json!({ "key": key, "label": label, "kind": "number", "attribute": get("attribute"), "weight": weight,
            "higher_is_better": get("higherIsBetter"), "scale": { "type": "fixed", "min": get("min"), "max": get("max") } })
        }
        "formula" => {
            json!({ "key": key, "label": label, "kind": "formula", "expr": text(t, "expr").unwrap_or("").trim(), "weight": weight,
            "higher_is_better": get("higherIsBetter"), "scale": { "type": "fixed", "min": get("min"), "max": get("max") } })
        }
        "flag" => {
            json!({ "key": key, "label": label, "kind": "flag", "attribute": get("attribute"), "weight": weight })
        }
        "match" => {
            json!({ "key": key, "label": label, "kind": "match", "attribute": get("attribute"), "preference": get("preference"), "weight": weight })
        }
        other => return Err(format!("unknown criterion kind {other}")),
    };
    let mut criteria = list(schema, "criteria").to_vec();
    criteria.push(def);
    Ok(json!({ "schema": with_field(schema, "criteria", Value::Array(criteria)), "key": key }))
}

pub fn remove_criterion(schema: &Value, key: &str) -> Value {
    let kept: Vec<Value> = list(schema, "criteria")
        .iter()
        .filter(|c| text(c, "key") != Some(key))
        .cloned()
        .collect();
    let mut remove = list(schema, "remove").to_vec();
    remove.push(json!(key));
    with_field(
        &with_field(schema, "criteria", Value::Array(kept)),
        "remove",
        Value::Array(remove),
    )
}

pub fn set_criterion_weight(schema: &Value, key: &str, weight: f64) -> Value {
    let criteria: Vec<Value> = list(schema, "criteria")
        .iter()
        .map(|c| {
            if text(c, "key") == Some(key) {
                with_field(c, "weight", json!(weight))
            } else {
                c.clone()
            }
        })
        .collect();
    with_field(schema, "criteria", Value::Array(criteria))
}

/// A quick local check of a formula, for the form. It catches the usual typing mistakes
/// (unbalanced brackets, a trailing operator, characters the language does not have); the server
/// checks names and functions.
pub fn formula_problem(expr: &str) -> Option<&'static str> {
    let text = expr.trim();
    if text.is_empty() {
        return Some("Write a formula, e.g. battery_mah / weight_g");
    }
    let allowed = Regex::new(r"^[A-Za-z0-9_.+\-*/^(),\s]+$").unwrap();
    if !allowed.is_match(text) {
        return Some("Only numbers, names, + - * / ^ and brackets are allowed");
    }
    let mut depth = 0;
    for ch in text.chars() {
        if ch == '(' {
            depth += 1;
        }
        if ch == ')' {
            depth -= 1;
        }
        if depth < 0 {
            return Some("A closing bracket has no opening one");
        }
    }
    if depth != 0 {
        return Some("A bracket is not closed");
    }
    if Regex::new(r"[+\-*/^,]\s*$").unwrap().is_match(text) {
        return Some("The formula ends with an operator");
    }
    if Regex::new(r"^\s*[*/^,]").unwrap().is_match(text) {
        return Some("The formula starts with an operator");
    }
    if Regex::new(r"[*/^+]\s*[*/^]").unwrap().is_match(text) {
        return Some("Two operators in a row");
    }
    None
}

/// Names usable in a formula: the category's attributes and the offer values.
pub fn formula_names(schema: &Value) -> Vec<String> {
    let mut names: Vec<String> = list(schema, "attributes")
        .iter()
        .filter(|a| text(a, "kind").unwrap_or("number") == "number")
        .filter_map(|a| text(a, "key").map(str::to_string))
        .collect();
    names.extend(["price", "monthly", "upfront", "term_months"].map(String::from));
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_become_keys() {
        assert_eq!(slug_key("Battery life (h)"), "battery_life_h");
        assert_eq!(slug_key("Größe é"), "grosse_e");
        assert_eq!(slug_key("  --  "), "");
        assert_eq!(unique_key("RAM", &["ram".into(), "ram_2".into()]), "ram_3");
        assert_eq!(unique_key("!!!", &[]), "item");
        assert_eq!(new_category("5G Plans", None)["id"], "c_5g_plans");
    }

    #[test]
    fn aliases_and_criteria_are_added_without_duplicates() {
        let s = add_attribute(&json!({}), "Battery (mAh)", "number", Some(" mAh "));
        let key = s["key"].as_str().unwrap().to_string();
        assert_eq!(key, "battery_mah");
        let schema = add_alias(&s["schema"], &key, "Akku");
        let schema = add_alias(&schema, &key, "akku");
        assert_eq!(schema["attributes"][0]["aliases"], json!(["Akku"]));
        let schema = remove_alias(&schema, &key, "AKKU");
        assert_eq!(schema["attributes"][0]["aliases"], json!([]));
        let t = json!({ "kind": "number", "attribute": key, "min": 1000, "max": 6000, "higherIsBetter": true });
        let c = add_criterion(&schema, "Battery", &t, 1.0).unwrap();
        assert_eq!(
            c["schema"]["criteria"][0]["scale"],
            json!({ "type": "fixed", "min": 1000, "max": 6000 })
        );
        let removed = remove_criterion(&c["schema"], "battery");
        assert_eq!(removed["remove"], json!(["battery"]));
        assert_eq!(removed["criteria"], json!([]));
    }

    #[test]
    fn formulas_are_checked_locally() {
        assert_eq!(
            formula_problem(""),
            Some("Write a formula, e.g. battery_mah / weight_g")
        );
        assert_eq!(formula_problem("a / (b"), Some("A bracket is not closed"));
        assert_eq!(
            formula_problem("a) + (b"),
            Some("A closing bracket has no opening one")
        );
        assert_eq!(
            formula_problem("a +"),
            Some("The formula ends with an operator")
        );
        assert_eq!(
            formula_problem("* a"),
            Some("The formula starts with an operator")
        );
        assert_eq!(formula_problem("a * * b"), Some("Two operators in a row"));
        assert_eq!(
            formula_problem("a $ b"),
            Some("Only numbers, names, + - * / ^ and brackets are allowed")
        );
        assert_eq!(formula_problem("battery_mah / weight_g"), None);
    }
}
