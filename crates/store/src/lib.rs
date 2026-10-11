//! Persistence for Financer. One entity and migration set serves both SQLite (embedded
//! on the phone, or a single-file server) and PostgreSQL; the backend is chosen by URL.

pub mod entity;
pub mod migration;

use financer_core::{Category, Money, Transaction};
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveValue::Set, ConnectOptions, Database, DatabaseConnection, DbErr, EntityTrait, QueryOrder,
    TransactionTrait,
};
use sea_orm_migration::MigratorTrait;

pub use sea_orm::DatabaseBackend;

use entity::transaction as tx_entity;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Db(#[from] DbErr),
    #[error("unknown category in database: {0:?}")]
    BadCategory(String),
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
        for t in txs {
            let model = tx_entity::ActiveModel {
                fingerprint: Set(t.fingerprint()),
                booking_date: Set(t.booking_date),
                amount_cents: Set(t.amount.cents()),
                counterparty: Set(t.counterparty.clone()),
                purpose: Set(t.purpose.clone()),
                counterparty_iban: Set(t.counterparty_iban.clone()),
                category: Set(t.category.map(category_name)),
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
    pub async fn list_transactions(&self) -> Result<Vec<Transaction>, StoreError> {
        let rows = tx_entity::Entity::find()
            .order_by_desc(tx_entity::Column::BookingDate)
            .order_by_desc(tx_entity::Column::Id)
            .all(&self.db)
            .await?;
        rows.into_iter()
            .map(|r| {
                let category = match r.category {
                    Some(name) => Some(parse_category(&name)?),
                    None => None,
                };
                Ok(Transaction {
                    booking_date: r.booking_date,
                    amount: Money::from_cents(r.amount_cents),
                    counterparty: r.counterparty,
                    purpose: r.purpose,
                    counterparty_iban: r.counterparty_iban,
                    category,
                })
            })
            .collect()
    }
}

/// Stored form of a category: its serde name (`groceries`), so adding a variant to
/// `Category` needs no change here.
fn category_name(c: Category) -> String {
    match serde_json::to_value(c) {
        Ok(serde_json::Value::String(s)) => s,
        _ => unreachable!("Category always serializes to a string"),
    }
}

fn parse_category(name: &str) -> Result<Category, StoreError> {
    serde_json::from_value(serde_json::Value::String(name.to_string()))
        .map_err(|_| StoreError::BadCategory(name.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ConnectionTrait;
    use time::macros::date;

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

    async fn roundtrip(url: &str) {
        let store = Store::connect(url).await.unwrap();
        let txs = sample();
        assert_eq!(store.insert_new_transactions(&txs).await.unwrap(), 2);
        // importing the same period again must not duplicate
        assert_eq!(store.insert_new_transactions(&txs).await.unwrap(), 0);

        let listed = store.list_transactions().await.unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].counterparty, "Arbeitgeber AG"); // newest first
        assert_eq!(listed[0].category, Some(Category::Income));
        assert_eq!(listed[1], txs[0]);
    }

    #[tokio::test]
    async fn sqlite_roundtrip() {
        roundtrip("sqlite::memory:").await;
    }

    #[tokio::test]
    async fn sqlite_file_roundtrip_and_reopen() {
        let dir = std::env::temp_dir().join(format!("financer-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let url = format!("sqlite://{}?mode=rwc", dir.join("t.db").display());
        roundtrip(&url).await;
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
        store
            .db
            .execute_unprepared("DELETE FROM transactions")
            .await
            .unwrap();
        drop(store);
        roundtrip(&url).await;
    }

    #[test]
    fn category_names_roundtrip_and_match_serde() {
        for c in [
            Category::Groceries,
            Category::Subscriptions,
            Category::Other,
        ] {
            assert_eq!(parse_category(&category_name(c)).unwrap(), c);
        }
        assert_eq!(category_name(Category::Groceries), "groceries");
        assert!(parse_category("nope").is_err());
    }
}
