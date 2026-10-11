//! Open Food Facts (product names, barcodes, pack sizes) and Open Prices (crowdsourced shelf
//! prices). Response shapes follow the public API documentation; the `--probe-prices`
//! command of the server checks them against the live services.

use financer_core::Money;
use serde_json::Value;
use time::{macros::format_description, Date};

pub const OFF_BASE: &str = "https://world.openfoodfacts.org";
pub const OPEN_PRICES_BASE: &str = "https://prices.openfoodfacts.org";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OffProduct {
    pub code: String,
    pub name: String,
    pub brands: Option<String>,
    /// Pack size as printed, e.g. `500 g`.
    pub quantity: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenPrice {
    pub product_code: String,
    pub price: Money,
    pub date: Date,
    /// Name of the store the price was seen in, if recorded.
    pub store: Option<String>,
}

/// Request URLs and response parsers for Open Food Facts and Open Prices.
pub struct OpenFoodFacts;

impl OpenFoodFacts {
    pub fn product_url(code: &str) -> String {
        format!("{OFF_BASE}/api/v2/product/{code}.json?fields=code,product_name,brands,quantity")
    }

    pub fn search_url(terms: &str) -> String {
        let encoded: String = url::form_urlencoded::byte_serialize(terms.as_bytes()).collect();
        format!("{OFF_BASE}/cgi/search.pl?search_terms={encoded}&search_simple=1&action=process&json=1&page_size=10&fields=code,product_name,brands,quantity")
    }

    pub fn open_prices_url(code: &str) -> String {
        format!(
            "{OPEN_PRICES_BASE}/api/v1/prices?product_code={code}&currency=EUR&order_by=-date&size=20"
        )
    }

    fn str_field(v: &Value, key: &str) -> Option<String> {
        v.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }

    fn product_from(v: &Value) -> Option<OffProduct> {
        Some(OffProduct {
            code: Self::str_field(v, "code")?,
            name: Self::str_field(v, "product_name")?,
            brands: Self::str_field(v, "brands"),
            quantity: Self::str_field(v, "quantity"),
        })
    }

    /// `GET /api/v2/product/{code}.json`: `{"status":1,"product":{...}}`; `None` when unknown.
    pub fn parse_product(json: &str) -> Option<OffProduct> {
        let v: Value = serde_json::from_str(json).ok()?;
        if v.get("status").and_then(Value::as_i64) == Some(0) {
            return None;
        }
        let mut p = Self::product_from(v.get("product")?)?;
        if p.code.is_empty() {
            p.code = Self::str_field(&v, "code")?;
        }
        Some(p)
    }

    /// Search results: `{"products":[...]}`. Entries without a name are dropped.
    pub fn parse_search(json: &str) -> Vec<OffProduct> {
        serde_json::from_str::<Value>(json)
            .ok()
            .and_then(|v| {
                v.get("products")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Self::product_from).collect())
            })
            .unwrap_or_default()
    }

    /// Open Prices: `{"items":[{"product_code","price","currency","date","location":{...}}]}`.
    /// Only EUR prices are kept; the price is read from its decimal text, not via f64 math.
    pub fn parse_open_prices(json: &str) -> Vec<OpenPrice> {
        let Some(v) = serde_json::from_str::<Value>(json).ok() else {
            return Vec::new();
        };
        let Some(items) = v.get("items").and_then(Value::as_array) else {
            return Vec::new();
        };
        items
            .iter()
            .filter_map(|it| {
                if it
                    .get("currency")
                    .and_then(Value::as_str)
                    .is_some_and(|c| !c.eq_ignore_ascii_case("EUR"))
                {
                    return None;
                }
                let price = match it.get("price")? {
                    Value::Number(n) => Money::parse(&n.to_string()).ok()?,
                    Value::String(s) => Money::parse(s).ok()?,
                    _ => return None,
                };
                let date = Date::parse(
                    it.get("date")?.as_str()?.get(..10)?,
                    format_description!("[year]-[month]-[day]"),
                )
                .ok()?;
                let loc = it.get("location");
                let store = loc
                    .and_then(|l| {
                        Self::str_field(l, "osm_name").or_else(|| Self::str_field(l, "name"))
                    })
                    .or_else(|| Self::str_field(it, "location_name"));
                Some(OpenPrice {
                    product_code: Self::str_field(it, "product_code")?,
                    price,
                    date,
                    store,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn parses_product_lookup() {
        let json = r#"{"code":"4001234567890","status":1,"product":{"code":"4001234567890","product_name":"Spaghetti","brands":"Barilla","quantity":"500 g"}}"#;
        let p = OpenFoodFacts::parse_product(json).unwrap();
        assert_eq!(
            (p.code.as_str(), p.name.as_str(), p.quantity.as_deref()),
            ("4001234567890", "Spaghetti", Some("500 g"))
        );
        assert_eq!(p.brands.as_deref(), Some("Barilla"));
    }

    #[test]
    fn unknown_or_nameless_products_are_none() {
        assert_eq!(
            OpenFoodFacts::parse_product(r#"{"status":0,"status_verbose":"product not found"}"#),
            None
        );
        assert_eq!(
            OpenFoodFacts::parse_product(
                r#"{"status":1,"product":{"code":"1","product_name":""}}"#
            ),
            None
        );
        assert_eq!(OpenFoodFacts::parse_product("not json"), None);
    }

    #[test]
    fn parses_search_results_and_drops_nameless_entries() {
        let json = r#"{"count":3,"products":[
            {"code":"1","product_name":"Vollmilch","quantity":"1 l"},
            {"code":"2","product_name":""},
            {"code":"3","product_name":"H-Milch","brands":"Weihenstephan"}]}"#;
        let r = OpenFoodFacts::parse_search(json);
        assert_eq!(
            r.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            vec!["Vollmilch", "H-Milch"]
        );
        assert!(OpenFoodFacts::parse_search("{}").is_empty());
    }

    #[test]
    fn parses_open_prices_in_euro_only() {
        let json = r#"{"items":[
            {"product_code":"1","price":1.29,"currency":"EUR","date":"2026-03-01","location":{"osm_name":"REWE City"}},
            {"product_code":"1","price":"1,19","currency":"EUR","date":"2026-02-20T10:00:00Z"},
            {"product_code":"1","price":1.99,"currency":"USD","date":"2026-02-01"},
            {"product_code":"1","price":-1,"currency":"EUR","date":"bad"}],"total":4}"#;
        let r = OpenFoodFacts::parse_open_prices(json);
        assert_eq!(r.len(), 2);
        assert_eq!(
            (r[0].price, r[0].date, r[0].store.as_deref()),
            (
                Money::from_cents(129),
                date!(2026 - 03 - 01),
                Some("REWE City")
            )
        );
        assert_eq!(
            (r[1].price, r[1].store.clone()),
            (Money::from_cents(119), None)
        );
    }

    #[test]
    fn urls_are_well_formed() {
        assert!(OpenFoodFacts::product_url("123").contains("/api/v2/product/123.json"));
        assert!(
            OpenFoodFacts::search_url("Bio Milch & Co").contains("search_terms=Bio+Milch+%26+Co")
        );
        assert!(OpenFoodFacts::open_prices_url("123").contains("product_code=123"));
    }
}
