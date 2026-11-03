//! One Kaufland digital receipt ("transaction") as the receipt API returns it, and its
//! conversion to a receipt.
//!
//! The field names (`id`, `store`, `positions`, `refundPositions`, `timestamp`, `date`, `sum`,
//! `total`, and per position `name`, `description`, `total`, `price`, `amount`, `quantity`) are
//! those the open-source project Bonfire documents; amounts are whole cents. Fields around them
//! are read leniently: anything missing is simply absent.

use financer_core::{Catalog, Chain, Money};
use financer_receipts::{ParsedReceipt, ReceiptItem};
use serde_json::Value;
use time::macros::format_description;
use time::{Date, OffsetDateTime};

use crate::reader::{ReadError, ReadReceipt, ReceiptReader};

use super::KauflandError;

/// One line of a receipt (a purchase, or a refund with a negative amount).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Position {
    pub name: String,
    pub quantity: u32,
    pub total: Money,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transaction {
    pub id: String,
    pub date: Option<Date>,
    /// `HH:MM` local time, when the stamp states an offset rather than UTC.
    pub time: Option<String>,
    pub store: Option<String>,
    pub total: Option<Money>,
    pub positions: Vec<Position>,
}

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
}

/// Whole cents from a JSON number (integers; a number with a fraction is rounded).
fn cents_of(v: &Value) -> Option<Money> {
    match v {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f.round() as i64))
            .map(Money::from_cents),
        Value::String(s) => s.trim().parse::<i64>().ok().map(Money::from_cents),
        _ => None,
    }
}

fn id_of(v: &Value) -> Option<String> {
    match v.get("id")? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

impl Transaction {
    /// Date and local time from an ISO stamp such as `2026-03-02T18:42:07+01:00`, or from epoch
    /// seconds or milliseconds. The time is dropped for a stamp in UTC (the receipt prints local
    /// time, which cannot be told from UTC alone).
    fn parse_stamp(v: &Value) -> (Option<Date>, Option<String>) {
        match v {
            Value::String(s) => {
                let date = s
                    .get(..10)
                    .and_then(|d| Date::parse(d, format_description!("[year]-[month]-[day]")).ok());
                let utc = s.ends_with('Z') || s.ends_with("+00:00") || s.ends_with("-00:00");
                let time = s
                    .get(11..16)
                    .filter(|t| t.as_bytes().get(2) == Some(&b':') && !utc)
                    .map(str::to_string);
                (date, time)
            }
            Value::Number(n) => {
                let Some(raw) = n.as_i64() else {
                    return (None, None);
                };
                let secs = if raw > 100_000_000_000 {
                    raw / 1000
                } else {
                    raw
                };
                (
                    OffsetDateTime::from_unix_timestamp(secs)
                        .ok()
                        .map(|d| d.date()),
                    None,
                )
            }
            _ => (None, None),
        }
    }

    pub fn from_json(v: &Value) -> Result<Transaction, KauflandError> {
        let id =
            id_of(v).ok_or_else(|| KauflandError::BadResponse("a receipt without an id".into()))?;
        let (date, time) = v
            .get("timestamp")
            .or_else(|| v.get("date"))
            .map(Self::parse_stamp)
            .unwrap_or((None, None));
        let store = v.get("store").and_then(|s| {
            str_of(s, "name")
                .map(str::to_string)
                .or_else(|| str_of(s, "city").map(str::to_string))
        });
        let total = v.get("sum").or_else(|| v.get("total")).and_then(cents_of);
        let lines = |key: &str, sign: i64| -> Vec<Position> {
            v.get(key)
                .and_then(Value::as_array)
                .map(|ps| {
                    ps.iter()
                        .filter_map(|p| {
                            let name = str_of(p, "name")
                                .or_else(|| str_of(p, "description"))?
                                .to_string();
                            let quantity = p
                                .get("quantity")
                                .or_else(|| p.get("amount"))
                                .and_then(Value::as_u64)
                                .and_then(|n| u32::try_from(n).ok())
                                .filter(|q| (1..=99).contains(q))
                                .unwrap_or(1);
                            let total = p.get("total").and_then(cents_of).or_else(|| {
                                let unit = p.get("price").and_then(cents_of)?;
                                Some(unit.times(quantity))
                            })?;
                            Some(Position {
                                name,
                                quantity,
                                total: Money::from_cents(sign * total.abs().cents()),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        let mut positions = lines("positions", 1);
        positions.extend(lines("refundPositions", -1));
        Ok(Transaction {
            id,
            date,
            time,
            store,
            total,
            positions,
        })
    }

    /// The receipt, with refunds as negative lines.
    pub fn to_receipt(&self) -> Result<ReadReceipt, ReadError> {
        if self.positions.is_empty() {
            return Err(ReadError::NoItems);
        }
        let items: Vec<ReceiptItem> = self
            .positions
            .iter()
            .map(|p| ReceiptItem {
                item: Catalog::match_product(&p.name).map(|c| c.key.to_string()),
                text: p.name.clone(),
                quantity: p.quantity,
                line_total: p.total,
            })
            .collect();
        let sum: Money = items.iter().map(|i| i.line_total).sum();
        let total = self.total.or(Some(sum));
        let merchant = match &self.store {
            Some(s) if s.to_lowercase().contains("kaufland") => s.clone(),
            Some(s) => format!("Kaufland {s}"),
            None => "Kaufland".to_string(),
        };
        let parsed = ParsedReceipt {
            merchant: Some(merchant),
            chain: Some(Chain::Kaufland),
            date: self.date,
            reconciles: total == Some(sum),
            total,
            items,
        };
        let fingerprint =
            ReceiptReader::fingerprint(&parsed, Some("kaufland"), self.time.as_deref());
        Ok(ReadReceipt {
            parsed,
            retailer: Some("kaufland".into()),
            time: self.time.clone(),
            fingerprint,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::kaufland_fixtures as fx;
    use time::macros::date;

    fn list(json: &str) -> Vec<Transaction> {
        serde_json::from_str::<Vec<Value>>(json)
            .unwrap()
            .iter()
            .map(|v| Transaction::from_json(v).unwrap())
            .collect()
    }

    #[test]
    fn a_receipt_becomes_a_reconciling_receipt_with_whole_cents() {
        let t = &list(fx::TRANSACTIONS_PAGE_1)[0];
        assert_eq!(t.id, "tx-0001");
        assert_eq!(t.date, Some(date!(2026 - 03 - 02)));
        assert_eq!(t.time.as_deref(), Some("17:05"));
        assert_eq!(t.store.as_deref(), Some("Kaufland Köln-Ehrenfeld"));
        let r = t.to_receipt().unwrap();
        assert_eq!(r.retailer.as_deref(), Some("kaufland"));
        assert_eq!(r.parsed.chain, Some(Chain::Kaufland));
        assert_eq!(
            r.parsed.merchant.as_deref(),
            Some("Kaufland Köln-Ehrenfeld")
        );
        assert_eq!(r.parsed.total, Some(Money::from_cents(547)));
        assert!(r.parsed.reconciles);
        let lines: Vec<_> = r
            .parsed
            .items
            .iter()
            .map(|i| (i.text.as_str(), i.quantity, i.line_total.cents()))
            .collect();
        assert_eq!(
            lines,
            vec![
                ("Vollmilch 3,5%", 2, 218),
                ("Bio Bananen", 1, 149),
                ("Spaghetti 500g", 1, 180)
            ]
        );
    }

    #[test]
    fn refunds_are_negative_lines_and_an_unlisted_total_is_the_sum() {
        let t = &list(fx::TRANSACTIONS_PAGE_1)[1];
        assert_eq!(t.date, Some(date!(2026 - 03 - 03)));
        assert_eq!(t.time, None, "a stamp in UTC has no local time");
        let r = t.to_receipt().unwrap();
        assert_eq!(r.parsed.merchant.as_deref(), Some("Kaufland Düsseldorf"));
        let lines: Vec<i64> = r
            .parsed
            .items
            .iter()
            .map(|i| i.line_total.cents())
            .collect();
        assert_eq!(lines, vec![299, -25]);
        assert_eq!(r.parsed.total, Some(Money::from_cents(274)));
        assert!(r.parsed.reconciles);
    }

    #[test]
    fn an_id_is_required_and_a_receipt_without_lines_cannot_be_read() {
        assert!(Transaction::from_json(&serde_json::json!({"positions": []})).is_err());
        let t = Transaction::from_json(&serde_json::json!({"id": 7})).unwrap();
        assert_eq!(t.id, "7");
        assert!(t.to_receipt().is_err());
    }

    #[test]
    fn epoch_stamps_give_a_date_and_a_price_times_quantity_fills_a_missing_total() {
        let t = Transaction::from_json(&serde_json::json!({
            "id": "e1", "timestamp": 1772470800000i64,
            "positions": [{"name": "Joghurt", "quantity": 3, "price": 79}]
        }))
        .unwrap();
        assert_eq!(t.date, Some(date!(2026 - 03 - 02)));
        assert_eq!(t.positions[0].total.cents(), 237);
    }
}
