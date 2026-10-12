//! Storing a read receipt, once. The same purchase can arrive twice: the same mail fetched again,
//! the PDF and the HTML body of one eBon, or the Lidl Plus ticket and the mailed copy of it.

use financer_store::{NewReceipt, ReceiptMeta, Store};

use crate::config::SourceKind;
use crate::error::SyncError;
use crate::reader::ReadReceipt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stored {
    New(i64),
    Duplicate,
}

pub struct Ingest;

impl Ingest {
    /// Is `existing` the purchase `r` describes? Same retailer, day and printed total, and the
    /// same time of day. When one of them has no time, copies that came by a different route
    /// still count as the same purchase; two receipts of one source without times do not (that
    /// could be two shopping trips).
    fn same_purchase(existing: &ReceiptMeta, source: &str, r: &ReadReceipt) -> bool {
        let (Some(a), Some(b)) = (existing.retailer.as_deref(), r.retailer.as_deref()) else {
            return false;
        };
        let Some(total) = r.parsed.total else {
            return false;
        };
        a == b
            && existing.total_cents == Some(total.cents())
            && match (existing.time.as_deref(), r.time.as_deref()) {
                (Some(x), Some(y)) => x == y,
                _ => existing.source != source,
            }
    }

    pub async fn store(
        store: &Store,
        source: SourceKind,
        r: &ReadReceipt,
    ) -> Result<Stored, SyncError> {
        if let Some(date) = r.parsed.date {
            let same_day = store.receipt_metas_on(date).await?;
            if same_day
                .iter()
                .any(|m| Self::same_purchase(m, source.key(), r))
            {
                return Ok(Stored::Duplicate);
            }
        }
        let json = serde_json::to_string(&r.parsed)
            .map_err(|e| SyncError::Other(format!("cannot serialize the receipt: {e}")))?;
        let id = store
            .add_receipt_from(&NewReceipt {
                fingerprint: &r.fingerprint,
                date: r.parsed.date,
                merchant: r.parsed.merchant.as_deref(),
                json: &json,
                source: source.key(),
                retailer: r.retailer.as_deref(),
                total_cents: r.parsed.total.map(|t| t.cents()),
                time: r.time.as_deref(),
            })
            .await?;
        Ok(id.map_or(Stored::Duplicate, Stored::New))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::fixtures::{LIDL_PLUS, REWE_EBON};
    use crate::reader::{ReceiptReader, Trust};

    fn read(text: &str) -> ReadReceipt {
        ReceiptReader::read(text, None, None, Trust::Document).unwrap()
    }

    #[tokio::test]
    async fn same_receipt_is_stored_once() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let r = read(REWE_EBON);
        let first = Ingest::store(&store, SourceKind::Email, &r).await.unwrap();
        assert!(matches!(first, Stored::New(_)));
        assert_eq!(
            Ingest::store(&store, SourceKind::Email, &r).await.unwrap(),
            Stored::Duplicate
        );
        assert_eq!(store.receipt_metas().await.unwrap().len(), 1);
        let m = &store.receipt_metas().await.unwrap()[0];
        assert_eq!(
            (m.source.as_str(), m.retailer.as_deref(), m.time.as_deref(), m.total_cents),
            ("email", Some("rewe"), Some("18:42"), Some(784))
        );
    }

    #[tokio::test]
    async fn other_route_with_other_layout_is_still_the_same_purchase() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        Ingest::store(&store, SourceKind::Email, &read(REWE_EBON))
            .await
            .unwrap();
        // the same eBon from the folder, one item name spelled differently: other fingerprint,
        // same retailer, day, total and time
        let copy = read(&REWE_EBON.replace("BANANEN", "BANANE"));
        assert_ne!(copy.fingerprint, read(REWE_EBON).fingerprint);
        assert_eq!(
            Ingest::store(&store, SourceKind::Folder, &copy).await.unwrap(),
            Stored::Duplicate
        );
    }

    #[tokio::test]
    async fn different_purchases_are_kept() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        Ingest::store(&store, SourceKind::Email, &read(REWE_EBON))
            .await
            .unwrap();
        // another day, another store, another total, another time
        let other_day = read(&REWE_EBON.replace("02.03.2026", "03.03.2026"));
        let other_time = read(&REWE_EBON.replace("18:42:07", "09:10:00"));
        let lidl = read(LIDL_PLUS);
        for r in [other_day, other_time, lidl] {
            assert!(matches!(
                Ingest::store(&store, SourceKind::Email, &r).await.unwrap(),
                Stored::New(_)
            ));
        }
        assert_eq!(store.receipt_metas().await.unwrap().len(), 4);
    }

    #[tokio::test]
    async fn two_timeless_receipts_of_one_source_are_not_merged() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let a = read("REWE\nMILCH 1,09 B\nSUMME 1,09\n02.03.2026");
        let b = read("REWE\nMILCH 1,09 B\nSUMME 1,09\n02.03.2026 Bon-Nr. 2");
        assert_eq!(a.time, None);
        assert!(matches!(
            Ingest::store(&store, SourceKind::Folder, &a).await.unwrap(),
            Stored::New(_)
        ));
        // other fingerprint (different text is irrelevant: fingerprint is by content, which is
        // identical here), so force a distinct one
        let mut b = b;
        b.fingerprint = "other".into();
        assert!(matches!(
            Ingest::store(&store, SourceKind::Folder, &b).await.unwrap(),
            Stored::New(_)
        ));
        // but the same purchase from another route is a duplicate
        let mut c = a.clone();
        c.fingerprint = "third".into();
        assert_eq!(
            Ingest::store(&store, SourceKind::Email, &c).await.unwrap(),
            Stored::Duplicate
        );
    }
}
