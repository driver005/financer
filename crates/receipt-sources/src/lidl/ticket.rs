//! A Lidl Plus ticket (receipt) as the ticket API returns it, and its conversion to a receipt.
//!
//! The item fields (`name`, `quantity`, `isWeight`, `currentUnitPrice`, `originalAmount`,
//! `discounts`, `deposit`) are those the open-source client documents. Fields around them (store,
//! date, total, printed HTML) are read leniently: anything missing is simply absent.

use financer_core::{Catalog, Chain, Money};
use financer_receipts::{ParsedReceipt, ReceiptItem};
use serde_json::Value;
use time::macros::format_description;
use time::Date;

use crate::reader::{ReadError, ReadReceipt, ReceiptReader, Trust};
use crate::text::html_to_text;

use super::LidlError;

/// One line of a ticket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TicketItem {
    pub name: String,
    pub quantity: u32,
    pub is_weight: bool,
    /// Price of the line before discounts.
    pub original: Money,
    /// Sum of the line's discounts (a positive amount taken off).
    pub discounts: Money,
}

/// What the ticket list says about a ticket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TicketSummary {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ticket {
    pub id: String,
    pub date: Option<Date>,
    /// `HH:MM` local time, when the ticket states an offset (or none) rather than UTC.
    pub time: Option<String>,
    pub store: Option<String>,
    pub total: Option<Money>,
    pub items: Vec<TicketItem>,
    /// The printed receipt as HTML, when the ticket has one.
    pub html: Option<String>,
}

/// `"2,19"`, `"2.19"` or the JSON number `2.19` as money; numbers go through their text so no
/// floating point arithmetic is involved.
fn money_of(v: &Value) -> Option<Money> {
    match v {
        Value::String(s) => Money::parse(s).ok(),
        Value::Number(n) => Money::parse(&n.to_string()).ok(),
        _ => None,
    }
}

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.trim().is_empty())
}

impl TicketSummary {
    pub fn from_json(v: &Value) -> Option<Self> {
        Some(TicketSummary {
            id: str_of(v, "id")?.to_string(),
        })
    }
}

impl Ticket {
    /// Date and local time from an ISO timestamp such as `2026-03-02T18:42:07+01:00`. The time is
    /// dropped when the stamp is in UTC, since the receipt prints local time.
    fn parse_stamp(s: &str) -> (Option<Date>, Option<String>) {
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

    pub fn from_json(v: &Value) -> Result<Ticket, LidlError> {
        let id = str_of(v, "id")
            .ok_or_else(|| LidlError::BadResponse("a ticket without an id".into()))?
            .to_string();
        let (date, time) = str_of(v, "date")
            .map(Self::parse_stamp)
            .unwrap_or((None, None));
        let store = v.get("store").and_then(|s| str_of(s, "name")).map(str::to_string);
        let total = v
            .get("totalAmount")
            .or_else(|| v.get("totalAmountNumber"))
            .and_then(money_of);
        let items = v
            .get("itemsLine")
            .and_then(Value::as_array)
            .map(|lines| {
                lines
                    .iter()
                    .filter_map(|l| {
                        let name = str_of(l, "name")?.to_string();
                        let original = l.get("originalAmount").and_then(money_of)?;
                        let is_weight = l.get("isWeight").and_then(Value::as_bool).unwrap_or(false);
                        let quantity = l
                            .get("quantity")
                            .and_then(|q| match q {
                                Value::String(s) => s.trim().parse::<u32>().ok(),
                                Value::Number(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()),
                                _ => None,
                            })
                            .filter(|q| (1..=99).contains(q))
                            .unwrap_or(1);
                        let discounts = l
                            .get("discounts")
                            .and_then(Value::as_array)
                            .map(|ds| {
                                ds.iter()
                                    .filter_map(|d| d.get("amount").and_then(money_of))
                                    .map(Money::abs)
                                    .sum()
                            })
                            .unwrap_or(Money::ZERO);
                        Some(TicketItem {
                            name,
                            quantity: if is_weight { 1 } else { quantity },
                            is_weight,
                            original,
                            discounts,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(Ticket {
            id,
            date,
            time,
            store,
            total,
            items,
            html: str_of(v, "htmlPrintedReceipt").map(str::to_string),
        })
    }

    /// The ticket as a receipt. Line prices are the amounts after discounts, unless the printed
    /// total only adds up with the undiscounted amounts.
    pub fn to_receipt(&self) -> Result<ReadReceipt, ReadError> {
        if self.items.is_empty() {
            // no structured lines: read the printed receipt instead
            let text = html_to_text(self.html.as_deref().ok_or(ReadError::NoItems)?);
            return ReceiptReader::read(&text, Some("lidl"), self.date, Trust::Document);
        }
        let discounted: Money = self.items.iter().map(|i| i.original - i.discounts).sum();
        let undiscounted: Money = self.items.iter().map(|i| i.original).sum();
        let use_original = self.total == Some(undiscounted) && self.total != Some(discounted);
        let items: Vec<ReceiptItem> = self
            .items
            .iter()
            .map(|i| ReceiptItem {
                item: Catalog::match_product(&i.name).map(|c| c.key.to_string()),
                text: i.name.clone(),
                quantity: i.quantity,
                line_total: if use_original {
                    i.original
                } else {
                    i.original - i.discounts
                },
            })
            .collect();
        let sum: Money = items.iter().map(|i| i.line_total).sum();
        let total = self.total.or(Some(sum));
        let merchant = match &self.store {
            Some(s) => format!("Lidl {s}"),
            None => "Lidl".to_string(),
        };
        let parsed = ParsedReceipt {
            merchant: Some(merchant),
            chain: Some(Chain::Lidl),
            date: self.date,
            reconciles: total == Some(sum),
            total,
            items,
        };
        let fingerprint = ReceiptReader::fingerprint(&parsed, Some("lidl"), self.time.as_deref());
        Ok(ReadReceipt {
            parsed,
            retailer: Some("lidl".into()),
            time: self.time.clone(),
            fingerprint,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::lidl_fixtures as fx;
    use time::macros::date;

    fn ticket(json: &str) -> Ticket {
        Ticket::from_json(&serde_json::from_str(json).unwrap()).unwrap()
    }

    #[test]
    fn structured_ticket_becomes_a_reconciling_receipt() {
        let t = ticket(fx::TICKET_1);
        assert_eq!(t.date, Some(date!(2026 - 03 - 02)));
        assert_eq!(t.time.as_deref(), Some("18:42"));
        assert_eq!(t.store.as_deref(), Some("Köln-Ehrenfeld"));
        assert_eq!(t.items.len(), 3);
        assert!(t.items[2].is_weight && t.items[2].quantity == 1);
        let r = t.to_receipt().unwrap();
        assert_eq!(r.retailer.as_deref(), Some("lidl"));
        assert_eq!(r.parsed.merchant.as_deref(), Some("Lidl Köln-Ehrenfeld"));
        assert_eq!(r.parsed.chain, Some(Chain::Lidl));
        let lines: Vec<_> = r
            .parsed
            .items
            .iter()
            .map(|i| (i.text.as_str(), i.quantity, i.line_total.cents()))
            .collect();
        // the coupon is taken off the first line; milk is 2 x 1,09; the banana line is by weight
        assert_eq!(
            lines,
            vec![("Vegane Frikadellen", 1, 198), ("Vollmilch 3,5%", 2, 218), ("Bio Bananen", 1, 149)]
        );
        assert_eq!(r.parsed.total, Some(Money::from_cents(565)));
        assert!(r.parsed.reconciles);
        assert_eq!(r.parsed.items[1].item.as_deref(), Some("milch"));
    }

    #[test]
    fn undiscounted_amounts_are_used_when_only_they_add_up() {
        let mut v: Value = serde_json::from_str(fx::TICKET_1).unwrap();
        v["totalAmount"] = Value::String("5,86".into()); // 2,19 + 2,18 + 1,49
        let r = Ticket::from_json(&v).unwrap().to_receipt().unwrap();
        assert!(r.parsed.reconciles);
        assert_eq!(r.parsed.items[0].line_total, Money::from_cents(219));
    }

    #[test]
    fn missing_total_is_taken_from_the_lines() {
        let mut v: Value = serde_json::from_str(fx::TICKET_1).unwrap();
        v.as_object_mut().unwrap().remove("totalAmount");
        let r = Ticket::from_json(&v).unwrap().to_receipt().unwrap();
        assert_eq!(r.parsed.total, Some(Money::from_cents(565)));
    }

    #[test]
    fn printed_html_is_the_fallback_and_utc_times_are_not_trusted() {
        let t = ticket(fx::TICKET_2);
        assert!(t.items.is_empty());
        assert_eq!(t.time, None, "07:15Z is not the printed local time");
        let r = t.to_receipt().unwrap();
        assert_eq!(r.parsed.items.len(), 2);
        assert_eq!(r.parsed.total, Some(Money::from_cents(358)));
        assert_eq!(r.time.as_deref(), Some("08:15"), "the printed time is local");
        assert_eq!(r.retailer.as_deref(), Some("lidl"));
    }

    #[test]
    fn empty_and_malformed_tickets() {
        assert_eq!(ticket(fx::TICKET_3).to_receipt(), Err(ReadError::NoItems));
        assert!(Ticket::from_json(&serde_json::json!({"date": "x"})).is_err());
        let t = ticket(r#"{"id":"a","itemsLine":[{"name":"x"},{"originalAmount":"1,00"},"junk"]}"#);
        assert!(t.items.is_empty(), "lines without a name and a price are dropped");
    }

    #[test]
    fn amounts_in_several_notations() {
        use serde_json::json;
        assert_eq!(money_of(&json!("1.234,50")), Some(Money::from_cents(123_450)));
        assert_eq!(money_of(&json!(2.19)), Some(Money::from_cents(219)));
        assert_eq!(money_of(&json!(5)), Some(Money::from_cents(500)));
        assert_eq!(money_of(&json!("abc")), None);
        assert_eq!(money_of(&json!(null)), None);
    }

    #[test]
    fn stamps() {
        assert_eq!(
            Ticket::parse_stamp("2026-03-02T18:42:07+01:00"),
            (Some(date!(2026 - 03 - 02)), Some("18:42".into()))
        );
        assert_eq!(
            Ticket::parse_stamp("2026-03-02T17:42:07.123Z"),
            (Some(date!(2026 - 03 - 02)), None)
        );
        assert_eq!(Ticket::parse_stamp("garbage"), (None, None));
    }
}
