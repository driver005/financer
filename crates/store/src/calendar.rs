//! The calendar: calendars (a name and a colour each) and the events in them.
//!
//! Times are wall-clock, as written on the person's own calendar, with no zone: an event at 09:00
//! is at 09:00 wherever the phone is. An all-day event has no times and its end date is inclusive.
//! A repeating event is stored once, with its rule; the client expands it into occurrences for
//! the range it shows. A deleted single occurrence is kept as an exception date on the series.

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, TransactionTrait,
};
use time::{Date, Time};

use crate::{Store, StoreError};

mod calendar_entity {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "calendars")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub name: String,
        /// A tone of the design system: accent, success, warning, danger, info or neutral.
        pub tone: String,
        pub visible: bool,
        pub position: i32,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod event_entity {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "calendar_events")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub calendar_id: i64,
        pub title: String,
        pub notes: Option<String>,
        pub location: Option<String>,
        pub all_day: bool,
        pub start_date: TimeDate,
        pub start_time: Option<TimeTime>,
        pub end_date: TimeDate,
        pub end_time: Option<TimeTime>,
        /// `none`, `daily`, `weekly`, `monthly` or `yearly`.
        pub repeat_kind: String,
        pub repeat_interval: i32,
        /// Weekly only: `MO,WE,FR`. Empty means the weekday of the start.
        pub repeat_weekdays: Option<String>,
        pub repeat_until: Option<TimeDate>,
        pub repeat_count: Option<i32>,
        /// JSON list of `YYYY-MM-DD` occurrences that were deleted from the series.
        pub exdates_json: String,
        /// JSON list of minutes before the start at which to remind.
        pub reminders_json: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// A calendar as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCalendar {
    pub id: i64,
    pub name: String,
    pub tone: String,
    pub visible: bool,
    pub position: i32,
}

/// A calendar to create or to replace the editable fields of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewCalendar {
    pub name: String,
    pub tone: String,
    pub visible: bool,
}

/// An event as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredEvent {
    pub id: i64,
    pub event: NewEvent,
}

/// The fields of an event the person edits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEvent {
    pub calendar_id: i64,
    pub title: String,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub all_day: bool,
    pub start_date: Date,
    pub start_time: Option<Time>,
    pub end_date: Date,
    pub end_time: Option<Time>,
    pub repeat_kind: String,
    pub repeat_interval: u32,
    pub repeat_weekdays: Option<String>,
    pub repeat_until: Option<Date>,
    pub repeat_count: Option<u32>,
    pub exdates: Vec<Date>,
    /// Minutes before the start.
    pub reminders: Vec<u32>,
}

fn stored(m: calendar_entity::Model) -> StoredCalendar {
    StoredCalendar {
        id: m.id,
        name: m.name,
        tone: m.tone,
        visible: m.visible,
        position: m.position,
    }
}

fn dates_to_json(dates: &[Date]) -> String {
    let list: Vec<String> = dates.iter().map(|d| d.to_string()).collect();
    serde_json::to_string(&list).unwrap_or_else(|_| "[]".into())
}

fn dates_from_json(json: &str) -> Vec<Date> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    serde_json::from_str::<Vec<String>>(json)
        .unwrap_or_default()
        .iter()
        .filter_map(|s| Date::parse(s, &format).ok())
        .collect()
}

fn event_from(m: event_entity::Model) -> StoredEvent {
    StoredEvent {
        id: m.id,
        event: NewEvent {
            calendar_id: m.calendar_id,
            title: m.title,
            notes: m.notes,
            location: m.location,
            all_day: m.all_day,
            start_date: m.start_date,
            start_time: m.start_time,
            end_date: m.end_date,
            end_time: m.end_time,
            repeat_kind: m.repeat_kind,
            repeat_interval: m.repeat_interval.max(1) as u32,
            repeat_weekdays: m.repeat_weekdays,
            repeat_until: m.repeat_until,
            repeat_count: m.repeat_count.map(|c| c.max(0) as u32),
            exdates: dates_from_json(&m.exdates_json),
            reminders: serde_json::from_str(&m.reminders_json).unwrap_or_default(),
        },
    }
}

fn active(id: Option<i64>, e: &NewEvent) -> event_entity::ActiveModel {
    event_entity::ActiveModel {
        id: id.map(Set).unwrap_or_default(),
        calendar_id: Set(e.calendar_id),
        title: Set(e.title.clone()),
        notes: Set(e.notes.clone()),
        location: Set(e.location.clone()),
        all_day: Set(e.all_day),
        start_date: Set(e.start_date),
        start_time: Set(e.start_time),
        end_date: Set(e.end_date),
        end_time: Set(e.end_time),
        repeat_kind: Set(e.repeat_kind.clone()),
        repeat_interval: Set(e.repeat_interval.max(1) as i32),
        repeat_weekdays: Set(e.repeat_weekdays.clone()),
        repeat_until: Set(e.repeat_until),
        repeat_count: Set(e.repeat_count.map(|c| c as i32)),
        exdates_json: Set(dates_to_json(&e.exdates)),
        reminders_json: Set(serde_json::to_string(&e.reminders).unwrap_or_else(|_| "[]".into())),
    }
}

impl Store {
    /// The calendars in display order. A first, empty database gets one called "Personal".
    pub async fn calendars(&self) -> Result<Vec<StoredCalendar>, StoreError> {
        if calendar_entity::Entity::find().count(&self.db).await? == 0 {
            calendar_entity::ActiveModel {
                name: Set("Personal".into()),
                tone: Set("accent".into()),
                visible: Set(true),
                position: Set(0),
                ..Default::default()
            }
            .insert(&self.db)
            .await?;
        }
        Ok(calendar_entity::Entity::find()
            .order_by_asc(calendar_entity::Column::Position)
            .order_by_asc(calendar_entity::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(stored)
            .collect())
    }

    pub async fn calendar(&self, id: i64) -> Result<Option<StoredCalendar>, StoreError> {
        Ok(calendar_entity::Entity::find_by_id(id)
            .one(&self.db)
            .await?
            .map(stored))
    }

    /// Adds a calendar at the end of the list.
    pub async fn create_calendar(&self, c: &NewCalendar) -> Result<StoredCalendar, StoreError> {
        let position = calendar_entity::Entity::find().count(&self.db).await? as i32;
        let m = calendar_entity::ActiveModel {
            name: Set(c.name.clone()),
            tone: Set(c.tone.clone()),
            visible: Set(c.visible),
            position: Set(position),
            ..Default::default()
        }
        .insert(&self.db)
        .await?;
        Ok(stored(m))
    }

    /// Replaces name, colour and visibility; false when the calendar does not exist.
    pub async fn update_calendar(&self, id: i64, c: &NewCalendar) -> Result<bool, StoreError> {
        let Some(m) = calendar_entity::Entity::find_by_id(id).one(&self.db).await? else {
            return Ok(false);
        };
        let mut a: calendar_entity::ActiveModel = m.into();
        a.name = Set(c.name.clone());
        a.tone = Set(c.tone.clone());
        a.visible = Set(c.visible);
        a.update(&self.db).await?;
        Ok(true)
    }

    /// Deletes a calendar with all its events; false when it does not exist.
    pub async fn delete_calendar(&self, id: i64) -> Result<bool, StoreError> {
        let tx = self.db.begin().await?;
        event_entity::Entity::delete_many()
            .filter(event_entity::Column::CalendarId.eq(id))
            .exec(&tx)
            .await?;
        let gone = calendar_entity::Entity::delete_by_id(id).exec(&tx).await?;
        tx.commit().await?;
        Ok(gone.rows_affected > 0)
    }

    /// Events that can show up between `from` and `to` (both inclusive): single events that overlap
    /// the range, and every repeating series that has started by `to` and has not ended before `from`.
    /// A series with a count has no end date here; the client counts its occurrences.
    pub async fn calendar_events(
        &self,
        from: Date,
        to: Date,
    ) -> Result<Vec<StoredEvent>, StoreError> {
        use sea_orm::Condition;
        let single = Condition::all()
            .add(event_entity::Column::RepeatKind.eq("none"))
            .add(event_entity::Column::StartDate.lte(to))
            .add(event_entity::Column::EndDate.gte(from));
        let series = Condition::all()
            .add(event_entity::Column::RepeatKind.ne("none"))
            .add(event_entity::Column::StartDate.lte(to))
            .add(
                Condition::any()
                    .add(event_entity::Column::RepeatUntil.is_null())
                    .add(event_entity::Column::RepeatUntil.gte(from)),
            );
        Ok(event_entity::Entity::find()
            .filter(Condition::any().add(single).add(series))
            .order_by_asc(event_entity::Column::StartDate)
            .order_by_asc(event_entity::Column::StartTime)
            .order_by_asc(event_entity::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(event_from)
            .collect())
    }

    pub async fn calendar_event(&self, id: i64) -> Result<Option<StoredEvent>, StoreError> {
        Ok(event_entity::Entity::find_by_id(id)
            .one(&self.db)
            .await?
            .map(event_from))
    }

    pub async fn create_event(&self, e: &NewEvent) -> Result<StoredEvent, StoreError> {
        let m = active(None, e).insert(&self.db).await?;
        Ok(event_from(m))
    }

    /// Replaces an event; false when it does not exist.
    pub async fn update_event(&self, id: i64, e: &NewEvent) -> Result<bool, StoreError> {
        if event_entity::Entity::find_by_id(id)
            .one(&self.db)
            .await?
            .is_none()
        {
            return Ok(false);
        }
        active(Some(id), e).update(&self.db).await?;
        Ok(true)
    }

    /// Deletes an event or a whole series; false when it does not exist.
    pub async fn delete_event(&self, id: i64) -> Result<bool, StoreError> {
        let gone = event_entity::Entity::delete_by_id(id).exec(&self.db).await?;
        Ok(gone.rows_affected > 0)
    }

    /// Every event, for the export.
    pub async fn all_calendar_events(&self) -> Result<Vec<StoredEvent>, StoreError> {
        Ok(event_entity::Entity::find()
            .order_by_asc(event_entity::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(event_from)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, time};

    fn event(calendar_id: i64, title: &str, start: Date, end: Date) -> NewEvent {
        NewEvent {
            calendar_id,
            title: title.into(),
            notes: None,
            location: None,
            all_day: false,
            start_date: start,
            start_time: Some(time!(09:00)),
            end_date: end,
            end_time: Some(time!(10:00)),
            repeat_kind: "none".into(),
            repeat_interval: 1,
            repeat_weekdays: None,
            repeat_until: None,
            repeat_count: None,
            exdates: vec![],
            reminders: vec![10],
        }
    }

    #[tokio::test]
    async fn a_first_database_has_one_personal_calendar() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let cals = store.calendars().await.unwrap();
        assert_eq!(cals.len(), 1);
        assert_eq!(cals[0].name, "Personal");
        // asking again does not add another
        assert_eq!(store.calendars().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn calendars_are_created_changed_and_deleted_with_their_events() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let personal = store.calendars().await.unwrap()[0].id;
        let work = store
            .create_calendar(&NewCalendar { name: "Work".into(), tone: "info".into(), visible: true })
            .await
            .unwrap();
        assert_eq!(work.position, 1);
        assert!(store
            .update_calendar(work.id, &NewCalendar { name: "Job".into(), tone: "danger".into(), visible: false })
            .await
            .unwrap());
        let job = store.calendar(work.id).await.unwrap().unwrap();
        assert_eq!((job.name.as_str(), job.tone.as_str(), job.visible), ("Job", "danger", false));
        assert!(!store
            .update_calendar(999, &NewCalendar { name: "x".into(), tone: "info".into(), visible: true })
            .await
            .unwrap());

        store.create_event(&event(work.id, "Standup", date!(2026 - 11 - 03), date!(2026 - 11 - 03))).await.unwrap();
        store.create_event(&event(personal, "Dentist", date!(2026 - 11 - 04), date!(2026 - 11 - 04))).await.unwrap();
        assert!(store.delete_calendar(work.id).await.unwrap());
        let left = store.calendar_events(date!(2026 - 11 - 01), date!(2026 - 11 - 30)).await.unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].event.title, "Dentist");
        assert!(!store.delete_calendar(work.id).await.unwrap());
    }

    #[tokio::test]
    async fn a_range_finds_events_that_overlap_it() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let cal = store.calendars().await.unwrap()[0].id;
        // a trip that starts before the range and ends inside it, one fully inside, one after
        store.create_event(&event(cal, "Trip", date!(2026 - 10 - 29), date!(2026 - 11 - 02))).await.unwrap();
        store.create_event(&event(cal, "Lunch", date!(2026 - 11 - 10), date!(2026 - 11 - 10))).await.unwrap();
        store.create_event(&event(cal, "Later", date!(2026 - 12 - 01), date!(2026 - 12 - 01))).await.unwrap();
        store.create_event(&event(cal, "Earlier", date!(2026 - 10 - 01), date!(2026 - 10 - 01))).await.unwrap();
        let titles: Vec<_> = store
            .calendar_events(date!(2026 - 11 - 01), date!(2026 - 11 - 30))
            .await
            .unwrap()
            .into_iter()
            .map(|e| e.event.title)
            .collect();
        assert_eq!(titles, ["Trip", "Lunch"]);
    }

    #[tokio::test]
    async fn a_series_is_found_while_it_runs_and_keeps_its_rule_and_exceptions() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let cal = store.calendars().await.unwrap()[0].id;
        let mut weekly = event(cal, "Gym", date!(2026 - 09 - 07), date!(2026 - 09 - 07));
        weekly.repeat_kind = "weekly".into();
        weekly.repeat_weekdays = Some("MO,TH".into());
        weekly.exdates = vec![date!(2026 - 11 - 05)];
        let saved = store.create_event(&weekly).await.unwrap();
        let mut ended = event(cal, "Course", date!(2026 - 09 - 01), date!(2026 - 09 - 01));
        ended.repeat_kind = "daily".into();
        ended.repeat_until = Some(date!(2026 - 09 - 30));
        store.create_event(&ended).await.unwrap();

        let found = store.calendar_events(date!(2026 - 11 - 01), date!(2026 - 11 - 30)).await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].event, weekly);
        assert_eq!(found[0].id, saved.id);
        // before the series started, nothing
        assert!(store.calendar_events(date!(2026 - 08 - 01), date!(2026 - 08 - 31)).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn events_are_replaced_and_deleted_and_all_day_has_no_times() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let cal = store.calendars().await.unwrap()[0].id;
        let saved = store.create_event(&event(cal, "Draft", date!(2026 - 11 - 03), date!(2026 - 11 - 03))).await.unwrap();
        let mut changed = saved.event.clone();
        changed.title = "Holiday".into();
        changed.all_day = true;
        changed.start_time = None;
        changed.end_time = None;
        changed.end_date = date!(2026 - 11 - 07);
        changed.location = Some("Sylt".into());
        assert!(store.update_event(saved.id, &changed).await.unwrap());
        assert_eq!(store.calendar_event(saved.id).await.unwrap().unwrap().event, changed);
        assert!(!store.update_event(999, &changed).await.unwrap());
        assert!(store.delete_event(saved.id).await.unwrap());
        assert!(!store.delete_event(saved.id).await.unwrap());
        assert!(store.calendar_event(saved.id).await.unwrap().is_none());
    }
}
