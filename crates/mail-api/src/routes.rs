//! The mail client's HTTP routes, mounted at `/v1/mail` behind the server's token.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use financer_mail_core::{
    apply_templates, choose_template, group_by_person, group_by_topic, normalize_subject,
    render_template, validate_template, Address, CalendarEvent, Context, Conversation,
    ConversationKind, EventSource, Template, TemplateKind, PLACEHOLDERS,
};
use financer_mail_store::{EventStatus, MailStoreError};
use serde::{Deserialize, Serialize};

use crate::compose::{compose, new_message_id, Draft};
use crate::smtp::SendError;
use crate::state::{MailState, SyncReport};
use crate::sync::SyncError;
use crate::view::{
    chat_message, day_text, parse_day, parse_local, AddressDto, ChatMessageDto, ConversationDto,
    EventDto,
};

/// Most messages looked at when grouping; older ones fall off the lists.
const GROUPING_WINDOW: u64 = 5000;

pub enum ApiError {
    Bad(String, Vec<String>),
    NotFound(&'static str),
    Unavailable(String),
    Conflict(String),
    /// The mail server (not this one) refused or could not be reached.
    Upstream(String),
    Internal(String),
}

impl ApiError {
    fn bad(msg: impl Into<String>) -> ApiError {
        ApiError::Bad(msg.into(), Vec::new())
    }
}

impl From<MailStoreError> for ApiError {
    fn from(e: MailStoreError) -> Self {
        tracing::error!("mail store: {e}");
        ApiError::Internal("the mail database failed".into())
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    problems: Vec<String>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error, problems) = match self {
            ApiError::Bad(m, p) => (StatusCode::BAD_REQUEST, m, p),
            ApiError::NotFound(what) => (
                StatusCode::NOT_FOUND,
                format!("{what} not found"),
                Vec::new(),
            ),
            ApiError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m, Vec::new()),
            ApiError::Conflict(m) => (StatusCode::CONFLICT, m, Vec::new()),
            ApiError::Upstream(m) => (StatusCode::BAD_GATEWAY, m, Vec::new()),
            ApiError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m, Vec::new()),
        };
        (status, Json(ErrorBody { error, problems })).into_response()
    }
}

type Res<T> = Result<Json<T>, ApiError>;

// ---- info and sync ------------------------------------------------------------------------------

#[derive(Serialize)]
pub struct InfoDto {
    configured: bool,
    address: Option<AddressDto>,
    timezone: String,
    poll_minutes: u64,
    messages: u64,
    unread: u64,
    syncing: bool,
    last_sync: Option<SyncReport>,
}

pub async fn info(State(s): State<MailState>) -> Res<InfoDto> {
    Ok(Json(InfoDto {
        configured: s.configured(),
        address: s.config.as_ref().map(|c| AddressDto::from(&c.address)),
        timezone: s
            .config
            .as_ref()
            .map(|c| c.zone_name.clone())
            .unwrap_or_else(|| "Europe/Berlin".into()),
        poll_minutes: s.config.as_ref().map(|c| c.poll_minutes).unwrap_or(0),
        messages: s.store.message_count().await?,
        unread: s.store.unread_count().await?,
        syncing: s.sync_gate.try_lock().is_err(),
        last_sync: s.last_sync().await,
    }))
}

pub async fn sync(State(s): State<MailState>) -> Res<SyncReport> {
    match s.sync_now().await {
        Ok(report) => Ok(Json(report)),
        Err(SyncError::NotConfigured) => Err(ApiError::Unavailable("No mailbox is configured. Set FINANCER_MAIL_IMAP_HOST and the login on the server (docs/MAIL.md).".into())),
        Err(SyncError::Busy) => Err(ApiError::Conflict("A sync is already running.".into())),
    }
}

// ---- conversations ------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListQuery {
    /// `person` (default) or `topic`.
    by: Option<String>,
    /// `people` (default: leave out newsletters and notifications), `updates` (only those) or `all`.
    scope: Option<String>,
    q: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize)]
pub struct ListDto {
    conversations: Vec<ConversationDto>,
    unread_people: usize,
    unread_updates: usize,
}

fn matches(c: &Conversation, q: &str) -> bool {
    let q = q.to_lowercase();
    c.title.to_lowercase().contains(&q)
        || c.preview.to_lowercase().contains(&q)
        || c.topics.iter().any(|t| t.to_lowercase().contains(&q))
        || c.people.iter().any(|p| p.email.contains(&q))
}

pub async fn list_conversations(
    State(s): State<MailState>,
    Query(q): Query<ListQuery>,
) -> Res<ListDto> {
    let metas = s.store.metas(GROUPING_WINDOW).await?;
    let me = s.me();
    let unread = |automated: bool| {
        metas
            .iter()
            .filter(|m| !m.seen && !m.outgoing && m.automated == automated)
            .count()
    };
    let grouping = match q.by.as_deref() {
        None | Some("person") => group_by_person(&metas, &me),
        Some("topic") => group_by_topic(&metas, &me),
        Some(other) => {
            return Err(ApiError::bad(format!(
                "by must be person or topic, not {other:?}"
            )))
        }
    };
    let scope = q.scope.as_deref().unwrap_or("people");
    if !matches!(scope, "people" | "updates" | "all") {
        return Err(ApiError::bad(format!(
            "scope must be people, updates or all, not {scope:?}"
        )));
    }
    let needle = q.q.as_deref().map(str::trim).filter(|n| !n.is_empty());
    let conversations = grouping
        .conversations
        .iter()
        .filter(|c| match scope {
            "people" => !c.automated,
            "updates" => c.automated,
            _ => true,
        })
        .filter(|c| needle.is_none_or(|n| matches(c, n)))
        .take(q.limit.unwrap_or(100).min(500))
        .map(ConversationDto::from)
        .collect();
    Ok(Json(ListDto {
        conversations,
        unread_people: unread(false),
        unread_updates: unread(true),
    }))
}

async fn find_conversation(s: &MailState, key: &str) -> Result<(Conversation, Vec<i64>), ApiError> {
    let metas = s.store.metas(GROUPING_WINDOW).await?;
    let me = s.me();
    let grouping = match key.split_once('-').map(|(p, _)| p) {
        Some("p") => group_by_person(&metas, &me),
        Some("t") => group_by_topic(&metas, &me),
        _ => return Err(ApiError::NotFound("conversation")),
    };
    let conv = grouping
        .conversations
        .into_iter()
        .find(|c| c.key == key)
        .ok_or(ApiError::NotFound("conversation"))?;
    let ids = grouping.members.get(key).cloned().unwrap_or_default();
    Ok((conv, ids))
}

#[derive(Serialize)]
pub struct ConversationDetail {
    conversation: ConversationDto,
    messages: Vec<ChatMessageDto>,
    /// Who a reply goes to.
    reply_to: Vec<AddressDto>,
    /// The id of the newest message, to answer it (keeps the topic's thread together).
    reply_to_message: Option<i64>,
}

pub async fn get_conversation(
    State(s): State<MailState>,
    Path(key): Path<String>,
) -> Res<ConversationDetail> {
    let (conv, ids) = find_conversation(&s, &key).await?;
    let messages = s.store.messages(&ids).await?;
    let events = s.store.events_of_messages(&ids).await?;
    let me = s.me();
    let bubbles: Vec<ChatMessageDto> = messages
        .iter()
        .map(|m| {
            let mine: Vec<EventDto> = events
                .iter()
                .filter(|e| e.message_row == Some(m.id))
                .map(EventDto::from)
                .collect();
            chat_message(m, mine)
        })
        .collect();
    // answer the people of the conversation; for a topic, the people other than you on its latest message
    let reply_to: Vec<AddressDto> = match conv.kind {
        ConversationKind::Person => conv.people.iter().map(AddressDto::from).collect(),
        ConversationKind::Topic => messages
            .last()
            .map(|m| {
                let n = &m.message;
                let mut people: Vec<&Address> = Vec::new();
                if !me.is_me(&n.from) {
                    people.push(&n.from);
                } else {
                    people.extend(n.to.iter().filter(|a| !me.is_me(a)));
                }
                people.into_iter().map(AddressDto::from).collect()
            })
            .unwrap_or_default(),
    };
    Ok(Json(ConversationDetail {
        reply_to_message: messages.last().map(|m| m.id),
        conversation: ConversationDto::from(&conv),
        messages: bubbles,
        reply_to,
    }))
}

#[derive(Serialize)]
pub struct Marked {
    marked: u64,
}

pub async fn mark_read(State(s): State<MailState>, Path(key): Path<String>) -> Res<Marked> {
    let (_, ids) = find_conversation(&s, &key).await?;
    Ok(Json(Marked {
        marked: s.store.mark_seen(&ids).await?,
    }))
}

#[derive(Serialize)]
pub struct MessageDetail {
    id: i64,
    message_id: String,
    folder: String,
    outgoing: bool,
    from: AddressDto,
    to: Vec<AddressDto>,
    cc: Vec<AddressDto>,
    subject: String,
    at: i64,
    /// The whole text, quoted chain included.
    body: String,
}

pub async fn get_message(State(s): State<MailState>, Path(id): Path<i64>) -> Res<MessageDetail> {
    let m = s
        .store
        .message(id)
        .await?
        .ok_or(ApiError::NotFound("message"))?;
    let n = m.message;
    Ok(Json(MessageDetail {
        id: m.id,
        message_id: n.message_id,
        folder: n.folder,
        outgoing: n.outgoing,
        from: AddressDto::from(&n.from),
        to: n.to.iter().map(AddressDto::from).collect(),
        cc: n.cc.iter().map(AddressDto::from).collect(),
        subject: n.subject,
        at: n.sent_at,
        body: n.body,
    }))
}

// ---- templates ----------------------------------------------------------------------------------

#[derive(Serialize)]
pub struct PlaceholderDto {
    name: &'static str,
    description: &'static str,
}

#[derive(Serialize)]
pub struct TemplatesDto {
    templates: Vec<Template>,
    placeholders: Vec<PlaceholderDto>,
}

pub async fn list_templates(State(s): State<MailState>) -> Res<TemplatesDto> {
    s.ensure_default_templates().await?;
    Ok(Json(TemplatesDto {
        templates: s.store.templates().await?,
        placeholders: PLACEHOLDERS
            .iter()
            .map(|(name, description)| PlaceholderDto { name, description })
            .collect(),
    }))
}

fn checked(t: Template) -> Result<Template, ApiError> {
    let problems = validate_template(&t);
    if problems.is_empty() {
        Ok(t)
    } else {
        Err(ApiError::Bad("The template is not valid.".into(), problems))
    }
}

pub async fn create_template(
    State(s): State<MailState>,
    Json(t): Json<Template>,
) -> Result<(StatusCode, Json<Template>), ApiError> {
    s.ensure_default_templates().await?;
    let t = checked(t)?;
    Ok((
        StatusCode::CREATED,
        Json(s.store.create_template(&t).await?),
    ))
}

pub async fn update_template(
    State(s): State<MailState>,
    Path(id): Path<i64>,
    Json(mut t): Json<Template>,
) -> Res<Template> {
    t.id = id;
    let t = checked(t)?;
    if s.store.update_template(&t).await? {
        Ok(Json(t))
    } else {
        Err(ApiError::NotFound("template"))
    }
}

pub async fn delete_template(
    State(s): State<MailState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    if s.store.delete_template(id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("template"))
    }
}

/// Which template to put on: the best fit for the recipients, none, or a chosen one.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    #[default]
    Auto,
    None,
    Id(i64),
}

#[derive(Deserialize)]
pub struct PreviewRequest {
    to: Vec<String>,
    body: String,
    #[serde(default)]
    greeting: Choice,
    #[serde(default)]
    closing: Choice,
}

#[derive(Serialize)]
pub struct UsedTemplate {
    id: i64,
    name: String,
    text: String,
}

#[derive(Serialize)]
pub struct PreviewDto {
    /// The message as it would be sent.
    text: String,
    greeting: Option<UsedTemplate>,
    closing: Option<UsedTemplate>,
    warnings: Vec<String>,
}

fn parse_addresses(label: &str, items: &[String]) -> Result<Vec<Address>, ApiError> {
    let mut out: Vec<Address> = Vec::new();
    let mut bad = Vec::new();
    for item in items {
        let parsed = Address::parse_list(item);
        if parsed.is_empty() {
            bad.push(format!("{item:?} is not an email address"));
        }
        for a in parsed {
            if !out.iter().any(|o| o.email == a.email) {
                out.push(a);
            }
        }
    }
    if bad.is_empty() {
        Ok(out)
    } else {
        Err(ApiError::Bad(format!("Check the {label} addresses."), bad))
    }
}

/// Greeting and closing put around `body` for these recipients.
async fn dress(
    s: &MailState,
    recipients: &[Address],
    body: &str,
    greeting: Choice,
    closing: Choice,
) -> Result<PreviewDto, ApiError> {
    s.ensure_default_templates().await?;
    let templates = s.store.templates().await?;
    let pick = |kind: TemplateKind, choice: Choice| -> Result<Option<&Template>, ApiError> {
        match choice {
            Choice::None => Ok(None),
            Choice::Auto => Ok(choose_template(&templates, kind, recipients)),
            Choice::Id(id) => templates
                .iter()
                .find(|t| t.id == id && t.kind == kind)
                .map(Some)
                .ok_or(ApiError::NotFound("template")),
        }
    };
    let (g, c) = (
        pick(TemplateKind::Greeting, greeting)?,
        pick(TemplateKind::Closing, closing)?,
    );
    let me = s
        .config
        .as_ref()
        .map(|c| c.address.clone())
        .unwrap_or_else(|| Address {
            name: None,
            email: "me@example.invalid".into(),
        });
    let ctx = Context {
        recipients,
        me: &me,
    };
    let (rg, rc) = (
        g.map(|t| render_template(t, &ctx)),
        c.map(|t| render_template(t, &ctx)),
    );
    let applied = apply_templates(body, rg.as_ref(), rc.as_ref());
    let mut warnings = Vec::new();
    if rg.as_ref().is_some_and(|r| r.missing_name) {
        warnings.push("No name is known for the recipient, so the greeting was left out. Add a fallback to the template, or write the greeting yourself.".to_string());
    }
    if applied.kept_own_greeting {
        warnings.push("Your text already starts with a greeting, so none was added.".to_string());
    }
    if applied.kept_own_closing {
        warnings.push("Your text already ends with a closing, so none was added.".to_string());
    }
    let used = |t: Option<&Template>, r: &Option<financer_mail_core::Rendered>| {
        t.zip(r.as_ref()).map(|(t, r)| UsedTemplate {
            id: t.id,
            name: t.name.clone(),
            text: r.text.clone(),
        })
    };
    Ok(PreviewDto {
        text: applied.text,
        greeting: used(g, &rg),
        closing: used(c, &rc),
        warnings,
    })
}

pub async fn preview(
    State(s): State<MailState>,
    Json(req): Json<PreviewRequest>,
) -> Res<PreviewDto> {
    let to = parse_addresses("recipient", &req.to)?;
    Ok(Json(
        dress(&s, &to, &req.body, req.greeting, req.closing).await?,
    ))
}

// ---- sending ------------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SendRequest {
    to: Vec<String>,
    #[serde(default)]
    cc: Vec<String>,
    #[serde(default)]
    bcc: Vec<String>,
    #[serde(default)]
    subject: String,
    /// What you typed, without greeting and closing.
    body: String,
    #[serde(default)]
    greeting: Choice,
    #[serde(default)]
    closing: Choice,
    /// The message this answers (its row id): the reply stays in the same thread.
    reply_to: Option<i64>,
}

#[derive(Serialize)]
pub struct SentDto {
    id: i64,
    message_id: String,
    /// The message as it went out.
    text: String,
    warnings: Vec<String>,
}

pub async fn send(
    State(s): State<MailState>,
    Json(req): Json<SendRequest>,
) -> Result<(StatusCode, Json<SentDto>), ApiError> {
    let cfg = s.config.clone().ok_or_else(|| {
        ApiError::Unavailable(
            "No mailbox is configured, so nothing can be sent (docs/MAIL.md).".into(),
        )
    })?;
    let to = parse_addresses("recipient", &req.to)?;
    let cc = parse_addresses("cc", &req.cc)?;
    let bcc = parse_addresses("bcc", &req.bcc)?;
    if to.is_empty() && cc.is_empty() && bcc.is_empty() {
        return Err(ApiError::bad("Add at least one recipient."));
    }
    if req.body.trim().is_empty() {
        return Err(ApiError::bad("The message is empty."));
    }
    let parent = match req.reply_to {
        Some(id) => Some(
            s.store
                .message(id)
                .await?
                .ok_or(ApiError::NotFound("message to reply to"))?,
        ),
        None => None,
    };
    let subject = {
        let typed = req.subject.trim();
        if !typed.is_empty() {
            typed.to_string()
        } else if let Some(p) = &parent {
            let topic = normalize_subject(&p.message.subject);
            if topic.is_empty() {
                "Re:".to_string()
            } else {
                format!("Re: {topic}")
            }
        } else {
            return Err(ApiError::bad("A subject is needed for a new topic."));
        }
    };
    let everyone: Vec<Address> = to.iter().chain(&cc).cloned().collect();
    let dressed = dress(
        &s,
        if everyone.is_empty() { &bcc } else { &everyone },
        &req.body,
        req.greeting,
        req.closing,
    )
    .await?;
    let now = s.now();
    let message_id = new_message_id(&cfg.address);
    let draft = Draft {
        from: cfg.address.clone(),
        to,
        cc,
        bcc,
        subject,
        body: dressed.text.clone(),
        in_reply_to: parent.as_ref().map(|p| p.message.message_id.clone()),
        references: parent
            .as_ref()
            .map(|p| p.message.references.clone())
            .unwrap_or_default(),
    };
    let composed = compose(&draft, &message_id, now, &cfg.sent).map_err(ApiError::bad)?;
    s.sender
        .send(
            &cfg.address.email,
            &composed.recipients,
            composed.raw.clone(),
        )
        .await
        .map_err(|e| match e {
            SendError::Connect(_) | SendError::Login(_) | SendError::Rejected(_) => {
                ApiError::Upstream(e.to_string())
            }
        })?;
    // sent: from here on a failure to record it must not look like a failure to send
    let id = match s.store.insert_message(&composed.message, now).await {
        Ok(Some(id)) => id,
        Ok(None) => s
            .store
            .message_by_message_id(&message_id)
            .await?
            .map(|m| m.id)
            .unwrap_or_default(),
        Err(e) => return Err(e.into()),
    };
    if let Err(e) = s.record_events(id, &composed.message, &[]).await {
        tracing::warn!("calendar events of a sent message: {e}");
    }
    Ok((
        StatusCode::CREATED,
        Json(SentDto {
            id,
            message_id,
            text: dressed.text,
            warnings: dressed.warnings,
        }),
    ))
}

// ---- calendar -----------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct EventsQuery {
    from: Option<String>,
    to: Option<String>,
    #[serde(default)]
    include_cancelled: bool,
}

#[derive(Serialize)]
pub struct EventsDto {
    from: String,
    to: String,
    events: Vec<EventDto>,
}

pub async fn list_events(
    State(s): State<MailState>,
    Query(q): Query<EventsQuery>,
) -> Res<EventsDto> {
    let today = s.zone().to_local(s.now()).date();
    let from = match q.from.as_deref() {
        Some(f) => {
            parse_day(f).ok_or_else(|| ApiError::bad("from must be a day like 2026-11-05"))?
        }
        None => today,
    };
    let to = match q.to.as_deref() {
        Some(t) => parse_day(t).ok_or_else(|| ApiError::bad("to must be a day like 2026-11-05"))?,
        None => from + time::Duration::days(90),
    };
    if to < from {
        return Err(ApiError::bad("to is before from"));
    }
    if (to - from).whole_days() > 800 {
        return Err(ApiError::bad("Ask for at most about two years at a time."));
    }
    let events = s
        .store
        .events(&day_text(from), &day_text(to), q.include_cancelled)
        .await?;
    Ok(Json(EventsDto {
        from: day_text(from),
        to: day_text(to),
        events: events.iter().map(EventDto::from).collect(),
    }))
}

#[derive(Deserialize)]
pub struct NewEvent {
    title: String,
    /// `2026-11-05T14:00`, or a day for an all-day event.
    start: String,
    end: Option<String>,
    #[serde(default)]
    all_day: bool,
    location: Option<String>,
    description: Option<String>,
}

pub async fn create_event(
    State(s): State<MailState>,
    Json(req): Json<NewEvent>,
) -> Result<(StatusCode, Json<EventDto>), ApiError> {
    let title = req.title.trim();
    if title.is_empty() {
        return Err(ApiError::bad("The event needs a title."));
    }
    let start = parse_local(&req.start)
        .ok_or_else(|| ApiError::bad("start must look like 2026-11-05T14:00"))?;
    let end = match req.end.as_deref().filter(|e| !e.trim().is_empty()) {
        Some(e) => Some(
            parse_local(e).ok_or_else(|| ApiError::bad("end must look like 2026-11-05T15:00"))?,
        ),
        None => None,
    };
    if end.is_some_and(|e| e < start) {
        return Err(ApiError::bad("The event ends before it starts."));
    }
    let event = CalendarEvent {
        uid: format!("manual-{}", uuid::Uuid::new_v4().simple()),
        title: title.to_string(),
        start,
        end,
        all_day: req.all_day,
        location: req.location.filter(|l| !l.trim().is_empty()),
        description: req.description.filter(|d| !d.trim().is_empty()),
        organizer: None,
        source: EventSource::Manual,
        sequence: 0,
        cancelled: false,
        recurrence: None,
        note: None,
    };
    s.store.upsert_event(&event, None, s.now()).await?;
    let listed = s
        .store
        .events(
            &day_text(start.date()),
            &day_text(end.unwrap_or(start).date()),
            false,
        )
        .await?;
    let stored = listed
        .iter()
        .find(|e| e.event.uid == event.uid)
        .ok_or(ApiError::Internal("the event was not saved".into()))?;
    Ok((StatusCode::CREATED, Json(EventDto::from(stored))))
}

/// Takes an event off the calendar. It stays off when the same invitation is read again.
pub async fn remove_event(
    State(s): State<MailState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    if s.store
        .set_event_status(id, EventStatus::Dismissed, s.now())
        .await?
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("event"))
    }
}

pub async fn restore_event(State(s): State<MailState>, Path(id): Path<i64>) -> Res<EventDto> {
    let event = s
        .store
        .event(id)
        .await?
        .ok_or(ApiError::NotFound("event"))?;
    let status = if event.event.cancelled {
        EventStatus::Cancelled
    } else {
        EventStatus::Active
    };
    s.store.set_event_status(id, status, s.now()).await?;
    let again = s
        .store
        .event(id)
        .await?
        .ok_or(ApiError::NotFound("event"))?;
    Ok(Json(EventDto::from(&again)))
}
