//! The design tokens of packages/ui, read from the constants files so there is one source of truth.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Tokens the mapper needs: Tailwind's spacing scale, the named spacing steps, the radii.
#[derive(Debug, Default)]
pub struct Tokens {
    /// Tailwind spacing key ("0.5", "px", "4") -> density-independent pixels.
    pub spacing: BTreeMap<String, f64>,
    /// Pixels -> name of the `space` step ("md").
    pub space_by_px: BTreeMap<i64, String>,
    /// Radius name -> pixels.
    pub radius: BTreeMap<String, f64>,
}

/// Source text with `//` and `/* */` comments removed.
fn strip_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let b: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < b.len() {
        if b[i] == '/' && b.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < b.len() && !(b[i] == '*' && b[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else if b[i] == '/' && b.get(i + 1) == Some(&'/') {
            while i < b.len() && b[i] != '\n' {
                i += 1;
            }
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    out
}

/// The `key: value` entries of `export const <name> = { ... }`, keys unquoted.
fn block(src: &str, name: &str) -> Vec<(String, String)> {
    let clean = strip_comments(src);
    let marker = format!("export const {name} = {{");
    let Some(start) = clean.find(&marker) else { return Vec::new() };
    let body = &clean[start + marker.len()..];
    let end = body.find('}').unwrap_or(body.len());
    body[..end]
        .split(',')
        .filter_map(|entry| {
            let (k, v) = entry.split_once(':')?;
            Some((k.trim().trim_matches('"').to_string(), v.trim().to_string()))
        })
        .collect()
}

impl Tokens {
    pub fn parse(spacing_ts: &str, radius_ts: &str) -> Tokens {
        let mut t = Tokens::default();
        for (k, v) in block(spacing_ts, "spacing") {
            if let Ok(px) = v.parse::<f64>() {
                t.spacing.insert(k, px);
            }
        }
        for (name, v) in block(spacing_ts, "space") {
            // `md: spacing[3]`
            if let Some(key) = v.strip_prefix("spacing[").and_then(|s| s.strip_suffix(']')) {
                if let Some(px) = t.spacing.get(key) {
                    t.space_by_px.insert(*px as i64, name);
                }
            }
        }
        for (k, v) in block(radius_ts, "radius") {
            if let Ok(px) = v.parse::<f64>() {
                t.radius.insert(k, px);
            }
        }
        t
    }

    pub fn load(constants: &Path) -> Result<Tokens, String> {
        let read = |f: &str| fs::read_to_string(constants.join(f)).map_err(|e| format!("{f}: {e}"));
        Ok(Tokens::parse(&read("spacing.ts")?, &read("radius.ts")?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_spacing_space_and_radius() {
        let spacing = "/** scale */\nexport const spacing = { 0: 0, px: 1, 0.5: 2, 3: 12 } as const;\nexport const space = {\n  none: spacing[0],\n  \"2xs\": spacing[0.5], // two\n  md: spacing[3],\n} as const;";
        let radius = "export const radius = {\n  none: 0,\n  base: 4,\n  full: 9999,\n} as const;";
        let t = Tokens::parse(spacing, radius);
        assert_eq!(t.spacing["0.5"], 2.0);
        assert_eq!(t.spacing["px"], 1.0);
        assert_eq!(t.space_by_px[&12], "md");
        assert_eq!(t.space_by_px[&2], "2xs");
        assert_eq!(t.radius["full"], 9999.0);
    }
}
