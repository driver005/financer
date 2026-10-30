//! An in-memory [`CrawlStore`] for tests (here and in the crates built on this one).

use std::collections::BTreeMap;
use std::sync::Mutex;

use async_trait::async_trait;
use financer_shop_core::Product;

use crate::store::{CrawlStore, FrontierItem, SaveOutcome};

#[derive(Default)]
pub struct MemoryStore {
    pub products: Mutex<BTreeMap<String, Product>>,
    pub frontier: Mutex<BTreeMap<String, FrontierItem>>,
}

impl MemoryStore {
    pub fn product(&self, id: &str) -> Option<Product> {
        self.products.lock().unwrap().get(id).cloned()
    }
    pub fn ids(&self) -> Vec<String> {
        self.products.lock().unwrap().keys().cloned().collect()
    }
}

fn best(p: &Product) -> Option<i64> {
    p.offers.iter().map(|o| o.comparable_cents(24)).min()
}

#[async_trait]
impl CrawlStore for MemoryStore {
    async fn save(&self, product: Product) -> Result<SaveOutcome, String> {
        let mut all = self.products.lock().unwrap();
        match all.get_mut(&product.id) {
            None => {
                all.insert(product.id.clone(), product);
                Ok(SaveOutcome::New)
            }
            Some(existing) => {
                let before = best(existing);
                existing.merge_missing(&product);
                Ok(if best(existing) != before {
                    SaveOutcome::Changed
                } else {
                    SaveOutcome::Unchanged
                })
            }
        }
    }

    async fn frontier_add(&self, items: Vec<FrontierItem>) -> Result<(), String> {
        let mut f = self.frontier.lock().unwrap();
        for i in items {
            f.entry(i.url.clone()).or_insert(i);
        }
        Ok(())
    }

    async fn frontier_due(&self, now: i64, limit: usize) -> Result<Vec<FrontierItem>, String> {
        let f = self.frontier.lock().unwrap();
        let mut due: Vec<FrontierItem> = f.values().filter(|i| i.next_at <= now).cloned().collect();
        due.sort_by_key(|i| (i.next_at, i.url.clone()));
        due.truncate(limit);
        Ok(due)
    }

    async fn frontier_done(
        &self,
        url: &str,
        fails: u32,
        interval_secs: i64,
        next_at: i64,
    ) -> Result<(), String> {
        if let Some(i) = self.frontier.lock().unwrap().get_mut(url) {
            i.fails = fails;
            i.interval_secs = interval_secs;
            i.next_at = next_at;
        }
        Ok(())
    }
}
