//! The calendar: calendars with colours, and events with repeats, exceptions and reminders.
//!
//! The server stores the events and the rule of a repeating one; expanding a rule into the
//! occurrences of the range on screen is the client's job (it also builds the reminders).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use financer_store::{NewCalendar, NewEvent, StoredCalendar, StoredEvent};
use serde::{Deserialize, Serialize};
use time::macros::format_description;
use time::{Date, Duration, Time};
use utoipa::ToSchema;

use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

const TONES: [&str; 6] = ["accent", "success", "warning", "danger", "info", "neutral"];
const REPEATS: [&str; 5] = ["none", "daily", "weekly", "monthly", "yearly"];
const WEEKDAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const MAX_NAME_CHARS: usize = 60;
const MAX_TITLE_CHARS: usize = 200;
const MAX_NOTES_CHARS: usize = 5000;
const MAX_LOCATION_CHARS: usize = 200;
const MAX_CALENDARS: u64 = 30;
const MAX_REMINDERS: usize = 5;
const MAX_REMINDER_MINUTES: u32 = 40_320;
const MAX_RANGE_DAYS: i64 = 800;
const MAX_EVENT_DAYS: i64 = 366;

// ---- wire types ----

#[derive(Debug, Serialize, ToSchema)]
pub struct CalendarDto {
    pub id: i64,
    pub name: String,
    /// accent, success, warning, danger, info or neutral.
    pub tone: String,
    pub visible: bool,
}

impl From<StoredCalendar> for CalendarDto {
    fn from(c: StoredCalendar) -> Self {
        Self {
            id: c.id,
            name: c.name,
            tone: c.tone,
            visible: c.visible,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CalendarInput {
    pub name: String,
    pub tone: String,
    pub visible: bool,
}

/// How an event repeats.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RepeatDto {
    /// none, daily, weekly, monthly or yearly.
    pub kind: String,
    /// Every n days, weeks, months or years (1 to 99).
    pub interval: u32,
    /// Weekly only: MO, TU, WE, TH, FR, SA, SU. Empty means the weekday of the start.
    pub weekdays: Vec<String>,
    /// The last day an occurrence may fall on.
    #[schema(value_type = Option<String>, format = Date, example = "2026-12-31")]
    pub until: Option<Date>,
    /// Stop after this many occurrences (not together with `until`).
    pub count: Option<u32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EventDto {
    pub id: i64,
    pub calendar_id: i64,
    pub title: String,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub all_day: bool,
    #[schema(value_type = String, format = Date, example = "2026-11-03")]
    pub start_date: Date,
    /// `HH:MM`; none for an all-day event.
    pub start_time: Option<String>,
    /// For an all-day event this day is included.
    #[schema(value_type = String, format = Date, example = "2026-11-03")]
    pub end_date: Date,
    pub end_time: Option<String>,
    pub repeat: RepeatDto,
    /// Occurrences that were deleted from a repeating event.
    #[schema(value_type = Vec<String>, format = Date)]
    pub exceptions: Vec<Date>,
    /// Minutes before the start at which to remind.
    pub reminders: Vec<u32>,
}

/// The fields of an event that do not depend on which backend holds it.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EventBody {
    pub title: String,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub all_day: bool,
    #[schema(value_type = String, format = Date, example = "2026-11-03")]
    pub start_date: Date,
    pub start_time: Option<String>,
    #[schema(value_type = String, format = Date, example = "2026-11-03")]
    pub end_date: Date,
    pub end_time: Option<String>,
    pub repeat: RepeatDto,
    #[serde(default)]
    #[schema(value_type = Vec<String>, format = Date)]
    pub exceptions: Vec<Date>,
    pub reminders: Vec<u32>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EventInput {
    pub calendar_id: i64,
    pub title: String,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub all_day: bool,
    #[schema(value_type = String, format = Date, example = "2026-11-03")]
    pub start_date: Date,
    pub start_time: Option<String>,
    #[schema(value_type = String, format = Date, example = "2026-11-03")]
    pub end_date: Date,
    pub end_time: Option<String>,
    pub repeat: RepeatDto,
    #[serde(default)]
    #[schema(value_type = Vec<String>, format = Date)]
    pub exceptions: Vec<Date>,
    pub reminders: Vec<u32>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ExceptionInput {
    /// The occurrence to skip.
    #[schema(value_type = String, format = Date, example = "2026-11-10")]
    pub date: Date,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct RangeQuery {
    /// First day, inclusive.
    #[param(value_type = String, format = Date, example = "2026-11-01")]
    from: Date,
    /// Last day, inclusive.
    #[param(value_type = String, format = Date, example = "2026-11-30")]
    to: Date,
}

// ---- conversions and checks ----

fn clock(t: Time) -> String {
    format!("{:02}:{:02}", t.hour(), t.minute())
}

fn parse_clock(s: &str) -> Result<Time, ApiError> {
    Time::parse(s, &format_description!("[hour]:[minute]"))
        .map_err(|_| ApiError::BadRequest(format!("{s:?} is not a time like 09:30")))
}

impl From<StoredEvent> for EventDto {
    fn from(s: StoredEvent) -> Self {
        let e = s.event;
        let weekdays = e
            .repeat_weekdays
            .as_deref()
            .map(|w| {
                w.split(',')
                    .filter(|d| !d.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        Self {
            id: s.id,
            calendar_id: e.calendar_id,
            title: e.title,
            notes: e.notes,
            location: e.location,
            all_day: e.all_day,
            start_date: e.start_date,
            start_time: e.start_time.map(clock),
            end_date: e.end_date,
            end_time: e.end_time.map(clock),
            repeat: RepeatDto {
                kind: e.repeat_kind,
                interval: e.repeat_interval,
                weekdays,
                until: e.repeat_until,
                count: e.repeat_count,
            },
            exceptions: e.exdates,
            reminders: e.reminders,
        }
    }
}

fn trimmed(text: &str, max: usize, what: &str) -> Result<String, ApiError> {
    let t = text.trim();
    if t.is_empty() {
        return Err(ApiError::BadRequest(format!("{what} must not be empty")));
    }
    if t.chars().count() > max {
        return Err(ApiError::BadRequest(format!(
            "{what} is longer than {max} characters"
        )));
    }
    Ok(t.to_string())
}

fn optional(text: Option<String>, max: usize, what: &str) -> Result<Option<String>, ApiError> {
    match text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        None => Ok(None),
        Some(t) if t.chars().count() > max => Err(ApiError::BadRequest(format!(
            "{what} is longer than {max} characters"
        ))),
        Some(t) => Ok(Some(t)),
    }
}

fn check_calendar(input: &CalendarInput) -> Result<NewCalendar, ApiError> {
    if !TONES.contains(&input.tone.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "colour must be one of {}",
            TONES.join(", ")
        )));
    }
    Ok(NewCalendar {
        name: trimmed(&input.name, MAX_NAME_CHARS, "the name")?,
        tone: input.tone.clone(),
        visible: input.visible,
    })
}

impl EventInput {
    pub(crate) fn from_body(calendar_id: i64, b: EventBody) -> Self {
        Self {
            calendar_id,
            title: b.title,
            notes: b.notes,
            location: b.location,
            all_day: b.all_day,
            start_date: b.start_date,
            start_time: b.start_time,
            end_date: b.end_date,
            end_time: b.end_time,
            repeat: b.repeat,
            exceptions: b.exceptions,
            reminders: b.reminders,
        }
    }
}

impl From<StoredEvent> for EventBody {
    fn from(s: StoredEvent) -> Self {
        let d = EventDto::from(s);
        Self {
            title: d.title,
            notes: d.notes,
            location: d.location,
            all_day: d.all_day,
            start_date: d.start_date,
            start_time: d.start_time,
            end_date: d.end_date,
            end_time: d.end_time,
            repeat: d.repeat,
            exceptions: d.exceptions,
            reminders: d.reminders,
        }
    }
}

pub(crate) fn check_calendar_input(
    name: &str,
    tone: &str,
    visible: bool,
) -> Result<NewCalendar, ApiError> {
    check_calendar(&CalendarInput {
        name: name.into(),
        tone: tone.into(),
        visible,
    })
}

pub(crate) fn check_event_input(input: EventInput) -> Result<NewEvent, ApiError> {
    check_event(input)
}

fn check_event(input: EventInput) -> Result<NewEvent, ApiError> {
    let title = trimmed(&input.title, MAX_TITLE_CHARS, "the title")?;
    let notes = optional(input.notes, MAX_NOTES_CHARS, "the notes")?;
    let location = optional(input.location, MAX_LOCATION_CHARS, "the location")?;

    let (start_time, end_time) = if input.all_day {
        (None, None)
    } else {
        let (Some(s), Some(e)) = (&input.start_time, &input.end_time) else {
            return Err(ApiError::BadRequest(
                "an event with times needs a start and an end time".into(),
            ));
        };
        (Some(parse_clock(s)?), Some(parse_clock(e)?))
    };
    if input.end_date < input.start_date
        || (input.end_date == input.start_date && end_time < start_time)
    {
        return Err(ApiError::BadRequest(
            "the event ends before it starts".into(),
        ));
    }
    if input.end_date - input.start_date > Duration::days(MAX_EVENT_DAYS) {
        return Err(ApiError::BadRequest(format!(
            "an event may last at most {MAX_EVENT_DAYS} days"
        )));
    }

    let r = &input.repeat;
    if !REPEATS.contains(&r.kind.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "repeat must be one of {}",
            REPEATS.join(", ")
        )));
    }
    if !(1..=99).contains(&r.interval) {
        return Err(ApiError::BadRequest(
            "the repeat interval must be between 1 and 99".into(),
        ));
    }
    if r.until.is_some() && r.count.is_some() {
        return Err(ApiError::BadRequest(
            "a repeat ends on a date or after a count, not both".into(),
        ));
    }
    if r.count.is_some_and(|c| !(1..=1000).contains(&c)) {
        return Err(ApiError::BadRequest(
            "the repeat count must be between 1 and 1000".into(),
        ));
    }
    if r.until.is_some_and(|u| u < input.start_date) {
        return Err(ApiError::BadRequest(
            "the repeat ends before the event starts".into(),
        ));
    }
    for (i, d) in r.weekdays.iter().enumerate() {
        if !WEEKDAYS.contains(&d.as_str()) || r.weekdays[..i].contains(d) {
            return Err(ApiError::BadRequest(
                "weekdays are MO, TU, WE, TH, FR, SA, SU, each once".into(),
            ));
        }
    }
    if !r.weekdays.is_empty() && r.kind != "weekly" {
        return Err(ApiError::BadRequest(
            "weekdays only go with a weekly repeat".into(),
        ));
    }
    let single = r.kind == "none";
    if single && (r.until.is_some() || r.count.is_some() || !input.exceptions.is_empty()) {
        return Err(ApiError::BadRequest(
            "an event that does not repeat has no end or exceptions".into(),
        ));
    }

    if input.reminders.len() > MAX_REMINDERS
        || input.reminders.iter().any(|m| *m > MAX_REMINDER_MINUTES)
        || input
            .reminders
            .iter()
            .enumerate()
            .any(|(i, m)| input.reminders[..i].contains(m))
    {
        return Err(ApiError::BadRequest(format!(
            "at most {MAX_REMINDERS} different reminders, up to {MAX_REMINDER_MINUTES} minutes before"
        )));
    }

    let weekdays = (!r.weekdays.is_empty()).then(|| r.weekdays.join(","));
    Ok(NewEvent {
        calendar_id: input.calendar_id,
        title,
        notes,
        location,
        all_day: input.all_day,
        start_date: input.start_date,
        start_time,
        end_date: input.end_date,
        end_time,
        repeat_kind: r.kind.clone(),
        repeat_interval: if single { 1 } else { r.interval },
        repeat_weekdays: weekdays,
        repeat_until: r.until,
        repeat_count: r.count,
        exdates: input.exceptions,
        reminders: input.reminders,
    })
}

async fn require_calendar(state: &AppState, id: i64) -> Result<(), ApiError> {
    state
        .store
        .calendar(id)
        .await?
        .map(|_| ())
        .ok_or_else(|| ApiError::BadRequest("that calendar does not exist".into()))
}

// ---- calendars ----

/// Your calendars in display order. A new database has one, "Personal".
#[utoipa::path(get, path = "/v1/calendar/calendars", responses((status = 200, body = Vec<CalendarDto>)), security(("bearer" = [])))]
pub async fn list_calendars(
    State(state): State<AppState>,
) -> Result<Json<Vec<CalendarDto>>, ApiError> {
    Ok(Json(
        state
            .store
            .calendars()
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

/// Add a calendar.
#[utoipa::path(post, path = "/v1/calendar/calendars", request_body = CalendarInput, responses(
    (status = 201, body = CalendarDto),
    (status = 400, description = "Empty name, unknown colour or too many calendars", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn create_calendar(
    State(state): State<AppState>,
    Json(input): Json<CalendarInput>,
) -> Result<(StatusCode, Json<CalendarDto>), ApiError> {
    let new = check_calendar(&input)?;
    if state.store.calendars().await?.len() as u64 >= MAX_CALENDARS {
        return Err(ApiError::BadRequest(format!(
            "at most {MAX_CALENDARS} calendars"
        )));
    }
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_calendar(&new).await?.into()),
    ))
}

/// Change a calendar's name, colour or whether it is shown.
#[utoipa::path(put, path = "/v1/calendar/calendars/{id}", request_body = CalendarInput, params(("id" = i64, Path)), responses(
    (status = 200, body = CalendarDto),
    (status = 400, description = "Empty name or unknown colour", body = ErrorBody),
    (status = 404, description = "No such calendar", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn update_calendar(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<CalendarInput>,
) -> Result<Json<CalendarDto>, ApiError> {
    let new = check_calendar(&input)?;
    if !state.store.update_calendar(id, &new).await? {
        return Err(ApiError::NotFound);
    }
    let saved = state.store.calendar(id).await?.ok_or(ApiError::NotFound)?;
    Ok(Json(saved.into()))
}

/// Delete a calendar with all its events. The last calendar cannot be deleted.
#[utoipa::path(delete, path = "/v1/calendar/calendars/{id}", params(("id" = i64, Path)), responses(
    (status = 204, description = "Deleted"),
    (status = 400, description = "It is the last calendar", body = ErrorBody),
    (status = 404, description = "No such calendar", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn delete_calendar(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    if state.store.calendars().await?.len() <= 1 {
        return Err(ApiError::BadRequest(
            "the last calendar cannot be deleted".into(),
        ));
    }
    if !state.store.delete_calendar(id).await? {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---- events ----

/// The events that can show between two days (inclusive): single events overlapping the range and
/// every repeating event that has started and not ended. Expanding the repeats is up to the client.
#[utoipa::path(get, path = "/v1/calendar/events", params(RangeQuery), responses(
    (status = 200, body = Vec<EventDto>),
    (status = 400, description = "The range is backwards or longer than 800 days", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn list_events(
    State(state): State<AppState>,
    Query(q): Query<RangeQuery>,
) -> Result<Json<Vec<EventDto>>, ApiError> {
    if q.to < q.from || q.to - q.from > Duration::days(MAX_RANGE_DAYS) {
        return Err(ApiError::BadRequest(format!(
            "the range must be between one day and {MAX_RANGE_DAYS} days"
        )));
    }
    let events = state.store.calendar_events(q.from, q.to).await?;
    Ok(Json(events.into_iter().map(Into::into).collect()))
}

/// One event.
#[utoipa::path(get, path = "/v1/calendar/events/{id}", params(("id" = i64, Path)), responses(
    (status = 200, body = EventDto), (status = 404, description = "No such event", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn get_event(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<EventDto>, ApiError> {
    Ok(Json(
        state
            .store
            .calendar_event(id)
            .await?
            .ok_or(ApiError::NotFound)?
            .into(),
    ))
}

/// Add an event.
#[utoipa::path(post, path = "/v1/calendar/events", request_body = EventInput, responses(
    (status = 201, body = EventDto),
    (status = 400, description = "Empty title, bad times, bad repeat or unknown calendar", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn create_event(
    State(state): State<AppState>,
    Json(input): Json<EventInput>,
) -> Result<(StatusCode, Json<EventDto>), ApiError> {
    let new = check_event(input)?;
    require_calendar(&state, new.calendar_id).await?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_event(&new).await?.into()),
    ))
}

/// Replace an event, or a whole repeating series.
#[utoipa::path(put, path = "/v1/calendar/events/{id}", request_body = EventInput, params(("id" = i64, Path)), responses(
    (status = 200, body = EventDto),
    (status = 400, description = "Empty title, bad times, bad repeat or unknown calendar", body = ErrorBody),
    (status = 404, description = "No such event", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn update_event(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<EventInput>,
) -> Result<Json<EventDto>, ApiError> {
    let new = check_event(input)?;
    require_calendar(&state, new.calendar_id).await?;
    if !state.store.update_event(id, &new).await? {
        return Err(ApiError::NotFound);
    }
    Ok(Json(
        state
            .store
            .calendar_event(id)
            .await?
            .ok_or(ApiError::NotFound)?
            .into(),
    ))
}

/// Delete an event, or a whole repeating series.
#[utoipa::path(delete, path = "/v1/calendar/events/{id}", params(("id" = i64, Path)), responses(
    (status = 204, description = "Deleted"), (status = 404, description = "No such event", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn delete_event(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    if !state.store.delete_event(id).await? {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Delete one occurrence of a repeating event; the rest of the series stays.
#[utoipa::path(post, path = "/v1/calendar/events/{id}/exceptions", request_body = ExceptionInput, params(("id" = i64, Path)), responses(
    (status = 200, body = EventDto),
    (status = 400, description = "The event does not repeat", body = ErrorBody),
    (status = 404, description = "No such event", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn add_exception(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<ExceptionInput>,
) -> Result<Json<EventDto>, ApiError> {
    let mut stored = state
        .store
        .calendar_event(id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if stored.event.repeat_kind == "none" {
        return Err(ApiError::BadRequest("that event does not repeat".into()));
    }
    if !stored.event.exdates.contains(&input.date) {
        stored.event.exdates.push(input.date);
        stored.event.exdates.sort();
    }
    state.store.update_event(id, &stored.event).await?;
    Ok(Json(stored.into()))
}
