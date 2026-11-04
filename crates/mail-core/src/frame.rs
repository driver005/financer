//! The greeting and closing around a message ("Hallo Paul," ... "VG Max"). A chat bubble shows
//! only what was said; this finds the frame so it can be left out, and so a template is not applied
//! on top of a greeting the person already typed.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub greeting: Option<String>,
    pub body: String,
    pub closing: Option<String>,
}

const GREETINGS: &[&str] = &[
    "sehr geehrte damen und herren",
    "sehr geehrter",
    "sehr geehrte",
    "guten morgen",
    "guten tag",
    "guten abend",
    "grüß dich",
    "grüß gott",
    "grüezi",
    "liebe",
    "lieber",
    "hallo",
    "hi",
    "hey",
    "moin",
    "servus",
    "tach",
    "dear",
    "hello",
    "good morning",
    "good afternoon",
    "good evening",
    "morgen",
    "na",
    "ciao",
];

/// Closing phrases that may be followed by a name on the same line ("VG Paul").
const CLOSINGS: &[&str] = &[
    "mit freundlichen grüßen",
    "mit freundlichen grüssen",
    "mit freundlichem gruß",
    "mit besten grüßen",
    "mit herzlichen grüßen",
    "mit lieben grüßen",
    "viele grüße",
    "viele grüsse",
    "liebe grüße",
    "liebe grüsse",
    "beste grüße",
    "beste grüsse",
    "herzliche grüße",
    "herzliche grüsse",
    "freundliche grüße",
    "freundliche grüsse",
    "schöne grüße",
    "sonnige grüße",
    "grüße",
    "grüsse",
    "gruß",
    "gruss",
    "vg",
    "lg",
    "mfg",
    "gv",
    "hochachtungsvoll",
    "best regards",
    "kind regards",
    "warm regards",
    "regards",
    "best wishes",
    "sincerely",
    "yours sincerely",
];

/// Closing phrases that count only when they stand alone ("Danke!"), because they also start
/// ordinary sentences ("Danke, erledigt.").
const CLOSINGS_ALONE: &[&str] = &[
    "danke",
    "dankeschön",
    "vielen dank",
    "thanks",
    "thank you",
    "many thanks",
    "best",
    "cheers",
    "ciao",
    "tschüss",
    "tschüß",
    "bis bald",
    "bis dann",
    "bis später",
    "schönen tag",
    "einen schönen tag",
    "schönen abend",
    "schönes wochenende",
    "bis zum nächsten mal",
    "talk soon",
    "greetings",
    "dein",
    "deine",
    "euer",
    "ihr",
];

/// Longest line that still counts as a greeting or part of a closing.
const MAX_FRAME_LINE: usize = 48;
/// Most lines a closing spans (phrase, name, maybe a title).
const MAX_CLOSING_LINES: usize = 4;

fn starts_with_phrase(line: &str, phrases: &[&str]) -> bool {
    let l = line.trim().to_lowercase();
    phrases.iter().any(|p| {
        l.strip_prefix(p)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !c.is_alphanumeric()))
    })
}

pub fn is_greeting_line(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.chars().count() > MAX_FRAME_LINE {
        return false;
    }
    // "Hallo Paul," or "Hallo!" but not "Hallo, ich wollte fragen ob..." (a sentence continues)
    let ends = t.ends_with([',', '!', ':']) || t.chars().count() <= 24;
    ends && starts_with_phrase(t, GREETINGS) && !t.ends_with(['.', '?'])
}

fn is_closing_line(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.chars().count() > MAX_FRAME_LINE {
        return false;
    }
    if starts_with_phrase(t, CLOSINGS) {
        return true;
    }
    let bare = t.trim_end_matches([',', '!', '.', ' ']).to_lowercase();
    CLOSINGS_ALONE.contains(&bare.as_str())
}

/// Splits `text` into greeting, body and closing. Lines are only taken for the frame when they are
/// short and begin with a known phrase, so a sentence that merely starts with "Danke" stays.
pub fn split_frame(text: &str) -> Frame {
    let lines: Vec<&str> = text.lines().collect();
    let mut start = 0;
    while start < lines.len() && lines[start].trim().is_empty() {
        start += 1;
    }
    let mut greeting = None;
    if start < lines.len() && is_greeting_line(lines[start]) {
        greeting = Some(lines[start].trim().to_string());
        start += 1;
    }
    let mut end = lines.len();
    while end > start && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    // the closing: the first closing phrase within the last few lines, then only short lines to the end
    let mut closing = None;
    let window_start = end.saturating_sub(MAX_CLOSING_LINES).max(start);
    for i in window_start..end {
        if is_closing_line(lines[i])
            && lines[i..end].iter().all(|l| l.trim().chars().count() <= MAX_FRAME_LINE)
            // a closing never follows straight on from a sentence that is not finished
            && i > start
            && (lines[i - 1].trim().is_empty() || lines[i - 1].trim().ends_with(['.', '!', '?', ':']))
        {
            closing = Some(
                lines[i..end]
                    .iter()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
            end = i;
            break;
        }
    }
    while end > start && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    let mut body_start = start;
    while body_start < end && lines[body_start].trim().is_empty() {
        body_start += 1;
    }
    Frame {
        greeting,
        body: lines[body_start..end].join("\n"),
        closing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_german_greeting_and_closing() {
        let f = split_frame(
            "Lieber Max,\n\nkannst du morgen um 10 Uhr?\nBitte kurz Bescheid geben.\n\nVG\nPaul\n",
        );
        assert_eq!(f.greeting.as_deref(), Some("Lieber Max,"));
        assert_eq!(
            f.body,
            "kannst du morgen um 10 Uhr?\nBitte kurz Bescheid geben."
        );
        assert_eq!(f.closing.as_deref(), Some("VG\nPaul"));
    }

    #[test]
    fn finds_an_english_frame() {
        let f = split_frame(
            "Hi Anna,\n\nthe report is attached.\n\nBest regards,\nTom Miller\nSenior Analyst",
        );
        assert_eq!(f.greeting.as_deref(), Some("Hi Anna,"));
        assert_eq!(f.body, "the report is attached.");
        assert_eq!(
            f.closing.as_deref(),
            Some("Best regards,\nTom Miller\nSenior Analyst")
        );
    }

    #[test]
    fn a_message_without_a_frame_is_unchanged() {
        let f = split_frame("Ja, passt.");
        assert_eq!(
            f,
            Frame {
                greeting: None,
                body: "Ja, passt.".into(),
                closing: None
            }
        );
    }

    #[test]
    fn a_sentence_that_starts_like_a_closing_stays() {
        let f = split_frame(
            "Danke für die Unterlagen, ich schaue sie mir heute Abend an und melde mich dann.",
        );
        assert_eq!(f.closing, None);
        assert!(f.body.starts_with("Danke für"));
    }

    #[test]
    fn a_sentence_that_starts_like_a_greeting_stays() {
        let f = split_frame("Hallo, ich wollte fragen ob der Termin noch steht. Gruß");
        assert_eq!(f.greeting, None);
    }

    #[test]
    fn a_lone_thanks_is_a_closing() {
        let f = split_frame("Termin passt mir.\n\nDanke!");
        assert_eq!(f.body, "Termin passt mir.");
        assert_eq!(f.closing.as_deref(), Some("Danke!"));
    }

    #[test]
    fn a_closing_phrase_in_the_middle_of_a_paragraph_is_not_cut() {
        let f = split_frame(
            "Bitte schick mir die Zahlen\nvg ist nicht gemeint hier\nund auch noch das andere.",
        );
        assert_eq!(f.closing, None);
    }

    #[test]
    fn handles_empty_text() {
        assert_eq!(
            split_frame(""),
            Frame {
                greeting: None,
                body: String::new(),
                closing: None
            }
        );
        assert_eq!(split_frame("\n\n").body, "");
    }

    #[test]
    fn formal_german() {
        let f = split_frame("Sehr geehrte Damen und Herren,\n\nhiermit kündige ich.\n\nMit freundlichen Grüßen\nPaul Meier");
        assert_eq!(
            f.greeting.as_deref(),
            Some("Sehr geehrte Damen und Herren,")
        );
        assert_eq!(
            f.closing.as_deref(),
            Some("Mit freundlichen Grüßen\nPaul Meier")
        );
        assert_eq!(f.body, "hiermit kündige ich.");
    }
}
