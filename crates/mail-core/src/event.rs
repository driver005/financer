//! Calendar events found in a message: the invitation attached to it (exact), or an appointment
//! written in the text (a guess, marked as one so the person can check it).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{Date, Duration, PrimitiveDateTime};

use crate::ics::{parse_calendar, IcsEvent, IcsTime};
use crate::subject::{normalize_subject, topic_key};
use crate::when::find_mentions;
use crate::zone::Zone;

time::serde::format_description!(
    local_minutes,
    PrimitiveDateTime,
    "[year]-[month]-[day]T[hour]:[minute]"
);
mod opt_local_minutes {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use time::PrimitiveDateTime;

    pub fn serialize<S: Serializer>(
        v: &Option<PrimitiveDateTime>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct W<'a>(#[serde(with = "super::local_minutes")] &'a PrimitiveDateTime);
        v.as_ref().map(W).serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<PrimitiveDateTime>, D::Error> {
        #[derive(Deserialize)]
        struct W(#[serde(with = "super::local_minutes")] PrimitiveDateTime);
        Ok(Option::<W>::deserialize(d)?.map(|w| w.0))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventSource {
    /// An iCalendar invitation: times and place are as the organiser sent them.
    Invite,
    /// An appointment found in a sentence.
    Text,
    /// Added by hand.
    Manual,
}

/// An appointment, in the wall-clock time of the person who owns the mailbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarEvent {
    /// The invitation's UID, or a hash for one found in text: the same appointment mentioned again
    /// (a reply, a reminder, an updated invitation) is the same event.
    pub uid: String,
    pub title: String,
    #[serde(with = "local_minutes")]
    pub start: PrimitiveDateTime,
    #[serde(with = "opt_local_minutes", default)]
    pub end: Option<PrimitiveDateTime>,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
    pub organizer: Option<String>,
    pub source: EventSource,
    pub sequence: i64,
    pub cancelled: bool,
    /// A repeating event's rule, as sent. Only the first occurrence is listed.
    pub recurrence: Option<String>,
    /// Something the person should know about the time (a zone that could not be converted).
    pub note: Option<String>,
}

/// What event extraction reads from a message.
pub struct MessageText<'a> {
    pub subject: &'a str,
    /// The new text of the message (see [`crate::fresh_text`]), not the quoted chain.
    pub body: &'a str,
    /// When it was written (seconds since the epoch), for "tomorrow" and "Friday".
    pub date: i64,
    /// The text of every `text/calendar` part and `.ics` attachment.
    pub calendars: &'a [String],
}

/// Words that make a bare date an appointment.
const TRIGGERS: &[&str] = &[
    "termin",
    "meeting",
    "treffen",
    "einladung",
    "invitation",
    "appointment",
    "reservierung",
    "reservation",
    "besprechung",
    "party",
    "feier",
    "hochzeit",
    "konzert",
    "webinar",
    "workshop",
    "call",
    "sprechstunde",
    "vorstellungsgespräch",
    "interview",
    "geburtstag",
    "essen",
];

/// Words that make a date a deadline, not an appointment.
const DEADLINES: &[&str] = &[
    "spätestens",
    "fällig",
    "frist",
    "deadline",
    "due ",
    "bis zum",
    "bis spätestens",
    "zahlungsziel",
    "überweis",
    "rechnung",
    "invoice",
    "gültig bis",
    "valid until",
    "angebot",
    "kündig",
];

const MAX_TEXT_EVENTS: usize = 3;

fn mentions_any(text: &str, words: &[&str]) -> bool {
    let t = text.to_lowercase();
    words.iter().any(|w| t.contains(w))
}

fn to_user(time: &IcsTime, zone: Zone) -> (PrimitiveDateTime, bool, Option<String>) {
    match time {
        IcsTime::Date(d) => (PrimitiveDateTime::new(*d, time::Time::MIDNIGHT), true, None),
        IcsTime::Utc(dt) => (zone.convert_from(Zone::Utc, *dt), false, None),
        IcsTime::Floating(dt) => (*dt, false, None),
        IcsTime::Zoned { tzid, local } => match Zone::from_name(tzid) {
            Some(z) => (zone.convert_from(z, *local), false, None),
            None => (
                *local,
                false,
                Some(format!(
                    "The time is in {tzid}; it was not converted to your time zone."
                )),
            ),
        },
    }
}

fn from_ics(e: &IcsEvent, cancel: bool, zone: Zone) -> CalendarEvent {
    let (start, all_day, mut note) = to_user(&e.start, zone);
    let mut end = e.end.as_ref().map(|t| {
        let (end, _, n) = to_user(t, zone);
        note = note.take().or(n);
        end
    });
    if all_day {
        // an all-day DTEND is the day after the last day
        end = end
            .map(|d| d - Duration::days(1))
            .filter(|d| d.date() > start.date());
    } else if end.is_none() {
        end = e.duration.map(|d| start + d);
    }
    let end = end.filter(|d| *d > start);
    CalendarEvent {
        uid: e.uid.clone(),
        title: e.summary.clone(),
        start,
        end,
        all_day,
        location: e.location.clone(),
        description: e.description.clone(),
        organizer: e.organizer.clone(),
        source: EventSource::Invite,
        sequence: e.sequence,
        cancelled: cancel || e.status.as_deref() == Some("CANCELLED"),
        recurrence: e.rrule.clone(),
        note,
    }
}

fn text_uid(topic: &str, start: PrimitiveDateTime) -> String {
    let digest = Sha256::digest(format!("{topic}|{start}").as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("text-{hex}")
}

/// The events of one message. Invitations win: when there is one, the text is not searched.
/// Events that already lie before `today` are left out (a cancellation is always kept, so that it
/// can cancel the event it belongs to).
pub fn extract_events(msg: &MessageText, zone: Zone, today: Date) -> Vec<CalendarEvent> {
    let mut out: Vec<CalendarEvent> = Vec::new();
    for text in msg.calendars {
        let cal = parse_calendar(text);
        let method = cal.method.as_deref().unwrap_or("PUBLISH");
        if method == "REPLY" || method == "COUNTER" || method == "REFRESH" {
            continue;
        }
        for e in &cal.events {
            let ev = from_ics(e, method == "CANCEL", zone);
            if ev.cancelled
                || ev.start.date() >= today
                || ev.end.is_some_and(|end| end.date() >= today)
            {
                out.push(ev);
            }
        }
    }
    if !out.is_empty() {
        return out;
    }

    let reference = zone.to_local(msg.date).date();
    let topic = topic_key(msg.subject);
    let title_base = normalize_subject(msg.subject);
    let subject_trigger = mentions_any(msg.subject, TRIGGERS);
    let mentions = find_mentions(msg.body, reference);
    let distinct_dates: std::collections::HashSet<Date> = mentions.iter().map(|m| m.date).collect();
    for m in mentions {
        if m.date < today.max(reference) || mentions_any(&m.line, DEADLINES) {
            continue;
        }
        let appointment = m.start.is_some()
            || mentions_any(&m.line, TRIGGERS)
            || (subject_trigger && distinct_dates.len() == 1);
        if !appointment {
            continue;
        }
        let start = m.starts_at();
        if out.iter().any(|e| e.start == start) {
            continue;
        }
        let title = if title_base.is_empty() {
            m.line.chars().take(60).collect::<String>()
        } else {
            title_base.clone()
        };
        out.push(CalendarEvent {
            uid: text_uid(&topic, start),
            title,
            start,
            end: m.ends_at(),
            all_day: m.start.is_none(),
            location: None,
            description: Some(m.line.clone()),
            organizer: None,
            source: EventSource::Text,
            sequence: 0,
            cancelled: false,
            recurrence: None,
            note: None,
        });
        if out.len() >= MAX_TEXT_EVENTS {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, datetime};

    // 2026-11-03 09:00 UTC, a Tuesday
    const NOW: i64 = 1_793_696_400;
    const TODAY: Date = date!(2026 - 11 - 03);

    fn text(subject: &str, body: &str) -> Vec<CalendarEvent> {
        extract_events(
            &MessageText {
                subject,
                body,
                date: NOW,
                calendars: &[],
            },
            Zone::BERLIN,
            TODAY,
        )
    }

    fn invite(ics: &str) -> Vec<CalendarEvent> {
        let cals = [ics.to_string()];
        extract_events(
            &MessageText {
                subject: "Einladung",
                body: "siehe Anhang",
                date: NOW,
                calendars: &cals,
            },
            Zone::BERLIN,
            TODAY,
        )
    }

    #[test]
    fn an_invitation_in_berlin_time_stays_in_berlin_time() {
        let ev = invite("BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:u1\nDTSTART;TZID=Europe/Berlin:20261105T140000\nDTEND;TZID=Europe/Berlin:20261105T153000\nSUMMARY:Kickoff\nLOCATION:Raum 4\nEND:VEVENT\nEND:VCALENDAR");
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].start, datetime!(2026-11-05 14:00));
        assert_eq!(ev[0].end, Some(datetime!(2026-11-05 15:30)));
        assert_eq!(ev[0].source, EventSource::Invite);
        assert_eq!(ev[0].location.as_deref(), Some("Raum 4"));
        assert!(!ev[0].cancelled);
    }

    #[test]
    fn utc_times_are_shown_in_the_users_zone() {
        let ev = invite(
            "BEGIN:VEVENT\nUID:u1\nDTSTART:20261105T130000Z\nDURATION:PT45M\nSUMMARY:x\nEND:VEVENT",
        );
        assert_eq!(ev[0].start, datetime!(2026-11-05 14:00));
        assert_eq!(ev[0].end, Some(datetime!(2026-11-05 14:45)));
        // in summer the offset is two hours
        let ev = invite("BEGIN:VEVENT\nUID:u1\nDTSTART:20270705T130000Z\nSUMMARY:x\nEND:VEVENT");
        assert_eq!(ev[0].start, datetime!(2027-07-05 15:00));
    }

    #[test]
    fn a_zone_that_is_not_known_keeps_its_wall_time_and_says_so() {
        let ev = invite("BEGIN:VEVENT\nUID:u1\nDTSTART;TZID=America/New_York:20261105T090000\nSUMMARY:x\nEND:VEVENT");
        assert_eq!(ev[0].start, datetime!(2026-11-05 09:00));
        assert!(ev[0].note.as_deref().unwrap().contains("America/New_York"));
    }

    #[test]
    fn all_day_events_end_on_their_last_day() {
        let ev = invite("BEGIN:VEVENT\nUID:u1\nDTSTART;VALUE=DATE:20261224\nDTEND;VALUE=DATE:20261226\nSUMMARY:Weihnachten\nEND:VEVENT");
        assert!(ev[0].all_day);
        assert_eq!(ev[0].start.date(), date!(2026 - 12 - 24));
        assert_eq!(ev[0].end.map(|e| e.date()), Some(date!(2026 - 12 - 25)));
        let one_day = invite("BEGIN:VEVENT\nUID:u2\nDTSTART;VALUE=DATE:20261224\nDTEND;VALUE=DATE:20261225\nSUMMARY:x\nEND:VEVENT");
        assert_eq!(one_day[0].end, None);
    }

    #[test]
    fn a_cancellation_is_kept_even_when_past_and_replies_are_ignored() {
        let cancel = invite("BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nUID:u1\nDTSTART:20200105T130000Z\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR");
        assert_eq!(cancel.len(), 1);
        assert!(cancel[0].cancelled);
        let reply = invite("BEGIN:VCALENDAR\nMETHOD:REPLY\nBEGIN:VEVENT\nUID:u1\nDTSTART:20261105T130000Z\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR");
        assert!(reply.is_empty());
    }

    #[test]
    fn past_invitations_are_left_out() {
        assert!(
            invite("BEGIN:VEVENT\nUID:u1\nDTSTART:20200105T130000Z\nSUMMARY:x\nEND:VEVENT")
                .is_empty()
        );
    }

    #[test]
    fn a_repeating_event_keeps_its_rule() {
        let ev = invite("BEGIN:VEVENT\nUID:u1\nDTSTART:20261105T130000Z\nRRULE:FREQ=WEEKLY\nSUMMARY:Weekly\nEND:VEVENT");
        assert_eq!(ev[0].recurrence.as_deref(), Some("FREQ=WEEKLY"));
    }

    #[test]
    fn an_appointment_in_a_sentence_becomes_an_event_titled_like_the_subject() {
        let ev = text(
            "Re: Treffen am Wochenende",
            "Passt, dann sehen wir uns am 14.11. um 11 Uhr am Bahnhof.",
        );
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].title, "Treffen am Wochenende");
        assert_eq!(ev[0].start, datetime!(2026-11-14 11:00));
        assert_eq!(ev[0].source, EventSource::Text);
        assert!(!ev[0].all_day);
    }

    #[test]
    fn relative_days_count_from_the_day_the_mail_was_written() {
        let ev = text("Kurzfristig", "Können wir morgen um 9:30 telefonieren?");
        assert_eq!(ev[0].start, datetime!(2026-11-04 09:30));
    }

    #[test]
    fn a_range_gives_an_end() {
        let ev = text("Workshop", "Freitag von 14-16 Uhr im Konferenzraum.");
        assert_eq!(ev[0].start, datetime!(2026-11-06 14:00));
        assert_eq!(ev[0].end, Some(datetime!(2026-11-06 16:00)));
    }

    #[test]
    fn the_same_appointment_has_the_same_id_in_every_reply() {
        let a = text("Treffen", "am 14.11. um 11 Uhr");
        let b = text("AW: Treffen", "Ja, 14.11. um 11 Uhr passt.");
        assert_eq!(a[0].uid, b[0].uid);
        let c = text("Treffen", "doch lieber 15.11. um 11 Uhr");
        assert_ne!(a[0].uid, c[0].uid);
    }

    #[test]
    fn deadlines_and_bare_dates_are_not_appointments() {
        assert!(text(
            "Rechnung 4711",
            "Bitte zahlen Sie bis zum 15.11.2026 den Betrag."
        )
        .is_empty());
        assert!(text("Mahnung", "Zahlung fällig am 15.11. um 12 Uhr.").is_empty());
        assert!(text(
            "Bestellung",
            "Ihre Bestellung vom 20.11.2026 wurde bearbeitet."
        )
        .is_empty());
        assert!(text("Hallo", "Wie war dein Wochenende?").is_empty());
    }

    #[test]
    fn a_bare_date_with_a_trigger_word_is_an_all_day_event() {
        let ev = text(
            "Einladung zur Hochzeit",
            "Wir heiraten am 12.6.2027 und freuen uns auf euch.",
        );
        assert_eq!(ev.len(), 1);
        assert!(ev[0].all_day);
        assert_eq!(ev[0].start.date(), date!(2027 - 06 - 12));
        let ev = text("Hallo", "Wir haben einen Termin am 20.11.");
        assert_eq!(ev.len(), 1);
    }

    #[test]
    fn dates_before_today_are_left_out() {
        assert!(text("Treffen", "gestern, am 02.11.2026 um 10 Uhr war es schön").is_empty());
    }

    #[test]
    fn at_most_three_events_from_one_message() {
        let body =
            "Termine: 10.11. um 10 Uhr, 11.11. um 10 Uhr, 12.11. um 10 Uhr, 13.11. um 10 Uhr.";
        assert_eq!(text("Planung", body).len(), 3);
    }

    #[test]
    fn an_invitation_wins_over_the_text() {
        let cals = [
            "BEGIN:VEVENT\nUID:u1\nDTSTART:20261105T130000Z\nSUMMARY:Offiziell\nEND:VEVENT"
                .to_string(),
        ];
        let ev = extract_events(
            &MessageText {
                subject: "Treffen",
                body: "oder am 14.11. um 11 Uhr",
                date: NOW,
                calendars: &cals,
            },
            Zone::BERLIN,
            TODAY,
        );
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].title, "Offiziell");
    }

    #[test]
    fn events_survive_a_json_round_trip() {
        let ev = text("Treffen", "am 14.11. um 11 Uhr");
        let json = serde_json::to_string(&ev[0]).unwrap();
        assert!(json.contains("\"start\":\"2026-11-14T11:00\""), "{json}");
        let back: CalendarEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ev[0]);
    }
}
