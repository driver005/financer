//! Table definitions. Lists (recipients, references, a template's audience) are stored as JSON text.

macro_rules! entity {
    ($m:ident, $table:literal, { $($body:tt)* }) => {
        pub mod $m {
            use sea_orm::entity::prelude::*;

            #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
            #[sea_orm(table_name = $table)]
            pub struct Model { $($body)* }

            #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
            pub enum Relation {}

            impl ActiveModelBehavior for ActiveModel {}
        }
    };
}

entity!(message, "mail_messages", {
    #[sea_orm(primary_key)]
    pub id: i64,
    /// The Message-ID header without the angle brackets; unique, so a message read twice (inbox and
    /// sent folder, or again after the server renumbered) is stored once.
    #[sea_orm(unique)]
    pub message_id: String,
    pub folder: String,
    pub uid: Option<i64>,
    pub in_reply_to: Option<String>,
    /// JSON array of Message-IDs.
    pub refs: String,
    pub subject: String,
    pub from_name: Option<String>,
    pub from_email: String,
    /// JSON arrays of addresses.
    pub to_json: String,
    pub cc_json: String,
    pub sent_at: i64,
    /// The plain text, cut at a size limit.
    pub body: String,
    pub snippet: String,
    pub outgoing: bool,
    pub seen: bool,
    pub automated: bool,
    pub created_at: i64,
});

entity!(event, "mail_events", {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub uid: String,
    /// The message the event was found in.
    pub message_row: Option<i64>,
    pub title: String,
    /// `YYYY-MM-DDTHH:MM`, wall-clock time of the mailbox owner; sorts as text.
    pub starts: String,
    pub ends: Option<String>,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
    pub organizer: Option<String>,
    pub source: String,
    pub sequence: i64,
    /// `active`, `cancelled` or `dismissed`.
    pub status: String,
    pub recurrence: Option<String>,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
});

entity!(template, "mail_templates", {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub body: String,
    pub fallback: Option<String>,
    pub audience: String,
    pub is_default: bool,
    pub position: i64,
});

entity!(kv, "mail_kv", {
    #[sea_orm(primary_key, auto_increment = false)]
    pub key: String,
    pub value: String,
});
