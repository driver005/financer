//! The mail API (`/v1/mail`) as typed calls. The types are the server's own (`financer-mail-core`),
//! re-declared below for UniFFI field by field: if the server changes one, this stops compiling.

use std::sync::Arc;

use financer_mail_core::wire::{
    ChatMessage, Choice, ConversationDetail, ConversationList, EventInfo, EventList, MailInfo,
    Marked, MessageDetail, NewEvent, PlaceholderInfo, Preview, PreviewRequest, SendRequest,
    SentMessage, SyncReport, TemplateList, UsedTemplate,
};
use financer_mail_core::{Address, Conversation, ConversationKind, Template, TemplateKind};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::SdkError;
use crate::transport::{Request, Transport};

const PREFIX: &str = "/v1/mail";

#[uniffi::remote(Record)]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

#[uniffi::remote(Enum)]
pub enum ConversationKind {
    Person,
    Topic,
}

#[uniffi::remote(Record)]
pub struct Conversation {
    pub key: String,
    pub kind: ConversationKind,
    pub title: String,
    pub people: Vec<Address>,
    pub count: u32,
    pub unread: u32,
    pub last_at: i64,
    pub last_from_me: bool,
    pub preview: String,
    pub topics: Vec<String>,
    pub automated: bool,
}

#[uniffi::remote(Enum)]
pub enum TemplateKind {
    Greeting,
    Closing,
}

#[uniffi::remote(Record)]
pub struct Template {
    pub id: i64,
    pub kind: TemplateKind,
    pub name: String,
    pub text: String,
    pub fallback: Option<String>,
    pub audience: Vec<String>,
    pub is_default: bool,
}

#[uniffi::remote(Record)]
pub struct SyncReport {
    pub at: i64,
    pub fetched: u32,
    pub stored: u32,
    pub duplicates: u32,
    pub skipped: u32,
    pub events: u32,
    pub more: bool,
    pub error: Option<String>,
}

#[uniffi::remote(Record)]
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

#[uniffi::remote(Record)]
pub struct ConversationList {
    pub conversations: Vec<Conversation>,
    pub unread_people: u32,
    pub unread_updates: u32,
}

#[uniffi::remote(Record)]
pub struct EventInfo {
    pub id: i64,
    pub status: String,
    pub message: Option<i64>,
    pub uid: String,
    pub title: String,
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
    pub organizer: Option<String>,
    pub source: String,
    pub sequence: i64,
    pub cancelled: bool,
    pub recurrence: Option<String>,
    pub note: Option<String>,
}

#[uniffi::remote(Record)]
pub struct ChatMessage {
    pub id: i64,
    pub mine: bool,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub at: i64,
    pub subject: String,
    pub topic: String,
    pub text: String,
    pub trimmed: bool,
    pub unread: bool,
    pub events: Vec<EventInfo>,
}

#[uniffi::remote(Record)]
pub struct ConversationDetail {
    pub conversation: Conversation,
    pub messages: Vec<ChatMessage>,
    pub reply_to: Vec<Address>,
    pub reply_to_message: Option<i64>,
}

#[uniffi::remote(Record)]
pub struct Marked {
    pub marked: u64,
}

#[uniffi::remote(Record)]
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
    pub body: String,
}

#[uniffi::remote(Record)]
pub struct PlaceholderInfo {
    pub name: String,
    pub description: String,
}

#[uniffi::remote(Record)]
pub struct TemplateList {
    pub templates: Vec<Template>,
    pub placeholders: Vec<PlaceholderInfo>,
}

#[uniffi::remote(Enum)]
pub enum Choice {
    Auto,
    None,
    Id { id: i64 },
}

#[uniffi::remote(Record)]
pub struct PreviewRequest {
    pub to: Vec<String>,
    pub body: String,
    pub greeting: Choice,
    pub closing: Choice,
}

#[uniffi::remote(Record)]
pub struct UsedTemplate {
    pub id: i64,
    pub name: String,
    pub text: String,
}

#[uniffi::remote(Record)]
pub struct Preview {
    pub text: String,
    pub greeting: Option<UsedTemplate>,
    pub closing: Option<UsedTemplate>,
    pub warnings: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct SendRequest {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body: String,
    pub greeting: Choice,
    pub closing: Choice,
    pub reply_to: Option<i64>,
}

#[uniffi::remote(Record)]
pub struct SentMessage {
    pub id: i64,
    pub message_id: String,
    pub text: String,
    pub warnings: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct EventList {
    pub from: String,
    pub to: String,
    pub events: Vec<EventInfo>,
}

#[uniffi::remote(Record)]
pub struct NewEvent {
    pub title: String,
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
}

/// Percent-encodes a value for a path segment or a query value.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `?a=1&b=2` from the pairs that have a value, or nothing.
fn query(pairs: &[(&str, Option<String>)]) -> String {
    let parts: Vec<String> = pairs
        .iter()
        .filter_map(|(k, v)| {
            v.as_ref()
                .filter(|v| !v.is_empty())
                .map(|v| format!("{k}={}", encode(v)))
        })
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!("?{}", parts.join("&"))
    }
}

/// The mail client of one server. Cheap to clone: it only holds the transport.
#[derive(uniffi::Object)]
pub struct MailSdk {
    transport: Arc<dyn Transport>,
}

impl MailSdk {
    /// A client that carries its requests with `transport` (the in-process one on the phone, a fake
    /// in a test).
    pub fn with_transport(transport: Arc<dyn Transport>) -> Arc<MailSdk> {
        Arc::new(MailSdk { transport })
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: &str,
        path: String,
        body: Option<&impl Serialize>,
    ) -> Result<T, SdkError> {
        let bytes = self.call_raw(method, path, body).await?;
        let bytes = if bytes.is_empty() {
            b"null".to_vec()
        } else {
            bytes
        };
        serde_json::from_slice(&bytes).map_err(|e| SdkError::Decode {
            message: e.to_string(),
        })
    }

    async fn call_raw(
        &self,
        method: &str,
        path: String,
        body: Option<&impl Serialize>,
    ) -> Result<Vec<u8>, SdkError> {
        let body = match body {
            Some(b) => Some(serde_json::to_vec(b).map_err(|e| SdkError::Decode {
                message: e.to_string(),
            })?),
            None => None,
        };
        let res = self
            .transport
            .send(Request {
                method: method.to_string(),
                path: format!("{PREFIX}{path}"),
                body,
                content_type: None,
            })
            .await?;
        if !(200..300).contains(&res.status) {
            return Err(SdkError::from_response(res.status, &res.body));
        }
        Ok(res.body)
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailSdk {
    /// The mail client of the server at `base_url`, logged in with the server's token.
    #[cfg(feature = "http")]
    #[uniffi::constructor]
    pub fn new(base_url: String, token: String) -> Arc<MailSdk> {
        MailSdk::with_transport(Arc::new(crate::transport::HttpTransport::new(
            &base_url, &token,
        )))
    }

    /// Whether a mailbox is connected, how the last check went, and how much mail there is.
    pub async fn info(&self) -> Result<MailInfo, SdkError> {
        self.call("GET", "/info".into(), None::<&()>).await
    }

    /// Reads new mail now.
    pub async fn sync(&self) -> Result<SyncReport, SdkError> {
        self.call("POST", "/sync".into(), Some(&serde_json::json!({})))
            .await
    }

    /// The chats: `by` is `person` (default) or `topic`; `scope` is `people` (default), `updates`
    /// or `all`; `q` searches names, topics and previews.
    pub async fn conversations(
        &self,
        by: Option<String>,
        scope: Option<String>,
        q: Option<String>,
        limit: Option<u32>,
    ) -> Result<ConversationList, SdkError> {
        let q = q.map(|q| q.trim().to_string());
        let qs = query(&[
            ("by", by),
            ("scope", scope),
            ("q", q),
            ("limit", limit.map(|l| l.to_string())),
        ]);
        self.call("GET", format!("/conversations{qs}"), None::<&()>)
            .await
    }

    /// One chat or topic with its messages, oldest first.
    pub async fn conversation(&self, key: String) -> Result<ConversationDetail, SdkError> {
        self.call(
            "GET",
            format!("/conversations/{}", encode(&key)),
            None::<&()>,
        )
        .await
    }

    /// Marks everything in a chat as read (in this client; the mail server is never changed).
    pub async fn mark_read(&self, key: String) -> Result<Marked, SdkError> {
        self.call(
            "POST",
            format!("/conversations/{}/read", encode(&key)),
            Some(&serde_json::json!({})),
        )
        .await
    }

    /// A message with its quoted chain, as it arrived.
    pub async fn message(&self, id: i64) -> Result<MessageDetail, SdkError> {
        self.call("GET", format!("/messages/{id}"), None::<&()>)
            .await
    }

    pub async fn templates(&self) -> Result<TemplateList, SdkError> {
        self.call("GET", "/templates".into(), None::<&()>).await
    }

    pub async fn create_template(&self, template: Template) -> Result<Template, SdkError> {
        self.call("POST", "/templates".into(), Some(&template))
            .await
    }

    pub async fn update_template(&self, template: Template) -> Result<Template, SdkError> {
        self.call(
            "PUT",
            format!("/templates/{}", template.id),
            Some(&template),
        )
        .await
    }

    pub async fn delete_template(&self, id: i64) -> Result<(), SdkError> {
        self.call_raw("DELETE", format!("/templates/{id}"), None::<&()>)
            .await
            .map(|_| ())
    }

    /// The message as it would be sent, with greeting and closing put around it.
    pub async fn preview(&self, request: PreviewRequest) -> Result<Preview, SdkError> {
        self.call("POST", "/compose/preview".into(), Some(&request))
            .await
    }

    pub async fn send(&self, request: SendRequest) -> Result<SentMessage, SdkError> {
        self.call("POST", "/send".into(), Some(&request)).await
    }

    /// The calendar between two days (`2026-11-05`); without them, the next 90 days.
    pub async fn events(
        &self,
        from: Option<String>,
        to: Option<String>,
        include_cancelled: bool,
    ) -> Result<EventList, SdkError> {
        let qs = query(&[
            ("from", from),
            ("to", to),
            (
                "include_cancelled",
                include_cancelled.then(|| "true".to_string()),
            ),
        ]);
        self.call("GET", format!("/events{qs}"), None::<&()>).await
    }

    pub async fn create_event(&self, event: NewEvent) -> Result<EventInfo, SdkError> {
        self.call("POST", "/events".into(), Some(&event)).await
    }

    /// Takes an event off the calendar; it stays off when the mail is read again.
    pub async fn remove_event(&self, id: i64) -> Result<(), SdkError> {
        self.call_raw("DELETE", format!("/events/{id}"), None::<&()>)
            .await
            .map(|_| ())
    }

    pub async fn restore_event(&self, id: i64) -> Result<EventInfo, SdkError> {
        self.call(
            "POST",
            format!("/events/{id}/restore"),
            Some(&serde_json::json!({})),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_what_a_url_cannot_hold() {
        assert_eq!(encode("p-0dd9"), "p-0dd9");
        assert_eq!(encode("Fußball am Freitag"), "Fu%C3%9Fball%20am%20Freitag");
        assert_eq!(encode("a/b?c=d&e"), "a%2Fb%3Fc%3Dd%26e");
    }

    #[test]
    fn leaves_out_empty_parameters() {
        assert_eq!(query(&[("a", None), ("b", Some(String::new()))]), "");
        assert_eq!(
            query(&[
                ("by", Some("topic".into())),
                ("q", Some("Fußball".into())),
                ("limit", None)
            ]),
            "?by=topic&q=Fu%C3%9Fball"
        );
    }
}
