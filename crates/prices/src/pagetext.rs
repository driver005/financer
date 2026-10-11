//! Reading a shop page the way a person would: visible text only.

use regex::Regex;
use std::sync::OnceLock;

/// Visible text and chunking of shop pages.
pub struct PageText;

impl PageText {
    fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
        cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
    }

    /// Strip scripts, styles, comments and tags; decode common entities; collapse whitespace.
    pub fn html_to_text(html: &str) -> String {
        static BLOCKS: OnceLock<Vec<Regex>> = OnceLock::new();
        static COMMENTS: OnceLock<Regex> = OnceLock::new();
        static BREAKS: OnceLock<Regex> = OnceLock::new();
        static TAGS: OnceLock<Regex> = OnceLock::new();
        static SPACE: OnceLock<Regex> = OnceLock::new();

        let t = Self::re(&COMMENTS, r"(?s)<!--.*?-->").replace_all(html, " ");
        // the regex crate has no backreferences, so one pattern per element
        let blocks = BLOCKS.get_or_init(|| {
            ["script", "style", "noscript", "svg"]
                .iter()
                .map(|tag| Regex::new(&format!(r"(?is)<{tag}\b.*?</{tag}>")).expect("valid regex"))
                .collect()
        });
        let mut t = t.into_owned();
        for block in blocks {
            t = block.replace_all(&t, " ").into_owned();
        }
        // block-level ends become line breaks so "Milch 1,19" and the next product stay apart
        let t = Self::re(
            &BREAKS,
            r"(?i)</?(p|div|li|ul|ol|tr|td|th|br|h[1-6]|section|article|span)\b[^>]*>",
        )
        .replace_all(&t, "\n");
        let t = Self::re(&TAGS, r"(?s)<[^>]*>").replace_all(&t, " ");
        let t = Self::decode_entities(&t);
        let t = Self::re(&SPACE, r"[ \t\r\u{a0}]+").replace_all(&t, " ");
        t.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn decode_entities(s: &str) -> String {
        static NUM: OnceLock<Regex> = OnceLock::new();
        let s = s
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&euro;", "€")
            .replace("&szlig;", "ß")
            .replace("&auml;", "ä")
            .replace("&ouml;", "ö")
            .replace("&uuml;", "ü")
            .replace("&Auml;", "Ä")
            .replace("&Ouml;", "Ö")
            .replace("&Uuml;", "Ü");
        Self::re(&NUM, r"&#(\d{1,6});")
            .replace_all(&s, |c: &regex::Captures| {
                c[1].parse::<u32>()
                    .ok()
                    .and_then(char::from_u32)
                    .map(String::from)
                    .unwrap_or_default()
            })
            .into_owned()
    }

    /// Split text into chunks of at most `max_chars`, breaking at line ends.
    pub fn chunks(text: &str, max_chars: usize) -> Vec<String> {
        let mut out = Vec::new();
        let mut cur = String::new();
        for line in text.lines() {
            // a single enormous line is cut hard rather than dropped
            let line: String = line.chars().take(max_chars).collect();
            if cur.chars().count() + line.chars().count() + 1 > max_chars && !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            cur.push_str(&line);
            cur.push('\n');
        }
        if !cur.trim().is_empty() {
            out.push(cur);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_visible_text_only() {
        let html = "<html><head><style>.a{color:red}</style><script>var x=\"1,99\";</script></head>\
<body><!-- hidden 9,99 --><div class=\"p\"><b>Vollmilch</b> 1&nbsp;l</div><div>0,99&nbsp;&euro;</div><p>Fr&uuml;hst&#252;ck</p></body></html>";
        let t = PageText::html_to_text(html);
        assert_eq!(t, "Vollmilch 1 l\n0,99 €\nFrühstück");
        assert!(!t.contains("9,99") && !t.contains("color"));
    }

    #[test]
    fn keeps_products_on_separate_lines() {
        let t = PageText::html_to_text(
            "<ul><li>Butter 250 g 1,79 €</li><li>Eier 10er 2,49 €</li></ul>",
        );
        assert_eq!(t.lines().count(), 2);
    }

    #[test]
    fn chunks_respect_the_limit_and_keep_everything() {
        let text: String = (0..50)
            .map(|i| format!("Produkt {i} 1,{:02} €\n", i))
            .collect();
        let parts = PageText::chunks(&text, 120);
        assert!(parts.len() > 3);
        assert!(parts.iter().all(|p| p.chars().count() <= 121));
        let joined = parts.concat();
        assert!(joined.contains("Produkt 0 ") && joined.contains("Produkt 49 "));
        assert!(PageText::chunks("", 100).is_empty());
        assert_eq!(PageText::chunks(&"x".repeat(500), 100).len(), 1); // one long line is truncated, not lost
    }
}
