//! `${NAME}` and `${NAME:-default}` references to the environment inside string values.
//!
//! `$$` writes a literal `$` (so `$${X}` stays `${X}`). A blank variable counts as unset, like in
//! a shell with `:-`. Without a default, an unset variable is an error.

use crate::Env;

/// Why a string could not be expanded.
#[derive(Debug, PartialEq, Eq)]
pub struct MissingVar {
    pub name: String,
}

pub struct Interpolator;

impl Interpolator {
    /// Whether `input` contains a `${...}` reference (a literal value does not).
    pub fn has_reference(input: &str) -> bool {
        let mut chars = input.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '$' {
                match chars.peek() {
                    Some('$') => {
                        chars.next();
                    }
                    Some('{') => return true,
                    _ => {}
                }
            }
        }
        false
    }

    pub fn expand(input: &str, env: &dyn Env) -> Result<String, MissingVar> {
        let mut out = String::with_capacity(input.len());
        let mut rest = input;
        while let Some(pos) = rest.find('$') {
            out.push_str(&rest[..pos]);
            let after = &rest[pos + 1..];
            if let Some(tail) = after.strip_prefix('$') {
                out.push('$');
                rest = tail;
            } else if let Some(tail) = after.strip_prefix('{') {
                let Some(end) = tail.find('}') else {
                    // no closing brace: keep it as written
                    out.push_str("${");
                    rest = tail;
                    continue;
                };
                let body = &tail[..end];
                let (name, default) = match body.split_once(":-") {
                    Some((n, d)) => (n, Some(d)),
                    None => (body, None),
                };
                if !Self::is_name(name) {
                    out.push_str("${");
                    rest = tail;
                    continue;
                }
                match (env.nonempty(name), default) {
                    (Some(v), _) => out.push_str(&v),
                    (None, Some(d)) => out.push_str(d),
                    (None, None) => {
                        return Err(MissingVar {
                            name: name.to_string(),
                        })
                    }
                }
                rest = &tail[end + 1..];
            } else {
                out.push('$');
                rest = after;
            }
        }
        out.push_str(rest);
        Ok(out)
    }

    fn is_name(s: &str) -> bool {
        let mut chars = s.chars();
        chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    }

    /// Expand every string inside a TOML value (tables and arrays included). `path` is the
    /// dotted location, used in errors.
    pub fn expand_value(
        value: &mut toml::Value,
        env: &dyn Env,
        path: &str,
    ) -> Result<(), (String, MissingVar)> {
        match value {
            toml::Value::String(s) => {
                *s = Self::expand(s, env).map_err(|e| (path.to_string(), e))?;
            }
            toml::Value::Array(items) => {
                for (i, item) in items.iter_mut().enumerate() {
                    Self::expand_value(item, env, &format!("{path}[{i}]"))?;
                }
            }
            toml::Value::Table(table) => {
                for (key, item) in table.iter_mut() {
                    let child = if path.is_empty() {
                        key.clone()
                    } else {
                        format!("{path}.{key}")
                    };
                    Self::expand_value(item, env, &child)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}
