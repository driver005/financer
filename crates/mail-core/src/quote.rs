//! What the person actually wrote: the message without the reply chain quoted below it, without
//! the signature, and without the greeting and closing around it.
//!
//! Mail clients quote in a handful of ways (`>` prefixes, "On ... wrote:", "Am ... schrieb ...:",
//! Outlook's "-----Original Message-----" and "Von: ... Gesendet: ..." blocks). A reply written
//! between the quoted lines (inline) keeps its own lines and loses only the quoted ones.

use crate::frame::{split_frame, Frame};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fresh {
    /// The new text, without quotes, signature, greeting and closing.
    pub text: String,
    pub greeting: Option<String>,
    pub closing: Option<String>,
    /// True when a quoted reply chain or signature was cut away.
    pub trimmed: bool,
}

fn is_attribution(line: &str, next: Option<&str>) -> bool {
    let l = line.trim().to_lowercase();
    if l.is_empty() {
        return false;
    }
    let looks = |s: &str| {
        let s = s.trim();
        s.ends_with(':')
            && ((s.starts_with("on ") && (s.contains(" wrote") || s.contains(" sent")))
                || (s.starts_with("am ") && s.contains(" schrieb"))
                || (s.starts_with("le ") && s.contains(" a écrit"))
                || (s.starts_with("el ") && s.contains(" escribió"))
                || s.ends_with("wrote:")
                || s.ends_with("schrieb:")
                || s.contains("schrieb am ")
                || s.contains("hat am ") && s.ends_with("geschrieben:"))
    };
    if looks(&l) {
        return true;
    }
    // the attribution wrapped over two lines
    match next {
        Some(n) if (l.starts_with("on ") || l.starts_with("am ")) && !l.ends_with(':') => {
            looks(&format!("{l} {}", n.trim().to_lowercase()))
        }
        _ => false,
    }
}

fn marker_text(line: &str) -> Option<String> {
    let l = line.trim().to_lowercase();
    let decorated = l.starts_with("--") || l.starts_with("__") || l.starts_with("**");
    let inner = l.trim_matches(['-', '_', ' ', '*']).to_string();
    decorated.then_some(inner)
}

/// "-----Original Message-----" and the like: the old chain starts here.
fn is_original_marker(line: &str) -> bool {
    let l = line.trim().to_lowercase();
    marker_text(line).is_some_and(|m| {
        matches!(
            m.as_str(),
            "original message"
                | "ursprüngliche nachricht"
                | "urspruengliche nachricht"
                | "originalnachricht"
                | "original-nachricht"
                | "reply message"
        )
    }) || (l.len() >= 20 && l.chars().all(|c| c == '_'))
}

/// "---------- Forwarded message ----------": what follows is the content, after a header block.
fn is_forward_marker(line: &str) -> bool {
    marker_text(line).is_some_and(|m| {
        matches!(
            m.as_str(),
            "forwarded message" | "weitergeleitete nachricht"
        )
    })
}

fn is_header_line(line: &str) -> bool {
    let l = line.trim().to_lowercase();
    [
        "from:",
        "to:",
        "cc:",
        "subject:",
        "date:",
        "sent:",
        "von:",
        "an:",
        "betreff:",
        "datum:",
        "gesendet:",
    ]
    .iter()
    .any(|k| l.starts_with(k))
}

/// `Von: ...` followed within a few lines by `Gesendet:`/`Datum:`/`An:` (an Outlook header block).
fn is_header_block(lines: &[&str], i: usize) -> bool {
    let first = lines[i].trim().to_lowercase();
    let (key, others): (&str, &[&str]) = if first.starts_with("von:") {
        ("von:", &["gesendet:", "datum:", "an:", "betreff:"])
    } else if first.starts_with("from:") {
        ("from:", &["sent:", "date:", "to:", "subject:"])
    } else {
        return false;
    };
    let _ = key;
    lines[i + 1..].iter().take(4).any(|l| {
        others
            .iter()
            .any(|o| l.trim().to_lowercase().starts_with(o))
    })
}

fn is_quoted(line: &str) -> bool {
    line.trim_start().starts_with('>')
}

/// RFC 3676 signature separator: `-- ` (or `--`) on a line of its own.
fn is_signature_separator(line: &str) -> bool {
    matches!(
        line.trim_end_matches(['\r', '\n']),
        "-- " | "--" | "—" | "___"
    )
}

pub fn fresh_text(body: &str) -> Fresh {
    let body = body.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = body.lines().collect();
    let mut kept: Vec<&str> = Vec::new();
    let mut trimmed = false;
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if is_signature_separator(line) {
            trimmed = true;
            break;
        }
        if is_forward_marker(line) {
            i += 1;
            while i < lines.len() && is_header_line(lines[i]) {
                i += 1;
            }
            continue;
        }
        if is_original_marker(line) || (i > 0 && is_header_block(&lines, i)) {
            // everything after an "original message" marker is the old chain
            trimmed = true;
            break;
        }
        if is_attribution(line, lines.get(i + 1).copied()) {
            trimmed = true;
            // skip the attribution (one or two lines) and the quoted block that follows
            i += if line.trim().ends_with(':') { 1 } else { 2 };
            while i < lines.len() && (is_quoted(lines[i]) || lines[i].trim().is_empty()) {
                i += 1;
            }
            continue;
        }
        if is_quoted(line) {
            trimmed = true;
            i += 1;
            continue;
        }
        kept.push(line);
        i += 1;
    }
    let joined = squeeze(&kept);
    let Frame {
        greeting,
        body,
        closing,
    } = split_frame(&joined);
    Fresh {
        text: body,
        greeting,
        closing,
        trimmed,
    }
}

/// Trim blank lines at both ends and collapse runs of more than one blank line.
fn squeeze(lines: &[&str]) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut blank = 0;
    for l in lines {
        if l.trim().is_empty() {
            blank += 1;
            if blank <= 1 && !out.is_empty() {
                out.push("");
            }
        } else {
            blank = 0;
            out.push(l.trim_end());
        }
    }
    while out.last().is_some_and(|l| l.is_empty()) {
        out.pop();
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_an_english_quoted_reply() {
        let f = fresh_text("Sounds good, see you then.\n\nOn Mon, Nov 2, 2026 at 9:00 AM Anna Berg <anna@x.de> wrote:\n> Are you free on Friday?\n> Let me know.\n");
        assert_eq!(f.text, "Sounds good, see you then.");
        assert!(f.trimmed);
    }

    #[test]
    fn cuts_a_german_quoted_reply() {
        let f = fresh_text("Freitag passt.\n\nAm 02.11.2026 um 09:00 schrieb Anna Berg <anna@x.de>:\n> Hast du Freitag Zeit?\n");
        assert_eq!(f.text, "Freitag passt.");
    }

    #[test]
    fn cuts_an_attribution_wrapped_over_two_lines() {
        let f = fresh_text("Ja!\n\nAm 02.11.2026 um 09:00 schrieb Anna Maria\nBerg-Schmidt <anna@x.de>:\n> Hast du Zeit?\n");
        assert_eq!(f.text, "Ja!");
    }

    #[test]
    fn cuts_outlook_original_message_and_header_blocks() {
        let f = fresh_text("Danke, erledigt.\n\n-----Original Message-----\nFrom: A\nSent: Monday\nSubject: x\n\nold text");
        assert_eq!(f.text, "Danke, erledigt.");
        let f = fresh_text("Erledigt.\n\nVon: Anna Berg\nGesendet: Montag, 2. November 2026 09:00\nAn: Paul\nBetreff: Hilfe\n\nalter Text");
        assert_eq!(f.text, "Erledigt.");
        assert!(f.trimmed);
    }

    #[test]
    fn keeps_inline_answers_between_quoted_lines() {
        let f = fresh_text("> Kommst du Freitag?\nJa, gern.\n> Und Samstag?\nSamstag nicht.\n");
        assert_eq!(f.text, "Ja, gern.\nSamstag nicht.");
        assert!(f.trimmed);
    }

    #[test]
    fn keeps_bottom_posted_text() {
        let f = fresh_text("On Mon, Anna wrote:\n> old\n\nMy answer below.\n");
        assert_eq!(f.text, "My answer below.");
    }

    #[test]
    fn drops_the_signature() {
        let f = fresh_text("Ich bin dabei.\n\n-- \nPaul Meier\nMusterstraße 1\n");
        assert_eq!(f.text, "Ich bin dabei.");
        assert!(f.trimmed);
    }

    #[test]
    fn separates_greeting_and_closing_from_the_text() {
        let f = fresh_text(
            "Hallo Paul,\n\nder Termin steht.\n\nViele Grüße\nAnna\n\nOn Mon, Paul wrote:\n> hi\n",
        );
        assert_eq!(f.greeting.as_deref(), Some("Hallo Paul,"));
        assert_eq!(f.text, "der Termin steht.");
        assert_eq!(f.closing.as_deref(), Some("Viele Grüße\nAnna"));
    }

    #[test]
    fn a_forward_keeps_the_forwarded_text() {
        let f = fresh_text("---------- Forwarded message ----------\nFrom: x\nSubject: y\n\nDie Rechnung im Anhang.");
        assert!(f.text.contains("Die Rechnung"), "{f:?}");
    }

    #[test]
    fn a_mail_made_only_of_a_quote_has_no_fresh_text() {
        let f = fresh_text("> alles zitiert\n> noch mehr\n");
        assert_eq!(f.text, "");
        assert!(f.trimmed);
    }

    #[test]
    fn windows_line_endings_and_blank_runs() {
        let f = fresh_text("Eins\r\n\r\n\r\n\r\nZwei\r\n");
        assert_eq!(f.text, "Eins\n\nZwei");
    }

    #[test]
    fn plain_text_is_untouched() {
        let f = fresh_text("Kurz und gut.");
        assert_eq!(f.text, "Kurz und gut.");
        assert!(!f.trimmed);
    }
}
