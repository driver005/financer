//! The rules screen and the recategorize / split sheets: turning the form (everything as text) into
//! an API body, describing a rule in one line, reordering, and splitting a booking. Money is integer
//! cents throughout.

use serde::{Deserialize, Serialize};

use crate::format::{format_cents, parse_euro_input};

/// The shape the API stores for a rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleFields {
    pub pattern: String,
    pub kind: String,
    #[serde(default)]
    pub sign: Option<String>,
    #[serde(default)]
    pub min_cents: Option<i64>,
    #[serde(default)]
    pub max_cents: Option<i64>,
    pub category: String,
}

/// What the rule form holds while editing: everything as text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleDraft {
    pub pattern: String,
    pub kind: String,
    pub sign: String,
    pub min: String,
    pub max: String,
    pub category: String,
}

/// `12.5` euros as the form shows it: `12,50`.
fn euro_text(cents: i64) -> String {
    let abs = cents.unsigned_abs();
    format!(
        "{}{}.{:02}",
        if cents < 0 { "-" } else { "" },
        abs / 100,
        abs % 100
    )
    .replace('.', ",")
}

pub fn draft_from_rule(r: &RuleFields) -> RuleDraft {
    RuleDraft {
        pattern: r.pattern.clone(),
        kind: r.kind.clone(),
        sign: r.sign.clone().unwrap_or_else(|| "any".into()),
        min: r.min_cents.map_or(String::new(), euro_text),
        max: r.max_cents.map_or(String::new(), euro_text),
        category: r.category.clone(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleResult {
    Rule(RuleFields),
    Error(String),
}

/// Turn the form into an API body, or say what is wrong with it.
pub fn rule_from_draft(d: &RuleDraft) -> RuleResult {
    let pattern = d.pattern.trim();
    if !pattern.chars().any(char::is_alphabetic) {
        return RuleResult::Error("The name needs at least one letter".into());
    }
    let parse = |text: &str| -> Result<Option<i64>, ()> {
        if text.trim().is_empty() {
            Ok(None)
        } else {
            parse_euro_input(text).map(Some).ok_or(())
        }
    };
    let (min, max) = (parse(&d.min), parse(&d.max));
    let Ok(min) = min else {
        return RuleResult::Error(format!("\"{}\" is not a valid smallest amount", d.min));
    };
    let Ok(max) = max else {
        return RuleResult::Error(format!("\"{}\" is not a valid largest amount", d.max));
    };
    if let (Some(a), Some(b)) = (min, max) {
        if a > b {
            return RuleResult::Error("The smallest amount is larger than the largest".into());
        }
    }
    RuleResult::Rule(RuleFields {
        pattern: pattern.into(),
        kind: d.kind.clone(),
        sign: if d.sign == "any" {
            None
        } else {
            Some(d.sign.clone())
        },
        min_cents: min,
        max_cents: max,
        category: d.category.clone(),
    })
}

fn kind_label(kind: &str) -> &str {
    match kind {
        "contains" => "contains",
        "equals" => "is exactly",
        "starts_with" => "starts with",
        other => other,
    }
}

/// One line for the list, e.g. `Name starts with "kiosk" · expenses · 5,00 € to 20,00 € → dining`.
pub fn describe_rule(r: &RuleFields) -> String {
    let mut parts = vec![format!("Name {} \"{}\"", kind_label(&r.kind), r.pattern)];
    match r.sign.as_deref() {
        Some("expense") => parts.push("expenses".into()),
        Some(_) => parts.push("income".into()),
        None => {}
    }
    match (r.min_cents, r.max_cents) {
        (Some(a), Some(b)) => parts.push(format!("{} to {}", format_cents(a), format_cents(b))),
        (Some(a), None) => parts.push(format!("from {}", format_cents(a))),
        (None, Some(b)) => parts.push(format!("up to {}", format_cents(b))),
        (None, None) => {}
    }
    format!("{} → {}", parts.join(" · "), r.category)
}

/// The ids with the one at `index` moved by `delta` places; unchanged when it cannot move.
pub fn move_id(ids: &[i64], index: i64, delta: i64) -> Vec<i64> {
    let to = index + delta;
    let len = ids.len() as i64;
    if index < 0 || index >= len || to < 0 || to >= len {
        return ids.to_vec();
    }
    let mut out = ids.to_vec();
    out.swap(index as usize, to as usize);
    out
}

/// A part while editing: the amount is what you typed, always positive (the sign comes from the booking).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SplitDraftPart {
    pub amount: String,
    pub category: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SplitPartBody {
    pub amount_cents: i64,
    pub category: String,
    #[serde(default)]
    pub note: Option<String>,
}

/// Cents of the booking still to hand out (positive), or negative when the parts exceed it.
pub fn split_remainder(total_cents: i64, parts: &[SplitDraftPart]) -> i64 {
    let used: i64 = parts
        .iter()
        .map(|p| parse_euro_input(&p.amount).unwrap_or(0))
        .sum();
    total_cents.abs() - used
}

/// A first two-part draft: the whole amount in the booking's category and an empty second part.
pub fn initial_split(total_cents: i64, category: Option<&str>) -> Vec<SplitDraftPart> {
    vec![
        SplitDraftPart {
            amount: euro_text(total_cents.abs()),
            category: category.unwrap_or("other").into(),
            note: String::new(),
        },
        SplitDraftPart {
            amount: String::new(),
            category: "other".into(),
            note: String::new(),
        },
    ]
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitResult {
    Parts(Vec<SplitPartBody>),
    Error(String),
}

/// Check the parts add up exactly and build the API body (amounts get the booking's sign).
pub fn split_from_draft(total_cents: i64, parts: &[SplitDraftPart]) -> SplitResult {
    if total_cents == 0 {
        return SplitResult::Error("A transaction of 0 € cannot be split".into());
    }
    if parts.len() < 2 {
        return SplitResult::Error("A split needs at least two parts".into());
    }
    let sign = if total_cents < 0 { -1 } else { 1 };
    let mut body = Vec::new();
    for (i, p) in parts.iter().enumerate() {
        match parse_euro_input(&p.amount) {
            None | Some(0) => {
                return SplitResult::Error(format!("Part {} needs an amount above 0", i + 1))
            }
            Some(cents) => {
                let note = p.note.trim();
                body.push(SplitPartBody {
                    amount_cents: sign * cents,
                    category: p.category.clone(),
                    note: (!note.is_empty()).then(|| note.to_string()),
                });
            }
        }
    }
    let left = split_remainder(total_cents, parts);
    if left != 0 {
        return SplitResult::Error(if left > 0 {
            format!("{} still to assign", format_cents(left))
        } else {
            format!("{} too much", format_cents(-left))
        });
    }
    SplitResult::Parts(body)
}

pub fn draft_from_split(parts: &[SplitPartBody]) -> Vec<SplitDraftPart> {
    parts
        .iter()
        .map(|p| SplitDraftPart {
            amount: euro_text(p.amount_cents.abs()),
            category: p.category.clone(),
            note: p.note.clone().unwrap_or_default(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule() -> RuleFields {
        RuleFields {
            pattern: "kiosk".into(),
            kind: "starts_with".into(),
            sign: Some("expense".into()),
            min_cents: Some(500),
            max_cents: Some(2000),
            category: "dining".into(),
        }
    }
    fn draft(pattern: &str, min: &str, max: &str) -> RuleDraft {
        RuleDraft {
            pattern: pattern.into(),
            kind: "contains".into(),
            sign: "any".into(),
            min: min.into(),
            max: max.into(),
            category: "groceries".into(),
        }
    }
    fn part(amount: &str, note: &str) -> SplitDraftPart {
        SplitDraftPart {
            amount: amount.into(),
            category: "groceries".into(),
            note: note.into(),
        }
    }

    #[test]
    fn a_rule_is_described_in_one_line() {
        assert_eq!(
            describe_rule(&rule()),
            "Name starts with \"kiosk\" · expenses · 5,00 € to 20,00 € → dining"
        );
        let open = RuleFields {
            sign: None,
            min_cents: None,
            max_cents: Some(300),
            kind: "equals".into(),
            ..rule()
        };
        assert_eq!(
            describe_rule(&open),
            "Name is exactly \"kiosk\" · up to 3,00 € → dining"
        );
        let from = RuleFields {
            sign: Some("income".into()),
            min_cents: Some(100),
            max_cents: None,
            ..rule()
        };
        assert_eq!(
            describe_rule(&from),
            "Name starts with \"kiosk\" · income · from 1,00 € → dining"
        );
    }

    #[test]
    fn the_form_round_trips_and_is_checked() {
        let d = draft_from_rule(&rule());
        assert_eq!(
            (d.min.as_str(), d.max.as_str(), d.sign.as_str()),
            ("5,00", "20,00", "expense")
        );
        assert_eq!(rule_from_draft(&d), RuleResult::Rule(rule()));
        assert_eq!(
            rule_from_draft(&draft("123", "", "")),
            RuleResult::Error("The name needs at least one letter".into())
        );
        assert_eq!(
            rule_from_draft(&draft("Edeka", "abc", "")),
            RuleResult::Error("\"abc\" is not a valid smallest amount".into())
        );
        assert_eq!(
            rule_from_draft(&draft("Edeka", "", "x")),
            RuleResult::Error("\"x\" is not a valid largest amount".into())
        );
        assert_eq!(
            rule_from_draft(&draft("Edeka", "10", "5")),
            RuleResult::Error("The smallest amount is larger than the largest".into())
        );
        let RuleResult::Rule(ok) = rule_from_draft(&draft("  Edeka ", "", "")) else {
            panic!("valid")
        };
        assert_eq!(
            (ok.pattern.as_str(), ok.sign, ok.min_cents),
            ("Edeka", None, None)
        );
        assert!(
            matches!(
                rule_from_draft(&draft("Müller", "", "")),
                RuleResult::Rule(_)
            ),
            "letters beyond ASCII count"
        );
    }

    #[test]
    fn a_rule_moves_one_place_or_stays() {
        assert_eq!(move_id(&[1, 2, 3], 1, -1), [2, 1, 3]);
        assert_eq!(move_id(&[1, 2, 3], 1, 1), [1, 3, 2]);
        assert_eq!(move_id(&[1, 2, 3], 0, -1), [1, 2, 3]);
        assert_eq!(move_id(&[1, 2, 3], 2, 1), [1, 2, 3]);
        assert_eq!(move_id(&[1, 2, 3], 5, 1), [1, 2, 3]);
    }

    #[test]
    fn a_booking_is_split_into_parts_that_add_up() {
        let start = initial_split(-2347, Some("groceries"));
        assert_eq!(
            (
                start[0].amount.as_str(),
                start[0].category.as_str(),
                start[1].category.as_str()
            ),
            ("23,47", "groceries", "other")
        );
        assert_eq!(
            split_remainder(-2347, &[part("10", ""), part("5,5", "")]),
            797
        );
        assert_eq!(
            split_from_draft(-2347, &[part("20", ""), part("3,47", " bread ")]),
            SplitResult::Parts(vec![
                SplitPartBody {
                    amount_cents: -2000,
                    category: "groceries".into(),
                    note: None
                },
                SplitPartBody {
                    amount_cents: -347,
                    category: "groceries".into(),
                    note: Some("bread".into())
                },
            ])
        );
        assert_eq!(
            split_from_draft(-2347, &[part("20", ""), part("1", "")]),
            SplitResult::Error("2,47 € still to assign".into())
        );
        assert_eq!(
            split_from_draft(-2347, &[part("20", ""), part("5", "")]),
            SplitResult::Error("1,53 € too much".into())
        );
        assert_eq!(
            split_from_draft(-2347, &[part("20", ""), part("", "")]),
            SplitResult::Error("Part 2 needs an amount above 0".into())
        );
        assert_eq!(
            split_from_draft(0, &[part("1", ""), part("1", "")]),
            SplitResult::Error("A transaction of 0 € cannot be split".into())
        );
        assert_eq!(
            split_from_draft(-100, &[part("1", "")]),
            SplitResult::Error("A split needs at least two parts".into())
        );
        let back = draft_from_split(&[SplitPartBody {
            amount_cents: -347,
            category: "dining".into(),
            note: Some("n".into()),
        }]);
        assert_eq!(
            (back[0].amount.as_str(), back[0].note.as_str()),
            ("3,47", "n")
        );
    }
}
