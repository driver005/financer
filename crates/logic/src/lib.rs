//! The app's logic, in Rust. These are the rules the screens used to compute in TypeScript: how an
//! amount is written, which budget period a day is in, how the "safe to spend" and forecast cards
//! put the server's numbers into words.
//!
//! Everything here is a pure function over plain data. The apps call it by name through the SDK
//! ([`call`]): the arguments are a JSON object, the answer is JSON. The tests here are the old
//! TypeScript tests, moved with the code.

pub mod app_lock;
pub mod app_misc;
pub mod backup_plan;
pub mod bank_connections;
pub mod calendar;
pub mod calendar_feeds;
pub mod calendar_form;
pub mod calendar_view;
pub mod charts;
pub mod forecast;
pub mod format;
pub mod game;
pub mod grocery_view;
pub(crate) mod js;
pub mod mail_format;
pub mod mail_text;
pub mod mealplan;
pub mod notify_plan;
pub mod onboarding;
pub mod period;
pub mod receipt_sources;
pub mod recipe_view;
pub mod rules;
pub mod safe_to_spend;
pub mod scan;
pub mod search;
pub mod server_config;
pub mod settings_plan;
pub mod shop_format;
pub mod shop_misc;
pub mod shop_progress;
pub mod shop_schema;
pub mod shop_view;
pub mod shop_weights;
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
        "rules.draft_from_rule" => json(rules::draft_from_rule(&arg(&args, "r")?)),
        "rules.rule_from_draft" => json(rules::rule_from_draft(&arg(&args, "d")?)),
        "rules.describe_rule" => json(rules::describe_rule(&arg(&args, "r")?)),
        "rules.move_id" => json(rules::move_id(
            &arg::<Vec<i64>>(&args, "ids")?,
            arg(&args, "index")?,
            arg(&args, "delta")?,
        )),
        "rules.split_remainder" => json(rules::split_remainder(
            arg(&args, "total_cents")?,
            &arg::<Vec<rules::SplitDraftPart>>(&args, "parts")?,
        )),
        "rules.initial_split" => json(rules::initial_split(
            arg(&args, "total_cents")?,
            opt::<String>(&args, "category")?.as_deref(),
        )),
        "rules.split_from_draft" => json(rules::split_from_draft(
            arg(&args, "total_cents")?,
            &arg::<Vec<rules::SplitDraftPart>>(&args, "parts")?,
        )),
        "rules.draft_from_split" => json(rules::draft_from_split(
            &arg::<Vec<rules::SplitPartBody>>(&args, "parts")?,
        )),
        "settings_plan.server_host" => {
            json(settings_plan::server_host(&arg::<String>(&args, "url")?))
        }
        "settings_plan.connection_state" => {
            json(settings_plan::connection_state(&arg(&args, "i")?))
        }
        "settings_plan.habit_label" => {
            json(settings_plan::habit_label(&arg::<String>(&args, "mode")?))
        }
        "settings_plan.provider_label" => json(settings_plan::provider_label(&arg::<String>(
            &args, "provider",
        )?)),
        "settings_plan.ai_summary" => json(settings_plan::ai_summary(
            &arg::<String>(&args, "provider")?,
            arg(&args, "key_configured")?,
            &arg::<String>(&args, "model")?,
        )),
        "settings_plan.price_sources_label" => {
            json(settings_plan::price_sources_label(arg(&args, "n")?))
        }
        "settings_plan.on_count_label" => json(settings_plan::on_count_label(
            arg(&args, "on")?,
            arg(&args, "total")?,
        )),
        "settings_plan.payday_label" => json(settings_plan::payday_label(arg(&args, "day")?)),
        "settings_plan.blz_problem" => {
            json(settings_plan::blz_problem(&arg::<String>(&args, "blz")?))
        }
        "settings_plan.iban_checksum_ok" => json(settings_plan::iban_checksum_ok(&arg::<String>(
            &args, "iban",
        )?)),
        "settings_plan.iban_problem" => {
            json(settings_plan::iban_problem(&arg::<String>(&args, "iban")?))
        }
        "backup_plan.parse_backup_settings" => json(backup_plan::parse_backup_settings(
            opt::<String>(&args, "raw")?.as_deref(),
        )),
        "backup_plan.auto_backup_name" => json(backup_plan::auto_backup_name(arg(&args, "ms")?)?),
        "backup_plan.manual_backup_name" => {
            json(backup_plan::manual_backup_name(arg(&args, "ms")?)?)
        }
        "backup_plan.auto_backup_time" => json(backup_plan::auto_backup_time(&arg::<String>(
            &args, "name",
        )?)),
        "backup_plan.newest_auto_backup" => {
            json(backup_plan::newest_auto_backup(&arg::<Vec<String>>(
                &args, "names",
            )?))
        }
        "backup_plan.is_backup_due" => json(backup_plan::is_backup_due(
            &arg::<String>(&args, "schedule")?,
            opt(&args, "newest_ms")?,
            arg(&args, "now_ms")?,
        )),
        "backup_plan.auto_backups_to_delete" => json(backup_plan::auto_backups_to_delete(
            &arg::<Vec<String>>(&args, "names")?,
            opt(&args, "keep")?.unwrap_or(backup_plan::KEEP_AUTO_BACKUPS),
        )),
        "backup_plan.passphrase_problem" => json(backup_plan::passphrase_problem(
            &arg::<String>(&args, "passphrase")?,
            opt::<String>(&args, "confirm")?.as_deref(),
        )),
        "recipe_view.scale_amount" => json(recipe_view::scale_amount(
            &arg::<String>(&args, "text")?,
            arg(&args, "servings")?,
            arg(&args, "base")?,
        )),
        "recipe_view.clamp_servings" => json(recipe_view::clamp_servings(arg(&args, "n")?)),
        "grocery_view.hash_text" => json(grocery_view::hash_text(&arg::<String>(&args, "text")?)),
        "grocery_view.meal_tone" => json(grocery_view::meal_tone(&arg::<String>(&args, "seed")?)),
        "grocery_view.chain_tone" => {
            json(grocery_view::chain_tone(&arg::<String>(&args, "chain")?))
        }
        "grocery_view.initials" => json(grocery_view::initials(&arg::<String>(&args, "name")?)),
        "grocery_view.rank_prices" => json(grocery_view::rank_prices(&arg::<Vec<Value>>(
            &args, "prices",
        )?)),
        "grocery_view.item_saving" => json(grocery_view::item_saving(&arg::<Vec<Value>>(
            &args, "prices",
        )?)),
        "grocery_view.summarize_prices" => {
            json(grocery_view::summarize_prices(&arg::<Vec<Vec<Value>>>(
                &args, "groups",
            )?))
        }
        "grocery_view.extra_text" => json(grocery_view::extra_text(arg(&args, "extra_cents")?)),
        "grocery_view.cost_per_serving" => json(grocery_view::cost_per_serving(
            arg(&args, "missing_cost_cents")?,
            arg(&args, "servings")?,
            arg(&args, "missing")?,
        )),
        "grocery_view.match_tone" => json(grocery_view::match_tone(arg(&args, "percent")?)),
        "grocery_view.short_list" => json(grocery_view::short_list(
            &arg::<Vec<String>>(&args, "names")?,
            arg(&args, "max")?,
        )),
        "grocery_view.percent_done" => json(grocery_view::percent_done(
            arg(&args, "done")?,
            arg(&args, "total")?,
        )),
        "mealplan.chain_name" => json(mealplan::chain_name(&arg::<String>(&args, "chain")?)),
        "mealplan.week_days" => json(mealplan::week_days(&arg::<String>(&args, "start")?)?),
        "mealplan.shift_week" => json(mealplan::shift_week(
            &arg::<String>(&args, "start")?,
            arg(&args, "weeks")?,
        )?),
        "mealplan.weekday_name" => json(mealplan::weekday_name(&arg::<String>(&args, "iso")?)?),
        "mealplan.short_date" => json(mealplan::short_date(&arg::<String>(&args, "iso")?)),
        "mealplan.week_label" => json(mealplan::week_label(&arg::<String>(&args, "start")?)?),
        "mealplan.week_relation" => json(mealplan::week_relation(
            &arg::<String>(&args, "start")?,
            &arg::<String>(&args, "today")?,
        )?),
        "mealplan.clamp_servings" => json(mealplan::clamp_servings(
            opt(&args, "n")?.unwrap_or(f64::NAN),
        )), // JSON has no NaN: it arrives as null
        "mealplan.plan_from_days" => {
            json(mealplan::plan_from_days(&arg::<Vec<Value>>(&args, "days")?))
        }
        "mealplan.entry_from_recipe" => json(mealplan::entry_from_recipe(
            &arg(&args, "r")?,
            opt(&args, "servings")?,
        )),
        "mealplan.entry_from_idea" => json(mealplan::entry_from_idea(
            &arg(&args, "i")?,
            opt(&args, "servings")?,
        )),
        "mealplan.set_day" => json(mealplan::set_day(
            &arg(&args, "plan")?,
            &arg::<String>(&args, "iso")?,
            opt(&args, "entry")?,
        )),
        "mealplan.plan_to_input" => json(mealplan::plan_to_input(
            &arg(&args, "plan")?,
            &arg::<String>(&args, "start")?,
        )?),
        "mealplan.item_tick_id" => json(mealplan::item_tick_id(&arg::<String>(&args, "item")?)),
        "mealplan.unmatched_tick_id" => {
            json(mealplan::unmatched_tick_id(&arg::<String>(&args, "name")?))
        }
        "mealplan.tick_ids" => json(mealplan::tick_ids(&arg(&args, "list")?)),
        "mealplan.toggle_tick" => json(mealplan::toggle_tick(
            &arg::<Vec<String>>(&args, "ticks")?,
            &arg::<String>(&args, "id")?,
        )),
        "mealplan.prune_ticks" => json(mealplan::prune_ticks(
            &arg::<Vec<String>>(&args, "ticks")?,
            &arg(&args, "list")?,
        )),
        "mealplan.tick_progress" => json(mealplan::tick_progress(
            &arg(&args, "list")?,
            &arg::<Vec<String>>(&args, "ticks")?,
        )),
        "mealplan.ticks_key" => json(mealplan::ticks_key(&arg::<String>(&args, "start")?)),
        "mealplan.serialize_ticks" => json(mealplan::serialize_ticks(&arg::<Vec<String>>(
            &args, "ticks",
        )?)),
        "mealplan.parse_ticks" => json(mealplan::parse_ticks(
            opt::<String>(&args, "raw")?.as_deref(),
        )),
        "mealplan.budget_verdict" => json(mealplan::budget_verdict(&arg(&args, "b")?)),
        "mealplan.plan_headline" => json(mealplan::plan_headline(&arg(&args, "plan")?)),
        "mealplan.chain_total_text" => json(mealplan::chain_total_text(&arg(&args, "c")?)),
        "mealplan.item_detail" => json(mealplan::item_detail(&arg(&args, "i")?)),
        "mealplan.unmatched_text" => json(mealplan::unmatched_text(&arg(&args, "u")?)),
        "scan.check_ean" => json(scan::check_ean(&arg::<String>(&args, "input")?)),
        "scan.format_unit_price" => json(scan::format_unit_price(
            arg(&args, "cents")?,
            &arg::<String>(&args, "unit")?,
        )),
        "scan.chain_rows" => json(scan::chain_rows(&arg(&args, "r")?)),
        "scan.headline" => json(scan::headline(&arg(&args, "r")?)),
        "scan.product_title" => json(scan::product_title(&arg(&args, "r")?)),
        "scan.observation_line" => json(scan::observation_line(&arg(&args, "o")?)),
        "scan.plan_add_to_usual" => json(scan::plan_add_to_usual(
            &arg(&args, "basket")?,
            &arg::<String>(&args, "item")?,
        )),
        "onboarding.steps_for" => json(onboarding::steps_for(&arg::<String>(&args, "platform")?)),
        "onboarding.is_step_id" => json(onboarding::is_step_id(&arg::<String>(&args, "value")?)),
        "onboarding.next_step" => json(onboarding::next_step(
            &arg::<Vec<String>>(&args, "steps")?,
            &arg::<String>(&args, "current")?,
        )),
        "onboarding.previous_step" => json(onboarding::previous_step(
            &arg::<Vec<String>>(&args, "steps")?,
            &arg::<String>(&args, "current")?,
        )),
        "onboarding.progress_of" => json(onboarding::progress_of(
            &arg::<Vec<String>>(&args, "steps")?,
            &arg::<String>(&args, "current")?,
        )),
        "onboarding.resolve_step" => json(onboarding::resolve_step(
            &arg::<Vec<String>>(&args, "steps")?,
            &arg::<String>(&args, "stored")?,
        )),
        "onboarding.sanitize_draft" => {
            json(onboarding::sanitize_draft(&arg::<Value>(&args, "raw")?))
        }
        "onboarding.parse_state" => json(onboarding::parse_state(
            opt::<String>(&args, "raw")?.as_deref(),
        )),
        "onboarding.clamp_household" => json(onboarding::clamp_household(
            opt(&args, "n")?.unwrap_or(f64::NAN),
        )),
        "onboarding.parse_postal_code" => json(onboarding::parse_postal_code(&arg::<String>(
            &args, "input",
        )?)),
        "onboarding.parse_budget" => {
            json(onboarding::parse_budget(&arg::<String>(&args, "input")?))
        }
        "onboarding.monthly_grocery_cents" => json(onboarding::monthly_grocery_cents(
            arg(&args, "cents")?,
            &arg::<String>(&args, "cadence")?,
        )),
        "onboarding.validate_server" => json(onboarding::validate_server(
            &arg::<String>(&args, "url")?,
            &arg::<String>(&args, "token")?,
        )),
        "onboarding.household_factor" => json(onboarding::household_factor(
            opt(&args, "size")?.unwrap_or(f64::NAN),
        )),
        "onboarding.suggest_allowance" => json(onboarding::suggest_allowance(&arg(&args, "args")?)),
        "onboarding.grocery_limit_for" => json(onboarding::grocery_limit_for(
            &arg(&args, "draft")?,
            &arg::<String>(&args, "today")?,
        )?),
        "onboarding.parse_profile" => json(onboarding::parse_profile(
            opt::<String>(&args, "raw")?.as_deref(),
        )),
        "onboarding.merge_profile" => json(onboarding::merge_profile(
            &arg(&args, "existing")?,
            &arg(&args, "draft")?,
        )),
        "onboarding.plan_apply" => json(onboarding::plan_apply(
            &arg(&args, "draft")?,
            &arg::<String>(&args, "today")?,
            &arg::<Vec<onboarding::Envelope>>(&args, "existing")?,
        )?),
        "onboarding.mascot_for" => json(onboarding::mascot_for(
            &arg::<String>(&args, "step")?,
            &arg(&args, "draft")?,
            arg(&args, "embedded_available")?,
        )),
        "onboarding.recap_rows" => json(onboarding::recap_rows(
            &arg(&args, "draft")?,
            &arg::<String>(&args, "platform")?,
        )),
        "onboarding.first_quest" => json(onboarding::first_quest(&arg(&args, "draft")?)),
        "onboarding.entry_action" => json(onboarding::entry_action(&arg(&args, "i")?)),
        "server_config.entry_noun" => {
            json(server_config::entry_noun(&arg::<String>(&args, "path")?))
        }
        "server_config.entry_title" => json(server_config::entry_title(
            &arg::<String>(&args, "path")?,
            &arg::<Vec<Value>>(&args, "fields")?,
            &arg::<Value>(&args, "row")?,
            arg(&args, "index")?,
        )),
        "server_config.row_from_server" => json(server_config::row_from_server(
            &arg(&args, "key")?,
            &opt::<Value>(&args, "raw")?.unwrap_or(Value::Null),
        )),
        "server_config.empty_row" => json(server_config::empty_row(&arg(&args, "key")?)),
        "server_config.server_value" => json(server_config::server_value(&arg(&args, "key")?)),
        "server_config.editor_value" => json(server_config::editor_value(
            &arg(&args, "key")?,
            &arg(&args, "draft")?,
        )),
        "server_config.set_value" => json(server_config::set_value(
            &arg(&args, "draft")?,
            &arg(&args, "key")?,
            &arg(&args, "value")?,
        )),
        "server_config.clear_secret" => json(server_config::clear_secret(
            &arg(&args, "draft")?,
            &arg(&args, "key")?,
        )),
        "server_config.reset_key" => json(server_config::reset_key(
            &arg(&args, "draft")?,
            &arg(&args, "key")?,
        )),
        "server_config.discard_key" => json(server_config::discard_key(
            &arg(&args, "draft")?,
            &arg(&args, "key")?,
        )),
        "server_config.is_dirty" => json(server_config::is_dirty(
            &arg::<String>(&args, "path")?,
            &arg(&args, "draft")?,
        )),
        "server_config.change_count" => json(server_config::change_count(&arg(&args, "draft")?)),
        "server_config.editable" => json(server_config::editable(&arg(&args, "key")?)),
        "server_config.field_visible" => json(server_config::field_visible(
            &arg(&args, "key")?,
            &arg(&args, "field")?,
            &arg(&args, "row")?,
        )),
        "server_config.row_to_wire" => json(server_config::row_to_wire(
            &arg(&args, "key")?,
            &arg(&args, "row")?,
        )),
        "server_config.wire_value" => json(server_config::wire_value(
            &arg(&args, "key")?,
            &opt::<Value>(&args, "value")?.unwrap_or(Value::Null),
        )),
        "server_config.to_change" => json(server_config::to_change(
            &arg(&args, "view")?,
            &arg(&args, "draft")?,
        )),
        "server_config.problem_for" => json(server_config::problem_for(
            &arg(&args, "key")?,
            &opt::<Value>(&args, "value")?.unwrap_or(Value::Null),
        )),
        "server_config.draft_problems" => json(server_config::draft_problems(
            &arg(&args, "view")?,
            &arg(&args, "draft")?,
        )),
        "server_config.warnings_for" => json(server_config::warnings_for(
            &arg(&args, "view")?,
            &arg(&args, "draft")?,
        )),
        "server_config.new_token" => json(server_config::new_token(&arg(&args, "draft")?)),
        "server_config.source_label" => json(server_config::source_label(&arg(&args, "key")?)),
        "server_config.source_tone" => json(server_config::source_tone(&arg(&args, "key")?)),
        "server_config.value_summary" => json(server_config::value_summary(&arg(&args, "key")?)),
        "server_config.group_summary" => json(server_config::group_summary(
            &arg(&args, "group")?,
            &arg(&args, "draft")?,
        )),
        "server_config.save_summary" => json(server_config::save_summary(&arg(&args, "draft")?)),
        "server_config.saved_text" => json(server_config::saved_text(&arg(&args, "saved")?)),
        "server_config.timeout_text" => json(server_config::timeout_text(arg(
            &args,
            "changed_listen_address",
        )?)),
        "receipt_sources.source_title" => {
            json(receipt_sources::source_title(&arg::<String>(&args, "s")?))
        }
        "receipt_sources.source_icon" => {
            json(receipt_sources::source_icon(&arg::<String>(&args, "s")?))
        }
        "receipt_sources.source_blurb" => {
            json(receipt_sources::source_blurb(&arg::<String>(&args, "s")?))
        }
        "receipt_sources.health_pill" => json(receipt_sources::health_pill(&arg::<String>(
            &args, "state",
        )?)),
        "receipt_sources.last_sync_text" => json(receipt_sources::last_sync_text(
            opt(&args, "ts")?,
            arg(&args, "now_sec")?,
        )),
        "receipt_sources.next_run_text" => json(receipt_sources::next_run_text(
            opt(&args, "ts")?,
            arg(&args, "now_sec")?,
        )),
        "receipt_sources.imported_text" => json(receipt_sources::imported_text(arg(&args, "n")?)),
        "receipt_sources.can_sync_now" => json(receipt_sources::can_sync_now(
            arg(&args, "enabled")?,
            &arg::<String>(&args, "state")?,
        )),
        "receipt_sources.attention_count" => json(receipt_sources::attention_count(&arg::<
            Vec<receipt_sources::SourceLike>,
        >(
            &args, "list",
        )?)),
        "receipt_sources.summary_text" => {
            json(receipt_sources::summary_text(&arg::<
                Vec<receipt_sources::SourceLike>,
            >(&args, "list")?))
        }
        "receipt_sources.sync_result_text" => json(receipt_sources::sync_result_text(
            arg(&args, "imported")?,
            arg(&args, "linked")?,
        )),
        "receipt_sources.setup_steps" => json(receipt_sources::setup_steps(
            &arg::<String>(&args, "s")?,
            opt(&args, "on_phone")?.unwrap_or(false),
        )),
        "receipt_sources.sign_in_promises" => json(receipt_sources::sign_in_promises(
            &arg::<String>(&args, "shop")?,
            opt(&args, "on_phone")?.unwrap_or(false),
        )),
        "receipt_sources.is_signed_in" => json(receipt_sources::is_signed_in(&arg::<String>(
            &args, "state",
        )?)),
        "receipt_sources.sign_in_state_text" => json(receipt_sources::sign_in_state_text(
            &arg::<String>(&args, "shop")?,
            &arg::<String>(&args, "state")?,
            opt(&args, "connected_at")?,
            arg(&args, "now_sec")?,
            opt(&args, "on_phone")?.unwrap_or(false),
        )),
        "receipt_sources.listed_sources" => {
            json(receipt_sources::listed_sources(&arg::<Vec<Value>>(
                &args, "list",
            )?))
        }
        "receipt_sources.lidl_promises" => json(receipt_sources::lidl_promises(
            opt(&args, "on_phone")?.unwrap_or(false),
        )),
        "receipt_sources.disconnected_text" => {
            json(receipt_sources::disconnected_text(arg(&args, "on_phone")?))
        }
        "receipt_sources.no_source_text" => {
            json(receipt_sources::no_source_text(arg(&args, "on_phone")?))
        }
        "receipt_sources.sign_in_mode" => json(receipt_sources::sign_in_mode(&arg::<String>(
            &args,
            "platform_os",
        )?)),
        "receipt_sources.extract_callback_url" => json(receipt_sources::extract_callback_url(
            &arg::<String>(&args, "input")?,
            &arg::<String>(&args, "scheme")?,
        )),
        "receipt_sources.callback_has_result" => json(receipt_sources::callback_has_result(
            &arg::<String>(&args, "url")?,
        )),
        "receipt_sources.lidl_state_text" => json(receipt_sources::lidl_state_text(
            &arg::<String>(&args, "state")?,
            opt(&args, "connected_at")?,
            arg(&args, "now_sec")?,
            opt(&args, "on_phone")?.unwrap_or(false),
        )),
        "bank_connections.is_busy" => json(bank_connections::is_busy(&arg(&args, "c")?)),
        "bank_connections.links_once" => json(bank_connections::links_once(&arg(&args, "c")?)),
        "bank_connections.is_running" => json(bank_connections::is_running(&arg(&args, "s")?)),
        "bank_connections.apply_sync" => json(bank_connections::apply_sync(
            &arg(&args, "c")?,
            &arg(&args, "s")?,
        )),
        "bank_connections.sync_result_text" => {
            json(bank_connections::sync_result_text(&arg(&args, "s")?))
        }
        "bank_connections.is_plaid" => json(bank_connections::is_plaid(&arg(&args, "c")?)),
        "bank_connections.needs_linking" => {
            json(bank_connections::needs_linking(&arg(&args, "c")?))
        }
        "bank_connections.provider_label" => {
            json(bank_connections::provider_label(&arg(&args, "c")?))
        }
        "bank_connections.connection_subtitle" => {
            json(bank_connections::connection_subtitle(&arg(&args, "c")?))
        }
        "bank_connections.linked_accounts_text" => {
            json(bank_connections::linked_accounts_text(&arg(&args, "c")?))
        }
        "bank_connections.sync_button_label" => json(bank_connections::sync_button_label(
            &arg(&args, "c")?,
            arg(&args, "starting")?,
        )),
        "bank_connections.any_busy" => json(bank_connections::any_busy(&arg::<Vec<Value>>(
            &args, "list",
        )?)),
        "bank_connections.state_label" => json(bank_connections::state_label(&arg(&args, "c")?)),
        "bank_connections.state_tone" => json(bank_connections::state_tone(&arg(&args, "c")?)),
        "bank_connections.needs_typed_pin" => {
            json(bank_connections::needs_typed_pin(&arg(&args, "c")?))
        }
        "bank_connections.can_sync" => json(bank_connections::can_sync(
            &arg(&args, "c")?,
            &arg::<String>(&args, "typed_pin")?,
        )),
        "bank_connections.next_sync_text" => json(bank_connections::next_sync_text(
            &arg(&args, "c")?,
            arg(&args, "now_seconds")?,
        )),
        "bank_connections.approval_left_text" => json(bank_connections::approval_left_text(
            &arg(&args, "c")?,
            arg(&args, "now_seconds")?,
        )),
        "bank_connections.is_safe_link_url" => json(bank_connections::is_safe_link_url(
            opt::<String>(&args, "url")?.as_deref(),
        )),
        "bank_connections.connection_key" => {
            json(bank_connections::connection_key(&arg(&args, "c")?))
        }
        "bank_connections.live_sync_missing" => {
            let (title, body) = bank_connections::live_sync_missing(arg(&args, "on_phone")?);
            json(serde_json::json!({ "title": title, "body": body }))
        }
        "calendar_feeds.payday_occurrences" => json(calendar_feeds::payday_occurrences(
            arg(&args, "payday")?,
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
        )?),
        "calendar_feeds.charge_occurrences" => json(calendar_feeds::charge_occurrences(
            &arg::<Vec<calendar_feeds::Charge>>(&args, "charges")?,
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
        )),
        "calendar_feeds.meal_occurrences" => json(calendar_feeds::meal_occurrences(
            &arg::<Vec<calendar_feeds::PlannedMeal>>(&args, "meals")?,
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
        )),
        "calendar_feeds.contract_occurrences" => json(calendar_feeds::contract_occurrences(
            &arg::<Vec<calendar_feeds::Contract>>(&args, "contracts")?,
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
        )?),
        "calendar_feeds.week_starts" => json(calendar_feeds::week_starts(
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
        )?),
        "calendar_view.range_for" => json(calendar_view::range_for(
            &arg::<String>(&args, "view")?,
            &arg::<String>(&args, "anchor")?,
            opt(&args, "schedule_days")?.unwrap_or(calendar_view::SCHEDULE_DAYS),
        )?),
        "calendar_view.step" => json(calendar_view::step(
            &arg::<String>(&args, "view")?,
            &arg::<String>(&args, "anchor")?,
            arg(&args, "direction")?,
        )?),
        "calendar_view.title_for" => json(calendar_view::title_for(
            &arg::<String>(&args, "view")?,
            &arg::<String>(&args, "anchor")?,
        )?),
        "calendar_view.month_cells" => json(calendar_view::month_cells(
            &arg::<String>(&args, "anchor")?,
            &arg::<String>(&args, "today")?,
            &arg::<String>(&args, "selected")?,
            &arg::<Vec<calendar::Occurrence>>(&args, "occurrences")?,
        )?),
        "calendar_view.mini_cells" => json(calendar_view::mini_cells(
            &arg::<String>(&args, "anchor")?,
            &arg::<String>(&args, "today")?,
            &arg::<String>(&args, "selected")?,
            &arg::<Vec<calendar::Occurrence>>(&args, "occurrences")?,
        )?),
        "calendar_view.day_columns" => json(calendar_view::day_columns(
            &arg::<Vec<String>>(&args, "dates")?,
            &arg::<String>(&args, "today")?,
            &arg::<String>(&args, "selected")?,
            &arg::<Vec<calendar::Occurrence>>(&args, "occurrences")?,
        )?),
        "calendar_view.agenda_days" => json(calendar_view::agenda_days(
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "to")?,
            &arg::<String>(&args, "today")?,
            &arg::<Vec<calendar::Occurrence>>(&args, "occurrences")?,
        )?),
        "calendar_form.new_draft" => json(calendar_form::new_draft(
            &arg::<String>(&args, "date")?,
            opt(&args, "calendar_id")?,
            opt::<String>(&args, "time")?.as_deref(),
        )),
        "calendar_form.rule_from_dto" => json(calendar_form::rule_from_dto(&arg(&args, "e")?)),
        "calendar_form.draft_from_rule" => {
            json(calendar_form::draft_from_rule(&arg(&args, "rule")?))
        }
        "calendar_form.move_start" => json(calendar_form::move_start(
            &arg(&args, "d")?,
            &arg::<String>(&args, "date")?,
            opt::<String>(&args, "time")?.as_deref(),
        )?),
        "calendar_form.set_repeat_kind" => json(calendar_form::set_repeat_kind(
            &arg(&args, "d")?,
            &arg::<String>(&args, "kind")?,
        )?),
        "calendar_form.toggle_weekday" => json(calendar_form::toggle_weekday(
            &arg(&args, "d")?,
            &arg::<String>(&args, "code")?,
        )),
        "calendar_form.toggle_reminder" => json(calendar_form::toggle_reminder(
            &arg(&args, "d")?,
            arg(&args, "minutes")?,
        )),
        "calendar_form.problem" => json(calendar_form::problem(&arg(&args, "d")?)),
        "calendar_form.to_input" => json(calendar_form::to_input(&arg(&args, "d")?)),
        "charts.spending_trend" => json(charts::spending_trend(
            &arg::<Vec<charts::Tx>>(&args, "txs")?,
            &arg::<String>(&args, "today")?,
            arg(&args, "days")?,
        )?),
        "charts.trend_summary" => json(charts::trend_summary(
            &arg(&args, "t")?,
            arg(&args, "days")?,
        )),
        "charts.peak_text" => json(charts::peak_text(&arg(&args, "t")?)?),
        "charts.top_categories" => json(charts::top_categories(
            &arg::<Vec<charts::Spent>>(&args, "current")?,
            &arg::<Vec<charts::Spent>>(&args, "previous")?,
            opt(&args, "limit")?.unwrap_or(5),
        )),
        "charts.compare_summary" => json(charts::compare_summary(&arg::<
            Vec<charts::CategoryCompare>,
        >(&args, "rows")?)),
        "charts.is_spend" => json(charts::is_spend(&arg(&args, "t")?)),
        "charts.period_curve" => json(charts::period_curve(
            &arg::<Vec<charts::Tx>>(&args, "txs")?,
            &arg(&args, "period")?,
            &arg::<String>(&args, "today")?,
            opt(&args, "still_to_come")?,
        )?),
        "charts.curve_geometry" => json(charts::curve_geometry(
            &arg(&args, "curve")?,
            arg(&args, "width")?,
            arg(&args, "height")?,
            opt(&args, "pad")?.unwrap_or(4.0),
        )),
        "charts.curve_summary" => json(charts::curve_summary(&arg(&args, "curve")?)),
        "charts.spend_comparison" => json(charts::spend_comparison(
            &arg::<Vec<charts::Tx>>(&args, "txs")?,
            &arg(&args, "period")?,
            &arg(&args, "previous")?,
            &arg::<String>(&args, "today")?,
        )?),
        "charts.last_week" => json(charts::last_week(
            &arg::<Vec<charts::Tx>>(&args, "txs")?,
            &arg::<String>(&args, "today")?,
        )?),
        "charts.week_summary" => json(charts::week_summary(&arg(&args, "w")?)),
        "charts.category_shares" => json(charts::category_shares(
            &arg::<Vec<charts::Tx>>(&args, "txs")?,
            &arg(&args, "period")?,
            opt(&args, "limit")?.unwrap_or(5),
        )),
        "charts.shares_summary" => json(charts::shares_summary(
            arg(&args, "total")?,
            &arg::<Vec<charts::Share>>(&args, "shares")?,
        )),
        "shop_format.format_cents" => json(shop_format::format_cents(arg::<f64>(&args, "cents")?)),
        "shop_format.format_price" => json(shop_format::format_price(
            opt::<f64>(&args, "cents")?,
            opt::<bool>(&args, "per_month")?.unwrap_or(false),
        )),
        "shop_format.format_percent" => {
            json(shop_format::format_percent(arg::<f64>(&args, "pct")?))
        }
        "shop_format.saving_text" => json(shop_format::saving_text(
            arg::<f64>(&args, "per_month_cents")?,
            arg::<f64>(&args, "over_horizon_cents")?,
            arg::<f64>(&args, "months")?,
            opt::<String>(&args, "current")?.as_deref(),
        )),
        "shop_format.verdict_text" => json(shop_format::verdict_text(&arg::<String>(&args, "v")?)),
        "shop_format.deal_line" => json(shop_format::deal_line(&arg::<Value>(&args, "d")?)),
        "shop_format.ago" => json(shop_format::ago(
            arg::<f64>(&args, "unix_seconds")?,
            arg::<f64>(&args, "now_seconds")?,
        )),
        "shop_format.cheapest_offer" => json(shop_format::cheapest_offer(&arg::<Vec<Value>>(
            &args, "offers",
        )?)),
        "shop_format.plan_terms" => json(shop_format::plan_terms(&arg::<Value>(&args, "o")?)),
        "shop_weights.default_weight" => {
            json(shop_weights::default_weight(&arg::<Value>(&args, "c")?))
        }
        "shop_weights.weight_for" => json(shop_weights::weight_for(
            &arg::<Value>(&args, "c")?,
            &arg::<String>(&args, "level")?,
        )),
        "shop_weights.level_of" => json(shop_weights::level_of(
            &arg::<Value>(&args, "c")?,
            arg::<f64>(&args, "weight")?,
        )),
        "shop_weights.current_level" => json(shop_weights::current_level(
            &arg::<Value>(&args, "c")?,
            &arg::<Value>(&args, "profile")?,
        )),
        "shop_weights.set_level" => json(shop_weights::set_level(
            &arg::<Value>(&args, "profile")?,
            &arg::<Value>(&args, "c")?,
            &arg::<String>(&args, "level")?,
        )),
        "shop_weights.reset_weights" => json(shop_weights::reset_weights(&arg::<Value>(
            &args, "profile",
        )?)),
        "shop_weights.ratable" => json(shop_weights::ratable(
            &arg::<Value>(&args, "schema")?,
            &arg::<Value>(&args, "profile")?,
        )),
        "shop_weights.group_label" => json(shop_weights::group_label(&arg::<String>(&args, "id")?)),
        "shop_weights.groups" => json(shop_weights::groups(&arg::<Vec<Value>>(&args, "criteria")?)),
        "shop_weights.presets_for" => json(shop_weights::presets_for(
            &arg::<Value>(&args, "schema")?,
            &arg::<Value>(&args, "base")?,
        )),
        "shop_schema.slug_key" => json(shop_schema::slug_key(&arg::<String>(&args, "label")?)),
        "shop_schema.unique_key" => json(shop_schema::unique_key(
            &arg::<String>(&args, "base")?,
            &arg::<Vec<String>>(&args, "taken")?,
        )),
        "shop_schema.new_category" => json(shop_schema::new_category(
            &arg::<String>(&args, "name")?,
            opt::<String>(&args, "extends_id")?.as_deref(),
        )),
        "shop_schema.add_attribute" => json(shop_schema::add_attribute(
            &arg::<Value>(&args, "schema")?,
            &arg::<String>(&args, "label")?,
            &arg::<String>(&args, "kind")?,
            opt::<String>(&args, "unit")?.as_deref(),
        )),
        "shop_schema.add_alias" => json(shop_schema::add_alias(
            &arg::<Value>(&args, "schema")?,
            &arg::<String>(&args, "key")?,
            &arg::<String>(&args, "alias")?,
        )),
        "shop_schema.remove_alias" => json(shop_schema::remove_alias(
            &arg::<Value>(&args, "schema")?,
            &arg::<String>(&args, "key")?,
            &arg::<String>(&args, "alias")?,
        )),
        "shop_schema.add_criterion" => json(shop_schema::add_criterion(
            &arg::<Value>(&args, "schema")?,
            &arg::<String>(&args, "label")?,
            &arg::<Value>(&args, "t")?,
            arg::<f64>(&args, "weight")?,
        )?),
        "shop_schema.remove_criterion" => json(shop_schema::remove_criterion(
            &arg::<Value>(&args, "schema")?,
            &arg::<String>(&args, "key")?,
        )),
        "shop_schema.set_criterion_weight" => json(shop_schema::set_criterion_weight(
            &arg::<Value>(&args, "schema")?,
            &arg::<String>(&args, "key")?,
            arg::<f64>(&args, "weight")?,
        )),
        "shop_schema.formula_problem" => {
            json(shop_schema::formula_problem(&arg::<String>(&args, "expr")?))
        }
        "shop_schema.formula_names" => {
            json(shop_schema::formula_names(&arg::<Value>(&args, "schema")?))
        }
        "shop_view.sort_items" => json(shop_view::sort_items(
            &arg::<Vec<Value>>(&args, "items")?,
            &arg::<String>(&args, "key")?,
        )),
        "shop_view.is_monthly" => json(shop_view::is_monthly(&arg::<Value>(&args, "item")?)),
        "shop_view.best_offer" => json(shop_view::best_offer(&arg::<Value>(&args, "item")?)),
        "shop_view.deal_badges" => json(shop_view::deal_badges(
            opt::<String>(&args, "verdict")?.as_deref(),
        )),
        "shop_view.saving_note" => json(shop_view::saving_note(
            &arg::<Value>(&args, "item")?,
            arg::<f64>(&args, "months")?,
        )),
        "shop_view.understood" => json(shop_view::understood(&arg::<Value>(&args, "parsed")?)),
        "shop_view.compare_view" => json(shop_view::compare_view(
            &arg::<Value>(&args, "c")?,
            &arg::<Value>(&args, "images")?,
        )),
        "shop_view.understood_line" => {
            json(shop_view::understood_line(&arg::<Value>(&args, "parsed")?))
        }
        "shop_view.best_saving" => {
            json(shop_view::best_saving(&arg::<Vec<Value>>(&args, "items")?))
        }
        "shop_view.saving_share" => json(shop_view::saving_share(
            arg::<f64>(&args, "per_month_cents")?,
            opt::<f64>(&args, "current_monthly_cents")?,
        )),
        "shop_view.budget_presets" => json(shop_view::budget_presets(
            opt::<String>(&args, "kind")?.as_deref(),
        )),
        "shop_view.deal_filters" => {
            json(shop_view::deal_filters(&arg::<Vec<Value>>(&args, "deals")?))
        }
        "shop_view.filter_deals" => json(shop_view::filter_deals(
            &arg::<Vec<Value>>(&args, "deals")?,
            &arg::<String>(&args, "filter")?,
        )),
        "shop_progress.text_bar" => json(shop_progress::text_bar(arg::<f64>(&args, "percent")?)),
        "shop_progress.progress_model" => json(shop_progress::progress_model(
            &arg::<String>(&args, "query")?,
            &arg::<Value>(&args, "s")?,
        )),
        "shop_progress.worth_showing" => json(shop_progress::worth_showing(
            opt::<Value>(&args, "prev")?.as_ref(),
            &arg::<Value>(&args, "next")?,
            arg::<f64>(&args, "last_shown_ms")?,
            arg::<f64>(&args, "now_ms")?,
            opt::<f64>(&args, "min_gap_ms")?.unwrap_or(1000.0),
        )),
        "shop_misc.parse_cents" => json(shop_misc::parse_cents(&arg::<String>(&args, "input")?)),
        "shop_misc.parse_attribute" => json(shop_misc::parse_attribute(
            &arg::<Value>(&args, "def")?,
            &arg::<String>(&args, "input")?,
        )),
        "shop_misc.build_product" => json(shop_misc::build_product(
            &arg::<Value>(&args, "form")?,
            &arg::<Vec<Value>>(&args, "defs")?,
            arg::<bool>(&args, "plan")?,
        )),
        "shop_misc.profile_summary" => json(shop_misc::profile_summary(&arg::<Value>(&args, "p")?)),
        "shop_misc.profile_name_problem" => json(shop_misc::profile_name_problem(
            &arg::<String>(&args, "name")?,
            &arg::<Vec<String>>(&args, "existing")?,
        )),
        "shop_misc.phase_tone" => json(shop_misc::phase_tone(&arg::<String>(&args, "p")?)),
        "shop_misc.is_active" => json(shop_misc::is_active(&arg::<Value>(&args, "j")?)),
        "shop_misc.order_runs" => json(shop_misc::order_runs(&arg::<Vec<Value>>(&args, "jobs")?)),
        "shop_misc.run_summary" => json(shop_misc::run_summary(&arg::<Value>(&args, "j")?)),
        "shop_misc.run_problems" => json(shop_misc::run_problems(&arg::<Value>(&args, "j")?)),
        "shop_misc.next_step" => json(shop_misc::next_step(
            &arg::<Value>(&args, "r")?,
            arg::<bool>(&args, "integrated")?,
        )),
        "shop_misc.suggestion_text" => {
            json(shop_misc::suggestion_text(&arg::<String>(&args, "reason")?))
        }
        "shop_misc.index_request_for" => json(shop_misc::index_request_for(
            &arg::<Value>(&args, "req")?,
            opt::<Value>(&args, "r")?.as_ref(),
        )),
        "shop_misc.chips_for" => json(shop_misc::chips_for(&arg::<Value>(&args, "r")?)),
        "shop_misc.check_sources" => {
            json(shop_misc::check_sources(&arg::<String>(&args, "input")?))
        }
        "shop_misc.notice_for" => json(shop_misc::notice_for(&arg::<Value>(&args, "n")?)),
        "shop_misc.plan_deal_notices" => json(shop_misc::plan_deal_notices(
            &arg::<Vec<Value>>(&args, "items")?,
            arg::<f64>(&args, "last_shown_id")?,
            opt::<usize>(&args, "max")?.unwrap_or(3),
        )),
        "mail_format.day_key" => json(mail_format::day_key(
            arg(&args, "ts")?,
            &arg::<String>(&args, "zone")?,
        )?),
        "mail_format.clock" => json(mail_format::clock(
            arg(&args, "ts")?,
            &arg::<String>(&args, "zone")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
        )?),
        "mail_format.local_clock" => json(mail_format::local_clock(
            &arg::<String>(&args, "local")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
        )),
        "mail_format.shift_day" => json(mail_format::shift_day(
            &arg::<String>(&args, "key")?,
            arg(&args, "days")?,
        )?),
        "mail_format.days_between" => json(mail_format::days_between(
            &arg::<String>(&args, "a")?,
            &arg::<String>(&args, "b")?,
        )?),
        "mail_format.weekday_short" => json(mail_format::weekday_short(
            &arg::<String>(&args, "key")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
        )?),
        "mail_format.day_of_month" => {
            json(mail_format::day_of_month(&arg::<String>(&args, "key")?))
        }
        "mail_format.day_text" => json(mail_format::day_text(
            &arg::<String>(&args, "key")?,
            &arg::<String>(&args, "today_key")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
        )?),
        "mail_format.day_label" => json(mail_format::day_label(
            &arg::<String>(&args, "key")?,
            &arg::<String>(&args, "today_key")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
        )?),
        "mail_format.list_time" => json(mail_format::list_time(
            arg(&args, "ts")?,
            arg(&args, "now_ts")?,
            &arg::<String>(&args, "zone")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
        )?),
        "mail_format.ago" => json(mail_format::ago(arg(&args, "ts")?, arg(&args, "now_ts")?)),
        "mail_format.agenda_days" => json(mail_format::agenda_days(
            &arg::<Vec<Value>>(&args, "events")?,
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "today")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
        )?),
        "mail_format.time_text" => json(mail_format::time_text(
            &arg::<Value>(&args, "e")?,
            &arg::<String>(&args, "today")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
        )?),
        "mail_format.source_note" => {
            json(mail_format::source_note(&arg::<String>(&args, "source")?))
        }
        "mail_format.range_end" => json(mail_format::range_end(
            &arg::<String>(&args, "from")?,
            &arg::<String>(&args, "value")?,
        )?),
        "mail_format.parse_clock" => json(mail_format::parse_clock(&arg::<String>(&args, "text")?)),
        "mail_format.parse_day" => json(mail_format::parse_day(
            &arg::<String>(&args, "text")?,
            &arg::<String>(&args, "today")?,
        )),
        "mail_format.chat_rows" => json(mail_format::chat_rows(
            &arg::<Vec<Value>>(&args, "messages")?,
            arg(&args, "now")?,
            &arg::<String>(&args, "zone")?,
            &arg::<mail_format::Pack>(&args, "pack")?,
            arg(&args, "show_topics")?,
            arg(&args, "group_chat")?,
        )?),
        "mail_format.unread_ids" => json(mail_format::unread_ids(&arg::<Vec<Value>>(
            &args, "messages",
        )?)),
        "mail_text.person_name" => json(mail_text::person_name(&arg::<Value>(&args, "a")?)),
        "mail_text.people_text" => json(mail_text::people_text(&arg::<Vec<Value>>(&args, "list")?)),
        "mail_text.recipient_strings" => json(mail_text::recipient_strings(&arg::<Vec<Value>>(
            &args, "list",
        )?)),
        "mail_text.send_problem" => json(mail_text::send_problem(
            &arg::<String>(&args, "to")?,
            &arg::<String>(&args, "body")?,
            &arg::<String>(&args, "subject")?,
            arg(&args, "is_reply")?,
        )),
        "mail_text.oldest_first" => {
            json(mail_text::oldest_first(&arg::<Vec<Value>>(&args, "list")?))
        }
        "mail_text.example_text" => json(mail_text::example_text(&arg::<String>(&args, "text")?)),
        "mail_text.audience_text" => json(mail_text::audience_text(&arg::<Vec<String>>(
            &args, "audience",
        )?)),
        "mail_text.parse_audience" => {
            json(mail_text::parse_audience(&arg::<String>(&args, "text")?))
        }
        "mail_text.templates_of" => json(mail_text::templates_of(
            &arg::<Vec<Value>>(&args, "all")?,
            &arg::<String>(&args, "kind")?,
        )),
        "mail_text.choice_key" => json(mail_text::choice_key(&arg::<Value>(&args, "c")?)),
        "mail_text.choice_label" => json(mail_text::choice_label(
            &arg::<Value>(&args, "c")?,
            &arg::<Vec<Value>>(&args, "all")?,
        )),
        "mail_text.first_line" => json(mail_text::first_line(&arg::<String>(&args, "text")?)),
        "app_lock.start_state" => json(app_lock::start_state()),
        "app_lock.settings_loaded" => json(app_lock::settings_loaded(
            &arg(&args, "s")?,
            arg(&args, "enabled")?,
        )),
        "app_lock.set_enabled" => json(app_lock::set_enabled(
            &arg(&args, "s")?,
            arg(&args, "enabled")?,
        )),
        "app_lock.went_to_background" => json(app_lock::went_to_background(
            &arg(&args, "s")?,
            arg(&args, "now")?,
        )),
        "app_lock.came_to_foreground" => json(app_lock::came_to_foreground(
            &arg(&args, "s")?,
            arg(&args, "now")?,
            opt(&args, "after_ms")?.unwrap_or(app_lock::LOCK_AFTER_MS),
        )),
        "app_lock.unlocked" => json(app_lock::unlocked(&arg(&args, "s")?)),
        "app_lock.is_covered" => json(app_lock::is_covered(&arg(&args, "s")?)),
        "app_lock.lock_availability" => json(app_lock::lock_availability(
            arg(&args, "is_web")?,
            arg(&args, "native_module")?,
            arg(&args, "level")?,
        )),
        "app_lock.unlock_outcome" => {
            json(app_lock::unlock_outcome(&arg::<Value>(&args, "result")?))
        }
        "app_misc.filter_tx" => json(app_misc::filter_tx(
            &arg::<Vec<Value>>(&args, "items")?,
            &arg::<String>(&args, "filter")?,
        )),
        "search.rank" => json(search::rank(
            &arg::<Vec<search::Entry>>(&args, "entries")?,
            &arg::<String>(&args, "query")?,
            arg(&args, "limit_per_kind")?,
            arg(&args, "limit")?,
        )),
        "app_misc.apply_filters" => json(app_misc::apply_filters(
            &arg::<Vec<Value>>(&args, "items")?,
            &arg::<app_misc::Filters>(&args, "filters")?,
            &arg::<String>(&args, "today")?,
        )?),
        "app_misc.filter_chips" => json(app_misc::filter_chips(&arg::<app_misc::Filters>(
            &args, "filters",
        )?)),
        "app_misc.search_tx" => json(app_misc::search_tx(
            &arg::<Vec<Value>>(&args, "items")?,
            &arg::<String>(&args, "query")?,
        )),
        "app_misc.greeting" => json(app_misc::greeting(arg(&args, "hour")?)),
        "app_misc.income_spent" => {
            json(app_misc::income_spent(&arg::<Vec<Value>>(&args, "items")?))
        }
        "app_misc.day_total" => json(app_misc::day_total(&arg::<Vec<Value>>(&args, "items")?)),
        "app_misc.empty_filter_text" => json(app_misc::empty_filter_text(&arg::<String>(
            &args, "filter",
        )?)),
        "app_misc.demo_transactions" => json(app_misc::demo_transactions(
            &arg::<String>(&args, "today")?,
            opt(&args, "payday")?.unwrap_or(1.0),
            &opt::<Vec<String>>(&args, "chains")?.unwrap_or_default(),
        )?),
        "app_misc.demo_export" => json(app_misc::demo_export(
            &arg::<String>(&args, "today")?,
            opt(&args, "payday")?.unwrap_or(1.0),
            &opt::<Vec<String>>(&args, "chains")?.unwrap_or_default(),
        )?),
        "app_misc.is_demo_booking" => json(app_misc::is_demo_booking(&arg::<Value>(&args, "t")?)),
        "app_misc.demo_gate" => json(app_misc::demo_gate(&arg::<Vec<Value>>(&args, "bookings")?)),
        "app_misc.calendar_tone" => json(app_misc::calendar_tone(&arg::<String>(&args, "value")?)),
        "app_misc.format_stamp" => json(app_misc::format_stamp(
            arg(&args, "unix_seconds")?,
            &arg::<String>(&args, "zone")?,
        )?),
        "app_misc.next_hour" => json(app_misc::next_hour(arg(&args, "hour")?)),
        "shop_format.safe_url" => json(shop_format::safe_url(
            opt::<String>(&args, "url")?.as_deref(),
        )),
        "shop_misc.order_profiles" => {
            json(shop_misc::order_profiles(&arg::<Vec<Value>>(&args, "all")?))
        }
        "shop_misc.serialize_cached" => json(shop_misc::serialize_cached(
            &arg::<Value>(&args, "detail")?,
            arg(&args, "now")?,
        )),
        "shop_misc.parse_cached" => json(shop_misc::parse_cached(
            opt::<String>(&args, "raw")?.as_deref(),
        )),
        "shop_progress.follow_ok" => json(shop_progress::follow_ok(
            &arg::<String>(&args, "query")?,
            &arg::<Value>(&args, "progress")?,
            opt::<Value>(&args, "prev")?.as_ref(),
            arg(&args, "last_shown_ms")?,
            arg(&args, "now_ms")?,
            opt(&args, "min_gap_ms")?.unwrap_or(1000.0),
        )),
        "shop_progress.follow_failed" => json(shop_progress::follow_failed(
            &arg::<String>(&args, "query")?,
            arg(&args, "failures")?,
            arg(&args, "max_failures")?,
            opt::<Value>(&args, "prev")?.as_ref(),
        )),
        "server_config.restart_outcome" => json(server_config::restart_outcome(
            &arg::<Value>(&args, "view")?,
            &arg::<String>(&args, "token")?,
        )),
        "bank_connections.last_result_text" => json(bank_connections::last_result_text(
            &arg(&args, "c")?,
            &arg::<String>(&args, "zone")?,
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
