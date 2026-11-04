//! What the mail API sends and takes over the wire. One definition, used by the server that writes
//! it and by the SDK that reads it, so the two cannot drift apart. Plain data with serde, no
//! database and no network, so it compiles for the phone and for the browser (WebAssembly) too.
//!
//! Field types are the ones every binding language has (no `usize`, no date types): times are
//! seconds since the epoch, or `YYYY-MM-DDTHH:MM` text for the calendar.

use serde::{Deserialize, Serialize};

use crate::address::Address;
use crate::group::Conversation;
use crate::template::Template;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncReport {
    /// When it ran (seconds since the epoch).
    pub at: i64,
    /// Messages downloaded.
    pub fetched: u32,
    /// New messages stored.
    pub stored: u32,
    /// Already there (the same Message-ID, e.g. a copy in the sent folder).
    pub duplicates: u32,
    /// Messages that could not be read (no sender, damaged).
    pub skipped: u32,
    /// Calendar events added or changed.
    pub events: u32,
    /// There is more to download; the next sync continues.
    pub more: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MailInfo {
    pub configured: bool,
    pub address: Option<Address>,
    pub timezone: String,
    pub poll_minutes: u64,
    pub messages: u64,
    pub unread: u64,
    pub syncing: bool,
    pub last_sync: Option<SyncReport>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationList {
    pub conversations: Vec<Conversation>,
    pub unread_people: u32,
    pub unread_updates: u32,
}

/// An event on the calendar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventInfo {
    pub id: i64,
    /// `active` or `cancelled`.
    pub status: String,
    /// The message it was found in.
    pub message: Option<i64>,
    pub uid: String,
    pub title: String,
    /// `2026-11-06T19:00`, the wall-clock time of the mailbox owner.
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
    pub organizer: Option<String>,
    /// `invite`, `text` or `manual`.
    pub source: String,
    pub sequence: i64,
    pub cancelled: bool,
    pub recurrence: Option<String>,
    pub note: Option<String>,
}

/// One bubble of a chat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: i64,
    pub mine: bool,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub at: i64,
    pub subject: String,
    /// The subject without "Re:", the topic this bubble belongs to.
    pub topic: String,
    /// What was said: no quoted chain, no signature, no greeting and closing.
    pub text: String,
    /// A quoted chain or signature was left out.
    pub trimmed: bool,
    pub unread: bool,
    pub events: Vec<EventInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationDetail {
    pub conversation: Conversation,
    pub messages: Vec<ChatMessage>,
    /// Who a reply goes to.
    pub reply_to: Vec<Address>,
    /// The id of the newest message, to answer it (keeps the topic's thread together).
    pub reply_to_message: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Marked {
    pub marked: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageDetail {
    pub id: i64,
    pub message_id: String,
    pub folder: String,
    pub outgoing: bool,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub subject: String,
    pub at: i64,
    /// The whole text, quoted chain included.
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaceholderInfo {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateList {
    pub templates: Vec<Template>,
    pub placeholders: Vec<PlaceholderInfo>,
}

/// Which template to put on: the best fit for the recipients, none, or a chosen one. On the wire:
/// `"auto"`, `"none"` or `{"id": 12}`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Choice {
    #[default]
    Auto,
    None,
    Id {
        id: i64,
    },
}

impl Serialize for Choice {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Choice::Auto => s.serialize_str("auto"),
            Choice::None => s.serialize_str("none"),
            Choice::Id { id } => {
                use serde::ser::SerializeMap;
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("id", id)?;
                m.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for Choice {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Shape {
            Word(String),
            Id { id: i64 },
        }
        match Shape::deserialize(d)? {
            Shape::Word(w) if w == "auto" => Ok(Choice::Auto),
            Shape::Word(w) if w == "none" => Ok(Choice::None),
            Shape::Word(w) => Err(serde::de::Error::custom(format!(
                "{w:?} is not auto, none or {{\"id\": n}}"
            ))),
            Shape::Id { id } => Ok(Choice::Id { id }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewRequest {
    pub to: Vec<String>,
    pub body: String,
    #[serde(default)]
    pub greeting: Choice,
    #[serde(default)]
    pub closing: Choice,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsedTemplate {
    pub id: i64,
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Preview {
    /// The message as it would be sent.
    pub text: String,
    pub greeting: Option<UsedTemplate>,
    pub closing: Option<UsedTemplate>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SendRequest {
    pub to: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub bcc: Vec<String>,
    #[serde(default)]
    pub subject: String,
    /// What you typed, without greeting and closing.
    pub body: String,
    #[serde(default)]
    pub greeting: Choice,
    #[serde(default)]
    pub closing: Choice,
    /// The message this answers (its row id): the reply stays in the same thread.
    #[serde(default)]
    pub reply_to: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SentMessage {
    pub id: i64,
    pub message_id: String,
    /// The message as it went out.
    pub text: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventList {
    pub from: String,
    pub to: String,
    pub events: Vec<EventInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewEvent {
    pub title: String,
    /// `2026-11-05T14:00`, or a day for an all-day event.
    pub start: String,
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// The error body of every failed request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorBody {
    pub error: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choice_is_a_word_or_an_id_on_the_wire() {
        assert_eq!(serde_json::to_string(&Choice::Auto).unwrap(), "\"auto\"");
        assert_eq!(serde_json::to_string(&Choice::None).unwrap(), "\"none\"");
        assert_eq!(
            serde_json::to_string(&Choice::Id { id: 12 }).unwrap(),
            "{\"id\":12}"
        );
        for c in [Choice::Auto, Choice::None, Choice::Id { id: 3 }] {
            let json = serde_json::to_string(&c).unwrap();
            assert_eq!(serde_json::from_str::<Choice>(&json).unwrap(), c);
        }
        assert!(serde_json::from_str::<Choice>("\"always\"").is_err());
        assert!(serde_json::from_str::<Choice>("12").is_err());
    }

    #[test]
    fn requests_may_leave_out_what_has_a_default() {
        let r: SendRequest = serde_json::from_str(r#"{"to":["a@b.de"],"body":"hi"}"#).unwrap();
        assert_eq!(
            (r.greeting, r.closing, r.reply_to, r.subject.as_str()),
            (Choice::Auto, Choice::Auto, None, "")
        );
        let p: PreviewRequest =
            serde_json::from_str(r#"{"to":[],"body":"x","greeting":{"id":2}}"#).unwrap();
        assert_eq!(p.greeting, Choice::Id { id: 2 });
    }

    #[test]
    fn an_error_body_without_problems_stays_short() {
        let e = ErrorBody {
            error: "no".into(),
            problems: vec![],
        };
        assert_eq!(serde_json::to_string(&e).unwrap(), "{\"error\":\"no\"}");
        let back: ErrorBody = serde_json::from_str("{\"error\":\"no\"}").unwrap();
        assert!(back.problems.is_empty());
    }
}
