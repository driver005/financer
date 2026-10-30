//! Reading products from the web: pages with schema.org data and spec tables, search result
//! listings, product feeds and sitemaps, politely (robots.txt, per-host delays). The crawler runs
//! two ways: on demand for one search, or continuously on a schedule that adapts to price moves.

pub mod config;
pub mod crawler;
pub mod extract;
pub mod feed;
pub mod html;
pub mod llm;
pub mod progress;
pub mod store;
pub mod testing;

pub use config::{parse_sources, FeedFormat, FeedMapping, Kind, SourceConfig};
pub use crawler::{
    failure_backoff, next_interval, Crawler, IndexReport, IndexRequest, RunReport, SourceReport,
};
pub use extract::{page_products, price_to_cents, Extracted};
pub use llm::{LlmReader, PageReader};
pub use progress::{Cancel, Phase, ProgressRx, ProgressState, ProgressTx};
pub use store::{CrawlStore, FrontierItem, ItemKind, SaveOutcome};
