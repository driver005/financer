//! The calendar's logic, without any screen: date arithmetic on `YYYY-MM-DD` strings, expanding a
//! repeating event into the occurrences of a range, laying out overlapping events in a day column,
//! the month grid, and reading a quick-add sentence.
//!
//! Dates are `YYYY-MM-DD` and times `HH:MM`, wall-clock with no zone: an event at 09:00 is at 09:00
//! wherever the phone is. Weeks start on Monday.

use std::cmp::Ordering;
use std::collections::BTreeSet;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::Date;

use crate::format::date_of;
use crate::period::{iso, MONTH_NAMES};

pub const WEEKDAY_CODES: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
pub const WEEKDAY_NAMES: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];
pub const WEEKDAY_SHORT: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MINUTES_PER_DAY: i64 = 24 * 60;
/// Hard stop for expanding a series, so a broken rule can never hang the screen.
const MAX_STEPS: i64 = 5000;
/// Events whose starts are this close (minutes) would hide each other's titles, so they sit side by side.
pub const SAME_START_MINUTES: i64 = 30;
/// The shortest a block is drawn, so a 5-minute event can still be seen and tapped.
pub const MIN_BLOCK_MINUTES: i64 = 30;

// ---- dates ----

pub(crate) fn ymd(iso_date: &str) -> Result<(i32, u8, u8), String> {
    let d = date_of(iso_date)?;
    Ok((d.year(), d.month() as u8, d.day()))
}

/// Whole days since 1970-01-01.
pub fn day_number(iso_date: &str) -> Result<i64, String> {
    Ok(i64::from(date_of(iso_date)?.to_julian_day()) - 2_440_588)
}

pub fn from_day_number(n: i64) -> Result<String, String> {
    let jd = i32::try_from(n + 2_440_588).map_err(|_| format!("{n} is out of range"))?;
    Ok(iso(Date::from_julian_day(jd).map_err(|e| e.to_string())?))
}

pub fn iso_of(y: i64, m: i64, d: i64) -> String {
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn add_days(iso_date: &str, n: i64) -> Result<String, String> {
    from_day_number(day_number(iso_date)? + n)
}

pub fn days_between(a: &str, b: &str) -> Result<i64, String> {
    Ok(day_number(b)? - day_number(a)?)
}

fn dim(y: i64, m: i64) -> i64 {
    let month = time::Month::try_from(m as u8).unwrap_or(time::Month::January);
    i64::from(month.length(y as i32))
}

/// 0 = Monday ... 6 = Sunday.
pub fn weekday_index(iso_date: &str) -> Result<usize, String> {
    Ok(date_of(iso_date)?.weekday().number_days_from_monday() as usize)
}

pub fn start_of_week(iso_date: &str) -> Result<String, String> {
    add_days(iso_date, -(weekday_index(iso_date)? as i64))
}

/// Moves by whole months; a day that the target month lacks becomes its last day (31 Jan + 1 month = 28 Feb).
pub fn add_months(iso_date: &str, n: i64) -> Result<String, String> {
    let (y, m, d) = ymd(iso_date)?;
    let index = i64::from(y) * 12 + (i64::from(m) - 1) + n;
    let (ny, nm) = (index.div_euclid(12), index.rem_euclid(12) + 1);
    Ok(iso_of(ny, nm, i64::from(d).min(dim(ny, nm))))
}

pub fn add_years(iso_date: &str, n: i64) -> Result<String, String> {
    add_months(iso_date, n * 12)
}

pub fn month_first(iso_date: &str) -> Result<String, String> {
    let (y, m, _) = ymd(iso_date)?;
    Ok(iso_of(y.into(), m.into(), 1))
}

pub fn month_last(iso_date: &str) -> Result<String, String> {
    let (y, m, _) = ymd(iso_date)?;
    Ok(iso_of(y.into(), m.into(), dim(y.into(), m.into())))
}

/// The seven days of the week that holds `iso_date`, Monday first.
pub fn week_of(iso_date: &str) -> Result<Vec<String>, String> {
    let start = start_of_week(iso_date)?;
    (0..7).map(|i| add_days(&start, i)).collect()
}

/// The weeks that show a month, Monday first: the days of the month plus the neighbours that fill the rows.
pub fn month_grid(iso_date: &str) -> Result<Vec<Vec<String>>, String> {
    let start = start_of_week(&month_first(iso_date)?)?;
    let weeks = (days_between(&start, &month_last(iso_date)?)? + 1 + 6) / 7;
    (0..weeks)
        .map(|w| (0..7).map(|d| add_days(&start, w * 7 + d)).collect())
        .collect()
}

pub fn month_title(iso_date: &str) -> Result<String, String> {
    let (y, m, _) = ymd(iso_date)?;
    Ok(format!("{} {y}", MONTH_NAMES[m as usize - 1]))
}

/// `Tuesday, 3 November` (with the year when it is not `reference`'s year).
pub fn long_day(iso_date: &str, reference: Option<&str>) -> Result<String, String> {
    let (y, m, d) = ymd(iso_date)?;
    let year = match reference {
        Some(r) if ymd(r)?.0 == y => String::new(),
        _ => format!(" {y}"),
    };
    Ok(format!(
        "{}, {d} {}{year}",
        WEEKDAY_NAMES[weekday_index(iso_date)?],
        MONTH_NAMES[m as usize - 1]
    ))
}

fn short_month(m: u8) -> &'static str {
    &MONTH_NAMES[m as usize - 1][..3]
}

/// `3 Nov`
pub fn short_day(iso_date: &str) -> Result<String, String> {
    let (_, m, d) = ymd(iso_date)?;
    Ok(format!("{d} {}", short_month(m)))
}

/// What a week view calls its range: `2 - 8 Nov 2026`, `26 Oct - 1 Nov 2026`, `28 Dec 2026 - 3 Jan 2027`.
pub fn week_title(iso_date: &str) -> Result<String, String> {
    let days = week_of(iso_date)?;
    let (a, b) = (ymd(&days[0])?, ymd(&days[6])?);
    Ok(if a.0 != b.0 {
        format!(
            "{} {} {} - {} {} {}",
            a.2,
            short_month(a.1),
            a.0,
            b.2,
            short_month(b.1),
            b.0
        )
    } else if a.1 != b.1 {
        format!(
            "{} {} - {} {} {}",
            a.2,
            short_month(a.1),
            b.2,
            short_month(b.1),
            b.0
        )
    } else {
        format!("{} - {} {} {}", a.2, b.2, short_month(b.1), b.0)
    })
}

// ---- times ----

pub fn minutes_of(time: &str) -> i64 {
    let mut p = time.split(':');
    let h: i64 = p.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let m: i64 = p.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    h * 60 + m
}

pub fn time_of(minutes: f64) -> String {
    let rounded = (minutes + 0.5).floor() as i64; // as JavaScript rounds: halves go up
    let m = rounded.rem_euclid(MINUTES_PER_DAY);
    format!("{:02}:{:02}", m / 60, m % 60)
}

/// An absolute minute count since 1970 for a date and a time (a missing time is the start of the day).
pub fn stamp(date: &str, time: Option<&str>) -> Result<i64, String> {
    Ok(day_number(date)? * MINUTES_PER_DAY + time.filter(|t| !t.is_empty()).map_or(0, minutes_of))
}

// ---- events and occurrences ----

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Repeat {
    pub kind: String,
    #[serde(default = "one")]
    pub interval: i64,
    #[serde(default)]
    pub weekdays: Vec<String>,
    #[serde(default)]
    pub until: Option<String>,
    #[serde(default)]
    pub count: Option<i64>,
}

fn one() -> i64 {
    1
}

impl Default for Repeat {
    fn default() -> Self {
        Repeat {
            kind: "none".into(),
            interval: 1,
            weekdays: vec![],
            until: None,
            count: None,
        }
    }
}

/// What the server stores: an event with its repeat rule.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRule {
    pub id: Value,
    #[serde(default)]
    pub calendar_id: Value,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub all_day: bool,
    pub start_date: String,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_date: String,
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default)]
    pub repeat: Repeat,
    #[serde(default)]
    pub exceptions: Vec<String>,
    #[serde(default)]
    pub reminders: Vec<i64>,
}

/// The part of a rule that decides the start dates of a series.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesRule {
    pub start_date: String,
    #[serde(default)]
    pub repeat: Repeat,
    #[serde(default)]
    pub exceptions: Vec<String>,
}

/// One event as it shows on one run of the calendar: a single event, or one occurrence of a series.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    /// Unique among the occurrences on screen.
    pub key: String,
    pub event_id: Value,
    pub calendar_id: Value,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    pub all_day: bool,
    pub start_date: String,
    pub start_time: Option<String>,
    pub end_date: String,
    pub end_time: Option<String>,
    pub tone: String,
    /// Part of a repeating series.
    pub repeats: bool,
    /// Comes from another part of the app and cannot be edited here.
    pub read_only: bool,
    /// Where tapping it leads, for events from the rest of the app.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    /// A small word for what it is ("Payday", "Meal"), for the detail view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extra {
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub href: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

/// The part of an occurrence that says when it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct When {
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub start_date: String,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_date: String,
    #[serde(default)]
    pub end_time: Option<String>,
}

/// `9:30 - 10:30`, or `9:30 - 10:30 (until 5 Nov)` across days.
pub fn time_range(o: &When) -> Result<String, String> {
    let (Some(start), Some(end)) = (o.start_time.as_deref(), o.end_time.as_deref()) else {
        return Ok("All day".into());
    };
    if o.all_day || start.is_empty() || end.is_empty() {
        return Ok("All day".into());
    }
    let range = format!("{start} - {end}");
    Ok(if o.end_date == o.start_date {
        range
    } else {
        format!("{range} (until {})", short_day(&o.end_date)?)
    })
}

/// The start dates of a series that fall within [from, to], in order. A series with a count counts
/// from its first start (deleted occurrences still count, as in other calendars).
pub fn series_starts(rule: &SeriesRule, from: &str, to: &str) -> Result<Vec<String>, String> {
    let r = &rule.repeat;
    let start = rule.start_date.as_str();
    if r.kind == "none" {
        return Ok(if start >= from && start <= to {
            vec![start.to_string()]
        } else {
            vec![]
        });
    }
    let interval = r.interval.max(1);
    let last = match &r.until {
        Some(u) if u.as_str() < to => u.as_str(),
        _ => to,
    };
    let skip: BTreeSet<&str> = rule.exceptions.iter().map(String::as_str).collect();
    let mut out = Vec::new();
    let mut produced = 0;
    // returns false when the series is over
    let mut take = |d: &str| -> bool {
        if r.until.as_deref().is_some_and(|u| d > u) {
            return false;
        }
        if r.count.is_some_and(|c| c > 0 && produced >= c) {
            return false;
        }
        produced += 1;
        if d >= from && d <= last && !skip.contains(d) {
            out.push(d.to_string());
        }
        d <= last
    };

    match r.kind.as_str() {
        "daily" => {
            for i in 0..MAX_STEPS {
                if !take(&add_days(start, i * interval)?) {
                    break;
                }
            }
        }
        "weekly" => {
            let mut wanted: Vec<usize> = if r.weekdays.is_empty() {
                vec![weekday_index(start)?]
            } else {
                r.weekdays
                    .iter()
                    .filter_map(|c| WEEKDAY_CODES.iter().position(|w| w == c))
                    .collect()
            };
            wanted.sort_unstable();
            let week0 = start_of_week(start)?;
            'outer: for w in 0..MAX_STEPS {
                let week_start = add_days(&week0, w * 7 * interval)?;
                if week_start.as_str() > last {
                    break;
                }
                for wd in &wanted {
                    let d = add_days(&week_start, *wd as i64)?;
                    if d.as_str() < start {
                        continue;
                    }
                    if !take(&d) {
                        break 'outer;
                    }
                }
            }
        }
        "monthly" => {
            for i in 0..MAX_STEPS {
                if !take(&add_months(start, i * interval)?) {
                    break;
                }
            }
        }
        _ => {
            for i in 0..MAX_STEPS {
                if !take(&add_years(start, i * interval)?) {
                    break;
                }
            }
        }
    }
    Ok(out)
}

/// The occurrences of an event that show between `from` and `to` (inclusive), with multi-day ones that started earlier.
pub fn expand(
    rule: &EventRule,
    from: &str,
    to: &str,
    tone: &str,
    extra: &Extra,
) -> Result<Vec<Occurrence>, String> {
    let end_date = if rule.end_date.is_empty() {
        &rule.start_date
    } else {
        &rule.end_date
    };
    let span = days_between(&rule.start_date, end_date)?.max(0);
    // an occurrence that began up to `span` days before the range can still be running in it
    let series = SeriesRule {
        start_date: rule.start_date.clone(),
        repeat: rule.repeat.clone(),
        exceptions: rule.exceptions.clone(),
    };
    let starts = series_starts(&series, &add_days(from, -span)?, to)?;
    let repeats = rule.repeat.kind != "none";
    let id = match &rule.id {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let mut out = Vec::new();
    for start_date in starts {
        let end = add_days(&start_date, span)?;
        if end.as_str() >= from && start_date.as_str() <= to {
            out.push(Occurrence {
                key: format!("{id}:{start_date}"),
                event_id: rule.id.clone(),
                calendar_id: rule.calendar_id.clone(),
                title: rule.title.clone(),
                notes: rule.notes.clone(),
                location: rule.location.clone(),
                all_day: rule.all_day,
                start_date,
                start_time: if rule.all_day {
                    None
                } else {
                    rule.start_time.clone()
                },
                end_date: end,
                end_time: if rule.all_day {
                    None
                } else {
                    rule.end_time.clone()
                },
                tone: tone.to_string(),
                repeats,
                read_only: extra.read_only,
                href: extra.href.clone(),
                source: extra.source.clone(),
            });
        }
    }
    Ok(out)
}

impl Occurrence {
    pub(crate) fn when(&self) -> When {
        When {
            all_day: self.all_day,
            start_date: self.start_date.clone(),
            start_time: self.start_time.clone(),
            end_date: self.end_date.clone(),
            end_time: self.end_time.clone(),
        }
    }
}

/// Does the occurrence touch this day?
pub fn on_day(o: &When, date: &str) -> bool {
    o.start_date.as_str() <= date && o.end_date.as_str() >= date
}

/// Order for lists: all-day first, then by start.
pub fn by_start(a: &Occurrence, b: &Occurrence) -> Result<Ordering, String> {
    if a.all_day != b.all_day {
        return Ok(if a.all_day {
            Ordering::Less
        } else {
            Ordering::Greater
        });
    }
    let key = |o: &Occurrence| -> Result<(i64, i64), String> {
        Ok((
            stamp(&o.start_date, o.start_time.as_deref())?,
            stamp(&o.end_date, o.end_time.as_deref())?,
        ))
    };
    let (ka, kb) = (key(a)?, key(b)?);
    // titles compare the way a person sorts them: ignoring case first
    Ok(ka
        .cmp(&kb)
        .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        .then_with(|| a.title.cmp(&b.title)))
}

/// Occurrences by day for a range, each list in display order.
pub fn group_by_day(
    occurrences: &[Occurrence],
    from: &str,
    to: &str,
) -> Result<Vec<(String, Vec<Occurrence>)>, String> {
    let mut days: Vec<(String, Vec<Occurrence>)> = Vec::new();
    let mut d = from.to_string();
    while d.as_str() <= to {
        days.push((d.clone(), Vec::new()));
        d = add_days(&d, 1)?;
    }
    for o in occurrences {
        let mut d = if o.start_date.as_str() < from {
            from.to_string()
        } else {
            o.start_date.clone()
        };
        while d <= o.end_date && d.as_str() <= to {
            let i = day_number(&d)? - day_number(from)?;
            if let Some((_, list)) = usize::try_from(i).ok().and_then(|i| days.get_mut(i)) {
                list.push(o.clone());
            }
            d = add_days(&d, 1)?;
        }
    }
    for (_, list) in &mut days {
        let mut failed = None;
        list.sort_by(|a, b| {
            by_start(a, b).unwrap_or_else(|e| {
                failed = Some(e);
                Ordering::Equal
            })
        });
        if let Some(e) = failed {
            return Err(e);
        }
    }
    Ok(days)
}

// ---- the day column of the week and day views ----

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub occurrence: Occurrence,
    /// Minutes from the start of the day.
    pub top: i64,
    pub bottom: i64,
    /// Which of `columns` side-by-side columns it sits in.
    pub column: i64,
    pub columns: i64,
    /// How it is drawn: events that start at about the same time share the width side by side (`lane`
    /// of `lanes`), later starts lie on top of earlier ones (`depth` of `depths`).
    pub lane: i64,
    pub lanes: i64,
    pub depth: i64,
    pub depths: i64,
}

#[derive(Clone)]
struct Placed {
    occurrence: Occurrence,
    top: i64,
    bottom: i64,
    column: i64,
}

fn flush(cluster: &mut Vec<Placed>, blocks: &mut Vec<Block>) {
    let columns = cluster.iter().map(|b| b.column + 1).max().unwrap_or(0);
    // bands: blocks starting together; the bands of a cluster lie on top of each other
    let mut bands: Vec<Vec<Placed>> = Vec::new();
    for b in cluster.iter() {
        match bands.last_mut() {
            Some(band) if b.top - band[0].top < SAME_START_MINUTES => band.push(b.clone()),
            _ => bands.push(vec![b.clone()]),
        }
    }
    let depths = bands.len() as i64;
    for (depth, band) in bands.iter().enumerate() {
        for (lane, b) in band.iter().enumerate() {
            blocks.push(Block {
                occurrence: b.occurrence.clone(),
                top: b.top,
                bottom: b.bottom,
                column: b.column,
                columns,
                lane: lane as i64,
                lanes: band.len() as i64,
                depth: depth as i64,
                depths,
            });
        }
    }
    cluster.clear();
}

/// Timed events of one day as blocks in columns: events that overlap each other share the width of
/// the day. Events that continue past midnight are cut at the day's edges.
pub fn day_blocks(list: &[Occurrence], date: &str) -> Vec<Block> {
    let mut timed: Vec<(Occurrence, i64, i64)> = list
        .iter()
        .filter(|o| !o.all_day && on_day(&o.when(), date))
        .map(|o| {
            let top = match (&o.start_time, o.start_date.as_str() < date) {
                (Some(t), false) if !t.is_empty() => minutes_of(t),
                _ => 0,
            };
            let end = match (&o.end_time, o.end_date.as_str() > date) {
                (Some(t), false) if !t.is_empty() => minutes_of(t),
                _ => MINUTES_PER_DAY,
            };
            (
                o.clone(),
                top,
                MINUTES_PER_DAY.min(end.max(top + MIN_BLOCK_MINUTES)),
            )
        })
        .collect();
    timed.sort_by(|a, b| a.1.cmp(&b.1).then(b.2.cmp(&a.2)));

    let mut blocks = Vec::new();
    let mut cluster: Vec<Placed> = Vec::new();
    let mut cluster_end = -1;
    for (occurrence, top, bottom) in timed {
        if !cluster.is_empty() && top >= cluster_end {
            flush(&mut cluster, &mut blocks);
            cluster_end = -1;
        }
        let taken: BTreeSet<i64> = cluster
            .iter()
            .filter(|c| c.bottom > top)
            .map(|c| c.column)
            .collect();
        let mut column = 0;
        while taken.contains(&column) {
            column += 1;
        }
        cluster.push(Placed {
            occurrence,
            top,
            bottom,
            column,
        });
        cluster_end = cluster_end.max(bottom);
    }
    flush(&mut cluster, &mut blocks);
    blocks
}

// ---- reading a sentence ("Lunch with Anna tomorrow 12:30-13:30") ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickEvent {
    pub title: String,
    pub date: String,
    pub all_day: bool,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

fn clock(h: i64, min: i64, suffix: Option<&str>) -> Option<String> {
    let mut hour = h;
    if suffix == Some("pm") && hour < 12 {
        hour += 12;
    }
    if suffix == Some("am") && hour == 12 {
        hour = 0;
    }
    (hour <= 23 && min <= 59).then(|| format!("{hour:02}:{min:02}"))
}

/// The groups of one match, owned (group 0 is the whole match).
type Groups = Vec<Option<String>>;

fn num(g: &Groups, i: usize) -> i64 {
    g.get(i)
        .and_then(|m| m.as_deref())
        .and_then(|m| m.parse().ok())
        .unwrap_or(0)
}

fn low(g: &Groups, i: usize) -> Option<String> {
    g.get(i).and_then(|m| m.as_deref()).map(str::to_lowercase)
}

fn has(g: &Groups, i: usize) -> bool {
    g.get(i).is_some_and(Option::is_some)
}

fn group(g: &Groups, i: usize) -> &str {
    g.get(i).and_then(|m| m.as_deref()).unwrap_or("")
}

/// Reads one sentence into an event. It understands `today`, `tomorrow`, a weekday (`friday`, `next
/// monday`), `5 dec`, `5.12.` / `5.12.2026`, `2026-12-05`, times as `9am`, `14:30`, `9-10`,
/// `9:30-11`, and `all day`. What is left is the title. Without a time the event is all day; with a
/// start only it lasts an hour.
pub fn parse_quick_add(
    text: &str,
    today: &str,
    fallback_date: Option<&str>,
) -> Result<Option<QuickEvent>, String> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let mut rest = format!(" {} ", text.trim());
    // The patterns end in `\s` where the original looked ahead for one; a cut puts two spaces back.
    let mut cut = |pattern: &str| -> Option<Groups> {
        let re = Regex::new(pattern).expect("a fixed pattern");
        let caps = re.captures(&rest)?;
        let whole = caps.get(0)?;
        let groups: Groups = caps
            .iter()
            .map(|m| m.map(|m| m.as_str().to_string()))
            .collect();
        rest = format!("{} {}", &rest[..whole.start()], &rest[whole.end()..]);
        Some(groups)
    };
    let year_today = ymd(today)?.0 as i64;

    let mut date: Option<String> = None;
    if let Some(m) = cut(r"\s([0-9]{4})-([0-9]{2})-([0-9]{2})\s") {
        date = Some(iso_of(num(&m, 1), num(&m, 2), num(&m, 3)));
    } else if let Some(m) = cut(r"\s([0-9]{1,2})\.([0-9]{1,2})\.(?:([0-9]{4}))?\s") {
        let year = if has(&m, 3) { num(&m, 3) } else { year_today };
        let mut d = iso_of(year, num(&m, 2), num(&m, 1));
        if !has(&m, 3) && d.as_str() < today {
            d = iso_of(year + 1, num(&m, 2), num(&m, 1));
        }
        date = Some(d);
    } else if let Some(m) = cut(
        r"(?i)\s([0-9]{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s",
    ) {
        let month = MONTH_NAMES
            .iter()
            .position(|n| n[..3].eq_ignore_ascii_case(group(&m, 2)))
            .map_or(1, |i| i as i64 + 1);
        let mut d = iso_of(year_today, month, num(&m, 1));
        if d.as_str() < today {
            d = iso_of(year_today + 1, month, num(&m, 1));
        }
        date = Some(d);
    } else if let Some(m) = cut(r"(?i)\s(today|tomorrow)\s") {
        date = Some(add_days(
            today,
            if group(&m, 1).eq_ignore_ascii_case("today") {
                0
            } else {
                1
            },
        )?);
    } else if let Some(m) =
        cut(r"(?i)\s(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s")
    {
        let target = WEEKDAY_NAMES
            .iter()
            .position(|n| n.eq_ignore_ascii_case(group(&m, 2)))
            .unwrap_or(0) as i64;
        // "friday" is the coming Friday (today, when it is Friday); "next friday" is never today
        let mut ahead = (target - weekday_index(today)? as i64 + 7) % 7;
        if has(&m, 1) && ahead == 0 {
            ahead = 7;
        }
        date = Some(add_days(today, ahead)?);
    }

    let all_day = cut(r"(?i)\s(all[\s-]?day)\s").is_some();
    let (mut start, mut end): (Option<String>, Option<String>) = (None, None);
    if !all_day {
        let range = r"(?i)\s(?:at\s+|from\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?\s*(?:-|to|until)\s*([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?\s";
        if let Some(m) = cut(range) {
            let suffix_end = low(&m, 6);
            let suffix_start = low(&m, 3).or_else(|| suffix_end.clone());
            start = clock(num(&m, 1), num(&m, 2), suffix_start.as_deref());
            end = clock(num(&m, 4), num(&m, 5), suffix_end.as_deref());
        } else if let Some(m) = cut(r"(?i)\s(?:at\s+)?([0-9]{1,2}):([0-9]{2})\s*(am|pm)?\s") {
            start = clock(num(&m, 1), num(&m, 2), low(&m, 3).as_deref());
        } else if let Some(m) = cut(r"(?i)\s(?:at\s+)?([0-9]{1,2})\s*(am|pm)\s") {
            start = clock(num(&m, 1), 0, low(&m, 2).as_deref());
        } else if let Some(m) = cut(r"(?i)\sat\s+([0-9]{1,2})\s") {
            start = clock(num(&m, 1), 0, None);
        }
        if let (Some(s), None) = (&start, &end) {
            end = Some(time_of((minutes_of(s) + 60) as f64));
        }
        if let (Some(s), Some(e)) = (&start, &end) {
            if minutes_of(e) <= minutes_of(s) {
                end = Some(time_of((minutes_of(s) + 60).min(MINUTES_PER_DAY - 1) as f64));
            }
        }
    }

    let title = rest.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Ok(None);
    }
    let timed = !all_day && start.is_some();
    Ok(Some(QuickEvent {
        title,
        date: date.unwrap_or_else(|| fallback_date.unwrap_or(today).to_string()),
        all_day: !timed,
        start_time: if timed { start } else { None },
        end_time: if timed { end } else { None },
    }))
}

/// A repeat in words: `Every day`, `Every 2 weeks on Mon, Thu`, `Every month`, `Every year until 5 Nov 2027`.
pub fn repeat_text(r: Option<&Repeat>) -> Result<String, String> {
    let Some(r) = r.filter(|r| r.kind != "none") else {
        return Ok("Does not repeat".into());
    };
    let unit = match r.kind.as_str() {
        "daily" => "day",
        "weekly" => "week",
        "monthly" => "month",
        _ => "year",
    };
    let every = if r.interval > 1 {
        format!("Every {} {unit}s", r.interval)
    } else {
        format!("Every {unit}")
    };
    let days = if r.kind == "weekly" && !r.weekdays.is_empty() {
        let names: Vec<String> = r
            .weekdays
            .iter()
            .map(|c| {
                WEEKDAY_CODES
                    .iter()
                    .position(|w| w == c)
                    .map_or(c.clone(), |i| WEEKDAY_SHORT[i].to_string())
            })
            .collect();
        format!(" on {}", names.join(", "))
    } else {
        String::new()
    };
    let end = match (&r.until, r.count) {
        (Some(u), _) if !u.is_empty() => format!(", until {} {}", short_day(u)?, ymd(u)?.0),
        (_, Some(c)) if c > 0 => format!(", {c} times"),
        _ => String::new(),
    };
    Ok(format!("{every}{days}{end}"))
}

/// A reminder in words: `At the start`, `10 minutes before`, `1 hour before`, `1 day before`.
pub fn reminder_text(minutes: i64) -> String {
    let plural = |n: i64, unit: &str| format!("{n} {unit}{} before", if n == 1 { "" } else { "s" });
    if minutes == 0 {
        "At the start".into()
    } else if minutes % 10_080 == 0 {
        plural(minutes / 10_080, "week")
    } else if minutes % 1440 == 0 {
        plural(minutes / 1440, "day")
    } else if minutes % 60 == 0 {
        plural(minutes / 60, "hour")
    } else {
        format!("{minutes} minutes before")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(kind: &str, over: impl FnOnce(&mut EventRule)) -> EventRule {
        let mut r = EventRule {
            id: Value::from(1),
            calendar_id: Value::from(1),
            title: "Gym".into(),
            notes: None,
            location: None,
            all_day: false,
            start_date: "2026-11-02".into(),
            start_time: Some("18:00".into()),
            end_date: "2026-11-02".into(),
            end_time: Some("19:00".into()),
            repeat: Repeat {
                kind: kind.into(),
                ..Repeat::default()
            },
            exceptions: vec![],
            reminders: vec![],
        };
        over(&mut r);
        r
    }
    fn series(r: &EventRule, from: &str, to: &str) -> Vec<String> {
        let s = SeriesRule {
            start_date: r.start_date.clone(),
            repeat: r.repeat.clone(),
            exceptions: r.exceptions.clone(),
        };
        series_starts(&s, from, to).unwrap()
    }

    #[test]
    fn dates_move_across_months_and_years_and_clamp_to_the_last_day() {
        assert_eq!(add_days("2026-12-31", 1).unwrap(), "2027-01-01");
        assert_eq!(add_days("2026-03-01", -1).unwrap(), "2026-02-28");
        assert_eq!(add_months("2026-01-31", 1).unwrap(), "2026-02-28");
        assert_eq!(add_months("2026-01-15", -2).unwrap(), "2025-11-15");
        assert_eq!(add_months("2028-01-31", 1).unwrap(), "2028-02-29");
        assert_eq!(weekday_index("2026-11-02").unwrap(), 0);
        assert_eq!(start_of_week("2026-11-05").unwrap(), "2026-11-02");
        assert_eq!(day_number("1970-01-02").unwrap(), 1);
    }

    #[test]
    fn a_month_is_laid_out_in_whole_weeks_starting_on_monday() {
        let grid = month_grid("2026-11-15").unwrap();
        assert!(grid
            .iter()
            .all(|w| w.len() == 7 && weekday_index(&w[0]).unwrap() == 0));
        assert_eq!(grid[0][0], "2026-10-26");
        assert_eq!(grid.last().unwrap()[6], "2026-12-06");
    }

    #[test]
    fn titles_and_labels_are_written_out() {
        assert_eq!(month_title("2026-11-03").unwrap(), "November 2026");
        assert_eq!(
            long_day("2026-11-03", Some("2026-01-01")).unwrap(),
            "Tuesday, 3 November"
        );
        assert_eq!(
            long_day("2027-01-03", Some("2026-01-01")).unwrap(),
            "Sunday, 3 January 2027"
        );
        assert_eq!(week_title("2026-11-03").unwrap(), "2 - 8 Nov 2026");
        assert_eq!(week_title("2026-10-28").unwrap(), "26 Oct - 1 Nov 2026");
        assert_eq!(
            week_title("2026-12-30").unwrap(),
            "28 Dec 2026 - 3 Jan 2027"
        );
        assert_eq!(reminder_text(0), "At the start");
        assert_eq!(reminder_text(60), "1 hour before");
        assert_eq!(reminder_text(2880), "2 days before");
        assert_eq!(reminder_text(10080), "1 week before");
        assert_eq!(reminder_text(45), "45 minutes before");
        assert_eq!(time_of(-30.0), "23:30");
        assert_eq!(time_of(1500.0), "01:00");
    }

    #[test]
    fn series_expand_by_their_rule_and_stop_where_they_end() {
        let weekly = rule("weekly", |r| {
            r.repeat.weekdays = vec!["MO".into(), "TH".into()]
        });
        assert_eq!(
            series(&weekly, "2026-11-01", "2026-11-12"),
            ["2026-11-02", "2026-11-05", "2026-11-09", "2026-11-12"]
        );
        let counted = rule("daily", |r| r.repeat.count = Some(3));
        assert_eq!(
            series(&counted, "2026-11-01", "2026-12-31"),
            ["2026-11-02", "2026-11-03", "2026-11-04"]
        );
        let skipped = rule("daily", |r| {
            r.repeat.count = Some(3);
            r.exceptions = vec!["2026-11-03".into()];
        });
        assert_eq!(
            series(&skipped, "2026-11-01", "2026-12-31"),
            ["2026-11-02", "2026-11-04"],
            "a deleted day still counts"
        );
        let monthly = rule("monthly", |r| r.start_date = "2026-01-31".into());
        assert_eq!(
            series(&monthly, "2026-01-01", "2026-03-31"),
            ["2026-01-31", "2026-02-28", "2026-03-31"]
        );
        let until = rule("daily", |r| r.repeat.until = Some("2026-11-04".into()));
        assert_eq!(series(&until, "2026-11-01", "2026-12-31").len(), 3);
        assert_eq!(
            series(&rule("none", |_| {}), "2026-11-02", "2026-11-02"),
            ["2026-11-02"]
        );
    }

    #[test]
    fn a_multi_day_event_shows_in_a_range_it_began_before() {
        let r = rule("none", |r| r.end_date = "2026-11-04".into());
        let o = expand(&r, "2026-11-03", "2026-11-10", "accent", &Extra::default()).unwrap();
        assert_eq!(o.len(), 1);
        assert_eq!(
            (
                o[0].start_date.as_str(),
                o[0].end_date.as_str(),
                o[0].key.as_str()
            ),
            ("2026-11-02", "2026-11-04", "1:2026-11-02")
        );
        assert!(
            expand(&r, "2026-11-05", "2026-11-10", "accent", &Extra::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn overlapping_events_share_the_width_of_the_day() {
        let at = |id: i64, from: &str, to: &str| {
            let r = rule("none", |r| {
                r.id = Value::from(id);
                r.start_time = Some(from.into());
                r.end_time = Some(to.into());
            });
            expand(&r, "2026-11-02", "2026-11-02", "accent", &Extra::default())
                .unwrap()
                .remove(0)
        };
        let blocks = day_blocks(
            &[
                at(1, "09:00", "11:00"),
                at(2, "10:00", "12:00"),
                at(3, "14:00", "15:00"),
            ],
            "2026-11-02",
        );
        assert_eq!(blocks.len(), 3);
        let (a, b, c) = (&blocks[0], &blocks[1], &blocks[2]);
        assert_eq!((a.column, a.columns, b.column, b.columns), (0, 2, 1, 2));
        assert_eq!(
            (c.column, c.columns),
            (0, 1),
            "a later event starts a new cluster"
        );
        assert_eq!(c.top, 14 * 60);
    }

    #[test]
    fn a_sentence_becomes_an_event() {
        let q = |text: &str| parse_quick_add(text, "2026-11-03", None).unwrap();
        let lunch = q("Lunch with Anna tomorrow 12:30-13:30").unwrap();
        assert_eq!(lunch.title, "Lunch with Anna");
        assert_eq!((lunch.date.as_str(), lunch.all_day), ("2026-11-04", false));
        assert_eq!(
            (lunch.start_time.as_deref(), lunch.end_time.as_deref()),
            (Some("12:30"), Some("13:30"))
        );

        let dentist = q("Dentist friday 9am").unwrap();
        assert_eq!(
            (
                dentist.date.as_str(),
                dentist.start_time.as_deref(),
                dentist.end_time.as_deref()
            ),
            ("2026-11-06", Some("09:00"), Some("10:00"))
        );
        assert_eq!(q("Party 5 dec all day").unwrap().date, "2026-12-05");
        assert!(q("Party 5 dec all day").unwrap().all_day);
        assert_eq!(
            q("Meet next tuesday").unwrap().date,
            "2026-11-10",
            "tuesday is today: next is a week away"
        );
        assert_eq!(
            q("Flight 5.12.2027 at 7pm").unwrap().start_time.as_deref(),
            Some("19:00")
        );
        assert_eq!(
            q("Old 2.11.").unwrap().date,
            "2027-11-02",
            "a date that passed means next year"
        );
        assert!(q("Just a note").unwrap().all_day);
        assert_eq!(q("   "), None);
        assert_eq!(q("tomorrow"), None, "nothing is left for a title");
    }

    #[test]
    fn repeats_are_said_in_words() {
        assert_eq!(repeat_text(None).unwrap(), "Does not repeat");
        let r = |kind: &str, interval: i64, wd: &[&str]| Repeat {
            kind: kind.into(),
            interval,
            weekdays: wd.iter().map(|s| s.to_string()).collect(),
            until: None,
            count: None,
        };
        assert_eq!(repeat_text(Some(&r("daily", 1, &[]))).unwrap(), "Every day");
        assert_eq!(
            repeat_text(Some(&r("weekly", 2, &["MO", "TH"]))).unwrap(),
            "Every 2 weeks on Mon, Thu"
        );
        let until = Repeat {
            until: Some("2027-11-05".into()),
            ..r("yearly", 1, &[])
        };
        assert_eq!(
            repeat_text(Some(&until)).unwrap(),
            "Every year, until 5 Nov 2027"
        );
    }
}
