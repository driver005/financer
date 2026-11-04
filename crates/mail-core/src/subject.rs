//! Subjects: what the topic of a mail is once `Re:`, `AW:` and `[list]` tags are taken off.

/// Reply and forward prefixes in the languages mail comes in.
const PREFIXES: &[&str] = &[
    "re", "aw", "fwd", "fw", "wg", "antw", "antwort", "sv", "vs", "tr", "rv", "odp", "res",
];

/// The subject without reply/forward prefixes and leading `[tags]`, whitespace collapsed. Case is
/// kept: this is what is shown as the topic.
pub fn normalize_subject(subject: &str) -> String {
    let mut s = collapse(subject);
    loop {
        let before = s.clone();
        s = strip_prefix(&s);
        s = strip_tag(&s);
        if s == before {
            break;
        }
    }
    s
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `Re:`, `AW:`, `Re[2]:`, `RE :`; one at a time.
fn strip_prefix(s: &str) -> String {
    for p in PREFIXES {
        let Some(head) = s.get(..p.len()) else {
            continue;
        };
        if !head.eq_ignore_ascii_case(p) {
            continue;
        }
        let mut rest = &s[p.len()..];
        // an optional counter: Re[2]: or Re(2):
        if rest.starts_with(['[', '(']) {
            if let Some(end) = rest.find([']', ')']) {
                if rest[1..end].chars().all(|c| c.is_ascii_digit()) {
                    rest = &rest[end + 1..];
                }
            }
        }
        if let Some(after) = rest.trim_start().strip_prefix(':') {
            return after.trim_start().to_string();
        }
    }
    s.to_string()
}

/// A leading `[mailing-list]` or `[EXTERN]` tag.
fn strip_tag(s: &str) -> String {
    if let Some(rest) = s.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let tag = &rest[..end];
            let after = rest[end + 1..].trim_start();
            if !after.is_empty()
                && tag.chars().count() <= 24
                && !tag.chars().all(|c| c.is_ascii_digit())
            {
                return after.to_string();
            }
        }
    }
    s.to_string()
}

/// The comparison key of a topic: normalised and lower-case. Empty for a mail without subject.
pub fn topic_key(subject: &str) -> String {
    normalize_subject(subject).to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_reply_and_forward_prefixes_in_german_and_english() {
        for (input, want) in [
            ("Re: Wohnung", "Wohnung"),
            ("AW: Wohnung", "Wohnung"),
            ("Aw: AW: Re: Wohnung", "Wohnung"),
            ("WG: Fwd: Wohnung", "Wohnung"),
            ("RE : Wohnung", "Wohnung"),
            ("Re[2]: Wohnung", "Wohnung"),
            ("Antwort: Wohnung besichtigen", "Wohnung besichtigen"),
            ("SV: Wohnung", "Wohnung"),
        ] {
            assert_eq!(normalize_subject(input), want, "{input}");
        }
    }

    #[test]
    fn leaves_words_that_only_start_like_a_prefix() {
        assert_eq!(normalize_subject("Reise nach Rom"), "Reise nach Rom");
        assert_eq!(normalize_subject("Resümee: Q3"), "Resümee: Q3");
        assert_eq!(normalize_subject("Fwdx: a"), "Fwdx: a");
        assert_eq!(normalize_subject("Re Wohnung"), "Re Wohnung");
    }

    #[test]
    fn strips_a_list_tag_but_not_a_number_in_brackets() {
        assert_eq!(normalize_subject("[Rust-Users] Re: Frage"), "Frage");
        assert_eq!(normalize_subject("Re: [EXTERN] Angebot"), "Angebot");
        assert_eq!(
            normalize_subject("[2024] Jahresbericht"),
            "[2024] Jahresbericht"
        );
    }

    #[test]
    fn collapses_whitespace_and_keeps_case_for_display() {
        assert_eq!(
            normalize_subject("  Re:   Das   Treffen \n am Freitag "),
            "Das Treffen am Freitag"
        );
        assert_eq!(topic_key("Re: Das TREFFEN"), "das treffen");
    }

    #[test]
    fn a_subject_of_only_a_prefix_is_empty() {
        assert_eq!(normalize_subject("Re:"), "");
        assert_eq!(topic_key(""), "");
    }
}
