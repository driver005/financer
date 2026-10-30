//! Is this a good price? Judged against the price history we collected, not against the
//! struck-through "was" price shops print, which is often inflated.

use serde::{Deserialize, Serialize};

const DAY: i64 = 86_400;
const WINDOW_DAYS: i64 = 90;
/// Fewer samples than this and the history says too little to call a price low.
const MIN_SAMPLES: usize = 3;

/// The comparable price of a product's best offer at one point in time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PricePoint {
    pub at: i64,
    pub cents: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    #[default]
    None,
    Fair,
    Good,
    Great,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DealInfo {
    pub current_cents: i64,
    /// What the price normally is: the median of the last 90 days, or the shop's list price when
    /// there is too little history.
    pub reference_cents: Option<i64>,
    pub discount_pct: f64,
    pub lowest_cents: Option<i64>,
    pub lowest_90d: bool,
    pub all_time_low: bool,
    pub samples: usize,
    pub verdict: Verdict,
}

impl DealInfo {
    pub fn none(current_cents: i64) -> DealInfo {
        DealInfo {
            current_cents,
            reference_cents: None,
            discount_pct: 0.0,
            lowest_cents: None,
            lowest_90d: false,
            all_time_low: false,
            samples: 0,
            verdict: Verdict::None,
        }
    }
}

fn median(values: &mut [i64]) -> i64 {
    values.sort_unstable();
    let n = values.len();
    if n % 2 == 1 {
        values[n / 2]
    } else {
        (values[n / 2 - 1] + values[n / 2]) / 2
    }
}

/// Judge `current` against `history` (which may include the current price) at time `now`.
pub fn assess(history: &[PricePoint], current: i64, list_price: Option<i64>, now: i64) -> DealInfo {
    let recent: Vec<i64> = history
        .iter()
        .filter(|p| p.at >= now - WINDOW_DAYS * DAY && p.at <= now)
        .map(|p| p.cents)
        .collect();
    let enough = recent.len() >= MIN_SAMPLES;
    let reference = if enough {
        Some(median(&mut recent.clone()))
    } else {
        list_price.filter(|l| *l > 0)
    };
    let lowest = history.iter().map(|p| p.cents).min();
    let discount = reference
        .filter(|r| *r > current)
        .map_or(0.0, |r| (r - current) as f64 * 100.0 / r as f64);
    let lowest_90d = enough && recent.iter().all(|c| current <= *c);
    let all_time_low = history.len() >= MIN_SAMPLES && lowest.is_none_or(|l| current <= l);
    let mut verdict = if discount >= 20.0 && (lowest_90d || all_time_low) {
        Verdict::Great
    } else if discount >= 10.0 {
        Verdict::Good
    } else if discount >= 3.0 {
        Verdict::Fair
    } else {
        Verdict::None
    };
    if !enough && verdict > Verdict::Good {
        // a list price alone is not evidence of a great deal
        verdict = Verdict::Good;
    }
    DealInfo {
        current_cents: current,
        reference_cents: reference,
        discount_pct: discount,
        lowest_cents: lowest,
        lowest_90d,
        all_time_low,
        samples: history.len(),
        verdict,
    }
}

/// What someone wants to be told about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Watch {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    /// Free-text search; every product it finds is watched.
    #[serde(default)]
    pub query: Option<String>,
    /// Or specific products.
    #[serde(default)]
    pub product_ids: Vec<String>,
    /// Tell me when the comparable price is at or below this.
    #[serde(default)]
    pub max_price_cents: Option<i64>,
    /// Or when it is at least this far below its usual price (needs a Good verdict).
    #[serde(default)]
    pub min_discount_pct: Option<f64>,
    #[serde(default = "enabled")]
    pub enabled: bool,
}

fn enabled() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    BelowTarget,
    Deal,
    NewLow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DealEvent {
    /// Same key, same event: the store sends each key once.
    pub key: String,
    pub watch_id: i64,
    pub watch_name: String,
    pub product_id: String,
    pub title: String,
    pub shop: String,
    pub url: String,
    pub price_cents: i64,
    pub reference_cents: Option<i64>,
    pub discount_pct: f64,
    pub verdict: Verdict,
    pub kind: EventKind,
}

impl DealEvent {
    /// "Pixel 9 is 549,00 EUR at Shop (-18 %)".
    pub fn message(&self) -> String {
        let price = format!(
            "{},{:02} EUR",
            self.price_cents / 100,
            self.price_cents % 100
        );
        let mut m = format!("{} is {} at {}", self.title, price, self.shop);
        if self.discount_pct >= 1.0 {
            m.push_str(&format!(" (-{:.0} %)", self.discount_pct));
        }
        m
    }
}

impl Watch {
    /// Does this price deserve a message?
    #[allow(clippy::too_many_arguments)]
    pub fn evaluate(
        &self,
        product_id: &str,
        title: &str,
        shop: &str,
        url: &str,
        info: &DealInfo,
    ) -> Option<DealEvent> {
        if !self.enabled {
            return None;
        }
        let price = info.current_cents;
        let kind = if self.max_price_cents.is_some_and(|max| price <= max) {
            EventKind::BelowTarget
        } else if info.all_time_low && info.verdict >= Verdict::Good {
            EventKind::NewLow
        } else if self
            .min_discount_pct
            .is_some_and(|d| info.discount_pct >= d)
            && info.verdict >= Verdict::Good
        {
            EventKind::Deal
        } else {
            return None;
        };
        Some(DealEvent {
            key: format!("{}:{}:{}:{}", self.id, product_id, shop, price),
            watch_id: self.id,
            watch_name: self.name.clone(),
            product_id: product_id.to_string(),
            title: title.to_string(),
            shop: shop.to_string(),
            url: url.to_string(),
            price_cents: price,
            reference_cents: info.reference_cents,
            discount_pct: info.discount_pct,
            verdict: info.verdict,
            kind,
        })
    }
}

/// Send again only when the price fell by at least 2 % since the last message for this product:
/// a price flicking between two values must not ring the phone every crawl.
pub fn worth_repeating(last_notified_cents: i64, now_cents: i64) -> bool {
    now_cents * 100 <= last_notified_cents * 98
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hist(prices: &[i64]) -> Vec<PricePoint> {
        // one sample a week, oldest first, the last one is "now"
        let now = 100 * DAY;
        let n = prices.len() as i64;
        prices
            .iter()
            .enumerate()
            .map(|(i, c)| PricePoint {
                at: now - (n - 1 - i as i64) * 7 * DAY,
                cents: *c,
            })
            .collect()
    }

    const NOW: i64 = 100 * DAY;

    #[test]
    fn a_price_far_below_the_usual_and_at_a_low_is_great() {
        let h = hist(&[60_000, 61_000, 59_900, 60_500, 45_000]);
        let d = assess(&h, 45_000, None, NOW);
        assert_eq!(d.reference_cents, Some(60_000));
        assert!((d.discount_pct - 25.0).abs() < 0.01);
        assert!(d.lowest_90d && d.all_time_low);
        assert_eq!(d.verdict, Verdict::Great);
    }

    #[test]
    fn a_small_dip_is_fair_and_no_dip_is_nothing() {
        let h = hist(&[60_000, 60_000, 60_000, 58_000]);
        assert_eq!(assess(&h, 58_000, None, NOW).verdict, Verdict::Fair);
        let flat = hist(&[60_000, 60_000, 60_000, 60_000]);
        let d = assess(&flat, 60_000, None, NOW);
        assert_eq!(d.verdict, Verdict::None);
        assert_eq!(d.discount_pct, 0.0);
    }

    #[test]
    fn without_history_the_list_price_is_used_but_never_called_great() {
        let d = assess(&[], 40_000, Some(80_000), NOW);
        assert_eq!(d.reference_cents, Some(80_000));
        assert!((d.discount_pct - 50.0).abs() < 0.01);
        assert!(!d.all_time_low);
        assert_eq!(d.verdict, Verdict::Good);
    }

    #[test]
    fn old_history_is_not_the_reference() {
        let mut h = hist(&[90_000, 90_000, 90_000]);
        for p in &mut h {
            p.at -= 200 * DAY; // far outside the window
        }
        let d = assess(&h, 60_000, None, NOW + 200 * DAY);
        assert_eq!(d.reference_cents, None);
    }

    #[test]
    fn watches_fire_on_target_price_or_real_deals_only() {
        let watch = Watch {
            id: 7,
            name: "Pixel".into(),
            category: None,
            query: Some("pixel 9".into()),
            product_ids: vec![],
            max_price_cents: Some(50_000),
            min_discount_pct: Some(15.0),
            enabled: true,
        };
        let great = assess(
            &hist(&[60_000, 61_000, 59_900, 60_500, 45_000]),
            45_000,
            None,
            NOW,
        );
        let ev = watch
            .evaluate("p1", "Pixel 9", "Shop", "https://s/p1", &great)
            .unwrap();
        assert_eq!(ev.kind, EventKind::BelowTarget);
        assert_eq!(ev.key, "7:p1:Shop:45000");
        assert_eq!(ev.message(), "Pixel 9 is 450,00 EUR at Shop (-25 %)");

        let dear = assess(
            &hist(&[80_000, 80_000, 80_000, 65_000, 70_000]),
            70_000,
            None,
            NOW,
        );
        // 12.5 % off, not a new low: not enough for the 15 % rule, above the target price
        assert!(watch
            .evaluate("p1", "Pixel 9", "Shop", "u", &dear)
            .is_none());

        let off = Watch {
            enabled: false,
            ..watch.clone()
        };
        assert!(off.evaluate("p1", "Pixel 9", "Shop", "u", &great).is_none());

        let by_discount = Watch {
            max_price_cents: None,
            ..watch
        };
        let ev = by_discount
            .evaluate("p1", "Pixel 9", "Shop", "u", &great)
            .unwrap();
        assert_eq!(ev.kind, EventKind::NewLow);
    }

    #[test]
    fn repeats_need_a_real_further_drop() {
        assert!(!worth_repeating(50_000, 50_000));
        assert!(!worth_repeating(50_000, 49_500));
        assert!(worth_repeating(50_000, 49_000));
    }
}
