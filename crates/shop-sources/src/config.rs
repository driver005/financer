//! Where products come from. A source is data (a JSON file or a setting in the app), never code:
//! adding a shop is adding an entry.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Product pages and listings: fetch the `urls`, optionally follow links to product pages.
    #[default]
    Pages,
    /// A shop search: `search_url` with `{query}`; follows result links to product pages.
    Search,
    /// A product feed (CSV or JSON), e.g. an affiliate or Google-Shopping style export.
    Feed,
    /// A sitemap: product URLs are found in it and crawled over time.
    Sitemap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedFormat {
    #[default]
    Csv,
    Json,
}

/// Which feed column or JSON key holds what. Columns not named here become specs, labelled with
/// the column name, unless `specs` lists the ones to keep.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct FeedMapping {
    pub title: String,
    pub price: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub brand: Option<String>,
    #[serde(default)]
    pub gtin: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub list_price: Option<String>,
    /// A column whose value says whether it is in stock ("in stock", "1", "available").
    #[serde(default)]
    pub availability: Option<String>,
    #[serde(default)]
    pub condition: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    // recurring prices: plans and subscriptions
    #[serde(default)]
    pub monthly: Option<String>,
    #[serde(default)]
    pub min_term_months: Option<String>,
    #[serde(default)]
    pub promo_months: Option<String>,
    #[serde(default)]
    pub promo_monthly: Option<String>,
    #[serde(default)]
    pub setup: Option<String>,
    #[serde(default)]
    pub cashback: Option<String>,
    /// Columns to keep as specs; empty keeps every column not used above.
    #[serde(default)]
    pub specs: Vec<String>,
}

fn default_currency() -> String {
    "EUR".into()
}
fn default_max_pages() -> usize {
    40
}
fn default_recrawl_hours() -> u64 {
    24
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceConfig {
    pub name: String,
    #[serde(default)]
    pub kind: Kind,
    /// Display name of the shop on offers; defaults to `name`.
    #[serde(default)]
    pub shop: Option<String>,
    /// Category the products belong to; when absent it is taken from the query or the feed.
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default)]
    pub urls: Vec<String>,
    /// `https://shop.example/search?q={query}`
    #[serde(default)]
    pub search_url: Option<String>,
    /// Standing searches for the server's continuous crawl.
    #[serde(default)]
    pub queries: Vec<String>,
    #[serde(default)]
    pub feed_url: Option<String>,
    #[serde(default)]
    pub format: FeedFormat,
    #[serde(default)]
    pub mapping: Option<FeedMapping>,
    #[serde(default)]
    pub sitemap_url: Option<String>,
    /// Follow links whose address contains one of these ("/product/", "/p/").
    #[serde(default)]
    pub follow: Vec<String>,
    /// How many link hops from a listing; 0 reads the given pages only.
    #[serde(default)]
    pub max_depth: u32,
    /// Pages one on-demand run may fetch from this source.
    #[serde(default = "default_max_pages")]
    pub max_pages: usize,
    /// Fastest/slowest wait before a product page is read again by the continuous crawl.
    #[serde(default = "default_recrawl_hours")]
    pub recrawl_hours: u64,
    /// Let the configured language model read pages that have no structured data. Costs API
    /// calls and sends the page text to the provider.
    #[serde(default)]
    pub use_llm: bool,
    /// Only contributes specs (a manufacturer or review database), no prices.
    #[serde(default)]
    pub specs_only: bool,
    /// Extra labels to attributes for this source: `{"Akku": "battery_mah"}`.
    #[serde(default)]
    pub label_map: BTreeMap<String, String>,
}

impl SourceConfig {
    pub fn shop_name(&self) -> &str {
        self.shop.as_deref().unwrap_or(&self.name)
    }

    pub fn host(&self) -> Option<String> {
        let first = self
            .urls
            .first()
            .or(self.search_url.as_ref())
            .or(self.feed_url.as_ref())
            .or(self.sitemap_url.as_ref())?;
        url::Url::parse(&first.replace("{query}", "x"))
            .ok()?
            .host_str()
            .map(str::to_string)
    }

    pub fn problems(&self) -> Vec<String> {
        let mut out = Vec::new();
        if self.name.trim().is_empty() {
            out.push("a source has no name".into());
        }
        let n = &self.name;
        match self.kind {
            Kind::Pages if self.urls.is_empty() => out.push(format!("{n}: pages need urls")),
            Kind::Search => match &self.search_url {
                Some(u) if u.contains("{query}") => {}
                _ => out.push(format!("{n}: search_url must contain {{query}}")),
            },
            Kind::Feed => {
                if self.feed_url.is_none() {
                    out.push(format!("{n}: feed needs feed_url"));
                }
                if self.mapping.is_none() {
                    out.push(format!("{n}: feed needs a mapping"));
                }
            }
            Kind::Sitemap => {
                if self.sitemap_url.is_none() {
                    out.push(format!("{n}: sitemap needs sitemap_url"));
                }
                if self.follow.is_empty() {
                    out.push(format!(
                        "{n}: sitemap needs follow patterns to pick product pages"
                    ));
                }
            }
            _ => {}
        }
        for u in self
            .urls
            .iter()
            .chain(self.search_url.iter())
            .chain(self.feed_url.iter())
            .chain(self.sitemap_url.iter())
        {
            if url::Url::parse(&u.replace("{query}", "x"))
                .map(|p| !matches!(p.scheme(), "http" | "https"))
                .unwrap_or(true)
            {
                out.push(format!("{n}: {u:?} is not an http(s) address"));
            }
        }
        out
    }
}

/// Parse a JSON file of sources and report all problems at once.
pub fn parse_sources(json: &str) -> Result<Vec<SourceConfig>, String> {
    let sources: Vec<SourceConfig> =
        serde_json::from_str(json).map_err(|e| format!("shop sources: {e}"))?;
    let problems: Vec<String> = sources.iter().flat_map(SourceConfig::problems).collect();
    if problems.is_empty() {
        Ok(sources)
    } else {
        Err(problems.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_sources_parse_with_defaults() {
        let s = parse_sources(
            r#"[{"name": "a", "urls": ["https://a.test/p/1"]},
                {"name": "b", "kind": "search", "search_url": "https://b.test/s?q={query}", "follow": ["/p/"], "max_depth": 1}]"#,
        )
        .unwrap();
        assert_eq!(s[0].kind, Kind::Pages);
        assert_eq!(s[0].currency, "EUR");
        assert_eq!(s[0].max_pages, 40);
        assert_eq!(s[1].host().as_deref(), Some("b.test"));
        assert_eq!(s[0].shop_name(), "a");
    }

    #[test]
    fn mistakes_are_all_reported() {
        let err = parse_sources(
            r#"[{"name": "", "kind": "feed"},
                {"name": "s", "kind": "search", "search_url": "https://x.test/"},
                {"name": "f", "urls": ["ftp://x.test/a"]}]"#,
        )
        .unwrap_err();
        assert!(
            err.contains("no name")
                && err.contains("feed needs feed_url")
                && err.contains("{query}")
                && err.contains("not an http(s)"),
            "{err}"
        );
        assert!(parse_sources("nope").is_err());
    }
}
