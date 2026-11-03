use financer_mail_core::wire::{ChatMessage, EventInfo};
use financer_mail_core::{fresh_text, normalize_subject};
use financer_mail_store::{EventStatus, StoredEvent, StoredMessage};
use time::PrimitiveDateTime;

/// A stored message as a bubble of a chat.
pub fn chat_message(m: &StoredMessage, events: Vec<EventInfo>) -> ChatMessage {
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
    ChatMessage {
        id: m.id,
        mine: n.outgoing,
        from: n.from.clone(),
        to: n.to.clone(),
        cc: n.cc.clone(),
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

const LOCAL_MINUTES_TEXT: &[time::format_description::BorrowedFormatItem<'static>] = LOCAL_MINUTES;

fn local_text(t: PrimitiveDateTime) -> String {
    t.format(LOCAL_MINUTES_TEXT).unwrap_or_default()
}

/// A stored event as it goes over the wire.
pub fn event_info(e: &StoredEvent) -> EventInfo {
    let ev = &e.event;
    EventInfo {
        id: e.id,
        status: match e.status {
            EventStatus::Cancelled => "cancelled",
            _ => "active",
        }
        .to_string(),
        message: e.message_row,
        uid: ev.uid.clone(),
        title: ev.title.clone(),
        start: local_text(ev.start),
        end: ev.end.map(local_text),
        all_day: ev.all_day,
        location: ev.location.clone(),
        description: ev.description.clone(),
        organizer: ev.organizer.clone(),
        source: match ev.source {
            financer_mail_core::EventSource::Invite => "invite",
            financer_mail_core::EventSource::Text => "text",
            financer_mail_core::EventSource::Manual => "manual",
        }
        .to_string(),
        sequence: ev.sequence,
        cancelled: ev.cancelled,
        recurrence: ev.recurrence.clone(),
        note: ev.note.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use financer_mail_core::Address;
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
