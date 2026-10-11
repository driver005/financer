//! Import of the Sparkasse online-banking CSV export ("CSV-CAMT-Format").
//!
//! The export is semicolon separated, uses German dates (`02.03.26` or `02.03.2026`) and
//! amounts (`-23,47`), and is UTF-8 or ISO-8859-1 depending on how it was saved. Columns
//! are looked up by header name, not position, so extra or reordered columns are fine.

use financer_core::{Money, Transaction};
use time::{Date, Month};

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("not a Sparkasse CSV export: missing column {0:?}")]
    MissingColumn(&'static str),
    #[error("could not read CSV: {0}")]
    Csv(#[from] csv::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedRow {
    /// 1-based line number in the file (the header is line 1).
    pub line: u64,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct ImportResult {
    pub transactions: Vec<Transaction>,
    pub skipped: Vec<SkippedRow>,
}

/// Parser for the Sparkasse CSV export.
pub struct SparkasseCsv;

impl SparkasseCsv {
    fn decode(bytes: &[u8]) -> String {
        let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
        match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            // ISO-8859-1 maps bytes 1:1 onto the first 256 Unicode code points
            Err(_) => bytes.iter().map(|&b| b as char).collect(),
        }
    }

    fn header_key(name: &str) -> String {
        let mut out = String::new();
        for c in name.chars().flat_map(|c| c.to_lowercase()) {
            match c {
                'ä' => out.push_str("ae"),
                'ö' => out.push_str("oe"),
                'ü' => out.push_str("ue"),
                'ß' => out.push_str("ss"),
                c if c.is_alphanumeric() => out.push(c),
                _ => {}
            }
        }
        out
    }

    fn parse_date(s: &str) -> Option<Date> {
        let mut parts = s.trim().split('.');
        let day: u8 = parts.next()?.parse().ok()?;
        let month: u8 = parts.next()?.parse().ok()?;
        let year_str = parts.next()?;
        if parts.next().is_some() {
            return None;
        }
        let year: i32 = year_str.parse().ok()?;
        let year = if year_str.len() == 2 {
            2000 + year
        } else {
            year
        };
        Date::from_calendar_date(year, Month::try_from(month).ok()?, day).ok()
    }

    pub fn parse(bytes: &[u8]) -> Result<ImportResult, ImportError> {
        let text = Self::decode(bytes);
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .flexible(true)
            .trim(csv::Trim::All)
            .from_reader(text.as_bytes());

        let headers: Vec<String> = reader.headers()?.iter().map(Self::header_key).collect();
        let col = |name: &'static str| -> Result<usize, ImportError> {
            headers
                .iter()
                .position(|h| h == name)
                .ok_or(ImportError::MissingColumn(name))
        };
        let date_col = col("buchungstag")?;
        let amount_col = col("betrag")?;
        let purpose_col = col("verwendungszweck")?;
        let who_col = col("beguenstigterzahlungspflichtiger")?;
        let iban_col = col("kontonummeriban")?;

        let mut result = ImportResult::default();
        for record in reader.records() {
            let record = record?;
            let line = record.position().map(|p| p.line()).unwrap_or(0);
            let get = |i: usize| record.get(i).unwrap_or("").to_string();

            let Some(booking_date) = Self::parse_date(&get(date_col)) else {
                result.skipped.push(SkippedRow {
                    line,
                    reason: format!("bad booking date {:?}", get(date_col)),
                });
                continue;
            };
            let amount = match Money::parse(&get(amount_col)) {
                Ok(a) => a,
                Err(e) => {
                    result.skipped.push(SkippedRow {
                        line,
                        reason: e.to_string(),
                    });
                    continue;
                }
            };
            let iban = get(iban_col);
            result.transactions.push(Transaction {
                booking_date,
                amount,
                counterparty: get(who_col),
                purpose: get(purpose_col),
                counterparty_iban: (!iban.is_empty()).then_some(iban),
                category: None,
            });
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    const SAMPLE: &str = "\"Auftragskonto\";\"Buchungstag\";\"Valutadatum\";\"Buchungstext\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"BIC (SWIFT-Code)\";\"Betrag\";\"Waehrung\";\"Info\"\n\
\"DE89370400440532013000\";\"02.03.26\";\"02.03.26\";\"KARTENZAHLUNG\";\"REWE SAGT DANKE\";\"REWE Markt GmbH\";\"\";\"\";\"-23,47\";\"EUR\";\"Umsatz gebucht\"\n\
\"DE89370400440532013000\";\"28.03.2026\";\"28.03.2026\";\"GEHALT\";\"Gehalt 03/2026\";\"Arbeitgeber AG\";\"DE02120300000000202051\";\"BYLADEM1001\";\"2.500,00\";\"EUR\";\"Umsatz gebucht\"\n\
\"DE89370400440532013000\";\"xx\";\"\";\"\";\"kaputt\";\"?\";\"\";\"\";\"1,00\";\"EUR\";\"\"\n";

    #[test]
    fn imports_rows_and_reports_bad_ones() {
        let r = SparkasseCsv::parse(SAMPLE.as_bytes()).unwrap();
        assert_eq!(r.transactions.len(), 2);
        assert_eq!(r.skipped.len(), 1);
        assert_eq!(r.skipped[0].line, 4);

        let rewe = &r.transactions[0];
        assert_eq!(rewe.booking_date, date!(2026 - 03 - 02));
        assert_eq!(rewe.amount, Money::from_cents(-2347));
        assert_eq!(rewe.counterparty, "REWE Markt GmbH");
        assert_eq!(rewe.counterparty_iban, None);

        let salary = &r.transactions[1];
        assert_eq!(salary.booking_date, date!(2026 - 03 - 28));
        assert_eq!(salary.amount, Money::from_cents(250_000));
        assert_eq!(
            salary.counterparty_iban.as_deref(),
            Some("DE02120300000000202051")
        );
    }

    #[test]
    fn reads_latin1_and_umlaut_headers() {
        let text = "Buchungstag;Verwendungszweck;Begünstigter/Zahlungspflichtiger;Kontonummer/IBAN;Betrag\n\
02.03.26;Käse;Bäckerei Müller;;-3,50\n";
        let latin1: Vec<u8> = text.chars().map(|c| c as u32 as u8).collect();
        assert!(std::str::from_utf8(&latin1).is_err());
        let r = SparkasseCsv::parse(&latin1).unwrap();
        assert_eq!(r.transactions[0].counterparty, "Bäckerei Müller");
        assert_eq!(r.transactions[0].purpose, "Käse");
    }

    #[test]
    fn strips_utf8_bom() {
        let mut bytes = b"\xEF\xBB\xBF".to_vec();
        bytes.extend_from_slice(SAMPLE.as_bytes());
        assert_eq!(SparkasseCsv::parse(&bytes).unwrap().transactions.len(), 2);
    }

    #[test]
    fn rejects_other_csv_files() {
        let err = SparkasseCsv::parse(b"a;b;c\n1;2;3\n").unwrap_err();
        assert!(matches!(err, ImportError::MissingColumn("buchungstag")));
    }

    #[test]
    fn parses_two_and_four_digit_years() {
        assert_eq!(
            SparkasseCsv::parse_date("01.02.26"),
            Some(date!(2026 - 02 - 01))
        );
        assert_eq!(
            SparkasseCsv::parse_date("01.02.2026"),
            Some(date!(2026 - 02 - 01))
        );
        assert_eq!(SparkasseCsv::parse_date("31.02.2026"), None);
        assert_eq!(SparkasseCsv::parse_date("1.2"), None);
    }
}
