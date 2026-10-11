//! Anomaly alerts on outgoing payments: duplicate charges, unusual amounts, big first-time
//! merchants and charges that are large for their category.
//!
//! Every alert has a `kind` (the key the app translates), a human-readable English `reason` with
//! the numbers, the transaction it is about, and an id that stays the same each time the alerts
//! are recomputed, so the user can dismiss it once.
//!
//! "Unusual" always means unusual compared with the history *before* the charge, using the median
//! and the median absolute deviation (MAD), which one earlier outlier cannot distort.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use time::{Date, Duration};

use crate::category::{Categorizer, Category};
use crate::money::Money;
use crate::subscriptions::SubscriptionWatch;
use crate::transaction::{NameNormalizer, Transaction};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertKind {
    /// The same merchant charged the same amount again within a few days.
    DuplicateCharge,
    /// Far above what this merchant usually charges.
    UnusualAmount,
    /// First charge from a merchant never seen before, and a big one.
    NewMerchant,
    /// Far above what this category usually costs.
    LargeForCategory,
}

impl AlertKind {
    fn code(self) -> &'static str {
        match self {
            AlertKind::DuplicateCharge => "dup",
            AlertKind::UnusualAmount => "amt",
            AlertKind::NewMerchant => "new",
            AlertKind::LargeForCategory => "cat",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Alert {
    /// Stable across recomputation: `<kind code>-<16 hex digits>`.
    pub id: String,
    pub kind: AlertKind,
    pub severity: Severity,
    /// English sentence with the numbers; the app labels it by `kind` in the user's language.
    pub reason: String,
    pub transaction_id: i64,
    pub booking_date: Date,
    pub counterparty: String,
    /// What was charged. Positive.
    pub amount: Money,
    /// What it is compared with: the earlier identical charge, the merchant's or category's
    /// median, or the new-merchant threshold. Positive.
    pub reference_amount: Option<Money>,
    /// How many earlier charges the comparison is based on.
    pub history_count: usize,
}

/// Thresholds. `Default` is what the app uses.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnomalyConfig {
    /// Only transactions booked within this many days before `as_of` produce alerts.
    pub lookback_days: i64,
    /// Same merchant and amount within this many days is a duplicate. Default 3.
    pub duplicate_window_days: i64,
    /// Duplicates below this amount (two coffees) are ignored. Default 500 cents.
    pub duplicate_min_cents: i64,
    /// Earlier charges needed before "unusual for this merchant" is judged. Default 5.
    pub unusual_min_history: usize,
    /// Modified z-score above which a charge is unusual for its merchant. Default 3.5.
    pub unusual_z: f64,
    /// ... and it must exceed the median by this many cents. Default 2000.
    pub unusual_min_excess_cents: i64,
    /// ... and be at least this many percent of the median. Default 150.
    pub unusual_min_percent: i64,
    /// A merchant seen for the first time with at least this amount is an alert. Default 10000.
    pub new_merchant_min_cents: i64,
    /// New merchants are only judged this many days after the first transaction in the data, so a
    /// fresh import does not turn every merchant into a "new" one. Default 60.
    pub new_merchant_warmup_days: i64,
    /// Earlier charges in the category needed before "large for the category" is judged. Default 10.
    pub category_min_history: usize,
    /// Modified z-score above which a charge is large for its category. Default 6.0.
    pub category_z: f64,
    /// ... and at least this many cents. Default 5000.
    pub category_min_cents: i64,
    /// ... and at least this many percent of the category median. Default 200.
    pub category_min_percent: i64,
}

impl Default for AnomalyConfig {
    fn default() -> Self {
        Self {
            lookback_days: 60,
            duplicate_window_days: 3,
            duplicate_min_cents: 500,
            unusual_min_history: 5,
            unusual_z: 3.5,
            unusual_min_excess_cents: 2000,
            unusual_min_percent: 150,
            new_merchant_min_cents: 10_000,
            new_merchant_warmup_days: 60,
            category_min_history: 10,
            category_z: 6.0,
            category_min_cents: 5000,
            category_min_percent: 200,
        }
    }
}

/// Median and MAD of a list of cent amounts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RobustStats {
    median: i64,
    mad: i64,
}

impl RobustStats {
    fn of(values: &[i64]) -> RobustStats {
        let median = Self::median(values);
        let deviations: Vec<i64> = values.iter().map(|v| (v - median).abs()).collect();
        RobustStats {
            median,
            mad: Self::median(&deviations),
        }
    }

    fn median(values: &[i64]) -> i64 {
        let mut sorted = values.to_vec();
        sorted.sort_unstable();
        let mid = sorted.len() / 2;
        if sorted.len() % 2 == 1 {
            sorted[mid]
        } else {
            (sorted[mid - 1] + sorted[mid]) / 2
        }
    }

    /// How many "typical deviations" above the median `value` is. The scale is `1.4826 * MAD`
    /// (the normal-distribution equivalent of the standard deviation), but never below 10% of the
    /// median or one euro. Without that floor a history of identical amounts (MAD of zero) would
    /// make every other amount infinitely unusual.
    fn z(&self, value: i64) -> f64 {
        let scale = (1.4826 * self.mad as f64)
            .max(0.1 * self.median as f64)
            .max(100.0);
        (value - self.median) as f64 / scale
    }

    /// `value` is an outlier: z-score, absolute excess and share of the median all exceed.
    fn is_outlier(&self, value: i64, z: f64, min_excess: i64, min_percent: i64) -> bool {
        value - self.median >= min_excess
            && value * 100 >= self.median * min_percent
            && self.z(value) >= z
    }
}

/// 64-bit FNV-1a: a hash whose output never changes between Rust versions, unlike `DefaultHasher`.
struct Fnv;

impl Fnv {
    fn hash(text: &str) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in text.bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        h
    }
}

/// English amount for reasons (`25.00 EUR`); the app formats amounts itself.
struct Eur;

impl Eur {
    fn text(cents: i64) -> String {
        format!("{}.{:02} EUR", cents / 100, cents % 100)
    }
}

/// One outgoing payment prepared for the scan.
struct Expense<'a> {
    id: i64,
    tx: &'a Transaction,
    key: String,
    cents: i64,
    category: Category,
    /// Number of earlier transactions with the same fingerprint; makes the alert id unique when
    /// the same purchase happens twice on a day.
    occurrence: usize,
}

pub struct AnomalyDetector;

impl AnomalyDetector {
    /// Scan `transactions` (database id and transaction) and return the alerts for payments
    /// booked in the last `config.lookback_days` days up to `as_of`, newest first.
    ///
    /// A payment gets at most one alert, the most specific one: duplicate charge, then unusual
    /// amount, then new merchant, then large for category. Merchants that are known recurring
    /// payments never produce duplicate-charge alerts (a standing order is not a double charge).
    pub fn detect(
        transactions: &[(i64, Transaction)],
        as_of: Date,
        config: &AnomalyConfig,
    ) -> Vec<Alert> {
        let all: Vec<Transaction> = transactions.iter().map(|(_, t)| t.clone()).collect();
        let recurring: HashSet<String> = SubscriptionWatch::detect_series(&all)
            .into_iter()
            .map(|s| s.key)
            .collect();
        let data_start = transactions.iter().map(|(_, t)| t.booking_date).min();
        let mut sorted: Vec<&(i64, Transaction)> = transactions.iter().collect();
        sorted.sort_by_key(|(id, t)| (t.booking_date, *id));

        let categorizer = Categorizer::new();
        let from = as_of - Duration::days(config.lookback_days);
        let mut seen_fingerprints: HashMap<String, usize> = HashMap::new();
        // merchants seen so far, whatever the direction (a refund also makes a merchant known)
        let mut known_merchants: HashSet<String> = HashSet::new();
        let mut by_merchant: HashMap<String, Vec<(Date, i64)>> = HashMap::new();
        let mut by_category: HashMap<Category, Vec<i64>> = HashMap::new();
        let mut alerts = Vec::new();

        for (id, tx) in sorted {
            let key = NameNormalizer::normalize(&tx.counterparty);
            let first_time = known_merchants.insert(key.clone());
            let fingerprint = tx.fingerprint();
            let counter = seen_fingerprints.entry(fingerprint.clone()).or_insert(0);
            let occurrence = *counter;
            *counter += 1;
            if !tx.amount.is_negative() {
                continue;
            }
            let expense = Expense {
                id: *id,
                tx,
                key,
                cents: tx.amount.cents().abs(),
                category: tx.category.unwrap_or_else(|| categorizer.categorize(tx)),
                occurrence,
            };
            let history = by_merchant.entry(expense.key.clone()).or_default();
            let category_history = by_category.entry(expense.category).or_default();

            if expense.tx.booking_date >= from && expense.tx.booking_date <= as_of {
                let found = Self::duplicate(&expense, history, &recurring, config)
                    .or_else(|| Self::unusual(&expense, history, config))
                    .or_else(|| Self::new_merchant(&expense, first_time, data_start, config))
                    .or_else(|| Self::large_for_category(&expense, category_history, config));
                alerts.extend(found.map(|a| a.into_alert(&expense, &fingerprint)));
            }
            history.push((expense.tx.booking_date, expense.cents));
            category_history.push(expense.cents);
        }
        alerts.sort_by(|a, b| {
            b.booking_date
                .cmp(&a.booking_date)
                .then(b.transaction_id.cmp(&a.transaction_id))
        });
        alerts
    }

    fn duplicate(
        e: &Expense,
        history: &[(Date, i64)],
        recurring: &HashSet<String>,
        config: &AnomalyConfig,
    ) -> Option<Finding> {
        if e.cents < config.duplicate_min_cents || recurring.contains(&e.key) {
            return None;
        }
        let window = Duration::days(config.duplicate_window_days);
        let (earlier, _) = history
            .iter()
            .rev()
            .take_while(|(d, _)| e.tx.booking_date - *d <= window)
            .find(|(_, cents)| *cents == e.cents)?;
        let days = (e.tx.booking_date - *earlier).whole_days();
        Some(Finding {
            kind: AlertKind::DuplicateCharge,
            severity: match e.cents {
                10_000.. => Severity::High,
                2000.. => Severity::Medium,
                _ => Severity::Low,
            },
            reason: format!(
                "{} charged {} again {} day(s) after an identical charge",
                e.tx.counterparty,
                Eur::text(e.cents),
                days
            ),
            reference: Some(e.cents),
            history_count: history.len(),
        })
    }

    fn unusual(e: &Expense, history: &[(Date, i64)], config: &AnomalyConfig) -> Option<Finding> {
        if history.len() < config.unusual_min_history {
            return None;
        }
        let amounts: Vec<i64> = history.iter().map(|(_, c)| *c).collect();
        let stats = RobustStats::of(&amounts);
        if !stats.is_outlier(
            e.cents,
            config.unusual_z,
            config.unusual_min_excess_cents,
            config.unusual_min_percent,
        ) {
            return None;
        }
        let severe = stats.z(e.cents) >= 10.0 || e.cents >= stats.median * 4;
        Some(Finding {
            kind: AlertKind::UnusualAmount,
            severity: if severe {
                Severity::High
            } else {
                Severity::Medium
            },
            reason: format!(
                "{} charged {}, usually about {} (based on {} earlier charges)",
                e.tx.counterparty,
                Eur::text(e.cents),
                Eur::text(stats.median),
                history.len()
            ),
            reference: Some(stats.median),
            history_count: history.len(),
        })
    }

    fn new_merchant(
        e: &Expense,
        first_time: bool,
        data_start: Option<Date>,
        config: &AnomalyConfig,
    ) -> Option<Finding> {
        let start = data_start?;
        if !first_time
            || e.cents < config.new_merchant_min_cents
            || e.tx.booking_date < start + Duration::days(config.new_merchant_warmup_days)
        {
            return None;
        }
        Some(Finding {
            kind: AlertKind::NewMerchant,
            severity: if e.cents >= 3 * config.new_merchant_min_cents {
                Severity::High
            } else {
                Severity::Medium
            },
            reason: format!(
                "First payment to {}, and it is {}",
                e.tx.counterparty,
                Eur::text(e.cents)
            ),
            reference: Some(config.new_merchant_min_cents),
            history_count: 0,
        })
    }

    fn large_for_category(e: &Expense, history: &[i64], config: &AnomalyConfig) -> Option<Finding> {
        // rent, insurance and similar fixed costs are large by nature; the others vary with choices
        let everyday = matches!(
            e.category,
            Category::Groceries
                | Category::Dining
                | Category::Transport
                | Category::Health
                | Category::Leisure
                | Category::Shopping
        );
        if !everyday || history.len() < config.category_min_history {
            return None;
        }
        let stats = RobustStats::of(history);
        if e.cents < config.category_min_cents
            || !stats.is_outlier(e.cents, config.category_z, 0, config.category_min_percent)
        {
            return None;
        }
        let severe = stats.z(e.cents) >= 12.0 || e.cents >= stats.median * 5;
        Some(Finding {
            kind: AlertKind::LargeForCategory,
            severity: if severe {
                Severity::Medium
            } else {
                Severity::Low
            },
            reason: format!(
                "{} to {} is large for {:?} (usually about {})",
                Eur::text(e.cents),
                e.tx.counterparty,
                e.category,
                Eur::text(stats.median)
            ),
            reference: Some(stats.median),
            history_count: history.len(),
        })
    }
}

/// What a check found, before it gets an id and the transaction details.
struct Finding {
    kind: AlertKind,
    severity: Severity,
    reason: String,
    reference: Option<i64>,
    history_count: usize,
}

impl Finding {
    fn into_alert(self, e: &Expense, fingerprint: &str) -> Alert {
        let hash = Fnv::hash(&format!(
            "{}|{}|{}",
            self.kind.code(),
            fingerprint,
            e.occurrence
        ));
        Alert {
            id: format!("{}-{hash:016x}", self.kind.code()),
            kind: self.kind,
            severity: self.severity,
            reason: self.reason,
            transaction_id: e.id,
            booking_date: e.tx.booking_date,
            counterparty: e.tx.counterparty.clone(),
            amount: Money::from_cents(e.cents),
            reference_amount: self.reference.map(Money::from_cents),
            history_count: self.history_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

        /// Number the transactions 1.. in the order given.
        fn numbered(txs: Vec<Transaction>) -> Vec<(i64, Transaction)> {
            txs.into_iter()
                .enumerate()
                .map(|(i, t)| (i as i64 + 1, t))
                .collect()
        }

        /// `count` charges of `who`, one per week from `start`, with the given amounts repeating.
        fn weekly(who: &str, start: Date, amounts: &[i64], count: usize) -> Vec<Transaction> {
            (0..count)
                .map(|i| {
                    Self::tx(
                        start + Duration::days(7 * i as i64),
                        who,
                        -amounts[i % amounts.len()],
                    )
                })
                .collect()
        }

        fn run(txs: Vec<Transaction>, as_of: Date) -> Vec<Alert> {
            AnomalyDetector::detect(&Self::numbered(txs), as_of, &AnomalyConfig::default())
        }
    }

    #[test]
    fn same_merchant_and_amount_within_days_is_a_duplicate_charge() {
        let txs = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Elektro Markt", -12_999),
            Fixture::tx(date!(2026 - 03 - 03), "ELEKTRO MARKT", -12_999),
        ];
        let alerts = Fixture::run(txs, date!(2026 - 03 - 05));
        assert_eq!(alerts.len(), 1);
        let a = &alerts[0];
        assert_eq!(a.kind, AlertKind::DuplicateCharge);
        assert_eq!(a.severity, Severity::High);
        assert_eq!(a.transaction_id, 2, "the second charge is the duplicate");
        assert_eq!(a.amount.cents(), 12_999);
        assert_eq!(a.reference_amount, Some(Money::from_cents(12_999)));
        assert_eq!(
            a.reason,
            "ELEKTRO MARKT charged 129.99 EUR again 2 day(s) after an identical charge"
        );
        assert!(a.id.starts_with("dup-") && a.id.len() == 4 + 16);
    }

    #[test]
    fn duplicates_need_the_same_amount_a_close_date_and_a_real_amount() {
        let different_amount = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Shop", -5000),
            Fixture::tx(date!(2026 - 03 - 02), "Shop", -5001),
        ];
        assert!(Fixture::run(different_amount, date!(2026 - 03 - 05)).is_empty());
        let too_far_apart = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Shop", -5000),
            Fixture::tx(date!(2026 - 03 - 05), "Shop", -5000),
        ];
        assert!(Fixture::run(too_far_apart, date!(2026 - 03 - 06)).is_empty());
        let two_coffees = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Cafe Ecke", -250),
            Fixture::tx(date!(2026 - 03 - 01), "Cafe Ecke", -250),
        ];
        assert!(Fixture::run(two_coffees, date!(2026 - 03 - 05)).is_empty());
        let other_merchant = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Shop A", -5000),
            Fixture::tx(date!(2026 - 03 - 01), "Shop B", -5000),
        ];
        assert!(Fixture::run(other_merchant, date!(2026 - 03 - 05)).is_empty());
    }

    #[test]
    fn a_known_recurring_payment_is_not_a_duplicate_charge() {
        let mut txs = vec![
            Fixture::tx(date!(2026 - 01 - 01), "Vermieter", -80_000),
            Fixture::tx(date!(2026 - 02 - 01), "Vermieter", -80_000),
            Fixture::tx(date!(2026 - 03 - 01), "Vermieter", -80_000),
            Fixture::tx(date!(2026 - 04 - 01), "Vermieter", -80_000),
        ];
        // a manual transfer of the same rent two days later
        txs.push(Fixture::tx(date!(2026 - 04 - 03), "Vermieter", -80_000));
        let alerts = Fixture::run(txs, date!(2026 - 04 - 10));
        assert!(alerts.iter().all(|a| a.kind != AlertKind::DuplicateCharge));
    }

    #[test]
    fn three_identical_charges_give_two_alerts_with_different_ids() {
        let txs = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Shop", -5000),
            Fixture::tx(date!(2026 - 03 - 01), "Shop", -5000),
            Fixture::tx(date!(2026 - 03 - 01), "Shop", -5000),
        ];
        let alerts = Fixture::run(txs, date!(2026 - 03 - 02));
        assert_eq!(alerts.len(), 2);
        assert_ne!(alerts[0].id, alerts[1].id);
    }

    #[test]
    fn ids_are_stable_across_runs_and_independent_of_database_ids() {
        let txs = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Elektro Markt", -12_999),
            Fixture::tx(date!(2026 - 03 - 03), "Elektro Markt", -12_999),
        ];
        let first = Fixture::run(txs.clone(), date!(2026 - 03 - 05));
        let again = Fixture::run(txs.clone(), date!(2026 - 03 - 09));
        assert_eq!(first[0].id, again[0].id);
        let renumbered: Vec<(i64, Transaction)> = vec![(70, txs[0].clone()), (90, txs[1].clone())];
        let after_restore = AnomalyDetector::detect(
            &renumbered,
            date!(2026 - 03 - 05),
            &AnomalyConfig::default(),
        );
        assert_eq!(first[0].id, after_restore[0].id);
        assert_eq!(after_restore[0].transaction_id, 90);
        // pinned, so an accidental change of the hash is noticed (it would resurrect dismissed alerts)
        assert_eq!(Fnv::hash("a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[test]
    fn a_charge_far_above_the_merchants_history_is_unusual() {
        // eight weekly fuel stops of 55-65 euro, then 250
        let mut txs = Fixture::weekly("Aral", date!(2026 - 01 - 03), &[5500, 6000, 6500], 8);
        txs.push(Fixture::tx(date!(2026 - 03 - 07), "Aral", -25_000));
        let alerts = Fixture::run(txs, date!(2026 - 03 - 10));
        assert_eq!(alerts.len(), 1);
        let a = &alerts[0];
        assert_eq!(a.kind, AlertKind::UnusualAmount);
        assert_eq!(a.severity, Severity::High);
        assert_eq!(a.amount.cents(), 25_000);
        assert_eq!(a.reference_amount.unwrap().cents(), 6000);
        assert_eq!(a.history_count, 8);
    }

    #[test]
    fn mad_of_zero_still_works() {
        // ten identical charges: MAD is 0. A different amount must neither divide by zero nor flag
        // every small difference.
        let base = Fixture::weekly("Fitness", date!(2026 - 01 - 03), &[3000], 10);
        let stats = RobustStats::of(&[3000; 10]);
        assert_eq!(
            stats,
            RobustStats {
                median: 3000,
                mad: 0
            }
        );
        assert!(stats.z(3000).abs() < f64::EPSILON);
        assert!(stats.z(3100).is_finite());

        let mut slightly_more = base.clone();
        slightly_more.push(Fixture::tx(date!(2026 - 03 - 14), "Fitness", -3200));
        assert!(Fixture::run(slightly_more, date!(2026 - 03 - 15)).is_empty());

        let mut triple = base.clone();
        triple.push(Fixture::tx(date!(2026 - 03 - 14), "Fitness", -9000));
        let alerts = Fixture::run(triple, date!(2026 - 03 - 15));
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].kind, AlertKind::UnusualAmount);
        assert_eq!(alerts[0].reference_amount.unwrap().cents(), 3000);
    }

    #[test]
    fn a_noisy_history_raises_the_bar() {
        // groceries from 15 to 90 euro: 120 is a big shop, not an anomaly
        let mut txs = Fixture::weekly(
            "Edeka",
            date!(2026 - 01 - 03),
            &[1500, 9000, 4000, 6500, 2500],
            10,
        );
        txs.push(Fixture::tx(date!(2026 - 03 - 14), "Edeka", -12_000));
        assert!(Fixture::run(txs, date!(2026 - 03 - 15)).is_empty());
    }

    #[test]
    fn unusual_needs_a_minimum_history_and_ignores_later_charges() {
        let mut few = Fixture::weekly("Aral", date!(2026 - 01 - 03), &[6000], 4);
        few.push(Fixture::tx(date!(2026 - 02 - 07), "Aral", -30_000));
        assert!(Fixture::run(few, date!(2026 - 02 - 10)).is_empty());

        // the big charge comes first; the normal ones after it are judged on a history with an
        // outlier in it and stay quiet
        let mut big_first = vec![Fixture::tx(date!(2026 - 01 - 01), "Aral", -30_000)];
        big_first.extend(Fixture::weekly("Aral", date!(2026 - 01 - 08), &[6000], 8));
        assert!(Fixture::run(big_first, date!(2026 - 03 - 05)).is_empty());
    }

    #[test]
    fn a_first_time_merchant_with_a_tiny_amount_is_not_an_alert() {
        let mut txs = Fixture::weekly("Rewe", date!(2026 - 01 - 03), &[3000, 4000], 12);
        txs.push(Fixture::tx(date!(2026 - 03 - 28), "Kiosk am Eck", -150));
        txs.push(Fixture::tx(date!(2026 - 03 - 29), "Neue Baeckerei", -899));
        assert!(Fixture::run(txs, date!(2026 - 03 - 30)).is_empty());
    }

    #[test]
    fn a_first_time_merchant_above_the_threshold_is_an_alert() {
        let mut txs = Fixture::weekly("Rewe", date!(2026 - 01 - 03), &[3000, 4000], 12);
        txs.push(Fixture::tx(
            date!(2026 - 03 - 28),
            "Moebelhaus Schmidt",
            -45_000,
        ));
        let alerts = Fixture::run(txs, date!(2026 - 03 - 30));
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].kind, AlertKind::NewMerchant);
        assert_eq!(alerts[0].severity, Severity::High);
        assert_eq!(alerts[0].history_count, 0);
        // the second payment to the same merchant is no longer "new"
        let mut again = Fixture::weekly("Rewe", date!(2026 - 01 - 03), &[3000, 4000], 12);
        again.push(Fixture::tx(
            date!(2026 - 03 - 20),
            "Moebelhaus Schmidt",
            -45_000,
        ));
        again.push(Fixture::tx(
            date!(2026 - 03 - 28),
            "Moebelhaus Schmidt",
            -45_500,
        ));
        let alerts = Fixture::run(again, date!(2026 - 03 - 30));
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].booking_date, date!(2026 - 03 - 20));
    }

    #[test]
    fn a_fresh_import_does_not_flag_every_merchant_as_new() {
        // everything is "new" in the first weeks of the data
        let txs = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Moebelhaus", -45_000),
            Fixture::tx(date!(2026 - 03 - 10), "Elektro", -30_000),
        ];
        assert!(Fixture::run(txs, date!(2026 - 03 - 15)).is_empty());
        // a refund from a merchant makes it known
        let mut refund = Fixture::weekly("Rewe", date!(2026 - 01 - 03), &[3000], 12);
        refund.push(Fixture::tx(date!(2026 - 02 - 01), "Moebelhaus", 1000));
        refund.push(Fixture::tx(date!(2026 - 03 - 20), "Moebelhaus", -45_000));
        assert!(Fixture::run(refund, date!(2026 - 03 - 25)).is_empty());
    }

    #[test]
    fn a_large_charge_for_the_category_is_flagged_when_the_merchant_is_known() {
        // twelve Lidl and Rewe shops of 20-50 euro build the groceries history
        let mut txs = Fixture::weekly("Lidl", date!(2026 - 01 - 03), &[2500, 3500, 4500], 12);
        txs.extend(Fixture::weekly(
            "Rewe",
            date!(2026 - 01 - 05),
            &[3000, 2000, 4000],
            12,
        ));
        // Edeka is known from two small shops, then a big one
        txs.push(Fixture::tx(date!(2026 - 01 - 10), "Edeka", -1500));
        txs.push(Fixture::tx(date!(2026 - 02 - 10), "Edeka", -1800));
        txs.push(Fixture::tx(date!(2026 - 03 - 20), "Edeka", -30_000));
        let alerts = Fixture::run(txs, date!(2026 - 03 - 22));
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].kind, AlertKind::LargeForCategory);
        assert_eq!(alerts[0].counterparty, "Edeka");
        assert!(alerts[0].reason.contains("Groceries"));
    }

    #[test]
    fn fixed_cost_categories_are_never_large_for_the_category() {
        let mut txs: Vec<Transaction> = (0..12)
            .map(|i| {
                Fixture::tx(
                    date!(2026 - 01 - 01) + Duration::days(7 * i),
                    &format!("Vermieter {i}"),
                    -(40_000 + 100 * i),
                )
            })
            .map(|mut t| {
                t.category = Some(Category::Housing);
                t
            })
            .collect();
        let mut big = Fixture::tx(date!(2026 - 03 - 28), "Vermieter 99", -900_000);
        big.category = Some(Category::Housing);
        txs.push(big);
        let alerts = Fixture::run(txs, date!(2026 - 03 - 30));
        assert!(alerts.iter().all(|a| a.kind != AlertKind::LargeForCategory));
    }

    #[test]
    fn at_most_one_alert_per_transaction_and_only_inside_the_lookback_window() {
        // a duplicate that is also a new merchant: reported once, as the duplicate
        let mut txs = Fixture::weekly("Rewe", date!(2026 - 01 - 03), &[3000], 12);
        txs.push(Fixture::tx(date!(2026 - 03 - 20), "Moebelhaus", -45_000));
        txs.push(Fixture::tx(date!(2026 - 03 - 21), "Moebelhaus", -45_000));
        let alerts = Fixture::run(txs.clone(), date!(2026 - 03 - 25));
        let kinds: Vec<_> = alerts.iter().map(|a| a.kind).collect();
        assert_eq!(
            kinds,
            vec![AlertKind::DuplicateCharge, AlertKind::NewMerchant]
        );
        // newest first
        assert!(alerts[0].booking_date > alerts[1].booking_date);
        // three months later nothing is "recent" any more
        assert!(Fixture::run(txs.clone(), date!(2026 - 07 - 01)).is_empty());
        // and future-dated bookings produce nothing yet
        assert!(Fixture::run(txs, date!(2026 - 03 - 10)).is_empty());
    }

    #[test]
    fn income_never_alerts() {
        let txs = vec![
            Fixture::tx(date!(2026 - 03 - 01), "Arbeitgeber", 250_000),
            Fixture::tx(date!(2026 - 03 - 02), "Arbeitgeber", 250_000),
        ];
        assert!(Fixture::run(txs, date!(2026 - 03 - 05)).is_empty());
    }

    #[test]
    fn median_and_mad_of_even_and_odd_lists() {
        assert_eq!(
            RobustStats::of(&[1, 2, 3, 4, 100]),
            RobustStats { median: 3, mad: 1 }
        );
        assert_eq!(
            RobustStats::of(&[10, 20, 30, 40]),
            RobustStats {
                median: 25,
                mad: 10
            }
        );
    }
}
