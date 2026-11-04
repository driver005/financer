//! Data and geometry for the pictures: the sparkline and bars of the spending screens and the
//! spending curve, the last seven days and the split by category on Today. Every picture comes
//! with a sentence (the `*_summary` functions) so it never is the only place the information lives.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::calendar::{day_number, from_day_number};
use crate::format::{format_date, format_money};

#[derive(Deserialize)]
pub struct Tx {
    pub booking_date: String,
    pub amount_cents: i64,
    #[serde(default)]
    pub category: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Span {
    pub start: String,
    pub end: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// JavaScript's `Math.round`: halves go up.
fn js_round(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

fn percent(now: i64, before: i64) -> Option<i64> {
    (before > 0).then(|| js_round((now - before) as f64 / before as f64 * 100.0))
}

fn money(cents: i64) -> String {
    format_money(cents, false)
}

fn category_label(category: &str) -> String {
    let mut c = category.chars();
    match c.next() {
        None => "Uncategorized".into(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

// ---- the spending trend (sparkline) ----

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpendingTrend {
    /// Cents spent per day, oldest first, `days` long. Refunds and income do not count.
    pub series: Vec<i64>,
    /// First day of the series (`YYYY-MM-DD`).
    pub from: String,
    pub total: i64,
    /// Total of the `days` days right before the series.
    pub previous_total: i64,
    /// Change against the previous window in whole percent; `None` when there is nothing to compare with.
    pub delta_percent: Option<i64>,
    /// Index of the most expensive day in the series; `None` when nothing was spent.
    pub peak: Option<usize>,
}

/// Spending per day over the last `days` days up to and including `today`, and the window before it.
pub fn spending_trend(txs: &[Tx], today: &str, days: i64) -> Result<SpendingTrend, String> {
    let end = day_number(today)?;
    let start = end - (days - 1);
    let prev_start = start - days;
    let mut series = vec![0i64; days.max(0) as usize];
    let mut previous_total = 0;
    for t in txs.iter().filter(|t| t.amount_cents < 0) {
        let d = day_number(&t.booking_date)?;
        if d >= start && d <= end {
            series[(d - start) as usize] += -t.amount_cents;
        } else if d >= prev_start && d < start {
            previous_total += -t.amount_cents;
        }
    }
    let total: i64 = series.iter().sum();
    let max = series.iter().copied().max().unwrap_or(0);
    Ok(SpendingTrend {
        from: from_day_number(start)?,
        total,
        previous_total,
        delta_percent: percent(total, previous_total),
        peak: (max > 0).then(|| series.iter().position(|v| *v == max).unwrap_or(0)),
        series,
    })
}

/// One sentence for the spending chart, e.g. `Spent 412,30 € in the last 14 days, 12 % less than the 14 days before.`
pub fn trend_summary(t: &SpendingTrend, days: i64) -> String {
    if t.total == 0 {
        return format!("Nothing spent in the last {days} days.");
    }
    let base = format!("Spent {} in the last {days} days", money(t.total));
    match t.delta_percent {
        None => format!("{base}."),
        Some(0) => format!("{base}, the same as the {days} days before."),
        Some(p) => format!(
            "{base}, {} % {} than the {days} days before.",
            p.abs(),
            if p > 0 { "more" } else { "less" }
        ),
    }
}

/// The day with the highest spend as text, or `None`.
pub fn peak_text(t: &SpendingTrend) -> Result<Option<String>, String> {
    let Some(peak) = t.peak else {
        return Ok(None);
    };
    let day = from_day_number(day_number(&t.from)? + peak as i64)?;
    Ok(Some(format!(
        "Most on {}: {}",
        format_date(&day),
        money(t.series[peak])
    )))
}

#[derive(Deserialize, Serialize, Debug, PartialEq)]
pub struct CategoryCompare {
    pub category: String,
    pub current: i64,
    pub previous: i64,
}

#[derive(Deserialize)]
pub struct Spent {
    pub category: String,
    pub spent_cents: i64,
}

/// The `limit` categories with the highest spend this or last period, for a grouped bar chart.
pub fn top_categories(current: &[Spent], previous: &[Spent], limit: usize) -> Vec<CategoryCompare> {
    // first seen first, as the rows were handed in
    let mut rows: Vec<CategoryCompare> = vec![];
    for c in current {
        match rows.iter_mut().find(|r| r.category == c.category) {
            Some(r) => {
                r.current = c.spent_cents;
                r.previous = 0;
            }
            None => rows.push(CategoryCompare {
                category: c.category.clone(),
                current: c.spent_cents,
                previous: 0,
            }),
        }
    }
    for p in previous {
        match rows.iter_mut().find(|r| r.category == p.category) {
            Some(r) => r.previous = p.spent_cents,
            None => rows.push(CategoryCompare {
                category: p.category.clone(),
                current: 0,
                previous: p.spent_cents,
            }),
        }
    }
    rows.retain(|r| r.current > 0 || r.previous > 0);
    // a stable sort keeps the hand-in order between equals
    rows.sort_by_key(|r| std::cmp::Reverse(r.current.max(r.previous)));
    rows.truncate(limit);
    rows
}

/// One sentence for the category comparison.
pub fn compare_summary(rows: &[CategoryCompare]) -> String {
    if rows.is_empty() {
        return "No spending against your limits yet.".into();
    }
    let cur: i64 = rows.iter().map(|r| r.current).sum();
    let prev: i64 = rows.iter().map(|r| r.previous).sum();
    let parts: Vec<String> = rows
        .iter()
        .map(|r| {
            format!(
                "{} {} (before {})",
                r.category,
                money(r.current),
                money(r.previous)
            )
        })
        .collect();
    format!(
        "Top categories, this period against last: {}. Together {} against {}.",
        parts.join(", "),
        money(cur),
        money(prev)
    )
}

// ---- Today ----

/// Money that left the account for something bought: not income, not a transfer to savings.
pub fn is_spend(t: &Tx) -> bool {
    t.amount_cents < 0
        && t.category.as_deref() != Some("savings")
        && t.category.as_deref() != Some("income")
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PeriodCurve {
    /// Days in the period, both ends included.
    pub days: i64,
    /// Index (0-based) of today inside the period, clamped to `0..days-1`.
    pub today_index: i64,
    /// Cents spent in total up to and including each day, from the first day to today.
    pub cumulative: Vec<i64>,
    /// Spent in the period up to today.
    pub spent: i64,
    /// Where the period is expected to end: `spent` plus what is still planned. `None` without a forecast.
    pub projected_end: Option<i64>,
}

/// The running total of spending from the first day of the period to `today`. `still_to_come` is the
/// money the forecast expects on top (fixed costs still due plus the pace of everyday spending);
/// without it the curve has no projected end.
pub fn period_curve(
    txs: &[Tx],
    period: &Span,
    today: &str,
    still_to_come: Option<i64>,
) -> Result<PeriodCurve, String> {
    let start = day_number(&period.start)?;
    let days = (day_number(&period.end)? - start + 1).max(1);
    let today_index = (day_number(today)? - start).clamp(0, days - 1);
    let mut per_day = vec![0i64; today_index as usize + 1];
    for t in txs.iter().filter(|t| is_spend(t)) {
        let i = day_number(&t.booking_date)? - start;
        if i >= 0 && i <= today_index {
            per_day[i as usize] += -t.amount_cents;
        }
    }
    let mut run = 0;
    let cumulative: Vec<i64> = per_day
        .iter()
        .map(|v| {
            run += v;
            run
        })
        .collect();
    let spent = cumulative.last().copied().unwrap_or(0);
    Ok(PeriodCurve {
        days,
        today_index,
        cumulative,
        spent,
        projected_end: still_to_come.map(|s| spent + s.max(0)),
    })
}

#[derive(Serialize, Debug, PartialEq)]
pub struct CurveGeometry {
    /// The solid line, first day to today.
    pub solid: Vec<Point>,
    /// From today to the projected end of the period; empty without a projection.
    pub dashed: Vec<Point>,
    pub today: Point,
}

/// Points for `curve` in a `width` x `height` box. The y axis starts at 0 and ends at the larger
/// of the spending so far and the projected end, so the dashed part always fits. The x axis is
/// the whole period, so the curve visibly stops at today.
pub fn curve_geometry(curve: &PeriodCurve, width: f64, height: f64, pad: f64) -> CurveGeometry {
    let top = curve.spent.max(curve.projected_end.unwrap_or(0)).max(1) as f64;
    let inner_w = (width - pad * 2.0).max(0.0);
    let inner_h = (height - pad * 2.0).max(0.0);
    let x = |i: i64| {
        pad + if curve.days == 1 {
            inner_w / 2.0
        } else {
            inner_w * i as f64 / (curve.days - 1) as f64
        }
    };
    let y = |cents: i64| pad + inner_h - inner_h * cents.max(0) as f64 / top;
    let solid: Vec<Point> = curve
        .cumulative
        .iter()
        .enumerate()
        .map(|(i, c)| Point {
            x: x(i as i64),
            y: y(*c),
        })
        .collect();
    let today = solid.last().copied().unwrap_or(Point { x: x(0), y: y(0) });
    let dashed = match curve.projected_end {
        Some(end) if curve.today_index < curve.days - 1 => vec![
            today,
            Point {
                x: x(curve.days - 1),
                y: y(end),
            },
        ],
        _ => vec![],
    };
    CurveGeometry {
        solid,
        dashed,
        today,
    }
}

/// One sentence for the curve.
pub fn curve_summary(curve: &PeriodCurve) -> String {
    let so = format!(
        "Spent {} in the first {} of {} days of this period",
        money(curve.spent),
        curve.today_index + 1,
        curve.days
    );
    match curve.projected_end {
        None => format!("{so}."),
        Some(end) => format!("{so}; at this pace about {} by the end.", money(end)),
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpendComparison {
    /// Spent in the first `days` days of the period.
    pub current: i64,
    /// Spent in the first `days` days of the period before.
    pub previous: i64,
    /// Whole percent against the period before at the same point; `None` when it had nothing to compare.
    pub delta_percent: Option<i64>,
    pub days: i64,
}

/// Spending so far against the same number of days of the previous period, so a half-finished month
/// is not compared with a whole one. `previous` is the period right before `period`.
pub fn spend_comparison(
    txs: &[Tx],
    period: &Span,
    previous: &Span,
    today: &str,
) -> Result<SpendComparison, String> {
    let start = day_number(&period.start)?;
    let days = (day_number(today)? - start + 1)
        .min(day_number(&period.end)? - start + 1)
        .max(1);
    let sum_first = |span: &Span| -> Result<i64, String> {
        let from = day_number(&span.start)?;
        let to = (from + days - 1).min(day_number(&span.end)?);
        let mut total = 0;
        for t in txs.iter().filter(|t| is_spend(t)) {
            let d = day_number(&t.booking_date)?;
            if d >= from && d <= to {
                total += -t.amount_cents;
            }
        }
        Ok(total)
    };
    let current = sum_first(period)?;
    let prev = sum_first(previous)?;
    Ok(SpendComparison {
        current,
        previous: prev,
        delta_percent: percent(current, prev),
        days,
    })
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Week {
    pub bars: Vec<WeekBar>,
    pub total: i64,
    /// Total of the seven days before.
    pub previous_total: i64,
    /// Whole percent against the seven days before; `None` when there is nothing to compare with.
    pub delta_percent: Option<i64>,
    /// Average per day over the seven days.
    pub average: i64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct WeekBar {
    pub iso: String,
    pub letter: String,
    pub cents: i64,
    pub today: bool,
}

const LETTERS: [&str; 7] = ["S", "M", "T", "W", "T", "F", "S"];

/// Spending of the last seven days up to and including `today`, oldest first.
pub fn last_week(txs: &[Tx], today: &str) -> Result<Week, String> {
    let end = day_number(today)?;
    let start = end - 6;
    let prev_start = start - 7;
    let mut cents = [0i64; 7];
    let mut previous_total = 0;
    for t in txs.iter().filter(|t| is_spend(t)) {
        let d = day_number(&t.booking_date)?;
        if d >= start && d <= end {
            cents[(d - start) as usize] += -t.amount_cents;
        } else if d >= prev_start && d < start {
            previous_total += -t.amount_cents;
        }
    }
    let total: i64 = cents.iter().sum();
    let mut bars = vec![];
    for (i, c) in cents.iter().enumerate() {
        let d = start + i as i64;
        bars.push(WeekBar {
            iso: from_day_number(d)?,
            // day 0 (1970-01-01) was a Thursday; JavaScript counts Sunday as 0
            letter: LETTERS[(d + 4).rem_euclid(7) as usize].into(),
            cents: *c,
            today: i == 6,
        });
    }
    Ok(Week {
        bars,
        total,
        previous_total,
        delta_percent: percent(total, previous_total),
        average: js_round(total as f64 / 7.0),
    })
}

/// One sentence for the week chart.
pub fn week_summary(w: &Week) -> String {
    if w.total == 0 {
        return "Nothing spent in the last 7 days.".into();
    }
    let base = format!(
        "Spent {} in the last 7 days, {} a day",
        money(w.total),
        money(w.average)
    );
    match w.delta_percent {
        None => format!("{base}."),
        Some(0) => format!("{base}, the same as the 7 days before."),
        Some(p) => format!(
            "{base}, {} % {} than the 7 days before.",
            p.abs(),
            if p > 0 { "more" } else { "less" }
        ),
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct Share {
    pub category: String,
    pub label: String,
    pub cents: i64,
    pub share: f64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Shares {
    pub total: i64,
    pub shares: Vec<Share>,
}

/// What the period's spending went to: the biggest categories, the rest folded into `Other`.
pub fn category_shares(txs: &[Tx], period: &Span, limit: usize) -> Shares {
    let mut sums: BTreeMap<String, i64> = BTreeMap::new();
    for t in txs.iter().filter(|t| is_spend(t)) {
        if t.booking_date < period.start || t.booking_date > period.end {
            continue;
        }
        let key = t
            .category
            .clone()
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| "other".into());
        *sums.entry(key).or_insert(0) += -t.amount_cents;
    }
    let total: i64 = sums.values().sum();
    if total == 0 {
        return Shares {
            total: 0,
            shares: vec![],
        };
    }
    let mut sorted: Vec<(String, i64)> = sums.into_iter().collect(); // by name already
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let row = |category: &str, cents: i64| Share {
        category: category.into(),
        label: category_label(category),
        cents,
        share: cents as f64 / total as f64,
    };
    if sorted.len() <= limit {
        return Shares {
            total,
            shares: sorted.iter().map(|(c, v)| row(c, *v)).collect(),
        };
    }
    // too many: keep the biggest named ones and fold everything else (including "other") into "other"
    let head: Vec<&(String, i64)> = sorted
        .iter()
        .filter(|(c, _)| c != "other")
        .take(limit.saturating_sub(1).max(1))
        .collect();
    let rest_cents: i64 = sorted
        .iter()
        .filter(|(c, _)| !head.iter().any(|(h, _)| h == c))
        .map(|(_, v)| v)
        .sum();
    let mut shares: Vec<Share> = head.iter().map(|(c, v)| row(c, *v)).collect();
    shares.push(row("other", rest_cents));
    Shares { total, shares }
}

/// One sentence for the donut.
pub fn shares_summary(total: i64, shares: &[Share]) -> String {
    if shares.is_empty() {
        return "No spending in this period yet.".into();
    }
    let parts: Vec<String> = shares
        .iter()
        .map(|s| format!("{} {} %", s.label, js_round(s.share * 100.0)))
        .collect();
    format!("Spent {} this period: {}.", money(total), parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tx(date: &str, cents: i64, category: Option<&str>) -> Tx {
        Tx {
            booking_date: date.into(),
            amount_cents: cents,
            category: category.map(str::to_string),
        }
    }

    #[test]
    fn the_trend_counts_expenses_only_and_finds_the_peak() {
        let txs = [
            tx("2026-11-03", -500, None),
            tx("2026-11-04", -1500, None),
            tx("2026-11-04", 9000, None),
            tx("2026-10-30", -1000, None),
        ];
        let t = spending_trend(&txs, "2026-11-04", 3).unwrap();
        assert_eq!(
            (t.series.as_slice(), t.total, t.previous_total, t.peak),
            (&[0, 500, 1500][..], 2000, 1000, Some(2))
        );
        assert_eq!(t.from, "2026-11-02");
        assert_eq!(t.delta_percent, Some(100));
        assert!(trend_summary(&t, 3).ends_with("100 % more than the 3 days before."));
    }

    #[test]
    fn the_curve_stops_at_today_and_dashes_to_the_end() {
        let txs = [
            tx("2026-11-02", -1000, None),
            tx("2026-11-03", -500, Some("savings")),
            tx("2026-11-04", -250, None),
        ];
        let period = Span {
            start: "2026-11-01".into(),
            end: "2026-11-10".into(),
        };
        let c = period_curve(&txs, &period, "2026-11-04", Some(1000)).unwrap();
        assert_eq!(
            (c.days, c.today_index, c.spent, c.projected_end),
            (10, 3, 1250, Some(2250))
        );
        assert_eq!(c.cumulative, [0, 1000, 1000, 1250]);
        let g = curve_geometry(&c, 104.0, 54.0, 4.0);
        assert_eq!(g.solid.len(), 4);
        assert_eq!(g.dashed.len(), 2);
        assert_eq!(g.dashed[1].x, 100.0);
    }

    #[test]
    fn a_week_has_seven_bars_ending_today() {
        let w = last_week(&[tx("2026-11-04", -700, None)], "2026-11-04").unwrap();
        assert_eq!(w.bars.len(), 7);
        assert_eq!(
            (
                w.bars[6].iso.as_str(),
                w.bars[6].letter.as_str(),
                w.bars[6].cents,
                w.bars[6].today
            ),
            ("2026-11-04", "W", 700, true)
        );
        assert_eq!(w.bars[0].iso, "2026-10-29");
        assert_eq!(w.average, 100);
    }

    #[test]
    fn small_categories_fold_into_other() {
        let period = Span {
            start: "2026-11-01".into(),
            end: "2026-11-30".into(),
        };
        let names = [
            "groceries",
            "dining",
            "transport",
            "housing",
            "health",
            "leisure",
        ];
        let txs: Vec<Tx> = names
            .iter()
            .enumerate()
            .map(|(i, n)| tx("2026-11-02", -((10 - i as i64) * 100), Some(n)))
            .collect();
        let s = category_shares(&txs, &period, 5);
        assert_eq!(s.shares.len(), 5);
        assert_eq!(s.shares[4].category, "other");
        assert_eq!(s.shares[0].label, "Groceries");
        assert_eq!(s.shares.iter().map(|x| x.cents).sum::<i64>(), s.total);
    }

    #[test]
    fn categories_are_ranked_by_the_larger_side() {
        let cur = [
            Spent {
                category: "a".into(),
                spent_cents: 100,
            },
            Spent {
                category: "b".into(),
                spent_cents: 0,
            },
        ];
        let prev = [
            Spent {
                category: "b".into(),
                spent_cents: 300,
            },
            Spent {
                category: "c".into(),
                spent_cents: 0,
            },
        ];
        let rows = top_categories(&cur, &prev, 5);
        assert_eq!(
            rows.iter().map(|r| r.category.as_str()).collect::<Vec<_>>(),
            ["b", "a"]
        );
    }
}
