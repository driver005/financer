//! The mail client's domain, with no network and no database: who a message is from and to, which
//! person's chat and which topic it belongs to, what the person actually wrote (without the quoted
//! reply chain), the greeting and closing templates, and the calendar events hidden in invitations
//! and in plain sentences.
//!
//! Everything here is a pure function of its input, so it is tested with hand-written mails in
//! German and English.

pub mod address;
pub mod event;
pub mod frame;
pub mod group;
pub mod ics;
pub mod quote;
pub mod subject;
pub mod template;
pub mod when;
pub mod zone;

pub use address::{is_automated_sender, is_valid_email, Address};
pub use event::{extract_events, CalendarEvent, EventSource, MessageText};
pub use frame::{split_frame, Frame};
pub use group::{
    group_by_person, group_by_topic, Conversation, ConversationKind, Grouping, Me, Meta,
};
pub use quote::{fresh_text, Fresh};
pub use subject::{normalize_subject, topic_key};
pub use template::{
    apply_templates, choose_template, render_template, validate_template, Applied, Context,
    Rendered, Template, TemplateKind, PLACEHOLDERS,
};
pub use zone::Zone;
