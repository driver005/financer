//! The smaller rules of the shopping assistant: the "add a product" form, saved priorities, the
//! history of reading runs, the decisions around a search, the check of shop sources, and the deal
//! messages that become local notifications.

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::js::{list, num, round, string, text, truthy};
use crate::shop_format::format_cents;

// ---- the "add a product" form ----

/// `649`, `649,90`, `1.299,00 €` or `12.5` as cents; `None` when it is not a price.
pub fn parse_cents(input: &str) -> Option<i64> {
    let stripped = Regex::new(r"(?i)€|euro?")
        .unwrap()
        .replace_all(input.trim(), "")
        .to_string();
    let mut t: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();
    if t.is_empty() {
        return None;
    }
    if t.contains(',') {
        t = t.replace('.', "").replace(',', ".");
    } else if Regex::new(r"^[0-9]{1,3}(\.[0-9]{3})+$")
        .unwrap()
        .is_match(&t)
    {
        t = t.replace('.', "");
    }
    if !Regex::new(r"^[0-9]+(\.[0-9]{1,2})?$").unwrap().is_match(&t) {
        return None;
    }
    t.parse::<f64>().ok().map(|n| round(n * 100.0))
}

/// `1.234` -> `1234` where three digits follow the dot and no further digit does (JavaScript's
/// `/(\d)\.(\d{3})(?!\d)/g`, which the regex crate cannot express).
fn drop_thousand_dots(t: &str) -> String {
    let c: Vec<char> = t.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        let is_group = c[i].is_ascii_digit()
            && c.get(i + 1) == Some(&'.')
            && (2..=4).all(|k| c.get(i + k).is_some_and(|x| x.is_ascii_digit()))
            && !c.get(i + 5).is_some_and(|x| x.is_ascii_digit());
        if is_group {
            out.push(c[i]);
            out.extend(&c[i + 2..i + 5]);
            i += 5;
        } else {
            out.push(c[i]);
            i += 1;
        }
    }
    out
}

fn number_value(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// A typed value as the attribute's kind wants it: `{kind: "empty"}` for "left empty",
/// `{kind: "invalid"}` when it cannot be read, `{kind: "value", value}` otherwise.
pub fn parse_attribute(def: &Value, input: &str) -> Value {
    let t = input.trim();
    if t.is_empty() {
        return json!({ "kind": "empty" });
    }
    let value = match text(def, "kind").unwrap_or("text") {
        "number" => {
            // "5000 mAh", "5,5 in" and "1.299" all mean a number; the unit is the category's, so it is dropped
            let re = Regex::new(r"^(-?[0-9]+(?:[.,][0-9]+)?)(?:\s*[^0-9\s]\S*)?$").unwrap();
            match re
                .captures(&drop_thousand_dots(t))
                .and_then(|m| m[1].replace(',', ".").parse::<f64>().ok())
            {
                Some(n) => number_value(n),
                None => return json!({ "kind": "invalid" }),
            }
        }
        "bool" => match t.to_lowercase().as_str() {
            "yes" | "ja" | "true" | "y" | "1" | "an" | "on" => json!(true),
            "no" | "nein" | "false" | "n" | "0" | "aus" | "off" => json!(false),
            _ => return json!({ "kind": "invalid" }),
        },
        "list" => json!(t
            .split([',', ';'])
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()),
        _ => json!(t),
    };
    json!({ "kind": "value", "value": value })
}

fn form_text<'a>(form: &'a Value, key: &str) -> &'a str {
    text(form, key).unwrap_or("")
}

/// The request for a form, or what is wrong with it in plain words.
pub fn build_product(form: &Value, defs: &[Value], plan: bool) -> Value {
    let mut problems: Vec<String> = vec![];
    if form_text(form, "category").is_empty() {
        problems.push("Choose a category.".into());
    }
    if form_text(form, "title").trim().is_empty() {
        problems.push("Give it a name.".into());
    }
    let mut attributes = Map::new();
    for def in defs {
        let key = text(def, "key").unwrap_or("");
        let Some(typed) = form.get("attributes").and_then(|a| text(a, key)) else {
            continue;
        };
        let parsed = parse_attribute(def, typed);
        match text(&parsed, "kind") {
            Some("invalid") => {
                let what = match text(def, "kind") {
                    Some("number") => "a number",
                    Some("bool") => "yes or no",
                    _ => "readable",
                };
                problems.push(format!(
                    "{}: \"{}\" is not {what}.",
                    text(def, "label").unwrap_or(""),
                    typed.trim()
                ));
            }
            Some("value") => {
                let v = parsed["value"].clone();
                if !matches!(&v, Value::Array(a) if a.is_empty()) {
                    attributes.insert(key.to_string(), v);
                }
            }
            _ => {}
        }
    }
    let typed_price = form_text(form, if plan { "monthly" } else { "price" });
    let cents = parse_cents(typed_price);
    let (shop, url) = (
        form_text(form, "shop").trim(),
        form_text(form, "url").trim(),
    );
    let mut offers = vec![];
    if !typed_price.trim().is_empty() || !shop.is_empty() || !url.is_empty() {
        if cents.is_none() {
            problems.push(if typed_price.trim().is_empty() {
                "Add the price, or clear the shop and link.".into()
            } else {
                format!("\"{}\" is not a price.", typed_price.trim())
            });
        }
        if shop.is_empty() {
            problems.push("Say which shop the price is from.".into());
        }
        if !url.is_empty() && !Regex::new(r"(?i)^https?://\S+$").unwrap().is_match(url) {
            problems.push("The link must start with http:// or https://.".into());
        }
        if let (Some(c), false) = (cents, shop.is_empty()) {
            offers.push(json!({
                "shop": shop, "url": url, "price_cents": if plan { 0 } else { c }, "in_stock": true, "condition": "new",
                "recurring": if plan { json!({ "monthly_cents": c }) } else { Value::Null },
            }));
        }
    }
    let gtin = form_text(form, "gtin").trim();
    if !gtin.is_empty()
        && form_text(form, "gtin")
            .chars()
            .filter(char::is_ascii_digit)
            .count()
            < 8
    {
        problems.push("A barcode has at least 8 digits.".into());
    }
    if !problems.is_empty() {
        return json!({ "ok": false, "problems": problems });
    }
    let mut request = Map::new();
    request.insert("category".into(), json!(form_text(form, "category")));
    request.insert("title".into(), json!(form_text(form, "title").trim()));
    if !form_text(form, "brand").trim().is_empty() {
        request.insert("brand".into(), json!(form_text(form, "brand").trim()));
    }
    if !gtin.is_empty() {
        request.insert("gtin".into(), json!(gtin));
    }
    request.insert("attributes".into(), Value::Object(attributes));
    request.insert("offers".into(), Value::Array(offers));
    json!({ "ok": true, "request": request })
}

// ---- saved priorities ----

pub const DEFAULT_PROFILE: &str = "default";

fn plural<'a>(n: usize, one: &'a str, many: &'a str) -> &'a str {
    if n == 1 {
        one
    } else {
        many
    }
}

/// What a profile asks for, in a few words: "3 priorities, 2 wishes, under 600 €, new only".
pub fn profile_summary(p: &Value) -> String {
    let weights = p.get("weights").and_then(Value::as_object).map_or(0, |w| {
        w.values()
            .filter(|x| x.as_f64().is_some_and(|x| x > 0.0))
            .count()
    });
    let wishes = p
        .get("preferences")
        .and_then(Value::as_object)
        .map_or(0, |m| {
            m.values()
                .filter(|x| list(x, "prefer").len() + list(x, "avoid").len() > 0)
                .count()
        });
    let mut parts: Vec<String> = vec![];
    if weights > 0 {
        parts.push(format!(
            "{weights} {}",
            plural(weights, "priority", "priorities")
        ));
    }
    if wishes > 0 {
        parts.push(format!("{wishes} {}", plural(wishes, "wish", "wishes")));
    }
    let constraints = list(p, "constraints").len();
    if constraints > 0 {
        parts.push(format!(
            "{constraints} {}",
            plural(constraints, "requirement", "requirements")
        ));
    }
    if let Some(m) = num(p, "max_price_cents").filter(|m| *m != 0.0) {
        parts.push(format!("under {}", format_cents(m)));
    }
    if truthy(p.get("in_stock_only")) {
        parts.push("in stock only".into());
    }
    let conditions = list(p, "conditions");
    if conditions.len() == 1 && conditions[0] == "new" {
        parts.push("new only".into());
    }
    let excluded = list(p, "exclude_brands");
    if !excluded.is_empty() {
        parts.push(format!(
            "without {}",
            excluded.iter().map(string).collect::<Vec<_>>().join(", ")
        ));
    }
    if parts.is_empty() {
        "Nothing set: everything counts the same".into()
    } else {
        parts.join(", ")
    }
}

/// A name for a copy: trimmed, one line, not "default" and not one already in use; a problem in words otherwise.
pub fn profile_name_problem(name: &str, existing: &[String]) -> Option<&'static str> {
    let t = name.trim();
    if t.is_empty() {
        return Some("Give it a name.");
    }
    if t.encode_utf16().count() > 40 {
        return Some("Use at most 40 characters.");
    }
    if t.contains(['\n', '/', '\\', '?', '#']) {
        return Some("Leave out line breaks and the characters / \\ ? #.");
    }
    if t.to_lowercase() == DEFAULT_PROFILE {
        return Some("That name is taken by the one searches use.");
    }
    if existing
        .iter()
        .any(|n| n.to_lowercase() == t.to_lowercase())
    {
        return Some("You already have one with that name.");
    }
    None
}

// ---- the history of reading runs ----

pub fn phase_tone(p: &str) -> &'static str {
    match p {
        "done" => "success",
        "failed" => "danger",
        "cancelled" => "warning",
        "running" => "info",
        _ => "neutral",
    }
}

pub fn is_active(j: &Value) -> bool {
    matches!(
        j.get("progress").and_then(|p| text(p, "phase")),
        Some("running" | "queued")
    )
}

/// Newest first; a run still going comes before the finished ones.
pub fn order_runs(jobs: &[Value]) -> Vec<Value> {
    let mut out = jobs.to_vec();
    out.sort_by(|a, b| {
        is_active(b).cmp(&is_active(a)).then_with(|| {
            num(b, "started_at")
                .unwrap_or(0.0)
                .partial_cmp(&num(a, "started_at").unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    out
}

fn n(v: &Value, key: &str) -> f64 {
    num(v, key).unwrap_or(0.0)
}

fn int(x: f64) -> String {
    string(&Value::from(x))
}

/// What a run found, in words: "22 pages, 4 new products, 7 price changes, 2 pages failed".
pub fn run_summary(j: &Value) -> String {
    let Some(r) = j.get("report").filter(|r| !r.is_null()) else {
        let p = j.get("progress").cloned().unwrap_or(Value::Null);
        return if n(&p, "total") > 0.0 {
            format!(
                "{} of {} pages · {} products",
                int(n(&p, "done")),
                int(n(&p, "total")),
                int(n(&p, "products"))
            )
        } else {
            match text(&p, "message") {
                Some(m) if !m.is_empty() => m.to_string(),
                _ => "Starting".into(),
            }
        };
    };
    let mut parts = vec![format!(
        "{} {}",
        int(n(r, "pages")),
        if n(r, "pages") == 1.0 {
            "page"
        } else {
            "pages"
        }
    )];
    if n(r, "new_products") != 0.0 {
        parts.push(format!(
            "{} new {}",
            int(n(r, "new_products")),
            if n(r, "new_products") == 1.0 {
                "product"
            } else {
                "products"
            }
        ));
    }
    if n(r, "price_changes") != 0.0 {
        parts.push(format!(
            "{} price {}",
            int(n(r, "price_changes")),
            if n(r, "price_changes") == 1.0 {
                "change"
            } else {
                "changes"
            }
        ));
    }
    if n(r, "failed") != 0.0 {
        parts.push(format!(
            "{} {} failed",
            int(n(r, "failed")),
            if n(r, "failed") == 1.0 {
                "page"
            } else {
                "pages"
            }
        ));
    }
    parts.join(", ")
}

/// The shops that had trouble, with the last thing each one said.
pub fn run_problems(j: &Value) -> Vec<Value> {
    let Some(sources) = j
        .get("report")
        .and_then(|r| r.get("sources"))
        .and_then(Value::as_object)
    else {
        return vec![];
    };
    sources
        .iter()
        .filter(|(_, s)| n(s, "failed") > 0.0 || truthy(s.get("last_error")))
        .map(|(shop, s)| {
            let text = match s.get("last_error") {
                Some(e) if !e.is_null() => string(e),
                _ => format!(
                    "{} of {} pages failed",
                    int(n(s, "failed")),
                    int(n(s, "pages"))
                ),
            };
            json!({ "shop": shop, "text": text })
        })
        .collect()
}

// ---- decisions around a search ----

fn suggest(reason: &str) -> Value {
    json!({ "kind": "suggest-index", "reason": reason })
}

pub fn next_step(r: &Value, integrated: bool) -> Value {
    let catalogue = r.get("catalogue").cloned().unwrap_or(Value::Null);
    let stale = truthy(catalogue.get("stale"));
    if r.get("category").is_none_or(Value::is_null) {
        return suggest("no-category");
    }
    if num(&catalogue, "products_in_category") == Some(0.0) {
        return suggest("empty");
    }
    if list(r, "items").is_empty() {
        return if stale || integrated {
            suggest(if stale { "stale" } else { "empty" })
        } else {
            json!({ "kind": "none-found" })
        };
    }
    if stale && integrated {
        return suggest("stale");
    }
    json!({ "kind": "show" })
}

pub fn suggestion_text(reason: &str) -> &'static str {
    match reason {
        "empty" => "Nothing is known about this yet. Build the index to read prices and specs from your shops.",
        "stale" => "The prices on file are more than a week old. Build the index again to refresh them.",
        _ => "Could not tell what kind of product this is. Pick a category, or build the index first.",
    }
}

pub fn index_request_for(req: &Value, r: Option<&Value>) -> Value {
    let category = [req.get("category"), r.and_then(|r| r.get("category"))]
        .into_iter()
        .flatten()
        .find(|c| !c.is_null())
        .filter(|c| truthy(Some(c)))
        .cloned();
    let mut out = Map::new();
    out.insert(
        "query".into(),
        json!(text(req, "query").unwrap_or("").trim()),
    );
    if let Some(c) = category {
        out.insert("category".into(), c);
    }
    Value::Object(out)
}

/// A search that can be shared back into the query box: `ram_gb>=8 price<500`.
pub fn chips_for(r: &Value) -> Vec<String> {
    let parsed = r.get("parsed").cloned().unwrap_or(Value::Null);
    let mut out = vec![];
    if let Some(p) = num(&parsed, "max_price_cents").filter(|p| *p != 0.0) {
        out.push(format!("under {} €", round(p / 100.0)));
    }
    for c in list(&parsed, "constraints") {
        let sym = match text(c, "op").unwrap_or("") {
            "gte" => "≥",
            "lte" => "≤",
            "eq" => "=",
            "ne" => "≠",
            _ => ":",
        };
        let value = c
            .get("value")
            .map(string)
            .unwrap_or_else(|| "undefined".into());
        out.push(format!(
            "{} {sym} {value}",
            text(c, "attribute").unwrap_or("").replace('_', " ")
        ));
    }
    out
}

// ---- shop sources ----

/// Check the JSON a person typed for the shop sources a phone reads.
pub fn check_sources(input: &str) -> Value {
    let t = input.trim();
    if t.is_empty() {
        return json!({ "ok": true, "count": 0 });
    }
    let parsed: Value = match serde_json::from_str(t) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "problems": [format!("Not valid JSON: {e}")] }),
    };
    let Some(sources) = parsed.as_array() else {
        return json!({ "ok": false, "problems": ["The sources must be a list: [ { ... }, { ... } ]"] });
    };
    let mut problems: Vec<String> = vec![];
    for (i, s) in sources.iter().enumerate() {
        let where_ = match text(s, "name") {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => format!("source {}", i + 1),
        };
        if !(s.is_object() || s.is_array()) {
            problems.push(format!("{where_}: not an object"));
            continue;
        }
        if text(s, "name").is_none_or(|n| n.trim().is_empty()) {
            problems.push(format!("{where_}: needs a name"));
        }
        let kind = match s.get("kind") {
            Some(k) if !k.is_null() => k.as_str().unwrap_or("").to_string(),
            _ => "pages".to_string(),
        };
        if !["pages", "search", "feed", "sitemap"].contains(&kind.as_str()) {
            problems.push(format!(
                "{where_}: kind must be pages, search, feed or sitemap"
            ));
        }
        let non_empty_list = |k: &str| {
            s.get(k)
                .and_then(Value::as_array)
                .is_some_and(|a| !a.is_empty())
        };
        match kind.as_str() {
            "pages" if !non_empty_list("urls") => {
                problems.push(format!("{where_}: pages need a list of urls"))
            }
            "search" if !text(s, "search_url").is_some_and(|u| u.contains("{query}")) => {
                problems.push(format!("{where_}: search_url must contain {{query}}"))
            }
            "feed" if !(text(s, "feed_url").is_some() && truthy(s.get("mapping"))) => {
                problems.push(format!("{where_}: a feed needs feed_url and a mapping"))
            }
            "sitemap" if !(text(s, "sitemap_url").is_some() && non_empty_list("follow")) => {
                problems.push(format!(
                    "{where_}: a sitemap needs sitemap_url and follow patterns"
                ))
            }
            _ => {}
        }
    }
    if problems.is_empty() {
        json!({ "ok": true, "count": sources.len() })
    } else {
        json!({ "ok": false, "problems": problems })
    }
}

// ---- deal messages as local notifications ----

/// The local notification for one deal message.
pub fn notice_for(n: &Value) -> Value {
    let e = n.get("event").cloned().unwrap_or(Value::Null);
    let reduced = match (
        num(&e, "reference_cents").filter(|r| *r != 0.0),
        num(&e, "price_cents"),
    ) {
        (Some(r), Some(p)) if r > p => format!(" (was about {})", format_cents(r)),
        _ => String::new(),
    };
    let why = match text(&e, "kind") {
        Some("below_target") => "Below your target price",
        Some("new_low") => "Lowest price we have seen",
        _ => "Good deal",
    };
    let id = n.get("id").cloned().unwrap_or(Value::Null);
    json!({
        "id": format!("financer.shop.deal.{}", string(&id)),
        "title": format!("{why}: {}", text(&e, "title").unwrap_or("")),
        "body": format!("{}{reduced}", text(n, "message").unwrap_or("")),
        "data": { "eventId": id, "productId": e.get("product_id").cloned().unwrap_or(Value::Null), "url": e.get("url").cloned().unwrap_or(Value::Null) },
    })
}

/// Notices for messages not yet shown, and the id to remember. At most `max` notices are shown at
/// once; the rest collapse into one summary so the shade does not fill up after a long absence.
pub fn plan_deal_notices(items: &[Value], last_shown_id: f64, max: usize) -> Value {
    let mut fresh: Vec<&Value> = items
        .iter()
        .filter(|i| n(i, "id") > last_shown_id && !truthy(i.get("read")))
        .collect();
    fresh.sort_by(|a, b| {
        n(a, "id")
            .partial_cmp(&n(b, "id"))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let newest = fresh.last().map_or(last_shown_id, |l| n(l, "id"));
    if fresh.len() <= max {
        return json!({ "notices": fresh.iter().map(|i| notice_for(i)).collect::<Vec<_>>(), "lastShownId": newest });
    }
    let take = max.saturating_sub(1);
    let start = if take == 0 { 0 } else { fresh.len() - take };
    let shown: Vec<Value> = fresh[start..].iter().map(|i| notice_for(i)).collect();
    let rest = fresh.len() - shown.len();
    let summary = json!({
        "id": format!("financer.shop.deal.summary.{}", int(newest)),
        "title": format!("{rest} more deals"),
        "body": "Open the Deals tab to see them.",
        "data": { "eventId": newest, "productId": "", "url": "" },
    });
    let mut notices = vec![summary];
    notices.extend(shown);
    json!({ "notices": notices, "lastShownId": newest })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prices_are_read_the_german_and_the_english_way() {
        for (typed, cents) in [
            ("649", 64900),
            ("649,90", 64990),
            ("1.299,00 €", 129900),
            ("12.5", 1250),
            ("1.299", 129900),
            (" 5 EUR ", 500),
        ] {
            assert_eq!(parse_cents(typed), Some(cents), "{typed}");
        }
        for bad in ["", "abc", "1,2,3", "12.345,6789"] {
            assert_eq!(parse_cents(bad), None, "{bad}");
        }
    }

    #[test]
    fn attributes_are_read_by_kind() {
        let def = |k: &str| json!({ "kind": k });
        assert_eq!(parse_attribute(&def("number"), "5000 mAh")["value"], 5000);
        assert_eq!(parse_attribute(&def("number"), "5,5 in")["value"], 5.5);
        assert_eq!(parse_attribute(&def("number"), "1.299")["value"], 1299);
        assert_eq!(parse_attribute(&def("number"), "abc")["kind"], "invalid");
        assert_eq!(parse_attribute(&def("bool"), "Ja")["value"], true);
        assert_eq!(parse_attribute(&def("bool"), "maybe")["kind"], "invalid");
        assert_eq!(
            parse_attribute(&def("list"), "a, b;; c")["value"],
            json!(["a", "b", "c"])
        );
        assert_eq!(
            parse_attribute(&def("text"), "  "),
            json!({ "kind": "empty" })
        );
    }

    #[test]
    fn a_form_becomes_a_request_or_a_list_of_fixes() {
        let defs = [json!({ "key": "ram", "label": "RAM", "kind": "number" })];
        let bad = build_product(
            &json!({ "category": "", "title": " ", "attributes": { "ram": "lots" }, "price": "x", "shop": "", "gtin": "123" }),
            &defs,
            false,
        );
        assert_eq!(bad["ok"], false);
        assert_eq!(bad["problems"].as_array().unwrap().len(), 6);
        assert_eq!(bad["problems"][2], "RAM: \"lots\" is not a number.");
        let good = build_product(
            &json!({ "category": "phone", "title": " P ", "brand": "B", "attributes": { "ram": "8 GB" }, "shop": "S", "price": "299,90", "url": "https://x.y" }),
            &defs,
            false,
        );
        assert_eq!(good["request"]["title"], "P");
        assert_eq!(good["request"]["attributes"]["ram"], 8);
        assert_eq!(good["request"]["offers"][0]["price_cents"], 29990);
        let plan = build_product(
            &json!({ "category": "plan", "title": "T", "attributes": {}, "shop": "S", "monthly": "9,99" }),
            &[],
            true,
        );
        assert_eq!(
            plan["request"]["offers"][0]["recurring"],
            json!({ "monthly_cents": 999 })
        );
        assert_eq!(plan["request"]["offers"][0]["price_cents"], 0);
    }

    #[test]
    fn profiles_are_summarised_and_names_checked() {
        assert_eq!(
            profile_summary(&json!({})),
            "Nothing set: everything counts the same"
        );
        let p = json!({ "weights": { "a": 1, "b": 0 }, "preferences": { "x": { "prefer": ["y"] } }, "max_price_cents": 60000, "conditions": ["new"], "exclude_brands": ["A", "B"] });
        assert_eq!(
            profile_summary(&p),
            "1 priority, 1 wish, under 600,00 €, new only, without A, B"
        );
        let others = vec!["Work".to_string()];
        assert_eq!(profile_name_problem("  ", &others), Some("Give it a name."));
        assert_eq!(
            profile_name_problem("a/b", &others),
            Some("Leave out line breaks and the characters / \\ ? #.")
        );
        assert_eq!(
            profile_name_problem("Default", &others),
            Some("That name is taken by the one searches use.")
        );
        assert_eq!(
            profile_name_problem("work", &others),
            Some("You already have one with that name.")
        );
        assert_eq!(profile_name_problem("Trip", &others), None);
    }

    #[test]
    fn runs_are_ordered_and_told() {
        let jobs = [
            json!({ "started_at": 5, "progress": { "phase": "done" }, "report": { "pages": 1, "new_products": 2, "failed": 1 } }),
            json!({ "started_at": 1, "progress": { "phase": "running", "done": 2, "total": 9, "products": 3 } }),
        ];
        let ordered = order_runs(&jobs);
        assert_eq!(ordered[0]["started_at"], 1);
        assert_eq!(
            run_summary(&jobs[0]),
            "1 page, 2 new products, 1 page failed"
        );
        assert_eq!(run_summary(&jobs[1]), "2 of 9 pages · 3 products");
        let j = json!({ "report": { "sources": { "Lidl": { "failed": 2, "pages": 5 }, "Aldi": { "failed": 0, "last_error": "blocked" }, "Rewe": { "failed": 0 } } } });
        // the shops come in the order the server wrote them (alphabetical without serde_json's `preserve_order`)
        let mut problems = run_problems(&j);
        problems.sort_by_key(|p| p["shop"].as_str().unwrap_or("").to_string());
        assert_eq!(
            problems,
            [
                json!({ "shop": "Aldi", "text": "blocked" }),
                json!({ "shop": "Lidl", "text": "2 of 5 pages failed" })
            ]
        );
        assert_eq!(phase_tone("failed"), "danger");
    }

    #[test]
    fn a_search_leads_to_a_next_step() {
        let r = |category: Value, products: i64, items: usize, stale: bool| json!({ "category": category, "catalogue": { "products_in_category": products, "stale": stale }, "items": vec![1; items] });
        assert_eq!(
            next_step(&r(Value::Null, 0, 0, false), false)["reason"],
            "no-category"
        );
        assert_eq!(
            next_step(&r(json!("phone"), 0, 0, false), false)["reason"],
            "empty"
        );
        assert_eq!(
            next_step(&r(json!("phone"), 5, 0, false), false)["kind"],
            "none-found"
        );
        assert_eq!(
            next_step(&r(json!("phone"), 5, 0, true), false)["reason"],
            "stale"
        );
        assert_eq!(
            next_step(&r(json!("phone"), 5, 2, true), true)["reason"],
            "stale"
        );
        assert_eq!(
            next_step(&r(json!("phone"), 5, 2, true), false)["kind"],
            "show"
        );
        assert_eq!(
            index_request_for(&json!({ "query": " p ", "category": "phone" }), None),
            json!({ "query": "p", "category": "phone" })
        );
        assert_eq!(
            index_request_for(
                &json!({ "query": "p" }),
                Some(&json!({ "category": "laptop" }))
            ),
            json!({ "query": "p", "category": "laptop" })
        );
        assert_eq!(
            chips_for(
                &json!({ "parsed": { "max_price_cents": 60000, "constraints": [{ "attribute": "ram_gb", "op": "gte", "value": 8 }] } })
            ),
            ["under 600 €", "ram gb ≥ 8"]
        );
    }

    #[test]
    fn sources_are_checked_before_saving() {
        assert_eq!(check_sources("  "), json!({ "ok": true, "count": 0 }));
        assert!(check_sources("{")["problems"][0]
            .as_str()
            .unwrap()
            .starts_with("Not valid JSON: "));
        assert_eq!(
            check_sources("{}")["problems"][0],
            "The sources must be a list: [ { ... }, { ... } ]"
        );
        let bad =
            check_sources(r#"[{"name":"a","kind":"search","search_url":"x"},{"kind":"feed"},3]"#);
        assert_eq!(
            bad["problems"],
            json!([
                "a: search_url must contain {query}",
                "source 2: needs a name",
                "source 2: a feed needs feed_url and a mapping",
                "source 3: not an object"
            ])
        );
        assert_eq!(
            check_sources(r#"[{"name":"a","urls":["u"]}]"#),
            json!({ "ok": true, "count": 1 })
        );
    }

    #[test]
    fn deal_messages_become_notices_with_a_summary_for_many() {
        let msg = |id: i64| json!({ "id": id, "read": false, "message": "Cheap", "event": { "kind": "new_low", "title": "P", "price_cents": 500, "reference_cents": 800, "product_id": "p", "url": "u" } });
        let one = notice_for(&msg(7));
        assert_eq!(one["title"], "Lowest price we have seen: P");
        assert_eq!(one["body"], "Cheap (was about 8,00 €)");
        let items: Vec<Value> = (1..=6).map(msg).collect();
        let plan = plan_deal_notices(&items, 1.0, 3);
        assert_eq!(plan["lastShownId"], 6.0);
        let ids: Vec<_> = plan["notices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            ids,
            [
                "financer.shop.deal.summary.6",
                "financer.shop.deal.5",
                "financer.shop.deal.6"
            ]
        );
        assert_eq!(plan["notices"][0]["title"], "3 more deals");
        assert_eq!(
            plan_deal_notices(&items, 6.0, 3),
            json!({ "notices": [], "lastShownId": 6.0 })
        );
    }
}
