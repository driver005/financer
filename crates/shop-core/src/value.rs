//! Attribute values. Products carry an open map of these, so any new spec can be stored without
//! a code change.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

/// One attribute value: a number, a flag, a text or a list of texts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AttrValue {
    Bool(bool),
    Num(f64),
    Text(String),
    List(Vec<String>),
}

pub type Attributes = BTreeMap<String, AttrValue>;

impl AttrValue {
    /// The value as a number: numbers as they are, flags as 0/1, texts by their leading number.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            AttrValue::Num(n) if n.is_finite() => Some(*n),
            AttrValue::Bool(b) => Some(f64::from(u8::from(*b))),
            AttrValue::Text(t) => leading_number(t),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            AttrValue::Bool(b) => Some(*b),
            AttrValue::Num(n) => Some(*n != 0.0),
            AttrValue::Text(t) => match t.trim().to_lowercase().as_str() {
                "yes" | "ja" | "true" | "1" | "y" => Some(true),
                "no" | "nein" | "false" | "0" | "n" => Some(false),
                _ => None,
            },
            AttrValue::List(_) => None,
        }
    }

    /// Lower-cased words of a text or list value; used for matching and search.
    pub fn tokens(&self) -> Vec<String> {
        match self {
            AttrValue::Text(t) => vec![t.trim().to_lowercase()],
            AttrValue::List(l) => l.iter().map(|s| s.trim().to_lowercase()).collect(),
            AttrValue::Bool(b) => vec![b.to_string()],
            AttrValue::Num(n) => vec![fmt_num(*n)],
        }
    }
}

impl fmt::Display for AttrValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AttrValue::Bool(true) => f.write_str("yes"),
            AttrValue::Bool(false) => f.write_str("no"),
            AttrValue::Num(n) => f.write_str(&fmt_num(*n)),
            AttrValue::Text(t) => f.write_str(t),
            AttrValue::List(l) => f.write_str(&l.join(", ")),
        }
    }
}

impl From<f64> for AttrValue {
    fn from(n: f64) -> Self {
        AttrValue::Num(n)
    }
}
impl From<bool> for AttrValue {
    fn from(b: bool) -> Self {
        AttrValue::Bool(b)
    }
}
impl From<&str> for AttrValue {
    fn from(s: &str) -> Self {
        AttrValue::Text(s.to_string())
    }
}

/// `12` instead of `12.0`, `6.1` instead of `6.1000000001`.
pub fn fmt_num(n: f64) -> String {
    if (n - n.round()).abs() < 1e-9 {
        format!("{}", n.round() as i64)
    } else {
        let s = format!("{n:.3}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

/// The first number in a text, with German (`6,1`) or English (`6.1`) decimals and a thousands
/// separator (`1.299,00`, `1,299.00`): `"6,1 Zoll"` is 6.1, `"5.000 mAh"` is 5000.
pub fn leading_number(text: &str) -> Option<f64> {
    let chars: Vec<char> = text.trim().chars().collect();
    let start = chars.iter().position(|c| c.is_ascii_digit())?;
    let negative = start > 0 && chars[start - 1] == '-';
    let mut end = start;
    while end < chars.len() && (chars[end].is_ascii_digit() || matches!(chars[end], '.' | ',')) {
        end += 1;
    }
    // a trailing separator belongs to the sentence ("8 GB, 128 GB")
    while end > start && matches!(chars[end - 1], '.' | ',') {
        end -= 1;
    }
    let raw: String = chars[start..end].iter().collect();
    let last_dot = raw.rfind('.');
    let last_comma = raw.rfind(',');
    let normalized = match (last_dot, last_comma) {
        (Some(d), Some(c)) => {
            // the later separator is the decimal one
            if d > c {
                raw.replace(',', "")
            } else {
                raw.replace('.', "").replace(',', ".")
            }
        }
        (None, Some(c)) => {
            let after = raw.len() - c - 1;
            if raw.matches(',').count() > 1 || after == 3 {
                raw.replace(',', "")
            } else {
                raw.replace(',', ".")
            }
        }
        (Some(d), None) => {
            let after = raw.len() - d - 1;
            if raw.matches('.').count() > 1 || (after == 3 && raw.len() > 4) {
                raw.replace('.', "")
            } else {
                raw
            }
        }
        (None, None) => raw,
    };
    let n: f64 = normalized.parse().ok()?;
    Some(if negative { -n } else { n })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_numbers_the_way_shops_write_them() {
        assert_eq!(leading_number("6,1 Zoll"), Some(6.1));
        assert_eq!(leading_number("6.7\""), Some(6.7));
        assert_eq!(leading_number("5.000 mAh"), Some(5000.0));
        assert_eq!(leading_number("5000 mAh"), Some(5000.0));
        assert_eq!(leading_number("1.299,00 EUR"), Some(1299.0));
        assert_eq!(leading_number("1,299.00"), Some(1299.0));
        assert_eq!(leading_number("12,5"), Some(12.5));
        assert_eq!(leading_number("8 GB, 128 GB"), Some(8.0));
        assert_eq!(leading_number("kein Wert"), None);
        assert_eq!(leading_number("IP68"), Some(68.0));
    }

    #[test]
    fn values_convert_and_display() {
        assert_eq!(AttrValue::Bool(true).as_f64(), Some(1.0));
        assert_eq!(AttrValue::from("Ja").as_bool(), Some(true));
        assert_eq!(AttrValue::from(120.0).to_string(), "120");
        assert_eq!(AttrValue::from(6.10).to_string(), "6.1");
        assert_eq!(
            AttrValue::List(vec!["a".into(), "b".into()]).to_string(),
            "a, b"
        );
    }

    #[test]
    fn json_shapes_round_trip() {
        let v: Attributes = serde_json::from_str(
            r#"{"ram_gb": 8, "nfc": true, "os": "Android", "bands": ["n78", "n1"]}"#,
        )
        .unwrap();
        assert_eq!(v["ram_gb"], AttrValue::Num(8.0));
        assert_eq!(v["nfc"], AttrValue::Bool(true));
        assert_eq!(v["os"], AttrValue::Text("Android".into()));
        assert!(matches!(v["bands"], AttrValue::List(_)));
    }
}
