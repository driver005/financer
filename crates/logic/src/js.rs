//! JavaScript's own rules for a few things the screens' answers depended on, so the Rust versions
//! give the same text and numbers.

use serde_json::Value;

/// `Math.round`: halves go up (also below zero).
pub(crate) fn round(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

/// `String(v)` for a JSON value.
pub(crate) fn string(v: &Value) -> String {
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
        Value::Array(a) => a.iter().map(string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `v.key` as text, when it is text.
pub(crate) fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// `v.key` as a number, when it is one.
pub(crate) fn num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

/// `v.key` is neither missing nor null.
pub(crate) fn has(v: &Value, key: &str) -> bool {
    v.get(key).is_some_and(|x| !x.is_null())
}

/// `v.key` as a list (empty when it is not one).
pub(crate) fn list<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// JavaScript truthiness of an optional value.
pub(crate) fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}
