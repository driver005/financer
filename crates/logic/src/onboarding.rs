//! First-run setup: which steps there are for a build, how far along the user is, what a typed value
//! means, how a savings level turns into a daily grocery allowance, what the mascot says, and whether
//! the app should send someone to the setup at all. The screens and the storage stay in TypeScript.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::format::{format_cents, parse_euro_input};
use crate::period::{budget_period, period_days};

pub const STEP_IDS: [&str; 8] = [
    "welcome",
    "data",
    "household",
    "rhythm",
    "habits",
    "money",
    "safety",
    "finish",
];
pub const HOUSEHOLD_MIN: i64 = 1;
pub const HOUSEHOLD_MAX: i64 = 8;
/// 10.000 EUR: far above any grocery budget, there to catch a typo like an extra zero.
pub const MAX_BUDGET_CENTS: i64 = 1_000_000;
pub const BASE_DAILY_PER_PERSON_CENTS: f64 = 650.0;
/// Each person after the first adds 85% of the first (packs and staples are shared).
pub const EXTRA_PERSON_WEIGHT: f64 = 0.85;
pub const MIN_ALLOWANCE_CENTS: i64 = 100;
const AVG_DAYS_PER_MONTH: f64 = 365.0 / 12.0;
pub(crate) const CHAINS: [&str; 4] = ["lidl", "aldi", "kaufland", "rewe"];

pub(crate) fn chain_name(c: &str) -> &str {
    match c {
        "lidl" => "Lidl",
        "aldi" => "Aldi",
        "kaufland" => "Kaufland",
        "rewe" => "Rewe",
        other => other,
    }
}

// ---- steps ----

/// The steps for this build, in order. "safety" (app lock and notifications) only exists in the phone app.
pub fn steps_for(platform: &str) -> Vec<&'static str> {
    STEP_IDS
        .iter()
        .copied()
        .filter(|id| *id != "safety" || platform != "web")
        .collect()
}

pub fn is_step_id(value: &str) -> bool {
    STEP_IDS.contains(&value)
}

/// The step after `current`, or none at the end (or when `current` is not in the list).
pub fn next_step(steps: &[String], current: &str) -> Option<String> {
    let i = steps.iter().position(|s| s == current)?;
    steps.get(i + 1).cloned()
}

/// The step before `current`, or none on the first step.
pub fn previous_step(steps: &[String], current: &str) -> Option<String> {
    let i = steps.iter().position(|s| s == current)?;
    i.checked_sub(1).map(|p| steps[p].clone())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Progress {
    pub index: usize,
    pub total: usize,
    pub fraction: f64,
}

/// Where the progress bar stands: 0 on the first step, 1 on the last.
pub fn progress_of(steps: &[String], current: &str) -> Progress {
    let total = steps.len();
    let index = steps.iter().position(|s| s == current).unwrap_or(0);
    Progress {
        index,
        total,
        fraction: if total > 1 {
            index as f64 / (total - 1) as f64
        } else {
            1.0
        },
    }
}

/// A stored step that this build no longer has moves on to the next one that exists.
pub fn resolve_step(steps: &[String], stored: &str) -> String {
    if steps.iter().any(|s| s == stored) {
        return stored.into();
    }
    let from = STEP_IDS
        .iter()
        .position(|s| *s == stored)
        .map_or(0, |i| i + 1);
    STEP_IDS[from.min(STEP_IDS.len())..]
        .iter()
        .find(|id| steps.iter().any(|s| s == *id))
        .map(|s| s.to_string())
        .or_else(|| steps.last().cloned())
        .unwrap_or_default()
}

// ---- the answers ----

/// Everything the user has answered so far. Every field is optional: a skipped question stays unset
/// and is simply not applied, so skipping never overwrites what the app already has.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub household_size: Option<i64>,
    /// The grocery budget as typed, in cents, per `grocery_cadence`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grocery_budget_cents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grocery_cadence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chains: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub postal_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payday: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intensity: Option<String>,
    /// Grocery allowance per day in cents (suggested from the level, then editable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_allowance_cents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub habit_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub demo_loaded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csv_imported: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lock_on: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_kinds: Option<Vec<String>>,
}

fn int_in(v: Option<&Value>, min: i64, max: i64) -> Option<i64> {
    let n = v?
        .as_i64()
        .or_else(|| v?.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64))?;
    (min..=max).contains(&n).then_some(n)
}

fn word<'a>(v: Option<&'a Value>, allowed: &[&str]) -> Option<&'a str> {
    v?.as_str().filter(|s| allowed.contains(s))
}

/// Keep only well-formed fields of a stored draft (the file may be old, edited or damaged).
pub fn sanitize_draft(raw: &Value) -> Draft {
    let Some(r) = raw.as_object() else {
        return Draft::default();
    };
    let g = |k: &str| r.get(k);
    Draft {
        backend: word(g("backend"), &["embedded", "server"]).map(String::from),
        household_size: int_in(g("householdSize"), HOUSEHOLD_MIN, HOUSEHOLD_MAX),
        grocery_budget_cents: int_in(g("groceryBudgetCents"), 1, MAX_BUDGET_CENTS),
        grocery_cadence: word(g("groceryCadence"), &["weekly", "monthly"]).map(String::from),
        chains: g("chains").and_then(Value::as_array).map(|a| {
            CHAINS
                .iter()
                .filter(|c| a.iter().any(|x| x.as_str() == Some(c)))
                .map(|c| c.to_string())
                .collect()
        }),
        postal_code: g("postalCode")
            .and_then(Value::as_str)
            .filter(|s| is_postal(s))
            .map(String::from),
        payday: int_in(g("payday"), 1, 28),
        intensity: word(g("intensity"), &["casual", "regular", "serious"]).map(String::from),
        daily_allowance_cents: int_in(g("dailyAllowanceCents"), 1, MAX_BUDGET_CENTS),
        habit_mode: word(g("habitMode"), &["manual", "receipts", "spending"]).map(String::from),
        demo_loaded: (g("demoLoaded").and_then(Value::as_bool) == Some(true)).then_some(true),
        csv_imported: int_in(g("csvImported"), 0, 10_000_000),
        lock_on: g("lockOn").and_then(Value::as_bool),
        notify_kinds: g("notifyKinds").and_then(Value::as_array).map(|a| {
            a.iter()
                .filter_map(|k| k.as_str().map(String::from))
                .take(8)
                .collect()
        }),
    }
}

fn is_postal(s: &str) -> bool {
    s.len() == 5 && s.bytes().all(|b| b.is_ascii_digit())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OnboardingState {
    pub v: u8,
    pub step: String,
    pub draft: Draft,
}

/// Read a stored state; none for nothing or garbage (start from the top).
pub fn parse_state(raw: Option<&str>) -> Option<OnboardingState> {
    let v: Value = serde_json::from_str(raw.filter(|r| !r.is_empty())?).ok()?;
    if v.get("v").and_then(Value::as_i64) != Some(1) {
        return None;
    }
    let step = v
        .get("step")
        .and_then(Value::as_str)
        .filter(|s| is_step_id(s))?;
    Some(OnboardingState {
        v: 1,
        step: step.into(),
        draft: sanitize_draft(v.get("draft").unwrap_or(&Value::Null)),
    })
}

// ---- validation ----

pub fn clamp_household(n: f64) -> i64 {
    let t = if n.is_finite() {
        n.trunc() as i64
    } else {
        HOUSEHOLD_MIN
    };
    t.clamp(HOUSEHOLD_MIN, HOUSEHOLD_MAX)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Parsed<T> {
    Ok { ok: bool, value: T },
    Err { ok: bool, error: String },
}

fn ok<T>(value: T) -> Parsed<T> {
    Parsed::Ok { ok: true, value }
}
fn err<T>(error: &str) -> Parsed<T> {
    Parsed::Err {
        ok: false,
        error: error.into(),
    }
}

/// An optional 5-digit German postal code; empty is fine (`value: null`).
pub fn parse_postal_code(input: &str) -> Parsed<Option<String>> {
    let s = input.trim();
    if s.is_empty() {
        ok(None)
    } else if !is_postal(s) {
        err("A German postal code has 5 digits, like 10115.")
    } else {
        ok(Some(s.into()))
    }
}

/// An optional euro amount; empty is fine (`value: null`).
pub fn parse_budget(input: &str) -> Parsed<Option<i64>> {
    let typed = input.trim();
    if typed.is_empty() {
        return ok(None);
    }
    // a phone keyboard may offer a decimal point: "59.90" means 59,90 here, not 5990
    let dotted = typed.split_once('.').is_some_and(|(a, b)| {
        !a.is_empty()
            && a.bytes().all(|c| c.is_ascii_digit())
            && (1..=2).contains(&b.len())
            && b.bytes().all(|c| c.is_ascii_digit())
    });
    let Some(cents) = parse_euro_input(&if dotted {
        typed.replace('.', ",")
    } else {
        typed.to_string()
    }) else {
        return err("Enter an amount like 60 or 59,90.");
    };
    if cents <= 0 {
        return err("The budget has to be more than 0.");
    }
    if cents > MAX_BUDGET_CENTS {
        return err("That is more than 10.000 EUR. Check the amount.");
    }
    ok(Some(cents))
}

/// A weekly budget as a per-month amount (52 weeks over 12 months); monthly stays as it is.
pub fn monthly_grocery_cents(cents: i64, cadence: &str) -> i64 {
    if cadence == "weekly" {
        ((cents * 52) as f64 / 12.0 + 0.5).floor() as i64
    } else {
        cents
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ServerCheck {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    pub normalized: String,
}

fn is_local(host: &str) -> bool {
    let rest = |p: &str| host.starts_with(p);
    host == "localhost"
        || host.ends_with(".local")
        || rest("127.")
        || rest("10.")
        || rest("192.168.")
        || host
            .strip_prefix("172.")
            .and_then(|r| r.split('.').next())
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| (16..=31).contains(&n))
}

/// Check the server address and token before testing the connection. Errors block the test; a
/// warning (plain http to a host that is not on your own network) is shown but allowed.
pub fn validate_server(url: &str, token: &str) -> ServerCheck {
    let trimmed = url.trim();
    let normalized = trimmed.trim_end_matches('/').to_string();
    let fail = |e: &str| ServerCheck {
        ok: false,
        error: Some(e.into()),
        warning: None,
        normalized: normalized.clone(),
    };
    if trimmed.is_empty() {
        return fail("Enter the address of your server.");
    }
    let Some((scheme, rest)) = normalized.split_once("://") else {
        return fail("That does not look like an address. Start with https://");
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = authority.rsplit('@').next().unwrap_or("");
    let host = match hostport.rsplit_once(':') {
        Some((h, p)) if p.bytes().all(|b| b.is_ascii_digit()) => h,
        _ => hostport,
    };
    let valid_scheme = !scheme.is_empty()
        && scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c));
    if !valid_scheme || host.is_empty() || host.chars().any(|c| c.is_whitespace()) {
        return fail("That does not look like an address. Start with https://");
    }
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return fail("The address has to start with https:// (or http:// on your own network).");
    }
    if token.trim().is_empty() {
        return fail("Enter the API token you set on the server.");
    }
    if scheme == "http" && !is_local(&host.to_lowercase()) {
        return ServerCheck { ok: true, error: None, warning: Some("This address is not encrypted (http). Your token and data would travel in the clear. Use https://.".into()), normalized };
    }
    ServerCheck {
        ok: true,
        error: None,
        warning: None,
        normalized,
    }
}

// ---- savings levels and the daily allowance ----

/// The three named levels (id, label, factor). The factor scales the starting point.
pub const INTENSITIES: [(&str, &str, f64); 3] = [
    ("casual", "Casual", 1.0),
    ("regular", "Regular", 0.85),
    ("serious", "Serious", 0.7),
];

pub fn household_factor(size: f64) -> f64 {
    1.0 + EXTRA_PERSON_WEIGHT * (clamp_household(size) - 1) as f64
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceArgs {
    pub intensity: String,
    #[serde(default)]
    pub household_size: Option<f64>,
    #[serde(default)]
    pub grocery_budget_cents: Option<i64>,
    #[serde(default)]
    pub grocery_cadence: Option<String>,
}

/// The daily grocery allowance (cents) a savings level suggests. It starts from the budget the user
/// entered (spread over the days of a month) or, without one, from the household size, then scales
/// by the level and rounds to 10 cents.
pub fn suggest_allowance(a: &AllowanceArgs) -> i64 {
    let factor = INTENSITIES
        .iter()
        .find(|i| i.0 == a.intensity)
        .unwrap_or(&INTENSITIES[0])
        .2;
    let start = match a.grocery_budget_cents {
        Some(b) => {
            monthly_grocery_cents(b, a.grocery_cadence.as_deref().unwrap_or("monthly")) as f64
                / AVG_DAYS_PER_MONTH
        }
        None => BASE_DAILY_PER_PERSON_CENTS * household_factor(a.household_size.unwrap_or(1.0)),
    };
    MIN_ALLOWANCE_CENTS.max((((start * factor) / 10.0 + 1e-9 + 0.5).floor() as i64) * 10)
}

/// The grocery limit for the budget period containing `today`, in cents, or none if the user gave
/// neither a daily allowance nor a budget. A daily allowance wins; it is spread over the days of the
/// period so `floor(limit / days)` gives it back.
pub fn grocery_limit_for(d: &Draft, today: &str) -> Result<Option<i64>, String> {
    if let Some(daily) = d.daily_allowance_cents {
        let days = period_days(&budget_period(today, d.payday.unwrap_or(1) as f64)?)?;
        return Ok(Some(daily * i64::from(days)));
    }
    Ok(d.grocery_budget_cents
        .map(|b| monthly_grocery_cents(b, d.grocery_cadence.as_deref().unwrap_or("monthly"))))
}

// ---- the profile that outlives the setup ----

/// What the app has no server-side field for: household size, stores, postal code.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub household_size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chains: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub postal_code: Option<String>,
}

pub fn parse_profile(raw: Option<&str>) -> Profile {
    let Some(v) = raw
        .filter(|r| !r.is_empty())
        .and_then(|r| serde_json::from_str::<Value>(r).ok())
    else {
        return Profile::default();
    };
    let d = sanitize_draft(&v);
    Profile {
        household_size: d.household_size,
        chains: d.chains,
        postal_code: d.postal_code,
    }
}

/// The stored profile with the answers of this run on top; unanswered questions keep what was there.
pub fn merge_profile(existing: &Profile, d: &Draft) -> Profile {
    Profile {
        household_size: d.household_size.or(existing.household_size),
        chains: d.chains.clone().or_else(|| existing.chains.clone()),
        postal_code: d
            .postal_code
            .clone()
            .or_else(|| existing.postal_code.clone()),
    }
}

// ---- applying the answers ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope {
    pub category: String,
    pub limit_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPlan {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payday: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub habit_mode: Option<String>,
    /// The full envelope list to save (the user's others kept, groceries replaced), or none to leave the budget alone.
    pub envelopes: Option<Vec<Envelope>>,
}

/// What to write to the backend for these answers; unanswered questions write nothing.
pub fn plan_apply(d: &Draft, today: &str, existing: &[Envelope]) -> Result<ApplyPlan, String> {
    let limit = grocery_limit_for(d, today)?;
    Ok(ApplyPlan {
        payday: d.payday,
        habit_mode: d.habit_mode.clone(),
        envelopes: limit.map(|l| {
            existing
                .iter()
                .filter(|e| e.category != "groceries")
                .cloned()
                .chain([Envelope {
                    category: "groceries".into(),
                    limit_cents: l,
                }])
                .collect()
        }),
    })
}

// ---- the mascot ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MascotLine {
    pub message: String,
    pub mood: &'static str,
}

fn line(message: impl Into<String>, mood: &'static str) -> MascotLine {
    MascotLine {
        message: message.into(),
        mood,
    }
}

/// What Penny says for the current answers on a step.
pub fn mascot_for(step: &str, d: &Draft, embedded_available: bool) -> MascotLine {
    match step {
        "welcome" => line(
            "Hi, I'm Penny! Let's find out what you can spend and what to buy.",
            "happy",
        ),
        "data" => match d.backend.as_deref() {
            Some("embedded") => line(
                "On your phone it is. Private, and no hosting bill!",
                "cheer",
            ),
            Some("server") => line(
                "Your own server. Always on, and shared across your devices.",
                "happy",
            ),
            _ => line(
                if embedded_available {
                    "Where should I keep your numbers? Both choices are fine."
                } else {
                    "Where do your numbers live? This build talks to a server."
                },
                "happy",
            ),
        },
        "household" => {
            let Some(n) = d.household_size.filter(|n| *n != 0) else {
                return line("Who are we shopping for?", "happy");
            };
            let chains = d.chains.as_ref().map_or(0, Vec::len);
            if chains == 0 {
                return line(
                    if n == 1 {
                        "Cooking for one. Easy to plan!".to_string()
                    } else {
                        format!("A household of {n}. I'll plan for everyone.")
                    },
                    "happy",
                );
            }
            let where_ = if chains == 1 {
                chain_name(&d.chains.as_ref().unwrap()[0]).to_string()
            } else {
                format!("{chains} stores")
            };
            line(
                format!(
                    "{where_} for {}. I'll compare prices there first.",
                    if n == 1 {
                        "one".to_string()
                    } else {
                        format!("{n} people")
                    }
                ),
                "cheer",
            )
        }
        "rhythm" => {
            let (Some(level), Some(daily)) = (
                d.intensity
                    .as_deref()
                    .filter(|i| INTENSITIES.iter().any(|x| x.0 == *i)),
                d.daily_allowance_cents,
            ) else {
                return line(
                    "How hard do you want to save? You can change it any time.",
                    "happy",
                );
            };
            let n = format_cents(daily);
            match level {
                "casual" => line(
                    format!("Casual it is. About {n} a day, no pressure."),
                    "happy",
                ),
                "regular" => line(format!("Regular. {n} a day is a solid plan."), "cheer"),
                _ => line(
                    format!("Serious! {n} a day. I'll cheer every day you stay under."),
                    "cheer",
                ),
            }
        }
        "habits" => match d.habit_mode.as_deref() {
            Some("manual") => line("Your own list. You decide what is in the basket.", "happy"),
            Some("receipts") => line("Receipts teach me what you really buy. Smart!", "cheer"),
            Some("spending") => line(
                "Spending only. I'll estimate with a generic basket.",
                "happy",
            ),
            _ => line(
                "Your bank only shows the total, not the bag. How should I learn?",
                "happy",
            ),
        },
        "money" => {
            if d.demo_loaded == Some(true) {
                line(
                    "Demo data is in. Have a look at Today, all of it is labelled DEMO.",
                    "cheer",
                )
            } else if d.csv_imported.unwrap_or(0) > 0 {
                line("Your bookings are in. Now we can do real maths!", "cheer")
            } else {
                line(
                    "Want numbers to play with? Everything here is optional.",
                    "happy",
                )
            }
        }
        "safety" => line(
            "Two small things: a lock for the app, and nudges when they help.",
            "happy",
        ),
        _ => line("All set! Your first quest is waiting.", "cheer"),
    }
}

// ---- recap and first quest ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecapRow {
    pub label: String,
    pub value: String,
}

pub fn recap_rows(d: &Draft, platform: &str) -> Vec<RecapRow> {
    let mut rows = Vec::new();
    let mut add = |label: &str, value: String| {
        rows.push(RecapRow {
            label: label.into(),
            value,
        })
    };
    if let Some(b) = &d.backend {
        add(
            "Data",
            if b == "embedded" {
                "On this phone"
            } else {
                "Your own server"
            }
            .into(),
        );
    }
    if let Some(n) = d.household_size.filter(|n| *n != 0) {
        add(
            "Household",
            format!("{n} {}", if n == 1 { "person" } else { "people" }),
        );
    }
    if let Some(c) = d.chains.as_ref().filter(|c| !c.is_empty()) {
        add(
            "Stores",
            c.iter()
                .map(|x| chain_name(x))
                .collect::<Vec<_>>()
                .join(", "),
        );
    }
    if let Some(p) = d.postal_code.as_ref().filter(|p| !p.is_empty()) {
        add("Postal code", p.clone());
    }
    if let Some(p) = d.payday.filter(|p| *p != 0) {
        add(
            "Payday",
            if p == 1 {
                "Calendar month".into()
            } else {
                format!("Day {p}")
            },
        );
    }
    if let Some(level) = d
        .intensity
        .as_deref()
        .and_then(|i| INTENSITIES.iter().find(|x| x.0 == i))
    {
        add("Saving level", level.1.into());
    }
    if let Some(daily) = d.daily_allowance_cents {
        add("Grocery goal", format!("{} a day", format_cents(daily)));
    } else if let Some(b) = d.grocery_budget_cents {
        add(
            "Grocery budget",
            format!(
                "{} {}",
                format_cents(b),
                if d.grocery_cadence.as_deref() == Some("weekly") {
                    "a week"
                } else {
                    "a month"
                }
            ),
        );
    }
    if let Some(h) = d.habit_mode.as_deref() {
        add(
            "Learning your items",
            match h {
                "manual" => "My own list",
                "receipts" => "Receipts",
                _ => "Spending only",
            }
            .into(),
        );
    }
    if d.demo_loaded == Some(true) {
        add("Bookings", "Demo data (labelled DEMO)".into());
    } else if d.csv_imported.unwrap_or(0) > 0 {
        add(
            "Bookings",
            format!("{} imported from CSV", d.csv_imported.unwrap_or(0)),
        );
    }
    if platform != "web" {
        if d.lock_on == Some(true) {
            add("App lock", "On".into());
        }
        if let Some(k) = d.notify_kinds.as_ref().filter(|k| !k.is_empty()) {
            add("Reminders", format!("{} on", k.len()));
        }
    }
    rows
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FirstQuest {
    pub title: &'static str,
    pub hint: &'static str,
    pub route: &'static str,
}

/// With bookings in the app the next useful thing is planning the week; without, adding bookings.
pub fn first_quest(d: &Draft) -> FirstQuest {
    if d.demo_loaded == Some(true) || d.csv_imported.unwrap_or(0) > 0 {
        FirstQuest {
            title: "Plan this week",
            hint: "Pick meals and see what the shop costs at your stores.",
            route: "/mealplan",
        }
    } else {
        FirstQuest {
            title: "Add your first transaction",
            hint: "Import a CSV or sync your bank so Today has numbers.",
            route: "/spending",
        }
    }
}

// ---- should the app show the setup? ----

#[derive(Debug, Clone, Deserialize)]
pub struct Stored {
    pub done: bool,
    #[serde(default)]
    pub state: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    #[serde(default)]
    pub stored: Option<Stored>,
    pub api_loaded: bool,
    pub configured: bool,
    pub on_onboarding: bool,
}

/// First run shows the setup; afterwards never, unless replayed from Settings. Someone who already
/// set the app up before this feature existed is not forced through it: the flag is set silently. A
/// setup that was started and not finished is resumed, even if the connection was saved on the way.
pub fn entry_action(i: &EntryInput) -> &'static str {
    let Some(stored) = &i.stored else {
        return "wait";
    };
    if !i.api_loaded {
        return "wait";
    }
    if stored.done || i.on_onboarding {
        return "stay";
    }
    if stored.state.as_ref().is_some_and(|s| !s.is_null()) {
        return "redirect";
    }
    if i.configured {
        "mark_done"
    } else {
        "redirect"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn steps(platform: &str) -> Vec<String> {
        steps_for(platform).into_iter().map(String::from).collect()
    }

    #[test]
    fn the_browser_has_no_safety_step_and_steps_move_both_ways() {
        assert_eq!(steps("web").len(), 7);
        assert_eq!(steps("ios").len(), 8);
        let s = steps("ios");
        assert_eq!(next_step(&s, "welcome").as_deref(), Some("data"));
        assert_eq!(next_step(&s, "finish"), None);
        assert_eq!(next_step(&s, "nope"), None);
        assert_eq!(previous_step(&s, "welcome"), None);
        assert_eq!(previous_step(&s, "data").as_deref(), Some("welcome"));
        assert_eq!(
            progress_of(&s, "welcome"),
            Progress {
                index: 0,
                total: 8,
                fraction: 0.0
            }
        );
        assert_eq!(progress_of(&s, "finish").fraction, 1.0);
        assert_eq!(
            resolve_step(&steps("web"), "safety"),
            "finish",
            "a step this build lacks moves on"
        );
        assert_eq!(resolve_step(&s, "money"), "money");
    }

    #[test]
    fn a_stored_draft_keeps_only_what_is_well_formed() {
        let d = sanitize_draft(
            &json!({ "backend": "embedded", "householdSize": 3, "groceryBudgetCents": 0, "chains": ["rewe", "x", "lidl"], "postalCode": "10115", "payday": 29, "intensity": "serious", "demoLoaded": false, "csvImported": 12, "lockOn": true, "notifyKinds": ["a", 1, "b"] }),
        );
        assert_eq!(
            (
                d.backend.as_deref(),
                d.household_size,
                d.grocery_budget_cents,
                d.payday
            ),
            (Some("embedded"), Some(3), None, None)
        );
        assert_eq!(
            d.chains,
            Some(vec!["lidl".into(), "rewe".into()]),
            "known stores, in the usual order"
        );
        assert_eq!(
            (
                d.postal_code.as_deref(),
                d.intensity.as_deref(),
                d.demo_loaded,
                d.csv_imported,
                d.lock_on
            ),
            (Some("10115"), Some("serious"), None, Some(12), Some(true))
        );
        assert_eq!(d.notify_kinds, Some(vec!["a".into(), "b".into()]));
        assert_eq!(sanitize_draft(&json!("junk")), Draft::default());
        assert_eq!(
            parse_state(Some(r#"{"v":1,"step":"data","draft":{"householdSize":2}}"#))
                .unwrap()
                .draft
                .household_size,
            Some(2)
        );
        assert_eq!(parse_state(Some(r#"{"v":2,"step":"data"}"#)), None);
        assert_eq!(parse_state(Some(r#"{"v":1,"step":"zzz"}"#)), None);
        assert_eq!(parse_state(Some("{")), None);
    }

    #[test]
    fn typed_values_are_understood_or_explained() {
        assert_eq!(clamp_household(0.0), 1);
        assert_eq!(clamp_household(99.0), 8);
        assert_eq!(clamp_household(f64::NAN), 1);
        assert_eq!(parse_postal_code(""), ok(None));
        assert_eq!(parse_postal_code(" 10115 "), ok(Some("10115".into())));
        assert!(matches!(parse_postal_code("1011"), Parsed::Err { .. }));
        assert_eq!(parse_budget(""), ok(None));
        assert_eq!(parse_budget("60"), ok(Some(6000)));
        assert_eq!(parse_budget("59,90"), ok(Some(5990)));
        assert_eq!(
            parse_budget("59.90"),
            ok(Some(5990)),
            "a phone keyboard's decimal point"
        );
        assert_eq!(parse_budget("0"), err("The budget has to be more than 0."));
        assert_eq!(
            parse_budget("abc"),
            err("Enter an amount like 60 or 59,90.")
        );
        assert_eq!(
            parse_budget("20000"),
            err("That is more than 10.000 EUR. Check the amount.")
        );
        assert_eq!(
            (
                monthly_grocery_cents(1000, "weekly"),
                monthly_grocery_cents(1000, "monthly")
            ),
            (4333, 1000)
        );
    }

    #[test]
    fn a_server_address_is_checked_before_the_test() {
        let v = |u: &str, t: &str| validate_server(u, t);
        assert_eq!(
            v("", "t").error.as_deref(),
            Some("Enter the address of your server.")
        );
        assert_eq!(
            v("not a url", "t").error.as_deref(),
            Some("That does not look like an address. Start with https://")
        );
        assert_eq!(
            v("ftp://x.test", "t").error.as_deref(),
            Some("The address has to start with https:// (or http:// on your own network).")
        );
        assert_eq!(
            v("https://x.test", " ").error.as_deref(),
            Some("Enter the API token you set on the server.")
        );
        assert_eq!(
            v("https://x.test///", "t"),
            ServerCheck {
                ok: true,
                error: None,
                warning: None,
                normalized: "https://x.test".into()
            }
        );
        assert!(v("http://example.com", "t").warning.is_some());
        for local in [
            "http://localhost:8080",
            "http://192.168.1.5",
            "http://10.0.0.2",
            "http://172.16.0.1",
            "http://nas.local",
            "http://127.0.0.1",
        ] {
            assert_eq!(v(local, "t").warning, None, "{local}");
        }
        assert!(v("http://172.32.0.1", "t").warning.is_some());
    }

    #[test]
    fn a_level_turns_into_a_daily_allowance() {
        let a = |intensity: &str, size: Option<f64>, budget: Option<i64>, cadence: Option<&str>| {
            suggest_allowance(&AllowanceArgs {
                intensity: intensity.into(),
                household_size: size,
                grocery_budget_cents: budget,
                grocery_cadence: cadence.map(String::from),
            })
        };
        assert_eq!(a("casual", None, None, None), 650);
        assert_eq!(a("regular", Some(2.0), None, None), 1020); // 650 * 1.85 * 0.85, rounded to 10 cents
        assert_eq!(a("serious", Some(1.0), Some(30000), Some("monthly")), 690);
        assert!(a("casual", None, Some(100), None) >= MIN_ALLOWANCE_CENTS);
        assert!((household_factor(3.0) - 2.7).abs() < 1e-9);
    }

    #[test]
    fn the_limit_follows_the_allowance_or_the_budget() {
        let d = Draft {
            daily_allowance_cents: Some(700),
            payday: Some(25),
            ..Draft::default()
        };
        assert_eq!(grocery_limit_for(&d, "2026-10-11").unwrap(), Some(700 * 30));
        let b = Draft {
            grocery_budget_cents: Some(1000),
            grocery_cadence: Some("weekly".into()),
            ..Draft::default()
        };
        assert_eq!(grocery_limit_for(&b, "2026-10-11").unwrap(), Some(4333));
        assert_eq!(
            grocery_limit_for(&Draft::default(), "2026-10-11").unwrap(),
            None
        );
        let existing = [
            Envelope {
                category: "dining".into(),
                limit_cents: 5000,
            },
            Envelope {
                category: "groceries".into(),
                limit_cents: 1,
            },
        ];
        let plan = plan_apply(&d, "2026-10-11", &existing).unwrap();
        assert_eq!(plan.payday, Some(25));
        assert_eq!(
            plan.envelopes.unwrap(),
            vec![
                Envelope {
                    category: "dining".into(),
                    limit_cents: 5000
                },
                Envelope {
                    category: "groceries".into(),
                    limit_cents: 21000
                }
            ]
        );
        assert_eq!(
            plan_apply(&Draft::default(), "2026-10-11", &existing)
                .unwrap()
                .envelopes,
            None
        );
    }

    #[test]
    fn the_profile_outlives_the_setup() {
        let p = parse_profile(Some(
            r#"{"householdSize":2,"chains":["aldi"],"postalCode":"10115","payday":5}"#,
        ));
        assert_eq!(
            (p.household_size, p.chains.clone(), p.postal_code.clone()),
            (Some(2), Some(vec!["aldi".into()]), Some("10115".into()))
        );
        assert_eq!(parse_profile(Some("{")), Profile::default());
        let merged = merge_profile(
            &p,
            &Draft {
                household_size: Some(4),
                ..Draft::default()
            },
        );
        assert_eq!(
            (merged.household_size, merged.chains, merged.postal_code),
            (Some(4), Some(vec!["aldi".into()]), Some("10115".into()))
        );
    }

    #[test]
    fn the_mascot_answers_what_was_chosen() {
        let m = |step: &str, d: Draft| mascot_for(step, &d, true);
        assert_eq!(m("welcome", Draft::default()).mood, "happy");
        assert_eq!(
            m(
                "data",
                Draft {
                    backend: Some("embedded".into()),
                    ..Draft::default()
                }
            )
            .mood,
            "cheer"
        );
        assert!(mascot_for("data", &Draft::default(), false)
            .message
            .contains("talks to a server"));
        assert_eq!(
            m(
                "household",
                Draft {
                    household_size: Some(1),
                    ..Draft::default()
                }
            )
            .message,
            "Cooking for one. Easy to plan!"
        );
        assert_eq!(
            m(
                "household",
                Draft {
                    household_size: Some(3),
                    chains: Some(vec!["lidl".into(), "aldi".into()]),
                    ..Draft::default()
                }
            )
            .message,
            "2 stores for 3 people. I'll compare prices there first."
        );
        assert_eq!(
            m(
                "household",
                Draft {
                    household_size: Some(1),
                    chains: Some(vec!["rewe".into()]),
                    ..Draft::default()
                }
            )
            .message,
            "Rewe for one. I'll compare prices there first."
        );
        assert_eq!(
            m(
                "rhythm",
                Draft {
                    intensity: Some("serious".into()),
                    daily_allowance_cents: Some(450),
                    ..Draft::default()
                }
            )
            .message,
            "Serious! 4,50 € a day. I'll cheer every day you stay under."
        );
        assert_eq!(
            m(
                "habits",
                Draft {
                    habit_mode: Some("receipts".into()),
                    ..Draft::default()
                }
            )
            .mood,
            "cheer"
        );
        assert!(m(
            "money",
            Draft {
                demo_loaded: Some(true),
                ..Draft::default()
            }
        )
        .message
        .contains("DEMO"));
        assert_eq!(
            m("finish", Draft::default()).message,
            "All set! Your first quest is waiting."
        );
    }

    #[test]
    fn the_recap_lists_the_answers_and_the_first_quest_follows_the_bookings() {
        let d = Draft {
            backend: Some("server".into()),
            household_size: Some(2),
            chains: Some(vec!["lidl".into(), "rewe".into()]),
            payday: Some(25),
            intensity: Some("regular".into()),
            daily_allowance_cents: Some(850),
            habit_mode: Some("manual".into()),
            csv_imported: Some(12),
            lock_on: Some(true),
            notify_kinds: Some(vec!["evening".into()]),
            ..Draft::default()
        };
        let rows: Vec<(String, String)> = recap_rows(&d, "ios")
            .into_iter()
            .map(|r| (r.label, r.value))
            .collect();
        assert_eq!(rows[0], ("Data".into(), "Your own server".into()));
        assert!(rows.contains(&("Stores".into(), "Lidl, Rewe".into())));
        assert!(rows.contains(&("Payday".into(), "Day 25".into())));
        assert!(rows.contains(&("Grocery goal".into(), "8,50 € a day".into())));
        assert!(rows.contains(&("Bookings".into(), "12 imported from CSV".into())));
        assert!(rows.contains(&("Reminders".into(), "1 on".into())));
        assert!(!recap_rows(&d, "web").iter().any(|r| r.label == "App lock"));
        assert_eq!(first_quest(&d).route, "/mealplan");
        assert_eq!(first_quest(&Draft::default()).route, "/spending");
    }

    #[test]
    fn the_setup_is_shown_once_and_resumed_when_unfinished() {
        let e = |stored: Option<Stored>, loaded: bool, configured: bool, on: bool| {
            entry_action(&EntryInput {
                stored,
                api_loaded: loaded,
                configured,
                on_onboarding: on,
            })
        };
        let s = |done: bool, state: Option<Value>| Some(Stored { done, state });
        assert_eq!(e(None, true, false, false), "wait");
        assert_eq!(e(s(false, None), false, false, false), "wait");
        assert_eq!(e(s(true, None), true, false, false), "stay");
        assert_eq!(e(s(false, None), true, false, true), "stay");
        assert_eq!(
            e(s(false, Some(json!({ "step": "data" }))), true, true, false),
            "redirect"
        );
        assert_eq!(e(s(false, None), true, true, false), "mark_done");
        assert_eq!(e(s(false, None), true, false, false), "redirect");
    }
}
