//! Persistence for Financer. One entity and migration set serves both SQLite (embedded
//! on the phone, or a single-file server) and PostgreSQL; the backend is chosen by URL.

pub mod entity;
pub mod migration;

use financer_core::{BasketItem, Budget, Category, Chain, Money, PriceQuote, Transaction};
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectOptions, Database, DatabaseConnection, DbErr,
    EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
};
use sea_orm_migration::MigratorTrait;

pub use sea_orm::DatabaseBackend;

use entity::{
    budget_envelope, price_quote, receipt, setting, transaction as tx_entity, usual_item,
};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Db(#[from] DbErr),
    #[error("unknown category in database: {0:?}")]
    BadCategory(String),
}

/// A price quote as stored, with the detail the UI shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredQuote {
    pub quote: PriceQuote,
    pub product_name: String,
    pub shelf_price: Money,
    pub source: String,
    /// Unix seconds.
    pub fetched_at: i64,
}

/// A scanned receipt as stored. `json` is the parsed receipt; the API layer owns its shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredReceipt {
    pub id: i64,
    /// Identity of the receipt text, so the same receipt is never stored twice.
    pub fingerprint: String,
    pub date: Option<time::Date>,
    pub merchant: Option<String>,
    pub json: String,
}

/// A transaction as stored, with its database id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredTransaction {
    pub id: i64,
    pub transaction: Transaction,
}

#[derive(Clone)]
pub struct Store {
    db: DatabaseConnection,
}

impl Store {
    /// Connect to `sqlite://path?mode=rwc`, `sqlite::memory:` or `postgres://...` and run
    /// all pending migrations.
    pub async fn connect(url: &str) -> Result<Store, StoreError> {
        let mut opts = ConnectOptions::new(url.to_string());
        opts.sqlx_logging(false);
        if url.contains(":memory:") {
            // every pooled connection would otherwise get its own empty in-memory database
            opts.max_connections(1).min_connections(1);
        }
        let db = Database::connect(opts).await?;
        migration::Migrator::up(&db, None).await?;
        Ok(Store { db })
    }

    pub fn backend(&self) -> DatabaseBackend {
        self.db.get_database_backend()
    }

    /// Insert transactions that are not stored yet (matched by fingerprint). Returns how many
    /// were new.
    pub async fn insert_new_transactions(&self, txs: &[Transaction]) -> Result<usize, StoreError> {
        let txn = self.db.begin().await?;
        let mut inserted = 0usize;
        // Identical rows within one batch (two coffees, same shop, same day) are distinct
        // purchases: number them so only a re-import of the same file is treated as duplicate.
        let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for t in txs {
            let base = t.fingerprint();
            let n = seen.entry(base.clone()).or_insert(0);
            let fingerprint = if *n == 0 { base } else { format!("{base}#{n}") };
            *n += 1;
            let model = tx_entity::ActiveModel {
                fingerprint: Set(fingerprint),
                booking_date: Set(t.booking_date),
                amount_cents: Set(t.amount.cents()),
                counterparty: Set(t.counterparty.clone()),
                purpose: Set(t.purpose.clone()),
                counterparty_iban: Set(t.counterparty_iban.clone()),
                category: Set(t.category.map(EnumName::category_name)),
                ..Default::default()
            };
            let affected = tx_entity::Entity::insert(model)
                .on_conflict(
                    OnConflict::column(tx_entity::Column::Fingerprint)
                        .do_nothing()
                        .to_owned(),
                )
                .exec_without_returning(&txn)
                .await?;
            inserted += affected as usize;
        }
        txn.commit().await?;
        Ok(inserted)
    }

    /// All transactions, newest first.
    pub async fn list_transactions(&self) -> Result<Vec<StoredTransaction>, StoreError> {
        let rows = tx_entity::Entity::find()
            .order_by_desc(tx_entity::Column::BookingDate)
            .order_by_desc(tx_entity::Column::Id)
            .all(&self.db)
            .await?;
        rows.into_iter()
            .map(|r| {
                let category = match r.category {
                    Some(name) => Some(EnumName::parse_category(&name)?),
                    None => None,
                };
                Ok(StoredTransaction {
                    id: r.id,
                    transaction: Transaction {
                        booking_date: r.booking_date,
                        amount: Money::from_cents(r.amount_cents),
                        counterparty: r.counterparty,
                        purpose: r.purpose,
                        counterparty_iban: r.counterparty_iban,
                        category,
                    },
                })
            })
            .collect()
    }

    /// Replace the whole budget with `budget`.
    pub async fn save_budget(&self, budget: &Budget) -> Result<(), StoreError> {
        let txn = self.db.begin().await?;
        budget_envelope::Entity::delete_many().exec(&txn).await?;
        for (category, limit) in &budget.envelopes {
            budget_envelope::Entity::insert(budget_envelope::ActiveModel {
                category: Set(EnumName::category_name(*category)),
                limit_cents: Set(limit.cents()),
            })
            .exec_without_returning(&txn)
            .await?;
        }
        txn.commit().await?;
        Ok(())
    }

    pub async fn load_budget(&self) -> Result<Budget, StoreError> {
        let mut budget = Budget::default();
        for row in budget_envelope::Entity::find().all(&self.db).await? {
            budget.envelopes.insert(
                EnumName::parse_category(&row.category)?,
                Money::from_cents(row.limit_cents),
            );
        }
        Ok(budget)
    }

    /// Replace the stored quotes of every source in `refreshed_sources` with `quotes`. Sources
    /// that failed to refresh keep their old quotes instead of being wiped.
    pub async fn replace_quotes(
        &self,
        refreshed_sources: &[String],
        quotes: &[StoredQuote],
    ) -> Result<(), StoreError> {
        let txn = self.db.begin().await?;
        if !refreshed_sources.is_empty() {
            price_quote::Entity::delete_many()
                .filter(price_quote::Column::Source.is_in(refreshed_sources.iter().cloned()))
                .exec(&txn)
                .await?;
        }
        for q in quotes {
            price_quote::Entity::insert(price_quote::ActiveModel {
                item: Set(q.quote.item.clone()),
                chain: Set(EnumName::to_name(&q.quote.chain)),
                price_cents: Set(q.quote.price.cents()),
                shelf_price_cents: Set(q.shelf_price.cents()),
                product_name: Set(q.product_name.clone()),
                valid_until: Set(q.quote.valid_until),
                is_offer: Set(q.quote.is_offer),
                source: Set(q.source.clone()),
                fetched_at: Set(q.fetched_at),
                ..Default::default()
            })
            .exec_without_returning(&txn)
            .await?;
        }
        txn.commit().await?;
        Ok(())
    }

    pub async fn list_quotes(&self) -> Result<Vec<StoredQuote>, StoreError> {
        price_quote::Entity::find()
            .order_by_asc(price_quote::Column::Item)
            .order_by_asc(price_quote::Column::PriceCents)
            .order_by_asc(price_quote::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| {
                Ok(StoredQuote {
                    quote: PriceQuote {
                        item: r.item,
                        chain: EnumName::from_name::<Chain>(&r.chain)?,
                        price: Money::from_cents(r.price_cents),
                        valid_until: r.valid_until,
                        is_offer: r.is_offer,
                    },
                    product_name: r.product_name,
                    shelf_price: Money::from_cents(r.shelf_price_cents),
                    source: r.source,
                    fetched_at: r.fetched_at,
                })
            })
            .collect()
    }

    /// Replace the hand-maintained list of items you usually buy.
    pub async fn set_usual_items(&self, items: &[BasketItem]) -> Result<(), StoreError> {
        let txn = self.db.begin().await?;
        usual_item::Entity::delete_many().exec(&txn).await?;
        for it in items {
            usual_item::Entity::insert(usual_item::ActiveModel {
                item: Set(it.item.clone()),
                quantity: Set(it.quantity as i32),
            })
            .exec_without_returning(&txn)
            .await?;
        }
        txn.commit().await?;
        Ok(())
    }

    pub async fn usual_items(&self) -> Result<Vec<BasketItem>, StoreError> {
        Ok(usual_item::Entity::find()
            .order_by_asc(usual_item::Column::Item)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| BasketItem {
                item: r.item,
                quantity: r.quantity.max(1) as u32,
            })
            .collect())
    }

    /// Store a parsed receipt. Returns `None` when the same receipt is already stored.
    pub async fn add_receipt(
        &self,
        fingerprint: &str,
        date: Option<time::Date>,
        merchant: Option<&str>,
        json: &str,
    ) -> Result<Option<i64>, StoreError> {
        let res = receipt::Entity::insert(receipt::ActiveModel {
            fingerprint: Set(fingerprint.to_string()),
            receipt_date: Set(date),
            merchant: Set(merchant.map(str::to_string)),
            json: Set(json.to_string()),
            ..Default::default()
        })
        .on_conflict(
            OnConflict::column(receipt::Column::Fingerprint)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        if res == 0 {
            return Ok(None);
        }
        let row = receipt::Entity::find()
            .filter(receipt::Column::Fingerprint.eq(fingerprint))
            .one(&self.db)
            .await?;
        Ok(row.map(|r| r.id))
    }

    /// Newest receipts first.
    pub async fn list_receipts(&self) -> Result<Vec<StoredReceipt>, StoreError> {
        Ok(receipt::Entity::find()
            .order_by_desc(receipt::Column::ReceiptDate)
            .order_by_desc(receipt::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| StoredReceipt {
                id: r.id,
                fingerprint: r.fingerprint,
                date: r.receipt_date,
                merchant: r.merchant,
                json: r.json,
            })
            .collect())
    }

    pub async fn delete_receipt(&self, id: i64) -> Result<bool, StoreError> {
        Ok(receipt::Entity::delete_by_id(id)
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(setting::Entity::find_by_id(key.to_string())
            .one(&self.db)
            .await?
            .map(|r| r.value))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), StoreError> {
        setting::Entity::insert(setting::ActiveModel {
            key: Set(key.to_string()),
            value: Set(value.to_string()),
        })
        .on_conflict(
            OnConflict::column(setting::Column::Key)
                .update_column(setting::Column::Value)
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }
}

/// Conversion between enum values and the names they are stored under.
struct EnumName;

impl EnumName {
    /// Stored form of an enum value: its serde name (`groceries`, `rewe`), so adding a variant
    /// needs no change here.
    fn to_name<T: serde::Serialize>(v: &T) -> String {
        match serde_json::to_value(v) {
            Ok(serde_json::Value::String(s)) => s,
            _ => unreachable!("enums stored by name always serialize to a string"),
        }
    }

    fn from_name<T: serde::de::DeserializeOwned>(name: &str) -> Result<T, StoreError> {
        serde_json::from_value(serde_json::Value::String(name.to_string()))
            .map_err(|_| StoreError::BadCategory(name.to_string()))
    }

    fn category_name(c: Category) -> String {
        Self::to_name(&c)
    }

    fn parse_category(name: &str) -> Result<Category, StoreError> {
        Self::from_name(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ConnectionTrait;
    use time::macros::date;

    /// Shared test data and round-trip checks.
    struct Fixtures;

    impl Fixtures {
        fn sample() -> Vec<Transaction> {
            vec![
                Transaction {
                    booking_date: date!(2026 - 03 - 02),
                    amount: Money::from_cents(-2347),
                    counterparty: "REWE SAGT DANKE".into(),
                    purpose: "Kartenzahlung".into(),
                    counterparty_iban: None,
                    category: Some(Category::Groceries),
                },
                Transaction {
                    booking_date: date!(2026 - 03 - 28),
                    amount: Money::from_cents(250_000),
                    counterparty: "Arbeitgeber AG".into(),
                    purpose: "Gehalt 03/2026".into(),
                    counterparty_iban: Some("DE02120300000000202051".into()),
                    category: Some(Category::Income),
                },
            ]
        }

        async fn more_roundtrips(store: &Store) {
            // quotes: refreshing a source replaces only that source's rows
            let quote = |item: &str, chain, cents, source: &str| StoredQuote {
                quote: PriceQuote {
                    item: item.into(),
                    chain,
                    price: Money::from_cents(cents),
                    valid_until: Some(date!(2026 - 03 - 08)),
                    is_offer: true,
                },
                product_name: "Produkt".into(),
                shelf_price: Money::from_cents(cents + 10),
                source: source.into(),
                fetched_at: 1_800_000_000,
            };
            store
                .replace_quotes(
                    &["a".into(), "b".into()],
                    &[
                        quote("milch", Chain::Aldi, 99, "a"),
                        quote("milch", Chain::Rewe, 119, "b"),
                    ],
                )
                .await
                .unwrap();
            store
                .replace_quotes(&["a".into()], &[quote("milch", Chain::Aldi, 89, "a")])
                .await
                .unwrap();
            let quotes = store.list_quotes().await.unwrap();
            assert_eq!(quotes.len(), 2);
            assert_eq!(
                (quotes[0].quote.chain, quotes[0].quote.price),
                (Chain::Aldi, Money::from_cents(89))
            ); // cheapest first
            assert_eq!(quotes[1].quote.chain, Chain::Rewe); // untouched source kept
            assert_eq!(quotes[0].quote.valid_until, Some(date!(2026 - 03 - 08)));
            assert!(quotes[0].quote.is_offer);
            // a failed refresh (no sources reported OK) wipes nothing
            store.replace_quotes(&[], &[]).await.unwrap();
            assert_eq!(store.list_quotes().await.unwrap().len(), 2);

            // usual items
            store
                .set_usual_items(&[
                    BasketItem {
                        item: "milch".into(),
                        quantity: 2,
                    },
                    BasketItem {
                        item: "brot".into(),
                        quantity: 1,
                    },
                ])
                .await
                .unwrap();
            store
                .set_usual_items(&[BasketItem {
                    item: "milch".into(),
                    quantity: 3,
                }])
                .await
                .unwrap();
            assert_eq!(
                store.usual_items().await.unwrap(),
                vec![BasketItem {
                    item: "milch".into(),
                    quantity: 3
                }]
            );

            // receipts dedupe by fingerprint
            let id = store
                .add_receipt(
                    "fp1",
                    Some(date!(2026 - 03 - 02)),
                    Some("REWE"),
                    "{\"x\":1}",
                )
                .await
                .unwrap();
            assert!(id.is_some());
            assert_eq!(
                store.add_receipt("fp1", None, None, "{}").await.unwrap(),
                None
            );
            let receipts = store.list_receipts().await.unwrap();
            assert_eq!(
                (
                    receipts.len(),
                    receipts[0].merchant.as_deref(),
                    receipts[0].json.as_str()
                ),
                (1, Some("REWE"), "{\"x\":1}")
            );
            assert!(store.delete_receipt(id.unwrap()).await.unwrap());
            assert!(!store.delete_receipt(id.unwrap()).await.unwrap());

            // settings upsert
            assert_eq!(store.get_setting("habit_mode").await.unwrap(), None);
            store.set_setting("habit_mode", "manual").await.unwrap();
            store.set_setting("habit_mode", "receipts").await.unwrap();
            assert_eq!(
                store.get_setting("habit_mode").await.unwrap().as_deref(),
                Some("receipts")
            );
        }

        async fn roundtrip(url: &str) {
            let store = Store::connect(url).await.unwrap();
            let txs = Self::sample();
            assert_eq!(store.insert_new_transactions(&txs).await.unwrap(), 2);
            // importing the same period again must not duplicate
            assert_eq!(store.insert_new_transactions(&txs).await.unwrap(), 0);

            let listed = store.list_transactions().await.unwrap();
            assert_eq!(listed.len(), 2);
            assert_eq!(listed[0].transaction.counterparty, "Arbeitgeber AG"); // newest first
            assert_eq!(listed[0].transaction.category, Some(Category::Income));
            assert_eq!(listed[1].transaction, txs[0]);

            let mut budget = Budget::default();
            budget
                .envelopes
                .insert(Category::Groceries, Money::from_cents(40_000));
            store.save_budget(&budget).await.unwrap();
            budget
                .envelopes
                .insert(Category::Dining, Money::from_cents(6_000));
            store.save_budget(&budget).await.unwrap();
            let loaded = store.load_budget().await.unwrap();
            assert_eq!(loaded.envelopes, budget.envelopes);

            Self::more_roundtrips(&store).await;
        }
    }

    #[tokio::test]
    async fn identical_purchases_in_one_batch_are_kept_but_reimport_is_not_doubled() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let coffee = Transaction {
            booking_date: date!(2026 - 03 - 02),
            amount: Money::from_cents(-350),
            counterparty: "Café Müller".into(),
            purpose: "Kartenzahlung".into(),
            counterparty_iban: None,
            category: None,
        };
        let batch = vec![coffee.clone(), coffee.clone()];
        assert_eq!(store.insert_new_transactions(&batch).await.unwrap(), 2);
        assert_eq!(store.insert_new_transactions(&batch).await.unwrap(), 0);
        assert_eq!(store.list_transactions().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn sqlite_roundtrip() {
        Fixtures::roundtrip("sqlite::memory:").await;
    }

    #[tokio::test]
    async fn sqlite_file_roundtrip_and_reopen() {
        let dir = std::env::temp_dir().join(format!("financer-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let url = format!("sqlite://{}?mode=rwc", dir.join("t.db").display());
        Fixtures::roundtrip(&url).await;
        // reopening runs migrations again without error and keeps data
        let store = Store::connect(&url).await.unwrap();
        assert_eq!(store.list_transactions().await.unwrap().len(), 2);
        std::fs::remove_dir_all(dir).ok();
    }

    /// Runs against PostgreSQL when `FINANCER_TEST_POSTGRES_URL` is set (CI sets it).
    #[tokio::test]
    async fn postgres_roundtrip() {
        let Ok(url) = std::env::var("FINANCER_TEST_POSTGRES_URL") else {
            eprintln!("skipping: FINANCER_TEST_POSTGRES_URL not set");
            return;
        };
        let store = Store::connect(&url).await.unwrap();
        // start from empty tables so the test can be run again against the same database
        for table in [
            "transactions",
            "budget_envelopes",
            "price_quotes",
            "usual_items",
            "receipts",
            "settings",
        ] {
            store
                .db
                .execute_unprepared(&format!("DELETE FROM {table}"))
                .await
                .unwrap();
        }
        drop(store);
        Fixtures::roundtrip(&url).await;
    }

    #[test]
    fn category_names_roundtrip_and_match_serde() {
        for c in [
            Category::Groceries,
            Category::Subscriptions,
            Category::Other,
        ] {
            assert_eq!(
                EnumName::parse_category(&EnumName::category_name(c)).unwrap(),
                c
            );
        }
        assert_eq!(EnumName::category_name(Category::Groceries), "groceries");
        assert!(EnumName::parse_category("nope").is_err());
    }
}
