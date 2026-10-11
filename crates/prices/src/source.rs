//! Price sources and the refresh that runs them. Which pages are scraped is configuration,
//! not code: nothing here guesses a retailer URL.

use async_trait::async_trait;
use financer_core::Chain;
use serde::{Deserialize, Serialize};
use time::{Date, Duration};

use crate::http::Http;
use crate::jsonld::extract_offers;
use crate::normalize::{normalize_all, NormalizeReport, QuoteDetail, RawOffer};
use crate::off;
use crate::PriceError;

#[async_trait]
pub trait PriceSource: Send + Sync {
    fn name(&self) -> String;
    async fn fetch(&self, http: &dyn Http) -> Result<Vec<RawOffer>, PriceError>;
}

/// Pages of one retailer that embed schema.org JSON-LD products with offers.
pub struct JsonLdSource {
    pub chain: Chain,
    pub urls: Vec<String>,
    /// True for weekly-offer pages (prices are promotional), false for regular listings.
    pub is_offer: bool,
}

#[async_trait]
impl PriceSource for JsonLdSource {
    fn name(&self) -> String {
        format!("json-ld:{:?}", self.chain).to_lowercase()
    }

    async fn fetch(&self, http: &dyn Http) -> Result<Vec<RawOffer>, PriceError> {
        let mut all = Vec::new();
        for url in &self.urls {
            let res = http.get(url).await?;
            if res.status >= 400 {
                return Err(PriceError::Http(format!("{url} answered {}", res.status)));
            }
            all.extend(extract_offers(
                &res.body,
                self.chain,
                &self.name(),
                self.is_offer,
            ));
        }
        Ok(all)
    }
}

/// Crowdsourced shelf prices from Open Prices for barcodes you chose per catalog item.
pub struct OpenPricesSource {
    /// `(catalog key, barcode)`
    pub items: Vec<(String, String)>,
    /// Ignore observations older than this many days.
    pub max_age_days: i64,
    pub today: Date,
}

#[async_trait]
impl PriceSource for OpenPricesSource {
    fn name(&self) -> String {
        "open-prices".into()
    }

    async fn fetch(&self, http: &dyn Http) -> Result<Vec<RawOffer>, PriceError> {
        let oldest = self.today - Duration::days(self.max_age_days);
        let mut all = Vec::new();
        for (item, code) in &self.items {
            let product = http.get(&off::product_url(code)).await?;
            let Some(product) = (product.status < 400)
                .then(|| off::parse_product(&product.body))
                .flatten()
            else {
                continue;
            };
            let prices = http.get(&off::open_prices_url(code)).await?;
            if prices.status >= 400 {
                continue;
            }
            for p in off::parse_open_prices(&prices.body) {
                // Only prices seen in one of the four chains are useful, and only recent ones.
                let Some(chain) = p.store.as_deref().and_then(Chain::from_name) else {
                    continue;
                };
                if p.date < oldest || p.date > self.today {
                    continue;
                }
                all.push(RawOffer {
                    chain,
                    name: product.name.clone(),
                    price: p.price,
                    pack_text: product.quantity.clone(),
                    valid_until: None,
                    is_offer: false,
                    source: self.name(),
                    item_hint: Some(item.clone()),
                });
            }
        }
        Ok(all)
    }
}

/// Source configuration, loaded from a JSON file by the server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SourceConfig {
    JsonLd {
        chain: Chain,
        urls: Vec<String>,
        #[serde(default)]
        is_offer: bool,
    },
    OpenPrices {
        items: Vec<OpenPricesItem>,
        #[serde(default = "default_max_age")]
        max_age_days: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenPricesItem {
    pub item: String,
    pub barcode: String,
}

fn default_max_age() -> i64 {
    60
}

pub fn build_sources(configs: &[SourceConfig], today: Date) -> Vec<Box<dyn PriceSource>> {
    configs
        .iter()
        .map(|c| -> Box<dyn PriceSource> {
            match c {
                SourceConfig::JsonLd {
                    chain,
                    urls,
                    is_offer,
                } => Box::new(JsonLdSource {
                    chain: *chain,
                    urls: urls.clone(),
                    is_offer: *is_offer,
                }),
                SourceConfig::OpenPrices {
                    items,
                    max_age_days,
                } => Box::new(OpenPricesSource {
                    items: items
                        .iter()
                        .map(|i| (i.item.clone(), i.barcode.clone()))
                        .collect(),
                    max_age_days: *max_age_days,
                    today,
                }),
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceStatus {
    pub name: String,
    pub ok: bool,
    pub offers_found: usize,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RefreshResult {
    pub quotes: Vec<QuoteDetail>,
    pub normalize: NormalizeReport,
    pub sources: Vec<SourceStatus>,
}

/// Run every source one after another (politely, never in parallel against one host). A
/// failing source is reported and skipped; it never fails the refresh.
pub async fn refresh(sources: &[Box<dyn PriceSource>], http: &dyn Http) -> RefreshResult {
    let mut raws = Vec::new();
    let mut statuses = Vec::new();
    for s in sources {
        match s.fetch(http).await {
            Ok(offers) => {
                statuses.push(SourceStatus {
                    name: s.name(),
                    ok: true,
                    offers_found: offers.len(),
                    error: None,
                });
                raws.extend(offers);
            }
            Err(e) => statuses.push(SourceStatus {
                name: s.name(),
                ok: false,
                offers_found: 0,
                error: Some(e.to_string()),
            }),
        }
    }
    let (quotes, normalize) = normalize_all(&raws);
    RefreshResult {
        quotes,
        normalize,
        sources: statuses,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::fake::FakeHttp;
    use financer_core::Money;
    use time::macros::date;

    const PAGE: &str = r#"<script type="application/ld+json">{"@type":"Product","name":"Spaghetti 500 g",
        "offers":{"@type":"Offer","price":"0.89","priceCurrency":"EUR"}}</script>
        <script type="application/ld+json">{"@type":"Product","name":"Playstation","offers":{"@type":"Offer","price":"499.00","priceCurrency":"EUR"}}</script>"#;

    #[tokio::test]
    async fn refresh_normalizes_and_reports_per_source() {
        let http = FakeHttp::with(vec![
            ("https://shop.test/angebote", 200, PAGE),
            ("https://down.test/x", 503, ""),
        ]);
        let sources: Vec<Box<dyn PriceSource>> = vec![
            Box::new(JsonLdSource {
                chain: Chain::Lidl,
                urls: vec!["https://shop.test/angebote".into()],
                is_offer: true,
            }),
            Box::new(JsonLdSource {
                chain: Chain::Aldi,
                urls: vec!["https://down.test/x".into()],
                is_offer: true,
            }),
        ];
        let r = refresh(&sources, &http).await;

        assert_eq!(r.quotes.len(), 1);
        assert_eq!(r.quotes[0].quote.item, "nudeln");
        assert!(r.quotes[0].quote.is_offer);
        assert_eq!(r.normalize.unmatched, 1); // the Playstation
        assert!(r.sources[0].ok && r.sources[0].offers_found == 2);
        assert!(!r.sources[1].ok);
        assert!(r.sources[1].error.as_deref().unwrap().contains("503"));
    }

    #[tokio::test]
    async fn open_prices_filters_by_chain_and_age() {
        let http = FakeHttp::with(vec![
            (
                &off::product_url("111"),
                200,
                r#"{"status":1,"product":{"code":"111","product_name":"Vollmilch","quantity":"1 l"}}"#,
            ),
            (
                &off::open_prices_url("111"),
                200,
                r#"{"items":[
                    {"product_code":"111","price":1.19,"currency":"EUR","date":"2026-03-01","location":{"osm_name":"REWE Markt"}},
                    {"product_code":"111","price":0.99,"currency":"EUR","date":"2026-03-02","location":{"osm_name":"Edeka"}},
                    {"product_code":"111","price":0.89,"currency":"EUR","date":"2025-01-01","location":{"osm_name":"Aldi Nord"}},
                    {"product_code":"111","price":1.09,"currency":"EUR","date":"2026-03-03"}]}"#,
            ),
        ]);
        let src = OpenPricesSource {
            items: vec![("milch".into(), "111".into())],
            max_age_days: 60,
            today: date!(2026 - 03 - 05),
        };
        let raws = src.fetch(&http).await.unwrap();
        assert_eq!(raws.len(), 1);
        assert_eq!(
            (raws[0].chain, raws[0].price, raws[0].item_hint.as_deref()),
            (Chain::Rewe, Money::from_cents(119), Some("milch"))
        );

        let (quotes, _) = normalize_all(&raws);
        assert_eq!(quotes[0].quote.price, Money::from_cents(119));
    }

    #[test]
    fn config_roundtrip() {
        let json = r#"[
          {"type":"json_ld","chain":"rewe","urls":["https://example.test/a"],"is_offer":true},
          {"type":"open_prices","items":[{"item":"milch","barcode":"111"}]}
        ]"#;
        let cfg: Vec<SourceConfig> = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.len(), 2);
        assert!(matches!(
            &cfg[1],
            SourceConfig::OpenPrices {
                max_age_days: 60,
                ..
            }
        ));
        assert_eq!(build_sources(&cfg, date!(2026 - 03 - 05)).len(), 2);
        assert!(serde_json::from_str::<Vec<SourceConfig>>(r#"[{"type":"nope"}]"#).is_err());
    }
}
