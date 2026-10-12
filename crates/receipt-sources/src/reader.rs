//! From receipt text (a PDF's text layer, a mail body, a Lidl Plus ticket) to a parsed receipt
//! ready to store: layout quirks of the digital receipts are smoothed out first, then the shared
//! parser reads the items, and the receipt gets a content fingerprint.

use financer_core::{Catalog, Chain, NameNormalizer};
use financer_receipts::{ParsedReceipt, ReceiptParser};
use time::Date;

use crate::brand::{brand_of, chain_key};
use crate::text::sha256_hex;

/// A receipt as read from a document, with what storing and de-duplicating it needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadReceipt {
    pub parsed: ParsedReceipt,
    /// Brand key (`rewe`, `lidl`, `edeka`, ...).
    pub retailer: Option<String>,
    /// `HH:MM` as printed.
    pub time: Option<String>,
    /// Hash of retailer, date, time, total and items: stable across layouts and delivery routes.
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReadError {
    #[error("no receipt items found")]
    NoItems,
    #[error("the lines do not add up to the printed total, so this is probably not a receipt")]
    DoesNotReconcile,
}

/// How sure we must be that a document is a receipt before importing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trust {
    /// A receipt document (PDF attachment, ticket from the retailer): items are enough.
    Document,
    /// Free text such as a mail body: the items must add up to the printed total, otherwise a
    /// newsletter with prices would be imported as a receipt.
    Body,
}

/// Reads receipt text.
pub struct ReceiptReader;

impl ReceiptReader {
    /// Smooth the layout quirks of digital receipts so the shared parser understands them:
    /// non-breaking spaces, `EUR` / `€` tokens, `2 Stk x 0,99` quantity lines, rule lines.
    pub fn normalize(text: &str) -> String {
        text.lines()
            .filter_map(|line| {
                let line = line.replace(['\u{a0}', '\t'], " ");
                let mut tokens: Vec<&str> = line
                    .split_whitespace()
                    .filter(|t| !t.eq_ignore_ascii_case("eur") && *t != "€")
                    .collect();
                if tokens.is_empty() || tokens.iter().all(|t| t.chars().all(|c| "-=_*.".contains(c)))
                {
                    return None;
                }
                // "2 Stk x 0,99" / "2 Stk. x 0,99" -> "2 x 0,99"
                if tokens.len() >= 4
                    && tokens[0].bytes().all(|b| b.is_ascii_digit())
                    && matches!(
                        tokens[1].to_lowercase().as_str(),
                        "stk" | "stk." | "st" | "st." | "stück"
                    )
                    && tokens[2].eq_ignore_ascii_case("x")
                {
                    tokens.remove(1);
                }
                Some(tokens.join(" "))
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// `HH:MM` of the purchase: on the line with the date or a line saying `Uhr`.
    fn time_of(text: &str) -> Option<String> {
        text.lines().find_map(|line| {
            let lower = line.to_lowercase();
            let has_date = line
                .split(|c: char| !(c.is_ascii_digit() || c == '.'))
                .any(|w| w.split('.').filter(|p| !p.is_empty()).count() == 3);
            if !(has_date || lower.contains("uhr")) {
                return None;
            }
            let b = line.as_bytes();
            let at = |i: usize| b.get(i).copied().unwrap_or(0);
            (0..b.len()).find_map(|i| {
                // HH:MM or H:MM, not preceded by a digit
                if i > 0 && at(i - 1).is_ascii_digit() {
                    return None;
                }
                let (h_len, rest) = if at(i).is_ascii_digit() && at(i + 1).is_ascii_digit() && at(i + 2) == b':' {
                    (2, i + 3)
                } else if at(i).is_ascii_digit() && at(i + 1) == b':' {
                    (1, i + 2)
                } else {
                    return None;
                };
                if !at(rest).is_ascii_digit() || !at(rest + 1).is_ascii_digit() {
                    return None;
                }
                let h: u32 = line[i..i + h_len].parse().ok()?;
                let m: u32 = line[rest..rest + 2].parse().ok()?;
                (h < 24 && m < 60).then(|| format!("{h:02}:{m:02}"))
            })
        })
    }

    /// Read `text`. `hint` is the retailer the sender or source says it is (used when the text
    /// itself does not name one); `fallback_date` is used when no date is printed.
    pub fn read(
        text: &str,
        hint: Option<&str>,
        fallback_date: Option<Date>,
        trust: Trust,
    ) -> Result<ReadReceipt, ReadError> {
        let text = Self::normalize(text);
        let mut parsed = ReceiptParser::parse(&text);
        if parsed.items.is_empty() {
            return Err(ReadError::NoItems);
        }
        if trust == Trust::Body && !parsed.reconciles {
            return Err(ReadError::DoesNotReconcile);
        }

        // the retailer: the parser looked at the first line only
        let head: Vec<&str> = text.lines().take(14).collect();
        let named = head.iter().find(|l| brand_of(l).is_some()).copied();
        let mut retailer = parsed
            .merchant
            .as_deref()
            .and_then(brand_of)
            .or_else(|| named.and_then(brand_of))
            .or_else(|| hint.filter(|h| *h != "auto").map(crate::brand::normalize_brand));
        if parsed.chain.is_none() {
            parsed.chain = retailer.as_deref().and_then(Chain::from_name);
        }
        if parsed.merchant.as_deref().and_then(brand_of).is_none() {
            if let Some(line) = named {
                parsed.merchant = Some(line.to_string());
            } else if let Some(h) = retailer.as_deref() {
                parsed.merchant = Some(h.to_string());
            }
        }
        if let Some(c) = parsed.chain {
            retailer = Some(chain_key(c).to_string());
        }
        if parsed.date.is_none() {
            parsed.date = fallback_date;
        }
        // recognise catalog items again for lines the parser could not match
        for it in &mut parsed.items {
            if it.item.is_none() {
                it.item = Catalog::match_product(&it.text).map(|i| i.key.to_string());
            }
        }
        let time = Self::time_of(&text);
        let fingerprint = Self::fingerprint(&parsed, retailer.as_deref(), time.as_deref());
        Ok(ReadReceipt {
            parsed,
            retailer,
            time,
            fingerprint,
        })
    }

    /// Identity of a purchase. Names are normalised, so a different line wrap or letter case in
    /// another copy of the same receipt still gives the same fingerprint.
    pub fn fingerprint(parsed: &ParsedReceipt, retailer: Option<&str>, time: Option<&str>) -> String {
        let items: Vec<String> = parsed
            .items
            .iter()
            .map(|i| {
                format!(
                    "{}:{}:{}",
                    NameNormalizer::normalize(&i.text),
                    i.quantity,
                    i.line_total.cents()
                )
            })
            .collect();
        sha256_hex(
            format!(
                "receipt-v1|{}|{}|{}|{}|{}",
                retailer.unwrap_or("-"),
                parsed.date.map_or("-".into(), |d| d.to_string()),
                time.unwrap_or("-"),
                parsed.total.map_or("-".into(), |t| t.cents().to_string()),
                items.join("|")
            )
            .as_bytes(),
        )
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    /// Text layer of a REWE eBon as a PDF reader returns it (layout written by hand, see
    /// docs/RECEIPT_SOURCES.md on what is and is not verified against real eBons).
    pub const REWE_EBON: &str = "\
REWE Markt GmbH
Musterstr. 1
50667 Köln
UID Nr.: DE812706034
EUR
BIO VOLLMILCH 3,5% 1,19 B
SPAGHETTI 500G 0,89 A
BANANEN 1,49 B
EIER BODENHALTUNG 10ER 2,29 B
JOGHURT NATUR
2 Stk x 0,99 1,98 B
-------------------------------------
SUMME EUR 7,84
Geg. Visa EUR 7,84
Datum: 02.03.2026
Uhrzeit: 18:42:07 Uhr
Bon-Nr. 1234
Vielen Dank für Ihren Einkauf!";

    /// The text of a Lidl Plus ticket as the app prints it.
    pub const LIDL_PLUS: &str = "\
Lidl Dienstleistung GmbH & Co. KG
Musterweg 5, 50667 Köln
Vollmilch 3,5% 1,09 B
Butter 2,19 B
Bio Bananen 1,49 A
Rabatt Coupon -0,30
Summe EUR 4,47
02.03.2026 18:42";
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use financer_core::Money;
    use time::macros::date;

    #[test]
    fn reads_a_rewe_ebon() {
        let r = ReceiptReader::read(REWE_EBON, Some("rewe"), None, Trust::Document).unwrap();
        assert_eq!(r.retailer.as_deref(), Some("rewe"));
        assert_eq!(r.parsed.chain, Some(Chain::Rewe));
        assert_eq!(r.parsed.date, Some(date!(2026 - 03 - 02)));
        assert_eq!(r.time.as_deref(), Some("18:42"));
        assert_eq!(r.parsed.total, Some(Money::from_cents(784)));
        assert_eq!(r.parsed.items.len(), 5);
        assert_eq!(r.parsed.items[4].quantity, 2);
        assert_eq!(r.parsed.items[4].line_total, Money::from_cents(198));
        assert!(r.parsed.reconciles);
        assert_eq!(r.parsed.items[0].item.as_deref(), Some("milch"));
    }

    #[test]
    fn reads_a_lidl_plus_ticket_text() {
        let r = ReceiptReader::read(LIDL_PLUS, None, None, Trust::Document).unwrap();
        assert_eq!(r.retailer.as_deref(), Some("lidl"));
        assert_eq!(r.time.as_deref(), Some("18:42"));
        assert_eq!(r.parsed.items.len(), 3);
        assert_eq!(r.parsed.total, Some(Money::from_cents(447)));
    }

    #[test]
    fn retailer_comes_from_the_text_then_from_the_hint() {
        // the first line is not the merchant, a later header line is
        let t = "Ihr digitaler Kassenbon\nREWE Markt GmbH\nMILCH 1,09 B\nSUMME 1,09";
        let r = ReceiptReader::read(t, Some("lidl"), None, Trust::Document).unwrap();
        assert_eq!(r.retailer.as_deref(), Some("rewe"));
        assert_eq!(r.parsed.merchant.as_deref(), Some("REWE Markt GmbH"));
        // no brand in the text: the sender's rule decides, "auto" decides nothing
        let t = "Kassenbon\nMILCH 1,09 B\nSUMME 1,09";
        let r = ReceiptReader::read(t, Some("edeka"), None, Trust::Document).unwrap();
        assert_eq!(r.retailer.as_deref(), Some("edeka"));
        let r = ReceiptReader::read(t, Some("auto"), None, Trust::Document).unwrap();
        assert_eq!(r.retailer, None);
    }

    #[test]
    fn fallback_date_only_fills_a_missing_date() {
        let t = "REWE\nMILCH 1,09 B\nSUMME 1,09";
        let r = ReceiptReader::read(t, None, Some(date!(2026 - 05 - 06)), Trust::Document).unwrap();
        assert_eq!(r.parsed.date, Some(date!(2026 - 05 - 06)));
        let r = ReceiptReader::read(REWE_EBON, None, Some(date!(2026 - 05 - 06)), Trust::Document)
            .unwrap();
        assert_eq!(r.parsed.date, Some(date!(2026 - 03 - 02)));
    }

    #[test]
    fn body_text_must_reconcile_but_documents_need_not() {
        let newsletter = "REWE Angebote\nButter 1,99 B\nKäse 2,49 B\nSUMME 9,99";
        assert_eq!(
            ReceiptReader::read(newsletter, None, None, Trust::Body),
            Err(ReadError::DoesNotReconcile)
        );
        assert!(ReceiptReader::read(newsletter, None, None, Trust::Document).is_ok());
        assert_eq!(
            ReceiptReader::read("Hallo\nviele Grüße", None, None, Trust::Document),
            Err(ReadError::NoItems)
        );
    }

    #[test]
    fn fingerprint_ignores_layout_but_not_content() {
        let a = ReceiptReader::read(REWE_EBON, None, None, Trust::Document).unwrap();
        let reflowed = REWE_EBON
            .replace("BANANEN 1,49 B", "bananen   1,49   B")
            .replace(" EUR", "");
        let b = ReceiptReader::read(&reflowed, None, None, Trust::Document).unwrap();
        assert_eq!(a.fingerprint, b.fingerprint);
        let other = REWE_EBON.replace("1,49 B", "1,59 B");
        let c = ReceiptReader::read(&other, None, None, Trust::Document).unwrap();
        assert_ne!(a.fingerprint, c.fingerprint);
        let later = REWE_EBON.replace("18:42:07", "19:01:00");
        let d = ReceiptReader::read(&later, None, None, Trust::Document).unwrap();
        assert_ne!(a.fingerprint, d.fingerprint);
    }

    #[test]
    fn times_are_taken_from_date_or_uhr_lines_only() {
        assert_eq!(ReceiptReader::time_of("02.03.26 8:05 Bon-Nr. 1234").as_deref(), Some("08:05"));
        assert_eq!(ReceiptReader::time_of("Uhrzeit: 18:42:07 Uhr").as_deref(), Some("18:42"));
        assert_eq!(ReceiptReader::time_of("Bon-Nr. 12:34"), None);
        assert_eq!(ReceiptReader::time_of("02.03.2026 25:99"), None);
        assert_eq!(ReceiptReader::time_of("Datum 02.03.2026"), None);
    }

    #[test]
    fn normalize_handles_quantity_lines_and_rules() {
        let n = ReceiptReader::normalize("A 1,00 EUR B\n-----\n3 Stk. x 0,50 EUR 1,50 B\n\n  ");
        assert_eq!(n, "A 1,00 B\n3 x 0,50 1,50 B");
    }
}
