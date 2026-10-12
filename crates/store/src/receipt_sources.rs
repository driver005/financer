//! Storage for the automatic receipt sources (mailbox, Lidl Plus, watched folder): where a
//! receipt came from, which bank transaction it belongs to, each source's cursor and secret,
//! and which mails and files were already looked at.

use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
};

use crate::entity::receipt;
use crate::{Store, StoreError};

mod source_state {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "receipt_source_state")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub source: String,
        pub state: String,
        pub secret: Option<String>,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod seen {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "receipt_seen")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub source: String,
        pub item_key: String,
        pub outcome: String,
        pub seen_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// A receipt to store, with where it came from.
#[derive(Debug, Clone, Copy)]
pub struct NewReceipt<'a> {
    pub fingerprint: &'a str,
    pub date: Option<time::Date>,
    pub merchant: Option<&'a str>,
    pub json: &'a str,
    /// `manual`, `email`, `lidl_plus` or `folder`.
    pub source: &'a str,
    pub retailer: Option<&'a str>,
    pub total_cents: Option<i64>,
    /// `HH:MM` as printed.
    pub time: Option<&'a str>,
}

/// The columns of a stored receipt that identify it, without the parsed JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptMeta {
    pub id: i64,
    pub source: String,
    pub retailer: Option<String>,
    pub date: Option<time::Date>,
    pub time: Option<String>,
    pub total_cents: Option<i64>,
    pub transaction_id: Option<i64>,
}

impl From<receipt::Model> for ReceiptMeta {
    fn from(r: receipt::Model) -> Self {
        ReceiptMeta {
            id: r.id,
            source: r.source,
            retailer: r.retailer,
            date: r.receipt_date,
            time: r.receipt_time,
            total_cents: r.total_cents,
            transaction_id: r.transaction_id,
        }
    }
}

/// A source's saved cursor/status text and its (already encrypted) secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceState {
    pub state: String,
    pub secret: Option<String>,
    pub updated_at: i64,
}

fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

impl Store {
    /// Store a receipt with its provenance. Returns `None` when the same receipt (by
    /// fingerprint) is already stored.
    pub async fn add_receipt_from(&self, new: &NewReceipt<'_>) -> Result<Option<i64>, StoreError> {
        let res = receipt::Entity::insert(receipt::ActiveModel {
            fingerprint: Set(new.fingerprint.to_string()),
            receipt_date: Set(new.date),
            merchant: Set(new.merchant.map(str::to_string)),
            json: Set(new.json.to_string()),
            source: Set(new.source.to_string()),
            retailer: Set(new.retailer.map(str::to_string)),
            total_cents: Set(new.total_cents),
            receipt_time: Set(new.time.map(str::to_string)),
            transaction_id: Set(None),
            created_at: Set(now()),
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
            .filter(receipt::Column::Fingerprint.eq(new.fingerprint))
            .one(&self.db)
            .await?;
        Ok(row.map(|r| r.id))
    }

    /// Provenance and link of every receipt, newest first.
    pub async fn receipt_metas(&self) -> Result<Vec<ReceiptMeta>, StoreError> {
        Ok(receipt::Entity::find()
            .order_by_desc(receipt::Column::ReceiptDate)
            .order_by_desc(receipt::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(ReceiptMeta::from)
            .collect())
    }

    /// Receipts dated `date` (any source), to spot the same purchase arriving twice by two routes.
    pub async fn receipt_metas_on(&self, date: time::Date) -> Result<Vec<ReceiptMeta>, StoreError> {
        Ok(receipt::Entity::find()
            .filter(receipt::Column::ReceiptDate.eq(date))
            .order_by_asc(receipt::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(ReceiptMeta::from)
            .collect())
    }

    /// Link a receipt to a bank transaction, or clear the link with `None`.
    pub async fn set_receipt_transaction(
        &self,
        receipt_id: i64,
        transaction_id: Option<i64>,
    ) -> Result<(), StoreError> {
        receipt::Entity::update_many()
            .col_expr(
                receipt::Column::TransactionId,
                sea_orm::sea_query::Expr::value(transaction_id),
            )
            .filter(receipt::Column::Id.eq(receipt_id))
            .exec(&self.db)
            .await?;
        Ok(())
    }

    pub async fn count_receipts_from(&self, source: &str) -> Result<u64, StoreError> {
        Ok(receipt::Entity::find()
            .filter(receipt::Column::Source.eq(source))
            .count(&self.db)
            .await?)
    }

    pub async fn source_state(&self, source: &str) -> Result<Option<SourceState>, StoreError> {
        Ok(source_state::Entity::find_by_id(source.to_string())
            .one(&self.db)
            .await?
            .map(|r| SourceState {
                state: r.state,
                secret: r.secret,
                updated_at: r.updated_at,
            }))
    }

    /// Save a source's cursor/status text. An existing secret is kept.
    pub async fn put_source_state(&self, source: &str, state: &str) -> Result<(), StoreError> {
        source_state::Entity::insert(source_state::ActiveModel {
            source: Set(source.to_string()),
            state: Set(state.to_string()),
            secret: Set(None),
            updated_at: Set(now()),
        })
        .on_conflict(
            OnConflict::column(source_state::Column::Source)
                .update_columns([source_state::Column::State, source_state::Column::UpdatedAt])
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }

    /// Save (or clear, with `None`) a source's encrypted secret. The state text is kept.
    pub async fn put_source_secret(
        &self,
        source: &str,
        secret: Option<&str>,
    ) -> Result<(), StoreError> {
        source_state::Entity::insert(source_state::ActiveModel {
            source: Set(source.to_string()),
            state: Set("{}".to_string()),
            secret: Set(secret.map(str::to_string)),
            updated_at: Set(now()),
        })
        .on_conflict(
            OnConflict::column(source_state::Column::Source)
                .update_columns([source_state::Column::Secret, source_state::Column::UpdatedAt])
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }

    /// Forget a source's cursor, status and secret, and what it had seen.
    pub async fn delete_source_state(&self, source: &str) -> Result<(), StoreError> {
        source_state::Entity::delete_by_id(source.to_string())
            .exec(&self.db)
            .await?;
        seen::Entity::delete_many()
            .filter(seen::Column::Source.eq(source))
            .exec(&self.db)
            .await?;
        Ok(())
    }

    /// Record that `key` (a mail uid, a file hash) was looked at. Returns `false` when it had
    /// been recorded before; the first outcome is kept.
    pub async fn mark_seen(
        &self,
        source: &str,
        key: &str,
        outcome: &str,
    ) -> Result<bool, StoreError> {
        let n = seen::Entity::insert(seen::ActiveModel {
            source: Set(source.to_string()),
            item_key: Set(key.to_string()),
            outcome: Set(outcome.to_string()),
            seen_at: Set(now()),
            ..Default::default()
        })
        .on_conflict(
            OnConflict::columns([seen::Column::Source, seen::Column::ItemKey])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(n > 0)
    }

    /// The outcome recorded for `key`, if it was seen.
    pub async fn seen_outcome(
        &self,
        source: &str,
        key: &str,
    ) -> Result<Option<String>, StoreError> {
        Ok(seen::Entity::find()
            .filter(seen::Column::Source.eq(source))
            .filter(seen::Column::ItemKey.eq(key))
            .one(&self.db)
            .await?
            .map(|r| r.outcome))
    }

    /// Forget one seen key (to retry it).
    pub async fn forget_seen(&self, source: &str, key: &str) -> Result<(), StoreError> {
        seen::Entity::delete_many()
            .filter(seen::Column::Source.eq(source))
            .filter(seen::Column::ItemKey.eq(key))
            .exec(&self.db)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn new<'a>(fp: &'a str, source: &'a str) -> NewReceipt<'a> {
        NewReceipt {
            fingerprint: fp,
            date: Some(date!(2026 - 03 - 02)),
            merchant: Some("REWE"),
            json: "{}",
            source,
            retailer: Some("rewe"),
            total_cents: Some(784),
            time: Some("18:42"),
        }
    }

    #[tokio::test]
    async fn receipts_keep_their_provenance_and_link() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let id = store
            .add_receipt_from(&new("a", "email"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            store.add_receipt_from(&new("a", "folder")).await.unwrap(),
            None
        );
        // the old entry point is a manual receipt
        store
            .add_receipt("b", Some(date!(2026 - 03 - 03)), None, "{}")
            .await
            .unwrap();

        let metas = store.receipt_metas().await.unwrap();
        assert_eq!(metas.len(), 2);
        let m = metas.iter().find(|m| m.id == id).unwrap();
        assert_eq!(
            (
                m.source.as_str(),
                m.retailer.as_deref(),
                m.total_cents,
                m.time.as_deref()
            ),
            ("email", Some("rewe"), Some(784), Some("18:42"))
        );
        assert_eq!(metas.iter().filter(|m| m.source == "manual").count(), 1);
        assert_eq!(
            store
                .receipt_metas_on(date!(2026 - 03 - 02))
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(store.count_receipts_from("email").await.unwrap(), 1);

        assert_eq!(m.transaction_id, None);
        store.set_receipt_transaction(id, Some(42)).await.unwrap();
        let linked = store.receipt_metas().await.unwrap();
        assert_eq!(
            linked.iter().find(|m| m.id == id).unwrap().transaction_id,
            Some(42)
        );
        store.set_receipt_transaction(id, None).await.unwrap();
        assert!(store
            .receipt_metas()
            .await
            .unwrap()
            .iter()
            .all(|m| m.transaction_id.is_none()));
    }

    #[tokio::test]
    async fn state_secret_and_seen_are_independent() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        assert_eq!(store.source_state("email").await.unwrap(), None);
        store
            .put_source_state("email", "{\"last_uid\":7}")
            .await
            .unwrap();
        store
            .put_source_secret("email", Some("sealed"))
            .await
            .unwrap();
        // writing the state again keeps the secret, and the other way round
        store
            .put_source_state("email", "{\"last_uid\":9}")
            .await
            .unwrap();
        let s = store.source_state("email").await.unwrap().unwrap();
        assert_eq!(
            (s.state.as_str(), s.secret.as_deref()),
            ("{\"last_uid\":9}", Some("sealed"))
        );
        store.put_source_secret("email", None).await.unwrap();
        let s = store.source_state("email").await.unwrap().unwrap();
        assert_eq!((s.state.as_str(), s.secret), ("{\"last_uid\":9}", None));

        assert!(store.mark_seen("folder", "h1", "imported").await.unwrap());
        assert!(!store.mark_seen("folder", "h1", "failed").await.unwrap());
        assert_eq!(
            store.seen_outcome("folder", "h1").await.unwrap().as_deref(),
            Some("imported")
        );
        assert!(store.mark_seen("email", "h1", "imported").await.unwrap());
        store.forget_seen("folder", "h1").await.unwrap();
        assert_eq!(store.seen_outcome("folder", "h1").await.unwrap(), None);

        store.delete_source_state("email").await.unwrap();
        assert_eq!(store.source_state("email").await.unwrap(), None);
        assert_eq!(store.seen_outcome("email", "h1").await.unwrap(), None);
    }
}
