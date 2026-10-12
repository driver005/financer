//! Receipt documents inside an email: PDF attachments, HTML/text attachments and the body.

use mail_parser::{MessageParser, MimeHeaders};
use time::{Date, Month};

use crate::text::html_to_text;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocKind {
    Pdf,
    Html,
    Text,
}

/// One attachment that may be a receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    /// File name, for messages and logs.
    pub name: String,
    pub kind: DocKind,
    pub data: Vec<u8>,
}

/// What matters of a mail.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedMail {
    pub from: Option<String>,
    pub subject: Option<String>,
    pub date: Option<Date>,
    pub attachments: Vec<Attachment>,
    /// Body as plain lines (HTML converted), when there is one.
    pub body: Option<String>,
}

/// Deepest message-in-message nesting followed (a forwarded mail attached to a mail).
const MAX_DEPTH: u8 = 3;

pub struct MailReader;

impl MailReader {
    /// Sender, subject and date from a header block (or a whole message).
    pub fn headers(raw: &[u8]) -> Option<ParsedMail> {
        let msg = MessageParser::default().parse(raw)?;
        Some(ParsedMail {
            from: Self::from_of(&msg),
            subject: msg.subject().map(str::to_string),
            date: Self::date_of(&msg),
            ..Default::default()
        })
    }

    fn from_of(msg: &mail_parser::Message<'_>) -> Option<String> {
        msg.from()
            .and_then(|a| a.first())
            .and_then(|a| a.address())
            .map(str::to_string)
    }

    fn date_of(msg: &mail_parser::Message<'_>) -> Option<Date> {
        let d = msg.date()?;
        Date::from_calendar_date(
            i32::from(d.year),
            Month::try_from(d.month).ok()?,
            d.day,
        )
        .ok()
    }

    /// Everything that may hold a receipt.
    pub fn parse(raw: &[u8]) -> Option<ParsedMail> {
        Self::parse_depth(raw, 0)
    }

    fn parse_depth(raw: &[u8], depth: u8) -> Option<ParsedMail> {
        let msg = MessageParser::default().parse(raw)?;
        let mut out = ParsedMail {
            from: Self::from_of(&msg),
            subject: msg.subject().map(str::to_string),
            date: Self::date_of(&msg),
            ..Default::default()
        };
        for (n, part) in msg.attachments().enumerate() {
            if let Some(inner) = part.message() {
                if depth < MAX_DEPTH {
                    if let Some(nested) = Self::parse_depth(inner.raw_message(), depth + 1) {
                        out.attachments.extend(nested.attachments);
                        if out.body.is_none() {
                            out.body = nested.body;
                        }
                    }
                }
                continue;
            }
            let name = part
                .attachment_name()
                .map(str::to_string)
                .unwrap_or_else(|| format!("attachment-{}", n + 1));
            let lower = name.to_lowercase();
            let (ctype, subtype) = part
                .content_type()
                .map(|c| {
                    (
                        c.ctype().to_lowercase(),
                        c.subtype().unwrap_or("").to_lowercase(),
                    )
                })
                .unwrap_or_default();
            let kind = if subtype == "pdf" || lower.ends_with(".pdf") {
                DocKind::Pdf
            } else if subtype == "html" || lower.ends_with(".html") || lower.ends_with(".htm") {
                DocKind::Html
            } else if (ctype == "text" && subtype == "plain") || lower.ends_with(".txt") {
                DocKind::Text
            } else {
                continue;
            };
            out.attachments.push(Attachment {
                name,
                kind,
                data: part.contents().to_vec(),
            });
        }
        out.body = out.body.or_else(|| {
            let body = match msg.body_html(0) {
                Some(html) => html_to_text(&html),
                None => msg.body_text(0).map(|t| t.into_owned()).unwrap_or_default(),
            };
            (!body.trim().is_empty()).then_some(body)
        });
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{make_pdf, MailBuilder};
    use time::macros::date;

    #[test]
    fn finds_pdf_attachment_and_ignores_images_and_signature_files() {
        let raw = MailBuilder::new("REWE eBon <ebon@mailing.rewe.de>", "Ihr REWE eBon")
            .text("Anbei Ihr eBon.")
            .attach("ebon.pdf", "application/pdf", make_pdf(&["REWE", "MILCH 1,09 B"]))
            .attach("logo.png", "image/png", vec![0x89, b'P', b'N', b'G'])
            .attach("smime.p7s", "application/pkcs7-signature", vec![1, 2, 3])
            .build();
        let m = MailReader::parse(&raw).unwrap();
        assert_eq!(m.from.as_deref(), Some("ebon@mailing.rewe.de"));
        assert_eq!(m.subject.as_deref(), Some("Ihr REWE eBon"));
        assert_eq!(m.date, Some(date!(2026 - 03 - 02)));
        assert_eq!(m.attachments.len(), 1);
        assert_eq!(m.attachments[0].kind, DocKind::Pdf);
        assert!(m.attachments[0].data.starts_with(b"%PDF"));
        assert_eq!(m.body.as_deref(), Some("Anbei Ihr eBon."));
    }

    #[test]
    fn html_body_is_converted_and_preferred_over_text() {
        let raw = MailBuilder::new("kassenbon@lidl.de", "Ihr Kassenbon")
            .text("alternative text")
            .html("<p>Lidl</p><table><tr><td>Milch</td><td>1,09 B</td></tr></table>")
            .build();
        let m = MailReader::parse(&raw).unwrap();
        assert_eq!(m.body.as_deref(), Some("Lidl\nMilch 1,09 B"));
        assert!(m.attachments.is_empty());
    }

    #[test]
    fn html_and_text_attachments_and_forwarded_messages() {
        let inner = MailBuilder::new("ebon@rewe.de", "eBon")
            .attach("bon.pdf", "application/pdf", make_pdf(&["REWE"]))
            .build();
        let raw = MailBuilder::new("me@example.org", "Fwd: eBon")
            .attach("bon.html", "text/html", b"<p>x</p>".to_vec())
            .attach("bon.txt", "text/plain", b"REWE".to_vec())
            .attach("forwarded.eml", "message/rfc822", inner)
            .build();
        let m = MailReader::parse(&raw).unwrap();
        let kinds: Vec<_> = m.attachments.iter().map(|a| a.kind).collect();
        assert_eq!(kinds, vec![DocKind::Html, DocKind::Text, DocKind::Pdf]);
    }

    #[test]
    fn headers_only_input_gives_sender_and_subject() {
        let raw = MailBuilder::new("a@b.de", "Betreff äöü").text("x").build();
        let end = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        let h = MailReader::headers(&raw[..end]).unwrap();
        assert_eq!(h.from.as_deref(), Some("a@b.de"));
        assert_eq!(h.subject.as_deref(), Some("Betreff äöü"));
        assert!(MailReader::parse(b"").is_none());
    }
}
