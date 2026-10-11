//! Turn a scraped offer (any title, any pack size) into a comparable [`PriceQuote`].

use financer_core::{by_key, match_product, reference_milli, Chain, Money, PriceQuote};
use serde::Serialize;
use time::Date;

use crate::size::parse_pack_size;

/// One product as found on a source, before it is mapped onto the catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawOffer {
    pub chain: Chain,
    pub name: String,
    /// Shelf price of one pack as listed.
    pub price: Money,
    /// Size text from a separate field (`500 g`), if the source has one.
    pub pack_text: Option<String>,
    pub valid_until: Option<Date>,
    pub is_offer: bool,
    /// Which source produced it, for diagnostics.
    pub source: String,
    /// Catalog key when the source already knows what this is (e.g. a configured barcode);
    /// otherwise the title is matched against the catalog.
    pub item_hint: Option<String>,
}

/// A quote plus the detail the UI shows ("Barilla Spaghetti 500 g, 1,29 €").
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QuoteDetail {
    #[serde(flatten)]
    pub quote: PriceQuote,
    pub product_name: String,
    pub shelf_price: Money,
    pub source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Skip {
    /// The title matches no catalog item.
    Unmatched,
    /// No pack size could be read, so the price cannot be compared.
    NoSize,
    /// The size is in a different dimension than the item (kg vs l vs pieces).
    SizeMismatch,
    BadPrice,
}

pub fn normalize(raw: &RawOffer) -> Result<QuoteDetail, Skip> {
    if raw.price.cents() <= 0 {
        return Err(Skip::BadPrice);
    }
    let item = match raw.item_hint.as_deref() {
        Some(key) => by_key(key),
        None => match_product(&raw.name),
    }
    .ok_or(Skip::Unmatched)?;
    let size = raw
        .pack_text
        .as_deref()
        .and_then(parse_pack_size)
        .or_else(|| parse_pack_size(&raw.name))
        .ok_or(Skip::NoSize)?;
    if size.unit != item.unit {
        return Err(Skip::SizeMismatch);
    }
    // price of the reference pack = shelf price * reference / pack size, rounded to the cent
    let cents = (raw.price.cents() as i128 * reference_milli(item.key) as i128 * 2
        + size.milli as i128)
        / (size.milli as i128 * 2);
    Ok(QuoteDetail {
        quote: PriceQuote {
            item: item.key.to_string(),
            chain: raw.chain,
            price: Money::from_cents(cents as i64),
            valid_until: raw.valid_until,
            is_offer: raw.is_offer,
        },
        product_name: raw.name.clone(),
        shelf_price: raw.price,
        source: raw.source.clone(),
    })
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct NormalizeReport {
    pub accepted: usize,
    pub unmatched: usize,
    pub no_size: usize,
    pub size_mismatch: usize,
    pub bad_price: usize,
}

pub fn normalize_all(raws: &[RawOffer]) -> (Vec<QuoteDetail>, NormalizeReport) {
    let mut report = NormalizeReport::default();
    let mut out = Vec::new();
    for raw in raws {
        match normalize(raw) {
            Ok(q) => {
                report.accepted += 1;
                out.push(q);
            }
            Err(Skip::Unmatched) => report.unmatched += 1,
            Err(Skip::NoSize) => report.no_size += 1,
            Err(Skip::SizeMismatch) => report.size_mismatch += 1,
            Err(Skip::BadPrice) => report.bad_price += 1,
        }
    }
    (out, report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(name: &str, cents: i64, pack: Option<&str>) -> RawOffer {
        RawOffer {
            chain: Chain::Aldi,
            name: name.into(),
            price: Money::from_cents(cents),
            pack_text: pack.map(str::to_string),
            valid_until: None,
            is_offer: false,
            source: "test".into(),
            item_hint: None,
        }
    }

    #[test]
    fn different_pack_sizes_become_comparable() {
        // 1 kg of pasta at 1,98 and 500 g at 0,89 -> reference pack is 500 g
        let big = normalize(&raw("Spaghetti 1 kg", 198, None)).unwrap();
        let small = normalize(&raw("Spaghetti 500 g", 89, None)).unwrap();
        assert_eq!(big.quote.item, "nudeln");
        assert_eq!(big.quote.price, Money::from_cents(99));
        assert_eq!(small.quote.price, Money::from_cents(89));
    }

    #[test]
    fn rounds_to_nearest_cent() {
        // 250 g butter for 1,79 -> reference 250 g -> unchanged; 750 ml milk at 0,89 -> 1 l = 1,187 -> 1,19
        assert_eq!(
            normalize(&raw("Butter 250g", 179, None))
                .unwrap()
                .quote
                .price,
            Money::from_cents(179)
        );
        assert_eq!(
            normalize(&raw("Vollmilch 750ml", 89, None))
                .unwrap()
                .quote
                .price,
            Money::from_cents(119)
        );
    }

    #[test]
    fn separate_pack_field_wins_over_title() {
        let q = normalize(&raw("Barilla Spaghetti n. 5", 129, Some("500 g"))).unwrap();
        assert_eq!(q.quote.price, Money::from_cents(129));
        assert_eq!(q.product_name, "Barilla Spaghetti n. 5");
        assert_eq!(q.shelf_price, Money::from_cents(129));
    }

    #[test]
    fn eggs_are_compared_per_ten() {
        let q = normalize(&raw("Freilandeier 6 Stück", 159, None)).unwrap();
        assert_eq!(q.quote.item, "eier");
        assert_eq!(q.quote.price, Money::from_cents(265)); // 1,59 * 10 / 6
    }

    #[test]
    fn item_hint_overrides_title_matching() {
        let mut r = raw("Spezialität 500 g", 199, None);
        assert_eq!(normalize(&r), Err(Skip::Unmatched));
        r.item_hint = Some("nudeln".into());
        assert_eq!(normalize(&r).unwrap().quote.item, "nudeln");
        r.item_hint = Some("gibt-es-nicht".into());
        assert_eq!(normalize(&r), Err(Skip::Unmatched));
    }

    #[test]
    fn skips_with_a_reason() {
        assert_eq!(
            normalize(&raw("Playstation 5", 49900, None)),
            Err(Skip::Unmatched)
        );
        assert_eq!(normalize(&raw("Spaghetti", 89, None)), Err(Skip::NoSize));
        assert_eq!(
            normalize(&raw("Spaghetti 1 l", 89, None)),
            Err(Skip::SizeMismatch)
        );
        assert_eq!(
            normalize(&raw("Spaghetti 500g", 0, None)),
            Err(Skip::BadPrice)
        );
    }

    #[test]
    fn report_counts_everything() {
        let raws = vec![
            raw("Spaghetti 500 g", 89, None),
            raw("Playstation 5", 1, None),
            raw("Spaghetti", 89, None),
            raw("Spaghetti 1 l", 89, None),
            raw("Spaghetti 500g", -5, None),
        ];
        let (quotes, report) = normalize_all(&raws);
        assert_eq!(quotes.len(), 1);
        assert_eq!(
            report,
            NormalizeReport {
                accepted: 1,
                unmatched: 1,
                no_size: 1,
                size_mismatch: 1,
                bad_price: 1
            }
        );
    }
}
