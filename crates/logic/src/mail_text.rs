//! Rules of the mail compose and template screens that do not need the screen.

use regex::Regex;
use serde_json::Value;

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

/// The words for a person: their name, else their address.
pub fn person_name(a: &Value) -> String {
    let name = s(a, "name").trim();
    if name.is_empty() {
        s(a, "email").to_string()
    } else {
        name.to_string()
    }
}

/// "Max, Anna & Tom".
pub fn people_text(list: &[Value]) -> String {
    let names: Vec<String> = list.iter().map(person_name).collect();
    match names.len() {
        0 => String::new(),
        1 => names[0].clone(),
        n => format!("{} & {}", names[..n - 1].join(", "), names[n - 1]),
    }
}

/// The recipients as the server wants them: one string per address, name kept.
pub fn recipient_strings(list: &[Value]) -> Vec<String> {
    list.iter()
        .map(|a| {
            let (name, email) = (s(a, "name"), s(a, "email"));
            if name.is_empty() {
                email.to_string()
            } else if name.contains(',') {
                format!("\"{name}\" <{email}>")
            } else {
                format!("{name} <{email}>")
            }
        })
        .collect()
}

/// Whether a message can be sent: someone to send to, something to say, and a subject for a new topic.
pub fn send_problem(to: &str, body: &str, subject: &str, is_reply: bool) -> Option<&'static str> {
    if to.trim().is_empty() {
        Some("Add who it goes to.")
    } else if body.trim().is_empty() {
        Some("Write something first.")
    } else if !is_reply && subject.trim().is_empty() {
        Some("A new topic needs a subject.")
    } else {
        None
    }
}

/// Newest first becomes oldest first: the order a chat is read in.
pub fn oldest_first(list: &[Value]) -> Vec<Value> {
    let mut out = list.to_vec();
    out.sort_by(|a, b| {
        let at = |v: &Value| v.get("at").and_then(Value::as_f64).unwrap_or(0.0);
        at(a)
            .partial_cmp(&at(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

// ---- templates ----

fn example(key: &str) -> Option<&'static str> {
    Some(match key {
        "first_name" => "Max",
        "last_name" => "Müller",
        "name" => "Max Müller",
        "me" => "Paul Meier",
        "my_first_name" => "Paul",
        _ => return None,
    })
}

/// The template filled in with an example person and sender.
pub fn example_text(text: &str) -> String {
    Regex::new(r"\{([a-z_]+)\}")
        .unwrap()
        .replace_all(text, |c: &regex::Captures| {
            example(&c[1]).map_or_else(|| c[0].to_string(), str::to_string)
        })
        .to_string()
}

/// `["max@x.de", "@firma.de"]` as "max@x.de, @firma.de", or "Anyone".
pub fn audience_text(audience: &[String]) -> String {
    if audience.is_empty() {
        "Anyone".into()
    } else {
        audience.join(", ")
    }
}

/// The audience as typed (separated by commas, semicolons, spaces or lines) as a list.
pub fn parse_audience(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for part in text.split(|c: char| c.is_whitespace() || c == ',' || c == ';') {
        let a = part.trim().to_lowercase();
        if !a.is_empty() && !out.contains(&a) {
            out.push(a);
        }
    }
    out
}

pub fn templates_of(all: &[Value], kind: &str) -> Vec<Value> {
    all.iter()
        .filter(|t| s(t, "kind") == kind)
        .cloned()
        .collect()
}

/// `auto`, `none` or `id:7`.
pub fn choice_key(c: &Value) -> String {
    match c.as_str() {
        Some(x @ ("auto" | "none")) => x.to_string(),
        _ => format!(
            "id:{}",
            c.get("id")
                .map_or_else(|| "undefined".to_string(), crate::js::string)
        ),
    }
}

/// What a choice means in words: "Automatic", "None" or the template's name.
pub fn choice_label(c: &Value, all: &[Value]) -> String {
    match c.as_str() {
        Some("auto") => "Automatic".into(),
        Some("none") => "None".into(),
        _ => all
            .iter()
            .find(|t| t.get("id") == c.get("id"))
            .and_then(|t| t.get("name").and_then(Value::as_str))
            .unwrap_or("Chosen template")
            .to_string(),
    }
}

/// The first line of a template, for a chip ("Lieber Max," / "VG").
pub fn first_line(text: &str) -> String {
    text.split('\n').next().unwrap_or("").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn people_are_named_and_addressed() {
        let list = [
            json!({ "name": "Max", "email": "m@x.de" }),
            json!({ "name": " ", "email": "a@x.de" }),
            json!({ "email": "t@x.de" }),
        ];
        assert_eq!(people_text(&list), "Max, a@x.de & t@x.de");
        assert_eq!(people_text(&list[..1]), "Max");
        assert_eq!(people_text(&[]), "");
        let named = [
            json!({ "name": "Müller, Max", "email": "m@x.de" }),
            json!({ "email": "t@x.de" }),
        ];
        assert_eq!(
            recipient_strings(&named),
            ["\"Müller, Max\" <m@x.de>", "t@x.de"]
        );
    }

    #[test]
    fn a_message_needs_who_what_and_a_subject() {
        assert_eq!(
            send_problem(" ", "x", "s", false),
            Some("Add who it goes to.")
        );
        assert_eq!(
            send_problem("a", " ", "s", false),
            Some("Write something first.")
        );
        assert_eq!(
            send_problem("a", "x", " ", false),
            Some("A new topic needs a subject.")
        );
        assert_eq!(send_problem("a", "x", " ", true), None);
        let l = [json!({ "at": 3 }), json!({ "at": 1 })];
        assert_eq!(oldest_first(&l)[0]["at"], 1);
    }

    #[test]
    fn templates_show_an_example_and_a_short_audience() {
        assert_eq!(
            example_text("Hallo {first_name}, {unknown} {my_first_name}"),
            "Hallo Max, {unknown} Paul"
        );
        assert_eq!(audience_text(&[]), "Anyone");
        assert_eq!(
            parse_audience("A@x.de, b@x.de;a@x.de\n @firma.de"),
            ["a@x.de", "b@x.de", "@firma.de"]
        );
        let all = [json!({ "id": 4, "kind": "greeting", "name": "Formal" })];
        assert_eq!(choice_key(&json!("auto")), "auto");
        assert_eq!(choice_key(&json!({ "id": 4 })), "id:4");
        assert_eq!(choice_label(&json!({ "id": 4 }), &all), "Formal");
        assert_eq!(choice_label(&json!({ "id": 9 }), &all), "Chosen template");
        assert_eq!(templates_of(&all, "closing").len(), 0);
        assert_eq!(first_line("  VG \nPaul"), "VG");
    }
}
