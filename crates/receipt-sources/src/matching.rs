//! Which bank transaction paid for which receipt.
//!
//! A receipt and a transaction belong together when they are from the same retailer, the amounts
//! agree within a cent and the dates are at most three days apart (card payments book a day or
//! two later). A pair is only linked when it is the *only* possible one on both sides: two equal
//! receipts, or two equal payments, stay unlinked rather than risking a wrong link.

use std::collections::HashMap;

use financer_core::{StoreMatcher, Transaction};
use financer_store::{ReceiptMeta, Store};
use time::Date;

use crate::error::SyncError;

/// Largest difference between receipt date and booking date.
pub const MAX_DAYS_APART: i64 = 3;
/// Largest difference between receipt total and payment, in cents.
pub const MAX_CENTS_APART: i64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptFacts {
    pub id: i64,
    pub brand: Option<String>,
    pub date: Option<Date>,
    pub total_cents: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentFacts {
    pub id: i64,
    pub brand: Option<String>,
    pub date: Date,
    /// Negative for money leaving the account.
    pub amount_cents: i64,
}

impl PaymentFacts {
    /// The chain comes from the Stores screen's matcher (with the user's own spellings).
    pub fn from_transaction(id: i64, t: &Transaction, matcher: &StoreMatcher) -> Self {
        PaymentFacts {
            id,
            brand: matcher.match_transaction(t).map(|c| c.id.clone()),
            date: t.booking_date,
            amount_cents: t.amount.cents(),
        }
    }
}

pub struct Matcher;

impl Matcher {
    fn could_pay(r: &ReceiptFacts, p: &PaymentFacts) -> bool {
        let (Some(rb), Some(pb)) = (&r.brand, &p.brand) else {
            return false;
        };
        let (Some(date), Some(total)) = (r.date, r.total_cents) else {
            return false;
        };
        p.amount_cents < 0
            && rb == pb
            && (p.amount_cents.abs() - total).abs() <= MAX_CENTS_APART
            && (p.date - date).whole_days().abs() <= MAX_DAYS_APART
    }

    /// `(receipt id, payment id)` for every unambiguous pair.
    pub fn link(receipts: &[ReceiptFacts], payments: &[PaymentFacts]) -> Vec<(i64, i64)> {
        let mut by_receipt: HashMap<i64, Vec<i64>> = HashMap::new();
        let mut by_payment: HashMap<i64, Vec<i64>> = HashMap::new();
        for r in receipts {
            for p in payments {
                if Self::could_pay(r, p) {
                    by_receipt.entry(r.id).or_default().push(p.id);
                    by_payment.entry(p.id).or_default().push(r.id);
                }
            }
        }
        let mut pairs: Vec<(i64, i64)> = by_receipt
            .iter()
            .filter_map(|(r, ps)| match ps.as_slice() {
                [p] if by_payment.get(p).is_some_and(|rs| rs.len() == 1) => Some((*r, *p)),
                _ => None,
            })
            .collect();
        pairs.sort_unstable();
        pairs
    }
}

/// Links stored receipts to stored transactions.
pub struct Linker;

impl Linker {
    /// Link every receipt that has no link yet to its payment where that is unambiguous.
    /// Returns how many links were made.
    pub async fn run(store: &Store, matcher: &StoreMatcher) -> Result<usize, SyncError> {
        let metas: Vec<ReceiptMeta> = store.receipt_metas().await?;
        let taken: std::collections::HashSet<i64> =
            metas.iter().filter_map(|m| m.transaction_id).collect();
        let receipts: Vec<ReceiptFacts> = metas
            .iter()
            .filter(|m| m.transaction_id.is_none())
            .map(|m| ReceiptFacts {
                id: m.id,
                brand: m.retailer.clone(),
                date: m.date,
                total_cents: m.total_cents,
            })
            .collect();
        if receipts.is_empty() {
            return Ok(0);
        }
        let payments: Vec<PaymentFacts> = store
            .list_transactions()
            .await?
            .iter()
            .filter(|t| !taken.contains(&t.id))
            .map(|t| PaymentFacts::from_transaction(t.id, &t.transaction, matcher))
            .collect();
        let pairs = Matcher::link(&receipts, &payments);
        for (receipt, payment) in &pairs {
            store
                .set_receipt_transaction(*receipt, Some(*payment))
                .await?;
        }
        Ok(pairs.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use financer_core::Money;
    use time::macros::date;

    fn receipt(id: i64, brand: &str, d: Date, cents: i64) -> ReceiptFacts {
        ReceiptFacts {
            id,
            brand: Some(brand.into()),
            date: Some(d),
            total_cents: Some(cents),
        }
    }

    fn payment(id: i64, brand: &str, d: Date, cents: i64) -> PaymentFacts {
        PaymentFacts {
            id,
            brand: Some(brand.into()),
            date: d,
            amount_cents: cents,
        }
    }

    #[test]
    fn links_the_obvious_pair() {
        let r = [receipt(1, "rewe", date!(2026 - 03 - 02), 784)];
        let p = [
            payment(10, "rewe", date!(2026 - 03 - 04), -784),
            payment(11, "lidl", date!(2026 - 03 - 02), -784),
            payment(12, "rewe", date!(2026 - 03 - 02), -999),
        ];
        assert_eq!(Matcher::link(&r, &p), vec![(1, 10)]);
    }

    #[test]
    fn tolerances_are_inclusive_and_exact() {
        let r = [receipt(1, "rewe", date!(2026 - 03 - 02), 784)];
        for (d, cents, linked) in [
            (date!(2026 - 03 - 05), -785, true),  // 3 days, 1 cent
            (date!(2026 - 02 - 27), -783, true),  // 3 days before, 1 cent
            (date!(2026 - 03 - 06), -784, false), // 4 days
            (date!(2026 - 03 - 02), -786, false), // 2 cents
            (date!(2026 - 03 - 02), 784, false),  // a refund, not a payment
        ] {
            let p = [payment(10, "rewe", d, cents)];
            assert_eq!(!Matcher::link(&r, &p).is_empty(), linked, "{d} {cents}");
        }
    }

    #[test]
    fn two_payments_that_fit_one_receipt_stay_unlinked() {
        let r = [receipt(1, "rewe", date!(2026 - 03 - 02), 784)];
        let p = [
            payment(10, "rewe", date!(2026 - 03 - 02), -784),
            payment(11, "rewe", date!(2026 - 03 - 03), -784),
        ];
        assert!(Matcher::link(&r, &p).is_empty());
    }

    #[test]
    fn two_equal_receipts_for_one_payment_stay_unlinked() {
        let r = [
            receipt(1, "rewe", date!(2026 - 03 - 02), 784),
            receipt(2, "rewe", date!(2026 - 03 - 03), 784),
        ];
        let p = [payment(10, "rewe", date!(2026 - 03 - 03), -784)];
        assert!(Matcher::link(&r, &p).is_empty());
    }

    #[test]
    fn equal_receipts_and_payments_all_stay_unlinked_but_others_link() {
        let r = [
            receipt(1, "rewe", date!(2026 - 03 - 02), 500),
            receipt(2, "rewe", date!(2026 - 03 - 02), 500),
            receipt(3, "lidl", date!(2026 - 03 - 02), 1234),
        ];
        let p = [
            payment(10, "rewe", date!(2026 - 03 - 02), -500),
            payment(11, "rewe", date!(2026 - 03 - 02), -500),
            payment(12, "lidl", date!(2026 - 03 - 03), -1234),
        ];
        assert_eq!(Matcher::link(&r, &p), vec![(3, 12)]);
    }

    #[test]
    fn unknown_retailer_or_missing_facts_never_link() {
        let p = [payment(10, "rewe", date!(2026 - 03 - 02), -784)];
        let mut r = receipt(1, "rewe", date!(2026 - 03 - 02), 784);
        r.brand = None;
        assert!(Matcher::link(&[r.clone()], &p).is_empty());
        r.brand = Some("rewe".into());
        r.total_cents = None;
        assert!(Matcher::link(&[r.clone()], &p).is_empty());
        r.total_cents = Some(784);
        r.date = None;
        assert!(Matcher::link(&[r], &p).is_empty());
        let mut unknown = p[0].clone();
        unknown.brand = None;
        assert!(Matcher::link(
            &[receipt(1, "rewe", date!(2026 - 03 - 02), 784)],
            &[unknown]
        )
        .is_empty());
    }

    #[test]
    fn payments_get_their_brand_from_counterparty_or_purpose() {
        let t = |counterparty: &str, purpose: &str| Transaction {
            booking_date: date!(2026 - 03 - 03),
            amount: Money::from_cents(-784),
            counterparty: counterparty.into(),
            purpose: purpose.into(),
            counterparty_iban: None,
            category: None,
        };
        assert_eq!(
            PaymentFacts::from_transaction(
                1,
                &t("REWE SAGT DANKE", "Kartenzahlung"),
                &StoreMatcher::builtin()
            )
            .brand
            .as_deref(),
            Some("rewe")
        );
        assert_eq!(
            PaymentFacts::from_transaction(
                1,
                &t("PayPal", "EDEKA Müller 1234"),
                &StoreMatcher::builtin()
            )
            .brand
            .as_deref(),
            Some("edeka")
        );
        assert_eq!(
            PaymentFacts::from_transaction(1, &t("Vermieter", "Miete"), &StoreMatcher::builtin())
                .brand,
            None
        );
    }

    #[tokio::test]
    async fn linker_stores_links_and_does_not_reuse_a_payment() {
        use crate::config::SourceKind;
        use crate::ingest::Ingest;
        use crate::reader::fixtures::REWE_EBON;
        use crate::reader::{ReceiptReader, Trust};

        let store = Store::connect("sqlite::memory:").await.unwrap();
        let tx = |d: Date, cents: i64, who: &str| Transaction {
            booking_date: d,
            amount: Money::from_cents(cents),
            counterparty: who.into(),
            purpose: "Kartenzahlung".into(),
            counterparty_iban: None,
            category: None,
        };
        store
            .insert_new_transactions(&[
                tx(date!(2026 - 03 - 03), -784, "REWE SAGT DANKE"),
                tx(date!(2026 - 03 - 03), -784, "LIDL SAGT DANKE"),
            ])
            .await
            .unwrap();
        let r = ReceiptReader::read(REWE_EBON, None, None, Trust::Document).unwrap();
        Ingest::store(&store, SourceKind::Email, &r).await.unwrap();

        assert_eq!(
            Linker::run(&store, &StoreMatcher::builtin()).await.unwrap(),
            1
        );
        let metas = store.receipt_metas().await.unwrap();
        let txs = store.list_transactions().await.unwrap();
        let rewe_tx = txs
            .iter()
            .find(|t| t.transaction.counterparty.contains("REWE"))
            .unwrap();
        assert_eq!(metas[0].transaction_id, Some(rewe_tx.id));
        // nothing new to link, and the link is stable
        assert_eq!(
            Linker::run(&store, &StoreMatcher::builtin()).await.unwrap(),
            0
        );

        // a second identical purchase on the same day cannot take the same payment
        let again = ReceiptReader::read(
            &REWE_EBON.replace("18:42:07", "19:30:00"),
            None,
            None,
            Trust::Document,
        )
        .unwrap();
        Ingest::store(&store, SourceKind::Email, &again)
            .await
            .unwrap();
        assert_eq!(
            Linker::run(&store, &StoreMatcher::builtin()).await.unwrap(),
            0
        );
        assert_eq!(
            store
                .receipt_metas()
                .await
                .unwrap()
                .iter()
                .filter(|m| m.transaction_id.is_some())
                .count(),
            1
        );
    }
}
