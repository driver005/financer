//! The app's logic, in Rust. These are the rules the screens used to compute in TypeScript: how an
//! amount is written, which budget period a day is in, how the "safe to spend" and forecast cards
//! put the server's numbers into words.
//!
//! Everything here is a pure function over plain data. The apps call it by name through the SDK
//! ([`call`]): the arguments are a JSON object, the answer is JSON. The tests here are the old
//! TypeScript tests, moved with the code.

pub mod calendar;
pub mod forecast;
pub mod format;
pub mod game;
pub mod notify_plan;
pub mod period;
pub mod safe_to_spend;
pub mod stores;
pub mod watchdog;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

/// A function named `module.name`, called with its arguments as a JSON object; the answer as JSON text.
pub fn call(name: &str, args: &str) -> Result<String, String> {
    let args: Value = if args.trim().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str(args).map_err(|e| format!("the arguments were not JSON: {e}"))?
    };
    let out = match name {
        "format.format_cents" => json(format::format_cents(arg(&args, "cents")?)),
        "format.format_money" => json(format::format_money(
            arg(&args, "cents")?,
            opt(&args, "signed")?.unwrap_or(false),
        )),
        "format.money_tone" => json(format::money_tone(arg(&args, "cents")?)),
        "format.spoken_money" => json(format::spoken_money(arg(&args, "cents")?)),
        "format.split_money" => json(format::split_money(arg(&args, "cents")?)),
        "format.day_heading" => json(format::day_heading(
            &arg::<String>(&args, "iso")?,
            &arg::<String>(&args, "today")?,
        )?),
        "format.format_date" => json(format::format_date(&arg::<String>(&args, "iso")?)),
        "format.parse_euro_input" => {
            json(format::parse_euro_input(&arg::<String>(&args, "input")?))
        }
        "format.servings_text" => json(format::servings_text(arg(&args, "n")?)),
        "period.budget_period" => json(period::budget_period(
            &arg::<String>(&args, "date")?,
            opt(&args, "payday")?.unwrap_or(1.0),
        )?),
        "period.days_in_month" => json(period::days_in_month(
            arg(&args, "year")?,
            arg(&args, "month")?,
        )?),
        "period.previous_period" => json(period::previous_period(
            &arg(&args, "period")?,
            opt(&args, "payday")?.unwrap_or(1.0),
        )?),
        "period.period_days" => json(period::period_days(&arg(&args, "period")?)?),
        "period.period_label" => json(period::period_label(&arg(&args, "period")?)?),
        "safe_to_spend.breakdown_rows" => json(safe_to_spend::breakdown_rows(&arg(&args, "s")?)),
        "safe_to_spend.days_left_text" => {
            json(safe_to_spend::days_left_text(arg(&args, "days_left")?))
        }
        "safe_to_spend.pace_info" => json(safe_to_spend::pace_info(&arg(&args, "s")?)),
        "safe_to_spend.headline_hint" => json(safe_to_spend::headline_hint(&arg(&args, "s")?)),
        "forecast.short_date" => json(forecast::short_date(&arg::<String>(&args, "iso")?)),
        "forecast.days_between" => json(forecast::days_between(
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
        )?),
        "forecast.grocery_text" => json(forecast::grocery_text(&arg(&args, "f")?)?),
        "forecast.forecast_view" => json(forecast::forecast_view(&arg(&args, "f")?)?),
        "game.daily_allowance" => json(game::daily_allowance(
            arg(&args, "limit_cents")?,
            arg(&args, "year")?,
            arg(&args, "month")?,
        )?),
        "game.daily_allowance_for_days" => json(game::daily_allowance_for_days(
            arg(&args, "limit_cents")?,
            arg(&args, "days")?,
        )),
        "game.daily_allowance_on" => json(game::daily_allowance_on(
            arg(&args, "limit_cents")?,
            &arg::<String>(&args, "date")?,
            opt(&args, "payday")?.unwrap_or(1.0),
        )?),
        "game.spent_on" => json(game::spent_on(
            &arg::<Vec<game::Tx>>(&args, "txs")?,
            &arg::<String>(&args, "date")?,
            &arg::<String>(&args, "category")?,
        )),
        "game.streak" => json(game::streak(
            &arg::<Vec<game::Tx>>(&args, "txs")?,
            arg(&args, "limit_cents")?,
            &arg::<String>(&args, "today")?,
            &opt::<String>(&args, "category")?.unwrap_or_else(|| "groceries".into()),
            opt(&args, "payday")?.unwrap_or(1.0),
        )?),
        "game.quests" => json(game::quests(&arg(&args, "p")?)),
        "game.xp" => json(game::xp(arg(&args, "done")?, arg(&args, "streak_days")?)),
        "game.level" => json(game::level(arg(&args, "total_xp")?)),
        "game.coach_message" => json(game::coach_message(&arg(&args, "args")?)),
        "game.mood_for" => json(game::mood_for(&arg(&args, "args")?)),
        "game.week_start" => json(game::week_start(&arg::<String>(&args, "iso")?)?),
        "game.streak_state" => json(game::streak_state(
            &arg::<Vec<game::Tx>>(&args, "txs")?,
            arg(&args, "limit_cents")?,
            &arg::<String>(&args, "today")?,
            &opt::<String>(&args, "category")?.unwrap_or_else(|| "groceries".into()),
            opt(&args, "payday")?.unwrap_or(1.0),
        )?),
        "game.complete_weeks" => json(game::complete_weeks(
            &arg::<Vec<game::Tx>>(&args, "txs")?,
            &arg::<String>(&args, "today")?,
            &opt::<String>(&args, "category")?.unwrap_or_else(|| "groceries".into()),
        )?),
        "game.personal_bests" => json(game::personal_bests(
            &arg::<Vec<game::Tx>>(&args, "txs")?,
            &arg(&args, "streak")?,
            &arg::<String>(&args, "today")?,
            &opt::<String>(&args, "category")?.unwrap_or_else(|| "groceries".into()),
        )?),
        "game.badges" => json(game::badges(&arg(&args, "i")?, &arg(&args, "streak")?)?),
        "game.saved_this_period" => json(game::saved_this_period(
            &arg::<Vec<game::Tx>>(&args, "txs")?,
            &arg::<String>(&args, "today")?,
            opt(&args, "payday")?.unwrap_or(1.0),
        )?),
        "game.fresh_badges" => json(game::fresh_badges(
            arg(&args, "all")?,
            &arg::<Vec<String>>(&args, "seen")?,
            &arg::<Vec<String>>(&args, "celebrated")?,
        )),
        "game.compute_rewards" => json(game::compute_rewards(&arg(&args, "i")?)?),
        "game.trophy_message" => json(game::trophy_message(&arg(&args, "r")?)),
        "game.trophy_mood" => json(game::trophy_mood(
            &arg(&args, "r")?,
            opt(&args, "just_earned")?.unwrap_or(false),
        )),
        "game.badge_ids" => json(game::badge_ids()),
        "game.constants" => json(game::constants()),
        "notify_plan.evening_plan" => json(notify_plan::evening_plan(
            &arg(&args, "safe")?,
            arg(&args, "now_minutes")?,
            opt(&args, "time")?,
            opt(&args, "days")?,
        )?),
        "notify_plan.payday_plan" => json(notify_plan::payday_plan(
            &arg::<String>(&args, "today")?,
            arg(&args, "payday")?,
            arg(&args, "now_minutes")?,
            opt(&args, "time")?,
            opt(&args, "count")?,
        )?),
        "notify_plan.find_price_drops" => json(notify_plan::find_price_drops(
            &arg::<Vec<notify_plan::Tracked>>(&args, "items")?,
            &arg::<Vec<notify_plan::Price>>(&args, "prices")?,
            &arg(&args, "memory")?,
        )),
        "notify_plan.price_drop_message" => json(notify_plan::price_drop_message(&arg::<
            Vec<notify_plan::PriceDrop>,
        >(
            &args, "drops",
        )?)),
        "notify_plan.parse_price_memory" => json(notify_plan::parse_price_memory(
            opt::<String>(&args, "raw")?.as_deref(),
        )),
        "calendar.day_number" => json(calendar::day_number(&arg::<String>(&args, "iso")?)?),
        "calendar.from_day_number" => json(calendar::from_day_number(arg(&args, "n")?)?),
        "calendar.iso_of" => json(calendar::iso_of(
            arg(&args, "y")?,
            arg(&args, "m")?,
            arg(&args, "d")?,
        )),
        "calendar.add_days" => json(calendar::add_days(
            &arg::<String>(&args, "iso")?,
            arg(&args, "n")?,
        )?),
        "calendar.days_between" => json(calendar::days_between(
            &arg::<String>(&args, "a")?,
            &arg::<String>(&args, "b")?,
        )?),
        "calendar.weekday_index" => json(calendar::weekday_index(&arg::<String>(&args, "iso")?)?),
        "calendar.start_of_week" => json(calendar::start_of_week(&arg::<String>(&args, "iso")?)?),
        "calendar.add_months" => json(calendar::add_months(
            &arg::<String>(&args, "iso")?,
            arg(&args, "n")?,
        )?),
        "calendar.add_years" => json(calendar::add_years(
            &arg::<String>(&args, "iso")?,
            arg(&args, "n")?,
        )?),
        "calendar.month_first" => json(calendar::month_first(&arg::<String>(&args, "iso")?)?),
        "calendar.month_last" => json(calendar::month_last(&arg::<String>(&args, "iso")?)?),
        "calendar.week_of" => json(calendar::week_of(&arg::<String>(&args, "iso")?)?),
        "calendar.month_grid" => json(calendar::month_grid(&arg::<String>(&args, "iso")?)?),
        "calendar.month_title" => json(calendar::month_title(&arg::<String>(&args, "iso")?)?),
        "calendar.long_day" => json(calendar::long_day(
            &arg::<String>(&args, "iso")?,
            opt::<String>(&args, "reference")?.as_deref(),
        )?),
        "calendar.short_day" => json(calendar::short_day(&arg::<String>(&args, "iso")?)?),
        "calendar.week_title" => json(calendar::week_title(&arg::<String>(&args, "iso")?)?),
        "calendar.minutes_of" => json(calendar::minutes_of(&arg::<String>(&args, "time")?)),
        "calendar.time_of" => json(calendar::time_of(arg(&args, "minutes")?)),
        "calendar.stamp" => json(calendar::stamp(
            &arg::<String>(&args, "date")?,
            opt::<String>(&args, "time")?.as_deref(),
        )?),
        "calendar.time_range" => json(calendar::time_range(&arg::<calendar::When>(&args, "o")?)?),
        "calendar.series_starts" => json(calendar::series_starts(
            &arg(&args, "rule")?,
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
        )?),
        "calendar.expand" => json(calendar::expand(
            &arg(&args, "rule")?,
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
            &arg::<String>(&args, "tone")?,
            &opt(&args, "extra")?.unwrap_or_default(),
        )?),
        "calendar.on_day" => json(calendar::on_day(
            &arg(&args, "o")?,
            &arg::<String>(&args, "date")?,
        )),
        "calendar.compare_by_start" => json(
            match calendar::by_start(&arg(&args, "a")?, &arg(&args, "b")?)? {
                std::cmp::Ordering::Less => -1,
                std::cmp::Ordering::Equal => 0,
                std::cmp::Ordering::Greater => 1,
            },
        ),
        "calendar.group_by_day" => json(calendar::group_by_day(
            &arg::<Vec<calendar::Occurrence>>(&args, "occurrences")?,
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
        )?),
        "calendar.day_blocks" => json(calendar::day_blocks(
            &arg::<Vec<calendar::Occurrence>>(&args, "list")?,
            &arg::<String>(&args, "date")?,
        )),
        "calendar.parse_quick_add" => json(calendar::parse_quick_add(
            &arg::<String>(&args, "text")?,
            &arg::<String>(&args, "today")?,
            opt::<String>(&args, "fallback_date")?.as_deref(),
        )?),
        "calendar.repeat_text" => json(calendar::repeat_text(opt(&args, "r")?.as_ref())?),
        "calendar.reminder_text" => json(calendar::reminder_text(arg(&args, "minutes")?)),
        "stores.format_permille" => json(stores::format_permille(arg(&args, "permille")?)),
        "stores.change_tone" => json(stores::change_tone(&arg(&args, "row")?)),
        "stores.change_text" => json(stores::change_text(&arg(&args, "row")?)),
        "stores.bar_fraction" => json(stores::bar_fraction(
            arg(&args, "total_cents")?,
            &arg::<Vec<i64>>(&args, "totals")?,
        )),
        "stores.visits_text" => json(stores::visits_text(arg(&args, "visits")?)),
        "stores.last_visit_text" => json(stores::last_visit_text(
            opt::<String>(&args, "last_visit")?.as_deref(),
            &arg::<String>(&args, "today")?,
        )?),
        "stores.compare_text" => json(stores::compare_text(&arg(&args, "r")?)),
        "stores.total_text" => json(stores::total_text(&arg(&args, "r")?)),
        "stores.unmatched_hint" => json(stores::unmatched_hint(&arg(&args, "r")?)),
        "stores.row_label" => json(stores::row_label(&arg(&args, "row")?)),
        "watchdog.week_start" => json(watchdog::week_start(&arg::<String>(&args, "iso")?)?),
        "watchdog.short_date" => json(watchdog::short_date(&arg::<String>(&args, "iso")?)),
        "watchdog.group_by_week" => json(watchdog::group_by_week(
            &arg::<Vec<Value>>(&args, "upcoming")?,
            &arg::<String>(&args, "as_of")?,
        )?),
        "watchdog.cadence_label" => {
            json(watchdog::cadence_label(&arg::<String>(&args, "cadence")?))
        }
        "watchdog.percent_text" => json(watchdog::percent_text(arg(&args, "bp")?)),
        "watchdog.hike_text" => json(watchdog::hike_text(&arg(&args, "h")?)),
        "watchdog.badges_for" => json(watchdog::badges_for(
            &arg(&args, "item")?,
            &arg::<Vec<Value>>(&args, "price_hikes")?,
            &arg::<Vec<Value>>(&args, "duplicates")?,
        )),
        "watchdog.duplicate_text" => json(watchdog::duplicate_text(&arg(&args, "d")?)),
        "watchdog.stale_text" => json(watchdog::stale_text(&arg(&args, "s")?)),
        "watchdog.alert_kind_label" => {
            json(watchdog::alert_kind_label(&arg::<String>(&args, "kind")?))
        }
        "watchdog.severity_rank" => {
            json(watchdog::severity_rank(&arg::<String>(&args, "severity")?))
        }
        "watchdog.alert_text" => json(watchdog::alert_text(&arg(&args, "a")?)),
        "watchdog.sort_alerts" => json(watchdog::sort_alerts(&arg::<Vec<Value>>(&args, "alerts")?)),
        "watchdog.next_charge_text" => json(watchdog::next_charge_text(
            &arg::<Vec<Value>>(&args, "upcoming")?,
            &arg::<String>(&args, "as_of")?,
            arg(&args, "within_days")?,
        )?),
        other => return Err(format!("unknown function {other}")),
    };
    out
}

fn json<T: Serialize>(v: T) -> Result<String, String> {
    serde_json::to_string(&v).map_err(|e| e.to_string())
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    let v = args
        .get(key)
        .ok_or_else(|| format!("missing argument {key}"))?;
    serde_json::from_value(v.clone()).map_err(|e| format!("argument {key}: {e}"))
}

fn opt<T: DeserializeOwned>(args: &Value, key: &str) -> Result<Option<T>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => serde_json::from_value(v.clone())
            .map(Some)
            .map_err(|e| format!("argument {key}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_function_is_called_by_name_with_a_json_object() {
        assert_eq!(
            call("format.format_cents", r#"{"cents":-2347}"#).unwrap(),
            r#""-23,47 €""#
        );
        assert_eq!(
            call("format.format_money", r#"{"cents":2850,"signed":true}"#).unwrap(),
            "\"+28,50\u{a0}€\""
        );
        assert_eq!(
            call("format.parse_euro_input", r#"{"input":"abc"}"#).unwrap(),
            "null"
        );
    }

    #[test]
    fn a_bad_call_says_what_is_wrong() {
        assert!(call("format.nope", "{}")
            .unwrap_err()
            .contains("unknown function"));
        assert!(call("format.format_cents", "{}")
            .unwrap_err()
            .contains("missing argument cents"));
        assert!(call("format.format_cents", r#"{"cents":"x"}"#)
            .unwrap_err()
            .contains("argument cents"));
        assert!(call("format.format_cents", "[")
            .unwrap_err()
            .contains("not JSON"));
    }
}
