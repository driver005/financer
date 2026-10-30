//! The crawler. Two ways to run it with the same machinery:
//!
//! * **On demand** ([`Crawler::index_query`]): the user searched, so read what the sources have
//!   for this query now, within a page budget, reporting progress. Nothing runs otherwise.
//! * **Continuous** ([`Crawler::run_due`]): the server keeps a frontier of pages and revisits them
//!   on a schedule that adapts to how often their price moves.

use std::collections::{BTreeMap, HashSet, VecDeque};
use std::sync::{Arc, RwLock};

use financer_prices::Http;
use financer_shop_core::text::tokenize;
use financer_shop_core::{CategorySchema, ParsedQuery, Registry};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::config::{Kind, SourceConfig};
use crate::extract::{page_products, Extracted};
use crate::feed::parse_feed;
use crate::html;
use crate::llm::PageReader;
use crate::progress::{Cancel, Phase, ProgressTx};
use crate::store::{CrawlStore, FrontierItem, ItemKind, SaveOutcome};

const HOUR: i64 = 3600;
/// Most products taken from one feed per on-demand run.
const FEED_LIMIT: usize = 500;
const MAX_BACKOFF_SECS: i64 = 7 * 24 * HOUR;
/// Links taken from one sitemap or one page, so a huge or hostile one cannot flood the frontier.
const MAX_SITEMAP_LINKS: usize = 5_000;
const MAX_PAGE_LINKS: usize = 200;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceReport {
    pub pages: usize,
    pub failed: usize,
    pub products: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct IndexReport {
    pub pages: usize,
    pub failed: usize,
    pub new_products: usize,
    pub price_changes: usize,
    pub unchanged: usize,
    /// Products found but not filed, because no category matched.
    pub skipped: usize,
    pub sources: BTreeMap<String, SourceReport>,
    /// Spec labels pages used that no attribute of the category claims, most common first: the
    /// hint for what to add to a schema.
    pub unclaimed_labels: Vec<(String, usize)>,
    pub cancelled: bool,
}

/// A request to read the sources for one search.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IndexRequest {
    pub query: String,
    #[serde(default)]
    pub category: Option<String>,
    /// Restrict to these source names.
    #[serde(default)]
    pub sources: Option<Vec<String>>,
    /// Overall page limit on top of each source's own.
    #[serde(default)]
    pub max_pages: Option<usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunReport {
    pub visited: usize,
    pub failed: usize,
    pub products: usize,
    pub price_changes: usize,
}

struct Task {
    url: String,
    source: usize,
    kind: ItemKind,
    depth: u32,
    category: Option<String>,
}

/// What reading one page produced.
struct Visit {
    found: Vec<Extracted>,
    links: Vec<String>,
}

#[derive(Default)]
struct Counts {
    new: usize,
    changed: usize,
    unchanged: usize,
    skipped: usize,
    unclaimed: BTreeMap<String, usize>,
}

pub struct Crawler {
    http: Arc<dyn Http>,
    registry: Arc<RwLock<Registry>>,
    sources: Vec<SourceConfig>,
    reader: Option<Arc<dyn PageReader>>,
    clock: Arc<dyn Fn() -> i64 + Send + Sync>,
}

/// How long to wait before the next visit: sooner after a price move, later after none.
pub fn next_interval(previous_secs: i64, changed: bool, base_secs: i64) -> i64 {
    let floor = (base_secs / 4).max(HOUR);
    let ceiling = (base_secs * 4).max(floor);
    if changed {
        (previous_secs / 2).max(floor)
    } else {
        (previous_secs * 3 / 2).min(ceiling).max(floor)
    }
}

/// Wait after failures: doubles each time, at most a week.
pub fn failure_backoff(interval_secs: i64, fails: u32) -> i64 {
    (interval_secs.max(HOUR) << fails.min(10)).min(MAX_BACKOFF_SECS)
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

impl Crawler {
    pub fn new(
        http: Arc<dyn Http>,
        registry: Arc<RwLock<Registry>>,
        sources: Vec<SourceConfig>,
    ) -> Crawler {
        Crawler {
            http,
            registry,
            sources,
            reader: None,
            clock: Arc::new(unix_now),
        }
    }

    pub fn with_reader(mut self, reader: Arc<dyn PageReader>) -> Crawler {
        self.reader = Some(reader);
        self
    }

    pub fn with_clock(mut self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Crawler {
        self.clock = Arc::new(clock);
        self
    }

    pub fn sources(&self) -> &[SourceConfig] {
        &self.sources
    }

    fn schema(&self, id: &str) -> Option<CategorySchema> {
        self.registry.read().ok()?.resolved(id).ok()
    }

    fn detect_category(&self, title: &str) -> Option<String> {
        self.registry.read().ok()?.detect(&tokenize(title))
    }

    fn same_site(source: &SourceConfig, url: &Url) -> bool {
        source
            .host()
            .is_none_or(|h| url.host_str() == Some(h.as_str()))
    }

    fn normalize(url: &str) -> String {
        match Url::parse(url) {
            Ok(mut u) => {
                u.set_fragment(None);
                u.to_string()
            }
            Err(_) => url.to_string(),
        }
    }

    async fn fetch(&self, url: &str) -> Result<String, String> {
        let res = self.http.get(url).await.map_err(|e| e.to_string())?;
        if res.status >= 400 {
            return Err(format!("{url} answered {}", res.status));
        }
        Ok(res.body)
    }

    /// Read one page, feed or sitemap.
    async fn visit(
        &self,
        source: &SourceConfig,
        kind: ItemKind,
        url: &str,
        depth: u32,
    ) -> Result<Visit, String> {
        let body = self.fetch(url).await?;
        match kind {
            ItemKind::Feed => {
                let mapping = source.mapping.as_ref().ok_or("feed without mapping")?;
                let found = parse_feed(&body, source.format, mapping, url)?;
                Ok(Visit {
                    found,
                    links: Vec::new(),
                })
            }
            ItemKind::Sitemap => {
                let links = html::sitemap_locs(&body)
                    .into_iter()
                    .filter(|l| source.follow.iter().any(|f| l.contains(f.as_str())))
                    .filter_map(|l| crate::extract::web_url(&l))
                    .take(MAX_SITEMAP_LINKS)
                    .collect();
                Ok(Visit {
                    found: Vec::new(),
                    links,
                })
            }
            ItemKind::Page => {
                let mut found = page_products(&body, url);
                if found.is_empty() && source.use_llm {
                    if let Some(reader) = &self.reader {
                        found = reader.read(&body, url).await?;
                    }
                }
                let links = match Url::parse(url) {
                    Ok(base) if depth < source.max_depth => html::links(&body, &base)
                        .into_iter()
                        .filter(|l| Self::same_site(source, l))
                        .map(|l| l.to_string())
                        .filter(|l| source.follow.iter().any(|f| l.contains(f.as_str())))
                        .take(MAX_PAGE_LINKS)
                        .collect(),
                    _ => Vec::new(),
                };
                Ok(Visit { found, links })
            }
        }
    }

    /// File what a page produced. Returns the products' ids that changed.
    async fn ingest(
        &self,
        store: &dyn CrawlStore,
        source: &SourceConfig,
        found: Vec<Extracted>,
        category_hint: Option<&str>,
        counts: &mut Counts,
    ) -> Result<(), String> {
        let now = (self.clock)();
        for item in found {
            if item
                .currency
                .as_deref()
                .is_some_and(|c| !c.eq_ignore_ascii_case(&source.currency))
            {
                counts.skipped += 1;
                continue;
            }
            let category = source
                .category
                .clone()
                .or_else(|| item.category.clone().filter(|c| self.schema(c).is_some()))
                .or_else(|| category_hint.map(str::to_string))
                .or_else(|| self.detect_category(&item.title));
            let Some(schema) = category.as_deref().and_then(|c| self.schema(c)) else {
                counts.skipped += 1;
                continue;
            };
            let (mut product, unclaimed) =
                item.into_product(&schema, source.shop_name(), now, &source.label_map);
            for label in unclaimed {
                *counts.unclaimed.entry(label).or_default() += 1;
            }
            if source.specs_only {
                product.offers.clear();
            }
            match store.save(product).await? {
                SaveOutcome::New => counts.new += 1,
                SaveOutcome::Changed => counts.changed += 1,
                SaveOutcome::Unchanged => counts.unchanged += 1,
            }
        }
        Ok(())
    }

    fn matches_query(item: &Extracted, terms: &[String]) -> bool {
        if terms.is_empty() {
            return true;
        }
        let hay: Vec<String> = tokenize(&format!(
            "{} {}",
            item.title,
            item.brand.as_deref().unwrap_or("")
        ));
        terms
            .iter()
            .all(|t| hay.iter().any(|h| h.starts_with(t.as_str())))
    }

    /// Read the sources for one search and file the products. Reports progress as it goes and
    /// stops cleanly when cancelled. Never fails as a whole: a source that is down is reported
    /// and the others continue.
    pub async fn index_query(
        &self,
        store: &dyn CrawlStore,
        req: &IndexRequest,
        progress: &ProgressTx,
        cancel: &Cancel,
    ) -> IndexReport {
        let parsed = {
            let reg = self.registry.read().expect("registry lock");
            ParsedQuery::parse(&req.query, &reg, req.category.as_deref())
        };
        let mut report = IndexReport::default();
        let mut counts = Counts::default();
        let mut queue: VecDeque<Task> = VecDeque::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut budget: Vec<usize> = self.sources.iter().map(|s| s.max_pages).collect();

        for (i, s) in self.sources.iter().enumerate() {
            let wanted = req
                .sources
                .as_ref()
                .is_none_or(|names| names.contains(&s.name));
            let fits = match (&s.category, &parsed.category) {
                (Some(a), Some(b)) => a == b,
                _ => true,
            };
            if !wanted || !fits {
                continue;
            }
            let encoded: String =
                url::form_urlencoded::byte_serialize(req.query.as_bytes()).collect();
            let mut seeds: Vec<(String, ItemKind)> = Vec::new();
            match s.kind {
                Kind::Search => {
                    if let Some(t) = &s.search_url {
                        seeds.push((t.replace("{query}", &encoded), ItemKind::Page));
                    }
                }
                Kind::Pages => seeds.extend(s.urls.iter().map(|u| (u.clone(), ItemKind::Page))),
                Kind::Feed => seeds.extend(s.feed_url.iter().map(|u| (u.clone(), ItemKind::Feed))),
                // a sitemap lists a whole shop; that is the continuous crawl's job
                Kind::Sitemap => {}
            }
            for (url, kind) in seeds {
                if seen.insert(Self::normalize(&url)) && budget[i] > 0 {
                    budget[i] -= 1;
                    queue.push_back(Task {
                        url,
                        source: i,
                        kind,
                        depth: 0,
                        category: parsed.category.clone(),
                    });
                }
            }
        }
        let overall = req.max_pages.unwrap_or(usize::MAX);
        let mut total = queue.len();
        progress.update(|s| {
            s.phase = Phase::Running;
            s.total = total;
            s.message = if total == 0 {
                "No source matches this search".into()
            } else {
                "Starting".into()
            };
        });

        let mut done = 0usize;
        while let Some(task) = queue.pop_front() {
            if cancel.is_cancelled() {
                report.cancelled = true;
                break;
            }
            let source = &self.sources[task.source];
            progress.update(|s| s.message = format!("Reading {}", source.shop_name()));
            let sr = report.sources.entry(source.name.clone()).or_default();
            sr.pages += 1;
            report.pages += 1;
            match self.visit(source, task.kind, &task.url, task.depth).await {
                Ok(mut visit) => {
                    if task.kind == ItemKind::Feed {
                        visit
                            .found
                            .retain(|f| Self::matches_query(f, &parsed.terms));
                        visit.found.truncate(FEED_LIMIT);
                    }
                    sr.products += visit.found.len();
                    if let Err(e) = self
                        .ingest(
                            store,
                            source,
                            std::mem::take(&mut visit.found),
                            task.category.as_deref(),
                            &mut counts,
                        )
                        .await
                    {
                        sr.failed += 1;
                        report.failed += 1;
                        sr.last_error = Some(e);
                    }
                    for link in visit.links {
                        if report.pages + queue.len() >= overall || budget[task.source] == 0 {
                            break;
                        }
                        if seen.insert(Self::normalize(&link)) {
                            budget[task.source] -= 1;
                            total += 1;
                            queue.push_back(Task {
                                url: link,
                                source: task.source,
                                kind: ItemKind::Page,
                                depth: task.depth + 1,
                                category: task.category.clone(),
                            });
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(source = %source.name, url = %task.url, "shop page failed: {e}");
                    sr.failed += 1;
                    sr.last_error = Some(e);
                    report.failed += 1;
                }
            }
            done += 1;
            let (products, failed) = (
                counts.new + counts.changed + counts.unchanged,
                report.failed,
            );
            progress.update(|s| {
                s.done = done;
                s.total = total;
                s.products = products;
                s.failed = failed;
            });
        }
        report.new_products = counts.new;
        report.price_changes = counts.changed;
        report.unchanged = counts.unchanged;
        report.skipped = counts.skipped;
        let mut labels: Vec<(String, usize)> = counts.unclaimed.into_iter().collect();
        labels.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        labels.truncate(20);
        report.unclaimed_labels = labels;
        let products = report.new_products + report.price_changes + report.unchanged;
        let all_failed = report.pages > 0 && report.failed == report.pages;
        progress.update(|s| {
            s.phase = if report.cancelled {
                Phase::Cancelled
            } else if all_failed {
                Phase::Failed
            } else {
                Phase::Done
            };
            s.done = done;
            s.total = total;
            s.products = products;
            s.failed = report.failed;
            s.message = if report.cancelled {
                "Stopped".into()
            } else if all_failed {
                "No source could be read".into()
            } else {
                format!("{products} products indexed")
            };
        });
        report
    }

    /// Put every source's starting points into the frontier. Safe to call again and again.
    pub async fn seed(&self, store: &dyn CrawlStore) -> Result<(), String> {
        let now = (self.clock)();
        let mut items = Vec::new();
        for s in &self.sources {
            let interval = (s.recrawl_hours.max(1) as i64) * HOUR;
            let mut add = |url: String, kind: ItemKind| {
                items.push(FrontierItem {
                    url,
                    source: s.name.clone(),
                    kind,
                    category: s.category.clone(),
                    depth: 0,
                    interval_secs: interval,
                    next_at: now,
                    fails: 0,
                });
            };
            match s.kind {
                Kind::Pages => s.urls.iter().for_each(|u| add(u.clone(), ItemKind::Page)),
                Kind::Search => {
                    for q in &s.queries {
                        if let Some(t) = &s.search_url {
                            let enc: String =
                                url::form_urlencoded::byte_serialize(q.as_bytes()).collect();
                            add(t.replace("{query}", &enc), ItemKind::Page);
                        }
                    }
                }
                Kind::Feed => s
                    .feed_url
                    .iter()
                    .for_each(|u| add(u.clone(), ItemKind::Feed)),
                Kind::Sitemap => s
                    .sitemap_url
                    .iter()
                    .for_each(|u| add(u.clone(), ItemKind::Sitemap)),
            }
        }
        store.frontier_add(items).await
    }

    /// Visit up to `limit` pages whose time has come and schedule their next visit.
    pub async fn run_due(&self, store: &dyn CrawlStore, limit: usize) -> Result<RunReport, String> {
        let now = (self.clock)();
        let due = store.frontier_due(now, limit).await?;
        let mut report = RunReport::default();
        for item in due {
            let Some(source) = self.sources.iter().find(|s| s.name == item.source) else {
                // the source was removed from the configuration: push the page far out
                store
                    .frontier_done(
                        &item.url,
                        item.fails,
                        item.interval_secs,
                        now + MAX_BACKOFF_SECS,
                    )
                    .await?;
                continue;
            };
            report.visited += 1;
            let mut counts = Counts::default();
            match self.visit(source, item.kind, &item.url, item.depth).await {
                Ok(visit) => {
                    report.products += visit.found.len();
                    let ingested = self
                        .ingest(
                            store,
                            source,
                            visit.found,
                            item.category.as_deref(),
                            &mut counts,
                        )
                        .await;
                    if let Err(e) = ingested {
                        tracing::warn!(source = %source.name, "storing products failed: {e}");
                    }
                    report.price_changes += counts.changed;
                    let base = (source.recrawl_hours.max(1) as i64) * HOUR;
                    let changed = counts.changed > 0;
                    let children: Vec<FrontierItem> = visit
                        .links
                        .into_iter()
                        .map(|url| FrontierItem {
                            url,
                            source: item.source.clone(),
                            kind: ItemKind::Page,
                            category: item.category.clone(),
                            depth: item.depth + 1,
                            interval_secs: base,
                            next_at: now,
                            fails: 0,
                        })
                        .collect();
                    if !children.is_empty() {
                        store.frontier_add(children).await?;
                    }
                    // feeds, listings and sitemaps are revisited at the base rate; product
                    // pages adapt to how often their price moves
                    let interval = if item.kind == ItemKind::Page && item.depth > 0 {
                        next_interval(item.interval_secs, changed, base)
                    } else {
                        base
                    };
                    store
                        .frontier_done(&item.url, 0, interval, now + interval)
                        .await?;
                }
                Err(e) => {
                    tracing::warn!(source = %source.name, url = %item.url, "shop page failed: {e}");
                    report.failed += 1;
                    let fails = item.fails + 1;
                    store
                        .frontier_done(
                            &item.url,
                            fails,
                            item.interval_secs,
                            now + failure_backoff(item.interval_secs, fails),
                        )
                        .await?;
                }
            }
        }
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revisit_sooner_after_a_price_move_and_later_after_none() {
        let base = 24 * HOUR;
        assert_eq!(next_interval(24 * HOUR, true, base), 12 * HOUR);
        assert_eq!(next_interval(7 * HOUR, true, base), 6 * HOUR); // floor: a quarter of the base
        assert_eq!(next_interval(6 * HOUR, true, base), 6 * HOUR);
        assert_eq!(next_interval(24 * HOUR, false, base), 36 * HOUR);
        assert_eq!(next_interval(90 * HOUR, false, base), 96 * HOUR); // ceiling: four times the base
    }

    #[test]
    fn failures_back_off_up_to_a_week() {
        assert_eq!(failure_backoff(24 * HOUR, 1), 48 * HOUR);
        assert_eq!(failure_backoff(24 * HOUR, 2), 96 * HOUR);
        assert_eq!(failure_backoff(24 * HOUR, 9), MAX_BACKOFF_SECS);
    }
}
