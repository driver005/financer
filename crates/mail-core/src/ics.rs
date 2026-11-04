//! A reader for iCalendar (`text/calendar`, `.ics`) invitations: just the parts of VEVENT that an
//! agenda needs. Recurrence rules are kept as text, not expanded.

use time::{Date, Duration, Month, PrimitiveDateTime, Time};

/// A date or date-time as an invitation states it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IcsTime {
    /// `VALUE=DATE`: a whole day.
    Date(Date),
    /// `...Z`: UTC.
    Utc(PrimitiveDateTime),
    /// `TZID=Europe/Berlin:...`
    Zoned {
        tzid: String,
        local: PrimitiveDateTime,
    },
    /// No zone: the wall-clock time of whoever reads it.
    Floating(PrimitiveDateTime),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IcsEvent {
    pub uid: String,
    pub summary: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub organizer: Option<String>,
    pub start: IcsTime,
    pub end: Option<IcsTime>,
    pub duration: Option<Duration>,
    pub sequence: i64,
    /// `CONFIRMED`, `TENTATIVE`, `CANCELLED`.
    pub status: Option<String>,
    pub rrule: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Calendar {
    /// `REQUEST`, `PUBLISH`, `CANCEL`, `REPLY`...
    pub method: Option<String>,
    pub events: Vec<IcsEvent>,
}

struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, key: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
}

fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.replace("\r\n", "\n").replace('\r', "\n").split('\n') {
        if let Some(rest) = raw.strip_prefix([' ', '\t']) {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        lines.push(raw.to_string());
    }
    lines
}

fn parse_prop(line: &str) -> Option<Prop> {
    // NAME;PARAM=a;PARAM="b:c":VALUE  (a colon inside quotes does not end the name part)
    let mut in_quotes = false;
    let mut split = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => {
                split = Some(i);
                break;
            }
            _ => {}
        }
    }
    let (head, value) = line.split_at(split?);
    let value = &value[1..];
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut q = false;
    for c in head.chars() {
        match c {
            '"' => q = !q,
            ';' if !q => parts.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    parts.push(current);
    let name = parts.remove(0).to_uppercase();
    let params = parts
        .into_iter()
        .filter_map(|p| {
            p.split_once('=')
                .map(|(k, v)| (k.to_string(), v.to_string()))
        })
        .collect();
    Some(Prop {
        name,
        params,
        value: value.to_string(),
    })
}

fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n' | 'N') => out.push('\n'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_date(s: &str) -> Option<Date> {
    if s.len() < 8 || !s.is_char_boundary(8) {
        return None;
    }
    let y: i32 = s[0..4].parse().ok()?;
    let m: u8 = s[4..6].parse().ok()?;
    let d: u8 = s[6..8].parse().ok()?;
    Date::from_calendar_date(y, Month::try_from(m).ok()?, d).ok()
}

fn parse_datetime(s: &str) -> Option<PrimitiveDateTime> {
    let date = parse_date(s)?;
    let t = s.get(9..)?.trim_end_matches('Z');
    if t.len() < 4 {
        return None;
    }
    let h: u8 = t.get(0..2)?.parse().ok()?;
    let m: u8 = t.get(2..4)?.parse().ok()?;
    let sec: u8 = t.get(4..6).and_then(|x| x.parse().ok()).unwrap_or(0);
    Some(PrimitiveDateTime::new(
        date,
        Time::from_hms(h, m, sec.min(59)).ok()?,
    ))
}

fn parse_time_prop(p: &Prop) -> Option<IcsTime> {
    let v = p.value.trim();
    if p.param("VALUE")
        .is_some_and(|x| x.eq_ignore_ascii_case("DATE"))
        || (v.len() == 8 && !v.contains('T'))
    {
        return parse_date(v).map(IcsTime::Date);
    }
    let dt = parse_datetime(v)?;
    if v.ends_with('Z') {
        Some(IcsTime::Utc(dt))
    } else if let Some(tzid) = p.param("TZID") {
        Some(IcsTime::Zoned {
            tzid: tzid.to_string(),
            local: dt,
        })
    } else {
        Some(IcsTime::Floating(dt))
    }
}

/// `PT1H30M`, `P1D`, `P2W`, `-PT15M`.
fn parse_duration(s: &str) -> Option<Duration> {
    let s = s.trim();
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let s = s.strip_prefix('P')?;
    let mut total = Duration::ZERO;
    let mut num = String::new();
    let mut in_time = false;
    for c in s.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            unit => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += match (unit, in_time) {
                    ('W', _) => Duration::weeks(n),
                    ('D', _) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    Some(if neg { -total } else { total })
}

/// Reads every VEVENT of `text`. Anything unreadable is skipped, never an error: a broken
/// attachment must not stop the mail from being stored.
pub fn parse_calendar(text: &str) -> Calendar {
    let mut cal = Calendar::default();
    let mut in_event = false;
    let mut event: Vec<Prop> = Vec::new();
    for line in unfold(text) {
        let Some(prop) = parse_prop(&line) else {
            continue;
        };
        match (prop.name.as_str(), prop.value.to_uppercase().as_str()) {
            ("BEGIN", "VEVENT") => {
                in_event = true;
                event.clear();
            }
            ("END", "VEVENT") => {
                in_event = false;
                if let Some(e) = build_event(&event) {
                    cal.events.push(e);
                }
            }
            ("METHOD", _) if !in_event => cal.method = Some(prop.value.trim().to_uppercase()),
            _ if in_event => event.push(prop),
            _ => {}
        }
    }
    cal
}

fn build_event(props: &[Prop]) -> Option<IcsEvent> {
    // an instance override of a recurring event is not a separate appointment here
    if props.iter().any(|p| p.name == "RECURRENCE-ID") {
        return None;
    }
    let get = |name: &str| props.iter().find(|p| p.name == name);
    let start = parse_time_prop(get("DTSTART")?)?;
    let organizer = get("ORGANIZER").map(|p| {
        p.param("CN").map(str::to_string).unwrap_or_else(|| {
            p.value
                .trim_start_matches("mailto:")
                .trim_start_matches("MAILTO:")
                .to_string()
        })
    });
    Some(IcsEvent {
        uid: get("UID")
            .map(|p| p.value.trim().to_string())
            .filter(|u| !u.is_empty())?,
        summary: get("SUMMARY")
            .map(|p| unescape(&p.value))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "(no title)".into()),
        description: get("DESCRIPTION")
            .map(|p| unescape(&p.value))
            .filter(|s| !s.trim().is_empty()),
        location: get("LOCATION")
            .map(|p| unescape(&p.value))
            .filter(|s| !s.trim().is_empty()),
        organizer,
        end: get("DTEND").and_then(parse_time_prop),
        duration: get("DURATION").and_then(|p| parse_duration(&p.value)),
        sequence: get("SEQUENCE")
            .and_then(|p| p.value.trim().parse().ok())
            .unwrap_or(0),
        status: get("STATUS").map(|p| p.value.trim().to_uppercase()),
        rrule: get("RRULE").map(|p| p.value.trim().to_string()),
        start,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, datetime};

    const INVITE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:abc-123@example.com\r\nDTSTART;TZID=Europe/Berlin:20261105T140000\r\nDTEND;TZID=Europe/Berlin:20261105T153000\r\nSUMMARY:Projekt\\, Kickoff\r\nLOCATION:Raum 4\\nHauptstraße 1\r\nDESCRIPTION:Bitte Unterlagen\r\n  mitbringen.\r\nORGANIZER;CN=\"Anna Berg\":mailto:anna@x.de\r\nSEQUENCE:2\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn reads_an_invitation() {
        let cal = parse_calendar(INVITE);
        assert_eq!(cal.method.as_deref(), Some("REQUEST"));
        assert_eq!(cal.events.len(), 1);
        let e = &cal.events[0];
        assert_eq!(e.uid, "abc-123@example.com");
        assert_eq!(e.summary, "Projekt, Kickoff");
        assert_eq!(e.location.as_deref(), Some("Raum 4\nHauptstraße 1"));
        assert_eq!(
            e.description.as_deref(),
            Some("Bitte Unterlagen mitbringen.")
        );
        assert_eq!(e.organizer.as_deref(), Some("Anna Berg"));
        assert_eq!(e.sequence, 2);
        assert_eq!(
            e.start,
            IcsTime::Zoned {
                tzid: "Europe/Berlin".into(),
                local: datetime!(2026-11-05 14:00)
            }
        );
        assert_eq!(
            e.end,
            Some(IcsTime::Zoned {
                tzid: "Europe/Berlin".into(),
                local: datetime!(2026-11-05 15:30)
            })
        );
    }

    #[test]
    fn reads_utc_floating_and_all_day_times() {
        let text = "BEGIN:VEVENT\nUID:1\nDTSTART:20261105T130000Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:2\nDTSTART:20261105T130000\nEND:VEVENT\nBEGIN:VEVENT\nUID:3\nDTSTART;VALUE=DATE:20261224\nDTEND;VALUE=DATE:20261226\nSUMMARY:Weihnachten\nEND:VEVENT\n";
        let cal = parse_calendar(text);
        assert_eq!(
            cal.events[0].start,
            IcsTime::Utc(datetime!(2026-11-05 13:00))
        );
        assert_eq!(
            cal.events[1].start,
            IcsTime::Floating(datetime!(2026-11-05 13:00))
        );
        assert_eq!(cal.events[2].start, IcsTime::Date(date!(2026 - 12 - 24)));
        assert_eq!(
            cal.events[2].end,
            Some(IcsTime::Date(date!(2026 - 12 - 26)))
        );
    }

    #[test]
    fn reads_durations() {
        let text = "BEGIN:VEVENT\nUID:1\nDTSTART:20261105T130000Z\nDURATION:PT1H30M\nEND:VEVENT\n";
        assert_eq!(
            parse_calendar(text).events[0].duration,
            Some(Duration::minutes(90))
        );
        assert_eq!(parse_duration("P1D"), Some(Duration::days(1)));
        assert_eq!(parse_duration("P2W"), Some(Duration::weeks(2)));
        assert_eq!(parse_duration("garbage"), None);
    }

    #[test]
    fn cancellation_and_recurrence_are_kept() {
        let text = "BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nUID:1\nSTATUS:CANCELLED\nRRULE:FREQ=WEEKLY;BYDAY=TU\nDTSTART:20261105T130000Z\nEND:VEVENT\nEND:VCALENDAR";
        let cal = parse_calendar(text);
        assert_eq!(cal.method.as_deref(), Some("CANCEL"));
        assert_eq!(cal.events[0].status.as_deref(), Some("CANCELLED"));
        assert_eq!(cal.events[0].rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=TU"));
    }

    #[test]
    fn skips_instance_overrides_and_broken_events() {
        let text = "BEGIN:VEVENT\nUID:1\nRECURRENCE-ID:20261105T130000Z\nDTSTART:20261105T140000Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:2\nDTSTART:not a date\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261105T130000Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:4\nDTSTART:20261105T130000Z\nEND:VEVENT\n";
        let cal = parse_calendar(text);
        assert_eq!(cal.events.len(), 1);
        assert_eq!(cal.events[0].uid, "4");
        assert_eq!(cal.events[0].summary, "(no title)");
    }

    #[test]
    fn a_colon_inside_a_quoted_parameter_does_not_end_the_name() {
        let text = "BEGIN:VEVENT\nUID:1\nDTSTART:20261105T130000Z\nATTENDEE;CN=\"a:b\":mailto:x@y.de\nORGANIZER;CN=\"Ann: Berg\":mailto:a@x.de\nEND:VEVENT\n";
        assert_eq!(
            parse_calendar(text).events[0].organizer.as_deref(),
            Some("Ann: Berg")
        );
    }

    #[test]
    fn garbage_gives_an_empty_calendar() {
        assert_eq!(parse_calendar("hello world"), Calendar::default());
        assert_eq!(parse_calendar(""), Calendar::default());
    }
}
