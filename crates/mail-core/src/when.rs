//! Dates and times written in sentences, German and English: "am Freitag um 15 Uhr", "12.11. 14:30",
//! "next Monday at 3pm", "5. November, 10-12 Uhr", "tomorrow at 9". It finds what a person would
//! call an appointment, and is deliberately strict: a date alone ("Rechnung vom 03.11.") is
//! not an appointment, so date-only mentions are the caller's decision.

use regex::Regex;
use std::sync::LazyLock;
use time::{Date, Duration, Month, PrimitiveDateTime, Time, Weekday};

/// A date (with a time, when one stands near it) found in text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mention {
    pub date: Date,
    pub start: Option<Time>,
    pub end: Option<Time>,
    /// The line it was found on.
    pub line: String,
}

impl Mention {
    pub fn starts_at(&self) -> PrimitiveDateTime {
        PrimitiveDateTime::new(self.date, self.start.unwrap_or(Time::MIDNIGHT))
    }
    pub fn ends_at(&self) -> Option<PrimitiveDateTime> {
        self.end.map(|e| PrimitiveDateTime::new(self.date, e))
    }
}

const MONTH_NAMES: &str = "januar|jan|februar|feb|märz|maerz|mär|march|mar|april|apr|mai|may|juni|june|jun|juli|july|jul|august|aug|september|sept|sep|oktober|october|okt|oct|november|nov|dezember|december|dez|dec|january|february";

fn month_of(name: &str) -> Option<Month> {
    Some(match name.to_lowercase().as_str() {
        "januar" | "jan" | "january" => Month::January,
        "februar" | "feb" | "february" => Month::February,
        "märz" | "maerz" | "mär" | "march" | "mar" => Month::March,
        "april" | "apr" => Month::April,
        "mai" | "may" => Month::May,
        "juni" | "june" | "jun" => Month::June,
        "juli" | "july" | "jul" => Month::July,
        "august" | "aug" => Month::August,
        "september" | "sept" | "sep" => Month::September,
        "oktober" | "october" | "okt" | "oct" => Month::October,
        "november" | "nov" => Month::November,
        "dezember" | "december" | "dez" | "dec" => Month::December,
        _ => return None,
    })
}

fn weekday_of(name: &str) -> Option<Weekday> {
    Some(match name.to_lowercase().as_str() {
        "montag" | "monday" => Weekday::Monday,
        "dienstag" | "tuesday" => Weekday::Tuesday,
        "mittwoch" | "wednesday" => Weekday::Wednesday,
        "donnerstag" | "thursday" => Weekday::Thursday,
        "freitag" | "friday" => Weekday::Friday,
        "samstag" | "sonnabend" | "saturday" => Weekday::Saturday,
        "sonntag" | "sunday" => Weekday::Sunday,
        _ => return None,
    })
}

static ISO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(\d{4})-(\d{2})-(\d{2})\b").expect("valid regex"));
static NUMERIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?").expect("valid regex"));
static NAMED_DAY_FIRST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?i)\b(\d{{1,2}})\.?\s*(?:of\s+)?({MONTH_NAMES})\b\.?(?:,?\s*(\d{{4}}))?"
    ))
    .expect("valid regex")
});
static NAMED_MONTH_FIRST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?i)\b({MONTH_NAMES})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b(?:,?\s*(\d{{4}}))?"
    ))
    .expect("valid regex")
});
static WEEKDAY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:(next|nächsten|nächster|nächste|kommenden|kommender|diesen|this)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b").expect("valid regex")
});
static RELATIVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(heute|today|morgen|tomorrow|übermorgen|uebermorgen)\b")
        .expect("valid regex")
});

static TIME_COLON: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?").expect("valid regex")
});
static TIME_DOT_UHR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(\d{1,2})\.(\d{2})\s*(?:uhr|h)\b").expect("valid regex"));
static TIME_UHR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(\d{1,2})\s*(?:uhr|h)\b(?:\s*(\d{2})\b)?").expect("valid regex")
});
static TIME_AMPM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)").expect("valid regex"));
static TIME_BARE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:um|at|ab|gegen|from|@)\s*(\d{1,2})\b").expect("valid regex")
});
static RANGE_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*(?:-|–|—|bis|to|until|till)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(uhr|h|am|pm|a\.m\.|p\.m\.)?").expect("valid regex")
});
/// "14-16 Uhr", "9:30 - 11 h": the unit stands once, after the end.
static RANGE_UNIT_AT_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|bis)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|h)\b").expect("valid regex")
});
static LABEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*(?:uhrzeit|zeit|time|beginn|start|ab|um)\b\s*[:\-]?").expect("valid regex")
});
static HEADER_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*(?:von|from|gesendet|sent|an|to|cc|betreff|subject)\s*:")
        .expect("valid regex")
});

fn hm(h: u32, m: u32) -> Option<Time> {
    Time::from_hms(u8::try_from(h).ok()?, u8::try_from(m).ok()?, 0).ok()
}

/// 12-hour clock to 24-hour.
fn twelve(h: u32, m: u32, marker: &str) -> Option<Time> {
    if !(1..=12).contains(&h) {
        return None;
    }
    let pm = marker.to_lowercase().starts_with('p');
    hm((h % 12) + if pm { 12 } else { 0 }, m)
}

/// The next time expression in `s`, with where it starts and ends in `s`.
fn first_time(s: &str) -> Option<(Time, usize, usize)> {
    let mut best: Option<(Time, usize, usize)> = None;
    let mut consider = |cand: Option<(Time, usize, usize)>| {
        if let Some(c) = cand {
            if best.is_none_or(|b| c.1 < b.1) {
                best = Some(c);
            }
        }
    };
    if let Some(c) = TIME_COLON.captures(s) {
        let (h, m): (u32, u32) = (c[1].parse().unwrap_or(99), c[2].parse().unwrap_or(99));
        let t = match c.get(3) {
            Some(mk) => twelve(h, m, mk.as_str()),
            None => hm(h, m),
        };
        let whole = c.get(0).expect("whole match");
        consider(t.map(|t| (t, whole.start(), whole.end())));
    }
    if let Some(c) = TIME_DOT_UHR
        .captures(s)
        .filter(|c| number_is_standalone(s, c.get(0).expect("whole match").start()))
    {
        let whole = c.get(0).expect("whole match");
        consider(
            hm(c[1].parse().unwrap_or(99), c[2].parse().unwrap_or(99))
                .map(|t| (t, whole.start(), whole.end())),
        );
    }
    if let Some(c) = TIME_UHR
        .captures(s)
        .filter(|c| number_is_standalone(s, c.get(0).expect("whole match").start()))
    {
        let whole = c.get(0).expect("whole match");
        let m = c.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        consider(hm(c[1].parse().unwrap_or(99), m).map(|t| (t, whole.start(), whole.end())));
    }
    if let Some(c) = TIME_AMPM
        .captures(s)
        .filter(|c| number_is_standalone(s, c.get(0).expect("whole match").start()))
    {
        let whole = c.get(0).expect("whole match");
        consider(
            twelve(c[1].parse().unwrap_or(99), 0, &c[2]).map(|t| (t, whole.start(), whole.end())),
        );
    }
    if let Some(c) = TIME_BARE.captures(s) {
        let whole = c.get(0).expect("whole match");
        // "um 12.11." is the start of a date, not of a time
        let rest = &s[whole.end()..];
        let date_follows =
            rest.starts_with('.') && rest[1..].starts_with(|ch: char| ch.is_ascii_digit());
        if !date_follows && !rest.starts_with(':') {
            consider(hm(c[1].parse().unwrap_or(99), 0).map(|t| (t, whole.start(), whole.end())));
        }
    }
    best
}

/// A time and the end of its range ("14-16 Uhr", "14:00 bis 15:30", "3pm - 4pm").
fn time_with_range(s: &str) -> Option<(Time, Option<Time>)> {
    if let Some(c) = RANGE_UNIT_AT_END.captures(s) {
        let w = c.get(0).expect("whole match");
        if number_is_standalone(s, w.start()) {
            let num = |i: usize| c.get(i).and_then(|m| m.as_str().parse::<u32>().ok());
            if let (Some(h1), Some(h2)) = (num(1), num(3)) {
                if let (Some(a), Some(b)) =
                    (hm(h1, num(2).unwrap_or(0)), hm(h2, num(4).unwrap_or(0)))
                {
                    if b > a {
                        return Some((a, Some(b)));
                    }
                }
            }
        }
    }
    let (start, _, end) = first_time(s)?;
    let end_time = RANGE_END.captures(&s[end..]).and_then(|c| {
        let h: u32 = c[1].parse().ok()?;
        let m: u32 = c.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let t = match c.get(3).map(|u| u.as_str().to_lowercase()) {
            Some(u) if u.starts_with(['a', 'p']) => twelve(h, m, &u),
            _ => hm(h, m),
        };
        t.filter(|e| *e > start)
    });
    Some((start, end_time))
}

/// A number that is not the tail of a longer one ("25:00" must not give "00 Uhr").
fn number_is_standalone(s: &str, at: usize) -> bool {
    let mut before = s[..at].chars().rev();
    match before.next() {
        Some(sep @ (':' | '.' | ',')) => {
            !(before.next().is_some_and(|c| c.is_ascii_digit()) && sep != ',')
        }
        _ => true,
    }
}

fn clean_boundary(line: &str, start: usize, end: usize) -> bool {
    let before = line[..start].chars().next_back();
    let after = line[end..].chars().next();
    !before.is_some_and(|c| c.is_ascii_digit() || c == '.')
        && !after.is_some_and(|c| {
            c.is_ascii_digit()
                || (c == '.' && line[end + 1..].starts_with(|d: char| d.is_ascii_digit()))
        })
}

/// A year-less date is the next time it comes round: this year, unless that was long ago.
fn infer_year(month: Month, day: u8, reference: Date) -> Option<Date> {
    let this = Date::from_calendar_date(reference.year(), month, day).ok()?;
    if this < reference - Duration::days(60) {
        Date::from_calendar_date(reference.year() + 1, month, day).ok()
    } else {
        Some(this)
    }
}

fn with_year(year: i32, month: Month, day: u8) -> Option<Date> {
    Date::from_calendar_date(year, month, day).ok()
}

fn next_weekday(reference: Date, wd: Weekday, strictly_after: bool) -> Date {
    let mut d = if strictly_after {
        reference + Duration::days(1)
    } else {
        reference
    };
    while d.weekday() != wd {
        d += Duration::days(1);
    }
    d
}

/// All dates on one line, with where they are in it.
fn dates_in_line(line: &str, reference: Date) -> Vec<(Date, usize, usize)> {
    let mut found: Vec<(Date, usize, usize)> = Vec::new();
    let overlaps = |found: &[(Date, usize, usize)], s: usize, e: usize| {
        found.iter().any(|(_, fs, fe)| s < *fe && *fs < e)
    };
    for c in ISO.captures_iter(line) {
        let w = c.get(0).expect("whole match");
        let (y, m, d): (i32, u8, u8) = (
            c[1].parse().unwrap_or(0),
            c[2].parse().unwrap_or(0),
            c[3].parse().unwrap_or(0),
        );
        if let (Ok(month), true) = (Month::try_from(m), clean_boundary(line, w.start(), w.end())) {
            if let Some(date) = with_year(y, month, d) {
                found.push((date, w.start(), w.end()));
            }
        }
    }
    for c in NUMERIC.captures_iter(line) {
        let w = c.get(0).expect("whole match");
        if overlaps(&found, w.start(), w.end()) || !clean_boundary(line, w.start(), w.end()) {
            continue;
        }
        let (d, m): (u8, u8) = (c[1].parse().unwrap_or(0), c[2].parse().unwrap_or(0));
        let Ok(month) = Month::try_from(m) else {
            continue;
        };
        let date = match c.get(3) {
            Some(y) => {
                let y: i32 = y.as_str().parse().unwrap_or(0);
                with_year(if y < 100 { 2000 + y } else { y }, month, d)
            }
            None => infer_year(month, d, reference),
        };
        if let Some(date) = date {
            found.push((date, w.start(), w.end()));
        }
    }
    for c in NAMED_DAY_FIRST.captures_iter(line) {
        let w = c.get(0).expect("whole match");
        if overlaps(&found, w.start(), w.end()) {
            continue;
        }
        let (Some(month), Ok(d)) = (month_of(&c[2]), c[1].parse::<u8>()) else {
            continue;
        };
        let date = match c.get(3) {
            Some(y) => with_year(y.as_str().parse().unwrap_or(0), month, d),
            None => infer_year(month, d, reference),
        };
        if let Some(date) = date {
            found.push((date, w.start(), w.end()));
        }
    }
    for c in NAMED_MONTH_FIRST.captures_iter(line) {
        let w = c.get(0).expect("whole match");
        if overlaps(&found, w.start(), w.end()) {
            continue;
        }
        let (Some(month), Ok(d)) = (month_of(&c[1]), c[2].parse::<u8>()) else {
            continue;
        };
        let date = match c.get(3) {
            Some(y) => with_year(y.as_str().parse().unwrap_or(0), month, d),
            None => infer_year(month, d, reference),
        };
        if let Some(date) = date {
            found.push((date, w.start(), w.end()));
        }
    }
    // a weekday or "tomorrow" only counts when no explicit date is on the line ("Freitag, 7. November")
    if found.is_empty() {
        for c in RELATIVE.captures_iter(line) {
            let w = c.get(0).expect("whole match");
            let word = c[1].to_lowercase();
            // "Guten Morgen" is a greeting
            if word == "morgen"
                && line[..w.start()]
                    .trim_end()
                    .to_lowercase()
                    .ends_with("guten")
            {
                continue;
            }
            // capitalised "Morgen" in the middle of a sentence is the noun (the morning)
            if &c[1] == "Morgen"
                && w.start() > 0
                && !line[..w.start()].trim_end().ends_with(['.', '!', '?', ':'])
            {
                continue;
            }
            let date = match word.as_str() {
                "heute" | "today" => reference,
                "morgen" | "tomorrow" => reference + Duration::days(1),
                _ => reference + Duration::days(2),
            };
            found.push((date, w.start(), w.end()));
        }
        for c in WEEKDAY.captures_iter(line) {
            let w = c.get(0).expect("whole match");
            let Some(wd) = weekday_of(&c[2]) else {
                continue;
            };
            let strict = c
                .get(1)
                .is_some_and(|m| !matches!(m.as_str().to_lowercase().as_str(), "diesen" | "this"));
            found.push((next_weekday(reference, wd, strict), w.start(), w.end()));
        }
    }
    found.sort_by_key(|f| f.1);
    found
}

/// Every date mentioned in `text`, each with the time written near it (on the same line, or on a
/// following "Uhrzeit:" line). `reference` is the day the message was written.
pub fn find_mentions(text: &str, reference: Date) -> Vec<Mention> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.trim().is_empty() || HEADER_LINE.is_match(line) {
            continue;
        }
        for (date, start, end) in dates_in_line(line, reference) {
            // after the date first, then before it
            let after = &line[end..];
            let mut time = time_with_range(after);
            if time.is_none() {
                time = time_with_range(&line[..start]);
            }
            if time.is_none() {
                if let Some(next) = lines.get(i + 1) {
                    if LABEL.is_match(next) {
                        time = time_with_range(next);
                    }
                }
            }
            out.push(Mention {
                date,
                start: time.map(|t| t.0),
                end: time.and_then(|t| t.1),
                line: line.trim().to_string(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, time};

    /// A Tuesday.
    const REF: Date = date!(2026 - 11 - 03);

    fn one(text: &str) -> Mention {
        let m = find_mentions(text, REF);
        assert_eq!(m.len(), 1, "{text:?} -> {m:?}");
        m.into_iter().next().unwrap()
    }

    #[test]
    fn german_numeric_dates_with_times() {
        let m = one("Wir treffen uns am 12.11.2026 um 14:30 im Büro.");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 12), Some(time!(14:30)))
        );
        let m = one("Termin: 12.11. 14 Uhr");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 12), Some(time!(14:00)))
        );
        let m = one("am 5.12.26 um 9.15 Uhr");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 12 - 05), Some(time!(9:15)))
        );
    }

    #[test]
    fn named_months_in_german_and_english() {
        let m = one("Freitag, 7. November, 15:00 Uhr");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 07), Some(time!(15:00)))
        );
        let m = one("Meeting on November 5th at 3pm");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 05), Some(time!(15:00)))
        );
        let m = one("am 3. März 2027 um 18 Uhr");
        assert_eq!(
            (m.date, m.start),
            (date!(2027 - 03 - 03), Some(time!(18:00)))
        );
        let m = one("on 24 December 2026, 7:30 pm");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 12 - 24), Some(time!(19:30)))
        );
    }

    #[test]
    fn iso_dates() {
        let m = one("Start: 2026-11-20 09:00");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 20), Some(time!(9:00)))
        );
    }

    #[test]
    fn ranges_give_an_end() {
        let m = one("am 12.11. von 14-16 Uhr");
        assert_eq!((m.start, m.end), (Some(time!(14:00)), Some(time!(16:00))));
        let m = one("12.11.2026, 14:00 bis 15:30");
        assert_eq!((m.start, m.end), (Some(time!(14:00)), Some(time!(15:30))));
        let m = one("Nov 12, 9am - 10am");
        assert_eq!((m.start, m.end), (Some(time!(9:00)), Some(time!(10:00))));
    }

    #[test]
    fn weekdays_and_relative_days_use_the_day_the_mail_was_written() {
        let m = one("Passt dir Freitag um 15 Uhr?");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 06), Some(time!(15:00)))
        );
        let m = one("next Monday at 10:00");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 09), Some(time!(10:00)))
        );
        let m = one("morgen um 9 Uhr");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 04), Some(time!(9:00)))
        );
        let m = one("Heute Abend um 19:30 im Kino");
        assert_eq!((m.date, m.start), (REF, Some(time!(19:30))));
        // the same weekday as today means today for "am Dienstag", a week on for "nächsten Dienstag"
        assert_eq!(one("am Dienstag um 12:00").date, REF);
        assert_eq!(
            one("nächsten Dienstag um 12:00").date,
            date!(2026 - 11 - 10)
        );
    }

    #[test]
    fn an_explicit_date_beats_the_weekday_next_to_it() {
        let m = one("Samstag, 14.11. um 11 Uhr");
        assert_eq!(m.date, date!(2026 - 11 - 14));
    }

    #[test]
    fn a_year_less_date_in_the_past_means_next_year() {
        assert_eq!(one("am 5.1. um 10:00").date, date!(2027 - 01 - 05));
        assert_eq!(one("am 1.11. um 10:00").date, date!(2026 - 11 - 01));
    }

    #[test]
    fn the_time_may_stand_before_the_date_or_on_a_labelled_next_line() {
        let m = one("Um 18:30 Uhr am 20.11. gibt es Abendessen");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 20), Some(time!(18:30)))
        );
        let m = one("Datum: 20.11.2026\nUhrzeit: 18:30 Uhr");
        assert_eq!(
            (m.date, m.start),
            (date!(2026 - 11 - 20), Some(time!(18:30)))
        );
        // an unlabelled next line is a different sentence
        let m = one("Datum: 20.11.2026\n18:30 steht im Plan");
        assert_eq!(m.start, None);
    }

    #[test]
    fn a_date_without_a_time_is_still_reported_with_none() {
        let m = one("Bitte bis zum 15.11.2026 zahlen.");
        assert_eq!((m.date, m.start), (date!(2026 - 11 - 15), None));
    }

    #[test]
    fn things_that_look_like_dates_but_are_not() {
        for text in [
            "Version 1.5.2 ist da",
            "Das kostet 3.50 Euro",
            "Preis: 12.99",
            "Tel. 0151 12.34.56",
            "Guten Morgen zusammen",
            "am Morgen um 7 aufgestanden",
            "Telefon 030 1234567",
            "32.13.2026",
        ] {
            assert!(
                find_mentions(text, REF).is_empty(),
                "{text:?} -> {:?}",
                find_mentions(text, REF)
            );
        }
    }

    #[test]
    fn mail_header_lines_are_skipped() {
        assert!(
            find_mentions("Gesendet: Montag, 2. November 2026 09:00\nVon: Anna", REF).is_empty()
        );
    }

    #[test]
    fn invalid_values_are_ignored() {
        assert_eq!(one("am 12.11. um 25:00 Uhr").start, None);
        assert!(find_mentions("am 31.02.2026", REF).is_empty());
    }

    #[test]
    fn twelve_hour_clock() {
        assert_eq!(one("Nov 12 at 12am").start, Some(time!(0:00)));
        assert_eq!(one("Nov 12 at 12pm").start, Some(time!(12:00)));
        assert_eq!(one("Nov 12 at 1:15 PM").start, Some(time!(13:15)));
    }
}
