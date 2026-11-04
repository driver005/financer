//! Times and days for the mail screens, and the agenda and chat rows built from them.
//!
//! Time zones are Rust's own: [`jiff`] with its bundled copy of the IANA database, so the answer does not
//! depend on what the phone or the browser has. The words of a language (short weekday and month names,
//! how a clock is written, the digits) are the device's: the screen asks `Intl` once per language and hands
//! the result in as a [`Pack`]. Rust does not carry the world's locale data (ICU4X's is megabytes).

use jiff::Timestamp;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::calendar::{add_days, days_between as days_between_iso, weekday_index, ymd};

/// How the device's language writes the things the screens show.
#[derive(Deserialize, Clone, Debug)]
pub struct Pack {
    /// Monday first.
    pub weekdays: Vec<String>,
    /// January first, as written next to a day number.
    pub months: Vec<String>,
    pub clock: ClockPack,
    /// The ten digits, `0123456789` for most languages.
    #[serde(default)]
    pub digits: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct ClockPack {
    /// `{h}:{m}` or `{h}:{m} {p}`, as the language orders them.
    pub template: String,
    /// `h23`, `h12`, `h11` or `h24`.
    pub hour_cycle: String,
    pub am: String,
    pub pm: String,
}

impl Pack {
    fn digits(&self, s: &str) -> String {
        let Some(d) = self.digits.as_deref().filter(|d| d.chars().count() == 10) else {
            return s.to_string();
        };
        let table: Vec<char> = d.chars().collect();
        s.chars()
            .map(|c| c.to_digit(10).map_or(c, |n| table[n as usize]))
            .collect()
    }
}

fn local(ts: f64, zone: &str) -> Result<jiff::civil::DateTime, String> {
    let t = Timestamp::from_second(ts.floor() as i64).map_err(|e| e.to_string())?;
    Ok(t.in_tz(zone)
        .map_err(|e| format!("{zone}: {e}"))?
        .datetime())
}

fn iso(y: i32, m: i8, d: i8) -> String {
    format!("{y:04}-{m:02}-{d:02}")
}

/// `2026-11-03`: the calendar day of an instant, in the zone.
pub fn day_key(ts: f64, zone: &str) -> Result<String, String> {
    let t = local(ts, zone)?;
    Ok(iso(t.year().into(), t.month(), t.day()))
}

fn write_clock(h: i64, m: i64, p: &Pack) -> String {
    let c = &p.clock;
    let shown = match c.hour_cycle.as_str() {
        "h12" => (h + 11) % 12 + 1,
        "h11" => h % 12,
        "h24" => {
            if h == 0 {
                24
            } else {
                h
            }
        }
        _ => h,
    };
    let period = if h < 12 { &c.am } else { &c.pm };
    let text = c
        .template
        .replace("{h}", &format!("{shown:02}"))
        .replace("{m}", &format!("{m:02}"))
        .replace("{p}", period);
    p.digits(&text)
}

/// `19:05` (or `07:05 PM`, as the language writes it), in the zone.
pub fn clock(ts: f64, zone: &str, p: &Pack) -> Result<String, String> {
    let t = local(ts, zone)?;
    Ok(write_clock(t.hour().into(), t.minute().into(), p))
}

/// `19:00` from `2026-11-06T19:00`, written as the language does; the time is not moved.
pub fn local_clock(local: &str, p: &Pack) -> String {
    let mut parts = local.get(11..16).unwrap_or("").split(':');
    let h = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let m = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    write_clock(h, m, p)
}

/// A day key moved by whole days.
pub fn shift_day(key: &str, days: i64) -> Result<String, String> {
    add_days(key, days)
}

/// Whole days from `a` to `b` (both day keys).
pub fn days_between(a: &str, b: &str) -> Result<i64, String> {
    days_between_iso(a, b)
}

fn name(list: &[String], i: usize) -> String {
    list.get(i).cloned().unwrap_or_default()
}

/// `Fri`: the short weekday of a day key.
pub fn weekday_short(key: &str, p: &Pack) -> Result<String, String> {
    Ok(name(&p.weekdays, weekday_index(key)?))
}

/// `6`: the day of the month.
pub fn day_of_month(key: &str) -> String {
    key.get(8..10)
        .and_then(|s| s.parse::<u32>().ok())
        .map_or_else(|| "NaN".to_string(), |d| d.to_string())
}

fn month_of(key: &str, p: &Pack) -> Result<String, String> {
    Ok(name(&p.months, usize::from(ymd(key)?.1) - 1))
}

fn day_number(key: &str, p: &Pack) -> Result<String, String> {
    Ok(p.digits(&ymd(key)?.2.to_string()))
}

fn year_of(key: &str, p: &Pack) -> Result<String, String> {
    Ok(p.digits(&ymd(key)?.0.to_string()))
}

/// `Fri 6 Nov`, with the year when it is not this one.
pub fn day_text(key: &str, today_key: &str, p: &Pack) -> Result<String, String> {
    let with_year = ymd(key)?.0 != ymd(today_key)?.0;
    let mut parts = vec![
        weekday_short(key, p)?,
        day_number(key, p)?,
        month_of(key, p)?,
    ];
    if with_year {
        parts.push(year_of(key, p)?);
    }
    Ok(parts
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" "))
}

/// The words for a day in a chat or an agenda: Today, Tomorrow, Yesterday, or the date.
pub fn day_label(key: &str, today_key: &str, p: &Pack) -> Result<String, String> {
    Ok(if key == today_key {
        "Today".into()
    } else if key == shift_day(today_key, 1)? {
        "Tomorrow".into()
    } else if key == shift_day(today_key, -1)? {
        "Yesterday".into()
    } else {
        day_text(key, today_key, p)?
    })
}

/// For a conversation list: the time today, "Yesterday", the weekday this week, else the date.
pub fn list_time(ts: f64, now_ts: f64, zone: &str, p: &Pack) -> Result<String, String> {
    let key = day_key(ts, zone)?;
    let today = day_key(now_ts, zone)?;
    if key == today {
        return clock(ts, zone, p);
    }
    if key == shift_day(&today, -1)? {
        return Ok("Yesterday".into());
    }
    let age = days_between(&key, &today)?;
    if age > 0 && age < 7 {
        return weekday_short(&key, p);
    }
    let mut parts = vec![day_number(&key, p)?, month_of(&key, p)?];
    if ymd(&key)?.0 != ymd(&today)?.0 {
        parts.push(year_of(&key, p)?);
    }
    Ok(parts
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" "))
}

/// "just now", "5 min ago", "2 h ago", "3 days ago": how long ago something was.
pub fn ago(ts: f64, now_ts: f64) -> String {
    let s = (now_ts - ts).max(0.0);
    if s < 60.0 {
        "just now".into()
    } else if s < 3600.0 {
        format!("{} min ago", (s / 60.0).floor() as i64)
    } else if s < 86_400.0 {
        format!("{} h ago", (s / 3600.0).floor() as i64)
    } else {
        let d = (s / 86_400.0).floor() as i64;
        if d == 1 {
            "1 day ago".into()
        } else {
            format!("{d} days ago")
        }
    }
}

// ---- the agenda ----

fn date_of(local: &str) -> &str {
    local.get(..10).unwrap_or(local)
}

fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// Events by the day they start, soonest first. An event that began before the window (a trip) is
/// listed on the window's first day, so it is not lost.
pub fn agenda_days(
    events: &[Value],
    from: &str,
    today: &str,
    p: &Pack,
) -> Result<Vec<Value>, String> {
    let mut sorted: Vec<&Value> = events.iter().collect();
    sorted.sort_by(|a, b| {
        s(a, "start")
            .unwrap_or("")
            .cmp(s(b, "start").unwrap_or(""))
            .then_with(|| {
                let id = |v: &Value| v.get("id").and_then(Value::as_f64).unwrap_or(0.0);
                id(a)
                    .partial_cmp(&id(b))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    let mut by_day: Vec<(String, Vec<Value>)> = vec![];
    for e in sorted {
        let start = date_of(s(e, "start").unwrap_or(""));
        let key = if start < from { from } else { start }.to_string();
        match by_day.iter_mut().find(|(k, _)| *k == key) {
            Some((_, l)) => l.push(e.clone()),
            None => by_day.push((key, vec![e.clone()])),
        }
    }
    by_day.sort_by(|a, b| a.0.cmp(&b.0));
    by_day
        .into_iter()
        .map(|(key, list)| {
            Ok(json!({
                "key": key,
                "label": day_label(&key, today, p)?,
                "weekday": weekday_short(&key, p)?,
                "day": day_of_month(&key),
                "today": key == today,
                "events": list,
            }))
        })
        .collect()
}

/// "19:00", "19:00 – 21:00", "All day", "All day, until Sat 12 Dec".
pub fn time_text(e: &Value, today: &str, p: &Pack) -> Result<String, String> {
    let start = s(e, "start").unwrap_or("");
    let start_day = date_of(start);
    let end = s(e, "end").filter(|x| !x.is_empty());
    let end_day = end.map(date_of);
    if e.get("all_day").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(match end_day {
            Some(d) if d != start_day => format!("All day, until {}", day_label(d, today, p)?),
            _ => "All day".into(),
        });
    }
    let from = local_clock(start, p);
    let Some(end) = end else {
        return Ok(from);
    };
    if end_day == Some(start_day) {
        return Ok(format!("{from} – {}", local_clock(end, p)));
    }
    Ok(format!(
        "{from} – {} {}",
        day_label(end_day.unwrap_or(""), today, p)?,
        local_clock(end, p)
    ))
}

pub fn source_note(source: &str) -> &'static str {
    match source {
        "invite" => "From an invitation",
        "text" => "Found in a message: check the time",
        "manual" => "Added by you",
        _ => "",
    }
}

/// The day the agenda ends on, for the range the person picked (`14`, `31` or `92` days; else a month).
pub fn range_end(from: &str, value: &str) -> Result<String, String> {
    let days = match value {
        "14" => 14,
        "92" => 92,
        _ => 31,
    };
    shift_day(from, days)
}

/// A time typed as `14:00`, `9`, `9:5` or `14.30` as `HH:MM`, or `None`.
pub fn parse_clock(text: &str) -> Option<String> {
    let t = text.trim();
    let (h, m) = match t.split_once([':', '.']) {
        Some((h, m)) => (h, Some(m)),
        None => (t, None),
    };
    let digits = |x: &str, max: usize| {
        !x.is_empty() && x.len() <= max && x.bytes().all(|b| b.is_ascii_digit())
    };
    if !digits(h, 2) || m.is_some_and(|m| !digits(m, 2)) {
        return None;
    }
    let (h, m): (u32, u32) = (h.parse().ok()?, m.map_or(Some(0), |m| m.parse().ok())?);
    (h <= 23 && m <= 59).then(|| format!("{h:02}:{m:02}"))
}

/// A day typed as `2026-11-12` or `12.11.2026` (or `12.11.`, the current or next year) as `YYYY-MM-DD`, or `None`.
pub fn parse_day(text: &str, today: &str) -> Option<String> {
    let t = text.trim();
    let all = |x: &str, n: std::ops::RangeInclusive<usize>| {
        n.contains(&x.len()) && x.bytes().all(|b| b.is_ascii_digit())
    };
    let (y, m, d, year_given): (i64, i64, i64, bool);
    let iso_parts: Vec<&str> = t.split('-').collect();
    let de_parts: Vec<&str> = t.split('.').collect();
    if iso_parts.len() == 3
        && all(iso_parts[0], 4..=4)
        && all(iso_parts[1], 2..=2)
        && all(iso_parts[2], 2..=2)
    {
        (y, m, d, year_given) = (
            iso_parts[0].parse().ok()?,
            iso_parts[1].parse().ok()?,
            iso_parts[2].parse().ok()?,
            true,
        );
    } else if de_parts.len() == 3
        && all(de_parts[0], 1..=2)
        && all(de_parts[1], 1..=2)
        && (de_parts[2].is_empty() || all(de_parts[2], 4..=4))
    {
        let given = !de_parts[2].is_empty();
        let this_year: i64 = today.get(..4)?.parse().ok()?;
        (m, d) = (de_parts[1].parse().ok()?, de_parts[0].parse().ok()?);
        y = if given {
            de_parts[2].parse().ok()?
        } else {
            this_year
        };
        year_given = given;
    } else {
        return None;
    }
    let valid = |y: i64, m: i64, d: i64| -> Option<time::Date> {
        time::Date::from_calendar_date(
            i32::try_from(y).ok()?,
            time::Month::try_from(u8::try_from(m).ok()?).ok()?,
            u8::try_from(d).ok()?,
        )
        .ok()
    };
    let mut y = y;
    if !year_given {
        // a date without a year that is more than two months back means next year
        if let Some(date) = valid(y, m, d) {
            let key = iso(date.year(), date.month() as i8, date.day() as i8);
            if days_between_iso(today, &key).ok()? < -60 {
                y += 1;
            }
        }
    }
    let date = valid(y, m, d)?;
    Some(iso(date.year(), date.month() as i8, date.day() as i8))
}

// ---- a conversation as rows ----

fn same_topic(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

fn id_text(m: &Value) -> String {
    m.get("id")
        .map(crate::js::string)
        .unwrap_or_else(|| "undefined".into())
}

/// A conversation as a list of rows: day dividers, topic dividers and bubbles.
pub fn chat_rows(
    messages: &[Value],
    now: f64,
    zone: &str,
    p: &Pack,
    show_topics: bool,
    group_chat: bool,
) -> Result<Vec<Value>, String> {
    let today = day_key(now, zone)?;
    let mut rows = vec![];
    let mut day = String::new();
    let mut topic: Option<String> = None;
    for m in messages {
        let at = m.get("at").and_then(Value::as_f64).unwrap_or(0.0);
        let d = day_key(at, zone)?;
        if d != day {
            rows.push(json!({ "kind": "day", "key": format!("day-{d}"), "label": day_label(&d, &today, p)? }));
            day = d;
        }
        let this_topic = s(m, "topic").filter(|t| !t.is_empty());
        if show_topics {
            if let Some(t) = this_topic {
                if topic.as_deref().is_none_or(|prev| !same_topic(prev, t)) {
                    rows.push(json!({ "kind": "topic", "key": format!("topic-{}", id_text(m)), "label": t }));
                }
            }
        }
        if let Some(t) = this_topic {
            topic = Some(t.to_string());
        }
        let mine = m.get("mine").and_then(Value::as_bool).unwrap_or(false);
        rows.push(json!({
            "kind": "message", "key": format!("m-{}", id_text(m)), "message": m,
            "time": clock(at, zone, p)?, "showSender": group_chat && !mine,
        }));
    }
    Ok(rows)
}

/// Ids of the messages not read yet.
pub fn unread_ids(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .filter(|m| m.get("unread").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|m| m.get("id").cloned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack(lang: &str) -> Pack {
        let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            .map(String::from)
            .to_vec();
        let months = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ]
        .map(String::from)
        .to_vec();
        let clock = if lang == "us" {
            ClockPack {
                template: "{h}:{m} {p}".into(),
                hour_cycle: "h12".into(),
                am: "AM".into(),
                pm: "PM".into(),
            }
        } else {
            ClockPack {
                template: "{h}:{m}".into(),
                hour_cycle: "h23".into(),
                am: "".into(),
                pm: "".into(),
            }
        };
        Pack {
            weekdays,
            months,
            clock,
            digits: None,
        }
    }

    const NOW: f64 = 1_793_696_400.0; // 2026-11-03 09:00 UTC = 10:00 in Berlin, a Tuesday

    #[test]
    fn days_are_named_in_the_zone() {
        // 23:30 UTC on the 2nd is already the 3rd in Berlin
        assert_eq!(
            day_key(NOW - 9.5 * 3600.0, "Europe/Berlin").unwrap(),
            "2026-11-03"
        );
        assert_eq!(day_key(NOW - 9.5 * 3600.0, "UTC").unwrap(), "2026-11-02");
        assert_eq!(clock(NOW, "Europe/Berlin", &pack("gb")).unwrap(), "10:00");
        assert_eq!(clock(NOW, "UTC", &pack("gb")).unwrap(), "09:00");
        assert_eq!(
            clock(NOW + 7.0 * 30.0 * 86_400.0, "Europe/Berlin", &pack("gb"))
                .unwrap()
                .len(),
            5
        );
        assert!(day_key(NOW, "Not/AZone").is_err());
    }

    #[test]
    fn days_are_written_with_the_devices_words() {
        let p = pack("gb");
        assert_eq!(
            day_text("2026-11-06", "2026-11-03", &p).unwrap(),
            "Fri 6 Nov"
        );
        assert_eq!(
            day_text("2027-01-08", "2026-11-03", &p).unwrap(),
            "Fri 8 Jan 2027"
        );
        assert_eq!(
            day_label("2026-11-04", "2026-11-03", &p).unwrap(),
            "Tomorrow"
        );
        assert_eq!(local_clock("2026-11-06T07:05", &pack("us")), "07:05 AM");
        assert_eq!(local_clock("2026-11-06T19:00", &p), "19:00");
        assert_eq!(day_of_month("2026-11-06"), "6");
    }

    #[test]
    fn a_list_shortens_old_times() {
        let p = pack("gb");
        let z = "Europe/Berlin";
        let at = |d: i64, h: i64| NOW - (d * 86_400) as f64 + (h - 9) as f64 * 3600.0;
        assert_eq!(list_time(at(0, 6), NOW, z, &p).unwrap(), "07:00");
        assert_eq!(list_time(at(1, 12), NOW, z, &p).unwrap(), "Yesterday");
        assert_eq!(list_time(at(4, 12), NOW, z, &p).unwrap(), "Fri");
        assert_eq!(list_time(at(14, 12), NOW, z, &p).unwrap(), "20 Oct");
        assert_eq!(list_time(at(314, 12), NOW, z, &p).unwrap(), "24 Dec 2025");
        assert_eq!(ago(NOW - 5.0 * 60.0, NOW), "5 min ago");
        assert_eq!(ago(NOW + 100.0, NOW), "just now");
    }

    #[test]
    fn typed_times_and_days_are_read() {
        assert_eq!(parse_clock(" 9 ").as_deref(), Some("09:00"));
        assert_eq!(parse_clock("14.30").as_deref(), Some("14:30"));
        assert_eq!(parse_clock("9:5").as_deref(), Some("09:05"));
        assert_eq!(parse_clock("24:00"), None);
        assert_eq!(
            parse_day("12.11.2026", "2026-11-03").as_deref(),
            Some("2026-11-12")
        );
        assert_eq!(
            parse_day("2026-11-12", "2026-11-03").as_deref(),
            Some("2026-11-12")
        );
        assert_eq!(
            parse_day("10.01.", "2026-11-03").as_deref(),
            Some("2027-01-10")
        );
        assert_eq!(
            parse_day("12.10.", "2026-11-03").as_deref(),
            Some("2026-10-12")
        );
        assert_eq!(parse_day("31.02.2026", "2026-11-03"), None);
        assert_eq!(parse_day("soon", "2026-11-03"), None);
    }

    #[test]
    fn a_chat_has_day_and_topic_dividers() {
        let p = pack("gb");
        let msg = |id: i64, at: f64, topic: &str| json!({ "id": id, "at": at, "topic": topic, "mine": false, "unread": id == 2 });
        let ms = [
            msg(1, NOW - 90_000.0, "Urlaub"),
            msg(2, NOW - 60.0, "urlaub "),
            msg(3, NOW, "Fußball"),
        ];
        let rows = chat_rows(&ms, NOW, "Europe/Berlin", &p, true, true).unwrap();
        let kinds: Vec<_> = rows.iter().map(|r| r["kind"].as_str().unwrap()).collect();
        assert_eq!(
            kinds,
            ["day", "topic", "message", "day", "message", "topic", "message"]
        );
        assert_eq!(rows[3]["label"], "Today");
        assert_eq!(rows[2]["showSender"], true);
        assert_eq!(unread_ids(&ms), [json!(2)]);
    }

    #[test]
    fn events_are_grouped_and_told() {
        let p = pack("gb");
        let ev = |id: i64, start: &str, end: Option<&str>, all_day: bool| json!({ "id": id, "start": start, "end": end, "all_day": all_day });
        let days = agenda_days(
            &[
                ev(1, "2026-11-06T19:00", None, false),
                ev(2, "2026-10-30T00:00", Some("2026-11-05T00:00"), true),
            ],
            "2026-11-03",
            "2026-11-03",
            &p,
        )
        .unwrap();
        assert_eq!(days[0]["key"], "2026-11-03");
        assert_eq!(days[0]["label"], "Today");
        assert_eq!(days[1]["weekday"], "Fri");
        assert_eq!(
            time_text(
                &ev(1, "2026-11-06T22:00", Some("2026-11-07T01:00"), false),
                "2026-11-03",
                &p
            )
            .unwrap(),
            "22:00 – Sat 7 Nov 01:00"
        );
        assert_eq!(
            time_text(
                &ev(1, "2026-12-24T00:00", Some("2026-12-26T00:00"), true),
                "2026-11-03",
                &p
            )
            .unwrap(),
            "All day, until Sat 26 Dec"
        );
        assert_eq!(range_end("2026-11-03", "14").unwrap(), "2026-11-17");
        assert_eq!(source_note("manual"), "Added by you");
    }
}
