//! Writing a message: the RFC 5322 text that goes over SMTP, and the same message as it is stored.

use financer_mail_core::{fresh_text, Address};
use financer_mail_store::NewMessage;
use mail_builder::headers::address::Address as BuilderAddress;
use mail_builder::MessageBuilder;

use crate::parse::snippet_of;

/// What the person wrote, before it is turned into a message.
#[derive(Debug, Clone)]
pub struct Draft {
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    /// Receive a copy without being listed: in the envelope only.
    pub bcc: Vec<Address>,
    pub subject: String,
    /// The final text, with greeting and closing already applied.
    pub body: String,
    /// The Message-ID this answers, and the chain before it.
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
}

/// A message ready to send and to store.
#[derive(Debug, Clone)]
pub struct Composed {
    pub raw: Vec<u8>,
    pub message: NewMessage,
    /// Everyone the server must deliver to (to, cc and bcc).
    pub recipients: Vec<String>,
}

fn builder_address(a: &Address) -> BuilderAddress<'static> {
    BuilderAddress::new_address(a.name.clone(), a.email.clone())
}

fn builder_list(list: &[Address]) -> BuilderAddress<'static> {
    BuilderAddress::new_list(list.iter().map(builder_address).collect())
}

/// A fresh Message-ID in the sender's own domain.
pub fn new_message_id(from: &Address) -> String {
    format!("{}@{}", uuid::Uuid::new_v4().simple(), from.domain())
}

pub fn compose(
    draft: &Draft,
    message_id: &str,
    now: i64,
    folder: &str,
) -> Result<Composed, String> {
    if draft.to.is_empty() && draft.cc.is_empty() && draft.bcc.is_empty() {
        return Err("there is no recipient".into());
    }
    let mut b = MessageBuilder::new()
        .from(builder_address(&draft.from))
        .subject(draft.subject.clone())
        .text_body(draft.body.clone())
        .message_id(message_id.to_string())
        .date(now);
    if !draft.to.is_empty() {
        b = b.to(builder_list(&draft.to));
    }
    if !draft.cc.is_empty() {
        b = b.cc(builder_list(&draft.cc));
    }
    if let Some(parent) = &draft.in_reply_to {
        b = b.in_reply_to(parent.clone());
        let mut chain = draft.references.clone();
        if !chain.contains(parent) {
            chain.push(parent.clone());
        }
        b = b.references(chain);
    }
    let raw = b
        .write_to_vec()
        .map_err(|e| format!("cannot write the message: {e}"))?;

    let mut recipients: Vec<String> = Vec::new();
    for a in draft.to.iter().chain(&draft.cc).chain(&draft.bcc) {
        if !recipients.contains(&a.email) {
            recipients.push(a.email.clone());
        }
    }
    let fresh = fresh_text(&draft.body);
    let message = NewMessage {
        message_id: message_id.to_string(),
        folder: folder.to_string(),
        uid: None,
        in_reply_to: draft.in_reply_to.clone(),
        references: {
            let mut r = draft.references.clone();
            if let Some(p) = &draft.in_reply_to {
                if !r.contains(p) {
                    r.push(p.clone());
                }
            }
            r
        },
        subject: draft.subject.clone(),
        from: draft.from.clone(),
        to: draft.to.clone(),
        cc: draft.cc.clone(),
        sent_at: now,
        body: draft.body.clone(),
        snippet: snippet_of(
            if fresh.text.is_empty() {
                &draft.body
            } else {
                &fresh.text
            },
            140,
        ),
        outgoing: true,
        seen: true,
        automated: false,
    };
    Ok(Composed {
        raw,
        message,
        recipients,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse_message;
    use financer_mail_core::Me;

    fn addr(s: &str) -> Address {
        Address::parse(s).unwrap()
    }

    fn draft() -> Draft {
        Draft {
            from: addr("Paul Meier <paul@example.org>"),
            to: vec![addr("Max Müller <max@y.de>")],
            cc: vec![addr("anna@z.de")],
            bcc: vec![addr("boss@example.org")],
            subject: "Fußball am Samstag".into(),
            body: "Lieber Max,\n\nsamstag um 15 Uhr passt.\n\nVG\nPaul".into(),
            in_reply_to: Some("prev@y.de".into()),
            references: vec!["first@y.de".into()],
        }
    }

    #[test]
    fn the_written_message_reads_back_as_written() {
        let d = draft();
        let c = compose(&d, "id1@example.org", 1_793_697_300, "Sent").unwrap();
        let parsed = parse_message(
            &c.raw,
            "Sent",
            None,
            true,
            &Me::new(["paul@example.org"]),
            0,
        )
        .unwrap()
        .message;
        assert_eq!(parsed.message_id, "id1@example.org");
        assert_eq!(parsed.from.email, "paul@example.org");
        assert_eq!(parsed.from.name.as_deref(), Some("Paul Meier"));
        assert_eq!(parsed.to[0].name.as_deref(), Some("Max Müller"));
        assert_eq!(parsed.cc[0].email, "anna@z.de");
        assert_eq!(parsed.subject, "Fußball am Samstag");
        assert_eq!(parsed.sent_at, 1_793_697_300);
        assert_eq!(parsed.in_reply_to.as_deref(), Some("prev@y.de"));
        assert_eq!(parsed.references, ["first@y.de", "prev@y.de"]);
        assert_eq!(parsed.body.trim_end(), d.body);
    }

    #[test]
    fn bcc_is_in_the_envelope_but_never_in_the_headers() {
        let c = compose(&draft(), "id1@example.org", 0, "Sent").unwrap();
        let text = String::from_utf8_lossy(&c.raw);
        assert!(!text.contains("boss@example.org"), "{text}");
        assert!(!text.to_lowercase().contains("bcc"));
        assert_eq!(c.recipients, ["max@y.de", "anna@z.de", "boss@example.org"]);
    }

    #[test]
    fn the_stored_copy_is_outgoing_and_read() {
        let c = compose(&draft(), "id1@example.org", 42, "Sent").unwrap();
        let m = c.message;
        assert!(m.outgoing && m.seen && !m.automated);
        assert_eq!((m.folder.as_str(), m.uid, m.sent_at), ("Sent", None, 42));
        assert_eq!(m.snippet, "samstag um 15 Uhr passt.");
        assert_eq!(m.references, ["first@y.de", "prev@y.de"]);
    }

    #[test]
    fn a_mail_needs_a_recipient() {
        let mut d = draft();
        d.to.clear();
        d.cc.clear();
        d.bcc.clear();
        assert!(compose(&d, "x@y", 0, "Sent").is_err());
    }

    #[test]
    fn message_ids_are_unique_and_in_the_senders_domain() {
        let a = new_message_id(&addr("paul@example.org"));
        let b = new_message_id(&addr("paul@example.org"));
        assert_ne!(a, b);
        assert!(a.ends_with("@example.org"));
    }
}
