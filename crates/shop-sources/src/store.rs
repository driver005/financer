//! What the crawler needs from storage. The persistence crate implements it; tests use the
//! in-memory version in [`crate::testing`].

use async_trait::async_trait;
use financer_shop_core::Product;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Page,
    Feed,
    Sitemap,
}

/// A page the continuous crawl will visit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrontierItem {
    pub url: String,
    pub source: String,
    pub kind: ItemKind,
    pub category: Option<String>,
    pub depth: u32,
    /// Wait between visits; shortened when the price moved, lengthened when it did not.
    pub interval_secs: i64,
    pub next_at: i64,
    pub fails: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveOutcome {
    New,
    /// The best price (or a spec) differs from what we had.
    Changed,
    Unchanged,
}

#[async_trait]
pub trait CrawlStore: Send + Sync {
    /// Merge into the product with this id (or GTIN): new specs fill gaps, offers are refreshed,
    /// a price point is recorded.
    async fn save(&self, product: Product) -> Result<SaveOutcome, String>;
    /// Queue pages; addresses already queued are left as they are.
    async fn frontier_add(&self, items: Vec<FrontierItem>) -> Result<(), String>;
    /// Pages whose time has come, oldest first.
    async fn frontier_due(&self, now: i64, limit: usize) -> Result<Vec<FrontierItem>, String>;
    /// Record a visit and when to come back.
    async fn frontier_done(
        &self,
        url: &str,
        fails: u32,
        interval_secs: i64,
        next_at: i64,
    ) -> Result<(), String>;
}
