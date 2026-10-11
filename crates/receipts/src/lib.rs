//! Receipt text (from on-device OCR) to line items, and receipts to "usual items".
//!
//! The parser is deliberately forgiving: German supermarket receipts share a rough shape
//! (`NAME  1,19 B`, optional `2 x 0,99` quantity lines, a `SUMME` line) but differ in detail.
//! It reports whether the items add up to the printed total, so the app can ask the user to
//! check a receipt when OCR dropped or garbled lines.

pub mod habits;

pub use habits::Habits;

use financer_core::{Catalog, Chain, Money};
use serde::{Deserialize, Serialize};
use time::{Date, Month};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptItem {
    /// Text as printed.
    pub text: String,
    pub quantity: u32,
    /// What was charged for the line (quantity already included).
    pub line_total: Money,
    /// Generic item key, when the text could be recognised.
    pub item: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedReceipt {
    pub merchant: Option<String>,
    pub chain: Option<Chain>,
    pub date: Option<Date>,
    pub items: Vec<ReceiptItem>,
    pub total: Option<Money>,
    /// True when the item lines sum to the printed total.
    pub reconciles: bool,
}

const TOTAL_WORDS: &[&str] = &[
    "summe",
    "gesamt",
    "gesamtbetrag",
    "total",
    "zu zahlen",
    "zahlbetrag",
];
const SKIP_WORDS: &[&str] = &[
    "mwst",
    "ust",
    "steuer",
    "netto",
    "brutto",
    "bar",
    "ec-karte",
    "ec karte",
    "girocard",
    "visa",
    "mastercard",
    "rückgeld",
    "rueckgeld",
    "gegeben",
    "kartenzahlung",
    "pfand",
    "leergut",
    "rabatt",
    "coupon",
    "gutschein",
    "bonus",
    "payback",
    "tse",
    "kasse",
    "beleg",
    "vielen dank",
    "danke",
];

/// Parses OCR text of a receipt into line items.
pub struct ReceiptParser;

impl ReceiptParser {
    /// `1,19`, `-0,50`, `1,19B`, `1,19*` -> money. Rejects anything that is not a plain amount.
    fn parse_amount(token: &str) -> Option<Money> {
        let t = token.trim_end_matches(|c: char| c.is_ascii_alphabetic() || c == '*');
        let body = t.strip_prefix('-').unwrap_or(t);
        let (euros, cents) = body.split_once(',')?;
        if euros.is_empty()
            || cents.len() != 2
            || !euros.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            || !cents.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        Money::parse(t).ok()
    }

    /// `2 x 0,99` -> (2, None). Some receipts print the line total on the same line,
    /// `2 x 0,99   1,98 B` -> (2, Some(1,98)); the item name is then the line above.
    fn quantity_line(line: &str) -> Option<(u32, Option<Money>)> {
        let mut parts = line.split_whitespace();
        let qty: u32 = parts.next()?.parse().ok()?;
        let x = parts.next()?;
        if !(x == "x" || x == "X") || qty == 0 || qty > 99 {
            return None;
        }
        parts.next().and_then(Self::parse_amount)?;
        let rest: Vec<&str> = parts.filter(|t| !t.eq_ignore_ascii_case("eur")).collect();
        let line_total = match rest.as_slice() {
            [] => None,
            [amount] | [amount, _] => Some(Self::parse_amount(amount)?),
            _ => return None,
        };
        Some((qty, line_total))
    }

    fn parse_date(line: &str) -> Option<Date> {
        for word in line.split(|c: char| !(c.is_ascii_digit() || c == '.')) {
            let mut p = word.split('.');
            let (Some(d), Some(m), Some(y), None) = (p.next(), p.next(), p.next(), p.next()) else {
                continue;
            };
            let (Ok(d), Ok(m), Ok(y)) = (d.parse::<u8>(), m.parse::<u8>(), y.parse::<i32>()) else {
                continue;
            };
            let year = if y < 100 { 2000 + y } else { y };
            if let (Ok(month), true) = (Month::try_from(m), (2000..2100).contains(&year)) {
                if let Ok(date) = Date::from_calendar_date(year, month, d) {
                    return Some(date);
                }
            }
        }
        None
    }

    fn is_skipped(lower: &str) -> bool {
        SKIP_WORDS.iter().any(|w| lower.contains(w))
    }

    fn is_total_line(lower: &str) -> bool {
        TOTAL_WORDS.iter().any(|w| lower.starts_with(w))
    }

    pub fn parse(text: &str) -> ParsedReceipt {
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        let merchant = lines.first().map(|s| s.to_string());
        let chain = merchant.as_deref().and_then(Chain::from_name);
        let date = lines.iter().find_map(|l| Self::parse_date(l));

        let mut items: Vec<ReceiptItem> = Vec::new();
        let mut total = None;
        // A line with a name but no price; the next line may be `2 x 0,99   1,98 B` for it.
        let mut pending_name: Option<String> = None;

        for line in &lines {
            let lower = line.to_lowercase();
            if Self::is_total_line(&lower) {
                if let Some(a) = line.split_whitespace().rev().find_map(Self::parse_amount) {
                    total = Some(total.map_or(a, |t: Money| t.max(a)));
                }
                pending_name = None;
                continue;
            }
            if let Some((qty, line_total)) = Self::quantity_line(line) {
                match (line_total, pending_name.take()) {
                    (Some(price), Some(name)) if !Self::is_skipped(&name.to_lowercase()) => items
                        .push(ReceiptItem {
                            item: Catalog::match_product(&name).map(|i| i.key.to_string()),
                            text: name,
                            quantity: qty,
                            line_total: price,
                        }),
                    (None, _) => {
                        if let Some(last) = items.last_mut() {
                            last.quantity = qty;
                        }
                    }
                    _ => {}
                }
                continue;
            }
            let tokens: Vec<&str> = line.split_whitespace().collect();
            let Some((price_idx, price)) = tokens
                .iter()
                .enumerate()
                .rev()
                .find_map(|(i, t)| Self::parse_amount(t).map(|a| (i, a)))
            else {
                pending_name = Some(line.to_string());
                continue;
            };
            pending_name = None;
            // price must be at the end, optionally followed by one tax-class letter (A, B, *)
            let trailing = tokens.len() - 1 - price_idx;
            if trailing > 1 || (trailing == 1 && tokens[price_idx + 1].len() > 1) || price_idx == 0
            {
                continue;
            }
            let name = tokens[..price_idx].join(" ");
            if Self::is_skipped(&lower) || price.is_negative() || price.cents() == 0 {
                continue;
            }
            items.push(ReceiptItem {
                item: Catalog::match_product(&name).map(|i| i.key.to_string()),
                text: name,
                quantity: 1,
                line_total: price,
            });
        }

        let sum: Money = items.iter().map(|i| i.line_total).sum();
        let reconciles = total.is_some_and(|t| t == sum);
        ParsedReceipt {
            merchant,
            chain,
            date,
            items,
            total,
            reconciles,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    const REWE: &str = "\
REWE Markt GmbH
Musterstr. 1, 50667 Köln
BIO VOLLMILCH 3,5%          1,19 B
SPAGHETTI 500G              0,89 A
BANANEN                     1,49 B
EIER BODENHALTUNG 10ER      2,29 B
JOGHURT NATUR
2 x 0,99                    1,98 B
PFAND                       0,25 A
SUMME                       7,84
BAR                        10,00
RÜCKGELD                    2,16
02.03.26 18:42 Bon-Nr. 1234
Vielen Dank für Ihren Einkauf!";

    #[test]
    fn parses_a_typical_receipt() {
        let r = ReceiptParser::parse(REWE);
        assert_eq!(r.chain, Some(Chain::Rewe));
        assert_eq!(r.date, Some(date!(2026 - 03 - 02)));
        assert_eq!(r.total, Some(Money::from_cents(784)));
        let names: Vec<_> = r.items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "BIO VOLLMILCH 3,5%",
                "SPAGHETTI 500G",
                "BANANEN",
                "EIER BODENHALTUNG 10ER",
                "JOGHURT NATUR"
            ]
        );
        let qty: Vec<_> = r.items.iter().map(|i| i.quantity).collect();
        assert_eq!(qty, vec![1, 1, 1, 1, 2]); // the "2 x 0,99" line belongs to the yogurt, not the eggs
        assert_eq!(r.items[4].line_total, Money::from_cents(198));
        assert!(r.reconciles, "items must add up to the printed total");
    }

    #[test]
    fn maps_items_to_catalog_keys() {
        let r = ReceiptParser::parse(REWE);
        let keys: Vec<_> = r.items.iter().filter_map(|i| i.item.as_deref()).collect();
        assert_eq!(keys, vec!["milch", "nudeln", "bananen", "eier", "joghurt"]);
    }

    #[test]
    fn reconciles_when_lines_add_up_to_the_total() {
        let ok = "LIDL\nMILCH 1,09 B\nBROT 2,49 B\nSUMME 3,58\n";
        let r = ReceiptParser::parse(ok);
        assert!(r.reconciles);
        assert_eq!(r.chain, Some(Chain::Lidl));

        let dropped_line = "LIDL\nMILCH 1,09 B\nSUMME 3,58\n";
        assert!(!ReceiptParser::parse(dropped_line).reconciles);

        assert!(!ReceiptParser::parse("LIDL\nMILCH 1,09 B\n").reconciles); // no total printed
    }

    #[test]
    fn quantity_line_after_item_sets_quantity() {
        let r = ReceiptParser::parse("ALDI SÜD\nJOGHURT NATUR 1,98 B\n2 x 0,99\nSUMME 1,98\n");
        assert_eq!(r.items[0].quantity, 2);
        assert_eq!(r.items[0].line_total, Money::from_cents(198));
        assert!(r.reconciles);
    }

    #[test]
    fn ignores_discounts_payment_and_weight_lines() {
        let r = ReceiptParser::parse("KAUFLAND\nBANANEN 1,49 B\n0,812 kg x 1,84 EUR/kg\nRABATT -0,50\nEC-KARTE 5,00\nSUMME 1,49\n");
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.chain, Some(Chain::Kaufland));
    }

    #[test]
    fn garbage_in_gives_empty_receipt_not_a_panic() {
        let r = ReceiptParser::parse("");
        assert!(r.items.is_empty() && r.merchant.is_none() && !r.reconciles);
        let r = ReceiptParser::parse("%%%\n,,,\n1,2,3\n--\n");
        assert!(r.items.is_empty());
    }

    #[test]
    fn amount_parsing_is_strict() {
        assert_eq!(
            ReceiptParser::parse_amount("1,19"),
            Some(Money::from_cents(119))
        );
        assert_eq!(
            ReceiptParser::parse_amount("1,19B"),
            Some(Money::from_cents(119))
        );
        assert_eq!(
            ReceiptParser::parse_amount("1.234,50"),
            Some(Money::from_cents(123_450))
        );
        assert_eq!(ReceiptParser::parse_amount("500G"), None);
        assert_eq!(ReceiptParser::parse_amount("3,5%"), None);
        assert_eq!(ReceiptParser::parse_amount("1,5"), None);
    }
}
