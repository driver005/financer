//! How important each criterion is. A person picks a level per criterion; the level is stored as a
//! weight relative to the category's own default, so the defaults stay meaningful. Criteria, profiles
//! and schemas are the API's own JSON.

use serde_json::{json, Map, Value};

use crate::js::{list, num, round, text};

pub const LEVELS: [&str; 5] = ["off", "low", "normal", "high", "essential"];

fn factor(level: &str) -> f64 {
    match level {
        "off" => 0.0,
        "low" => 0.4,
        "high" => 2.5,
        "essential" => 6.0,
        _ => 1.0,
    }
}

pub fn level_label(level: &str) -> &'static str {
    match level {
        "off" => "Ignore",
        "low" => "Minor",
        "normal" => "Normal",
        "high" => "Important",
        "essential" => "Essential",
        _ => "",
    }
}

pub fn default_weight(c: &Value) -> f64 {
    num(c, "weight").unwrap_or(1.0)
}

fn base(c: &Value) -> f64 {
    if default_weight(c) > 0.0 {
        default_weight(c)
    } else {
        1.0
    }
}

fn round2(n: f64) -> f64 {
    round(n * 100.0) as f64 / 100.0
}

/// The weight a level means for this criterion. A criterion whose default is 0 starts from 1.
pub fn weight_for(c: &Value, level: &str) -> f64 {
    if level == "off" {
        0.0
    } else {
        round2(base(c) * factor(level))
    }
}

/// The level closest to a weight.
pub fn level_of(c: &Value, weight: f64) -> &'static str {
    if weight <= 0.0 {
        return "off";
    }
    let ratio = weight / base(c);
    let mut best = "normal";
    let mut best_distance = f64::INFINITY;
    for level in LEVELS.iter().filter(|l| **l != "off") {
        let distance = (ratio / factor(level)).ln().abs();
        if distance < best_distance {
            best = level;
            best_distance = distance;
        }
    }
    best
}

fn weights_of(profile: &Value) -> Map<String, Value> {
    profile
        .get("weights")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

pub fn current_level(c: &Value, profile: &Value) -> &'static str {
    let key = text(c, "key").unwrap_or("");
    match profile
        .get("weights")
        .and_then(|w| w.get(key))
        .and_then(Value::as_f64)
    {
        Some(w) => level_of(c, w),
        None if default_weight(c) > 0.0 => "normal",
        None => "off",
    }
}

fn with_weights(profile: &Value, weights: Map<String, Value>) -> Value {
    let mut out = profile.as_object().cloned().unwrap_or_default();
    out.insert("weights".into(), Value::Object(weights));
    Value::Object(out)
}

/// Set one criterion's level. Setting it back to its default removes the override.
pub fn set_level(profile: &Value, c: &Value, level: &str) -> Value {
    let mut weights = weights_of(profile);
    let key = text(c, "key").unwrap_or("").to_string();
    let default_level = if default_weight(c) > 0.0 {
        "normal"
    } else {
        "off"
    };
    if level == default_level {
        weights.remove(&key);
    } else {
        weights.insert(key, json!(weight_for(c, level)));
    }
    with_weights(profile, weights)
}

pub fn reset_weights(profile: &Value) -> Value {
    with_weights(profile, Map::new())
}

/// Criteria the person can rate: the category's and the profile's own extras, each key once.
pub fn ratable(schema: &Value, profile: &Value) -> Vec<Value> {
    let mut seen: Vec<String> = vec![];
    let mut out = vec![];
    for c in list(schema, "criteria")
        .iter()
        .chain(list(profile, "extra_criteria"))
    {
        let key = text(c, "key").unwrap_or("").to_string();
        if !seen.contains(&key) {
            seen.push(key);
            out.push(c.clone());
        }
    }
    out
}

pub fn group_label(id: &str) -> String {
    match id {
        "cost" => "Price and deals".into(),
        "speed" => "Speed".into(),
        "camera" => "Camera".into(),
        "battery" => "Battery".into(),
        "display" => "Display".into(),
        "memory" => "Memory".into(),
        "longevity" => "Lasting value".into(),
        "fit" => "Fits my other devices".into(),
        "build" => "Build".into(),
        "connectivity" => "Connectivity".into(),
        other => {
            let spaced = other.replace('_', " ");
            let mut c = spaced.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        }
    }
}

/// Criteria by their `group`; ungrouped ones go last under "Other".
pub fn groups(criteria: &[Value]) -> Vec<Value> {
    let mut map: Vec<(String, Vec<Value>)> = vec![];
    for c in criteria {
        let id = text(c, "group").unwrap_or("other").to_string();
        match map.iter_mut().find(|(g, _)| *g == id) {
            Some((_, l)) => l.push(c.clone()),
            None => map.push((id, vec![c.clone()])),
        }
    }
    map.sort_by(|(a, _), (b, _)| match (a.as_str(), b.as_str()) {
        ("other", _) => std::cmp::Ordering::Greater,
        (_, "other") => std::cmp::Ordering::Less,
        _ => std::cmp::Ordering::Equal,
    });
    map.into_iter()
        .map(|(id, list)| json!({ "id": id, "label": if id == "other" { "Other".to_string() } else { group_label(&id) }, "criteria": list }))
        .collect()
}

/// Ready-made profiles from the schema itself: "Camera first" for every group the category
/// defines, plus "Cheapest that is good" and "Best of the best". New groups in a custom category
/// therefore get their presets without any code.
pub fn presets_for(schema: &Value, base_profile: &Value) -> Vec<Value> {
    let criteria = ratable(schema, base_profile);
    let kind_is = |c: &Value, kinds: &[&str]| text(c, "kind").is_some_and(|k| kinds.contains(&k));
    let key_of = |c: &Value| text(c, "key").unwrap_or("").to_string();
    let cost_keys: Vec<String> = criteria
        .iter()
        .filter(|c| kind_is(c, &["price", "deal"]))
        .map(key_of)
        .collect();
    let price_keys: Vec<String> = criteria
        .iter()
        .filter(|c| kind_is(c, &["price"]))
        .map(key_of)
        .collect();
    let mut out = vec![
        json!({ "id": "balanced", "label": "Balanced", "profile": reset_weights(base_profile) }),
    ];

    for g in groups(&criteria) {
        let id = text(&g, "id").unwrap_or("");
        if matches!(id, "cost" | "other" | "fit") {
            continue;
        }
        let mut w = Map::new();
        for c in list(&g, "criteria") {
            w.insert(key_of(c), json!(weight_for(c, "essential")));
        }
        out.push(json!({ "id": format!("group:{id}"), "label": format!("{} first", text(&g, "label").unwrap_or("")), "profile": with_weights(base_profile, w) }));
    }
    if !price_keys.is_empty() {
        let mut w = Map::new();
        for c in criteria.iter().filter(|c| price_keys.contains(&key_of(c))) {
            w.insert(key_of(c), json!(weight_for(c, "essential")));
        }
        out.push(json!({ "id": "cheapest", "label": "Cheapest that is still good", "profile": with_weights(base_profile, w) }));
        let mut best = Map::new();
        for k in cost_keys {
            best.insert(k, json!(0));
        }
        out.push(json!({ "id": "best", "label": "Best, whatever it costs", "profile": with_weights(base_profile, best) }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crit(key: &str, weight: Option<f64>, group: Option<&str>, kind: &str) -> Value {
        let mut c = json!({ "key": key, "kind": kind });
        if let Some(w) = weight {
            c["weight"] = json!(w);
        }
        if let Some(g) = group {
            c["group"] = json!(g);
        }
        c
    }

    #[test]
    fn levels_scale_the_default_and_round_trip() {
        let c = crit("camera", Some(2.0), Some("camera"), "number");
        assert_eq!(weight_for(&c, "normal"), 2.0);
        assert_eq!(weight_for(&c, "essential"), 12.0);
        assert_eq!(weight_for(&c, "off"), 0.0);
        for level in ["low", "normal", "high", "essential"] {
            assert_eq!(level_of(&c, weight_for(&c, level)), level);
        }
        let zero = crit("x", Some(0.0), None, "number");
        assert_eq!(weight_for(&zero, "normal"), 1.0);
        assert_eq!(current_level(&zero, &json!({})), "off");
    }

    #[test]
    fn setting_the_default_level_removes_the_override() {
        let c = crit("camera", None, None, "number");
        let p = set_level(&json!({ "weights": {} }), &c, "high");
        assert_eq!(p["weights"]["camera"], 2.5);
        assert_eq!(current_level(&c, &p), "high");
        let back = set_level(&p, &c, "normal");
        assert_eq!(back["weights"], json!({}));
    }

    #[test]
    fn groups_put_other_last_and_presets_follow_the_schema() {
        let schema = json!({ "criteria": [
            crit("price", None, Some("cost"), "price"),
            crit("shots", None, Some("camera"), "number"),
            crit("misc", None, None, "number"),
        ]});
        let g = groups(&ratable(&schema, &json!({})));
        let ids: Vec<_> = g.iter().map(|x| x["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["cost", "camera", "other"]);
        let presets = presets_for(&schema, &json!({}));
        let ids: Vec<_> = presets.iter().map(|x| x["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["balanced", "group:camera", "cheapest", "best"]);
        assert_eq!(presets[1]["label"], "Camera first");
        assert_eq!(group_label("lasting_value"), "Lasting value");
    }
}
