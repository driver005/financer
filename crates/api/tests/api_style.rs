//! One style for the whole API, checked on the OpenAPI document so that a new call that breaks it
//! fails the build. The rules are written down in `docs/API_STYLE.md`.

use serde_json::Value;

fn doc() -> Value {
    serde_json::from_str(&financer_api::Api::openapi_json()).unwrap()
}

fn operations(doc: &Value) -> Vec<(String, String, &Value)> {
    let mut out = Vec::new();
    for (path, item) in doc["paths"].as_object().unwrap() {
        for (method, op) in item.as_object().unwrap() {
            out.push((method.to_uppercase(), path.clone(), op));
        }
    }
    out
}

fn snake(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn kebab(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Every problem found, so that one run shows them all.
fn report(problems: Vec<String>) {
    assert!(
        problems.is_empty(),
        "the API breaks its style rules (docs/API_STYLE.md):\n  {}",
        problems.join("\n  ")
    );
}

#[test]
fn paths_are_lower_case_kebab_with_snake_case_parameters() {
    let doc = doc();
    let mut bad = Vec::new();
    for (_, path, _) in operations(&doc) {
        for seg in path.trim_start_matches('/').split('/') {
            let ok = match seg.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                Some(param) => snake(param),
                None => kebab(seg),
            };
            if !ok {
                bad.push(format!("{path}: segment {seg:?}"));
            }
        }
    }
    bad.sort();
    bad.dedup();
    report(bad);
}

#[test]
fn query_parameters_and_fields_are_snake_case_and_one_name_means_one_thing() {
    let doc = doc();
    let mut bad = Vec::new();
    for (method, path, op) in operations(&doc) {
        for p in op["parameters"].as_array().into_iter().flatten() {
            let name = p["name"].as_str().unwrap();
            if !snake(name) {
                bad.push(format!(
                    "{method} {path}: parameter {name:?} is not snake_case"
                ));
            }
            // the day an answer is for is always `date`
            if ["as_of", "day", "on", "today"].contains(&name) {
                bad.push(format!(
                    "{method} {path}: parameter {name:?}; the day is `date`"
                ));
            }
        }
    }
    for (schema, def) in doc["components"]["schemas"].as_object().unwrap() {
        for field in def["properties"]
            .as_object()
            .into_iter()
            .flat_map(|p| p.keys())
        {
            if !snake(field) {
                bad.push(format!(
                    "schema {schema}: field {field:?} is not snake_case"
                ));
            }
            if field == "as_of" {
                bad.push(format!("schema {schema}: field `as_of`; the day is `date`"));
            }
        }
    }
    report(bad);
}

#[test]
fn deleting_answers_204_and_nothing_else_does() {
    let doc = doc();
    let mut bad = Vec::new();
    for (method, path, op) in operations(&doc) {
        let ok: Vec<&String> = op["responses"]
            .as_object()
            .unwrap()
            .keys()
            .filter(|c| c.starts_with('2'))
            .collect();
        if method == "DELETE" && ok != ["204"] {
            bad.push(format!("DELETE {path}: answers {ok:?}, not 204"));
        }
        if method != "DELETE" && ok.iter().any(|c| *c == "204") {
            bad.push(format!(
                "{method} {path}: 204 is for DELETE; answer with the result"
            ));
        }
    }
    report(bad);
}

#[test]
fn every_error_has_the_same_body_and_bad_input_is_400() {
    let doc = doc();
    let mut bad = Vec::new();
    for (method, path, op) in operations(&doc) {
        for (code, response) in op["responses"].as_object().unwrap() {
            if code.starts_with('2') {
                continue;
            }
            if code == "422" {
                bad.push(format!("{method} {path}: 422; bad input is 400"));
            }
            let schema = response["content"]["application/json"]["schema"]["$ref"]
                .as_str()
                .map(|r| r.rsplit('/').next().unwrap().to_string());
            let has_error_field = schema.as_ref().is_some_and(|name| {
                doc["components"]["schemas"][name]["properties"]["error"].is_object()
            });
            if !has_error_field {
                bad.push(format!(
                    "{method} {path}: {code} does not answer with an `error` body (ErrorBody)"
                ));
            }
        }
    }
    report(bad);
}

fn schema_name(schema: &Value) -> Option<String> {
    let r = schema["$ref"]
        .as_str()
        .or_else(|| schema["items"]["$ref"].as_str())?;
    Some(r.rsplit('/').next().unwrap().to_string())
}

#[test]
fn what_goes_in_is_an_input_and_what_comes_out_is_a_dto() {
    let doc = doc();
    let mut bad = Vec::new();
    for (method, path, op) in operations(&doc) {
        // the thing a GET of the same path answers with may be sent back as it is (`/v1/data`)
        let gets = doc["paths"][&path]["get"]["responses"]["200"]["content"]["application/json"]
            ["schema"]
            .clone();
        let symmetric = schema_name(&gets);
        for c in op["requestBody"]["content"].as_object().into_iter().flatten() {
            if let Some(name) = schema_name(&c.1["schema"]) {
                if !name.ends_with("Input") && symmetric.as_deref() != Some(name.as_str()) {
                    bad.push(format!("{method} {path}: the body {name} should end in `Input`"));
                }
            }
        }
        for (code, r) in op["responses"].as_object().unwrap() {
            if !code.starts_with('2') {
                continue;
            }
            if let Some(c) = r["content"]["application/json"].as_object() {
                if let Some(name) = schema_name(&c["schema"]) {
                    if !name.ends_with("Dto") {
                        bad.push(format!("{method} {path}: the answer {name} should end in `Dto`"));
                    }
                }
            }
        }
    }
    bad.sort();
    bad.dedup();
    report(bad);
}

#[test]
fn paths_are_nouns_and_only_actions_on_one_thing_are_verbs() {
    let doc = doc();
    // verbs that may close a path under one thing (`/{id}/dismiss`, `/sources/{kind}/connect`)
    let actions = ["dismiss", "cancel", "connect", "finish", "disconnect", "import"];
    // verbs that used to be paths of their own: make the result a resource instead
    let banned = [
        "apply", "reorder", "refresh", "create", "restore", "accept", "categorize-unknown", "scan",
        "export", "recalculate", "run", "do",
    ];
    let mut bad = Vec::new();
    for (method, path, _) in operations(&doc) {
        let segs: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        for (i, seg) in segs.iter().enumerate() {
            let is_param = seg.starts_with('{');
            if is_param {
                continue;
            }
            let after_param = i > 0 && segs[i - 1].starts_with('{');
            let before_param = segs.get(i + 1).is_some_and(|n| n.starts_with('{'));
            if banned.contains(seg) {
                bad.push(format!("{method} {path}: {seg:?} is a verb; make the result a resource"));
            }
            if actions.contains(seg) && !(after_param && i == segs.len() - 1) && !before_param {
                bad.push(format!("{method} {path}: the action {seg:?} belongs under one thing"));
            }
        }
    }
    report(bad);
}

#[test]
fn a_resource_is_not_nested_under_one_it_is_not_part_of() {
    let doc = doc();
    // the two lists the meal plan only reads from have their own place
    let mut bad = Vec::new();
    for (method, path, _) in operations(&doc) {
        if path.starts_with("/v1/meal-plan/") {
            bad.push(format!("{method} {path}: {path} is not part of the meal plan"));
        }
    }
    report(bad);
}

#[test]
fn bodies_are_named_schemas_or_files() {
    let doc = doc();
    let named_or_list = |schema: &Value| {
        schema["$ref"].is_string()
            || (schema["type"] == "array" && schema["items"]["$ref"].is_string())
    };
    let mut bad = Vec::new();
    for (method, path, op) in operations(&doc) {
        if path == "/health" {
            continue;
        }
        for (content_type, c) in op["requestBody"]["content"]
            .as_object()
            .into_iter()
            .flatten()
        {
            if content_type != "application/json" && content_type != "text/csv" {
                bad.push(format!("{method} {path}: request body is {content_type}"));
            } else if content_type == "application/json" && !named_or_list(&c["schema"]) {
                bad.push(format!(
                    "{method} {path}: the request body is not a named schema"
                ));
            }
        }
        for (code, r) in op["responses"].as_object().unwrap() {
            if !code.starts_with('2') {
                continue;
            }
            if let Some(c) = r["content"]["application/json"].as_object() {
                if !named_or_list(&c["schema"]) {
                    bad.push(format!(
                        "{method} {path}: the {code} answer is not a named schema"
                    ));
                }
            }
        }
    }
    report(bad);
}

#[test]
fn a_provider_is_a_path_parameter_never_a_path() {
    let doc = doc();
    let providers = [
        "lidl",
        "lidl-plus",
        "lidl_plus",
        "kaufland",
        "rewe",
        "orders",
        "plaid",
        "gocardless",
        "finapi",
        "fints",
        "csv",
        "email",
        "folder",
    ];
    let mut bad = Vec::new();
    for (method, path, _) in operations(&doc) {
        for seg in path.trim_start_matches('/').split('/') {
            if providers.contains(&seg) {
                bad.push(format!(
                    "{method} {path}: {seg:?} is a provider; use a {{kind}} parameter"
                ));
            }
        }
    }
    for schema in doc["components"]["schemas"].as_object().unwrap().keys() {
        for word in [
            "Lidl",
            "Kaufland",
            "Rewe",
            "Plaid",
            "Gocardless",
            "Finapi",
            "Fints",
        ] {
            if schema.contains(word) {
                bad.push(format!("schema {schema}: named after a provider ({word})"));
            }
        }
    }
    report(bad);
}

#[test]
fn every_call_needs_the_token_except_health() {
    let doc = doc();
    let mut bad = Vec::new();
    for (method, path, op) in operations(&doc) {
        if path != "/health" && !op["security"].is_array() {
            bad.push(format!("{method} {path}: no security"));
        }
    }
    report(bad);
}
