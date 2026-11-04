//! Time zones, just enough for mail from Europe. There is no tz database in this build, so the
//! zones with the European daylight-saving rule are known by name (they all switch on the same
//! UTC instants); anything else is reported as unknown and the wall-clock time is kept as written.

use time::{Date, Duration, Month, PrimitiveDateTime, Time, Weekday};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zone {
    Utc,
    /// A zone that follows the EU rule: `std_hours` is the winter offset (0 London/Lisbon, 1 Berlin,
    /// 2 Helsinki/Athens), summer is one hour more.
    Eu {
        std_hours: i8,
    },
}

impl Zone {
    pub const BERLIN: Zone = Zone::Eu { std_hours: 1 };

    /// An IANA name (`Europe/Berlin`) or a Windows one (`W. Europe Standard Time`).
    pub fn from_name(name: &str) -> Option<Zone> {
        let n = name.trim().trim_matches('"').to_lowercase();
        let zone = match n.as_str() {
            "utc"
            | "gmt"
            | "z"
            | "etc/utc"
            | "etc/gmt"
            | "greenwich standard time"
            | "coordinated universal time" => Zone::Utc,
            "europe/london" | "europe/dublin" | "europe/lisbon" | "gmt standard time"
            | "greenwich" | "atlantic/canary" | "atlantic/madeira" => Zone::Eu { std_hours: 0 },
            "europe/berlin"
            | "europe/vienna"
            | "europe/zurich"
            | "europe/paris"
            | "europe/amsterdam"
            | "europe/brussels"
            | "europe/rome"
            | "europe/madrid"
            | "europe/prague"
            | "europe/warsaw"
            | "europe/budapest"
            | "europe/copenhagen"
            | "europe/stockholm"
            | "europe/oslo"
            | "europe/luxembourg"
            | "europe/vaduz"
            | "europe/monaco"
            | "europe/belgrade"
            | "europe/zagreb"
            | "europe/ljubljana"
            | "europe/bratislava"
            | "europe/malta"
            | "w. europe standard time"
            | "central europe standard time"
            | "central european standard time"
            | "romance standard time"
            | "cet"
            | "cest"
            | "mez"
            | "mesz" => Zone::Eu { std_hours: 1 },
            "europe/helsinki"
            | "europe/athens"
            | "europe/bucharest"
            | "europe/sofia"
            | "europe/kiev"
            | "europe/kyiv"
            | "europe/riga"
            | "europe/tallinn"
            | "europe/vilnius"
            | "fle standard time"
            | "gtb standard time"
            | "e. europe standard time"
            | "eet" => Zone::Eu { std_hours: 2 },
            _ => return None,
        };
        Some(zone)
    }

    fn std_secs(self) -> i64 {
        match self {
            Zone::Utc => 0,
            Zone::Eu { std_hours } => i64::from(std_hours) * 3600,
        }
    }

    /// Seconds east of UTC at the UTC instant `unix`.
    pub fn offset_at(self, unix: i64) -> i64 {
        match self {
            Zone::Utc => 0,
            Zone::Eu { .. } => self.std_secs() + if in_summer(unix) { 3600 } else { 0 },
        }
    }

    /// The wall-clock time in this zone at a UTC instant.
    pub fn to_local(self, unix: i64) -> PrimitiveDateTime {
        local_from_secs(unix + self.offset_at(unix))
    }

    /// The UTC instant of a wall-clock time in this zone. In the hour that does not exist (spring)
    /// the summer reading is used; in the hour that happens twice (autumn) the first.
    pub fn to_unix(self, local: PrimitiveDateTime) -> i64 {
        let as_utc = local.assume_utc().unix_timestamp();
        match self {
            Zone::Utc => as_utc,
            Zone::Eu { .. } => {
                let summer = as_utc - self.std_secs() - 3600;
                if in_summer(summer) {
                    summer
                } else {
                    as_utc - self.std_secs()
                }
            }
        }
    }

    /// Wall-clock time in `self` of a wall-clock time in `from`.
    pub fn convert_from(self, from: Zone, local: PrimitiveDateTime) -> PrimitiveDateTime {
        self.to_local(from.to_unix(local))
    }
}

fn local_from_secs(secs: i64) -> PrimitiveDateTime {
    let dt =
        time::OffsetDateTime::from_unix_timestamp(secs).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    PrimitiveDateTime::new(dt.date(), dt.time())
}

fn last_sunday(year: i32, month: Month) -> Date {
    let mut d = Date::from_calendar_date(year, month, 31).expect("March and October have 31 days");
    while d.weekday() != Weekday::Sunday {
        d -= Duration::days(1);
    }
    d
}

/// Summer time runs from the last Sunday of March to the last Sunday of October, both at 01:00 UTC.
fn in_summer(unix: i64) -> bool {
    let year = time::OffsetDateTime::from_unix_timestamp(unix)
        .map(|d| d.year())
        .unwrap_or(1970);
    let at = |d: Date| {
        PrimitiveDateTime::new(d, Time::from_hms(1, 0, 0).expect("valid time"))
            .assume_utc()
            .unix_timestamp()
    };
    unix >= at(last_sunday(year, Month::March)) && unix < at(last_sunday(year, Month::October))
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn knows_common_names() {
        assert_eq!(Zone::from_name("Europe/Berlin"), Some(Zone::BERLIN));
        assert_eq!(
            Zone::from_name("W. Europe Standard Time"),
            Some(Zone::BERLIN)
        );
        assert_eq!(Zone::from_name("UTC"), Some(Zone::Utc));
        assert_eq!(
            Zone::from_name("Europe/London"),
            Some(Zone::Eu { std_hours: 0 })
        );
        assert_eq!(Zone::from_name("America/New_York"), None);
    }

    #[test]
    fn berlin_in_winter_and_summer() {
        // 2026-11-03 12:00 UTC is 13:00 in Berlin; 2026-07-01 12:00 UTC is 14:00
        let winter = datetime!(2026-11-03 12:00).assume_utc().unix_timestamp();
        let summer = datetime!(2026-07-01 12:00).assume_utc().unix_timestamp();
        assert_eq!(Zone::BERLIN.to_local(winter), datetime!(2026-11-03 13:00));
        assert_eq!(Zone::BERLIN.to_local(summer), datetime!(2026-07-01 14:00));
    }

    #[test]
    fn the_switch_happens_on_the_last_sundays() {
        // 2026: March 29 and October 25
        let before = datetime!(2026-03-29 00:59:59).assume_utc().unix_timestamp();
        let after = datetime!(2026-03-29 01:00:00).assume_utc().unix_timestamp();
        assert_eq!(Zone::BERLIN.offset_at(before), 3600);
        assert_eq!(Zone::BERLIN.offset_at(after), 7200);
        let before = datetime!(2026-10-25 00:59:59).assume_utc().unix_timestamp();
        let after = datetime!(2026-10-25 01:00:00).assume_utc().unix_timestamp();
        assert_eq!(Zone::BERLIN.offset_at(before), 7200);
        assert_eq!(Zone::BERLIN.offset_at(after), 3600);
    }

    #[test]
    fn local_time_round_trips() {
        for local in [
            datetime!(2026-01-15 09:30),
            datetime!(2026-07-15 23:10),
            datetime!(2026-10-24 12:00),
        ] {
            assert_eq!(Zone::BERLIN.to_local(Zone::BERLIN.to_unix(local)), local);
        }
    }

    #[test]
    fn converts_between_zones() {
        // 15:00 in London in July is 16:00 in Berlin
        let london = Zone::Eu { std_hours: 0 };
        assert_eq!(
            Zone::BERLIN.convert_from(london, datetime!(2026-07-01 15:00)),
            datetime!(2026-07-01 16:00)
        );
        assert_eq!(
            Zone::BERLIN.convert_from(Zone::Utc, datetime!(2026-12-01 15:00)),
            datetime!(2026-12-01 16:00)
        );
    }
}
