//! Persistence for the mail client. It has its own tables and migration history, so it can live in a
//! database of its own (a SQLite file next to the finance one) or in the same PostgreSQL database.
//! Mail is deliberately not part of the finance data: it is bulky, private, and not exported or
//! backed up with the budget.

pub mod entity;
pub mod migration;

use financer_mail_core::{Address, CalendarEvent, EventSource, Meta, Template, TemplateKind};
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveValue::{NotSet, Set},
    ColumnTrait, ConnectOptions, Database, DatabaseConnection, DbErr, EntityTrait, FromQueryResult,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
};
use sea_orm_migration::MigratorTrait;
use serde::de::DeserializeOwned;
use time::PrimitiveDateTime;

use entity::{event, kv, message, template};

#[derive(Debug, thiserror::Error)]
pub enum MailStoreError {
    #[error("database error: {0}")]
    Db(#[from] DbErr),
    #[error("stored data is unreadable: {0}")]
    Data(String),
}

type Result<T> = std::result::Result<T, MailStoreError>;

fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string())
}

fn unjson<T: DeserializeOwned>(s: &str) -> Result<T> {
    serde_json::from_str(s).map_err(|e| MailStoreError::Data(e.to_string()))
}

/// Most text kept of one message.
pub const MAX_BODY_BYTES: usize = 64 * 1024;

const LOCAL_FORMAT: &[time::format_description::BorrowedFormatItem<'static>] =
    time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]");

fn local_text(t: PrimitiveDateTime) -> String {
    t.format(LOCAL_FORMAT).unwrap_or_default()
}

fn local_parse(s: &str) -> Result<PrimitiveDateTime> {
    PrimitiveDateTime::parse(s, LOCAL_FORMAT).map_err(|e| MailStoreError::Data(format!("{s}: {e}")))
}

/// A message to store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewMessage {
    pub message_id: String,
    pub folder: String,
    pub uid: Option<u32>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub subject: String,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub sent_at: i64,
    pub body: String,
    pub snippet: String,
    pub outgoing: bool,
    pub seen: bool,
    pub automated: bool,
}

/// A message as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMessage {
    pub id: i64,
    pub message: NewMessage,
}

impl StoredMessage {
    pub fn meta(&self) -> Meta {
        let m = &self.message;
        Meta {
            id: self.id,
            message_id: m.message_id.clone(),
            in_reply_to: m.in_reply_to.clone(),
            references: m.references.clone(),
            subject: m.subject.clone(),
            from: m.from.clone(),
            to: m.to.clone(),
            cc: m.cc.clone(),
            date: m.sent_at,
            outgoing: m.outgoing,
            seen: m.seen,
            automated: m.automated,
            snippet: m.snippet.clone(),
        }
    }
}

fn cut(body: &str) -> String {
    if body.len() <= MAX_BODY_BYTES {
        return body.to_string();
    }
    let mut end = MAX_BODY_BYTES;
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n\n[message shortened]", &body[..end])
}

fn address(name: Option<String>, email: String) -> Address {
    Address { name, email }
}

#[derive(FromQueryResult)]
struct MetaRow {
    id: i64,
    message_id: String,
    in_reply_to: Option<String>,
    refs: String,
    subject: String,
    from_name: Option<String>,
    from_email: String,
    to_json: String,
    cc_json: String,
    sent_at: i64,
    snippet: String,
    outgoing: bool,
    seen: bool,
    automated: bool,
}

impl MetaRow {
    fn into_meta(self) -> Result<Meta> {
        Ok(Meta {
            id: self.id,
            message_id: self.message_id,
            in_reply_to: self.in_reply_to,
            references: unjson(&self.refs)?,
            subject: self.subject,
            from: address(self.from_name, self.from_email),
            to: unjson(&self.to_json)?,
            cc: unjson(&self.cc_json)?,
            date: self.sent_at,
            outgoing: self.outgoing,
            seen: self.seen,
            automated: self.automated,
            snippet: self.snippet,
        })
    }
}

fn stored(row: message::Model) -> Result<StoredMessage> {
    Ok(StoredMessage {
        id: row.id,
        message: NewMessage {
            message_id: row.message_id,
            folder: row.folder,
            uid: row.uid.and_then(|u| u32::try_from(u).ok()),
            in_reply_to: row.in_reply_to,
            references: unjson(&row.refs)?,
            subject: row.subject,
            from: address(row.from_name, row.from_email),
            to: unjson(&row.to_json)?,
            cc: unjson(&row.cc_json)?,
            sent_at: row.sent_at,
            body: row.body,
            snippet: row.snippet,
            outgoing: row.outgoing,
            seen: row.seen,
            automated: row.automated,
        },
    })
}

/// Whether an event is on the calendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventStatus {
    Active,
    /// The organiser cancelled it.
    Cancelled,
    /// You removed it; it stays removed when the same invitation is read again.
    Dismissed,
}

impl EventStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            EventStatus::Active => "active",
            EventStatus::Cancelled => "cancelled",
            EventStatus::Dismissed => "dismissed",
        }
    }
    fn parse(s: &str) -> EventStatus {
        match s {
            "cancelled" => EventStatus::Cancelled,
            "dismissed" => EventStatus::Dismissed,
            _ => EventStatus::Active,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredEvent {
    pub id: i64,
    pub event: CalendarEvent,
    pub status: EventStatus,
    /// The message it was found in.
    pub message_row: Option<i64>,
}

/// What happened to an event offered to the calendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upsert {
    Created,
    Updated,
    Unchanged,
    /// Dismissed by the person, an older version, or a cancellation of something never added.
    Ignored,
}

fn source_str(s: EventSource) -> &'static str {
    match s {
        EventSource::Invite => "invite",
        EventSource::Text => "text",
        EventSource::Manual => "manual",
    }
}

fn source_parse(s: &str) -> EventSource {
    match s {
        "invite" => EventSource::Invite,
        "manual" => EventSource::Manual,
        _ => EventSource::Text,
    }
}

fn stored_event(row: event::Model) -> Result<StoredEvent> {
    let end: Option<PrimitiveDateTime> = row.ends.as_deref().map(local_parse).transpose()?;
    Ok(StoredEvent {
        id: row.id,
        status: EventStatus::parse(&row.status),
        message_row: row.message_row,
        event: CalendarEvent {
            uid: row.uid,
            title: row.title,
            start: local_parse(&row.starts)?,
            end,
            all_day: row.all_day,
            location: row.location,
            description: row.description,
            organizer: row.organizer,
            source: source_parse(&row.source),
            sequence: row.sequence,
            cancelled: row.status == "cancelled",
            recurrence: row.recurrence,
            note: row.note,
        },
    })
}

fn stored_template(row: template::Model) -> Result<Template> {
    Ok(Template {
        id: row.id,
        kind: if row.kind == "closing" {
            TemplateKind::Closing
        } else {
            TemplateKind::Greeting
        },
        name: row.name,
        text: row.body,
        fallback: row.fallback,
        audience: unjson(&row.audience)?,
        is_default: row.is_default,
    })
}

fn kind_str(k: TemplateKind) -> &'static str {
    match k {
        TemplateKind::Greeting => "greeting",
        TemplateKind::Closing => "closing",
    }
}

#[derive(Clone)]
pub struct MailStore {
    db: DatabaseConnection,
}

impl MailStore {
    /// `sqlite://path?mode=rwc`, `sqlite::memory:` or `postgres://...`; runs pending migrations.
    pub async fn connect(url: &str) -> Result<MailStore> {
        let mut opts = ConnectOptions::new(url.to_string());
        opts.sqlx_logging(false);
        if url.contains(":memory:") {
            opts.max_connections(1).min_connections(1);
        }
        Self::from_connection(Database::connect(opts).await?).await
    }

    /// Use a connection that already exists (the mail tables are added to it).
    pub async fn from_connection(db: DatabaseConnection) -> Result<MailStore> {
        migration::Migrator::up(&db, None).await?;
        Ok(MailStore { db })
    }

    // ---- messages ------------------------------------------------------------------------------

    /// Stores a message. `None` when a message with that Message-ID is already there.
    pub async fn insert_message(&self, m: &NewMessage, now: i64) -> Result<Option<i64>> {
        let row = message::ActiveModel {
            id: NotSet,
            message_id: Set(m.message_id.clone()),
            folder: Set(m.folder.clone()),
            uid: Set(m.uid.map(i64::from)),
            in_reply_to: Set(m.in_reply_to.clone()),
            refs: Set(json(&m.references)),
            subject: Set(m.subject.clone()),
            from_name: Set(m.from.name.clone()),
            from_email: Set(m.from.email.clone()),
            to_json: Set(json(&m.to)),
            cc_json: Set(json(&m.cc)),
            sent_at: Set(m.sent_at),
            body: Set(cut(&m.body)),
            snippet: Set(m.snippet.clone()),
            outgoing: Set(m.outgoing),
            seen: Set(m.seen),
            automated: Set(m.automated),
            created_at: Set(now),
        };
        let res = message::Entity::insert(row)
            .on_conflict(
                OnConflict::column(message::Column::MessageId)
                    .do_nothing()
                    .to_owned(),
            )
            .exec(&self.db)
            .await;
        match res {
            Ok(r) => Ok(Some(r.last_insert_id)),
            Err(DbErr::RecordNotInserted) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// The messages' headers for grouping, newest `limit` of them (no bodies).
    pub async fn metas(&self, limit: u64) -> Result<Vec<Meta>> {
        let rows = message::Entity::find()
            .select_only()
            .columns([
                message::Column::Id,
                message::Column::MessageId,
                message::Column::InReplyTo,
                message::Column::Refs,
                message::Column::Subject,
                message::Column::FromName,
                message::Column::FromEmail,
                message::Column::ToJson,
                message::Column::CcJson,
                message::Column::SentAt,
                message::Column::Snippet,
                message::Column::Outgoing,
                message::Column::Seen,
                message::Column::Automated,
            ])
            .order_by_desc(message::Column::SentAt)
            .order_by_desc(message::Column::Id)
            .limit(limit)
            .into_model::<MetaRow>()
            .all(&self.db)
            .await?;
        rows.into_iter().map(MetaRow::into_meta).collect()
    }

    /// Full messages, oldest first.
    pub async fn messages(&self, ids: &[i64]) -> Result<Vec<StoredMessage>> {
        let mut out = Vec::new();
        for chunk in ids.chunks(400) {
            let rows = message::Entity::find()
                .filter(message::Column::Id.is_in(chunk.to_vec()))
                .all(&self.db)
                .await?;
            for r in rows {
                out.push(stored(r)?);
            }
        }
        out.sort_by_key(|m| (m.message.sent_at, m.id));
        Ok(out)
    }

    pub async fn message(&self, id: i64) -> Result<Option<StoredMessage>> {
        match message::Entity::find_by_id(id).one(&self.db).await? {
            Some(r) => Ok(Some(stored(r)?)),
            None => Ok(None),
        }
    }

    pub async fn message_by_message_id(&self, message_id: &str) -> Result<Option<StoredMessage>> {
        match message::Entity::find()
            .filter(message::Column::MessageId.eq(message_id))
            .one(&self.db)
            .await?
        {
            Some(r) => Ok(Some(stored(r)?)),
            None => Ok(None),
        }
    }

    pub async fn mark_seen(&self, ids: &[i64]) -> Result<u64> {
        let mut changed = 0;
        for chunk in ids.chunks(400) {
            changed += message::Entity::update_many()
                .col_expr(message::Column::Seen, Expr::value(true))
                .filter(message::Column::Id.is_in(chunk.to_vec()))
                .filter(message::Column::Seen.eq(false))
                .exec(&self.db)
                .await?
                .rows_affected;
        }
        Ok(changed)
    }

    pub async fn unread_count(&self) -> Result<u64> {
        Ok(message::Entity::find()
            .filter(message::Column::Seen.eq(false))
            .filter(message::Column::Outgoing.eq(false))
            .filter(message::Column::Automated.eq(false))
            .count(&self.db)
            .await?)
    }

    pub async fn message_count(&self) -> Result<u64> {
        Ok(message::Entity::find().count(&self.db).await?)
    }

    // ---- calendar events -----------------------------------------------------------------------

    /// Offers an event to the calendar: a new one is added, a known one is updated by a newer
    /// version of the invitation, one you removed stays removed, a cancellation cancels.
    pub async fn upsert_event(
        &self,
        e: &CalendarEvent,
        message_row: Option<i64>,
        now: i64,
    ) -> Result<Upsert> {
        let existing = event::Entity::find()
            .filter(event::Column::Uid.eq(e.uid.as_str()))
            .one(&self.db)
            .await?;
        let starts = local_text(e.start);
        let ends = e.end.map(local_text);
        let Some(old) = existing else {
            if e.cancelled {
                return Ok(Upsert::Ignored);
            }
            event::Entity::insert(event::ActiveModel {
                id: NotSet,
                uid: Set(e.uid.clone()),
                message_row: Set(message_row),
                title: Set(e.title.clone()),
                starts: Set(starts),
                ends: Set(ends),
                all_day: Set(e.all_day),
                location: Set(e.location.clone()),
                description: Set(e.description.clone()),
                organizer: Set(e.organizer.clone()),
                source: Set(source_str(e.source).to_string()),
                sequence: Set(e.sequence),
                status: Set(EventStatus::Active.as_str().to_string()),
                recurrence: Set(e.recurrence.clone()),
                note: Set(e.note.clone()),
                created_at: Set(now),
                updated_at: Set(now),
            })
            .exec(&self.db)
            .await?;
            return Ok(Upsert::Created);
        };
        if old.status == "dismissed" || e.sequence < old.sequence {
            return Ok(Upsert::Ignored);
        }
        let status = if e.cancelled {
            EventStatus::Cancelled
        } else {
            EventStatus::Active
        };
        let same = old.title == e.title
            && old.starts == starts
            && old.ends == ends
            && old.all_day == e.all_day
            && old.location == e.location
            && old.status == status.as_str()
            && old.sequence == e.sequence;
        if same {
            return Ok(Upsert::Unchanged);
        }
        // a text guess must not overwrite an invitation's details
        if e.source == EventSource::Text && old.source != "text" {
            return Ok(Upsert::Ignored);
        }
        let mut row: event::ActiveModel = old.into();
        row.title = Set(e.title.clone());
        row.starts = Set(starts);
        row.ends = Set(ends);
        row.all_day = Set(e.all_day);
        row.location = Set(e.location.clone());
        row.description = Set(e.description.clone());
        row.organizer = Set(e.organizer.clone());
        row.sequence = Set(e.sequence);
        row.status = Set(status.as_str().to_string());
        row.recurrence = Set(e.recurrence.clone());
        row.note = Set(e.note.clone());
        row.updated_at = Set(now);
        event::Entity::update(row).exec(&self.db).await?;
        Ok(Upsert::Updated)
    }

    /// Events that start between `from` and `to` (both `YYYY-MM-DD`, inclusive), or that span
    /// them, soonest first. Dismissed events are never listed; cancelled ones only on request.
    pub async fn events(
        &self,
        from: &str,
        to: &str,
        include_cancelled: bool,
    ) -> Result<Vec<StoredEvent>> {
        let mut q = event::Entity::find()
            .filter(event::Column::Status.ne("dismissed"))
            .filter(event::Column::Starts.lt(format!("{to}T24:00")))
            .order_by_asc(event::Column::Starts)
            .order_by_asc(event::Column::Id);
        if !include_cancelled {
            q = q.filter(event::Column::Status.eq("active"));
        }
        let mut out = Vec::new();
        for row in q.all(&self.db).await? {
            let e = stored_event(row)?;
            let last_day = e.event.end.unwrap_or(e.event.start);
            if local_text(last_day).as_str() >= format!("{from}T00:00").as_str() {
                out.push(e);
            }
        }
        Ok(out)
    }

    pub async fn event(&self, id: i64) -> Result<Option<StoredEvent>> {
        match event::Entity::find_by_id(id).one(&self.db).await? {
            Some(r) => Ok(Some(stored_event(r)?)),
            None => Ok(None),
        }
    }

    pub async fn set_event_status(&self, id: i64, status: EventStatus, now: i64) -> Result<bool> {
        Ok(event::Entity::update_many()
            .col_expr(event::Column::Status, Expr::value(status.as_str()))
            .col_expr(event::Column::UpdatedAt, Expr::value(now))
            .filter(event::Column::Id.eq(id))
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    // ---- templates -----------------------------------------------------------------------------

    pub async fn templates(&self) -> Result<Vec<Template>> {
        template::Entity::find()
            .order_by_asc(template::Column::Kind)
            .order_by_asc(template::Column::Position)
            .order_by_asc(template::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(stored_template)
            .collect()
    }

    pub async fn template_count(&self) -> Result<u64> {
        Ok(template::Entity::find().count(&self.db).await?)
    }

    /// Adds a template; one marked default makes it the only default of its kind.
    pub async fn create_template(&self, t: &Template) -> Result<Template> {
        if t.is_default {
            self.clear_default(t.kind, None).await?;
        }
        let position = self.template_count().await? as i64;
        let res = template::Entity::insert(template::ActiveModel {
            id: NotSet,
            kind: Set(kind_str(t.kind).to_string()),
            name: Set(t.name.trim().to_string()),
            body: Set(t.text.clone()),
            fallback: Set(t.fallback.clone().filter(|f| !f.trim().is_empty())),
            audience: Set(json(&t.audience)),
            is_default: Set(t.is_default),
            position: Set(position),
        })
        .exec(&self.db)
        .await?;
        let mut saved = t.clone();
        saved.id = res.last_insert_id;
        Ok(saved)
    }

    pub async fn update_template(&self, t: &Template) -> Result<bool> {
        if t.is_default {
            self.clear_default(t.kind, Some(t.id)).await?;
        }
        let res = template::Entity::update_many()
            .col_expr(template::Column::Kind, Expr::value(kind_str(t.kind)))
            .col_expr(template::Column::Name, Expr::value(t.name.trim()))
            .col_expr(template::Column::Body, Expr::value(t.text.as_str()))
            .col_expr(
                template::Column::Fallback,
                Expr::value(t.fallback.clone().filter(|f| !f.trim().is_empty())),
            )
            .col_expr(template::Column::Audience, Expr::value(json(&t.audience)))
            .col_expr(template::Column::IsDefault, Expr::value(t.is_default))
            .filter(template::Column::Id.eq(t.id))
            .exec(&self.db)
            .await?;
        Ok(res.rows_affected > 0)
    }

    async fn clear_default(&self, kind: TemplateKind, except: Option<i64>) -> Result<()> {
        let mut q = template::Entity::update_many()
            .col_expr(template::Column::IsDefault, Expr::value(false))
            .filter(template::Column::Kind.eq(kind_str(kind)));
        if let Some(id) = except {
            q = q.filter(template::Column::Id.ne(id));
        }
        q.exec(&self.db).await?;
        Ok(())
    }

    pub async fn delete_template(&self, id: i64) -> Result<bool> {
        Ok(template::Entity::delete_by_id(id)
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    // ---- settings ------------------------------------------------------------------------------

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        Ok(kv::Entity::find_by_id(key.to_string())
            .one(&self.db)
            .await?
            .map(|r| r.value))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        kv::Entity::insert(kv::ActiveModel {
            key: Set(key.to_string()),
            value: Set(value.to_string()),
        })
        .on_conflict(
            OnConflict::column(kv::Column::Key)
                .update_column(kv::Column::Value)
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
