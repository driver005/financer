//! Turns occurrences into what the calendar components draw (month cells, day columns, schedule
//! days, the mini month) and decides which days a view needs. The answers are plain data; the
//! tap handlers are attached by the screen (each item carries the `key` of its occurrence).

use serde::Serialize;

use crate::calendar::{
    add_days, add_months, day_blocks, group_by_day, long_day, month_grid, month_title,
    start_of_week, time_range, week_title, weekday_index, ymd, Occurrence, WEEKDAY_SHORT,
};

/// How many days of the schedule view load at once.
pub const SCHEDULE_DAYS: i64 = 60;
/// How many events a month cell lists on a wide screen before "+N more".
pub const MONTH_CELL_ITEMS: usize = 3;

#[derive(Serialize, Debug, PartialEq)]
pub struct Range {
    pub from: String,
    pub to: String,
}

fn bad_view(view: &str) -> String {
    format!("unknown calendar view {view}")
}

/// The first and last day a view needs events for, around the day it is on.
pub fn range_for(view: &str, anchor: &str, schedule_days: i64) -> Result<Range, String> {
    let (from, to) = match view {
        "month" => {
            let weeks = month_grid(anchor)?;
            (weeks[0][0].clone(), weeks[weeks.len() - 1][6].clone())
        }
        "week" => {
            let start = start_of_week(anchor)?;
            let end = add_days(&start, 6)?;
            (start, end)
        }
        "3day" => (anchor.to_string(), add_days(anchor, 2)?),
        "day" => (anchor.to_string(), anchor.to_string()),
        "schedule" => (anchor.to_string(), add_days(anchor, schedule_days - 1)?),
        other => return Err(bad_view(other)),
    };
    Ok(Range { from, to })
}

/// Where the previous and next buttons go.
pub fn step(view: &str, anchor: &str, direction: i64) -> Result<String, String> {
    match view {
        "month" => add_months(anchor, direction),
        "week" => add_days(anchor, 7 * direction),
        "3day" => add_days(anchor, 3 * direction),
        "day" => add_days(anchor, direction),
        "schedule" => add_days(anchor, 14 * direction),
        other => Err(bad_view(other)),
    }
}

/// The title above the view.
pub fn title_for(view: &str, anchor: &str) -> Result<String, String> {
    match view {
        "week" => week_title(anchor),
        "day" => long_day(anchor, None),
        _ => month_title(anchor),
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub key: String,
    pub title: String,
    pub tone: String,
    pub all_day: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    pub faded: bool,
}

fn tidy(o: &Occurrence) -> Item {
    Item {
        key: o.key.clone(),
        title: o.title.clone(),
        tone: o.tone.clone(),
        all_day: o.all_day || o.start_date != o.end_date,
        time: if o.all_day {
            None
        } else {
            o.start_time.clone()
        },
        faded: false,
    }
}

fn day_number(date: &str) -> Result<String, String> {
    Ok(ymd(date)?.2.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthCell {
    pub date: String,
    pub number: String,
    pub in_month: bool,
    pub today: bool,
    pub selected: bool,
    pub items: Vec<Item>,
    pub more: usize,
}

pub fn month_cells(
    anchor: &str,
    today: &str,
    selected: &str,
    occurrences: &[Occurrence],
) -> Result<Vec<Vec<MonthCell>>, String> {
    let weeks = month_grid(anchor)?;
    let by_day = group_by_day(occurrences, &weeks[0][0], &weeks[weeks.len() - 1][6])?;
    let month = ymd(anchor)?.1;
    weeks
        .iter()
        .map(|week| {
            week.iter()
                .map(|date| {
                    let list = by_day
                        .iter()
                        .find(|(d, _)| d == date)
                        .map_or(&[][..], |(_, l)| l.as_slice());
                    Ok(MonthCell {
                        date: date.clone(),
                        number: day_number(date)?,
                        in_month: ymd(date)?.1 == month,
                        today: date == today,
                        selected: date == selected,
                        items: list.iter().take(MONTH_CELL_ITEMS).map(tidy).collect(),
                        more: list.len().saturating_sub(MONTH_CELL_ITEMS),
                    })
                })
                .collect()
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniCell {
    pub date: String,
    pub number: String,
    pub in_month: bool,
    pub today: bool,
    pub selected: bool,
    pub marked: bool,
}

pub fn mini_cells(
    anchor: &str,
    today: &str,
    selected: &str,
    occurrences: &[Occurrence],
) -> Result<Vec<Vec<MiniCell>>, String> {
    let weeks = month_grid(anchor)?;
    let by_day = group_by_day(occurrences, &weeks[0][0], &weeks[weeks.len() - 1][6])?;
    let month = ymd(anchor)?.1;
    weeks
        .iter()
        .map(|week| {
            week.iter()
                .map(|date| {
                    Ok(MiniCell {
                        date: date.clone(),
                        number: day_number(date)?,
                        in_month: ymd(date)?.1 == month,
                        today: date == today,
                        selected: date == selected,
                        marked: by_day.iter().any(|(d, l)| d == date && !l.is_empty()),
                    })
                })
                .collect()
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockView {
    pub key: String,
    pub title: String,
    pub subtitle: String,
    pub tone: String,
    pub top: i64,
    pub bottom: i64,
    pub lane: i64,
    pub lanes: i64,
    pub depth: i64,
    pub depths: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub date: String,
    pub label: &'static str,
    pub number: String,
    pub today: bool,
    pub selected: bool,
    pub all_day: Vec<Item>,
    pub blocks: Vec<BlockView>,
}

/// The columns of the week, 3-day and day views.
pub fn day_columns(
    dates: &[String],
    today: &str,
    selected: &str,
    occurrences: &[Occurrence],
) -> Result<Vec<Column>, String> {
    let (Some(first), Some(last)) = (dates.first(), dates.last()) else {
        return Ok(vec![]);
    };
    let by_day = group_by_day(occurrences, first, last)?;
    dates
        .iter()
        .map(|date| {
            let list = by_day
                .iter()
                .find(|(d, _)| d == date)
                .map_or(&[][..], |(_, l)| l.as_slice());
            let blocks = day_blocks(list, date)
                .into_iter()
                .map(|b| {
                    let subtitle = match b.occurrence.location.clone() {
                        Some(l) => l,
                        None => time_range(&b.occurrence.when())?,
                    };
                    Ok(BlockView {
                        key: b.occurrence.key.clone(),
                        title: b.occurrence.title.clone(),
                        subtitle,
                        tone: b.occurrence.tone.clone(),
                        top: b.top,
                        bottom: b.bottom,
                        lane: b.lane,
                        lanes: b.lanes,
                        depth: b.depth,
                        depths: b.depths,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok(Column {
                date: date.clone(),
                label: WEEKDAY_SHORT[weekday_index(date)?],
                number: day_number(date)?,
                today: date == today,
                selected: date == selected,
                all_day: list.iter().filter(|o| o.all_day).map(tidy).collect(),
                blocks,
            })
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaItem {
    #[serde(flatten)]
    pub item: Item,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub range: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaDay {
    pub date: String,
    pub heading: String,
    pub today: bool,
    pub items: Vec<AgendaItem>,
}

/// The days of the schedule view that have something on them.
pub fn agenda_days(
    from: &str,
    to: &str,
    today: &str,
    occurrences: &[Occurrence],
) -> Result<Vec<AgendaDay>, String> {
    let mut days = vec![];
    for (date, list) in group_by_day(occurrences, from, to)? {
        if list.is_empty() {
            continue;
        }
        let heading = if date == today {
            format!("Today, {}", long_day(&date, Some(today))?)
        } else {
            long_day(&date, Some(today))?
        };
        let items = list
            .iter()
            .map(|o| {
                let subtitle = [o.source.as_deref(), o.location.as_deref()]
                    .into_iter()
                    .flatten()
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join(" · ");
                Ok(AgendaItem {
                    item: tidy(o),
                    subtitle: (!subtitle.is_empty()).then_some(subtitle),
                    range: if o.all_day {
                        "All day".into()
                    } else {
                        time_range(&o.when())?
                    },
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        days.push(AgendaDay {
            today: date == today,
            date,
            heading,
            items,
        });
    }
    Ok(days)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn occ(key: &str, date: &str, start: Option<&str>, end: Option<&str>) -> Occurrence {
        serde_json::from_value(json!({
            "key": key, "eventId": key, "calendarId": "c", "title": key, "allDay": start.is_none(),
            "startDate": date, "startTime": start, "endDate": date, "endTime": end,
            "tone": "accent", "repeats": false, "readOnly": false
        }))
        .unwrap()
    }

    #[test]
    fn ranges_and_steps_follow_the_view() {
        assert_eq!(
            range_for("day", "2026-11-04", 60).unwrap(),
            Range {
                from: "2026-11-04".into(),
                to: "2026-11-04".into()
            }
        );
        assert_eq!(
            range_for("week", "2026-11-04", 60).unwrap().from,
            "2026-11-02"
        );
        assert_eq!(
            range_for("schedule", "2026-11-04", 3).unwrap().to,
            "2026-11-06"
        );
        assert_eq!(step("month", "2026-01-31", 1).unwrap(), "2026-02-28");
        assert_eq!(step("3day", "2026-11-04", -1).unwrap(), "2026-11-01");
        assert!(step("year", "2026-11-04", 1).is_err());
    }

    #[test]
    fn month_cells_cap_the_items_and_count_the_rest() {
        let list: Vec<_> = (0..5)
            .map(|i| occ(&format!("e{i}"), "2026-11-04", None, None))
            .collect();
        let weeks = month_cells("2026-11-04", "2026-11-04", "2026-11-04", &list).unwrap();
        let cell = weeks
            .iter()
            .flatten()
            .find(|c| c.date == "2026-11-04")
            .unwrap();
        assert_eq!(
            (cell.items.len(), cell.more, cell.today, cell.selected),
            (3, 2, true, true)
        );
        assert!(weeks.iter().flatten().any(|c| !c.in_month));
    }

    #[test]
    fn the_schedule_skips_empty_days_and_says_today() {
        let list = vec![
            occ("a", "2026-11-04", Some("09:00"), Some("10:00")),
            occ("b", "2026-11-06", None, None),
        ];
        let days = agenda_days("2026-11-04", "2026-11-10", "2026-11-04", &list).unwrap();
        assert_eq!(days.len(), 2);
        assert!(days[0].heading.starts_with("Today, "));
        assert_eq!(days[0].items[0].range, "09:00 - 10:00");
        assert_eq!(days[1].items[0].range, "All day");
    }
}
