//! Products, offers and recurring prices (phone plans, streaming, internet).

use serde::{Deserialize, Serialize};

use crate::value::{AttrValue, Attributes};

/// Months compared when a recurring price has no longer commitment.
pub const DEFAULT_HORIZON_MONTHS: u32 = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Condition {
    #[default]
    New,
    Refurbished,
    Used,
}

/// The running costs of a subscription or a contract: what a "price" means for a plan.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Recurring {
    pub monthly_cents: i64,
    /// Months you are bound for; 0 for monthly cancellable.
    #[serde(default)]
    pub min_term_months: u32,
    /// The first months cost `promo_monthly_cents` instead (introductory price).
    #[serde(default)]
    pub promo_months: u32,
    #[serde(default)]
    pub promo_monthly_cents: Option<i64>,
    /// Connection / activation fee, paid once.
    #[serde(default)]
    pub setup_cents: i64,
    /// Cash back or a bonus that reduces the total.
    #[serde(default)]
    pub cashback_cents: i64,
}

impl Recurring {
    /// Months the comparison covers: the horizon, but never less than what you are bound for.
    pub fn months(&self, horizon: u32) -> u32 {
        horizon.max(self.min_term_months).max(1)
    }

    /// Recurring part only: promo months at the promo price, the rest at the normal price.
    pub fn running_cents(&self, months: u32) -> i64 {
        let promo = self.promo_months.min(months);
        let promo_price = self.promo_monthly_cents.unwrap_or(self.monthly_cents);
        i64::from(promo) * promo_price + i64::from(months - promo) * self.monthly_cents
    }
}

/// A price for a product at one shop. For a plan `price_cents` is what is due up front (a phone
/// with a contract has one; a SIM-only plan has none) and `recurring` the running costs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Offer {
    pub shop: String,
    pub url: String,
    pub price_cents: i64,
    #[serde(default = "eur")]
    pub currency: String,
    #[serde(default)]
    pub shipping_cents: i64,
    #[serde(default = "yes")]
    pub in_stock: bool,
    #[serde(default)]
    pub condition: Condition,
    /// The struck-through "was" price the shop shows, if any.
    #[serde(default)]
    pub list_price_cents: Option<i64>,
    #[serde(default)]
    pub recurring: Option<Recurring>,
    /// Unix seconds when we saw this price.
    #[serde(default)]
    pub seen_at: i64,
}

fn eur() -> String {
    "EUR".into()
}
fn yes() -> bool {
    true
}

impl Offer {
    pub fn one_time(shop: &str, url: &str, price_cents: i64) -> Offer {
        Offer {
            shop: shop.into(),
            url: url.into(),
            price_cents,
            currency: eur(),
            shipping_cents: 0,
            in_stock: true,
            condition: Condition::New,
            list_price_cents: None,
            recurring: None,
            seen_at: 0,
        }
    }

    pub fn plan(shop: &str, url: &str, recurring: Recurring) -> Offer {
        Offer {
            recurring: Some(recurring),
            ..Offer::one_time(shop, url, 0)
        }
    }

    /// Everything you pay over `horizon` months: up front, shipping, fees and running costs, minus
    /// cash back. For a plain purchase that is price plus shipping.
    pub fn total_cents(&self, horizon: u32) -> i64 {
        let base = self.price_cents + self.shipping_cents;
        match &self.recurring {
            None => base,
            Some(r) => base + r.setup_cents + r.running_cents(r.months(horizon)) - r.cashback_cents,
        }
    }

    /// The total spread over the months it covers; `None` for a plain purchase.
    pub fn effective_monthly_cents(&self, horizon: u32) -> Option<i64> {
        let r = self.recurring.as_ref()?;
        let months = i64::from(r.months(horizon));
        Some((self.total_cents(horizon) + months / 2) / months)
    }

    /// The comparable price: the total for purchases, the effective monthly cost for plans.
    pub fn comparable_cents(&self, horizon: u32) -> i64 {
        self.effective_monthly_cents(horizon)
            .unwrap_or_else(|| self.total_cents(horizon))
    }

    /// Percent below the list price, if the shop shows one.
    pub fn discount_pct(&self) -> Option<f64> {
        let list = self
            .list_price_cents
            .filter(|l| *l > self.price_cents && self.recurring.is_none())?;
        Some((list - self.price_cents) as f64 * 100.0 / list as f64)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Product {
    pub id: String,
    pub category: String,
    pub title: String,
    #[serde(default)]
    pub brand: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub gtin: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    /// Open specification map: any key, no code change needed to add one.
    #[serde(default)]
    pub attributes: Attributes,
    #[serde(default)]
    pub offers: Vec<Offer>,
    #[serde(default)]
    pub tags: Vec<String>,
}

impl Product {
    pub fn new(category: &str, title: &str) -> Product {
        Product {
            id: Self::make_id(category, None, title),
            category: category.into(),
            title: title.into(),
            brand: None,
            model: None,
            gtin: None,
            image: None,
            attributes: Attributes::new(),
            offers: Vec::new(),
            tags: Vec::new(),
        }
    }

    /// A stable id from category, brand and title, so the same product found on two shops (or in
    /// two crawls) is one product. Colours and filler words are ignored.
    pub fn make_id(category: &str, brand: Option<&str>, title: &str) -> String {
        let mut words = crate::text::canonical_tokens(title);
        if let Some(b) = brand {
            let b = crate::text::canonical_tokens(b);
            if let Some(first) = b.first() {
                if words.first() != Some(first) {
                    words.insert(0, first.clone());
                }
            }
        }
        format!("{}:{}", category, words.join("-"))
    }

    /// The id for a product with a known GTIN/EAN: the same everywhere, whatever the shop calls it.
    pub fn id_for_gtin(category: &str, gtin: &str) -> String {
        let digits: String = gtin.chars().filter(char::is_ascii_digit).collect();
        format!("{category}:gtin-{}", digits.trim_start_matches('0'))
    }

    pub fn with(mut self, key: &str, value: impl Into<AttrValue>) -> Product {
        self.attributes.insert(key.into(), value.into());
        self
    }

    pub fn with_brand(mut self, brand: &str) -> Product {
        self.brand = Some(brand.into());
        self
    }

    pub fn with_offer(mut self, offer: Offer) -> Product {
        self.offers.push(offer);
        self
    }

    /// The offers a profile would consider, cheapest first.
    pub fn usable_offers<'a>(
        &'a self,
        allowed: &[Condition],
        in_stock_only: bool,
        horizon: u32,
    ) -> Vec<&'a Offer> {
        let mut offers: Vec<&Offer> = self
            .offers
            .iter()
            .filter(|o| allowed.is_empty() || allowed.contains(&o.condition))
            .filter(|o| !in_stock_only || o.in_stock)
            .collect();
        offers.sort_by_key(|o| o.comparable_cents(horizon));
        offers
    }

    /// Add or refresh an offer: one per shop, URL and condition.
    pub fn upsert_offer(&mut self, offer: Offer) {
        match self
            .offers
            .iter_mut()
            .find(|o| o.shop == offer.shop && o.url == offer.url && o.condition == offer.condition)
        {
            Some(existing) => *existing = offer,
            None => self.offers.push(offer),
        }
    }

    /// Fill what this product lacks from another record of the same product (never overwrite).
    pub fn merge_missing(&mut self, other: &Product) {
        for (k, v) in &other.attributes {
            self.attributes
                .entry(k.clone())
                .or_insert_with(|| v.clone());
        }
        if self.brand.is_none() {
            self.brand = other.brand.clone();
        }
        if self.model.is_none() {
            self.model = other.model.clone();
        }
        if self.gtin.is_none() {
            self.gtin = other.gtin.clone();
        }
        if self.image.is_none() {
            self.image = other.image.clone();
        }
        for t in &other.tags {
            if !self.tags.contains(t) {
                self.tags.push(t.clone());
            }
        }
        for o in &other.offers {
            self.upsert_offer(o.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(monthly: i64) -> Recurring {
        Recurring {
            monthly_cents: monthly,
            ..Recurring::default()
        }
    }

    #[test]
    fn a_purchase_costs_price_plus_shipping() {
        let mut o = Offer::one_time("a", "u", 49_900);
        o.shipping_cents = 495;
        assert_eq!(o.total_cents(24), 50_395);
        assert_eq!(o.effective_monthly_cents(24), None);
        assert_eq!(o.comparable_cents(24), 50_395);
    }

    #[test]
    fn a_plan_counts_promo_fee_and_cashback_over_the_horizon() {
        let r = Recurring {
            monthly_cents: 2_000,
            min_term_months: 24,
            promo_months: 6,
            promo_monthly_cents: Some(1_000),
            setup_cents: 3_995,
            cashback_cents: 5_000,
        };
        // 6 * 10 + 18 * 20 = 420 EUR running, + 39.95 fee - 50 cash back
        let o = Offer::plan("telco", "u", r);
        assert_eq!(o.total_cents(12), 42_000 + 3_995 - 5_000); // bound for 24 months
        assert_eq!(
            o.effective_monthly_cents(12),
            Some(((42_000 + 3_995 - 5_000) + 12) / 24)
        );
    }

    #[test]
    fn a_short_commitment_is_compared_over_the_horizon() {
        let o = Offer::plan("t", "u", plan(1_500));
        assert_eq!(o.total_cents(24), 36_000);
        assert_eq!(o.effective_monthly_cents(24), Some(1_500));
    }

    #[test]
    fn phone_with_contract_has_upfront_and_running_costs() {
        let mut o = Offer::plan(
            "t",
            "u",
            Recurring {
                min_term_months: 24,
                ..plan(3_000)
            },
        );
        o.price_cents = 10_000;
        assert_eq!(o.total_cents(24), 10_000 + 72_000);
    }

    #[test]
    fn discount_is_measured_against_the_list_price() {
        let mut o = Offer::one_time("a", "u", 75_000);
        o.list_price_cents = Some(100_000);
        assert_eq!(o.discount_pct(), Some(25.0));
        o.list_price_cents = Some(70_000);
        assert_eq!(o.discount_pct(), None);
    }

    #[test]
    fn offers_are_sorted_filtered_and_upserted() {
        let mut p = Product::new("smartphone", "Pixel 9")
            .with_offer(Offer::one_time("a", "ua", 60_000))
            .with_offer(Offer::one_time("b", "ub", 55_000));
        let mut out = Offer::one_time("c", "uc", 50_000);
        out.in_stock = false;
        p.offers.push(out);
        let usable = p.usable_offers(&[Condition::New], true, 24);
        assert_eq!(
            usable.iter().map(|o| o.shop.as_str()).collect::<Vec<_>>(),
            ["b", "a"]
        );
        p.upsert_offer(Offer::one_time("b", "ub", 52_000));
        assert_eq!(p.offers.len(), 3);
        assert_eq!(p.offers[1].price_cents, 52_000);
    }

    #[test]
    fn same_product_gets_the_same_id() {
        assert_eq!(
            Product::make_id("smartphone", Some("Google"), "Google Pixel 9 (128 GB)"),
            Product::make_id("smartphone", None, "google pixel 9 128 gb")
        );
    }

    #[test]
    fn colours_and_filler_do_not_split_products() {
        assert_eq!(
            Product::make_id(
                "smartphone",
                Some("Google"),
                "Google Pixel 9 Smartphone 128GB Obsidian"
            ),
            Product::make_id("smartphone", None, "Google Pixel 9 128 GB schwarz")
        );
        assert_ne!(
            Product::make_id("smartphone", None, "Pixel 9 128GB"),
            Product::make_id("smartphone", None, "Pixel 9 256GB")
        );
        assert_eq!(
            Product::id_for_gtin("smartphone", "0840-1234"),
            "smartphone:gtin-8401234"
        );
    }

    #[test]
    fn merging_fills_gaps_and_keeps_existing_values() {
        let mut a = Product::new("smartphone", "Pixel 9").with("ram_gb", 12.0);
        let b = Product::new("smartphone", "Pixel 9")
            .with("ram_gb", 8.0)
            .with("nfc", true)
            .with_offer(Offer::one_time("x", "u", 1));
        a.merge_missing(&b);
        assert_eq!(a.attributes["ram_gb"], AttrValue::Num(12.0));
        assert_eq!(a.attributes["nfc"], AttrValue::Bool(true));
        assert_eq!(a.offers.len(), 1);
    }
}
