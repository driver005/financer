//! How an amount, a date or a count is written. German notation, integer cents in, no floats.

use serde::Serialize;
use time::Date;

const NBSP: char = '\u{a0}';
const MINUS: &str = "\u{2212}";

fn parse_date(iso: &str) -> Result<Date, String> {
    let mut parts = iso.split('-');
    let (y, m, d) = (parts.next(), parts.next(), parts.next());
    let (Some(y), Some(m), Some(d), None) = (y, m, d, parts.next()) else {
        return Err(format!("{iso:?} is not a date (YYYY-MM-DD)"));
    };
    let month = m
        .parse::<u8>()
        .ok()
        .and_then(|m| time::Month::try_from(m).ok())
        .ok_or_else(|| format!("{iso:?} is not a date (YYYY-MM-DD)"))?;
    Date::from_calendar_date(
        y.parse()
            .map_err(|_| format!("{iso:?} is not a date (YYYY-MM-DD)"))?,
        month,
        d.parse()
            .map_err(|_| format!("{iso:?} is not a date (YYYY-MM-DD)"))?,
    )
    .map_err(|_| format!("{iso:?} is not a date (YYYY-MM-DD)"))
}

pub(crate) fn date_of(iso: &str) -> Result<Date, String> {
    parse_date(iso)
}

/// `-2347` -> `-23,47 €` (German notation, integer cents in, no floats).
pub fn format_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.unsigned_abs();
    let digits = (abs / 100).to_string();
    let mut euros = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            euros.push('.');
        }
        euros.push(c);
    }
    format!("{sign}{euros},{:02} €", abs % 100)
}

/// Money for display: German notation, a real minus sign (not a hyphen) and a non-breaking space
/// before the euro sign, so an amount never wraps with the `€` alone on the next line. A positive
/// amount gets a `+` only with `signed` (used where income and spending mix); zero has no sign.
pub fn format_money(cents: i64, signed: bool) -> String {
    let body = format_cents(cents.abs()).replacen(' ', &NBSP.to_string(), 1);
    if cents < 0 {
        format!("{MINUS}{body}")
    } else if signed && cents > 0 {
        format!("+{body}")
    } else {
        body
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MoneyTone {
    Income,
    Expense,
    Zero,
}

/// Which colour role an amount takes: income (green), expense (the normal text colour or red) or none.
pub fn money_tone(cents: i64) -> MoneyTone {
    match cents {
        c if c > 0 => MoneyTone::Income,
        c if c < 0 => MoneyTone::Expense,
        _ => MoneyTone::Zero,
    }
}

/// How a screen reader should say an amount: `minus 23,47 euros`.
pub fn spoken_money(cents: i64) -> String {
    let abs = format_cents(cents.abs()).replace(" €", "");
    format!("{}{abs} euros", if cents < 0 { "minus " } else { "" })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MoneyParts {
    pub sign: String,
    pub whole: String,
    pub fraction: String,
}

/// The parts of an amount, for a hero figure with big euros and small cents.
pub fn split_money(cents: i64) -> MoneyParts {
    let text = format_cents(cents.abs()).replace(" €", "");
    let (whole, fraction) = text.split_once(',').unwrap_or((&text, "00"));
    MoneyParts {
        sign: if cents < 0 {
            MINUS.into()
        } else {
            String::new()
        },
        whole: whole.into(),
        fraction: fraction.into(),
    }
}

/// `2026-03-02` -> `02.03.2026`
pub fn format_date(iso: &str) -> String {
    let mut p = iso.split('-');
    let (y, m, d) = (
        p.next().unwrap_or(""),
        p.next().unwrap_or(""),
        p.next().unwrap_or(""),
    );
    format!("{d}.{m}.{y}")
}

/// Heading of a day group in a list: `Today`, `Yesterday`, else `Mon 12.10.2026`.
pub fn day_heading(iso: &str, today: &str) -> Result<String, String> {
    let (day, now) = (parse_date(iso)?, parse_date(today)?);
    Ok(match (now - day).whole_days() {
        0 => "Today".into(),
        1 => "Yesterday".into(),
        _ => {
            const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            format!(
                "{} {}",
                WEEKDAYS[day.weekday().number_days_from_sunday() as usize],
                format_date(iso)
            )
        }
    })
}

/// Parse German or plain euro input (`40`, `40,50`, `1.234,5`) into cents; `None` if invalid.
pub fn parse_euro_input(input: &str) -> Option<i64> {
    let s: String = input
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '€')
        .collect();
    let (int_part, frac_part) = match s.split_once(',') {
        Some((i, f)) => (i, f),
        None => (s.as_str(), ""),
    };
    let digits = |t: &str| !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit());
    // the whole part: plain digits, or 1-3 digits then groups of exactly three after dots
    let whole_ok = if int_part.contains('.') {
        let mut groups = int_part.split('.');
        let first = groups.next().unwrap_or("");
        digits(first) && first.len() <= 3 && groups.all(|g| digits(g) && g.len() == 3)
    } else {
        digits(int_part)
    };
    let frac_ok =
        frac_part.is_empty() && !s.contains(',') || (digits(frac_part) && frac_part.len() <= 2);
    if !whole_ok || !frac_ok {
        return None;
    }
    let whole: i64 = int_part.replace('.', "").parse().ok()?;
    let frac: i64 = format!("{frac_part:0<2}").parse().ok()?;
    whole.checked_mul(100)?.checked_add(frac)
}

/// "1 serving", "2 servings".
pub fn servings_text(n: i64) -> String {
    format!("{n} {}", if n == 1 { "serving" } else { "servings" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cents_use_german_notation_without_floating_point() {
        assert_eq!(format_cents(-2347), "-23,47 €");
        assert_eq!(format_cents(123456), "1.234,56 €");
        assert_eq!(format_cents(5), "0,05 €");
        assert_eq!(format_cents(100_000_000), "1.000.000,00 €");
        assert_eq!(format_cents(0), "0,00 €");
    }

    #[test]
    fn money_has_a_real_minus_and_a_non_breaking_space() {
        assert_eq!(format_money(-2347, false), "\u{2212}23,47\u{a0}€");
        assert_eq!(format_money(123456, false), "1.234,56\u{a0}€");
        assert_eq!(format_money(0, true), "0,00\u{a0}€");
        assert_eq!(format_money(2850, true), "+28,50\u{a0}€");
        assert_eq!(format_money(2850, false), "28,50\u{a0}€");
        assert_eq!(format_money(-5, true), "\u{2212}0,05\u{a0}€");
    }

    #[test]
    fn tone_follows_the_sign_and_screen_readers_get_words() {
        assert_eq!(money_tone(5), MoneyTone::Income);
        assert_eq!(money_tone(-5), MoneyTone::Expense);
        assert_eq!(money_tone(0), MoneyTone::Zero);
        assert_eq!(spoken_money(-2347), "minus 23,47 euros");
        assert_eq!(spoken_money(100000), "1.000,00 euros");
    }

    #[test]
    fn an_amount_splits_for_a_hero_figure() {
        let p = split_money(3062);
        assert_eq!(
            (p.sign.as_str(), p.whole.as_str(), p.fraction.as_str()),
            ("", "30", "62")
        );
        let n = split_money(-123456);
        assert_eq!(
            (n.sign.as_str(), n.whole.as_str(), n.fraction.as_str()),
            ("\u{2212}", "1.234", "56")
        );
    }

    #[test]
    fn a_day_is_named_by_how_far_it_is_from_today() {
        assert_eq!(day_heading("2026-10-12", "2026-10-12").unwrap(), "Today");
        assert_eq!(
            day_heading("2026-10-11", "2026-10-12").unwrap(),
            "Yesterday"
        );
        assert_eq!(
            day_heading("2026-10-09", "2026-10-12").unwrap(),
            "Fri 09.10.2026"
        );
        assert!(day_heading("nope", "2026-10-12").is_err());
    }

    #[test]
    fn iso_dates_become_german_dates() {
        assert_eq!(format_date("2026-03-02"), "02.03.2026");
    }

    #[test]
    fn euro_input_accepts_plain_and_german_notation() {
        assert_eq!(parse_euro_input("40"), Some(4000));
        assert_eq!(parse_euro_input("40,5"), Some(4050));
        assert_eq!(parse_euro_input("1.234,56"), Some(123456));
        assert_eq!(parse_euro_input(" 12 € "), Some(1200));
        assert_eq!(parse_euro_input("1234"), Some(123400));
        for bad in [
            "abc", "1,234", "", "1.2.3", "-5", "1,2,3", "1.23", ",5", "5,",
        ] {
            assert_eq!(parse_euro_input(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn servings_agree_with_their_number() {
        assert_eq!(servings_text(1), "1 serving");
        assert_eq!(servings_text(2), "2 servings");
    }
}
