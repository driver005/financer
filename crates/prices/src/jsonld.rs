//! Offers from schema.org JSON-LD embedded in HTML (`<script type="application/ld+json">`).
//! This is a published standard, so one extractor serves any shop that uses it.

use financer_core::{Chain, Money};
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;
use time::{format_description::BorrowedFormatItem, macros::format_description, Date};

use crate::normalize::RawOffer;

const DATE: &[BorrowedFormatItem<'static>] = format_description!("[year]-[month]-[day]");

/// Extracts offers from schema.org JSON-LD blocks.
pub struct JsonLd;

impl JsonLd {
    fn script_re() -> &'static Regex {
        static R: OnceLock<Regex> = OnceLock::new();
        R.get_or_init(|| {
            Regex::new(
                r#"(?is)<script[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>"#,
            )
            .expect("valid regex")
        })
    }

    fn has_type(v: &Value, wanted: &str) -> bool {
        match v.get("@type") {
            Some(Value::String(s)) => s == wanted,
            Some(Value::Array(a)) => a.iter().any(|t| t.as_str() == Some(wanted)),
            _ => false,
        }
    }

    fn text_of(v: &Value) -> Option<String> {
        match v {
            Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    }

    fn price_of(v: &Value) -> Option<Money> {
        // A JSON number is read from its decimal text, never via f64 arithmetic.
        Money::parse(&Self::text_of(v)?).ok()
    }

    fn date_of(v: &Value) -> Option<Date> {
        let s = v.as_str()?;
        Date::parse(s.get(..10)?, DATE).ok()
    }

    /// Size info from `size`, `weight` (text or QuantitativeValue) or `description`-free fields.
    fn pack_text(product: &Value) -> Option<String> {
        for key in ["size", "weight", "net_weight", "netContent"] {
            match product.get(key) {
                Some(Value::String(s)) if !s.trim().is_empty() => {
                    return Some(s.trim().to_string())
                }
                Some(obj @ Value::Object(_)) => {
                    let value = obj.get("value").and_then(Self::text_of);
                    let unit = obj
                        .get("unitText")
                        .or_else(|| obj.get("unitCode"))
                        .and_then(Self::text_of);
                    if let (Some(v), Some(u)) = (value, unit) {
                        return Some(format!("{v} {u}"));
                    }
                }
                _ => {}
            }
        }
        None
    }

    fn collect(node: &Value, chain: Chain, source: &str, is_offer: bool, out: &mut Vec<RawOffer>) {
        match node {
            Value::Array(items) => items
                .iter()
                .for_each(|n| Self::collect(n, chain, source, is_offer, out)),
            Value::Object(map) => {
                if let Some(graph) = map.get("@graph") {
                    Self::collect(graph, chain, source, is_offer, out);
                }
                if Self::has_type(node, "ItemList") {
                    if let Some(list) = map.get("itemListElement") {
                        Self::collect(list, chain, source, is_offer, out);
                    }
                }
                if Self::has_type(node, "ListItem") {
                    if let Some(item) = map.get("item") {
                        Self::collect(item, chain, source, is_offer, out);
                    }
                }
                if Self::has_type(node, "Product") {
                    Self::product(node, chain, source, is_offer, out);
                }
            }
            _ => {}
        }
    }

    fn product(p: &Value, chain: Chain, source: &str, is_offer: bool, out: &mut Vec<RawOffer>) {
        let Some(name) = p.get("name").and_then(Self::text_of) else {
            return;
        };
        let offers: Vec<&Value> = match p.get("offers") {
            Some(Value::Array(a)) => a.iter().collect(),
            Some(o @ Value::Object(_)) => vec![o],
            _ => return,
        };
        for o in offers {
            if let Some(cur) = o.get("priceCurrency").and_then(Value::as_str) {
                if !cur.eq_ignore_ascii_case("EUR") {
                    continue;
                }
            }
            // AggregateOffer carries lowPrice; take the lowest price the shop shows.
            let Some(price) = o
                .get("price")
                .and_then(Self::price_of)
                .or_else(|| o.get("lowPrice").and_then(Self::price_of))
            else {
                continue;
            };
            out.push(RawOffer {
                chain,
                name: name.clone(),
                price,
                pack_text: Self::pack_text(p),
                valid_until: o.get("priceValidUntil").and_then(Self::date_of),
                is_offer,
                source: source.to_string(),
                item_hint: None,
            });
        }
    }

    /// All priced products found in the page's JSON-LD blocks. Blocks that are not valid JSON are
    /// skipped, because real pages often contain a broken one.
    pub fn extract_offers(html: &str, chain: Chain, source: &str, is_offer: bool) -> Vec<RawOffer> {
        let mut out = Vec::new();
        for cap in Self::script_re().captures_iter(html) {
            if let Ok(json) = serde_json::from_str::<Value>(cap[1].trim()) {
                Self::collect(&json, chain, source, is_offer, &mut out);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    struct Pages;

    impl Pages {
        fn page(blocks: &[&str]) -> String {
            let scripts: String = blocks
                .iter()
                .map(|b| format!("<script type=\"application/ld+json\">{b}</script>"))
                .collect();
            format!("<html><head>{scripts}</head><body>x</body></html>")
        }
    }

    #[test]
    fn reads_a_single_product_with_offer() {
        let html = Pages::page(&[
            r#"{"@context":"https://schema.org","@type":"Product","name":"Spaghetti","size":"500 g",
            "offers":{"@type":"Offer","price":"0.89","priceCurrency":"EUR","priceValidUntil":"2026-03-08T00:00:00+01:00"}}"#,
        ]);
        let offers = JsonLd::extract_offers(&html, Chain::Lidl, "t", true);
        assert_eq!(offers.len(), 1);
        let o = &offers[0];
        assert_eq!(
            (o.name.as_str(), o.price, o.pack_text.as_deref()),
            ("Spaghetti", Money::from_cents(89), Some("500 g"))
        );
        assert_eq!(o.valid_until, Some(date!(2026 - 03 - 08)));
        assert!(o.is_offer && o.chain == Chain::Lidl);
    }

    #[test]
    fn walks_item_lists_and_graphs() {
        let html = Pages::page(&[
            r#"{"@type":"ItemList","itemListElement":[
                {"@type":"ListItem","position":1,"item":{"@type":"Product","name":"Milch 1 l","offers":{"@type":"Offer","price":1.19,"priceCurrency":"EUR"}}},
                {"@type":"ListItem","position":2,"item":{"@type":"Product","name":"Butter 250 g","offers":[{"@type":"Offer","price":"1,79","priceCurrency":"EUR"}]}}]}"#,
            r#"{"@graph":[{"@type":"Organization","name":"Shop"},{"@type":["Product","Thing"],"name":"Eier 10er","offers":{"@type":"AggregateOffer","lowPrice":"2.49","priceCurrency":"EUR"}}]}"#,
        ]);
        let offers = JsonLd::extract_offers(&html, Chain::Rewe, "t", false);
        let got: Vec<_> = offers
            .iter()
            .map(|o| (o.name.as_str(), o.price.cents()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("Milch 1 l", 119),
                ("Butter 250 g", 179),
                ("Eier 10er", 249)
            ]
        );
    }

    #[test]
    fn quantitative_value_size() {
        let html = Pages::page(&[
            r#"{"@type":"Product","name":"Mehl","weight":{"@type":"QuantitativeValue","value":1,"unitText":"kg"},
            "offers":{"@type":"Offer","price":"1.09","priceCurrency":"EUR"}}"#,
        ]);
        assert_eq!(
            JsonLd::extract_offers(&html, Chain::Aldi, "t", false)[0]
                .pack_text
                .as_deref(),
            Some("1 kg")
        );
    }

    #[test]
    fn ignores_foreign_currency_unpriced_and_broken_blocks() {
        let html = Pages::page(&[
            "{ this is not json",
            r#"{"@type":"Product","name":"Milk","offers":{"@type":"Offer","price":"1.00","priceCurrency":"USD"}}"#,
            r#"{"@type":"Product","name":"Brot","offers":{"@type":"Offer","availability":"InStock"}}"#,
            r#"{"@type":"Product","offers":{"@type":"Offer","price":"1.00","priceCurrency":"EUR"}}"#,
            r#"{"@type":"Product","name":"Salz 1 kg","offers":{"@type":"Offer","price":"0.19","priceCurrency":"EUR"}}"#,
        ]);
        let offers = JsonLd::extract_offers(&html, Chain::Kaufland, "t", false);
        assert_eq!(offers.len(), 1);
        assert_eq!(offers[0].name, "Salz 1 kg");
    }

    #[test]
    fn pages_without_json_ld_yield_nothing() {
        assert!(JsonLd::extract_offers(
            "<html><body>nothing</body></html>",
            Chain::Rewe,
            "t",
            false
        )
        .is_empty());
        assert!(JsonLd::extract_offers("", Chain::Rewe, "t", false).is_empty());
    }
}
