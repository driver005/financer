//! Subscription watchdog: upcoming charges, price hikes, duplicates and stale subscriptions.
//!
//! It builds on the cadence logic of [`crate::recurring`] but looks at the whole history of a
//! merchant instead of only the median, because a price hike is exactly the case in which the
//! amounts stop being steady (and `RecurringDetector` then drops the payment).
//!
//! Only outgoing payments are watched. Every amount in this module is a positive charge size.

use std::collections::BTreeMap;

use serde::Serialize;
use time::{Date, Duration};

use crate::money::Money;
use crate::recurring::Cadence;
use crate::transaction::{NameNormalizer, Transaction};

/// Thresholds of the watchdog. `Default` is what the app uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WatchConfig {
    /// A new amount counts as a price hike when it is at least this many basis points
    /// (1/100 of a percent) above the old one. Default 300 (3%).
    pub hike_min_percent_bp: i64,
    /// ... and at least this many cents above it. Default 20.
    pub hike_min_cents: i64,
    /// Hikes that started longer ago than this are no longer reported. Default 365 days.
    pub hike_window_days: i64,
    /// Two subscriptions are duplicates only if their amounts differ by at most this many basis
    /// points of the larger one. Default 1500 (15%).
    pub duplicate_amount_tolerance_bp: i64,
}

impl Default for WatchConfig {
    fn default() -> Self {
        Self {
            hike_min_percent_bp: 300,
            hike_min_cents: 20,
            hike_window_days: 365,
            duplicate_amount_tolerance_bp: 1500,
        }
    }
}

/// A recurring outgoing payment found in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WatchedSubscription {
    pub counterparty: String,
    /// What one charge costs now (after a hike: the new price). Positive.
    pub amount: Money,
    pub cadence: Cadence,
    pub first_date: Date,
    pub last_date: Date,
    pub next_expected: Date,
    /// How many bookings the series is based on.
    pub occurrences: usize,
    /// 10 to 99: how sure we are that this is a real subscription on this rhythm.
    pub confidence: u8,
}

/// One expected charge in the calendar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpcomingCharge {
    pub date: Date,
    pub counterparty: String,
    pub amount: Money,
    pub cadence: Cadence,
    /// 10 to 99; falls for charges further in the future and for overdue ones.
    pub confidence: u8,
    /// The expected date has passed without a booking (it may just be late).
    pub overdue: bool,
}

/// The latest amount of a subscription is higher than the one before.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PriceHike {
    pub counterparty: String,
    pub cadence: Cadence,
    pub old_amount: Money,
    pub new_amount: Money,
    pub delta: Money,
    /// Increase in basis points of the old amount (1250 is +12.5%).
    pub percent_bp: i64,
    /// First booking at the new price.
    pub since: Date,
}

/// Why two subscriptions are listed as possible duplicates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateReason {
    /// The same merchant is billed twice on the same rhythm for a similar amount.
    SameMerchant,
    /// Two merchants with very similar names, on the same rhythm for a similar amount.
    SimilarMerchant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DuplicateSubscription {
    pub reason: DuplicateReason,
    pub first: WatchedSubscription,
    pub second: WatchedSubscription,
}

/// A subscription that stopped: cancelled, paused, or moved to another account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StaleSubscription {
    pub subscription: WatchedSubscription,
    pub days_since_last: i64,
    /// How many expected charges did not arrive (at least 2).
    pub periods_missed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SubscriptionReport {
    pub as_of: Date,
    pub active: Vec<WatchedSubscription>,
    pub stale: Vec<StaleSubscription>,
    pub upcoming: Vec<UpcomingCharge>,
    pub price_hikes: Vec<PriceHike>,
    pub duplicates: Vec<DuplicateSubscription>,
}

/// A detected series plus the last price change inside it (kept internal).
#[derive(Debug, Clone)]
pub(crate) struct DetectedSeries {
    /// Normalized merchant name.
    pub(crate) key: String,
    pub(crate) subscription: WatchedSubscription,
    pub(crate) change: Option<PriceChange>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PriceChange {
    old: Money,
    new: Money,
    since: Date,
}

/// Groups bookings into runs of (nearly) the same amount.
struct Levels;

impl Levels {
    /// Index ranges `[start, end)` of consecutive bookings whose amount stays within 2% (or 10
    /// cents) of the booking before.
    fn runs(amounts: &[i64]) -> Vec<(usize, usize)> {
        let mut runs = Vec::new();
        let mut start = 0;
        for i in 1..amounts.len() {
            let prev = amounts[i - 1];
            if (amounts[i] - prev).abs() > (prev / 50).max(10) {
                runs.push((start, i));
                start = i;
            }
        }
        runs.push((start, amounts.len()));
        runs
    }

    fn median(values: &[i64]) -> i64 {
        let mut sorted = values.to_vec();
        sorted.sort_unstable();
        sorted[sorted.len() / 2]
    }
}

/// Merchant-name similarity for duplicate detection.
struct MerchantMatcher;

impl MerchantMatcher {
    /// `a` and `b` are normalized names. Similar: one name's words are all contained in the other
    /// (`netflix` / `netflix international`), or they differ by at most two typos.
    fn similar(a: &str, b: &str) -> bool {
        if a == b {
            return true;
        }
        let ta: Vec<&str> = a.split(' ').filter(|w| !w.is_empty()).collect();
        let tb: Vec<&str> = b.split(' ').filter(|w| !w.is_empty()).collect();
        if ta.is_empty() || tb.is_empty() {
            return false;
        }
        let (small, big) = if ta.len() <= tb.len() {
            (&ta, &tb)
        } else {
            (&tb, &ta)
        };
        if small.iter().map(|w| w.chars().count()).sum::<usize>() >= 4
            && small.iter().all(|w| big.contains(w))
        {
            return true;
        }
        a.chars().count().min(b.chars().count()) >= 5 && Self::edit_distance(a, b) <= 2
    }

    fn edit_distance(a: &str, b: &str) -> usize {
        let a: Vec<char> = a.chars().collect();
        let b: Vec<char> = b.chars().collect();
        let mut prev: Vec<usize> = (0..=b.len()).collect();
        for (i, ca) in a.iter().enumerate() {
            let mut cur = vec![i + 1];
            for (j, cb) in b.iter().enumerate() {
                let cost = usize::from(ca != cb);
                cur.push((prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1));
            }
            prev = cur;
        }
        prev[b.len()]
    }
}

pub struct SubscriptionWatch;

impl SubscriptionWatch {
    /// Build the full watchdog report. `horizon_days` is how far the calendar looks ahead.
    pub fn analyze(
        transactions: &[Transaction],
        as_of: Date,
        horizon_days: i64,
    ) -> SubscriptionReport {
        Self::analyze_with(transactions, as_of, horizon_days, &WatchConfig::default())
    }

    pub fn analyze_with(
        transactions: &[Transaction],
        as_of: Date,
        horizon_days: i64,
        config: &WatchConfig,
    ) -> SubscriptionReport {
        let end = as_of + Duration::days(horizon_days.max(0));
        let mut active = Vec::new();
        let mut stale = Vec::new();
        let mut upcoming = Vec::new();
        let mut price_hikes = Vec::new();

        for series in Self::detect_series(transactions) {
            let sub = &series.subscription;
            let missed = Self::periods_missed(sub, as_of);
            if missed >= 2 {
                let days_since_last = (as_of - sub.last_date).whole_days();
                // ancient history is not news
                if days_since_last <= (3 * sub.cadence.nominal_days()).max(400) {
                    stale.push(StaleSubscription {
                        subscription: sub.clone(),
                        days_since_last,
                        periods_missed: missed,
                    });
                }
                continue;
            }
            upcoming.extend(Self::calendar(sub, as_of, end));
            if let Some(hike) = Self::hike(&series, as_of, config) {
                price_hikes.push(hike);
            }
            active.push(sub.clone());
        }

        upcoming.sort_by(|a, b| (a.date, &a.counterparty).cmp(&(b.date, &b.counterparty)));
        price_hikes.sort_by(|a, b| {
            b.since
                .cmp(&a.since)
                .then(a.counterparty.cmp(&b.counterparty))
        });
        stale.sort_by(|a, b| {
            a.days_since_last.cmp(&b.days_since_last).then(
                a.subscription
                    .counterparty
                    .cmp(&b.subscription.counterparty),
            )
        });
        let duplicates = Self::duplicates(&active, config);
        SubscriptionReport {
            as_of,
            active,
            stale,
            upcoming,
            price_hikes,
            duplicates,
        }
    }

    /// All recurring outgoing payments, whether still running or not.
    pub(crate) fn detect_series(transactions: &[Transaction]) -> Vec<DetectedSeries> {
        let mut groups: BTreeMap<String, Vec<&Transaction>> = BTreeMap::new();
        for tx in transactions.iter().filter(|t| t.amount.is_negative()) {
            groups
                .entry(NameNormalizer::normalize(&tx.counterparty))
                .or_default()
                .push(tx);
        }
        let mut found = Vec::new();
        for (key, mut txs) in groups {
            txs.sort_by_key(|t| t.booking_date);
            if let Some(series) = Self::analyse_group(&key, &txs) {
                found.push(series);
                continue;
            }
            for part in Self::split_group(&txs) {
                if let Some(series) = Self::analyse_group(&key, &part) {
                    found.push(series);
                }
            }
        }
        found.sort_by(|a, b| {
            (&a.subscription.counterparty, a.subscription.amount)
                .cmp(&(&b.subscription.counterparty, b.subscription.amount))
        });
        found
    }

    /// A merchant that does not form one series may hide two: the same plan billed twice (the
    /// bookings alternate, so the gaps are half a period) or two price tiers. Try both.
    fn split_group<'a>(txs: &[&'a Transaction]) -> Vec<Vec<&'a Transaction>> {
        let mut parts: Vec<Vec<&Transaction>> = Vec::new();
        if txs.len() >= 6 {
            let mut gaps: Vec<i64> = txs
                .windows(2)
                .map(|w| (w[1].booking_date - w[0].booking_date).whole_days())
                .collect();
            gaps.sort_unstable();
            if Cadence::classify(gaps[gaps.len() / 2] * 2).is_some() {
                let even: Vec<_> = txs.iter().step_by(2).copied().collect();
                let odd: Vec<_> = txs.iter().skip(1).step_by(2).copied().collect();
                parts.push(even);
                parts.push(odd);
                return parts;
            }
        }
        let mut by_amount: BTreeMap<i64, Vec<&Transaction>> = BTreeMap::new();
        for tx in txs {
            by_amount.entry(tx.amount.cents()).or_default().push(tx);
        }
        parts.extend(by_amount.into_values().filter(|v| v.len() >= 3));
        parts
    }

    /// One merchant's bookings (oldest first) as a subscription series, if they form one.
    ///
    /// Same rule as `RecurringDetector` (three or more bookings, gaps around one cadence, amounts
    /// within 10% of the median), widened by one case: the amount may have stepped once (or twice
    /// in a long history) to a new level that is at most 2.5 times the old one.
    fn analyse_group(key: &str, txs: &[&Transaction]) -> Option<DetectedSeries> {
        let n = txs.len();
        if n < 3 {
            return None;
        }
        let mut gaps: Vec<i64> = txs
            .windows(2)
            .map(|w| (w[1].booking_date - w[0].booking_date).whole_days())
            .collect();
        gaps.sort_unstable();
        let cadence = Cadence::classify(gaps[gaps.len() / 2])?;

        let amounts: Vec<i64> = txs.iter().map(|t| t.amount.cents().abs()).collect();
        let median = Levels::median(&amounts);
        let steady = amounts.iter().all(|a| (a - median).abs() <= median / 10);

        let runs = Levels::runs(&amounts);
        let changes = runs.len() - 1;
        let min = *amounts.iter().min().expect("non-empty");
        let max = *amounts.iter().max().expect("non-empty");
        let stepped = changes >= 1 && changes <= (n / 3).max(1) && max * 2 <= min * 5;
        if !steady && !stepped {
            return None;
        }

        let (amount, change) = if stepped {
            let (start, end) = runs[runs.len() - 1];
            let (prev_start, prev_end) = runs[runs.len() - 2];
            (
                Levels::median(&amounts[start..end]),
                Some(PriceChange {
                    old: Money::from_cents(Levels::median(&amounts[prev_start..prev_end])),
                    new: Money::from_cents(Levels::median(&amounts[start..end])),
                    since: txs[start].booking_date,
                }),
            )
        } else {
            (median, None)
        };

        let last = txs[n - 1];
        Some(DetectedSeries {
            key: key.to_string(),
            subscription: WatchedSubscription {
                counterparty: last.counterparty.clone(),
                amount: Money::from_cents(amount),
                cadence,
                first_date: txs[0].booking_date,
                last_date: last.booking_date,
                next_expected: cadence.next_after(last.booking_date),
                occurrences: n,
                confidence: Self::confidence(cadence, txs, change.is_some()),
            },
            change,
        })
    }

    /// 55 for three bookings up to 92 for a long history; less for a rhythm that wobbles by days
    /// and for an amount that has stepped.
    fn confidence(cadence: Cadence, txs: &[&Transaction], stepped: bool) -> u8 {
        let base: i64 = match txs.len() {
            0..=3 => 55,
            4 => 65,
            5 => 75,
            6..=8 => 85,
            _ => 92,
        };
        let worst_drift = txs
            .windows(2)
            .map(|w| {
                let expected = cadence.next_after(w[0].booking_date);
                (w[1].booking_date - expected).whole_days().abs()
            })
            .max()
            .unwrap_or(0);
        let wobble = (3 * worst_drift).min(15);
        let step = if stepped { 10 } else { 0 };
        (base - wobble - step).clamp(10, 99) as u8
    }

    /// How many of the charges expected after the last booking are already in the past.
    fn periods_missed(sub: &WatchedSubscription, as_of: Date) -> u32 {
        let mut missed = 0;
        while missed < 1000
            && sub
                .cadence
                .occurrence_after(sub.last_date, missed as i32 + 1)
                < as_of
        {
            missed += 1;
        }
        missed
    }

    /// Expected charges of an active subscription in `[as_of, end]`, plus the late one if the
    /// next booking is overdue.
    fn calendar(sub: &WatchedSubscription, as_of: Date, end: Date) -> Vec<UpcomingCharge> {
        let mut out = Vec::new();
        for n in 1..=1000 {
            let date = sub.cadence.occurrence_after(sub.last_date, n);
            if date > end {
                break;
            }
            let overdue = date < as_of;
            if overdue && n > 1 {
                continue;
            }
            let penalty = 8 * i64::from(n - 1) + if overdue { 15 } else { 0 };
            out.push(UpcomingCharge {
                date,
                counterparty: sub.counterparty.clone(),
                amount: sub.amount,
                cadence: sub.cadence,
                confidence: (i64::from(sub.confidence) - penalty).clamp(10, 99) as u8,
                overdue,
            });
        }
        out
    }

    fn hike(series: &DetectedSeries, as_of: Date, config: &WatchConfig) -> Option<PriceHike> {
        let change = series.change?;
        let delta = change.new - change.old;
        if change.old.cents() <= 0
            || delta.cents() < config.hike_min_cents
            || delta.cents() * 10_000 < config.hike_min_percent_bp * change.old.cents()
            || (as_of - change.since).whole_days() > config.hike_window_days
        {
            return None;
        }
        Some(PriceHike {
            counterparty: series.subscription.counterparty.clone(),
            cadence: series.subscription.cadence,
            old_amount: change.old,
            new_amount: change.new,
            delta,
            percent_bp: delta.cents() * 10_000 / change.old.cents(),
            since: change.since,
        })
    }

    /// Pairs of active subscriptions on the same rhythm, with similar names and similar amounts.
    /// Stopped subscriptions are left out: an old plan replaced by a new one is a switch.
    fn duplicates(
        active: &[WatchedSubscription],
        config: &WatchConfig,
    ) -> Vec<DuplicateSubscription> {
        let keys: Vec<String> = active
            .iter()
            .map(|s| NameNormalizer::normalize(&s.counterparty))
            .collect();
        let mut out = Vec::new();
        for i in 0..active.len() {
            for j in (i + 1)..active.len() {
                let (a, b) = (&active[i], &active[j]);
                let larger = a.amount.cents().max(b.amount.cents());
                let close = (a.amount.cents() - b.amount.cents()).abs() * 10_000
                    <= config.duplicate_amount_tolerance_bp * larger;
                if a.cadence != b.cadence || !close || !MerchantMatcher::similar(&keys[i], &keys[j])
                {
                    continue;
                }
                out.push(DuplicateSubscription {
                    reason: if keys[i] == keys[j] {
                        DuplicateReason::SameMerchant
                    } else {
                        DuplicateReason::SimilarMerchant
                    },
                    first: a.clone(),
                    second: b.clone(),
                });
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recurring::RecurringDetector;
    use time::macros::date;

    struct Fixture;

    impl Fixture {
        fn tx(date: Date, who: &str, cents: i64) -> Transaction {
            Transaction {
                booking_date: date,
                amount: Money::from_cents(cents),
                counterparty: who.into(),
                purpose: String::new(),
                counterparty_iban: None,
                category: None,
            }
        }

        /// `amounts.len()` monthly bookings from `start`, each costing the matching amount.
        fn monthly(who: &str, start: Date, amounts: &[i64]) -> Vec<Transaction> {
            amounts
                .iter()
                .enumerate()
                .map(|(i, a)| Self::tx(Cadence::Monthly.occurrence_after(start, i as i32), who, -a))
                .collect()
        }
    }

    #[test]
    fn calendar_lists_the_next_charges_in_date_order() {
        let mut txs = Fixture::monthly("Netflix", date!(2026 - 07 - 05), &[1299, 1299, 1299]);
        txs.extend(Fixture::monthly(
            "Spotify",
            date!(2026 - 07 - 20),
            &[999, 999, 999],
        ));
        // as_of 2026-09-21: Netflix is due 5 Oct, Spotify 20 Oct, then 5 Nov, 20 Nov
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 09 - 21), 60);
        let listed: Vec<_> = report
            .upcoming
            .iter()
            .map(|u| (u.date, u.counterparty.as_str(), u.amount.cents()))
            .collect();
        assert_eq!(
            listed,
            vec![
                (date!(2026 - 10 - 05), "Netflix", 1299),
                (date!(2026 - 10 - 20), "Spotify", 999),
                (date!(2026 - 11 - 05), "Netflix", 1299),
                (date!(2026 - 11 - 20), "Spotify", 999),
            ]
        );
        assert!(report.upcoming.iter().all(|u| !u.overdue));
        // the first charge is surer than the one after it
        assert!(report.upcoming[0].confidence > report.upcoming[2].confidence);
    }

    #[test]
    fn calendar_keeps_the_day_of_month_after_a_short_month() {
        let txs = Fixture::monthly("Gym", date!(2026 - 10 - 31), &[2990, 2990, 2990]);
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 12 - 31), 120);
        let dates: Vec<_> = report.upcoming.iter().map(|u| u.date).collect();
        assert_eq!(
            dates,
            vec![
                date!(2027 - 01 - 31),
                date!(2027 - 02 - 28),
                date!(2027 - 03 - 31),
                date!(2027 - 04 - 30)
            ]
        );
    }

    #[test]
    fn annual_subscription_is_a_yearly_cadence_and_one_charge_in_the_calendar() {
        let txs = vec![
            Fixture::tx(date!(2024 - 11 - 20), "Amazon Prime", -8900),
            Fixture::tx(date!(2025 - 11 - 20), "Amazon Prime", -8900),
            Fixture::tx(date!(2026 - 11 - 20), "Amazon Prime", -8900),
        ];
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 12 - 01), 400);
        assert_eq!(report.active.len(), 1);
        assert_eq!(report.active[0].cadence, Cadence::Yearly);
        assert_eq!(report.upcoming.len(), 1);
        assert_eq!(report.upcoming[0].date, date!(2027 - 11 - 20));
        // a year after the last charge it is not "stale", just not due yet
        assert!(report.stale.is_empty());
        // two full years without a charge is stale
        let later = SubscriptionWatch::analyze(&txs, date!(2028 - 12 - 01), 30);
        assert_eq!(later.stale.len(), 1);
        assert!(later.upcoming.is_empty());
    }

    #[test]
    fn an_overdue_charge_is_flagged_but_one_missed_period_is_not_stale() {
        let txs = Fixture::monthly("Netflix", date!(2026 - 06 - 05), &[1299, 1299, 1299]);
        // due 5 Sep, not booked by 12 Sep
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 09 - 12), 30);
        assert!(report.stale.is_empty());
        let first = &report.upcoming[0];
        assert_eq!(first.date, date!(2026 - 09 - 05));
        assert!(first.overdue);
        assert_eq!(report.upcoming[1].date, date!(2026 - 10 - 05));
        assert!(!report.upcoming[1].overdue);
        assert!(first.confidence < report.active[0].confidence);
    }

    #[test]
    fn a_subscription_without_a_charge_for_two_periods_is_stale_not_active() {
        let txs = Fixture::monthly("Zeitschrift", date!(2026 - 01 - 10), &[1500, 1500, 1500]);
        // last booking 10 Mar; expected 10 Apr and 10 May; on 10 May it is only one period late
        let on_second = SubscriptionWatch::analyze(&txs, date!(2026 - 05 - 10), 30);
        assert_eq!(on_second.active.len(), 1);
        let after = SubscriptionWatch::analyze(&txs, date!(2026 - 05 - 11), 30);
        assert!(after.active.is_empty());
        assert!(after.upcoming.is_empty());
        assert_eq!(after.stale.len(), 1);
        assert_eq!(after.stale[0].periods_missed, 2);
        assert_eq!(after.stale[0].days_since_last, 62);
        assert_eq!(after.stale[0].subscription.counterparty, "Zeitschrift");
        // after a long time it drops off the list entirely
        let ancient = SubscriptionWatch::analyze(&txs, date!(2028 - 01 - 01), 30);
        assert!(ancient.stale.is_empty());
    }

    #[test]
    fn detects_a_price_hike_with_old_new_delta_percent_and_since() {
        // 9.99 twice, then 11.99 once: RecurringDetector would not call this recurring
        let txs = Fixture::monthly("Spotify", date!(2026 - 06 - 15), &[999, 999, 1199]);
        assert!(RecurringDetector::detect(&txs).is_empty());
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 08 - 20), 30);
        assert_eq!(report.price_hikes.len(), 1);
        let hike = &report.price_hikes[0];
        assert_eq!(hike.old_amount.cents(), 999);
        assert_eq!(hike.new_amount.cents(), 1199);
        assert_eq!(hike.delta.cents(), 200);
        assert_eq!(hike.percent_bp, 2002); // +20.02%
        assert_eq!(hike.since, date!(2026 - 08 - 15));
        // the calendar uses the new price
        assert_eq!(report.upcoming[0].amount.cents(), 1199);
        assert_eq!(report.active[0].amount.cents(), 1199);
    }

    #[test]
    fn a_price_drop_is_not_a_hike() {
        let txs = Fixture::monthly("Spotify", date!(2026 - 03 - 15), &[1199, 1199, 1199, 999]);
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 07 - 20), 30);
        assert_eq!(report.active.len(), 1);
        assert_eq!(report.active[0].amount.cents(), 999);
        assert!(report.price_hikes.is_empty());
    }

    #[test]
    fn small_rises_and_old_hikes_are_not_reported() {
        // +2.5% (1000 -> 1025): a new level, but below the 3% threshold
        let small = Fixture::monthly("Verein", date!(2026 - 03 - 01), &[1000, 1000, 1000, 1025]);
        let report = SubscriptionWatch::analyze(&small, date!(2026 - 06 - 10), 30);
        assert!(report.price_hikes.is_empty());
        // +10 euro but only 1%: below the percent threshold even though above the cents threshold
        let tiny = Fixture::monthly(
            "Miete",
            date!(2026 - 03 - 01),
            &[100_000, 100_000, 100_000, 101_000],
        );
        assert!(SubscriptionWatch::analyze(&tiny, date!(2026 - 06 - 10), 30)
            .price_hikes
            .is_empty());
        // a real hike, but 18 months ago
        let mut old = Fixture::monthly("Spotify", date!(2025 - 01 - 15), &[999, 999, 999]);
        old.extend(Fixture::monthly(
            "Spotify",
            date!(2025 - 04 - 15),
            &[1199; 18],
        ));
        let report = SubscriptionWatch::analyze(&old, date!(2026 - 10 - 01), 30);
        assert_eq!(report.active.len(), 1);
        assert!(report.price_hikes.is_empty());
    }

    #[test]
    fn varying_bills_are_neither_subscriptions_nor_hikes() {
        let mut txs = Fixture::monthly("Strom AG", date!(2026 - 01 - 15), &[4000, 9000, 4100]);
        txs.extend(Fixture::monthly(
            "Wasser",
            date!(2026 - 01 - 03),
            &[3000, 4500, 2500, 5200, 3300],
        ));
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 06 - 01), 60);
        assert!(report.active.is_empty() && report.stale.is_empty());
        assert!(report.price_hikes.is_empty());
        // and a jump to more than 2.5x the old price is a different bill, not a hike
        let jump = Fixture::monthly("Strom AG", date!(2026 - 01 - 15), &[4000, 4000, 12000]);
        assert!(SubscriptionWatch::analyze(&jump, date!(2026 - 04 - 01), 60)
            .active
            .is_empty());
    }

    #[test]
    fn income_is_not_watched() {
        let txs: Vec<_> = Fixture::monthly("Arbeitgeber", date!(2026 - 01 - 28), &[250_000; 4])
            .into_iter()
            .map(|mut t| {
                t.amount = -t.amount;
                t
            })
            .collect();
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 05 - 01), 60);
        assert!(report.active.is_empty() && report.upcoming.is_empty());
    }

    #[test]
    fn finds_everything_the_recurring_detector_finds() {
        let mut txs = vec![
            Fixture::tx(date!(2026 - 01 - 01), "Vermieter", -80_000),
            Fixture::tx(date!(2026 - 02 - 01), "Vermieter", -80_000),
            Fixture::tx(date!(2026 - 03 - 02), "Vermieter", -80_000),
        ];
        txs.extend(Fixture::monthly(
            "Netflix",
            date!(2026 - 01 - 05),
            &[1299; 3],
        ));
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 03 - 20), 60);
        for r in RecurringDetector::detect(&txs) {
            let ours = report
                .active
                .iter()
                .find(|s| s.counterparty == r.counterparty)
                .expect("watchdog sees every recurring payment");
            assert_eq!(ours.cadence, r.cadence);
            assert_eq!(ours.amount, -r.amount);
            assert_eq!(ours.next_expected, r.next_expected);
            assert_eq!(ours.last_date, r.last_date);
        }
    }

    #[test]
    fn groceries_are_not_subscriptions() {
        let groceries = vec![
            Fixture::tx(date!(2026 - 01 - 03), "Rewe", -2347),
            Fixture::tx(date!(2026 - 01 - 05), "Rewe", -1850),
            Fixture::tx(date!(2026 - 01 - 19), "Rewe", -4210),
            Fixture::tx(date!(2026 - 02 - 02), "Rewe", -999),
        ];
        let report = SubscriptionWatch::analyze(&groceries, date!(2026 - 02 - 10), 30);
        assert!(report.active.is_empty() && report.stale.is_empty());
    }

    #[test]
    fn same_merchant_twice_is_a_duplicate_even_when_the_charges_interleave() {
        // two Netflix plans on the 5th and the 20th
        let mut txs = Fixture::monthly("Netflix", date!(2026 - 01 - 05), &[1299; 4]);
        txs.extend(Fixture::monthly(
            "Netflix",
            date!(2026 - 01 - 20),
            &[1299; 4],
        ));
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 04 - 25), 30);
        assert_eq!(report.active.len(), 2);
        assert_eq!(report.duplicates.len(), 1);
        assert_eq!(report.duplicates[0].reason, DuplicateReason::SameMerchant);
    }

    #[test]
    fn similar_merchant_names_with_similar_amounts_are_duplicates() {
        let mut txs = Fixture::monthly("Netflix", date!(2026 - 01 - 05), &[1299; 3]);
        txs.extend(Fixture::monthly(
            "NETFLIX INTERNATIONAL BV",
            date!(2026 - 01 - 09),
            &[1199; 3],
        ));
        // same cadence but a very different price: a different product
        txs.extend(Fixture::monthly(
            "Netflix Studio",
            date!(2026 - 01 - 11),
            &[4999; 3],
        ));
        // unrelated
        txs.extend(Fixture::monthly(
            "Spotify",
            date!(2026 - 01 - 07),
            &[1199; 3],
        ));
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 03 - 15), 30);
        assert_eq!(report.active.len(), 4);
        assert_eq!(report.duplicates.len(), 1);
        let d = &report.duplicates[0];
        assert_eq!(d.reason, DuplicateReason::SimilarMerchant);
        let names = [
            d.first.counterparty.as_str(),
            d.second.counterparty.as_str(),
        ];
        assert!(names.contains(&"Netflix") && names.contains(&"NETFLIX INTERNATIONAL BV"));
    }

    #[test]
    fn different_cadence_or_a_stopped_plan_is_not_a_duplicate() {
        let mut txs = Fixture::monthly("Spotify", date!(2025 - 01 - 07), &[999; 3]);
        // the old plan stopped in March 2025; the new one is the same merchant, same price
        txs.extend(Fixture::monthly(
            "Spotify Premium",
            date!(2026 - 06 - 07),
            &[999; 3],
        ));
        let report = SubscriptionWatch::analyze(&txs, date!(2026 - 08 - 20), 30);
        assert_eq!(report.stale.len(), 0, "the old plan is too old to list");
        assert_eq!(report.active.len(), 1);
        assert!(report.duplicates.is_empty());

        let mut weekly_and_monthly = Fixture::monthly("Zeitung", date!(2025 - 12 - 01), &[1000; 3]);
        weekly_and_monthly.extend((0..5).map(|i| {
            Fixture::tx(
                date!(2026 - 01 - 03) + Duration::days(7 * i),
                "Zeitung Plus",
                -1000,
            )
        }));
        let report = SubscriptionWatch::analyze(&weekly_and_monthly, date!(2026 - 02 - 10), 30);
        assert!(report.duplicates.is_empty());
    }

    #[test]
    fn merchant_similarity_rules() {
        assert!(MerchantMatcher::similar(
            "netflix",
            "netflix international bv"
        ));
        assert!(MerchantMatcher::similar("spotify ab", "spotfy ab"));
        assert!(!MerchantMatcher::similar("rewe", "lidl"));
        assert!(
            !MerchantMatcher::similar("dm", "dm drogerie"),
            "too short to trust"
        );
        assert!(!MerchantMatcher::similar("", "netflix"));
    }

    #[test]
    fn confidence_grows_with_history_and_falls_with_a_wobbly_rhythm() {
        let three = Fixture::monthly("A", date!(2026 - 01 - 05), &[500; 3]);
        let ten = Fixture::monthly("A", date!(2025 - 01 - 05), &[500; 10]);
        let c3 = SubscriptionWatch::analyze(&three, date!(2026 - 03 - 20), 10).active[0].confidence;
        let c10 = SubscriptionWatch::analyze(&ten, date!(2025 - 10 - 20), 10).active[0].confidence;
        assert!(c10 > c3);
        let wobbly = vec![
            Fixture::tx(date!(2026 - 01 - 05), "A", -500),
            Fixture::tx(date!(2026 - 02 - 01), "A", -500),
            Fixture::tx(date!(2026 - 03 - 06), "A", -500),
        ];
        let cw =
            SubscriptionWatch::analyze(&wobbly, date!(2026 - 03 - 20), 10).active[0].confidence;
        assert!(cw < c3);
    }

    #[test]
    fn occurrence_after_counts_from_the_last_booking() {
        assert_eq!(
            Cadence::Monthly.occurrence_after(date!(2026 - 01 - 31), 2),
            date!(2026 - 03 - 31)
        );
        assert_eq!(
            Cadence::Weekly.occurrence_after(date!(2026 - 03 - 01), 3),
            date!(2026 - 03 - 22)
        );
        assert_eq!(
            Cadence::Yearly.occurrence_after(date!(2024 - 02 - 29), 1),
            date!(2025 - 02 - 28)
        );
        assert_eq!(
            Cadence::Monthly.occurrence_after(date!(2026 - 03 - 01), 1),
            Cadence::Monthly.next_after(date!(2026 - 03 - 01))
        );
    }
}
