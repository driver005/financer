//! The shopping service: shared state, the searchable snapshot of the catalogue, index jobs, deal
//! watching and notification delivery. The HTTP layer in `routes` is a thin shell around this.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use financer_shop_core::deals::{assess, DealInfo, PricePoint};
use financer_shop_core::{Condition, Index, Product, Profile, Registry, Watch};
use financer_shop_sources::{Crawler, IndexRequest, Phase};
use financer_shop_store::{ShopStore, ShopStoreError, StoreSink};

use crate::jobs::{Admission, Job, Jobs};
use crate::notify::Notifier;

/// How far back price history counts as "the usual price".
pub const HISTORY_SECS: i64 = 90 * 86_400;
const DAY: i64 = 86_400;

#[derive(Debug, Clone)]
pub struct ShopConfig {
    /// The server keeps crawling and watching on its own; the integrated app only does so when
    /// asked. This changes what the app offers, not what the code can do.
    pub continuous: bool,
    pub max_running_jobs: usize,
    /// Offers not seen for this long are dropped by the continuous loop.
    pub stale_offer_days: i64,
    /// A language model is available for pages without structured data.
    pub llm: bool,
}

impl Default for ShopConfig {
    fn default() -> Self {
        ShopConfig {
            continuous: false,
            max_running_jobs: 2,
            stale_offer_days: 45,
            llm: false,
        }
    }
}

/// Everything searchable, built from the store and reused until the catalogue changes.
pub struct Snapshot {
    fingerprint: (u64, u64, i64),
    pub products: HashMap<String, Product>,
    pub by_category: BTreeMap<String, Vec<String>>,
    pub index: Index,
}

impl Snapshot {
    pub fn category_products(&self, category: &str) -> Vec<Product> {
        self.by_category
            .get(category)
            .map(|ids| {
                ids.iter()
                    .filter_map(|i| self.products.get(i).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// When the newest offer in a category was seen (unix seconds), 0 when there is none.
    pub fn newest_offer(&self, category: &str) -> i64 {
        self.by_category
            .get(category)
            .into_iter()
            .flatten()
            .filter_map(|i| self.products.get(i))
            .flat_map(|p| p.offers.iter().map(|o| o.seen_at))
            .max()
            .unwrap_or(0)
    }
}

pub struct Inner {
    pub store: ShopStore,
    pub registry: Arc<RwLock<Registry>>,
    pub crawler: Arc<Crawler>,
    pub sink: Arc<StoreSink>,
    pub jobs: Jobs,
    pub config: ShopConfig,
    pub notifiers: Vec<Arc<dyn Notifier>>,
    snapshot: tokio::sync::Mutex<Option<Arc<Snapshot>>>,
    clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    watch_lock: tokio::sync::Mutex<()>,
    pub last_error: Mutex<Option<String>>,
}

#[derive(Clone)]
pub struct ShopState(pub Arc<Inner>);

impl std::ops::Deref for ShopState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

impl ShopState {
    /// `registry` must be the one the crawler was built with, so a category edited in the app
    /// reaches the crawl at once.
    pub fn new(
        store: ShopStore,
        registry: Arc<RwLock<Registry>>,
        crawler: Crawler,
        config: ShopConfig,
    ) -> ShopState {
        ShopState(Arc::new(Inner {
            sink: Arc::new(StoreSink::new(store.clone())),
            store,
            registry,
            crawler: Arc::new(crawler),
            jobs: Jobs::default(),
            config,
            notifiers: Vec::new(),
            snapshot: tokio::sync::Mutex::new(None),
            clock: Arc::new(unix_now),
            watch_lock: tokio::sync::Mutex::new(()),
            last_error: Mutex::new(None),
        }))
    }

    fn rebuild(self, f: impl FnOnce(&mut Inner)) -> ShopState {
        let mut inner = Arc::try_unwrap(self.0)
            .unwrap_or_else(|_| panic!("configure the state before sharing it"));
        f(&mut inner);
        ShopState(Arc::new(inner))
    }

    pub fn with_notifiers(self, notifiers: Vec<Arc<dyn Notifier>>) -> ShopState {
        self.rebuild(|i| i.notifiers = notifiers)
    }

    pub fn with_clock(self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> ShopState {
        self.rebuild(|i| i.clock = Arc::new(clock))
    }

    pub fn now(&self) -> i64 {
        (self.clock)()
    }

    pub fn registry_snapshot(&self) -> Registry {
        self.registry.read().expect("registry lock").clone()
    }

    /// The searchable catalogue; rebuilt only when something in the store changed.
    pub async fn snapshot(&self) -> Result<Arc<Snapshot>, ShopStoreError> {
        let fp = self.store.fingerprint().await?;
        let mut guard = self.snapshot.lock().await;
        if let Some(s) = guard.as_ref().filter(|s| s.fingerprint == fp) {
            return Ok(s.clone());
        }
        let list = self.store.list_products(None).await?;
        let index = Index::build(&list);
        let mut by_category: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for p in &list {
            by_category
                .entry(p.category.clone())
                .or_default()
                .push(p.id.clone());
        }
        let snap = Arc::new(Snapshot {
            fingerprint: fp,
            products: list.into_iter().map(|p| (p.id.clone(), p)).collect(),
            by_category,
            index,
        });
        *guard = Some(snap.clone());
        Ok(snap)
    }

    /// Deal assessments for products, judged on their best offer under `profile`.
    pub async fn deals_for(
        &self,
        products: &[Product],
        profile: &Profile,
    ) -> Result<BTreeMap<String, DealInfo>, ShopStoreError> {
        let now = self.now();
        let ids: Vec<String> = products.iter().map(|p| p.id.clone()).collect();
        let histories = self.store.price_histories(&ids, now - HISTORY_SECS).await?;
        let mut out = BTreeMap::new();
        for p in products {
            let Some(best) = p
                .usable_offers(
                    &profile.conditions,
                    profile.in_stock_only,
                    profile.horizon_months,
                )
                .into_iter()
                .next()
            else {
                continue;
            };
            let empty: Vec<PricePoint> = Vec::new();
            let history = histories.get(&p.id).unwrap_or(&empty);
            out.insert(
                p.id.clone(),
                assess(
                    history,
                    best.comparable_cents(profile.horizon_months),
                    best.list_price_cents,
                    now,
                ),
            );
        }
        Ok(out)
    }

    /// Start reading the sources for a search, in the background. The job is returned at once.
    pub fn start_index(&self, request: IndexRequest) -> Result<Job, IndexRefusal> {
        match self
            .jobs
            .admit(request.clone(), self.now(), self.config.max_running_jobs)
        {
            Admission::Running(job) => Ok(job),
            Admission::Busy => Err(IndexRefusal::Busy),
            Admission::Started(job) => {
                let state = self.clone();
                let run = job.clone();
                tokio::spawn(async move {
                    let report = state
                        .crawler
                        .index_query(
                            state.sink.as_ref(),
                            &run.request,
                            &run.progress,
                            &run.cancel,
                        )
                        .await;
                    *run.report.lock().expect("report lock") = Some(report);
                    // deals found while reading are announced right away, with or without a server
                    if run.rx.borrow().phase == Phase::Done {
                        if let Err(e) = state.check_watches().await {
                            tracing::warn!("checking watches after an index run failed: {e}");
                        }
                    }
                });
                Ok(job)
            }
        }
    }

    /// Look at every enabled watch and record the deals worth a message. Returns the new messages.
    pub async fn check_watches(&self) -> Result<usize, ShopStoreError> {
        let _one_at_a_time = self.watch_lock.lock().await;
        let watches: Vec<Watch> = self
            .store
            .list_watches()
            .await?
            .into_iter()
            .filter(|w| w.enabled)
            .collect();
        if watches.is_empty() {
            return Ok(0);
        }
        let snap = self.snapshot().await?;
        let registry = self.registry_snapshot();
        let profile = Profile {
            in_stock_only: true,
            conditions: vec![Condition::New],
            ..Profile::default()
        };
        let now = self.now();
        let mut recorded = 0;
        for w in watches {
            let mut ids: Vec<String> = w.product_ids.clone();
            if let Some(q) = &w.query {
                let parsed =
                    financer_shop_core::ParsedQuery::parse(q, &registry, w.category.as_deref());
                ids.extend(
                    snap.index
                        .search(
                            &parsed.terms,
                            parsed.category.as_deref().or(w.category.as_deref()),
                            50,
                        )
                        .into_iter()
                        .map(|h| h.id),
                );
            }
            ids.sort();
            ids.dedup();
            let products: Vec<Product> = ids
                .iter()
                .filter_map(|i| snap.products.get(i).cloned())
                .collect();
            let deals = self.deals_for(&products, &profile).await?;
            for p in &products {
                let (Some(info), Some(offer)) = (
                    deals.get(&p.id),
                    p.usable_offers(&profile.conditions, true, profile.horizon_months)
                        .into_iter()
                        .next(),
                ) else {
                    continue;
                };
                let Some(event) = w.evaluate(&p.id, &p.title, &offer.shop, &offer.url, info) else {
                    continue;
                };
                if let Some(last) = self.store.last_event_price(w.id, &p.id).await? {
                    if !financer_shop_core::worth_repeating(last, event.price_cents) {
                        continue;
                    }
                }
                if self.store.record_event(&event, now).await? {
                    recorded += 1;
                }
            }
        }
        Ok(recorded)
    }

    /// Push undelivered messages through the configured notifiers. A message counts as delivered
    /// when any notifier took it (or when none is configured: the app polls then).
    pub async fn deliver_pending(&self) -> Result<usize, ShopStoreError> {
        let pending = self.store.undelivered_events(50).await?;
        if pending.is_empty() {
            return Ok(0);
        }
        let ids: Vec<i64> = pending.iter().map(|e| e.id).collect();
        let mut tokens = self.store.push_tokens().await?;
        let mut delivered = self.notifiers.is_empty();
        for n in &self.notifiers {
            match n.send(&pending, &tokens).await {
                Ok(outcome) => {
                    delivered = true;
                    for dead in outcome.dead_tokens {
                        self.store.remove_push_token(&dead).await?;
                        tokens.retain(|t| *t != dead);
                    }
                }
                Err(e) => {
                    tracing::warn!(notifier = n.name(), "sending deal messages failed: {e}");
                    *self.last_error.lock().expect("error lock") =
                        Some(format!("{}: {e}", n.name()));
                }
            }
        }
        if delivered {
            self.store.mark_delivered(&ids, self.now()).await?;
        }
        Ok(if delivered { ids.len() } else { 0 })
    }

    /// One round of the continuous service: visit due pages, check watches, send messages, drop
    /// stale offers. Returns how many pages were visited.
    pub async fn tick(&self, batch: usize) -> Result<usize, String> {
        self.crawler.seed(self.sink.as_ref()).await?;
        let run = self.crawler.run_due(self.sink.as_ref(), batch).await?;
        self.check_watches().await.map_err(|e| e.to_string())?;
        self.deliver_pending().await.map_err(|e| e.to_string())?;
        let before = self.now() - self.config.stale_offer_days * DAY;
        self.store
            .prune_offers(before)
            .await
            .map_err(|e| e.to_string())?;
        Ok(run.visited)
    }

    /// The server's loop: keeps going until the task is dropped. Waits briefly after a busy
    /// round and longer after an idle one.
    pub async fn run_forever(self, batch: usize, idle: Duration) {
        loop {
            let wait = match self.tick(batch).await {
                Ok(0) => idle,
                Ok(_) => Duration::from_secs(2),
                Err(e) => {
                    tracing::warn!("shop crawl round failed: {e}");
                    *self.last_error.lock().expect("error lock") = Some(e);
                    idle
                }
            };
            tokio::time::sleep(wait).await;
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum IndexRefusal {
    Busy,
}
