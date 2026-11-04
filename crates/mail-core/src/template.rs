//! Greeting and closing templates: the text that goes around a message ("Lieber Max," above it,
//! "VG\nPaul" below it). A template is chosen per recipient (a friend gets "Lieber {first_name},",
//! a company address "Sehr geehrte Damen und Herren,"), filled in with the recipient's name and
//! your own, and wrapped around what you typed at the very end, just before sending.

use serde::{Deserialize, Serialize};

use crate::address::Address;
use crate::frame::split_frame;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateKind {
    Greeting,
    Closing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Template {
    #[serde(default)]
    pub id: i64,
    pub kind: TemplateKind,
    pub name: String,
    /// The text, with placeholders (see [`PLACEHOLDERS`]). Several lines are allowed.
    pub text: String,
    /// Used instead of `text` when a placeholder needs a recipient's name that is not known.
    #[serde(default)]
    pub fallback: Option<String>,
    /// Who it is for: exact addresses (`max@x.de`) or whole domains (`@firma.de`). Empty: anyone.
    #[serde(default)]
    pub audience: Vec<String>,
    /// The one used when nothing more specific fits.
    #[serde(default)]
    pub is_default: bool,
}

/// What can stand in `{braces}` in a template.
pub const PLACEHOLDERS: &[(&str, &str)] = &[
    ("first_name", "the recipient's first name"),
    ("last_name", "the recipient's last name"),
    ("name", "the recipient's full name"),
    ("me", "your full name"),
    ("my_first_name", "your first name"),
];

const MAX_TEXT: usize = 1000;

/// Everything wrong with a template, in words. Empty when it is fine.
pub fn validate_template(t: &Template) -> Vec<String> {
    let mut problems = Vec::new();
    if t.name.trim().is_empty() {
        problems.push("The template needs a name.".to_string());
    } else if t.name.chars().count() > 60 {
        problems.push("The name is longer than 60 characters.".to_string());
    }
    if t.text.trim().is_empty() {
        problems.push("The text is empty.".to_string());
    }
    if t.text.chars().count() > MAX_TEXT {
        problems.push(format!("The text is longer than {MAX_TEXT} characters."));
    }
    for (label, text) in [("text", Some(&t.text)), ("fallback", t.fallback.as_ref())] {
        if let Some(text) = text {
            for p in placeholders_in(text) {
                if !PLACEHOLDERS.iter().any(|(n, _)| *n == p) {
                    problems.push(format!(
                        "{{{p}}} in the {label} is not a placeholder. Use {}.",
                        PLACEHOLDERS
                            .iter()
                            .map(|(n, _)| format!("{{{n}}}"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ));
                }
            }
        }
    }
    if let Some(f) = &t.fallback {
        if !placeholders_in(f)
            .iter()
            .all(|p| ["me", "my_first_name"].contains(&p.as_str()))
        {
            problems.push(
                "The fallback cannot use the recipient's name; it is used when that is unknown."
                    .to_string(),
            );
        }
    }
    for a in &t.audience {
        let a = a.trim();
        let ok = a.strip_prefix('@').map_or_else(
            || crate::address::is_valid_email(&a.to_lowercase()),
            |d| d.contains('.') && !d.contains(['@', ' ']),
        );
        if !ok {
            problems.push(format!(
                "\"{a}\" is neither an address (max@x.de) nor a domain (@x.de)."
            ));
        }
    }
    problems
}

fn placeholders_in(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        let Some(close) = rest[open..].find('}') else {
            break;
        };
        out.push(rest[open + 1..open + close].to_string());
        rest = &rest[open + close + 1..];
    }
    out
}

/// A template filled in for some recipients.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Rendered {
    pub text: String,
    /// The recipient's name was needed and not known, so the fallback (or nothing) was used.
    pub missing_name: bool,
}

/// The people the mail goes to, and you.
pub struct Context<'a> {
    pub recipients: &'a [Address],
    pub me: &'a Address,
}

fn join_names(names: Vec<String>) -> String {
    match names.len() {
        0 => String::new(),
        1 => names.into_iter().next().unwrap_or_default(),
        _ => {
            let (last, rest) = names.split_last().expect("not empty");
            format!("{} & {}", rest.join(", "), last)
        }
    }
}

pub fn render_template(t: &Template, ctx: &Context) -> Rendered {
    let (my_first, my_full) = match ctx.me.person_name() {
        Some((f, Some(l))) => (f.clone(), format!("{f} {l}")),
        Some((f, None)) => (f.clone(), f),
        None => (ctx.me.display(), ctx.me.display()),
    };
    let people: Vec<(String, Option<String>)> = ctx
        .recipients
        .iter()
        .filter_map(|r| r.person_name())
        .collect();
    // every recipient must have a known name, or the greeting would leave someone out
    let names_known = !ctx.recipients.is_empty() && people.len() == ctx.recipients.len();
    let uses_recipient = placeholders_in(&t.text)
        .iter()
        .any(|p| ["first_name", "last_name", "name"].contains(&p.as_str()));
    let source = if uses_recipient && !names_known {
        t.fallback.as_deref()
    } else {
        Some(t.text.as_str())
    };
    let Some(source) = source else {
        return Rendered {
            text: String::new(),
            missing_name: true,
        };
    };
    let firsts = join_names(people.iter().map(|(f, _)| f.clone()).collect());
    let lasts = join_names(people.iter().filter_map(|(_, l)| l.clone()).collect());
    let fulls = join_names(
        people
            .iter()
            .map(|(f, l)| l.as_ref().map_or_else(|| f.clone(), |l| format!("{f} {l}")))
            .collect(),
    );
    let mut text = source.to_string();
    for (key, value) in [
        ("first_name", firsts),
        ("last_name", lasts),
        ("name", fulls),
        ("me", my_full),
        ("my_first_name", my_first),
    ] {
        text = text.replace(&format!("{{{key}}}"), &value);
    }
    Rendered {
        text: text.trim().to_string(),
        missing_name: uses_recipient && !names_known && t.fallback.is_none(),
    }
}

/// How well a template's audience fits all recipients: `Some(rank)` when it does (higher is more
/// specific), `None` when some recipient is outside it. An empty audience matches anyone, lowest rank.
fn audience_rank(t: &Template, recipients: &[Address]) -> Option<u8> {
    if t.audience.is_empty() {
        return Some(0);
    }
    let mut worst = 2u8;
    for r in recipients {
        let rank = t
            .audience
            .iter()
            .filter_map(|a| {
                let a = a.trim().to_lowercase();
                if let Some(domain) = a.strip_prefix('@') {
                    (r.domain() == domain || r.domain().ends_with(&format!(".{domain}")))
                        .then_some(1u8)
                } else {
                    (r.email == a).then_some(2u8)
                }
            })
            .max()?;
        worst = worst.min(rank);
    }
    (!recipients.is_empty()).then_some(worst)
}

/// The template to use for these recipients: the most specific audience match, else the default
/// of its kind, else none.
pub fn choose_template<'a>(
    templates: &'a [Template],
    kind: TemplateKind,
    recipients: &[Address],
) -> Option<&'a Template> {
    templates
        .iter()
        .filter(|t| t.kind == kind)
        .filter_map(|t| audience_rank(t, recipients).map(|rank| (t, rank)))
        .filter(|(t, rank)| *rank > 0 || t.is_default)
        .max_by_key(|(t, rank)| (*rank, t.is_default, std::cmp::Reverse(t.id)))
        .map(|(t, _)| t)
}

/// A message with its greeting and closing put on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Applied {
    pub text: String,
    /// The text already began with a greeting, so none was added.
    pub kept_own_greeting: bool,
    /// The text already ended with a closing, so none was added.
    pub kept_own_closing: bool,
}

/// Puts the greeting above and the closing below `body`. A greeting or closing you typed yourself
/// is kept and nothing is doubled.
pub fn apply_templates(
    body: &str,
    greeting: Option<&Rendered>,
    closing: Option<&Rendered>,
) -> Applied {
    let frame = split_frame(body);
    let kept_own_greeting =
        frame.greeting.is_some() && greeting.is_some_and(|g| !g.text.is_empty());
    let kept_own_closing = frame.closing.is_some() && closing.is_some_and(|c| !c.text.is_empty());
    let mut parts: Vec<String> = Vec::new();
    if let Some(g) = greeting.filter(|g| !g.text.is_empty()) {
        if frame.greeting.is_none() {
            parts.push(g.text.clone());
        }
    }
    if let Some(g) = &frame.greeting {
        parts.push(g.clone());
    }
    if !frame.body.trim().is_empty() {
        parts.push(frame.body.trim().to_string());
    }
    if let Some(c) = &frame.closing {
        parts.push(c.clone());
    } else if let Some(c) = closing.filter(|c| !c.text.is_empty()) {
        parts.push(c.text.clone());
    }
    Applied {
        text: parts.join("\n\n"),
        kept_own_greeting,
        kept_own_closing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tpl(id: i64, kind: TemplateKind, text: &str) -> Template {
        Template {
            id,
            kind,
            name: format!("t{id}"),
            text: text.into(),
            fallback: None,
            audience: vec![],
            is_default: false,
        }
    }
    fn addr(s: &str) -> Address {
        Address::parse(s).unwrap()
    }
    fn me() -> Address {
        addr("Paul Meier <paul@x.de>")
    }

    #[test]
    fn fills_in_the_greeting_for_one_person() {
        let t = tpl(1, TemplateKind::Greeting, "Lieber {first_name},");
        let r = render_template(
            &t,
            &Context {
                recipients: &[addr("Max Muster <max@y.de>")],
                me: &me(),
            },
        );
        assert_eq!(
            r,
            Rendered {
                text: "Lieber Max,".into(),
                missing_name: false
            }
        );
    }

    #[test]
    fn fills_in_the_closing_with_your_name() {
        let t = tpl(2, TemplateKind::Closing, "VG\n{my_first_name}");
        let r = render_template(
            &t,
            &Context {
                recipients: &[addr("max@y.de")],
                me: &me(),
            },
        );
        assert_eq!(r.text, "VG\nPaul");
        let t = tpl(3, TemplateKind::Closing, "Mit freundlichen Grüßen\n{me}");
        assert_eq!(
            render_template(
                &t,
                &Context {
                    recipients: &[addr("max@y.de")],
                    me: &me()
                }
            )
            .text,
            "Mit freundlichen Grüßen\nPaul Meier"
        );
    }

    #[test]
    fn several_recipients_are_joined() {
        let t = tpl(1, TemplateKind::Greeting, "Hallo {first_name},");
        let ctx = Context {
            recipients: &[
                addr("Max <max@y.de>"),
                addr("Anna <anna@y.de>"),
                addr("Tom <tom@y.de>"),
            ],
            me: &me(),
        };
        assert_eq!(render_template(&t, &ctx).text, "Hallo Max, Anna & Tom,");
    }

    #[test]
    fn an_unknown_name_uses_the_fallback() {
        let mut t = tpl(1, TemplateKind::Greeting, "Lieber {first_name},");
        t.fallback = Some("Hallo,".into());
        let r = render_template(
            &t,
            &Context {
                recipients: &[addr("info@y.de")],
                me: &me(),
            },
        );
        assert_eq!(
            r,
            Rendered {
                text: "Hallo,".into(),
                missing_name: false
            }
        );
    }

    #[test]
    fn an_unknown_name_without_fallback_leaves_the_greeting_out_and_says_so() {
        let t = tpl(1, TemplateKind::Greeting, "Lieber {first_name},");
        let r = render_template(
            &t,
            &Context {
                recipients: &[addr("info@y.de")],
                me: &me(),
            },
        );
        assert_eq!(
            r,
            Rendered {
                text: String::new(),
                missing_name: true
            }
        );
    }

    #[test]
    fn one_unknown_name_among_several_counts_as_unknown() {
        let t = tpl(1, TemplateKind::Greeting, "Hallo {first_name},");
        let ctx = Context {
            recipients: &[addr("Max <max@y.de>"), addr("info@y.de")],
            me: &me(),
        };
        assert!(render_template(&t, &ctx).missing_name);
    }

    #[test]
    fn a_template_without_recipient_placeholders_always_renders() {
        let t = tpl(1, TemplateKind::Greeting, "Sehr geehrte Damen und Herren,");
        let r = render_template(
            &t,
            &Context {
                recipients: &[addr("info@y.de")],
                me: &me(),
            },
        );
        assert_eq!(r.text, "Sehr geehrte Damen und Herren,");
        assert!(!r.missing_name);
    }

    #[test]
    fn chooses_by_address_then_domain_then_default() {
        let mut friend = tpl(1, TemplateKind::Greeting, "Lieber {first_name},");
        friend.audience = vec!["max@y.de".into()];
        let mut firm = tpl(2, TemplateKind::Greeting, "Sehr geehrte Damen und Herren,");
        firm.audience = vec!["@firma.de".into()];
        let mut default = tpl(3, TemplateKind::Greeting, "Hallo {first_name},");
        default.is_default = true;
        let other = tpl(4, TemplateKind::Greeting, "Moin {first_name},");
        let all = vec![other, default, firm, friend];
        let pick =
            |s: &str| choose_template(&all, TemplateKind::Greeting, &[addr(s)]).map(|t| t.id);
        assert_eq!(pick("max@y.de"), Some(1));
        assert_eq!(pick("a@firma.de"), Some(2));
        assert_eq!(pick("a@mail.firma.de"), Some(2));
        assert_eq!(pick("someone@z.de"), Some(3));
    }

    #[test]
    fn without_a_default_nothing_is_chosen_for_a_stranger() {
        let mut firm = tpl(2, TemplateKind::Greeting, "Sehr geehrte Damen und Herren,");
        firm.audience = vec!["@firma.de".into()];
        let all = vec![firm, tpl(4, TemplateKind::Greeting, "Moin")];
        assert!(choose_template(&all, TemplateKind::Greeting, &[addr("a@z.de")]).is_none());
    }

    #[test]
    fn a_domain_template_needs_every_recipient_in_the_domain() {
        let mut firm = tpl(2, TemplateKind::Greeting, "Sehr geehrte Damen und Herren,");
        firm.audience = vec!["@firma.de".into()];
        let mut default = tpl(3, TemplateKind::Greeting, "Hallo,");
        default.is_default = true;
        let all = vec![firm, default];
        let both = [addr("a@firma.de"), addr("b@z.de")];
        assert_eq!(
            choose_template(&all, TemplateKind::Greeting, &both).map(|t| t.id),
            Some(3)
        );
    }

    #[test]
    fn kinds_do_not_mix() {
        let mut c = tpl(1, TemplateKind::Closing, "VG");
        c.is_default = true;
        assert!(choose_template(&[c], TemplateKind::Greeting, &[addr("a@z.de")]).is_none());
    }

    #[test]
    fn puts_greeting_and_closing_around_the_text() {
        let g = Rendered {
            text: "Lieber Max,".into(),
            missing_name: false,
        };
        let c = Rendered {
            text: "VG\nPaul".into(),
            missing_name: false,
        };
        let out = apply_templates("kannst du morgen?", Some(&g), Some(&c));
        assert_eq!(out.text, "Lieber Max,\n\nkannst du morgen?\n\nVG\nPaul");
        assert!(!out.kept_own_greeting && !out.kept_own_closing);
    }

    #[test]
    fn does_not_double_a_greeting_or_closing_that_is_already_there() {
        let g = Rendered {
            text: "Lieber Max,".into(),
            missing_name: false,
        };
        let c = Rendered {
            text: "VG\nPaul".into(),
            missing_name: false,
        };
        let out = apply_templates("Hallo Max,\n\nja klar.\n\nLG\nPaul", Some(&g), Some(&c));
        assert_eq!(out.text, "Hallo Max,\n\nja klar.\n\nLG\nPaul");
        assert!(out.kept_own_greeting && out.kept_own_closing);
    }

    #[test]
    fn applies_only_what_is_given() {
        let c = Rendered {
            text: "VG".into(),
            missing_name: false,
        };
        assert_eq!(apply_templates("ok", None, Some(&c)).text, "ok\n\nVG");
        assert_eq!(apply_templates("ok", None, None).text, "ok");
        let empty = Rendered {
            text: String::new(),
            missing_name: true,
        };
        assert_eq!(apply_templates("ok", Some(&empty), None).text, "ok");
    }

    #[test]
    fn validation_catches_unknown_placeholders_and_bad_audiences() {
        let mut t = tpl(0, TemplateKind::Greeting, "Hallo {vorname}, {first_name}");
        t.audience = vec!["nonsense".into(), "@firma.de".into(), "a@b.de".into()];
        t.fallback = Some("Hallo {first_name}".into());
        let problems = validate_template(&t);
        assert!(
            problems.iter().any(|p| p.contains("{vorname}")),
            "{problems:?}"
        );
        assert!(
            problems.iter().any(|p| p.contains("nonsense")),
            "{problems:?}"
        );
        assert!(
            problems.iter().any(|p| p.contains("fallback cannot use")),
            "{problems:?}"
        );
        assert_eq!(problems.len(), 3, "{problems:?}");
        assert!(
            validate_template(&tpl(0, TemplateKind::Closing, "VG\n{my_first_name}")).is_empty()
        );
        assert!(!validate_template(&tpl(0, TemplateKind::Closing, "  ")).is_empty());
    }
}
