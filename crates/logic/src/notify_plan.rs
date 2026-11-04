//! What to tell the user and when, with no device access: the evening message, the payday
//! reminder and the price-drop announcement. `native/notifications.ts` schedules what this decides.
//! (The reminders of calendar events still live in TypeScript beside the calendar.)
//!
//! The app is English-only (only the number format is German). Dates are ISO `YYYY-MM-DD` in the
//! phone's local calendar; times are local hour and minute.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::Duration;

use crate::format::{date_of, format_cents};
use crate::period::{budget_period, iso, period_label, Period};
use crate::safe_to_spend::SafeToSpend;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClockTime {
    pub hour: u32,
    pub minute: u32,
}

pub const EVENING_TIME: ClockTime = ClockTime {
    hour: 18,
    minute: 0,
};
pub const PAYDAY_TIME: ClockTime = ClockTime { hour: 8, minute: 0 };

/// A notification to be delivered at `date` + `hour:minute` local time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Planned {
    pub id: String,
    pub date: String,
    pub hour: u32,
    pub minute: u32,
    pub title: String,
    pub body: String,
}

pub const EVENING_ID_PREFIX: &str = "financer.evening.";
pub const PAYDAY_ID_PREFIX: &str = "financer.payday.";

fn add_days(iso_date: &str, days: i64) -> Result<String, String> {
    Ok(iso(date_of(iso_date)? + Duration::days(days)))
}

fn minutes_of(t: ClockTime) -> u32 {
    t.hour * 60 + t.minute
}

/// The next few evening messages. The text is fixed when it is scheduled, so it is only as fresh as
/// the last time the app (or its background task) ran: today's message uses the number the app shows
/// now, later days a projection ("about") from the money still free, divided over the days left.
/// Nothing is planned without detected income or past the end of the budget period.
///
/// `now_minutes` is the local time of day in minutes; today's message is skipped once its time passed.
pub fn evening_plan(
    safe: &SafeToSpend,
    now_minutes: u32,
    time: Option<ClockTime>,
    days: Option<i64>,
) -> Result<Vec<Planned>, String> {
    let time = time.unwrap_or(EVENING_TIME);
    let days = days.unwrap_or(3);
    if !safe.income_detected {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for k in 0..days {
        let date = add_days(&safe.today, k)?;
        let left = safe.days_left - k; // days left in the period counting that day
        if date > safe.period_end || left < 1 {
            break;
        }
        if k == 0 && now_minutes >= minutes_of(time) {
            continue;
        }
        let body = if safe.available_cents < 0 {
            format!(
                "This period is over budget by {}. Go easy today.",
                format_cents(-safe.available_cents)
            )
        } else {
            let cents = if k == 0 {
                safe.daily_cents
            } else {
                safe.available_cents.div_euclid(left)
            };
            if cents <= 0 {
                "Nothing is left to spend today.".to_string()
            } else if k == 0 {
                format!("You have {} left to spend today.", format_cents(cents))
            } else {
                format!("About {} is free to spend today.", format_cents(cents))
            }
        };
        out.push(Planned {
            id: format!("{EVENING_ID_PREFIX}{date}"),
            date,
            hour: time.hour,
            minute: time.minute,
            title: "Evening check".into(),
            body,
        });
    }
    Ok(out)
}

/// The next paydays (the first day of the next budget periods, by the same rule the server uses), as
/// morning reminders. Today counts when it is a payday and the reminder time has not passed.
pub fn payday_plan(
    today: &str,
    payday: f64,
    now_minutes: u32,
    time: Option<ClockTime>,
    count: Option<usize>,
) -> Result<Vec<Planned>, String> {
    let time = time.unwrap_or(PAYDAY_TIME);
    let count = count.unwrap_or(2);
    let mut out = Vec::new();
    let mut period = budget_period(today, payday)?;
    let entry = |p: &Period| -> Result<Planned, String> {
        Ok(Planned {
            id: format!("{PAYDAY_ID_PREFIX}{}", p.start),
            date: p.start.clone(),
            hour: time.hour,
            minute: time.minute,
            title: "Payday".into(),
            body: format!(
                "Your new budget period ({}) starts today. A good moment to look at your budget.",
                period_label(p)?
            ),
        })
    };
    if period.start == today && now_minutes < minutes_of(time) {
        out.push(entry(&period)?);
    }
    while out.len() < count {
        period = budget_period(&add_days(&period.end, 1)?, payday)?;
        out.push(entry(&period)?);
    }
    Ok(out)
}

/// What the app remembers between checks, so the same drop is announced once.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PriceMemory {
    /// Per catalog item, the price (cents) a drop is measured against.
    #[serde(default)]
    pub refs: BTreeMap<String, i64>,
    /// `item:chain:cents` of drops already announced (newest last, capped).
    #[serde(default)]
    pub announced: Vec<String>,
}

/// A drop needs to be at least this many percent AND this many cents, so noise stays quiet.
pub const MIN_DROP_PERCENT: i64 = 5;
pub const MIN_DROP_CENTS: i64 = 10;
pub const MAX_TRACKED_ITEMS: usize = 40;
pub const MAX_ANNOUNCED: usize = 30;

#[derive(Debug, Clone, Deserialize)]
pub struct Price {
    pub item: String,
    pub chain: String,
    pub price_cents: i64,
    #[serde(default)]
    pub reference_pack: String,
    #[serde(default)]
    pub is_offer: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Tracked {
    pub item: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceDrop {
    pub item: String,
    pub name: String,
    pub chain: String,
    pub cents: i64,
    pub was_cents: i64,
    pub pack: String,
    pub is_offer: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DropsFound {
    pub drops: Vec<PriceDrop>,
    pub memory: PriceMemory,
}

fn keep_newest(mut announced: Vec<String>) -> Vec<String> {
    if announced.len() > MAX_ANNOUNCED {
        announced.drain(..announced.len() - MAX_ANNOUNCED);
    }
    announced
}

/// Compare today's cheapest price of each usual item with what was seen before.
///
/// - First time an item is seen: remember its price, announce nothing.
/// - Cheaper by the thresholds above and not announced before: a drop; the new price becomes the
///   reference. A smaller dip leaves the reference alone, so slow declines add up to a drop.
/// - Dearer: the reference follows the price up, so a later fall is measured from the new level.
///
/// Returns the drops (biggest saving first) and the memory to store.
pub fn find_price_drops(items: &[Tracked], prices: &[Price], memory: &PriceMemory) -> DropsFound {
    let mut refs = BTreeMap::new();
    let mut announced = memory.announced.clone();
    let mut drops = Vec::new();

    for Tracked { item, name } in items.iter().take(MAX_TRACKED_ITEMS) {
        let before = memory.refs.get(item).copied();
        let best = prices
            .iter()
            .filter(|p| &p.item == item && p.price_cents > 0)
            .min_by(|a, b| {
                a.price_cents
                    .cmp(&b.price_cents)
                    .then_with(|| a.chain.cmp(&b.chain))
            });
        let Some(best) = best else {
            if let Some(b) = before {
                refs.insert(item.clone(), b); // nothing listed right now: keep what we knew
            }
            continue;
        };
        let Some(before) = before else {
            refs.insert(item.clone(), best.price_cents);
            continue;
        };
        if best.price_cents > before {
            refs.insert(item.clone(), best.price_cents);
            continue;
        }
        if best.price_cents == before {
            refs.insert(item.clone(), before);
            continue;
        }
        let saved = before - best.price_cents;
        if saved < MIN_DROP_CENTS || saved * 100 < before * MIN_DROP_PERCENT {
            refs.insert(item.clone(), before);
            continue;
        }
        refs.insert(item.clone(), best.price_cents);
        let key = format!("{item}:{}:{}", best.chain, best.price_cents);
        if announced.contains(&key) {
            continue;
        }
        announced.push(key);
        drops.push(PriceDrop {
            item: item.clone(),
            name: name.clone(),
            chain: best.chain.clone(),
            cents: best.price_cents,
            was_cents: before,
            pack: best.reference_pack.clone(),
            is_offer: best.is_offer,
        });
    }

    drops.sort_by(|a, b| {
        (b.was_cents - b.cents)
            .cmp(&(a.was_cents - a.cents))
            .then_with(|| a.item.cmp(&b.item))
    });
    DropsFound {
        drops,
        memory: PriceMemory {
            refs,
            announced: keep_newest(announced),
        },
    }
}

fn chain_name(chain: &str) -> String {
    match chain {
        "aldi" => "Aldi".into(),
        "lidl" => "Lidl".into(),
        "kaufland" => "Kaufland".into(),
        "rewe" => "Rewe".into(),
        other => other.into(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Message {
    pub title: String,
    pub body: String,
}

/// One notification for all drops found in a check (none when there are none).
pub fn price_drop_message(drops: &[PriceDrop]) -> Option<Message> {
    let line = |d: &PriceDrop| {
        format!(
            "{}: {} per {} at {} (was {}){}",
            d.name,
            format_cents(d.cents),
            d.pack,
            chain_name(&d.chain),
            format_cents(d.was_cents),
            if d.is_offer { ", on offer" } else { "" }
        )
    };
    match drops {
        [] => None,
        [one] => Some(Message {
            title: format!("Cheaper: {}", one.name),
            body: line(one),
        }),
        many => {
            let shown = many.iter().take(3).map(line).collect::<Vec<_>>().join("\n");
            let more = if many.len() > 3 {
                format!("\nand {} more", many.len() - 3)
            } else {
                String::new()
            };
            Some(Message {
                title: format!("{} of your usual items got cheaper", many.len()),
                body: shown + &more,
            })
        }
    }
}

/// Reads the stored memory; anything unreadable is an empty memory, junk entries are dropped.
pub fn parse_price_memory(raw: Option<&str>) -> PriceMemory {
    let Some(raw) = raw.filter(|r| !r.is_empty()) else {
        return PriceMemory::default();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return PriceMemory::default();
    };
    let refs = v
        .get("refs")
        .and_then(|r| r.as_object())
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| {
                    v.as_f64()
                        .filter(|n| n.is_finite() && *n > 0.0)
                        .map(|n| (k.clone(), n as i64))
                })
                .collect()
        })
        .unwrap_or_default();
    let announced = v
        .get("announced")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    PriceMemory {
        refs,
        announced: keep_newest(announced),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::safe_to_spend::Pace;

    fn safe() -> SafeToSpend {
        SafeToSpend {
            today: "2026-10-11".into(),
            period_end: "2026-10-24".into(),
            daily_cents: 9214,
            days_left: 14,
            available_cents: 129000,
            income_detected: true,
            income_cents: 250000,
            income_received_cents: 250000,
            income_upcoming_cents: 0,
            spent_so_far_cents: 100000,
            fixed_costs_due_cents: 1000,
            envelope_headroom_cents: 20000,
            pace: Pace::OnTrack,
            pace_target_cents: 95766,
            discretionary_spent_cents: 20000,
        }
    }

    #[test]
    fn the_evening_message_uses_the_apps_number_today_and_a_projection_later() {
        let plan = evening_plan(&safe(), 12 * 60, None, None).unwrap();
        assert_eq!(
            plan.iter().map(|p| p.date.as_str()).collect::<Vec<_>>(),
            ["2026-10-11", "2026-10-12", "2026-10-13"]
        );
        assert_eq!(plan[0].body, "You have 92,14 € left to spend today.");
        assert_eq!(
            plan[1].body,
            format!(
                "About {} is free to spend today.",
                format_cents(129000 / 13)
            )
        );
        assert_eq!((plan[0].hour, plan[0].minute), (18, 0));
        assert_eq!(plan[0].id, "financer.evening.2026-10-11");
    }

    #[test]
    fn today_is_skipped_once_its_time_has_passed_and_nothing_is_planned_past_the_period() {
        let late = evening_plan(&safe(), 19 * 60, None, None).unwrap();
        assert_eq!(late[0].date, "2026-10-12");
        let last = SafeToSpend {
            days_left: 1,
            today: "2026-10-24".into(),
            ..safe()
        };
        assert_eq!(evening_plan(&last, 0, None, None).unwrap().len(), 1);
        assert!(evening_plan(
            &SafeToSpend {
                income_detected: false,
                ..safe()
            },
            0,
            None,
            None
        )
        .unwrap()
        .is_empty());
    }

    #[test]
    fn it_says_so_when_over_budget_or_when_nothing_is_left() {
        let over = evening_plan(
            &SafeToSpend {
                available_cents: -2500,
                ..safe()
            },
            0,
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            over[0].body,
            "This period is over budget by 25,00 €. Go easy today."
        );
        let none = evening_plan(
            &SafeToSpend {
                daily_cents: 0,
                ..safe()
            },
            0,
            None,
            None,
        )
        .unwrap();
        assert_eq!(none[0].body, "Nothing is left to spend today.");
    }

    #[test]
    fn paydays_follow_the_period_rule() {
        let plan = payday_plan("2026-10-11", 25.0, 0, None, None).unwrap();
        assert_eq!(
            plan.iter().map(|p| p.date.as_str()).collect::<Vec<_>>(),
            ["2026-10-25", "2026-11-25"]
        );
        assert!(plan[0].body.contains("25.10. \u{2013} 24.11.2026"));
        let today = payday_plan("2026-10-25", 25.0, 7 * 60, None, None).unwrap();
        assert_eq!(today[0].date, "2026-10-25");
        let missed = payday_plan("2026-10-25", 25.0, 9 * 60, None, None).unwrap();
        assert_eq!(missed[0].date, "2026-11-25");
    }

    fn price(item: &str, chain: &str, cents: i64) -> Price {
        Price {
            item: item.into(),
            chain: chain.into(),
            price_cents: cents,
            reference_pack: "1 l".into(),
            is_offer: false,
        }
    }
    fn tracked() -> Vec<Tracked> {
        vec![Tracked {
            item: "milk".into(),
            name: "Milk".into(),
        }]
    }

    #[test]
    fn a_new_item_is_remembered_not_announced_and_a_real_drop_is_announced_once() {
        let first = find_price_drops(
            &tracked(),
            &[price("milk", "lidl", 100)],
            &PriceMemory::default(),
        );
        assert!(first.drops.is_empty());
        assert_eq!(first.memory.refs["milk"], 100);

        let dropped = find_price_drops(
            &tracked(),
            &[price("milk", "aldi", 80), price("milk", "lidl", 100)],
            &first.memory,
        );
        assert_eq!(dropped.drops.len(), 1);
        assert_eq!(
            (dropped.drops[0].cents, dropped.drops[0].was_cents),
            (80, 100)
        );
        assert_eq!(dropped.memory.refs["milk"], 80);

        // the same price again is not a new drop; a rise moves the reference up
        let again = find_price_drops(&tracked(), &[price("milk", "aldi", 80)], &dropped.memory);
        assert!(again.drops.is_empty());
        let up = find_price_drops(&tracked(), &[price("milk", "aldi", 120)], &dropped.memory);
        assert_eq!(up.memory.refs["milk"], 120);
    }

    #[test]
    fn small_dips_stay_quiet_and_add_up() {
        let mem = PriceMemory {
            refs: [("milk".to_string(), 1000)].into(),
            announced: vec![],
        };
        let dip = find_price_drops(&tracked(), &[price("milk", "lidl", 980)], &mem);
        assert!(dip.drops.is_empty());
        assert_eq!(
            dip.memory.refs["milk"], 1000,
            "the reference stays, so slow declines add up"
        );
        let enough = find_price_drops(&tracked(), &[price("milk", "lidl", 940)], &dip.memory);
        assert_eq!(enough.drops.len(), 1);
    }

    #[test]
    fn nothing_listed_keeps_what_was_known_and_the_announced_list_is_capped() {
        let mem = PriceMemory {
            refs: [("milk".to_string(), 100)].into(),
            announced: (0..40).map(|n| n.to_string()).collect(),
        };
        let out = find_price_drops(&tracked(), &[], &mem);
        assert_eq!(out.memory.refs["milk"], 100);
        assert_eq!(out.memory.announced.len(), MAX_ANNOUNCED);
        assert_eq!(out.memory.announced.last().unwrap(), "39");
    }

    #[test]
    fn the_message_names_one_drop_or_sums_up_several() {
        let d = |name: &str, cents| PriceDrop {
            item: name.into(),
            name: name.into(),
            chain: "lidl".into(),
            cents,
            was_cents: cents + 50,
            pack: "1 l".into(),
            is_offer: cents == 1,
        };
        assert_eq!(price_drop_message(&[]), None);
        let one = price_drop_message(&[d("Milk", 80)]).unwrap();
        assert_eq!(one.title, "Cheaper: Milk");
        assert_eq!(one.body, "Milk: 0,80 € per 1 l at Lidl (was 1,30 €)");
        let many = price_drop_message(&[d("A", 1), d("B", 2), d("C", 3), d("D", 4)]).unwrap();
        assert_eq!(many.title, "4 of your usual items got cheaper");
        assert!(many.body.ends_with("\nand 1 more") && many.body.contains(", on offer"));
    }

    #[test]
    fn stored_memory_is_read_leniently() {
        assert_eq!(parse_price_memory(None), PriceMemory::default());
        assert_eq!(
            parse_price_memory(Some("{not json")),
            PriceMemory::default()
        );
        let m = parse_price_memory(Some(
            r#"{"refs":{"a":100,"b":-1,"c":"x"},"announced":["k",3]}"#,
        ));
        assert_eq!(m.refs.len(), 1);
        assert_eq!(m.announced, vec!["k".to_string()]);
    }
}
