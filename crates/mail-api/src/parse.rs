//! A downloaded message to what the client stores: addresses, threading headers, the plain text,
//! calendar attachments, and whether it is a machine (newsletter, notification) writing.

use financer_mail_core::{fresh_text, is_automated_sender, Address, Me};
use financer_mail_store::NewMessage;
use financer_receipt_sources::text::sha256_hex;
use mail_parser::MessageParser;

/// A message ready to store, and the invitations that came with it.
#[derive(Debug, Clone)]
pub struct Parsed {
    pub message: NewMessage,
    /// The text of every `text/calendar` part and `.ics` attachment.
    pub calendars: Vec<String>,
}

/// Header lines of the raw message, unfolded; the name is compared without case.
fn raw_header(raw: &[u8], name: &str) -> Option<String> {
    let end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .or_else(|| raw.windows(2).position(|w| w == b"\n\n"))
        .unwrap_or(raw.len());
    let head = String::from_utf8_lossy(&raw[..end]);
    let mut value: Option<String> = None;
    for line in head.lines() {
        if let Some(v) = value.as_mut() {
            if line.starts_with([' ', '\t']) {
                v.push(' ');
                v.push_str(line.trim());
                continue;
            }
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case(name) {
                value = Some(v.trim().to_string());
            }
        }
    }
    value
}

fn addresses(list: Option<mail_parser::AddressList<'_>>) -> Vec<Address> {
    let mut out: Vec<Address> = Vec::new();
    if let Some(list) = list {
        for m in list.mailboxes() {
            if let Some(a) = m.address().and_then(|email| Address::new(m.name(), email)) {
                if !out.iter().any(|o| o.email == a.email) {
                    out.push(a);
                }
            }
        }
    }
    out
}

fn is_calendar_part(content_type: Option<(&str, &str)>, name: Option<&str>) -> bool {
    matches!(content_type, Some((t, s)) if t.eq_ignore_ascii_case("text") && s.eq_ignore_ascii_case("calendar"))
        || name.is_some_and(|n| n.to_lowercase().ends_with(".ics"))
}

/// One line of at most `max` characters from the start of `text`.
pub fn snippet_of(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        flat
    } else {
        let cut: String = flat.chars().take(max).collect();
        format!("{}…", cut.trim_end())
    }
}

/// Parses a raw message. `None` when it has no usable sender, which no chat could show.
pub fn parse_message(
    raw: &[u8],
    folder: &str,
    uid: Option<u32>,
    outgoing: bool,
    me: &Me,
    now: i64,
) -> Option<Parsed> {
    let msg = MessageParser::default().parse(raw)?;
    let from = addresses(msg.from()).into_iter().next()?;
    let message_id = match msg.message_id() {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => format!("generated-{}@financer.local", &sha256_hex(raw)[..24]),
    };
    let body = msg
        .body_text(0)
        .map(|t| t.replace("\r\n", "\n"))
        .unwrap_or_default();
    let fresh = fresh_text(&body);
    let snippet_source = if fresh.text.is_empty() {
        body.as_str()
    } else {
        fresh.text.as_str()
    };
    let snippet = snippet_of(snippet_source, 140);

    let mut calendars = Vec::new();
    for part in msg.attachments() {
        let ct = part.content_type();
        let pair = ct.as_ref().map(|c| (c.ctype(), c.subtype().unwrap_or("")));
        if is_calendar_part(pair, part.attachment_name()) {
            let text = String::from_utf8_lossy(&part.decoded()).into_owned();
            if text.contains("BEGIN:VCALENDAR") || text.contains("BEGIN:VEVENT") {
                calendars.push(text);
            }
        }
    }

    let precedence = raw_header(raw, "precedence").map(|v| v.to_lowercase());
    let auto_submitted = raw_header(raw, "auto-submitted").map(|v| v.to_lowercase());
    let automated = !outgoing
        && (raw_header(raw, "list-unsubscribe").is_some()
            || raw_header(raw, "list-id").is_some()
            || precedence.is_some_and(|p| matches!(p.as_str(), "bulk" | "list" | "junk"))
            || auto_submitted.is_some_and(|a| a != "no")
            || is_automated_sender(&from.email));

    let references: Vec<String> = msg
        .references()
        .map(|l| l.iter().map(str::to_string).collect())
        .unwrap_or_default();
    let in_reply_to = msg
        .in_reply_to()
        .and_then(|l| l.first().map(str::to_string));
    let sent_at = msg.date().map(|d| d.to_timestamp()).unwrap_or(now);
    Some(Parsed {
        message: NewMessage {
            message_id,
            folder: folder.to_string(),
            uid,
            in_reply_to,
            references,
            subject: msg.subject().unwrap_or("").to_string(),
            outgoing: outgoing || me.is_me(&from),
            to: addresses(msg.to()),
            cc: addresses(msg.cc()),
            from,
            sent_at,
            body,
            snippet,
            seen: false,
            automated,
        },
        calendars,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn me() -> Me {
        Me::new(["paul@example.org"])
    }

    const PLAIN: &str = "From: =?UTF-8?Q?Max_M=C3=BCller?= <Max@Example.com>\r\nTo: Paul <paul@example.org>, anna@y.de\r\nCc: tom@z.de\r\nSubject: =?UTF-8?Q?Re:_Fu=C3=9Fball_am_Samstag?=\r\nDate: Tue, 03 Nov 2026 10:15:00 +0100\r\nMessage-ID: <abc.1@example.com>\r\nIn-Reply-To: <prev.2@example.org>\r\nReferences: <first.0@example.org> <prev.2@example.org>\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nHallo Paul,\r\n\r\nsamstag um 15 Uhr passt.\r\n\r\nLG Max\r\n\r\nAm 02.11.2026 um 09:00 schrieb Paul:\r\n> Kommst du?\r\n";

    #[test]
    fn reads_headers_and_the_new_text() {
        let p = parse_message(PLAIN.as_bytes(), "INBOX", Some(12), false, &me(), 0).unwrap();
        let m = &p.message;
        assert_eq!(m.message_id, "abc.1@example.com");
        assert_eq!(m.from.email, "max@example.com");
        assert_eq!(m.from.name.as_deref(), Some("Max Müller"));
        assert_eq!(
            m.to.iter().map(|a| a.email.as_str()).collect::<Vec<_>>(),
            ["paul@example.org", "anna@y.de"]
        );
        assert_eq!(m.cc[0].email, "tom@z.de");
        assert_eq!(m.subject, "Re: Fußball am Samstag");
        assert_eq!(m.in_reply_to.as_deref(), Some("prev.2@example.org"));
        assert_eq!(m.references, ["first.0@example.org", "prev.2@example.org"]);
        assert_eq!(m.sent_at, 1_793_697_300);
        assert_eq!(m.snippet, "samstag um 15 Uhr passt.");
        assert!(!m.outgoing && !m.automated && !m.seen);
        assert_eq!((m.folder.as_str(), m.uid), ("INBOX", Some(12)));
        assert!(m.body.contains("Kommst du?"), "the original text is kept");
    }

    #[test]
    fn a_message_from_one_of_my_addresses_is_outgoing() {
        let raw = "From: Paul <paul@example.org>\r\nTo: max@y.de\r\nSubject: x\r\nMessage-ID: <o@x>\r\n\r\nhi";
        assert!(
            parse_message(raw.as_bytes(), "Sent", Some(1), true, &me(), 0)
                .unwrap()
                .message
                .outgoing
        );
        assert!(
            parse_message(raw.as_bytes(), "INBOX", Some(1), false, &me(), 0)
                .unwrap()
                .message
                .outgoing,
            "a copy of my own mail in the inbox"
        );
    }

    #[test]
    fn newsletters_and_notifications_are_automated() {
        for extra in [
            "List-Unsubscribe: <mailto:u@x.de>",
            "Precedence: bulk",
            "Auto-Submitted: auto-generated",
            "List-Id: <news.x.de>",
        ] {
            let raw = format!("From: Shop <shop@x.de>\r\nTo: paul@example.org\r\nSubject: Angebote\r\nMessage-ID: <n@x>\r\n{extra}\r\n\r\nSale!");
            assert!(
                parse_message(raw.as_bytes(), "INBOX", Some(1), false, &me(), 0)
                    .unwrap()
                    .message
                    .automated,
                "{extra}"
            );
        }
        let raw = "From: noreply@bank.de\r\nTo: paul@example.org\r\nSubject: Login\r\nMessage-ID: <n@x>\r\n\r\ncode";
        assert!(
            parse_message(raw.as_bytes(), "INBOX", Some(1), false, &me(), 0)
                .unwrap()
                .message
                .automated
        );
        let raw = "From: Max <max@y.de>\r\nTo: paul@example.org\r\nSubject: Hi\r\nMessage-ID: <n@x>\r\nAuto-Submitted: no\r\n\r\nhi";
        assert!(
            !parse_message(raw.as_bytes(), "INBOX", Some(1), false, &me(), 0)
                .unwrap()
                .message
                .automated
        );
    }

    #[test]
    fn finds_the_invitation_in_a_calendar_part_and_in_an_ics_attachment() {
        let ics = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:u1\r\nDTSTART:20261105T130000Z\r\nSUMMARY:Kickoff\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let alt = format!("From: Anna <anna@y.de>\r\nTo: paul@example.org\r\nSubject: Einladung\r\nMessage-ID: <i@x>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"b\"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSiehe Einladung.\r\n--b\r\nContent-Type: text/calendar; method=REQUEST; charset=utf-8\r\n\r\n{ics}--b--\r\n");
        let p = parse_message(alt.as_bytes(), "INBOX", Some(1), false, &me(), 0).unwrap();
        assert_eq!(p.calendars.len(), 1, "text/calendar alternative");
        assert!(p.calendars[0].contains("UID:u1"));
        let mixed = format!("From: Anna <anna@y.de>\r\nTo: paul@example.org\r\nSubject: Einladung\r\nMessage-ID: <i2@x>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b\"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSiehe Anhang.\r\n--b\r\nContent-Type: application/octet-stream; name=\"invite.ics\"\r\nContent-Disposition: attachment; filename=\"invite.ics\"\r\n\r\n{ics}--b--\r\n");
        let p = parse_message(mixed.as_bytes(), "INBOX", Some(1), false, &me(), 0).unwrap();
        assert_eq!(p.calendars.len(), 1, ".ics attachment");
    }

    #[test]
    fn html_only_mail_gets_a_text_body() {
        let raw = "From: Anna <anna@y.de>\r\nTo: paul@example.org\r\nSubject: Hi\r\nMessage-ID: <h@x>\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body><p>Hallo <b>Paul</b></p><p>bis morgen</p></body></html>";
        let p = parse_message(raw.as_bytes(), "INBOX", Some(1), false, &me(), 0).unwrap();
        assert!(
            p.message.body.contains("Hallo") && p.message.body.contains("bis morgen"),
            "{:?}",
            p.message.body
        );
        assert!(!p.message.body.contains("<p>"));
    }

    #[test]
    fn a_missing_message_id_gets_a_stable_one_and_a_missing_date_the_clock() {
        let raw = "From: Anna <anna@y.de>\r\nTo: paul@example.org\r\nSubject: Hi\r\n\r\nx";
        let a = parse_message(raw.as_bytes(), "INBOX", Some(1), false, &me(), 777).unwrap();
        let b = parse_message(raw.as_bytes(), "INBOX", Some(2), false, &me(), 888).unwrap();
        assert_eq!(a.message.message_id, b.message.message_id);
        assert!(a.message.message_id.starts_with("generated-"));
        assert_eq!(a.message.sent_at, 777);
    }

    #[test]
    fn a_message_without_a_sender_is_skipped() {
        assert!(
            parse_message(b"Subject: x\r\n\r\nbody", "INBOX", Some(1), false, &me(), 0).is_none()
        );
        assert!(parse_message(b"", "INBOX", Some(1), false, &me(), 0).is_none());
    }

    #[test]
    fn snippets_are_one_short_line() {
        assert_eq!(snippet_of("a\n\nb   c", 10), "a b c");
        assert_eq!(
            snippet_of(&"x".repeat(50), 10),
            format!("{}…", "x".repeat(10))
        );
    }
}
