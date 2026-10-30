//! Product feeds: a CSV or JSON export with a column mapping. Large catalogs (and subscription
//! tariff lists) come this way far more reliably than from scraping pages.

use std::collections::BTreeMap;

use financer_shop_core::{Condition, Recurring};
use serde_json::Value;

use crate::config::{FeedFormat, FeedMapping};
use crate::extract::{price_to_cents, web_url, Extracted};

fn rows(body: &str, format: FeedFormat) -> Result<Vec<BTreeMap<String, String>>, String> {
    match format {
        FeedFormat::Csv => {
            let first = body.lines().next().unwrap_or("");
            let delimiter = b";\t,|"
                .iter()
                .copied()
                .max_by_key(|d| first.matches(*d as char).count())
                .unwrap_or(b',');
            let mut reader = csv::ReaderBuilder::new()
                .delimiter(delimiter)
                .flexible(true)
                .from_reader(body.trim_start_matches('\u{feff}').as_bytes());
            let headers: Vec<String> = reader
                .headers()
                .map_err(|e| format!("feed header: {e}"))?
                .iter()
                .map(|h| h.trim().to_string())
                .collect();
            Ok(reader
                .records()
                .filter_map(Result::ok)
                .map(|rec| {
                    headers
                        .iter()
                        .cloned()
                        .zip(rec.iter().map(|v| v.trim().to_string()))
                        .collect()
                })
                .collect())
        }
        FeedFormat::Json => {
            let v: Value = serde_json::from_str(body).map_err(|e| format!("feed JSON: {e}"))?;
            let items = match &v {
                Value::Array(a) => a.clone(),
                Value::Object(o) => o
                    .values()
                    .find_map(|x| x.as_array().cloned())
                    .ok_or("feed JSON has no list of products")?,
                _ => return Err("feed JSON has no list of products".into()),
            };
            Ok(items
                .iter()
                .filter_map(Value::as_object)
                .map(|o| {
                    o.iter()
                        .filter_map(|(k, v)| match v {
                            Value::String(s) => Some((k.clone(), s.trim().to_string())),
                            Value::Number(n) => Some((k.clone(), n.to_string())),
                            Value::Bool(b) => Some((k.clone(), b.to_string())),
                            _ => None,
                        })
                        .collect()
                })
                .collect())
        }
    }
}

fn truthy(v: &str) -> bool {
    let v = v.trim().to_lowercase();
    !matches!(
        v.as_str(),
        "" | "0"
            | "no"
            | "nein"
            | "false"
            | "out of stock"
            | "out_of_stock"
            | "nicht verfügbar"
            | "outofstock"
    )
}

/// Products of a feed, skipping rows without title or a readable price.
pub fn parse_feed(
    body: &str,
    format: FeedFormat,
    m: &FeedMapping,
    fallback_url: &str,
) -> Result<Vec<Extracted>, String> {
    let rows = rows(body, format)?;
    let used: Vec<&str> = [
        Some(m.title.as_str()),
        Some(m.price.as_str()),
        m.url.as_deref(),
        m.brand.as_deref(),
        m.gtin.as_deref(),
        m.image.as_deref(),
        m.list_price.as_deref(),
        m.availability.as_deref(),
        m.condition.as_deref(),
        m.category.as_deref(),
        m.monthly.as_deref(),
        m.min_term_months.as_deref(),
        m.promo_months.as_deref(),
        m.promo_monthly.as_deref(),
        m.setup.as_deref(),
        m.cashback.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect();
    let mut out = Vec::new();
    for row in rows {
        let get = |col: &Option<String>| {
            col.as_ref()
                .and_then(|c| row.get(c))
                .filter(|v| !v.is_empty())
        };
        let Some(title) = row.get(&m.title).filter(|t| !t.is_empty()) else {
            continue;
        };
        let monthly = get(&m.monthly).and_then(|v| price_to_cents(v));
        let price = row.get(&m.price).and_then(|v| price_to_cents(v));
        let recurring = monthly.map(|monthly_cents| Recurring {
            monthly_cents,
            min_term_months: get(&m.min_term_months)
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0),
            promo_months: get(&m.promo_months)
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0),
            promo_monthly_cents: get(&m.promo_monthly).and_then(|v| price_to_cents(v)),
            setup_cents: get(&m.setup).and_then(|v| price_to_cents(v)).unwrap_or(0),
            cashback_cents: get(&m.cashback)
                .and_then(|v| price_to_cents(v))
                .unwrap_or(0),
        });
        let Some(price_cents) = price.or(monthly) else {
            continue;
        };
        let specs: Vec<(String, String)> = row
            .iter()
            .filter(|(k, v)| {
                !v.is_empty()
                    && if m.specs.is_empty() {
                        !used.contains(&k.as_str())
                    } else {
                        m.specs.contains(k)
                    }
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        out.push(Extracted {
            url: get(&m.url)
                .and_then(|u| web_url(u))
                .unwrap_or_else(|| fallback_url.to_string()),
            title: title.clone(),
            brand: get(&m.brand).cloned(),
            gtin: get(&m.gtin).cloned(),
            image: get(&m.image).cloned(),
            currency: None,
            price_cents: Some(price_cents),
            list_price_cents: get(&m.list_price).and_then(|v| price_to_cents(v)),
            in_stock: get(&m.availability).map(|v| truthy(v)),
            condition: get(&m.condition).map(|c| {
                let c = c.to_lowercase();
                if c.contains("refurb") || c.contains("generalüberholt") {
                    Condition::Refurbished
                } else if c.contains("used") || c.contains("gebraucht") {
                    Condition::Used
                } else {
                    Condition::New
                }
            }),
            category: get(&m.category).cloned(),
            recurring,
            specs,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping() -> FeedMapping {
        FeedMapping {
            title: "name".into(),
            price: "price".into(),
            url: Some("link".into()),
            brand: Some("brand".into()),
            gtin: Some("ean".into()),
            availability: Some("stock".into()),
            list_price: Some("uvp".into()),
            ..FeedMapping::default()
        }
    }

    #[test]
    fn reads_a_semicolon_csv_with_german_prices_and_extra_columns_as_specs() {
        let csv = "\u{feff}name;price;link;brand;ean;stock;uvp;Akku;Farbe\n\
                   Pixel 9;649,00;https://s.test/p/1;Google;0840353930011;in stock;799,00;4700 mAh;schwarz\n\
                   Kaputt;kein Preis;https://s.test/p/2;X;;1;;;\n\
                   ;10,00;;;;;;;\n\
                   Pixel 8;399,00;https://s.test/p/3;Google;;0;;4575 mAh;\n";
        let items = parse_feed(csv, FeedFormat::Csv, &mapping(), "https://s.test/feed").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].price_cents, Some(64_900));
        assert_eq!(items[0].list_price_cents, Some(79_900));
        assert_eq!(items[0].in_stock, Some(true));
        assert_eq!(
            items[0].specs,
            [
                ("Akku".to_string(), "4700 mAh".to_string()),
                ("Farbe".to_string(), "schwarz".to_string())
            ]
        );
        assert_eq!(items[1].in_stock, Some(false));
        assert_eq!(
            items[1].specs,
            [("Akku".to_string(), "4575 mAh".to_string())]
        );
    }

    #[test]
    fn reads_json_feeds_and_only_the_listed_spec_columns() {
        let json = r#"{"items": [{"name": "Tarif M", "price": 0, "monthly": "19,99", "term": 24, "promo_n": 6, "promo": "9,99", "setup": "29,99", "data": "unbegrenzt", "junk": "x"}]}"#;
        let m = FeedMapping {
            title: "name".into(),
            price: "price".into(),
            monthly: Some("monthly".into()),
            min_term_months: Some("term".into()),
            promo_months: Some("promo_n".into()),
            promo_monthly: Some("promo".into()),
            setup: Some("setup".into()),
            specs: vec!["data".into()],
            ..FeedMapping::default()
        };
        let items = parse_feed(json, FeedFormat::Json, &m, "https://t.test/feed").unwrap();
        let r = items[0].recurring.clone().unwrap();
        assert_eq!(
            (
                r.monthly_cents,
                r.min_term_months,
                r.promo_months,
                r.promo_monthly_cents,
                r.setup_cents
            ),
            (1_999, 24, 6, Some(999), 2_999)
        );
        assert_eq!(
            items[0].specs,
            [("data".to_string(), "unbegrenzt".to_string())]
        );
        assert_eq!(items[0].url, "https://t.test/feed");
    }

    #[test]
    fn a_feed_link_that_is_not_a_web_address_is_replaced_by_the_feed_address() {
        let csv = "name,price,link\nA,1.00,javascript:alert(1)\nB,2.00,https://x.test/b\n";
        let m = FeedMapping {
            title: "name".into(),
            price: "price".into(),
            url: Some("link".into()),
            ..FeedMapping::default()
        };
        let items = parse_feed(csv, FeedFormat::Csv, &m, "https://x.test/feed").unwrap();
        assert_eq!(items[0].url, "https://x.test/feed");
        assert_eq!(items[1].url, "https://x.test/b");
    }

    #[test]
    fn bad_feeds_are_errors_not_panics() {
        assert!(parse_feed("{nope", FeedFormat::Json, &mapping(), "u").is_err());
        assert!(parse_feed("5", FeedFormat::Json, &mapping(), "u").is_err());
        assert!(parse_feed("", FeedFormat::Csv, &mapping(), "u")
            .unwrap()
            .is_empty());
    }
}
