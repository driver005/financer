//! What the API says: conversations and chat messages as the app draws them.

use financer_mail_core::{
    fresh_text, normalize_subject, Address, CalendarEvent, Conversation, ConversationKind,
};
use financer_mail_store::{EventStatus, StoredEvent, StoredMessage};
use serde::{Deserialize, Serialize};
use time::PrimitiveDateTime;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AddressDto {
    pub name: Option<String>,
    pub email: String,
}

impl From<&Address> for AddressDto {
    fn from(a: &Address) -> Self {
        AddressDto {
            name: a.name.clone(),
            email: a.email.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationDto {
    pub key: String,
    pub kind: ConversationKind,
    pub title: String,
    pub people: Vec<AddressDto>,
    pub count: usize,
    pub unread: usize,
    pub last_at: i64,
    pub last_from_me: bool,
    pub preview: String,
    pub topics: Vec<String>,
    pub automated: bool,
}

impl From<&Conversation> for ConversationDto {
    fn from(c: &Conversation) -> Self {
        ConversationDto {
            key: c.key.clone(),
            kind: c.kind,
            title: c.title.clone(),
            people: c.people.iter().map(AddressDto::from).collect(),
            count: c.count,
            unread: c.unread,
            last_at: c.last_at,
            last_from_me: c.last_from_me,
            preview: c.preview.clone(),
            topics: c.topics.clone(),
            automated: c.automated,
        }
    }
}

/// One bubble of a chat.
#[derive(Debug, Clone, Serialize)]
pub struct ChatMessageDto {
    pub id: i64,
    pub mine: bool,
    pub from: AddressDto,
    pub to: Vec<AddressDto>,
    pub cc: Vec<AddressDto>,
    pub at: i64,
    pub subject: String,
    /// The subject without "Re:", the topic this bubble belongs to.
    pub topic: String,
    /// What was said: no quoted chain, no signature, no greeting and closing.
    pub text: String,
    /// A quoted chain or signature was left out.
    pub trimmed: bool,
    pub unread: bool,
    pub events: Vec<EventDto>,
}

pub fn chat_message(m: &StoredMessage, events: Vec<EventDto>) -> ChatMessageDto {
    let n = &m.message;
    let fresh = fresh_text(&n.body);
    // a message that is only a greeting and a closing still shows something
    let text = if !fresh.text.trim().is_empty() {
        fresh.text.clone()
    } else {
        [fresh.greeting.clone(), fresh.closing.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("\n")
    };
    ChatMessageDto {
        id: m.id,
        mine: n.outgoing,
        from: AddressDto::from(&n.from),
        to: n.to.iter().map(AddressDto::from).collect(),
        cc: n.cc.iter().map(AddressDto::from).collect(),
        at: n.sent_at,
        subject: n.subject.clone(),
        topic: normalize_subject(&n.subject),
        text,
        trimmed: fresh.trimmed,
        unread: !n.seen && !n.outgoing,
        events,
    }
}

const LOCAL_MINUTES: &[time::format_description::BorrowedFormatItem<'static>] =
    time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]");
const LOCAL_DATE: &[time::format_description::BorrowedFormatItem<'static>] =
    time::macros::format_description!("[year]-[month]-[day]");

/// `2026-11-05T14:00`, or a bare date `2026-11-05` (then midnight).
pub fn parse_local(s: &str) -> Option<PrimitiveDateTime> {
    let s = s.trim();
    PrimitiveDateTime::parse(s, LOCAL_MINUTES).ok().or_else(|| {
        time::Date::parse(s, LOCAL_DATE)
            .ok()
            .map(|d| PrimitiveDateTime::new(d, time::Time::MIDNIGHT))
    })
}

pub fn parse_day(s: &str) -> Option<time::Date> {
    time::Date::parse(s.trim(), LOCAL_DATE).ok()
}

pub fn day_text(d: time::Date) -> String {
    d.format(LOCAL_DATE).unwrap_or_default()
}

/// An event on the calendar.
#[derive(Debug, Clone, Serialize)]
pub struct EventDto {
    pub id: i64,
    /// `active` or `cancelled`.
    pub status: &'static str,
    /// The message it was found in.
    pub message: Option<i64>,
    #[serde(flatten)]
    pub event: CalendarEvent,
}

impl From<&StoredEvent> for EventDto {
    fn from(e: &StoredEvent) -> Self {
        EventDto {
            id: e.id,
            status: match e.status {
                EventStatus::Cancelled => "cancelled",
                _ => "active",
            },
            message: e.message_row,
            event: e.event.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use financer_mail_store::NewMessage;

    fn stored(body: &str, subject: &str, outgoing: bool, seen: bool) -> StoredMessage {
        StoredMessage {
            id: 5,
            message: NewMessage {
                message_id: "a@x".into(),
                folder: "INBOX".into(),
                uid: Some(1),
                in_reply_to: None,
                references: vec![],
                subject: subject.into(),
                from: Address::parse("Max <max@y.de>").unwrap(),
                to: vec![Address::parse("paul@x.de").unwrap()],
                cc: vec![],
                sent_at: 100,
                body: body.into(),
                snippet: String::new(),
                outgoing,
                seen,
                automated: false,
            },
        }
    }

    #[test]
    fn a_bubble_shows_what_was_said() {
        let m = stored(
            "Hallo Paul,\n\nsamstag passt.\n\nVG Max\n\nAm 1.11. schrieb Paul:\n> Kommst du?",
            "AW: Fußball",
            false,
            false,
        );
        let c = chat_message(&m, vec![]);
        assert_eq!(c.text, "samstag passt.");
        assert_eq!(c.topic, "Fußball");
        assert!(c.trimmed && c.unread && !c.mine);
    }

    #[test]
    fn a_greeting_only_message_still_shows_something() {
        let m = stored("Hallo Paul,\n\nViele Grüße\nMax", "Hi", false, true);
        assert_eq!(
            chat_message(&m, vec![]).text,
            "Hallo Paul,\nViele Grüße\nMax"
        );
    }

    #[test]
    fn my_own_messages_are_never_unread() {
        assert!(!chat_message(&stored("x", "y", true, false), vec![]).unread);
    }

    #[test]
    fn local_times_and_days_parse() {
        assert!(parse_local("2026-11-05T14:00").is_some());
        assert!(parse_local("2026-11-05").is_some());
        assert!(parse_local("05.11.2026").is_none());
        assert_eq!(day_text(parse_day("2026-11-05").unwrap()), "2026-11-05");
    }
}
