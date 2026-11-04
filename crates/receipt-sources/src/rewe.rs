//! REWE receipts that the app fetched itself. Unlike the other sources nothing here talks to a
//! shop: the app signs in on REWE's own web shop inside its browser window, reads the receipts of
//! your account from there (the page's own session does the authentication, so no cookie or
//! password ever leaves that window) and pushes them to the server, which stores them once.
//!
//! The shape of what REWE's web shop returns (`receiptId`, `receiptTimestamp`,
//! `receiptTotalPrice`, and per article `productName`, `quantity`, `totalPrice`, all prices in
//! cents) is the one the open-source project `grocy-rewe-connect` uses; it is not an official
//! interface and was not checked against a live account. The app turns it into [`ImportReceipt`]s;
//! this module only validates, converts and stores them.

use financer_core::{Catalog, Chain, Money};
use financer_receipts::{ParsedReceipt, ReceiptItem};
use financer_store::Store;
use serde::{Deserialize, Serialize};
use time::Date;

use crate::config::SourceKind;
use crate::error::SyncError;
use crate::ingest::{Ingest, Stored};
use crate::reader::{ReadError, ReadReceipt, ReceiptReader};
use crate::summary::RunSummary;

const SOURCE: &str = "rewe_app";
/// Receipts one call may carry.
pub const MAX_RECEIPTS: usize = 100;
/// Lines one receipt may have.
pub const MAX_LINES: usize = 500;

/// One line of a receipt: what was bought and what it cost (negative for a refund).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportLine {
    pub name: String,
    pub quantity: u32,
    pub total: Money,
}

/// A receipt as the app sends it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportReceipt {
    /// REWE's id of the receipt; a receipt is stored once per id.
    pub id: String,
    pub date: Date,
    /// `HH:MM` local time.
    pub time: Option<String>,
    pub store: Option<String>,
    pub total: Option<Money>,
    pub lines: Vec<ImportLine>,
}

impl ImportReceipt {
    pub fn to_receipt(&self) -> Result<ReadReceipt, ReadError> {
        if self.lines.is_empty() {
            return Err(ReadError::NoItems);
        }
        let items: Vec<ReceiptItem> = self
            .lines
            .iter()
            .map(|l| ReceiptItem {
                item: Catalog::match_product(&l.name).map(|c| c.key.to_string()),
                text: l.name.clone(),
                quantity: l.quantity,
                line_total: l.total,
            })
            .collect();
        let sum: Money = items.iter().map(|i| i.line_total).sum();
        let total = self.total.or(Some(sum));
        let merchant = match &self.store {
            Some(s) if s.to_lowercase().contains("rewe") => s.clone(),
            Some(s) => format!("REWE {s}"),
            None => "REWE".to_string(),
        };
        let parsed = ParsedReceipt {
            merchant: Some(merchant),
            chain: Some(Chain::Rewe),
            date: Some(self.date),
            reconciles: total == Some(sum),
            total,
            items,
        };
        let fingerprint = ReceiptReader::fingerprint(&parsed, Some("rewe"), self.time.as_deref());
        Ok(ReadReceipt {
            parsed,
            retailer: Some("rewe".into()),
            time: self.time.clone(),
            fingerprint,
        })
    }
}

/// What the app has pushed so far.
#[derive(Debug, Default, Serialize, Deserialize)]
struct ReweState {
    last_import: Option<i64>,
}

/// The ids of `ids` that were not stored before (the app fetches only those).
pub async fn unknown_ids(store: &Store, ids: &[String]) -> Result<Vec<String>, SyncError> {
    let mut out = Vec::new();
    for id in ids {
        if store.seen_outcome(SOURCE, id).await?.is_none() {
            out.push(id.clone());
        }
    }
    Ok(out)
}

/// Store the receipts once each. A receipt that cannot be read is noted and not tried again.
pub async fn import(store: &Store, receipts: &[ImportReceipt]) -> Result<RunSummary, SyncError> {
    let mut summary = RunSummary::default();
    for r in receipts {
        if store.seen_outcome(SOURCE, &r.id).await?.is_some() {
            summary.duplicates += 1;
            continue;
        }
        let outcome = match r.to_receipt() {
            Ok(read) => match Ingest::store(store, SourceKind::ReweApp, &read).await? {
                Stored::New(_) => {
                    summary.imported += 1;
                    "imported"
                }
                Stored::Duplicate => {
                    summary.duplicates += 1;
                    "duplicate"
                }
            },
            Err(why) => {
                summary.skipped += 1;
                summary.note(format!("a receipt has no readable items ({why})"));
                "unreadable"
            }
        };
        store.mark_seen(SOURCE, &r.id, outcome).await?;
    }
    let state = ReweState {
        last_import: Some(time::OffsetDateTime::now_utc().unix_timestamp()),
    };
    store
        .put_source_state(
            SOURCE,
            &serde_json::to_string(&state).unwrap_or_else(|_| "{}".into()),
        )
        .await?;
    Ok(summary)
}

/// Unix seconds of the last push, and how many receipts came this way.
pub async fn status(store: &Store) -> Result<(Option<i64>, u64), SyncError> {
    let last = store
        .source_state(SOURCE)
        .await?
        .and_then(|s| serde_json::from_str::<ReweState>(&s.state).ok())
        .and_then(|s| s.last_import);
    Ok((last, store.count_receipts_from(SOURCE).await?))
}

/// Forget what was remembered about the pushes (the receipts stay).
pub async fn forget(store: &Store) -> Result<(), SyncError> {
    store.delete_source_state(SOURCE).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn receipt(id: &str, total: i64, lines: &[(&str, u32, i64)]) -> ImportReceipt {
        ImportReceipt {
            id: id.into(),
            date: date!(2026 - 03 - 02),
            time: Some("17:05".into()),
            store: Some("Köln-Ehrenfeld".into()),
            total: Some(Money::from_cents(total)),
            lines: lines
                .iter()
                .map(|(n, q, t)| ImportLine {
                    name: (*n).into(),
                    quantity: *q,
                    total: Money::from_cents(*t),
                })
                .collect(),
        }
    }

    #[test]
    fn a_receipt_becomes_a_reconciling_rewe_receipt() {
        let r = receipt(
            "r1",
            367,
            &[("Vollmilch 3,5%", 2, 218), ("Bio Bananen", 1, 149)],
        )
        .to_receipt()
        .unwrap();
        assert_eq!(r.retailer.as_deref(), Some("rewe"));
        assert_eq!(r.parsed.chain, Some(Chain::Rewe));
        assert_eq!(r.parsed.merchant.as_deref(), Some("REWE Köln-Ehrenfeld"));
        assert!(r.parsed.reconciles);
        assert_eq!(r.time.as_deref(), Some("17:05"));
    }

    #[test]
    fn a_total_that_differs_from_the_lines_is_flagged_and_no_lines_cannot_be_read() {
        let r = receipt("r2", 500, &[("Butter", 1, 299)])
            .to_receipt()
            .unwrap();
        assert!(!r.parsed.reconciles);
        assert!(receipt("r3", 100, &[]).to_receipt().is_err());
    }

    #[tokio::test]
    async fn receipts_are_stored_once_by_id_and_the_unknown_ones_can_be_asked_for() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let a = receipt(
            "r1",
            367,
            &[("Vollmilch 3,5%", 2, 218), ("Bio Bananen", 1, 149)],
        );
        let b = ImportReceipt {
            date: date!(2026 - 03 - 03),
            ..receipt("r2", 299, &[("Butter 250g", 1, 299)])
        };
        let ids = vec!["r1".to_string(), "r2".to_string()];
        assert_eq!(unknown_ids(&store, &ids).await.unwrap(), ids);
        let s = import(&store, &[a.clone(), b]).await.unwrap();
        assert_eq!((s.imported, s.duplicates, s.skipped), (2, 0, 0));
        assert!(unknown_ids(&store, &ids).await.unwrap().is_empty());
        let s = import(&store, &[a]).await.unwrap();
        assert_eq!((s.imported, s.duplicates), (0, 1));
        let (last, n) = status(&store).await.unwrap();
        assert!(last.is_some());
        assert_eq!(n, 2);
        forget(&store).await.unwrap();
        assert_eq!(status(&store).await.unwrap().0, None);
    }

    #[tokio::test]
    async fn an_unreadable_receipt_is_noted_and_not_tried_again() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let s = import(&store, &[receipt("r9", 100, &[])]).await.unwrap();
        assert_eq!((s.imported, s.skipped), (0, 1));
        assert!(!s.notes.is_empty());
        assert_eq!(
            unknown_ids(&store, &["r9".to_string()]).await.unwrap(),
            Vec::<String>::new()
        );
    }

    #[tokio::test]
    async fn the_same_purchase_mailed_as_an_ebon_is_not_stored_twice() {
        // a receipt already stored by another route (the mailed PDF), same day, shop, total, time
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let r = receipt(
            "r1",
            367,
            &[("Vollmilch 3,5%", 2, 218), ("Bio Bananen", 1, 149)],
        );
        let read = r.to_receipt().unwrap();
        assert!(matches!(
            Ingest::store(&store, SourceKind::Email, &read)
                .await
                .unwrap(),
            Stored::New(_)
        ));
        let s = import(&store, &[r]).await.unwrap();
        assert_eq!((s.imported, s.duplicates), (0, 1));
    }
}
