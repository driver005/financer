//! Online orders (Amazon, eBay and other web shops) that the app read from a file the shop itself
//! produced, such as the order-history CSV of Amazon's data request, and pushed here. Nothing is
//! fetched from a shop; the app parses the file and sends the orders, and this module validates,
//! converts and stores them once each.
//!
//! An order becomes a receipt whose merchant is the shop's name and whose lines are the ordered
//! products (a refund or a cancelled line is left out by the app). A shop is not a supermarket
//! chain, so the receipt has no chain; the retailer is the shop's name in lower case.

use financer_core::{Catalog, Money};
use financer_receipts::{ParsedReceipt, ReceiptItem};
use financer_store::Store;
use time::Date;

use crate::config::SourceKind;
use crate::error::SyncError;
use crate::ingest::{Ingest, Stored};
use crate::reader::{ReadError, ReadReceipt, ReceiptReader};
use crate::summary::RunSummary;

const SOURCE: &str = "orders_file";
/// Orders one call may carry.
pub const MAX_ORDERS: usize = 200;
/// Lines one order may have.
pub const MAX_LINES: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderLine {
    pub name: String,
    pub quantity: u32,
    pub total: Money,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    /// The shop's order number; an order is stored once per shop and number.
    pub id: String,
    pub date: Date,
    pub total: Option<Money>,
    pub lines: Vec<OrderLine>,
}

/// The shop's name as shown ("Amazon") and its lower-case key ("amazon").
pub fn retailer_key(shop: &str) -> String {
    shop.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

impl Order {
    pub fn to_receipt(&self, shop: &str) -> Result<ReadReceipt, ReadError> {
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
        let parsed = ParsedReceipt {
            merchant: Some(shop.trim().to_string()),
            chain: None,
            date: Some(self.date),
            reconciles: total == Some(sum),
            total,
            items,
        };
        let retailer = retailer_key(shop);
        let fingerprint = ReceiptReader::fingerprint(&parsed, Some(&retailer), None);
        Ok(ReadReceipt {
            parsed,
            retailer: Some(retailer),
            time: None,
            fingerprint,
        })
    }
}

/// Store the orders once each. An order that cannot be read is noted and not tried again.
pub async fn import(store: &Store, shop: &str, orders: &[Order]) -> Result<RunSummary, SyncError> {
    let retailer = retailer_key(shop);
    let mut summary = RunSummary::default();
    for o in orders {
        let key = format!("{retailer}:{}", o.id);
        if store.seen_outcome(SOURCE, &key).await?.is_some() {
            summary.duplicates += 1;
            continue;
        }
        let outcome = match o.to_receipt(shop) {
            Ok(read) => match Ingest::store(store, SourceKind::OrdersFile, &read).await? {
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
                summary.note(format!("an order has no readable lines ({why})"));
                "unreadable"
            }
        };
        store.mark_seen(SOURCE, &key, outcome).await?;
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn order(id: &str, total: i64, lines: &[(&str, u32, i64)]) -> Order {
        Order {
            id: id.into(),
            date: date!(2026 - 02 - 11),
            total: Some(Money::from_cents(total)),
            lines: lines
                .iter()
                .map(|(n, q, t)| OrderLine {
                    name: (*n).into(),
                    quantity: *q,
                    total: Money::from_cents(*t),
                })
                .collect(),
        }
    }

    #[test]
    fn a_shops_key_is_its_name_in_lower_case() {
        assert_eq!(retailer_key("Amazon"), "amazon");
        assert_eq!(retailer_key(" Amazon.de "), "amazon-de");
        assert_eq!(retailer_key("eBay Kleinanzeigen"), "ebay-kleinanzeigen");
    }

    #[test]
    fn an_order_becomes_a_receipt_of_the_shop_without_a_chain() {
        let r = order(
            "302-1",
            2498,
            &[("USB-C Kabel", 2, 1299), ("Hülle", 1, 1199)],
        )
        .to_receipt("Amazon")
        .unwrap();
        assert_eq!(r.parsed.merchant.as_deref(), Some("Amazon"));
        assert_eq!(r.parsed.chain, None);
        assert_eq!(r.retailer.as_deref(), Some("amazon"));
        assert!(r.parsed.reconciles);
        assert!(order("x", 100, &[]).to_receipt("Amazon").is_err());
    }

    #[tokio::test]
    async fn orders_are_stored_once_per_shop_and_number() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let a = order("302-1", 1299, &[("USB-C Kabel", 1, 1299)]);
        let b = Order {
            date: date!(2026 - 02 - 12),
            ..order("302-2", 899, &[("Maus", 1, 899)])
        };
        let s = import(&store, "Amazon", &[a.clone(), b]).await.unwrap();
        assert_eq!((s.imported, s.duplicates, s.skipped), (2, 0, 0));
        let s = import(&store, "Amazon", &[a.clone()]).await.unwrap();
        assert_eq!((s.imported, s.duplicates), (0, 1));
        // the same number at another shop is another order
        let s = import(&store, "eBay", &[a]).await.unwrap();
        assert_eq!(s.imported, 1);
        assert_eq!(store.count_receipts_from("orders_file").await.unwrap(), 3);
    }

    #[tokio::test]
    async fn an_order_without_lines_is_noted_and_not_tried_again() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let s = import(&store, "Amazon", &[order("x", 100, &[])])
            .await
            .unwrap();
        assert_eq!((s.imported, s.skipped), (0, 1));
        assert!(store
            .seen_outcome("orders_file", "amazon:x")
            .await
            .unwrap()
            .is_some());
    }
}
