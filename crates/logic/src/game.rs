//! The playful layer: streaks, daily goals ("quests"), XP and levels. Everything is derived from
//! your real data (transactions, limits, usual items), nothing is invented or stored separately,
//! so it can never drift from the numbers on the other screens.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};
use time::{Date, Duration};

use crate::format::date_of;
use crate::period::{budget_period, days_in_month, iso, period_days};

#[derive(Debug, Clone, Deserialize)]
pub struct Tx {
    pub booking_date: String,
    pub amount_cents: i64,
    #[serde(default)]
    pub category: Option<String>,
}

pub const QUEST_XP: i64 = 10;
pub const STREAK_XP: i64 = 5;
pub const LEVEL_XP: i64 = 50;
/// A freeze is earned with every 7th day of a streak ...
pub const FREEZE_EVERY: i64 = 7;
/// ... and you can hold at most this many.
pub const MAX_FREEZES: i64 = 2;
/// How far back the replay looks (about three years).
pub const REPLAY_DAYS: i64 = 1100;

fn day(iso_date: &str) -> Result<Date, String> {
    date_of(iso_date)
}

fn add_days(d: Date, n: i64) -> Date {
    d + Duration::days(n)
}

/// What you may spend per day in a month with this limit (rounded down to whole cents).
pub fn daily_allowance(limit_cents: i64, year: i32, month: u8) -> Result<i64, String> {
    Ok(limit_cents.div_euclid(i64::from(days_in_month(year, month)?)))
}

/// The same for a budget period of `days` days (a payday period is not a calendar month).
pub fn daily_allowance_for_days(limit_cents: i64, days: i64) -> i64 {
    limit_cents.div_euclid(days.max(1))
}

/// What you may spend per day on `date`, in the budget period (from `payday`) that contains it.
pub fn daily_allowance_on(limit_cents: i64, date: &str, payday: f64) -> Result<i64, String> {
    let days = period_days(&budget_period(date, payday)?)?;
    Ok(daily_allowance_for_days(limit_cents, i64::from(days)))
}

/// Cents spent (a positive number) in one category on one day; refunds reduce it.
pub fn spent_on(txs: &[Tx], date: &str, category: &str) -> i64 {
    let sum: i64 = txs
        .iter()
        .filter(|t| t.booking_date == date && t.category.as_deref() == Some(category))
        .map(|t| -t.amount_cents)
        .sum();
    sum.max(0)
}

fn first_booking_day(txs: &[Tx]) -> Option<&str> {
    txs.iter().map(|t| t.booking_date.as_str()).min()
}

/// Days in a row, ending today, on which you stayed within the daily allowance for a category. A
/// day over the allowance ends the streak. Days before your first transaction are not counted.
pub fn streak(
    txs: &[Tx],
    limit_cents: i64,
    today: &str,
    category: &str,
    payday: f64,
) -> Result<i64, String> {
    if limit_cents <= 0 || txs.is_empty() {
        return Ok(0);
    }
    let first = day(first_booking_day(txs).unwrap_or(today))?;
    let mut count = 0;
    let mut d = day(today)?;
    let mut i = 0;
    while d >= first && i < 366 {
        let s = iso(d);
        if spent_on(txs, &s, category) > daily_allowance_on(limit_cents, &s, payday)? {
            break;
        }
        count += 1;
        d = add_days(d, -1);
        i += 1;
    }
    Ok(count)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub transactions: i64,
    pub limits: i64,
    pub usual_items: i64,
    pub prices: i64,
    pub receipts: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Quest {
    pub id: &'static str,
    pub title: &'static str,
    pub hint: &'static str,
    pub route: &'static str,
    pub done: bool,
}

pub fn quests(p: &Progress) -> Vec<Quest> {
    let q = |id, title, hint, route, done| Quest {
        id,
        title,
        hint,
        route,
        done,
    };
    vec![
        q(
            "import",
            "Import your spending",
            "Sync with Sparkasse or import a CSV",
            "/spending",
            p.transactions > 0,
        ),
        q(
            "limit",
            "Set a monthly limit",
            "Give groceries a budget",
            "/budget",
            p.limits > 0,
        ),
        q(
            "items",
            "Add your usual items",
            "So we can find them cheaper",
            "/basket",
            p.usual_items > 0,
        ),
        q(
            "prices",
            "Fetch fresh prices",
            "Compare Lidl, Aldi, Kaufland, Rewe",
            "/prices",
            p.prices > 0,
        ),
        q(
            "receipt",
            "Add a receipt",
            "Learn what you really buy",
            "/receipts",
            p.receipts > 0,
        ),
    ]
}

pub fn xp(done: i64, streak_days: i64) -> i64 {
    done * QUEST_XP + streak_days * STREAK_XP
}

const TITLES: [&str; 5] = [
    "Penny Pincher",
    "Budget Bee",
    "Savings Ninja",
    "Coin Wizard",
    "Money Master",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Level {
    pub level: i64,
    pub title: &'static str,
    pub into: i64,
    pub size: i64,
}

pub fn level(total_xp: i64) -> Level {
    let lvl = total_xp.div_euclid(LEVEL_XP) + 1;
    Level {
        level: lvl,
        title: TITLES[(lvl.clamp(1, TITLES.len() as i64) - 1) as usize],
        into: total_xp.rem_euclid(LEVEL_XP),
        size: LEVEL_XP,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachArgs {
    pub progress: Progress,
    pub streak_days: i64,
    pub allowance_cents: i64,
    pub spent_today_cents: i64,
    #[serde(default)]
    pub freeze_used_today: bool,
}

/// What the mascot says, picked from the real situation.
pub fn coach_message(a: &CoachArgs) -> String {
    if a.progress.transactions == 0 {
        return "Hi, I'm Penny! Import your spending and we start your first streak.".into();
    }
    if a.allowance_cents == 0 {
        return "Set a grocery limit and I'll turn it into a daily goal for you.".into();
    }
    if a.freeze_used_today {
        return format!(
            "A streak freeze covered today, so your {}-day streak lives on!",
            a.streak_days
        );
    }
    if a.spent_today_cents > a.allowance_cents {
        return "Over today's goal, but no stress. Tomorrow is a fresh start!".into();
    }
    if a.streak_days >= 7 {
        return format!(
            "{} days in a row! You're on fire. Keep it up!",
            a.streak_days
        );
    }
    if a.streak_days >= 3 {
        return format!("{}-day streak. Nice, don't break it now!", a.streak_days);
    }
    if a.spent_today_cents == 0 {
        return "Nothing spent on groceries yet today. Smart shopping starts with a plan!".into();
    }
    "Still inside today's goal. Keep going!".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodArgs {
    pub streak_days: i64,
    pub allowance_cents: i64,
    pub spent_today_cents: i64,
    #[serde(default)]
    pub celebrating: bool,
    #[serde(default)]
    pub freeze_used_today: bool,
}

/// The mascot's mood: worried over today's goal, cheering on a long streak or a fresh win.
pub fn mood_for(a: &MoodArgs) -> &'static str {
    if a.freeze_used_today {
        return if a.celebrating { "cheer" } else { "happy" };
    }
    if a.allowance_cents > 0 && a.spent_today_cents > a.allowance_cents {
        return "worried";
    }
    if a.celebrating || a.streak_days >= 7 {
        return "cheer";
    }
    "happy"
}

/// The Monday of the week (ISO weeks) that contains `iso_date`.
pub fn week_start(iso_date: &str) -> Result<String, String> {
    let d = day(iso_date)?;
    Ok(iso(add_days(
        d,
        -i64::from(d.weekday().number_days_from_monday()),
    )))
}

/// Net cents spent per day in one category (refunds reduce it, never below zero).
fn spend_by_day(txs: &[Tx], category: &str) -> BTreeMap<String, i64> {
    let mut sums: BTreeMap<String, i64> = BTreeMap::new();
    for t in txs
        .iter()
        .filter(|t| t.category.as_deref() == Some(category))
    {
        *sums.entry(t.booking_date.clone()).or_insert(0) -= t.amount_cents;
    }
    for v in sums.values_mut() {
        *v = (*v).max(0);
    }
    sums
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Reached {
    #[serde(rename = "7")]
    pub seven: Option<String>,
    #[serde(rename = "30")]
    pub thirty: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakState {
    /// The running streak, ending today; days bridged by a freeze keep it alive but are not counted.
    pub days: i64,
    /// The longest streak in the replayed history.
    pub best: i64,
    /// The day the longest streak ended on (the latest one if two are equally long).
    pub best_ended_on: Option<String>,
    /// Freezes in stock right now (0 to `MAX_FREEZES`).
    pub freezes: i64,
    /// Freezes earned so far, not counting those lost because you already held `MAX_FREEZES`.
    pub earned: i64,
    /// The days a freeze was used on automatically.
    pub used_on: Vec<String>,
    /// A freeze was used on `today`.
    pub frozen_today: bool,
    /// The first day the running streak reached 7 and 30 days (for the badge dates).
    pub reached: Reached,
}

/// The streak with freezes, replayed from your first booking (at most `REPLAY_DAYS` back) to today.
///
/// For every day, in order: within the day's allowance the streak grows by one and every 7th day
/// earns a freeze (at most `MAX_FREEZES` in stock); over the allowance with a freeze in stock the
/// freeze is used up and the streak stays; over the allowance without one the streak restarts.
pub fn streak_state(
    txs: &[Tx],
    limit_cents: i64,
    today: &str,
    category: &str,
    payday: f64,
) -> Result<StreakState, String> {
    let mut s = StreakState::default();
    let Some(first) = first_booking_day(txs) else {
        return Ok(s);
    };
    if limit_cents <= 0 {
        return Ok(s);
    }
    let today_d = day(today)?;
    let earliest = add_days(today_d, -REPLAY_DAYS);
    let spend = spend_by_day(txs, category);
    let mut d = day(first)?.max(earliest);
    while d <= today_d {
        let key = iso(d);
        if spend.get(&key).copied().unwrap_or(0) <= daily_allowance_on(limit_cents, &key, payday)? {
            s.days += 1;
            if s.days >= s.best {
                s.best = s.days;
                s.best_ended_on = Some(key.clone());
            }
            if s.days == 7 && s.reached.seven.is_none() {
                s.reached.seven = Some(key.clone());
            }
            if s.days == 30 && s.reached.thirty.is_none() {
                s.reached.thirty = Some(key.clone());
            }
            if s.days % FREEZE_EVERY == 0 && s.freezes < MAX_FREEZES {
                s.freezes += 1;
                s.earned += 1;
            }
        } else if s.freezes > 0 {
            s.freezes -= 1;
            s.used_on.push(key);
        } else {
            s.days = 0;
        }
        d = add_days(d, 1);
    }
    s.frozen_today = s.used_on.last().map(String::as_str) == Some(today);
    Ok(s)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekTotal {
    pub start: String,
    pub end: String,
    pub spent_cents: i64,
}

/// Grocery spending of every complete week (Monday to Sunday, ending before `today`) that lies
/// inside your data: it starts on or after your first booking and has at least one booking in the category.
pub fn complete_weeks(txs: &[Tx], today: &str, category: &str) -> Result<Vec<WeekTotal>, String> {
    let Some(first) = first_booking_day(txs) else {
        return Ok(Vec::new());
    };
    let mut totals: BTreeMap<String, i64> = BTreeMap::new();
    for t in txs
        .iter()
        .filter(|t| t.category.as_deref() == Some(category))
    {
        *totals.entry(week_start(&t.booking_date)?).or_insert(0) -= t.amount_cents;
    }
    let mut weeks = Vec::new();
    for (start, cents) in totals {
        let end = iso(add_days(day(&start)?, 6));
        if start.as_str() >= first && end.as_str() < today {
            weeks.push(WeekTotal {
                start,
                end,
                spent_cents: cents.max(0),
            });
        }
    }
    Ok(weeks) // a BTreeMap walks the weeks oldest first
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalBests {
    pub longest_streak: i64,
    pub longest_streak_ended_on: Option<String>,
    /// The complete week with the lowest grocery spending (the latest one if tied).
    pub best_week: Option<WeekTotal>,
    /// Grocery spending in the running week so far.
    pub this_week_cents: i64,
}

pub fn personal_bests(
    txs: &[Tx],
    streak: &StreakState,
    today: &str,
    category: &str,
) -> Result<PersonalBests, String> {
    let mut best_week: Option<WeekTotal> = None;
    for w in complete_weeks(txs, today, category)? {
        if best_week
            .as_ref()
            .is_none_or(|b| w.spent_cents <= b.spent_cents)
        {
            best_week = Some(w);
        }
    }
    let monday = week_start(today)?;
    let this_week: i64 = txs
        .iter()
        .filter(|t| {
            t.category.as_deref() == Some(category)
                && t.booking_date.as_str() >= monday.as_str()
                && t.booking_date.as_str() <= today
        })
        .map(|t| -t.amount_cents)
        .sum();
    Ok(PersonalBests {
        longest_streak: streak.best,
        longest_streak_ended_on: streak.best_ended_on.clone(),
        best_week,
        this_week_cents: this_week.max(0),
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Badge {
    pub id: String,
    pub title: String,
    /// The rule, in plain words (shown on the Trophies screen).
    pub rule: String,
    pub icon: String,
    pub earned: bool,
    /// The day it was first earned; none when it is not tied to a day or not earned.
    pub earned_on: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewardsInput {
    pub txs: Vec<Tx>,
    /// The groceries limit per budget period in cents (0 = none).
    pub grocery_limit: i64,
    /// Net amount to put aside per budget period in cents (0 = no goal).
    pub savings_goal: i64,
    pub today: String,
    pub payday: f64,
    pub progress: Progress,
}

struct BadgeDef {
    id: &'static str,
    title: &'static str,
    icon: &'static str,
    rule: &'static str,
}

const BADGE_DEFS: [BadgeDef; 8] = [
    BadgeDef { id: "first-week", title: "First week", icon: "🔥", rule: "Stay within the daily grocery goal 7 days in a row." },
    BadgeDef { id: "streak-30", title: "30-day streak", icon: "🏆", rule: "Stay within the daily grocery goal 30 days in a row." },
    BadgeDef { id: "streak-saved", title: "Streak saved", icon: "❄️", rule: "A streak freeze kept your streak alive on a day you went over." },
    BadgeDef {
        id: "week-under-budget",
        title: "Week under budget",
        icon: "📅",
        rule: "A full week (Monday to Sunday) that starts after your first booking, with groceries at or below 7 daily goals.",
    },
    BadgeDef {
        id: "month-under-budget",
        title: "Period under budget",
        icon: "🌟",
        rule: "A whole budget period (payday to payday) that starts after your first booking, with groceries within the limit.",
    },
    BadgeDef {
        id: "no-spend-day",
        title: "No-spend day",
        icon: "🧘",
        rule: "A day between your first and your latest booking with no money going out (transfers to savings are not spending).",
    },
    BadgeDef {
        id: "savings-goal",
        title: "Savings goal reached",
        icon: "🐷",
        rule: "Put aside at least your savings goal (category Savings) within one budget period.",
    },
    BadgeDef { id: "quest-master", title: "Quest master", icon: "🎯", rule: "Complete all the quests on the Today screen." },
];

/// The numbers the TypeScript side repeats as constants (a test there compares them with these).
pub fn constants() -> serde_json::Value {
    serde_json::json!({
        "questXp": QUEST_XP, "streakXp": STREAK_XP, "levelXp": LEVEL_XP,
        "freezeEvery": FREEZE_EVERY, "maxFreezes": MAX_FREEZES, "replayDays": REPLAY_DAYS,
    })
}

/// The ids of all badges, in the order they are shown.
pub fn badge_ids() -> Vec<&'static str> {
    BADGE_DEFS.iter().map(|b| b.id).collect()
}

/// The end of the first complete week inside the data whose grocery spending fits 7 daily goals.
fn first_week_under_budget(i: &RewardsInput) -> Result<Option<String>, String> {
    let Some(first) = first_booking_day(&i.txs) else {
        return Ok(None);
    };
    if i.grocery_limit <= 0 {
        return Ok(None);
    }
    let active: HashSet<&str> = i.txs.iter().map(|t| t.booking_date.as_str()).collect();
    let spend = spend_by_day(&i.txs, "groceries");
    let mut start = day(&week_start(first)?)?;
    while iso(add_days(start, 6)).as_str() < i.today.as_str() {
        if iso(start).as_str() >= first {
            let (mut spent, mut allowed, mut busy) = (0, 0, false);
            for k in 0..7 {
                let d = iso(add_days(start, k));
                spent += spend.get(&d).copied().unwrap_or(0);
                allowed += daily_allowance_on(i.grocery_limit, &d, i.payday)?;
                busy = busy || active.contains(d.as_str());
            }
            if busy && spent <= allowed {
                return Ok(Some(iso(add_days(start, 6))));
            }
        }
        start = add_days(start, 7);
    }
    Ok(None)
}

/// The end of the first complete budget period inside the data with groceries within the limit.
fn first_period_under_budget(i: &RewardsInput) -> Result<Option<String>, String> {
    let Some(first) = first_booking_day(&i.txs) else {
        return Ok(None);
    };
    if i.grocery_limit <= 0 {
        return Ok(None);
    }
    let mut p = budget_period(first, i.payday)?;
    let mut n = 0;
    while p.end.as_str() < i.today.as_str() && n < 400 {
        let next = budget_period(&iso(add_days(day(&p.end)?, 1)), i.payday)?;
        if p.start.as_str() >= first
            && i.txs
                .iter()
                .any(|t| t.booking_date >= p.start && t.booking_date <= p.end)
        {
            let spent: i64 = i
                .txs
                .iter()
                .filter(|t| {
                    t.category.as_deref() == Some("groceries")
                        && t.booking_date >= p.start
                        && t.booking_date <= p.end
                })
                .map(|t| -t.amount_cents)
                .sum();
            if spent <= i.grocery_limit {
                return Ok(Some(p.end));
            }
        }
        p = next;
        n += 1;
    }
    Ok(None)
}

/// The first day with no money going out, between the first and the latest booking, before today.
fn first_no_spend_day(i: &RewardsInput) -> Result<Option<String>, String> {
    let mut out: BTreeSet<&str> = BTreeSet::new();
    let (mut first, mut last): (Option<&str>, Option<&str>) = (None, None);
    for t in &i.txs {
        let d = t.booking_date.as_str();
        if first.is_none_or(|f| d < f) {
            first = Some(d);
        }
        if last.is_none_or(|l| d > l) {
            last = Some(d);
        }
        if t.amount_cents < 0 && t.category.as_deref() != Some("savings") {
            out.insert(d);
        }
    }
    let (Some(first), Some(last)) = (first, last) else {
        return Ok(None);
    };
    let earliest = add_days(day(&i.today)?, -REPLAY_DAYS);
    let mut d = day(first)?.max(earliest);
    while iso(d).as_str() <= last && iso(d).as_str() < i.today.as_str() {
        if !out.contains(iso(d).as_str()) {
            return Ok(Some(iso(d)));
        }
        d = add_days(d, 1);
    }
    Ok(None)
}

/// The earliest day on which the money put aside in a budget period reached the goal.
fn first_savings_goal_day(i: &RewardsInput) -> Result<Option<String>, String> {
    if i.savings_goal <= 0 {
        return Ok(None);
    }
    let mut saved: Vec<&Tx> = i
        .txs
        .iter()
        .filter(|t| t.category.as_deref() == Some("savings"))
        .collect();
    saved.sort_by(|a, b| a.booking_date.cmp(&b.booking_date));
    let mut totals: BTreeMap<String, i64> = BTreeMap::new();
    let mut earliest: Option<String> = None;
    for t in saved {
        let key = budget_period(&t.booking_date, i.payday)?.start;
        let total = totals.entry(key).or_insert(0);
        *total -= t.amount_cents;
        if *total >= i.savings_goal
            && earliest
                .as_deref()
                .is_none_or(|e| t.booking_date.as_str() < e)
        {
            earliest = Some(t.booking_date.clone());
        }
    }
    Ok(earliest)
}

/// Net cents put aside (category savings) in the budget period that contains `today`, up to today.
pub fn saved_this_period(txs: &[Tx], today: &str, payday: f64) -> Result<i64, String> {
    let period = budget_period(today, payday)?;
    let saved: i64 = txs
        .iter()
        .filter(|t| {
            t.category.as_deref() == Some("savings")
                && t.booking_date >= period.start
                && t.booking_date.as_str() <= today
        })
        .map(|t| -t.amount_cents)
        .sum();
    Ok(saved.max(0))
}

/// Every badge, in display order, with whether (and on which day) it was earned.
pub fn badges(i: &RewardsInput, streak: &StreakState) -> Result<Vec<Badge>, String> {
    let earned_on = |id: &str| -> Result<Option<String>, String> {
        Ok(match id {
            "first-week" => streak.reached.seven.clone(),
            "streak-30" => streak.reached.thirty.clone(),
            "streak-saved" => streak.used_on.first().cloned(),
            "week-under-budget" => first_week_under_budget(i)?,
            "month-under-budget" => first_period_under_budget(i)?,
            "no-spend-day" => first_no_spend_day(i)?,
            "savings-goal" => first_savings_goal_day(i)?,
            _ => None,
        })
    };
    let all_quests = quests(&i.progress).iter().all(|q| q.done);
    BADGE_DEFS
        .iter()
        .map(|def| {
            let on = earned_on(def.id)?;
            let earned = if def.id == "quest-master" {
                all_quests
            } else {
                on.is_some()
            };
            Ok(Badge {
                id: def.id.into(),
                title: def.title.into(),
                rule: def.rule.into(),
                icon: def.icon.into(),
                earned,
                earned_on: if earned { on } else { None },
            })
        })
        .collect()
}

/// The badges to celebrate now: earned, not in the persisted `seen` list and not celebrated earlier
/// in this session.
pub fn fresh_badges(all: Vec<Badge>, seen: &[String], celebrated: &[String]) -> Vec<Badge> {
    all.into_iter()
        .filter(|b| b.earned && !seen.contains(&b.id) && !celebrated.contains(&b.id))
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rewards {
    pub streak: StreakState,
    pub badges: Vec<Badge>,
    pub bests: PersonalBestsIo,
}

/// `PersonalBests` as it travels back in (the trophy wording reads only the badges and the streak).
pub type PersonalBestsIo = serde_json::Value;

pub fn compute_rewards(i: &RewardsInput) -> Result<serde_json::Value, String> {
    let streak = streak_state(&i.txs, i.grocery_limit, &i.today, "groceries", i.payday)?;
    let badges = badges(i, &streak)?;
    let bests = personal_bests(&i.txs, &streak, &i.today, "groceries")?;
    Ok(serde_json::json!({ "streak": streak, "badges": badges, "bests": bests }))
}

/// What the mascot says on the Trophies screen.
pub fn trophy_message(r: &Rewards) -> String {
    let earned = r.badges.iter().filter(|b| b.earned).count();
    if r.streak.frozen_today {
        return format!(
            "A streak freeze saved your {}-day streak today. Nice save!",
            r.streak.days
        );
    }
    if earned == r.badges.len() {
        return "Every trophy collected. You're a legend!".into();
    }
    if earned == 0 {
        return "Your first trophy is close. A week inside the daily goal gets you one!".into();
    }
    if r.streak.freezes == MAX_FREEZES {
        return "Two streak freezes in stock. Your streak is well protected!".into();
    }
    format!("{earned} of {} trophies. Keep collecting!", r.badges.len())
}

/// Cheering when the collection is complete or just grew, otherwise happy.
pub fn trophy_mood(r: &Rewards, just_earned: bool) -> &'static str {
    if just_earned || r.badges.iter().all(|b| b.earned) {
        "cheer"
    } else {
        "happy"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tx(date: &str, cents: i64, cat: &str) -> Tx {
        Tx {
            booking_date: date.into(),
            amount_cents: cents,
            category: Some(cat.into()),
        }
    }

    #[test]
    fn the_allowance_is_the_limit_over_the_days_rounded_down() {
        assert_eq!(daily_allowance(30_000, 2026, 11).unwrap(), 1_000);
        assert_eq!(daily_allowance(30_000, 2026, 2).unwrap(), 1_071);
        assert_eq!(daily_allowance_for_days(10, 0), 10);
    }

    #[test]
    fn refunds_reduce_what_was_spent_never_below_zero() {
        let txs = [
            tx("2026-10-01", -1000, "groceries"),
            tx("2026-10-01", 400, "groceries"),
            tx("2026-10-02", 900, "groceries"),
        ];
        assert_eq!(spent_on(&txs, "2026-10-01", "groceries"), 600);
        assert_eq!(spent_on(&txs, "2026-10-02", "groceries"), 0);
    }

    #[test]
    fn a_streak_counts_days_inside_the_allowance_and_stops_at_the_first_day_over() {
        // 31 days, 3100 -> 100 a day
        let txs = [
            tx("2026-10-01", -50, "groceries"),
            tx("2026-10-09", -500, "groceries"),
            tx("2026-10-11", -50, "groceries"),
        ];
        assert_eq!(
            streak(&txs, 3100, "2026-10-11", "groceries", 1.0).unwrap(),
            2
        );
        assert_eq!(streak(&txs, 0, "2026-10-11", "groceries", 1.0).unwrap(), 0);
        assert_eq!(
            streak(&[], 3100, "2026-10-11", "groceries", 1.0).unwrap(),
            0
        );
    }

    #[test]
    fn a_freeze_is_earned_on_the_7th_day_and_covers_the_next_miss() {
        let mut txs = vec![tx("2026-10-01", -50, "groceries")];
        txs.push(tx("2026-10-09", -9000, "groceries")); // far over the allowance on day 9
        let s = streak_state(&txs, 3100, "2026-10-12", "groceries", 1.0).unwrap();
        assert_eq!(s.earned, 1);
        assert_eq!(s.used_on, vec!["2026-10-09".to_string()]);
        assert_eq!(s.days, 11, "the missed day is bridged, not counted");
        assert_eq!(s.reached.seven.as_deref(), Some("2026-10-07"));
        assert!(!s.frozen_today);
        let today = streak_state(&txs, 3100, "2026-10-09", "groceries", 1.0).unwrap();
        assert!(today.frozen_today);
    }

    #[test]
    fn level_and_xp_follow_the_quests_and_the_streak() {
        assert_eq!(xp(3, 4), 50);
        let l = level(120);
        assert_eq!((l.level, l.title, l.into), (3, "Savings Ninja", 20));
        assert_eq!(level(10_000).title, "Money Master");
    }

    #[test]
    fn weeks_start_on_monday() {
        assert_eq!(week_start("2026-10-11").unwrap(), "2026-10-05"); // a Sunday
        assert_eq!(week_start("2026-10-05").unwrap(), "2026-10-05");
    }

    #[test]
    fn the_badge_ids_keep_their_order() {
        assert_eq!(badge_ids().len(), 8);
        assert_eq!(badge_ids()[0], "first-week");
        assert_eq!(badge_ids()[7], "quest-master");
    }

    #[test]
    fn the_trophy_wording_follows_the_collection() {
        let r = |earned: usize, freezes: i64, frozen: bool| Rewards {
            streak: StreakState {
                freezes,
                frozen_today: frozen,
                days: 5,
                ..StreakState::default()
            },
            badges: (0..8)
                .map(|n| Badge {
                    id: n.to_string(),
                    title: String::new(),
                    rule: String::new(),
                    icon: String::new(),
                    earned: n < earned,
                    earned_on: None,
                })
                .collect(),
            bests: serde_json::Value::Null,
        };
        assert!(trophy_message(&r(2, 0, true)).contains("5-day streak today"));
        assert!(trophy_message(&r(8, 0, false)).contains("legend"));
        assert!(trophy_message(&r(0, 0, false)).contains("first trophy"));
        assert!(trophy_message(&r(2, 2, false)).contains("Two streak freezes"));
        assert_eq!(
            trophy_message(&r(3, 0, false)),
            "3 of 8 trophies. Keep collecting!"
        );
        assert_eq!(trophy_mood(&r(3, 0, false), true), "cheer");
        assert_eq!(trophy_mood(&r(3, 0, false), false), "happy");
    }
}
