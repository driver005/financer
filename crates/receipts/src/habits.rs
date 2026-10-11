//! What you "normally buy": from receipts, or a generic starter basket when there are none.

use std::collections::BTreeMap;

use financer_core::BasketItem;

use crate::ParsedReceipt;

/// Items bought on at least `min_receipts` different receipts, with the typical (median)
/// quantity per receipt. Unrecognised items are ignored.
pub fn usual_items(receipts: &[ParsedReceipt], min_receipts: usize) -> Vec<BasketItem> {
    let mut per_item: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for r in receipts {
        let mut on_this_receipt: BTreeMap<&str, u32> = BTreeMap::new();
        for it in &r.items {
            if let Some(key) = it.item.as_deref() {
                *on_this_receipt.entry(key).or_default() += it.quantity;
            }
        }
        for (key, qty) in on_this_receipt {
            per_item.entry(key).or_default().push(qty);
        }
    }
    per_item
        .into_iter()
        .filter(|(_, q)| q.len() >= min_receipts.max(1))
        .map(|(key, mut q)| {
            q.sort_unstable();
            BasketItem {
                item: key.to_string(),
                quantity: q[q.len() / 2].max(1),
            }
        })
        .collect()
}

/// A generic one-week basket for one person, used until real habits are known
/// ("spending only" mode). Clearly an assumption, not something learned from you.
pub fn starter_basket() -> Vec<BasketItem> {
    [
        ("milch", 2),
        ("brot", 1),
        ("eier", 1),
        ("butter", 1),
        ("nudeln", 1),
        ("reis", 1),
        ("kartoffeln", 1),
        ("zwiebeln", 1),
        ("tomaten", 1),
        ("karotten", 1),
        ("gurke", 1),
        ("bananen", 1),
        ("aepfel", 1),
        ("haehnchenbrust", 1),
        ("kaese-gouda", 1),
        ("joghurt", 2),
    ]
    .into_iter()
    .map(|(item, quantity)| BasketItem {
        item: item.to_string(),
        quantity,
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_receipt;

    fn receipt(text: &str) -> ParsedReceipt {
        parse_receipt(text)
    }

    #[test]
    fn items_on_several_receipts_become_usual() {
        let rs = vec![
            receipt("REWE\nMILCH 1,19 B\nBROT 2,29 B\nSUMME 3,48\n"),
            receipt("LIDL\nMILCH 1,09 B\nNUDELN 0,89 B\nSUMME 1,98\n"),
            receipt("ALDI\nMILCH 0,99 B\nSUMME 0,99\n"),
        ];
        let usual = usual_items(&rs, 2);
        assert_eq!(usual.len(), 1);
        assert_eq!(usual[0].item, "milch");
        assert_eq!(usual[0].quantity, 1);
        assert_eq!(usual_items(&rs, 1).len(), 3);
    }

    #[test]
    fn quantity_is_the_median_per_receipt() {
        let rs = vec![
            receipt("REWE\nJOGHURT 1,98 B\n2 x 0,99\nSUMME 1,98\n"),
            receipt("REWE\nJOGHURT 2,97 B\n3 x 0,99\nSUMME 2,97\n"),
            receipt("REWE\nJOGHURT 0,99 B\nSUMME 0,99\n"),
        ];
        assert_eq!(usual_items(&rs, 2)[0].quantity, 2);
    }

    #[test]
    fn starter_basket_uses_known_catalog_items() {
        for it in starter_basket() {
            assert!(financer_core::by_key(&it.item).is_some(), "{}", it.item);
        }
    }
}
