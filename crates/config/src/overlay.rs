//! What was set from the app: dotted key path -> value, merged over the config file (and under
//! the environment variables, which still win).

use std::collections::BTreeMap;

use serde_json::Value;

/// The app's edits. A value replaces whatever the file says for that key; for a list or a table
/// (`bank.accounts`, `stores`) it replaces the whole list.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Overlay {
    values: BTreeMap<String, Value>,
}

impl Overlay {
    pub fn new(values: BTreeMap<String, Value>) -> Self {
        Self { values }
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    pub fn values(&self) -> &BTreeMap<String, Value> {
        &self.values
    }

    pub fn get(&self, path: &str) -> Option<&Value> {
        self.values.get(path)
    }

    pub fn has(&self, path: &str) -> bool {
        self.values.contains_key(path)
    }

    /// Whether any key below `prefix` (`receipts.`) is set.
    pub fn has_below(&self, prefix: &str) -> bool {
        self.values.keys().any(|k| k.starts_with(prefix))
    }

    pub fn set(&mut self, path: &str, value: Value) {
        self.values.insert(path.to_string(), value);
    }

    pub fn remove(&mut self, path: &str) -> bool {
        self.values.remove(path).is_some()
    }

    /// Write every value into the document of the file, creating the tables on the way.
    pub fn apply(&self, doc: &mut toml::Value) -> Result<(), String> {
        for (path, value) in &self.values {
            let converted = toml::Value::try_from(Self::without_nulls(value))
                .map_err(|e| format!("{path}: cannot be written as a setting ({e})"))?;
            Self::put(doc, path, converted)?;
        }
        Ok(())
    }

    /// TOML has no null; a null inside a list or row means "not set".
    fn without_nulls(value: &Value) -> Value {
        match value {
            Value::Object(map) => Value::Object(
                map.iter()
                    .filter(|(_, v)| !v.is_null())
                    .map(|(k, v)| (k.clone(), Self::without_nulls(v)))
                    .collect(),
            ),
            Value::Array(items) => Value::Array(
                items
                    .iter()
                    .filter(|v| !v.is_null())
                    .map(Self::without_nulls)
                    .collect(),
            ),
            other => other.clone(),
        }
    }

    fn put(doc: &mut toml::Value, path: &str, value: toml::Value) -> Result<(), String> {
        let mut parts: Vec<&str> = path.split('.').collect();
        let last = parts.pop().ok_or_else(|| "empty key".to_string())?;
        let mut cur = doc;
        for part in parts {
            let table = cur
                .as_table_mut()
                .ok_or_else(|| format!("{path}: the file has a value where a section belongs"))?;
            cur = table
                .entry(part)
                .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
        }
        cur.as_table_mut()
            .ok_or_else(|| format!("{path}: the file has a value where a section belongs"))?
            .insert(last.to_string(), value);
        Ok(())
    }
}
