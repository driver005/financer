//! Reading a product out of a page: schema.org JSON-LD (the standard most shops publish for
//! search engines), plus the specification tables next to it.

use std::sync::OnceLock;

use financer_shop_core::value::leading_number;
use financer_shop_core::{CategorySchema, Condition, Offer, Product, Recurring};
use regex::Regex;
use serde_json::Value;

use crate::html;

/// One product as a page or feed states it, before it is matched to a category schema.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Extracted {
    pub url: String,
    pub title: String,
    pub brand: Option<String>,
    pub gtin: Option<String>,
    pub image: Option<String>,
    pub currency: Option<String>,
    pub price_cents: Option<i64>,
    pub list_price_cents: Option<i64>,
    pub in_stock: Option<bool>,
    pub condition: Option<Condition>,
    pub category: Option<String>,
    pub recurring: Option<Recurring>,
    /// Label and value as the page writes them; the schema maps them to attributes.
    pub specs: Vec<(String, String)>,
}

/// Dollars-and-cents text to cents without going through float arithmetic on the result.
pub fn price_to_cents(text: &str) -> Option<i64> {
    let n = leading_number(text)?;
    (n.is_finite() && (0.0..10_000_000.0).contains(&n)).then(|| (n * 100.0).round() as i64)
}

impl Extracted {
    /// Match against the schema: specs become attributes, derived attributes are filled, and the
    /// offer is attached. Returns the labels the schema did not recognise.
    pub fn into_product(
        self,
        schema: &CategorySchema,
        shop: &str,
        now: i64,
        label_map: &std::collections::BTreeMap<String, String>,
    ) -> (Product, Vec<String>) {
        let mut attrs = financer_shop_core::Attributes::new();
        let mapped: Vec<(String, String)> = self
            .specs
            .iter()
            .map(|(l, v)| {
                (
                    label_map.get(l).cloned().unwrap_or_else(|| l.clone()),
                    v.clone(),
                )
            })
            .collect();
        let unclaimed = schema.ingest(
            &mut attrs,
            mapped.iter().map(|(l, v)| (l.as_str(), v.as_str())),
        );
        schema.derive_attributes(&self.title, self.brand.as_deref(), &mut attrs);
        let id = match &self.gtin {
            Some(g) if g.chars().filter(char::is_ascii_digit).count() >= 8 => {
                Product::id_for_gtin(&schema.id, g)
            }
            _ => Product::make_id(&schema.id, self.brand.as_deref(), &self.title),
        };
        let mut product = Product {
            id,
            category: schema.id.clone(),
            title: self.title.clone(),
            brand: self.brand.clone(),
            model: None,
            gtin: self.gtin.clone(),
            image: self.image.clone(),
            attributes: attrs,
            offers: Vec::new(),
            tags: Vec::new(),
        };
        if let Some(price) = self.price_cents {
            product.offers.push(Offer {
                shop: shop.to_string(),
                url: self.url.clone(),
                price_cents: if self.recurring.is_some() { 0 } else { price },
                currency: self.currency.clone().unwrap_or_else(|| "EUR".into()),
                shipping_cents: 0,
                in_stock: self.in_stock.unwrap_or(true),
                condition: self.condition.unwrap_or_default(),
                list_price_cents: self.list_price_cents,
                recurring: self.recurring.clone(),
                seen_at: now,
            });
        }
        (product, unclaimed)
    }
}

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
        Some(Value::String(s)) => s.rsplit(['/', '#']).next() == Some(wanted),
        Some(Value::Array(a)) => a.iter().any(|t| {
            t.as_str()
                .is_some_and(|s| s.rsplit(['/', '#']).next() == Some(wanted))
        }),
        _ => false,
    }
}

fn text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.trim().is_empty() => Some(html::cell_text(s)),
        Value::Number(n) => Some(n.to_string()),
        Value::Object(o) => o.get("name").and_then(text),
        Value::Array(a) => a.iter().find_map(text),
        _ => None,
    }
}

fn price_of(v: &Value) -> Option<i64> {
    price_to_cents(&text(v)?)
}

/// Products found in the JSON-LD blocks of a page; `url` is the page's own address.
pub fn json_ld_products(page_html: &str, url: &str) -> Vec<Extracted> {
    let mut out = Vec::new();
    for block in script_re().captures_iter(page_html) {
        if let Ok(v) = serde_json::from_str::<Value>(block[1].trim()) {
            collect(&v, url, &mut out);
        }
    }
    out
}

fn collect(node: &Value, url: &str, out: &mut Vec<Extracted>) {
    match node {
        Value::Array(items) => items.iter().for_each(|n| collect(n, url, out)),
        Value::Object(map) => {
            if let Some(g) = map.get("@graph") {
                collect(g, url, out);
            }
            if has_type(node, "ItemList") {
                if let Some(l) = map.get("itemListElement") {
                    collect(l, url, out);
                }
            }
            if has_type(node, "ListItem") {
                if let Some(i) = map.get("item") {
                    collect(i, url, out);
                }
            }
            if has_type(node, "Product") || has_type(node, "IndividualProduct") {
                if let Some(e) = product(node, url) {
                    out.push(e);
                }
            }
        }
        _ => {}
    }
}

fn product(p: &Value, page_url: &str) -> Option<Extracted> {
    let title = p.get("name").and_then(text)?;
    let own_url = p.get("url").and_then(text).and_then(|u| {
        url::Url::parse(page_url)
            .ok()
            .and_then(|b| b.join(&u).ok())
            .map(|u| u.to_string())
    });
    let mut e = Extracted {
        url: own_url.unwrap_or_else(|| page_url.to_string()),
        title,
        brand: p.get("brand").and_then(text),
        image: p.get("image").and_then(text),
        gtin: ["gtin", "gtin13", "gtin14", "gtin12", "gtin8", "ean"]
            .iter()
            .find_map(|k| p.get(*k).and_then(text)),
        category: p.get("category").and_then(text),
        ..Extracted::default()
    };
    if let Some(Value::Array(props)) = p.get("additionalProperty") {
        for prop in props {
            if let (Some(name), Some(value)) = (
                prop.get("name").and_then(text),
                prop.get("value").and_then(text),
            ) {
                let unit = prop.get("unitText").and_then(text).unwrap_or_default();
                e.specs
                    .push((name, format!("{value} {unit}").trim().to_string()));
            }
        }
    }
    if let Some(release) = p.get("releaseDate").and_then(text) {
        e.specs.push(("Release date".into(), release));
    }
    let offers: Vec<&Value> = match p.get("offers") {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(o @ Value::Object(_)) => vec![o],
        _ => Vec::new(),
    };
    // the cheapest offer the page shows
    let best = offers
        .iter()
        .filter_map(|o| offer(o).map(|x| (x, *o)))
        .min_by_key(|(x, _)| x.price_cents);
    if let Some((o, _)) = best {
        e.price_cents = o.price_cents;
        e.currency = o.currency;
        e.in_stock = o.in_stock;
        e.condition = o.condition;
        e.list_price_cents = o.list_price_cents;
        e.recurring = o.recurring;
    }
    Some(e)
}

struct ParsedOffer {
    price_cents: Option<i64>,
    currency: Option<String>,
    in_stock: Option<bool>,
    condition: Option<Condition>,
    list_price_cents: Option<i64>,
    recurring: Option<Recurring>,
}

fn offer(o: &Value) -> Option<ParsedOffer> {
    let specs: Vec<&Value> = match o.get("priceSpecification") {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(s @ Value::Object(_)) => vec![s],
        _ => Vec::new(),
    };
    let price_type = |s: &Value| {
        s.get("priceType")
            .and_then(text)
            .unwrap_or_default()
            .to_lowercase()
    };
    let list_price = specs
        .iter()
        .find(|s| {
            let t = price_type(s);
            t.contains("listprice") || t.contains("strikethrough") || t.contains("srp")
        })
        .and_then(|s| s.get("price").and_then(price_of));
    // a monthly unit price specification marks a subscription
    let monthly_spec = specs.iter().find(|s| {
        s.get("unitCode")
            .and_then(text)
            .is_some_and(|u| u.eq_ignore_ascii_case("MON"))
            || s.get("billingDuration").is_some()
    });
    let recurring = monthly_spec.and_then(|s| {
        Some(Recurring {
            monthly_cents: s.get("price").and_then(price_of)?,
            min_term_months: o
                .get("eligibleDuration")
                .and_then(|d| d.get("value"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            ..Recurring::default()
        })
    });
    let price_cents = recurring
        .as_ref()
        .map(|r| r.monthly_cents)
        .or_else(|| o.get("price").and_then(price_of))
        .or_else(|| o.get("lowPrice").and_then(price_of))
        .or_else(|| {
            specs
                .iter()
                .filter(|s| !price_type(s).contains("list"))
                .find_map(|s| s.get("price").and_then(price_of))
        });
    let availability = o
        .get("availability")
        .and_then(text)
        .unwrap_or_default()
        .to_lowercase();
    let condition = o
        .get("itemCondition")
        .and_then(text)
        .map(|c| c.to_lowercase())
        .map(|c| {
            if c.contains("refurbished") {
                Condition::Refurbished
            } else if c.contains("used") {
                Condition::Used
            } else {
                Condition::New
            }
        });
    Some(ParsedOffer {
        price_cents: price_cents?.into(),
        currency: o.get("priceCurrency").and_then(text),
        in_stock: (!availability.is_empty()).then(|| {
            availability.contains("instock")
                || availability.contains("limitedavailability")
                || availability.contains("onlineonly")
        }),
        condition,
        list_price_cents: list_price,
        recurring,
    })
}

/// Everything a single product page offers: JSON-LD plus the spec tables. When the page lists
/// several products (a category page), tables belong to none of them and are ignored.
pub fn page_products(page_html: &str, url: &str) -> Vec<Extracted> {
    let mut found = json_ld_products(page_html, url);
    if found.len() == 1 {
        let tables = html::spec_pairs(page_html);
        for (label, value) in tables {
            if !found[0].specs.iter().any(|(l, _)| *l == label) {
                found[0].specs.push((label, value));
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use financer_shop_core::{AttrValue, Registry};

    const PAGE: &str = r#"<html><head>
    <script type="application/ld+json">{
      "@context": "https://schema.org", "@type": "Product",
      "name": "Google Pixel 9 128GB Obsidian", "brand": {"@type": "Brand", "name": "Google"},
      "gtin13": "0840353930011", "image": "https://s.test/i.jpg",
      "additionalProperty": [{"@type": "PropertyValue", "name": "Akkukapazität", "value": "4700", "unitText": "mAh"}],
      "offers": [
        {"@type": "Offer", "price": "649.00", "priceCurrency": "EUR", "availability": "https://schema.org/InStock",
         "priceSpecification": [{"@type": "UnitPriceSpecification", "priceType": "https://schema.org/ListPrice", "price": "799.00"}]},
        {"@type": "Offer", "price": "689.00", "priceCurrency": "EUR", "availability": "https://schema.org/OutOfStock"}
      ]}</script></head><body>
      <table><tr><th>Arbeitsspeicher</th><td>12 GB</td></tr><tr><th>NFC</th><td>Ja</td></tr>
      <tr><th>Betriebssystem</th><td>Android 15</td></tr><tr><th>Farbe</th><td>Obsidian</td></tr></table>
      </body></html>"#;

    #[test]
    fn reads_a_product_page_with_json_ld_and_tables() {
        let found = page_products(PAGE, "https://s.test/p/pixel-9");
        assert_eq!(found.len(), 1);
        let e = &found[0];
        assert_eq!(e.title, "Google Pixel 9 128GB Obsidian");
        assert_eq!(e.brand.as_deref(), Some("Google"));
        assert_eq!(e.gtin.as_deref(), Some("0840353930011"));
        assert_eq!(e.price_cents, Some(64_900));
        assert_eq!(e.list_price_cents, Some(79_900));
        assert_eq!(e.in_stock, Some(true));
        assert_eq!(e.specs.len(), 5);
    }

    #[test]
    fn becomes_a_product_with_attributes_from_the_schema() {
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        let e = page_products(PAGE, "https://s.test/p/pixel-9").remove(0);
        let (p, unclaimed) = e.into_product(&schema, "Shop", 1_000, &Default::default());
        assert_eq!(p.id, "smartphone:gtin-840353930011");
        assert_eq!(p.attributes["battery_mah"], AttrValue::Num(4700.0));
        assert_eq!(p.attributes["ram_gb"], AttrValue::Num(12.0));
        assert_eq!(p.attributes["nfc"], AttrValue::Bool(true));
        assert_eq!(
            p.attributes["ecosystem"],
            AttrValue::List(vec!["android".into(), "google".into()])
        );
        assert_eq!(unclaimed, ["Farbe"]);
        assert_eq!(p.offers.len(), 1);
        assert_eq!(p.offers[0].price_cents, 64_900);
        assert_eq!(p.offers[0].list_price_cents, Some(79_900));
        assert_eq!(p.offers[0].shop, "Shop");
        assert_eq!(p.offers[0].seen_at, 1_000);
    }

    #[test]
    fn listing_pages_yield_every_product_without_tables() {
        let page = r#"<script type="application/ld+json">{"@type": "ItemList", "itemListElement": [
          {"@type": "ListItem", "position": 1, "item": {"@type": "Product", "name": "A", "url": "/p/a", "offers": {"@type": "Offer", "price": 10, "priceCurrency": "EUR"}}},
          {"@type": "ListItem", "position": 2, "item": {"@type": "Product", "name": "B", "url": "/p/b", "offers": {"@type": "AggregateOffer", "lowPrice": "5,50", "priceCurrency": "EUR"}}}
        ]}</script><table><tr><td>x</td><td>y</td></tr></table>"#;
        let found = page_products(page, "https://s.test/c/phones");
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].url, "https://s.test/p/a");
        assert_eq!(found[1].price_cents, Some(550));
        assert!(found.iter().all(|f| f.specs.is_empty()));
    }

    #[test]
    fn monthly_price_specifications_make_a_plan() {
        let page = r#"<script type="application/ld+json">{"@type": "Product", "name": "Tarif M",
          "offers": {"@type": "Offer", "priceCurrency": "EUR", "eligibleDuration": {"@type": "QuantitativeValue", "value": 24, "unitCode": "MON"},
            "priceSpecification": {"@type": "UnitPriceSpecification", "price": "19.99", "unitCode": "MON"}}}</script>"#;
        let e = page_products(page, "https://t.test/m").remove(0);
        let r = e.recurring.clone().unwrap();
        assert_eq!((r.monthly_cents, r.min_term_months), (1_999, 24));
        let schema = Registry::builtin().resolved("mobile_plan").unwrap();
        let (p, _) = e.into_product(&schema, "Telco", 0, &Default::default());
        assert_eq!(p.offers[0].price_cents, 0);
        assert_eq!(p.offers[0].effective_monthly_cents(24), Some(1_999));
    }

    #[test]
    fn broken_or_foreign_json_is_skipped() {
        assert!(
            json_ld_products(r#"<script type="application/ld+json">{nope</script>"#, "u")
                .is_empty()
        );
        assert!(json_ld_products(
            r#"<script type="application/ld+json">{"@type": "Recipe", "name": "x"}</script>"#,
            "u"
        )
        .is_empty());
        let no_price = r#"<script type="application/ld+json">{"@type": "Product", "name": "x", "offers": {"@type": "Offer"}}</script>"#;
        assert_eq!(json_ld_products(no_price, "u")[0].price_cents, None);
    }

    #[test]
    fn prices_parse_in_both_notations() {
        assert_eq!(price_to_cents("649.00"), Some(64_900));
        assert_eq!(price_to_cents("1.299,00 €"), Some(129_900));
        assert_eq!(price_to_cents("5,50"), Some(550));
        assert_eq!(price_to_cents("gratis"), None);
    }
}
