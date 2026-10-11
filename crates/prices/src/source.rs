//! Price sources and the refresh that runs them. Which pages are scraped is configuration,
//! not code: nothing here guesses a retailer URL.

use std::sync::Arc;

use async_trait::async_trait;
use financer_core::{Chain, Money};
use financer_llm::LlmProvider;
use serde::{Deserialize, Serialize};
use time::{Date, Duration};

use crate::http::Http;
use crate::jsonld::extract_offers;
use crate::normalize::{normalize_all, NormalizeReport, QuoteDetail, RawOffer};
use crate::off;
use crate::pagetext::{chunks, html_to_text};
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

const PAGE_SYSTEM: &str = "You read the text of a German supermarket offers or product page and list the products with \
prices that appear in it. Respond only with JSON: {\"products\":[{\"name\":string,\"price\":string,\"size\":string or null,\
\"valid_until\":\"YYYY-MM-DD\" or null}]}. `price` is the euro amount exactly as written in the text (for example \"1,29\"); \
`size` is the pack size as written (for example \"500 g\"); never invent or convert anything. Skip entries without a price.";

/// Characters of page text per model call, and calls per page: bounds the cost of one refresh.
const CHUNK_CHARS: usize = 12_000;
const MAX_CHUNKS: usize = 5;

/// Pages of one retailer, read by a language model: works on any layout, costs API calls.
///
/// Guard against made-up data: a product is only accepted if its price text appears in the
/// page text itself.
pub struct LlmPageSource {
    pub chain: Chain,
    pub urls: Vec<String>,
    pub is_offer: bool,
    /// `None` when no API key is configured; the source then reports that instead of failing silently.
    pub llm: Option<Arc<dyn LlmProvider>>,
}

#[derive(serde::Deserialize)]
struct PageAnswer {
    products: Vec<PageProduct>,
}

#[derive(serde::Deserialize)]
struct PageProduct {
    name: String,
    price: String,
    size: Option<String>,
    valid_until: Option<String>,
}

fn json_object(text: &str) -> Option<&str> {
    let (start, end) = (text.find('{')?, text.rfind('}')?);
    (end > start).then(|| &text[start..=end])
}

fn price_appears(text: &str, price: &str) -> bool {
    let p = price.trim().trim_end_matches('€').trim();
    !p.is_empty()
        && (text.contains(p)
            || text.contains(&p.replace(',', "."))
            || text.contains(&p.replace('.', ",")))
}

#[async_trait]
impl PriceSource for LlmPageSource {
    fn name(&self) -> String {
        format!("llm-page:{:?}", self.chain).to_lowercase()
    }

    async fn fetch(&self, http: &dyn Http) -> Result<Vec<RawOffer>, PriceError> {
        let llm = self.llm.as_ref().ok_or_else(|| {
            PriceError::Http("needs an LLM API key (Claude or OpenAI); none is configured".into())
        })?;
        let mut all = Vec::new();
        for url in &self.urls {
            let res = http.get(url).await?;
            if res.status >= 400 {
                return Err(PriceError::Http(format!("{url} answered {}", res.status)));
            }
            let text = html_to_text(&res.body);
            for chunk in chunks(&text, CHUNK_CHARS).into_iter().take(MAX_CHUNKS) {
                let answer = llm
                    .complete_json(PAGE_SYSTEM, &format!("Page text:\n{chunk}"))
                    .await
                    .map_err(|e| PriceError::Http(format!("model call failed: {e}")))?;
                let Some(parsed) =
                    json_object(&answer).and_then(|j| serde_json::from_str::<PageAnswer>(j).ok())
                else {
                    continue; // an unusable answer for one chunk must not lose the others
                };
                for p in parsed.products {
                    let name = p.name.trim();
                    let Ok(price) = Money::parse(&p.price) else {
                        continue;
                    };
                    let plausible = (1..=50_000).contains(&price.cents());
                    if name.is_empty()
                        || name.chars().count() > 120
                        || !plausible
                        || !price_appears(&chunk, &p.price)
                    {
                        continue;
                    }
                    all.push(RawOffer {
                        chain: self.chain,
                        name: name.to_string(),
                        price,
                        pack_text: p.size.filter(|s| !s.trim().is_empty()),
                        valid_until: p.valid_until.as_deref().and_then(|d| {
                            time::Date::parse(
                                d.get(..10)?,
                                time::macros::format_description!("[year]-[month]-[day]"),
                            )
                            .ok()
                        }),
                        is_offer: self.is_offer,
                        source: self.name(),
                        item_hint: None,
                    });
                }
            }
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
    /// Pages read by your Claude/OpenAI model; works on any layout, costs API calls.
    LlmPage {
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

pub fn build_sources(
    configs: &[SourceConfig],
    today: Date,
    llm: Option<Arc<dyn LlmProvider>>,
) -> Vec<Box<dyn PriceSource>> {
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
                SourceConfig::LlmPage {
                    chain,
                    urls,
                    is_offer,
                } => Box::new(LlmPageSource {
                    chain: *chain,
                    urls: urls.clone(),
                    is_offer: *is_offer,
                    llm: llm.clone(),
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
        assert_eq!(build_sources(&cfg, date!(2026 - 03 - 05), None).len(), 2);
        assert!(serde_json::from_str::<Vec<SourceConfig>>(r#"[{"type":"nope"}]"#).is_err());
    }

    const OFFERS_PAGE: &str = "<html><body><script>var junk = '7,77';</script>\
<div class=\"tile\"><h3>Barilla Spaghetti</h3><span>500 g</span><b>1,29 &euro;</b></div>\
<div class=\"tile\"><h3>Frische Vollmilch 3,5 %</h3><span>1 l</span><b>0,99 &euro;</b></div>\
<div class=\"tile\"><h3>Gültig bis 08.03.</h3></div></body></html>";

    fn page_source(
        answers: Vec<Result<String, String>>,
    ) -> (LlmPageSource, Arc<financer_llm::MockProvider>) {
        let mock = Arc::new(financer_llm::MockProvider::with_answers(answers));
        let src = LlmPageSource {
            chain: Chain::Kaufland,
            urls: vec!["https://shop.test/angebote".into()],
            is_offer: true,
            llm: Some(mock.clone()),
        };
        (src, mock)
    }

    #[tokio::test]
    async fn llm_page_source_extracts_and_rejects_invented_prices() {
        let http = FakeHttp::with(vec![("https://shop.test/angebote", 200, OFFERS_PAGE)]);
        let answer = r#"{"products":[
            {"name":"Barilla Spaghetti","price":"1,29","size":"500 g","valid_until":"2026-03-08"},
            {"name":"Frische Vollmilch 3,5 %","price":"0.99","size":"1 l","valid_until":null},
            {"name":"Erfundenes Produkt","price":"4,44","size":"1 kg","valid_until":null},
            {"name":"","price":"1,00","size":null,"valid_until":null},
            {"name":"Gratis","price":"0,00","size":null,"valid_until":null},
            {"name":"Teuer","price":"99999,00","size":null,"valid_until":null},
            {"name":"Kaputt","price":"abc","size":null,"valid_until":null}]}"#;
        let (src, mock) = page_source(vec![Ok(answer.into())]);
        let offers = src.fetch(&http).await.unwrap();
        let names: Vec<_> = offers.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, vec!["Barilla Spaghetti", "Frische Vollmilch 3,5 %"]);
        assert_eq!(offers[0].price, Money::from_cents(129));
        assert_eq!(offers[0].valid_until, Some(date!(2026 - 03 - 08)));
        assert_eq!(offers[1].price, Money::from_cents(99)); // "0.99" accepted: the page says 0,99
        assert!(offers
            .iter()
            .all(|o| o.is_offer && o.chain == Chain::Kaufland));
        // the model saw the visible text, not the script
        let prompt = mock.requests.lock().unwrap()[0].1.clone();
        assert!(prompt.contains("Barilla Spaghetti") && !prompt.contains("7,77"));
    }

    #[tokio::test]
    async fn llm_page_source_feeds_the_normal_pipeline() {
        let http = FakeHttp::with(vec![("https://shop.test/angebote", 200, OFFERS_PAGE)]);
        let answer = r#"{"products":[{"name":"Barilla Spaghetti","price":"1,29","size":"500 g","valid_until":null}]}"#;
        let (src, _) = page_source(vec![Ok(answer.into())]);
        let sources: Vec<Box<dyn PriceSource>> = vec![Box::new(src)];
        let r = refresh(&sources, &http).await;
        assert_eq!(r.quotes.len(), 1);
        assert_eq!(
            (r.quotes[0].quote.item.as_str(), r.quotes[0].quote.price),
            ("nudeln", Money::from_cents(129))
        );
        assert_eq!(r.quotes[0].source, "llm-page:kaufland");
    }

    #[tokio::test]
    async fn llm_page_source_tolerates_bad_answers_and_reports_missing_keys() {
        let http = FakeHttp::with(vec![("https://shop.test/angebote", 200, OFFERS_PAGE)]);
        let (src, _) = page_source(vec![Ok("sorry, no JSON".into())]);
        assert!(src.fetch(&http).await.unwrap().is_empty());

        let (src, _) = page_source(vec![Err("overloaded".into())]);
        assert!(src.fetch(&http).await.is_err());

        let no_key = LlmPageSource {
            chain: Chain::Lidl,
            urls: vec!["https://shop.test/angebote".into()],
            is_offer: false,
            llm: None,
        };
        let err = no_key.fetch(&http).await.unwrap_err().to_string();
        assert!(err.contains("LLM API key"), "{err}");

        let down = FakeHttp::with(vec![("https://shop.test/angebote", 503, "")]);
        let (src, mock) = page_source(vec![]);
        assert!(src.fetch(&down).await.is_err());
        assert!(
            mock.requests.lock().unwrap().is_empty(),
            "no model call for a page that did not load"
        );
    }

    #[test]
    fn price_matching_accepts_either_decimal_mark_but_not_absent_prices() {
        assert!(price_appears("nur 1,29 € heute", "1,29"));
        assert!(price_appears("nur 1,29 € heute", "1.29"));
        assert!(price_appears("nur 1.29 heute", "1,29 €"));
        assert!(!price_appears("nur 1,29 € heute", "1,92"));
        assert!(!price_appears("text", ""));
    }
}
