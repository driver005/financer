//! Turning documents into receipt text: HTML to plain lines, PDF to text, content hashes.

use sha2::{Digest, Sha256};

/// Largest PDF handed to the extractor.
pub const MAX_PDF_BYTES: usize = 10 * 1024 * 1024;

/// Lowercase hex SHA-256.
pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Plain text from an HTML document: tags removed, block ends become line breaks, table cells are
/// separated by spaces, common entities decoded.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            // comments, scripts and styles are dropped with their content
            if lower[i..].starts_with("<!--") {
                i = lower[i..].find("-->").map_or(bytes.len(), |e| i + e + 3);
                continue;
            }
            let Some(end) = lower[i..].find('>') else {
                break;
            };
            let tag = &lower[i + 1..i + end];
            let name: String = tag
                .trim_start_matches('/')
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect();
            let closing = tag.starts_with('/');
            if !closing && matches!(name.as_str(), "script" | "style" | "head") {
                let close = format!("</{name}");
                i = match lower[i..].find(&close) {
                    Some(e) => lower[i + e..].find('>').map_or(bytes.len(), |g| i + e + g + 1),
                    None => bytes.len(),
                };
                continue;
            }
            match (name.as_str(), closing) {
                ("br", _) | ("hr", _) => out.push('\n'),
                ("p" | "div" | "tr" | "li" | "table" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6", true) => {
                    out.push('\n')
                }
                ("p" | "div" | "tr" | "li", false) => out.push('\n'),
                ("td" | "th", true) => out.push_str("  "),
                _ => {}
            }
            i += end + 1;
        } else {
            let next = html[i..].find('<').map_or(bytes.len(), |p| i + p);
            out.push_str(&decode_entities(&html[i..next]));
            i = next;
        }
    }
    clean_lines(&out)
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        rest = &rest[p..];
        let decoded = rest.find(';').filter(|e| *e <= 10).and_then(|e| {
            let name = &rest[1..e];
            let c = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                "euro" => Some('€'),
                "auml" => Some('ä'),
                "ouml" => Some('ö'),
                "uuml" => Some('ü'),
                "Auml" => Some('Ä'),
                "Ouml" => Some('Ö'),
                "Uuml" => Some('Ü'),
                "szlig" => Some('ß'),
                "middot" => Some('·'),
                "ndash" => Some('–'),
                n if n.starts_with("#x") || n.starts_with("#X") => {
                    u32::from_str_radix(&n[2..], 16).ok().and_then(char::from_u32)
                }
                n if n.starts_with('#') => n[1..].parse().ok().and_then(char::from_u32),
                _ => None,
            };
            c.map(|c| (c, e))
        });
        match decoded {
            Some((c, e)) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Trim every line, collapse runs of blanks inside lines and drop empty lines.
fn clean_lines(text: &str) -> String {
    text.lines()
        .map(|l| {
            l.replace(['\u{a0}', '\t'], " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Why a PDF yielded no text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PdfError {
    #[error("the PDF is larger than 10 MB")]
    TooLarge,
    #[error("the PDF could not be read")]
    Unreadable,
    #[error("the PDF has no text layer (a scan?); photograph it in the app instead")]
    NoText,
}

/// Text layer of a PDF, line by line. Runs the (third-party, panic-prone on odd files) extractor
/// on a blocking thread and treats a panic as "unreadable".
pub async fn pdf_to_text(bytes: Vec<u8>) -> Result<String, PdfError> {
    if bytes.len() > MAX_PDF_BYTES {
        return Err(PdfError::TooLarge);
    }
    let joined = tokio::task::spawn_blocking(move || {
        std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(&bytes))
    })
    .await
    .map_err(|_| PdfError::Unreadable)?;
    match joined {
        Ok(Ok(text)) => {
            let text = clean_lines(&text);
            if text.chars().filter(|c| c.is_alphanumeric()).count() < 8 {
                Err(PdfError::NoText)
            } else {
                Ok(text)
            }
        }
        _ => Err(PdfError::Unreadable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_becomes_lines_with_cells_apart() {
        let html = "<html><head><style>td{color:red}</style><title>x</title></head><body>\
            <h2>REWE Markt GmbH</h2><table>\
            <tr><td>BIO VOLLMILCH</td><td>1,19&nbsp;B</td></tr>\
            <tr><td>K&auml;se &amp; Co</td><td>2,49 B</td></tr></table>\
            <!-- hidden --><p>SUMME<br>3,68 &euro;</p><script>var x = '<b>';</script></body></html>";
        assert_eq!(
            html_to_text(html),
            "REWE Markt GmbH\nBIO VOLLMILCH 1,19 B\nKäse & Co 2,49 B\nSUMME\n3,68 €"
        );
    }

    #[test]
    fn numeric_entities_and_stray_ampersands() {
        assert_eq!(html_to_text("a &#228; &#xFC; b&c &bogus; &"), "a ä ü b&c &bogus; &");
    }

    #[test]
    fn unterminated_markup_does_not_loop_or_panic() {
        assert_eq!(html_to_text("Milch 1,09 <b"), "Milch 1,09");
        assert_eq!(html_to_text("<script>never closed"), "");
        assert_eq!(html_to_text(""), "");
    }

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[tokio::test]
    async fn garbage_and_oversized_pdfs_are_errors_not_panics() {
        assert_eq!(
            pdf_to_text(b"not a pdf".to_vec()).await,
            Err(PdfError::Unreadable)
        );
        assert_eq!(
            pdf_to_text(vec![0; MAX_PDF_BYTES + 1]).await,
            Err(PdfError::TooLarge)
        );
        assert_eq!(
            pdf_to_text(b"%PDF-1.4\n%%EOF".to_vec()).await,
            Err(PdfError::Unreadable)
        );
    }
}
