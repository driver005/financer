//! Persistence for the shopping assistant. It has its own tables and its own migration history,
//! so it can live in a database of its own (the standalone app) or beside the finance data (the
//! bundled app) without either knowing about the other.

pub mod entity;
pub mod migration;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use financer_shop_core::{
    CategorySchema, DealEvent, Offer, PricePoint, Product, Profile, Registry, Watch,
};
use financer_shop_sources::{CrawlStore, FrontierItem, ItemKind, SaveOutcome};
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectOptions, Database, DatabaseConnection, DbErr,
    EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, TransactionTrait,
};
use sea_orm_migration::MigratorTrait;
use serde::de::DeserializeOwned;

use entity::{
    event, frontier, kv, offer, price_point, product, profile, push_token, schema, watch,
};

/// Horizon in months used for the stored comparable price (what "cheapest" means in the database).
const STORE_HORIZON: u32 = 24;
/// A price point is written when the best price moves, and at least this often otherwise, so a
/// flat price still shows how long it has been flat.
const SAMPLE_EVERY_SECS: i64 = 12 * 3600;

#[derive(Debug, thiserror::Error)]
pub enum ShopStoreError {
    #[error("database error: {0}")]
    Db(#[from] DbErr),
    #[error("stored data is unreadable: {0}")]
    Data(#[from] serde_json::Error),
}

type Result<T> = std::result::Result<T, ShopStoreError>;

fn json<T: serde::Serialize>(v: &T) -> Result<String> {
    Ok(serde_json::to_string(v)?)
}

fn unjson<T: DeserializeOwned>(s: &str) -> Result<T> {
    Ok(serde_json::from_str(s)?)
}

#[derive(Clone)]
pub struct ShopStore {
    db: DatabaseConnection,
    /// Bumped by every write through this store, so a cached view can tell it is out of date even
    /// when two writes land in the same second.
    generation: Arc<AtomicU64>,
}

/// A deal message as stored, with its place in the feed.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredEvent {
    pub id: i64,
    pub event: DealEvent,
    pub created_at: i64,
    pub delivered_at: Option<i64>,
    pub read_at: Option<i64>,
}

impl ShopStore {
    /// `sqlite://path?mode=rwc`, `sqlite::memory:` or `postgres://...`; runs pending migrations.
    pub async fn connect(url: &str) -> Result<ShopStore> {
        let mut opts = ConnectOptions::new(url.to_string());
        opts.sqlx_logging(false);
        if url.contains(":memory:") {
            opts.max_connections(1).min_connections(1);
        }
        Self::from_connection(Database::connect(opts).await?).await
    }

    /// Use a connection that already exists (the shopping tables are added to it).
    pub async fn from_connection(db: DatabaseConnection) -> Result<ShopStore> {
        migration::Migrator::up(&db, None).await?;
        Ok(ShopStore {
            db,
            generation: Arc::new(AtomicU64::new(0)),
        })
    }

    // ---- products ---------------------------------------------------------------------------

    async fn offers_of(&self, ids: &[String]) -> Result<HashMap<String, Vec<Offer>>> {
        let mut out: HashMap<String, Vec<Offer>> = HashMap::new();
        for chunk in ids.chunks(400) {
            let rows = offer::Entity::find()
                .filter(offer::Column::ProductId.is_in(chunk.to_vec()))
                .order_by_asc(offer::Column::Id)
                .all(&self.db)
                .await?;
            for r in rows {
                out.entry(r.product_id).or_default().push(unjson(&r.data)?);
            }
        }
        Ok(out)
    }

    async fn assemble(&self, rows: Vec<product::Model>) -> Result<Vec<Product>> {
        let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
        let mut offers = self.offers_of(&ids).await?;
        rows.into_iter()
            .map(|r| {
                let mut p: Product = unjson(&r.data)?;
                p.offers = offers.remove(&r.id).unwrap_or_default();
                Ok(p)
            })
            .collect()
    }

    pub async fn get_product(&self, id: &str) -> Result<Option<Product>> {
        let rows = product::Entity::find_by_id(id.to_string())
            .all(&self.db)
            .await?;
        Ok(self.assemble(rows).await?.into_iter().next())
    }

    pub async fn products_by_ids(&self, ids: &[String]) -> Result<Vec<Product>> {
        let mut rows = Vec::new();
        for chunk in ids.chunks(400) {
            rows.extend(
                product::Entity::find()
                    .filter(product::Column::Id.is_in(chunk.to_vec()))
                    .all(&self.db)
                    .await?,
            );
        }
        let by_id: HashMap<String, Product> = self
            .assemble(rows)
            .await?
            .into_iter()
            .map(|p| (p.id.clone(), p))
            .collect();
        Ok(ids.iter().filter_map(|i| by_id.get(i).cloned()).collect())
    }

    /// Every product, or the ones of a category.
    pub async fn list_products(&self, category: Option<&str>) -> Result<Vec<Product>> {
        let mut q = product::Entity::find().order_by_asc(product::Column::Id);
        if let Some(c) = category {
            q = q.filter(product::Column::Category.eq(c));
        }
        let rows = q.all(&self.db).await?;
        self.assemble(rows).await
    }

    fn changed(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    /// Write counter, product count and latest change: if all are unchanged, nothing in the
    /// catalogue moved, so an index built from it is still good.
    pub async fn fingerprint(&self) -> Result<(u64, u64, i64)> {
        let count = product::Entity::find().count(&self.db).await?;
        let latest = product::Entity::find()
            .order_by_desc(product::Column::UpdatedAt)
            .one(&self.db)
            .await?
            .map_or(0, |r| r.updated_at);
        Ok((self.generation.load(Ordering::SeqCst), count, latest))
    }

    pub async fn count_products(&self, category: Option<&str>) -> Result<u64> {
        let mut q = product::Entity::find();
        if let Some(c) = category {
            q = q.filter(product::Column::Category.eq(c));
        }
        Ok(q.count(&self.db).await?)
    }

    pub async fn delete_product(&self, id: &str) -> Result<bool> {
        let txn = self.db.begin().await?;
        offer::Entity::delete_many()
            .filter(offer::Column::ProductId.eq(id))
            .exec(&txn)
            .await?;
        price_point::Entity::delete_many()
            .filter(price_point::Column::ProductId.eq(id))
            .exec(&txn)
            .await?;
        let gone = product::Entity::delete_by_id(id.to_string())
            .exec(&txn)
            .await?
            .rows_affected
            > 0;
        txn.commit().await?;
        self.changed();
        Ok(gone)
    }

    /// Replace a product's own record (what a person edited: attributes, title, tags). Offers
    /// are left alone.
    pub async fn update_product(&self, p: &Product, now: i64) -> Result<bool> {
        let Some(existing) = product::Entity::find_by_id(p.id.clone())
            .one(&self.db)
            .await?
        else {
            return Ok(false);
        };
        let mut bare = p.clone();
        bare.offers.clear();
        product::Entity::update(product::ActiveModel {
            id: Set(existing.id),
            category: Set(p.category.clone()),
            title: Set(p.title.clone()),
            gtin: Set(p.gtin.clone()),
            data: Set(json(&bare)?),
            updated_at: Set(now),
            ..Default::default()
        })
        .exec(&self.db)
        .await?;
        self.changed();
        Ok(true)
    }

    /// Insert a product or merge it into the one we know (matched by id, then by GTIN): known
    /// values are kept, gaps are filled, offers are refreshed. Records a price point when the
    /// best price moved.
    pub async fn upsert_product(&self, mut incoming: Product, now: i64) -> Result<SaveOutcome> {
        let txn = self.db.begin().await?;
        let mut existing = product::Entity::find_by_id(incoming.id.clone())
            .one(&txn)
            .await?;
        if existing.is_none() {
            if let Some(g) = incoming.gtin.as_ref().filter(|g| !g.is_empty()) {
                existing = product::Entity::find()
                    .filter(product::Column::Gtin.eq(g.as_str()))
                    .one(&txn)
                    .await?;
                if let Some(e) = &existing {
                    incoming.id = e.id.clone();
                }
            }
        }
        let mut merged = match &existing {
            Some(row) => {
                let mut current: Product = unjson(&row.data)?;
                current.offers = offer::Entity::find()
                    .filter(offer::Column::ProductId.eq(row.id.as_str()))
                    .order_by_asc(offer::Column::Id)
                    .all(&txn)
                    .await?
                    .into_iter()
                    .map(|r| unjson(&r.data))
                    .collect::<Result<_>>()?;
                current
            }
            None => Product {
                offers: Vec::new(),
                ..incoming.clone()
            },
        };
        let before = best_price(&merged);
        if existing.is_some() {
            merged.merge_missing(&incoming);
        } else {
            for o in incoming.offers.clone() {
                merged.upsert_offer(o);
            }
        }
        let after = best_price(&merged);

        let mut bare = merged.clone();
        bare.offers.clear();
        let row = product::ActiveModel {
            id: Set(merged.id.clone()),
            category: Set(merged.category.clone()),
            title: Set(merged.title.clone()),
            gtin: Set(merged.gtin.clone()),
            data: Set(json(&bare)?),
            created_at: Set(existing.as_ref().map_or(now, |e| e.created_at)),
            updated_at: Set(now),
        };
        product::Entity::insert(row)
            .on_conflict(
                OnConflict::column(product::Column::Id)
                    .update_columns([
                        product::Column::Category,
                        product::Column::Title,
                        product::Column::Gtin,
                        product::Column::Data,
                        product::Column::UpdatedAt,
                    ])
                    .to_owned(),
            )
            .exec_without_returning(&txn)
            .await?;

        for o in &incoming.offers {
            let row = offer::ActiveModel {
                id: sea_orm::ActiveValue::NotSet,
                product_id: Set(merged.id.clone()),
                shop: Set(o.shop.clone()),
                url: Set(o.url.clone()),
                condition: Set(format!("{:?}", o.condition)),
                comparable_cents: Set(o.comparable_cents(STORE_HORIZON)),
                seen_at: Set(o.seen_at),
                data: Set(json(o)?),
            };
            offer::Entity::insert(row)
                .on_conflict(
                    OnConflict::columns([
                        offer::Column::ProductId,
                        offer::Column::Shop,
                        offer::Column::Url,
                        offer::Column::Condition,
                    ])
                    .update_columns([
                        offer::Column::ComparableCents,
                        offer::Column::SeenAt,
                        offer::Column::Data,
                    ])
                    .to_owned(),
                )
                .exec_without_returning(&txn)
                .await?;
        }

        if let Some(cents) = after {
            let last = price_point::Entity::find()
                .filter(price_point::Column::ProductId.eq(merged.id.as_str()))
                .order_by_desc(price_point::Column::At)
                .one(&txn)
                .await?;
            let due = last
                .as_ref()
                .is_none_or(|l| l.cents != cents || now - l.at >= SAMPLE_EVERY_SECS);
            if due {
                price_point::Entity::insert(price_point::ActiveModel {
                    id: sea_orm::ActiveValue::NotSet,
                    product_id: Set(merged.id.clone()),
                    at: Set(now),
                    cents: Set(cents),
                })
                .exec_without_returning(&txn)
                .await?;
            }
        }
        txn.commit().await?;
        self.changed();
        Ok(match (existing.is_some(), before == after) {
            (false, _) => SaveOutcome::New,
            (true, false) => SaveOutcome::Changed,
            (true, true) => SaveOutcome::Unchanged,
        })
    }

    pub async fn price_history(&self, product_id: &str, since: i64) -> Result<Vec<PricePoint>> {
        Ok(price_point::Entity::find()
            .filter(price_point::Column::ProductId.eq(product_id))
            .filter(price_point::Column::At.gte(since))
            .order_by_asc(price_point::Column::At)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| PricePoint {
                at: r.at,
                cents: r.cents,
            })
            .collect())
    }

    /// Price history of many products at once.
    pub async fn price_histories(
        &self,
        ids: &[String],
        since: i64,
    ) -> Result<HashMap<String, Vec<PricePoint>>> {
        let mut out: HashMap<String, Vec<PricePoint>> = HashMap::new();
        for chunk in ids.chunks(400) {
            let rows = price_point::Entity::find()
                .filter(price_point::Column::ProductId.is_in(chunk.to_vec()))
                .filter(price_point::Column::At.gte(since))
                .order_by_asc(price_point::Column::At)
                .all(&self.db)
                .await?;
            for r in rows {
                out.entry(r.product_id).or_default().push(PricePoint {
                    at: r.at,
                    cents: r.cents,
                });
            }
        }
        Ok(out)
    }

    /// Forget offers not seen since `before`; a shop that no longer lists a product stops
    /// counting as a place to buy it. Returns how many were removed.
    pub async fn prune_offers(&self, before: i64) -> Result<u64> {
        let removed = offer::Entity::delete_many()
            .filter(offer::Column::SeenAt.lt(before))
            .exec(&self.db)
            .await?
            .rows_affected;
        if removed > 0 {
            self.changed();
        }
        Ok(removed)
    }

    // ---- schemas, profiles, settings ----------------------------------------------------------

    /// Built-in categories plus the stored ones (a stored schema replaces a built-in of the same id).
    pub async fn registry(&self) -> Result<Registry> {
        let mut reg = Registry::builtin();
        let mut stored: Vec<CategorySchema> = Vec::new();
        for row in schema::Entity::find()
            .order_by_asc(schema::Column::Id)
            .all(&self.db)
            .await?
        {
            stored.push(unjson(&row.data)?);
        }
        // parents first, so a category can extend another stored one
        let mut pending = stored;
        for _ in 0..8 {
            let mut next = Vec::new();
            for s in pending {
                if reg.put(s.clone()).is_err() {
                    next.push(s);
                }
            }
            pending = next;
            if pending.is_empty() {
                break;
            }
        }
        Ok(reg)
    }

    pub async fn put_schema(&self, s: &CategorySchema) -> Result<()> {
        schema::Entity::insert(schema::ActiveModel {
            id: Set(s.id.clone()),
            data: Set(json(s)?),
        })
        .on_conflict(
            OnConflict::column(schema::Column::Id)
                .update_column(schema::Column::Data)
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }

    pub async fn delete_schema(&self, id: &str) -> Result<bool> {
        Ok(schema::Entity::delete_by_id(id.to_string())
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    pub async fn stored_schema_ids(&self) -> Result<Vec<String>> {
        Ok(schema::Entity::find()
            .order_by_asc(schema::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| r.id)
            .collect())
    }

    pub async fn put_profile(&self, name: &str, p: &Profile) -> Result<()> {
        profile::Entity::insert(profile::ActiveModel {
            name: Set(name.to_string()),
            data: Set(json(p)?),
        })
        .on_conflict(
            OnConflict::column(profile::Column::Name)
                .update_column(profile::Column::Data)
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }

    pub async fn get_profile(&self, name: &str) -> Result<Option<Profile>> {
        profile::Entity::find_by_id(name.to_string())
            .one(&self.db)
            .await?
            .map(|r| unjson(&r.data))
            .transpose()
    }

    pub async fn list_profiles(&self) -> Result<Vec<(String, Profile)>> {
        profile::Entity::find()
            .order_by_asc(profile::Column::Name)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| Ok((r.name, unjson(&r.data)?)))
            .collect()
    }

    pub async fn delete_profile(&self, name: &str) -> Result<bool> {
        Ok(profile::Entity::delete_by_id(name.to_string())
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        Ok(kv::Entity::find_by_id(key.to_string())
            .one(&self.db)
            .await?
            .map(|r| r.value))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        kv::Entity::insert(kv::ActiveModel {
            key: Set(key.to_string()),
            value: Set(value.to_string()),
        })
        .on_conflict(
            OnConflict::column(kv::Column::Key)
                .update_column(kv::Column::Value)
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }

    // ---- watches and deal events ---------------------------------------------------------------

    pub async fn create_watch(&self, w: &Watch) -> Result<Watch> {
        let inserted = watch::Entity::insert(watch::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            data: Set(json(w)?),
            enabled: Set(w.enabled),
        })
        .exec(&self.db)
        .await?;
        let mut saved = w.clone();
        saved.id = inserted.last_insert_id;
        self.update_watch(&saved).await?;
        Ok(saved)
    }

    pub async fn update_watch(&self, w: &Watch) -> Result<bool> {
        let res = watch::Entity::update_many()
            .col_expr(
                watch::Column::Data,
                sea_orm::sea_query::Expr::value(json(w)?),
            )
            .col_expr(
                watch::Column::Enabled,
                sea_orm::sea_query::Expr::value(w.enabled),
            )
            .filter(watch::Column::Id.eq(w.id))
            .exec(&self.db)
            .await?;
        Ok(res.rows_affected > 0)
    }

    pub async fn list_watches(&self) -> Result<Vec<Watch>> {
        watch::Entity::find()
            .order_by_asc(watch::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| {
                let mut w: Watch = unjson(&r.data)?;
                w.id = r.id;
                w.enabled = r.enabled;
                Ok(w)
            })
            .collect()
    }

    pub async fn delete_watch(&self, id: i64) -> Result<bool> {
        Ok(watch::Entity::delete_by_id(id)
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    /// Store a deal message unless the same key is already there. Returns whether it is new.
    pub async fn record_event(&self, ev: &DealEvent, now: i64) -> Result<bool> {
        let n = event::Entity::insert(event::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            key: Set(ev.key.clone()),
            watch_id: Set(ev.watch_id),
            product_id: Set(ev.product_id.clone()),
            price_cents: Set(ev.price_cents),
            data: Set(json(ev)?),
            created_at: Set(now),
            delivered_at: Set(None),
            read_at: Set(None),
        })
        .on_conflict(
            OnConflict::column(event::Column::Key)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(n > 0)
    }

    /// The price of the latest message for this watch and product, to avoid repeating ourselves.
    pub async fn last_event_price(&self, watch_id: i64, product_id: &str) -> Result<Option<i64>> {
        Ok(event::Entity::find()
            .filter(event::Column::WatchId.eq(watch_id))
            .filter(event::Column::ProductId.eq(product_id))
            .order_by_desc(event::Column::Id)
            .one(&self.db)
            .await?
            .map(|r| r.price_cents))
    }

    fn stored_event(r: event::Model) -> Result<StoredEvent> {
        Ok(StoredEvent {
            id: r.id,
            event: unjson(&r.data)?,
            created_at: r.created_at,
            delivered_at: r.delivered_at,
            read_at: r.read_at,
        })
    }

    /// Messages with an id above `after_id`, oldest first: the feed the app polls.
    pub async fn events_after(&self, after_id: i64, limit: u64) -> Result<Vec<StoredEvent>> {
        event::Entity::find()
            .filter(event::Column::Id.gt(after_id))
            .order_by_asc(event::Column::Id)
            .limit(limit)
            .all(&self.db)
            .await?
            .into_iter()
            .map(Self::stored_event)
            .collect()
    }

    /// Messages not yet pushed to the person's devices.
    pub async fn undelivered_events(&self, limit: u64) -> Result<Vec<StoredEvent>> {
        event::Entity::find()
            .filter(event::Column::DeliveredAt.is_null())
            .order_by_asc(event::Column::Id)
            .limit(limit)
            .all(&self.db)
            .await?
            .into_iter()
            .map(Self::stored_event)
            .collect()
    }

    pub async fn mark_delivered(&self, ids: &[i64], now: i64) -> Result<()> {
        event::Entity::update_many()
            .col_expr(
                event::Column::DeliveredAt,
                sea_orm::sea_query::Expr::value(now),
            )
            .filter(event::Column::Id.is_in(ids.to_vec()))
            .exec(&self.db)
            .await?;
        Ok(())
    }

    pub async fn mark_read(&self, up_to_id: i64, now: i64) -> Result<u64> {
        Ok(event::Entity::update_many()
            .col_expr(event::Column::ReadAt, sea_orm::sea_query::Expr::value(now))
            .filter(event::Column::Id.lte(up_to_id))
            .filter(event::Column::ReadAt.is_null())
            .exec(&self.db)
            .await?
            .rows_affected)
    }

    pub async fn unread_count(&self) -> Result<u64> {
        Ok(event::Entity::find()
            .filter(event::Column::ReadAt.is_null())
            .count(&self.db)
            .await?)
    }

    // ---- push tokens ---------------------------------------------------------------------------

    pub async fn add_push_token(&self, token: &str, now: i64) -> Result<()> {
        push_token::Entity::insert(push_token::ActiveModel {
            token: Set(token.to_string()),
            created_at: Set(now),
        })
        .on_conflict(
            OnConflict::column(push_token::Column::Token)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }

    pub async fn remove_push_token(&self, token: &str) -> Result<bool> {
        Ok(push_token::Entity::delete_by_id(token.to_string())
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    pub async fn push_tokens(&self) -> Result<Vec<String>> {
        Ok(push_token::Entity::find()
            .order_by_asc(push_token::Column::CreatedAt)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| r.token)
            .collect())
    }

    pub async fn frontier_len(&self) -> Result<u64> {
        Ok(frontier::Entity::find().count(&self.db).await?)
    }
}

fn best_price(p: &Product) -> Option<i64> {
    p.offers
        .iter()
        .map(|o| o.comparable_cents(STORE_HORIZON))
        .min()
}

fn kind_name(k: ItemKind) -> &'static str {
    match k {
        ItemKind::Page => "page",
        ItemKind::Feed => "feed",
        ItemKind::Sitemap => "sitemap",
    }
}

fn parse_kind(s: &str) -> ItemKind {
    match s {
        "feed" => ItemKind::Feed,
        "sitemap" => ItemKind::Sitemap,
        _ => ItemKind::Page,
    }
}

/// The crawler's view of the store. `clock` stamps what is saved.
pub struct StoreSink {
    pub store: ShopStore,
    pub clock: fn() -> i64,
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

impl StoreSink {
    pub fn new(store: ShopStore) -> StoreSink {
        StoreSink {
            store,
            clock: unix_now,
        }
    }
}

#[async_trait]
impl CrawlStore for StoreSink {
    async fn save(&self, product: Product) -> std::result::Result<SaveOutcome, String> {
        let now = product
            .offers
            .iter()
            .map(|o| o.seen_at)
            .max()
            .filter(|t| *t > 0)
            .unwrap_or_else(self.clock);
        self.store
            .upsert_product(product, now)
            .await
            .map_err(|e| e.to_string())
    }

    async fn frontier_add(&self, items: Vec<FrontierItem>) -> std::result::Result<(), String> {
        for chunk in items.chunks(200) {
            let rows: Vec<frontier::ActiveModel> = chunk
                .iter()
                .map(|i| frontier::ActiveModel {
                    url: Set(i.url.clone()),
                    source: Set(i.source.clone()),
                    kind: Set(kind_name(i.kind).into()),
                    category: Set(i.category.clone()),
                    depth: Set(i.depth as i32),
                    interval_secs: Set(i.interval_secs),
                    next_at: Set(i.next_at),
                    fails: Set(i.fails as i32),
                })
                .collect();
            frontier::Entity::insert_many(rows)
                .on_conflict_do_nothing_on([frontier::Column::Url])
                .exec_without_returning(&self.store.db)
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    async fn frontier_due(
        &self,
        now: i64,
        limit: usize,
    ) -> std::result::Result<Vec<FrontierItem>, String> {
        let rows = frontier::Entity::find()
            .filter(frontier::Column::NextAt.lte(now))
            .order_by_asc(frontier::Column::NextAt)
            .order_by_asc(frontier::Column::Url)
            .limit(limit as u64)
            .all(&self.store.db)
            .await
            .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| FrontierItem {
                url: r.url,
                source: r.source,
                kind: parse_kind(&r.kind),
                category: r.category,
                depth: r.depth.max(0) as u32,
                interval_secs: r.interval_secs,
                next_at: r.next_at,
                fails: r.fails.max(0) as u32,
            })
            .collect())
    }

    async fn frontier_done(
        &self,
        url: &str,
        fails: u32,
        interval_secs: i64,
        next_at: i64,
    ) -> std::result::Result<(), String> {
        frontier::Entity::update_many()
            .col_expr(
                frontier::Column::Fails,
                sea_orm::sea_query::Expr::value(fails as i32),
            )
            .col_expr(
                frontier::Column::IntervalSecs,
                sea_orm::sea_query::Expr::value(interval_secs),
            )
            .col_expr(
                frontier::Column::NextAt,
                sea_orm::sea_query::Expr::value(next_at),
            )
            .filter(frontier::Column::Url.eq(url))
            .exec(&self.store.db)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use financer_shop_core::{AttrValue, EventKind, Verdict};

    async fn store() -> ShopStore {
        ShopStore::connect("sqlite::memory:").await.unwrap()
    }

    fn phone(price: i64, shop: &str, at: i64) -> Product {
        let mut o = Offer::one_time(shop, &format!("https://{shop}.test/p"), price);
        o.seen_at = at;
        let mut p = Product::new("smartphone", "Google Pixel 9").with_offer(o);
        p.brand = Some("Google".into());
        p
    }

    #[tokio::test]
    async fn products_round_trip_with_offers_and_report_changes() {
        let s = store().await;
        assert_eq!(
            s.upsert_product(phone(64_900, "a", 100), 100)
                .await
                .unwrap(),
            SaveOutcome::New
        );
        assert_eq!(
            s.upsert_product(phone(64_900, "a", 200), 200)
                .await
                .unwrap(),
            SaveOutcome::Unchanged
        );
        // another shop, dearer: a second offer, the best price is the same
        assert_eq!(
            s.upsert_product(phone(66_000, "b", 300), 300)
                .await
                .unwrap(),
            SaveOutcome::Unchanged
        );
        // cheaper at the first shop
        assert_eq!(
            s.upsert_product(phone(59_900, "a", 400), 400)
                .await
                .unwrap(),
            SaveOutcome::Changed
        );

        let p = s
            .get_product("smartphone:google-pixel-9")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(p.offers.len(), 2);
        assert_eq!(p.offers.iter().map(|o| o.price_cents).min(), Some(59_900));
        assert_eq!(s.count_products(Some("smartphone")).await.unwrap(), 1);
        assert_eq!(s.count_products(Some("laptop")).await.unwrap(), 0);
        assert_eq!(s.list_products(None).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn merging_keeps_existing_values_and_a_person_s_edits_survive_a_crawl() {
        let s = store().await;
        let mut first = phone(64_900, "a", 100);
        first
            .attributes
            .insert("ram_gb".into(), AttrValue::Num(12.0));
        s.upsert_product(first, 100).await.unwrap();

        let mut edited = s
            .get_product("smartphone:google-pixel-9")
            .await
            .unwrap()
            .unwrap();
        edited
            .attributes
            .insert("camera_score".into(), AttrValue::Num(92.0));
        edited
            .attributes
            .insert("my_note".into(), AttrValue::Text("friend has one".into()));
        assert!(s.update_product(&edited, 150).await.unwrap());

        let mut crawled = phone(64_900, "a", 200);
        crawled
            .attributes
            .insert("ram_gb".into(), AttrValue::Num(8.0));
        crawled
            .attributes
            .insert("nfc".into(), AttrValue::Bool(true));
        s.upsert_product(crawled, 200).await.unwrap();

        let p = s
            .get_product("smartphone:google-pixel-9")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(p.attributes["ram_gb"], AttrValue::Num(12.0));
        assert_eq!(p.attributes["camera_score"], AttrValue::Num(92.0));
        assert_eq!(
            p.attributes["my_note"],
            AttrValue::Text("friend has one".into())
        );
        assert_eq!(p.attributes["nfc"], AttrValue::Bool(true));
        assert!(!s
            .update_product(&Product::new("smartphone", "Ghost"), 1)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn the_same_gtin_merges_into_the_known_product() {
        let s = store().await;
        let mut a = phone(64_900, "a", 100);
        a.gtin = Some("0840353930011".into());
        s.upsert_product(a, 100).await.unwrap();
        let mut b = Product::new("smartphone", "Pixel 9 (128 GB, Obsidian)").with_offer({
            let mut o = Offer::one_time("b", "https://b.test/x", 63_900);
            o.seen_at = 200;
            o
        });
        b.id = "smartphone:gtin-840353930011".into();
        b.gtin = Some("0840353930011".into());
        assert_eq!(
            s.upsert_product(b, 200).await.unwrap(),
            SaveOutcome::Changed
        );
        assert_eq!(s.count_products(None).await.unwrap(), 1);
        assert_eq!(s.list_products(None).await.unwrap()[0].offers.len(), 2);
    }

    #[tokio::test]
    async fn price_history_records_moves_and_sparse_samples() {
        let s = store().await;
        let id = "smartphone:google-pixel-9".to_string();
        s.upsert_product(phone(64_900, "a", 0), 0).await.unwrap();
        s.upsert_product(phone(64_900, "a", 3_600), 3_600)
            .await
            .unwrap(); // flat, too soon
        s.upsert_product(phone(64_900, "a", 13 * 3_600), 13 * 3_600)
            .await
            .unwrap(); // flat, long enough
        s.upsert_product(phone(59_900, "a", 14 * 3_600), 14 * 3_600)
            .await
            .unwrap(); // moved
        let h = s.price_history(&id, 0).await.unwrap();
        assert_eq!(
            h.iter().map(|p| p.cents).collect::<Vec<_>>(),
            [64_900, 64_900, 59_900]
        );
        assert_eq!(s.price_history(&id, 13 * 3_600).await.unwrap().len(), 2);
        assert_eq!(
            s.price_histories(&[id.clone(), "x".into()], 0)
                .await
                .unwrap()[&id]
                .len(),
            3
        );
    }

    #[tokio::test]
    async fn stale_offers_are_pruned_and_products_deleted_with_their_data() {
        let s = store().await;
        s.upsert_product(phone(64_900, "a", 100), 100)
            .await
            .unwrap();
        s.upsert_product(phone(66_000, "b", 900), 900)
            .await
            .unwrap();
        assert_eq!(s.prune_offers(500).await.unwrap(), 1);
        assert_eq!(
            s.get_product("smartphone:google-pixel-9")
                .await
                .unwrap()
                .unwrap()
                .offers
                .len(),
            1
        );
        assert!(s.delete_product("smartphone:google-pixel-9").await.unwrap());
        assert!(s
            .get_product("smartphone:google-pixel-9")
            .await
            .unwrap()
            .is_none());
        assert!(s
            .price_history("smartphone:google-pixel-9", 0)
            .await
            .unwrap()
            .is_empty());
        assert!(!s.delete_product("smartphone:google-pixel-9").await.unwrap());
    }

    #[tokio::test]
    async fn custom_categories_are_stored_and_extend_the_builtin_ones() {
        let s = store().await;
        let custom: CategorySchema = serde_json::from_str(
            r#"{"id": "gaming_phone", "name": "Gaming phone", "extends": "smartphone",
                "attributes": [{"key": "triggers", "label": "Triggers", "kind": "bool"}],
                "criteria": [{"key": "triggers", "label": "Triggers", "kind": "flag", "attribute": "triggers", "weight": 2}]}"#,
        )
        .unwrap();
        s.put_schema(&custom).await.unwrap();
        let reg = s.registry().await.unwrap();
        let resolved = reg.resolved("gaming_phone").unwrap();
        assert!(
            resolved.criterion("battery").is_some() && resolved.criterion("triggers").is_some()
        );
        assert_eq!(s.stored_schema_ids().await.unwrap(), ["gaming_phone"]);
        assert!(s.delete_schema("gaming_phone").await.unwrap());
        assert!(s.registry().await.unwrap().raw("gaming_phone").is_none());
    }

    #[tokio::test]
    async fn profiles_and_settings_round_trip() {
        let s = store().await;
        let mut p = Profile::default();
        p.weights.insert("camera".into(), 5.0);
        s.put_profile("photographer", &p).await.unwrap();
        assert_eq!(
            s.get_profile("photographer").await.unwrap(),
            Some(p.clone())
        );
        assert_eq!(s.list_profiles().await.unwrap().len(), 1);
        assert!(s.delete_profile("photographer").await.unwrap());
        assert!(s.get_profile("photographer").await.unwrap().is_none());
        s.set_setting("a", "1").await.unwrap();
        s.set_setting("a", "2").await.unwrap();
        assert_eq!(s.get_setting("a").await.unwrap().as_deref(), Some("2"));
    }

    fn event(key: &str, price: i64) -> DealEvent {
        DealEvent {
            key: key.into(),
            watch_id: 1,
            watch_name: "w".into(),
            product_id: "p".into(),
            title: "P".into(),
            shop: "S".into(),
            url: "u".into(),
            price_cents: price,
            reference_cents: None,
            discount_pct: 0.0,
            verdict: Verdict::Good,
            kind: EventKind::Deal,
        }
    }

    #[tokio::test]
    async fn watches_and_events_form_a_feed_that_is_delivered_and_read_once() {
        let s = store().await;
        let w = s
            .create_watch(&Watch {
                id: 0,
                name: "Pixel".into(),
                category: None,
                query: Some("pixel".into()),
                product_ids: vec![],
                max_price_cents: Some(50_000),
                min_discount_pct: None,
                enabled: true,
            })
            .await
            .unwrap();
        assert!(w.id > 0);
        let mut off = w.clone();
        off.enabled = false;
        assert!(s.update_watch(&off).await.unwrap());
        let listed = s.list_watches().await.unwrap();
        assert_eq!(
            (listed.len(), listed[0].enabled, listed[0].id),
            (1, false, w.id)
        );

        assert!(s.record_event(&event("k1", 49_900), 10).await.unwrap());
        assert!(
            !s.record_event(&event("k1", 49_900), 11).await.unwrap(),
            "same key, same message"
        );
        assert!(s.record_event(&event("k2", 45_000), 12).await.unwrap());
        assert_eq!(s.last_event_price(1, "p").await.unwrap(), Some(45_000));
        assert_eq!(s.last_event_price(2, "p").await.unwrap(), None);

        let all = s.events_after(0, 10).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(s.events_after(all[0].id, 10).await.unwrap().len(), 1);
        assert_eq!(s.undelivered_events(10).await.unwrap().len(), 2);
        s.mark_delivered(&[all[0].id], 20).await.unwrap();
        assert_eq!(s.undelivered_events(10).await.unwrap().len(), 1);
        assert_eq!(s.unread_count().await.unwrap(), 2);
        assert_eq!(s.mark_read(all[0].id, 30).await.unwrap(), 1);
        assert_eq!(s.unread_count().await.unwrap(), 1);
        assert!(s.delete_watch(w.id).await.unwrap());
    }

    #[tokio::test]
    async fn push_tokens_are_kept_once() {
        let s = store().await;
        s.add_push_token("ExponentPushToken[abc]", 1).await.unwrap();
        s.add_push_token("ExponentPushToken[abc]", 2).await.unwrap();
        assert_eq!(s.push_tokens().await.unwrap(), ["ExponentPushToken[abc]"]);
        assert!(s.remove_push_token("ExponentPushToken[abc]").await.unwrap());
        assert!(s.push_tokens().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_crawler_frontier_is_stored_deduplicated_and_ordered() {
        let sink = StoreSink::new(store().await);
        let item = |url: &str, next_at: i64| FrontierItem {
            url: url.into(),
            source: "s".into(),
            kind: ItemKind::Page,
            category: Some("smartphone".into()),
            depth: 1,
            interval_secs: 3_600,
            next_at,
            fails: 0,
        };
        sink.frontier_add(vec![
            item("https://a.test/1", 50),
            item("https://a.test/2", 10),
            item("https://a.test/1", 99),
        ])
        .await
        .unwrap();
        sink.frontier_add(vec![]).await.unwrap();
        assert_eq!(sink.store.frontier_len().await.unwrap(), 2);
        let due = sink.frontier_due(60, 10).await.unwrap();
        assert_eq!(
            due.iter().map(|i| i.url.as_str()).collect::<Vec<_>>(),
            ["https://a.test/2", "https://a.test/1"]
        );
        assert_eq!(
            due[1].next_at, 50,
            "an address already queued is left as it is"
        );
        sink.frontier_done("https://a.test/2", 2, 7_200, 1_000)
            .await
            .unwrap();
        let due = sink.frontier_due(60, 10).await.unwrap();
        assert_eq!(due.len(), 1);
        let later = sink.frontier_due(2_000, 10).await.unwrap();
        assert_eq!((later[1].fails, later[1].interval_secs), (2, 7_200));
    }

    #[tokio::test]
    async fn the_shopping_tables_can_share_a_database_file() {
        let dir = tempfile::tempdir().unwrap();
        let url = format!(
            "sqlite://{}?mode=rwc",
            dir.path().join("shared.db").display()
        );
        {
            let s = ShopStore::connect(&url).await.unwrap();
            s.upsert_product(phone(64_900, "a", 1), 1).await.unwrap();
        }
        // reopening runs no migration twice and keeps the data
        let s = ShopStore::connect(&url).await.unwrap();
        assert_eq!(s.count_products(None).await.unwrap(), 1);
    }
}
