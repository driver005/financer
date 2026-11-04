//! The app's logic, in Rust. These are the rules the screens used to compute in TypeScript: how an
//! amount is written, which budget period a day is in, how the "safe to spend" and forecast cards
//! put the server's numbers into words.
//!
//! Everything here is a pure function over plain data. The apps call it by name through the SDK
//! ([`call`]): the arguments are a JSON object, the answer is JSON. The tests here are the old
//! TypeScript tests, moved with the code.

pub mod forecast;
pub mod format;
pub mod game;
pub mod period;
pub mod safe_to_spend;

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
