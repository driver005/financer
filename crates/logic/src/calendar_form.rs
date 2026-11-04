//! The event editor's draft: what the form edits, how it starts (a new event on a day or at a time,
//! or an existing occurrence), whether it is valid, and the request it turns into.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::calendar::{
    add_days, days_between, from_day_number, minutes_of, stamp, time_of, weekday_index,
    WEEKDAY_CODES,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    /// Set when editing an existing event.
    pub id: Option<i64>,
    pub calendar_id: Option<i64>,
    pub title: String,
    pub notes: String,
    pub location: String,
    pub all_day: bool,
    pub start_date: String,
    pub start_time: String,
    pub end_date: String,
    pub end_time: String,
    /// `{ kind, interval, weekdays, until?, count? }`, as the calendar module reads it.
    pub repeat: Value,
    pub exceptions: Vec<String>,
    pub reminders: Vec<i64>,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

/// JavaScript's `Number(v)` for an id that may arrive as a number or as text.
fn number_of(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn weekdays(repeat: &Value) -> Vec<String> {
    strings(repeat.get("weekdays"))
}

fn kind(repeat: &Value) -> &str {
    repeat.get("kind").and_then(Value::as_str).unwrap_or("none")
}

/// A new event on a day, at a time when given, one hour long.
pub fn new_draft(date: &str, calendar_id: Option<i64>, time: Option<&str>) -> Draft {
    let start = time.unwrap_or("09:00");
    let end = (minutes_of(start) + 60).min(23 * 60 + 59);
    Draft {
        id: None,
        calendar_id,
        title: String::new(),
        notes: String::new(),
        location: String::new(),
        all_day: false,
        start_date: date.into(),
        start_time: start.into(),
        end_date: date.into(),
        end_time: time_of(end as f64),
        repeat: json!({ "kind": "none", "interval": 1, "weekdays": [] }),
        exceptions: vec![],
        reminders: vec![10],
    }
}

/// The rule the server stores for an event it sent (the API's `EventDto`, snake_case, in the calendar's own words).
pub fn rule_from_dto(e: &Value) -> Value {
    let repeat = e.get("repeat").cloned().unwrap_or(Value::Null);
    json!({
        "id": e.get("id").cloned().unwrap_or(Value::Null),
        "calendarId": e.get("calendar_id").cloned().unwrap_or(Value::Null),
        "title": e.get("title").cloned().unwrap_or(Value::Null),
        "notes": e.get("notes").cloned().unwrap_or(Value::Null),
        "location": e.get("location").cloned().unwrap_or(Value::Null),
        "allDay": e.get("all_day").cloned().unwrap_or(Value::Null),
        "startDate": e.get("start_date").cloned().unwrap_or(Value::Null),
        "startTime": e.get("start_time").cloned().unwrap_or(Value::Null),
        "endDate": e.get("end_date").cloned().unwrap_or(Value::Null),
        "endTime": e.get("end_time").cloned().unwrap_or(Value::Null),
        "repeat": {
            "kind": repeat.get("kind").cloned().unwrap_or(Value::Null),
            "interval": repeat.get("interval").cloned().unwrap_or(Value::Null),
            "weekdays": repeat.get("weekdays").cloned().unwrap_or(Value::Null),
            "until": repeat.get("until").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null),
            "count": repeat.get("count").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null),
        },
        "exceptions": e.get("exceptions").cloned().unwrap_or(Value::Null),
        "reminders": e.get("reminders").cloned().unwrap_or(Value::Null),
    })
}

/// The draft for editing an event: its first occurrence's dates (editing changes the whole series).
pub fn draft_from_rule(rule: &Value) -> Draft {
    let start_time = text(rule, "startTime");
    let end_time = text(rule, "endTime").unwrap_or_else(|| {
        time_of((minutes_of(start_time.as_deref().unwrap_or("09:00")) + 60) as f64)
    });
    Draft {
        id: number_of(rule.get("id")),
        calendar_id: number_of(rule.get("calendarId")),
        title: text(rule, "title").unwrap_or_default(),
        notes: text(rule, "notes").unwrap_or_default(),
        location: text(rule, "location").unwrap_or_default(),
        all_day: rule.get("allDay").and_then(Value::as_bool).unwrap_or(false),
        start_date: text(rule, "startDate").unwrap_or_default(),
        start_time: start_time.unwrap_or_else(|| "09:00".into()),
        end_date: text(rule, "endDate").unwrap_or_default(),
        end_time,
        repeat: rule
            .get("repeat")
            .cloned()
            .unwrap_or_else(|| json!({ "kind": "none", "interval": 1, "weekdays": [] })),
        exceptions: strings(rule.get("exceptions")),
        reminders: rule
            .get("reminders")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_i64).collect())
            .unwrap_or_default(),
    }
}

/// Moves the end with the start so the length stays (as other calendars do when the start changes).
pub fn move_start(d: &Draft, date: &str, time: Option<&str>) -> Result<Draft, String> {
    let mut out = d.clone();
    if d.all_day {
        let length = days_between(&d.start_date, &d.end_date)?.max(0);
        out.start_date = date.into();
        out.end_date = add_days(date, length)?;
        return Ok(out);
    }
    let time = time.unwrap_or(&d.start_time);
    let length = (stamp(&d.end_date, Some(&d.end_time))?
        - stamp(&d.start_date, Some(&d.start_time))?)
    .max(0);
    let end = stamp(date, Some(time))? + length;
    out.start_date = date.into();
    out.start_time = time.into();
    out.end_date = from_day_number(end.div_euclid(1440))?;
    out.end_time = time_of(end.rem_euclid(1440) as f64);
    Ok(out)
}

/// Switching the repeat kind: weekly starts on the weekday of the event.
pub fn set_repeat_kind(d: &Draft, kind: &str) -> Result<Draft, String> {
    let weekdays: Vec<&str> = if kind == "weekly" {
        vec![WEEKDAY_CODES[weekday_index(&d.start_date)?]]
    } else {
        vec![]
    };
    let mut out = d.clone();
    out.repeat =
        json!({ "kind": kind, "interval": 1, "weekdays": weekdays, "until": null, "count": null });
    Ok(out)
}

pub fn toggle_weekday(d: &Draft, code: &str) -> Draft {
    let mut days = weekdays(&d.repeat);
    let has = days.iter().any(|c| c == code);
    if has && days.len() == 1 {
        return d.clone(); // a weekly event needs a weekday
    }
    if has {
        days.retain(|c| c != code);
    } else {
        days.push(code.to_string());
    }
    let order = |c: &String| {
        WEEKDAY_CODES
            .iter()
            .position(|w| w == c)
            .map_or(-1, |i| i as i64)
    };
    days.sort_by_key(order);
    let mut out = d.clone();
    if let Some(r) = out.repeat.as_object_mut() {
        r.insert("weekdays".into(), json!(days));
    }
    out
}

pub fn toggle_reminder(d: &Draft, minutes: i64) -> Draft {
    let mut out = d.clone();
    if out.reminders.contains(&minutes) {
        out.reminders.retain(|m| *m != minutes);
    } else {
        out.reminders.push(minutes);
        out.reminders.sort();
    }
    out
}

/// The first problem with the draft in words, or `None` when it can be saved.
pub fn problem(d: &Draft) -> Option<&'static str> {
    if d.title.trim().is_empty() {
        return Some("Give the event a title.");
    }
    if d.calendar_id.is_none() {
        return Some("Pick a calendar.");
    }
    if d.end_date < d.start_date {
        return Some("The event ends before it starts.");
    }
    if !d.all_day
        && d.end_date == d.start_date
        && minutes_of(&d.end_time) < minutes_of(&d.start_time)
    {
        return Some("The event ends before it starts.");
    }
    let repeating = kind(&d.repeat) != "none";
    if repeating {
        if let Some(until) = d
            .repeat
            .get("until")
            .and_then(Value::as_str)
            .filter(|u| !u.is_empty())
        {
            if until < d.start_date.as_str() {
                return Some("The repeat ends before the event starts.");
            }
        }
        if d.repeat
            .get("count")
            .and_then(Value::as_f64)
            .is_some_and(|c| c < 1.0)
        {
            return Some("Repeat at least once.");
        }
    }
    None
}

fn non_empty(s: &str) -> Value {
    let t = s.trim();
    if t.is_empty() {
        Value::Null
    } else {
        Value::String(t.into())
    }
}

/// The request body for saving the draft (the API's `EventInput`). Call only when `problem` is `None`.
pub fn to_input(d: &Draft) -> Value {
    let repeating = kind(&d.repeat) != "none";
    let count = d.repeat.get("count").filter(|c| !c.is_null()).cloned();
    let interval = d
        .repeat
        .get("interval")
        .and_then(Value::as_i64)
        .unwrap_or(1)
        .clamp(1, 99);
    let until = if repeating && count.is_none() {
        d.repeat
            .get("until")
            .cloned()
            .filter(|u| !u.is_null())
            .unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    let mut repeat = Map::new();
    repeat.insert("kind".into(), json!(kind(&d.repeat)));
    repeat.insert(
        "interval".into(),
        json!(if repeating { interval } else { 1 }),
    );
    repeat.insert(
        "weekdays".into(),
        json!(if kind(&d.repeat) == "weekly" {
            weekdays(&d.repeat)
        } else {
            vec![]
        }),
    );
    repeat.insert("until".into(), until);
    repeat.insert(
        "count".into(),
        if repeating {
            count.unwrap_or(Value::Null)
        } else {
            Value::Null
        },
    );
    json!({
        "calendar_id": d.calendar_id.unwrap_or(0),
        "title": d.title.trim(),
        "notes": non_empty(&d.notes),
        "location": non_empty(&d.location),
        "all_day": d.all_day,
        "start_date": d.start_date,
        "start_time": if d.all_day { Value::Null } else { json!(d.start_time) },
        "end_date": d.end_date,
        "end_time": if d.all_day { Value::Null } else { json!(d.end_time) },
        "repeat": repeat,
        "exceptions": d.exceptions,
        "reminders": d.reminders,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_event_is_an_hour_long() {
        let d = new_draft("2026-11-04", Some(1), Some("23:30"));
        assert_eq!(
            (d.start_time.as_str(), d.end_time.as_str()),
            ("23:30", "23:59")
        );
        let d = new_draft("2026-11-04", Some(1), None);
        assert_eq!(
            (d.start_time.as_str(), d.end_time.as_str()),
            ("09:00", "10:00")
        );
        assert_eq!(d.reminders, [10]);
    }

    #[test]
    fn moving_the_start_keeps_the_length_even_over_midnight() {
        let mut d = new_draft("2026-11-04", Some(1), Some("22:00"));
        d.end_time = "23:00".into();
        let m = move_start(&d, "2026-11-05", Some("23:30")).unwrap();
        assert_eq!(
            (
                m.start_date.as_str(),
                m.end_date.as_str(),
                m.end_time.as_str()
            ),
            ("2026-11-05", "2026-11-06", "00:30")
        );
    }

    #[test]
    fn weekly_starts_on_the_weekday_and_keeps_one() {
        let d = set_repeat_kind(&new_draft("2026-11-04", Some(1), None), "weekly").unwrap();
        assert_eq!(d.repeat["weekdays"], json!(["WE"]));
        let t = toggle_weekday(&d, "WE");
        assert_eq!(t.repeat["weekdays"], json!(["WE"]));
        let t = toggle_weekday(&toggle_weekday(&d, "MO"), "FR");
        assert_eq!(t.repeat["weekdays"], json!(["MO", "WE", "FR"]));
    }

    #[test]
    fn problems_are_named_in_order() {
        let mut d = new_draft("2026-11-04", None, None);
        assert_eq!(problem(&d), Some("Give the event a title."));
        d.title = "x".into();
        assert_eq!(problem(&d), Some("Pick a calendar."));
        d.calendar_id = Some(1);
        d.end_time = "08:00".into();
        assert_eq!(problem(&d), Some("The event ends before it starts."));
    }

    #[test]
    fn the_input_drops_what_a_single_event_does_not_use() {
        let mut d = new_draft("2026-11-04", Some(2), None);
        d.title = "  Lunch ".into();
        let i = to_input(&d);
        assert_eq!(i["title"], "Lunch");
        assert_eq!(i["notes"], Value::Null);
        assert_eq!(
            i["repeat"],
            json!({ "kind": "none", "interval": 1, "weekdays": [], "until": null, "count": null })
        );
    }
}
