//! Which anomaly alerts the user has dismissed. Alerts themselves are computed from the
//! transactions; only the dismissal is stored.

use std::collections::HashSet;

use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveValue::Set, EntityTrait, QueryOrder};

use crate::{Store, StoreError};

mod alert_dismissal {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "alert_dismissals")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub alert_id: String,
        /// Unix seconds.
        pub dismissed_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// A stored dismissal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlertDismissal {
    pub alert_id: String,
    /// Unix seconds.
    pub dismissed_at: i64,
}

impl Store {
    /// Remember that the user dismissed `alert_id`. Dismissing twice keeps the first time.
    pub async fn dismiss_alert(&self, alert_id: &str, at: i64) -> Result<(), StoreError> {
        alert_dismissal::Entity::insert(alert_dismissal::ActiveModel {
            alert_id: Set(alert_id.to_string()),
            dismissed_at: Set(at),
        })
        .on_conflict(
            OnConflict::column(alert_dismissal::Column::AlertId)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&self.db)
        .await?;
        Ok(())
    }

    pub async fn dismissed_alert_ids(&self) -> Result<HashSet<String>, StoreError> {
        Ok(alert_dismissal::Entity::find()
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| r.alert_id)
            .collect())
    }

    /// All dismissals, oldest first (for backup).
    pub async fn list_alert_dismissals(&self) -> Result<Vec<AlertDismissal>, StoreError> {
        Ok(alert_dismissal::Entity::find()
            .order_by_asc(alert_dismissal::Column::DismissedAt)
            .order_by_asc(alert_dismissal::Column::AlertId)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| AlertDismissal {
                alert_id: r.alert_id,
                dismissed_at: r.dismissed_at,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn dismissals_are_stored_once_and_listed() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        assert!(store.dismissed_alert_ids().await.unwrap().is_empty());
        store
            .dismiss_alert("dup-0000000000000001", 100)
            .await
            .unwrap();
        store
            .dismiss_alert("amt-0000000000000002", 200)
            .await
            .unwrap();
        // dismissing again is harmless and keeps the first time
        store
            .dismiss_alert("dup-0000000000000001", 999)
            .await
            .unwrap();
        let ids = store.dismissed_alert_ids().await.unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains("dup-0000000000000001"));
        let all = store.list_alert_dismissals().await.unwrap();
        assert_eq!(
            all,
            vec![
                AlertDismissal {
                    alert_id: "dup-0000000000000001".into(),
                    dismissed_at: 100
                },
                AlertDismissal {
                    alert_id: "amt-0000000000000002".into(),
                    dismissed_at: 200
                },
            ]
        );
    }
}
