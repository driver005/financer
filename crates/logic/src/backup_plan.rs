//! Automatic backups: when one is due, how the files are named, which to delete. Times are
//! milliseconds since 1970 (UTC), as the device clock gives them.

use serde::Serialize;
use time::OffsetDateTime;

pub const KEEP_AUTO_BACKUPS: usize = 3;
pub const MIN_PASSPHRASE_LENGTH: usize = 8;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const AUTO_PREFIX: &str = "financer-auto-";
const EXTENSION: &str = ".age";

fn schedule_days(schedule: &str) -> Option<i64> {
    match schedule {
        "daily" => Some(1),
        "weekly" => Some(7),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    pub schedule: String,
    /// URI of a folder the user picked, where copies are written as well (if the platform allows).
    pub folder_uri: Option<String>,
}

impl Default for BackupSettings {
    fn default() -> Self {
        BackupSettings {
            schedule: "off".into(),
            folder_uri: None,
        }
    }
}

/// Read stored settings, tolerating anything (missing, old, hand-edited, corrupt).
pub fn parse_backup_settings(raw: Option<&str>) -> BackupSettings {
    let Some(v) = raw
        .filter(|r| !r.is_empty())
        .and_then(|r| serde_json::from_str::<serde_json::Value>(r).ok())
    else {
        return BackupSettings::default();
    };
    let schedule = match v.get("schedule").and_then(|s| s.as_str()) {
        Some(s @ ("daily" | "weekly")) => s.to_string(),
        _ => "off".into(),
    };
    let folder_uri = v
        .get("folderUri")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    BackupSettings {
        schedule,
        folder_uri,
    }
}

fn at(ms: i64) -> Result<OffsetDateTime, String> {
    OffsetDateTime::from_unix_timestamp(ms.div_euclid(1000)).map_err(|e| e.to_string())
}

/// File name of an automatic backup made at `ms` (UTC, sorts chronologically).
pub fn auto_backup_name(ms: i64) -> Result<String, String> {
    let t = at(ms)?;
    Ok(format!(
        "{AUTO_PREFIX}{:04}{:02}{:02}T{:02}{:02}{:02}Z{EXTENSION}",
        t.year(),
        t.month() as u8,
        t.day(),
        t.hour(),
        t.minute(),
        t.second()
    ))
}

/// Manual backups: a date in the name, easy for people to tell apart.
pub fn manual_backup_name(ms: i64) -> Result<String, String> {
    let t = at(ms)?;
    Ok(format!(
        "financer-backup-{:04}-{:02}-{:02}{EXTENSION}",
        t.year(),
        t.month() as u8,
        t.day()
    ))
}

/// When an automatic backup file was made (from its name), or none if it is not one of ours.
/// The name is `financer-auto-20261012T143005Z.age`.
pub fn auto_backup_time(name: &str) -> Option<i64> {
    let stamp = name
        .strip_prefix(AUTO_PREFIX)?
        .strip_suffix(EXTENSION)?
        .strip_suffix('Z')?;
    let (date, time) = stamp.split_once('T')?;
    if date.len() != 8
        || time.len() != 6
        || !date.bytes().chain(time.bytes()).all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let n = |s: &str| s.parse::<i64>().ok();
    let month = time::Month::try_from(n(&date[4..6])? as u8).ok()?;
    let d =
        time::Date::from_calendar_date(n(&date[..4])? as i32, month, n(&date[6..8])? as u8).ok();
    // JavaScript's Date.UTC rolls over an out-of-range day instead of refusing it; so do the arithmetic by hand
    let days = match d {
        Some(d) => i64::from(d.to_julian_day()) - 2_440_588,
        None => {
            let first = time::Date::from_calendar_date(n(&date[..4])? as i32, month, 1).ok()?;
            i64::from(first.to_julian_day()) - 2_440_588 + n(&date[6..8])? - 1
        }
    };
    Some(days * DAY_MS + (n(&time[..2])? * 3600 + n(&time[2..4])? * 60 + n(&time[4..6])?) * 1000)
}

/// Time of the newest automatic backup among `names`, or none if there is none.
pub fn newest_auto_backup(names: &[String]) -> Option<i64> {
    names.iter().filter_map(|n| auto_backup_time(n)).max()
}

/// Is a new automatic backup due? Yes when the schedule is on and there is none yet or the newest is
/// at least a day (daily) or seven days (weekly) old. A newest backup that lies more than a day in
/// the future means the clock was wrong when it was made: that counts as due, otherwise a wrong
/// clock would stop backups for good.
pub fn is_backup_due(schedule: &str, newest_ms: Option<i64>, now_ms: i64) -> bool {
    let Some(days) = schedule_days(schedule) else {
        return false;
    };
    match newest_ms {
        None => true,
        Some(n) if n > now_ms + DAY_MS => true,
        Some(n) => now_ms - n >= days * DAY_MS,
    }
}

/// Automatic backups to delete so that only the newest `keep` remain. Other files are never touched.
pub fn auto_backups_to_delete(names: &[String], keep: usize) -> Vec<String> {
    let mut mine: Vec<(&String, i64)> = names
        .iter()
        .filter_map(|n| auto_backup_time(n).map(|t| (n, t)))
        .collect();
    mine.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(a.0)));
    mine.into_iter()
        .skip(keep)
        .map(|(n, _)| n.clone())
        .collect()
}

/// Passphrase rules shared by the screen and the server (which needs at least 8 characters).
pub fn passphrase_problem(passphrase: &str, confirm: Option<&str>) -> Option<String> {
    if passphrase.chars().count() < MIN_PASSPHRASE_LENGTH {
        return Some(format!("Use at least {MIN_PASSPHRASE_LENGTH} characters."));
    }
    match confirm {
        Some(c) if c != passphrase => Some("The two passphrases are different.".into()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: i64 = 1_791_815_405_000; // 2026-10-12T14:30:05Z

    #[test]
    fn stored_settings_are_read_leniently() {
        assert_eq!(parse_backup_settings(None), BackupSettings::default());
        assert_eq!(
            parse_backup_settings(Some("{broken")),
            BackupSettings::default()
        );
        assert_eq!(
            parse_backup_settings(Some(r#"{"schedule":"weekly","folderUri":"file:///x"}"#)),
            BackupSettings {
                schedule: "weekly".into(),
                folder_uri: Some("file:///x".into())
            }
        );
        assert_eq!(
            parse_backup_settings(Some(r#"{"schedule":"hourly","folderUri":""}"#)),
            BackupSettings::default()
        );
    }

    #[test]
    fn files_are_named_by_their_time_and_read_back() {
        assert_eq!(
            auto_backup_name(T).unwrap(),
            "financer-auto-20261012T143005Z.age"
        );
        assert_eq!(
            manual_backup_name(T).unwrap(),
            "financer-backup-2026-10-12.age"
        );
        assert_eq!(
            auto_backup_time("financer-auto-20261012T143005Z.age"),
            Some(T)
        );
        assert_eq!(auto_backup_time("financer-backup-2026-10-12.age"), None);
        assert_eq!(auto_backup_time("financer-auto-2026101T143005Z.age"), None);
        assert_eq!(
            auto_backup_time("financer-auto-20261012T143005Z.age.bak"),
            None
        );
    }

    #[test]
    fn a_backup_is_due_by_the_schedule_and_a_wrong_clock_does_not_stop_them() {
        assert!(!is_backup_due("off", None, T));
        assert!(is_backup_due("daily", None, T));
        assert!(!is_backup_due("daily", Some(T - DAY_MS + 1), T));
        assert!(is_backup_due("daily", Some(T - DAY_MS), T));
        assert!(!is_backup_due("weekly", Some(T - 6 * DAY_MS), T));
        assert!(is_backup_due("weekly", Some(T - 7 * DAY_MS), T));
        assert!(
            is_backup_due("weekly", Some(T + 2 * DAY_MS), T),
            "made with a wrong clock"
        );
        assert!(!is_backup_due("weekly", Some(T + DAY_MS / 2), T));
    }

    #[test]
    fn only_the_newest_automatic_backups_are_kept() {
        let names: Vec<String> = [
            "financer-auto-20261001T000000Z.age",
            "financer-auto-20261003T000000Z.age",
            "my-notes.txt",
            "financer-auto-20261002T000000Z.age",
            "financer-auto-20261004T000000Z.age",
            "financer-backup-2026-10-01.age",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            auto_backups_to_delete(&names, 3),
            ["financer-auto-20261001T000000Z.age"]
        );
        assert_eq!(auto_backups_to_delete(&names, 0).len(), 4);
        assert_eq!(
            newest_auto_backup(&names),
            auto_backup_time("financer-auto-20261004T000000Z.age")
        );
        assert_eq!(newest_auto_backup(&["x".to_string()]), None);
    }

    #[test]
    fn a_passphrase_is_checked_for_length_and_confirmation() {
        assert_eq!(
            passphrase_problem("short", None).as_deref(),
            Some("Use at least 8 characters.")
        );
        assert_eq!(passphrase_problem("longenough", None), None);
        assert_eq!(
            passphrase_problem("longenough", Some("different")).as_deref(),
            Some("The two passphrases are different.")
        );
        assert_eq!(passphrase_problem("longenough", Some("longenough")), None);
        assert_eq!(
            passphrase_problem("äöüäöüäö", None),
            None,
            "length counts characters"
        );
    }
}
