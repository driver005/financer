//! Barcodes (EAN-8, EAN-13, UPC-A) with their check digit.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EanKind {
    Ean8,
    /// 12 digits; the same product is `0` + the 12 digits as EAN-13.
    UpcA,
    Ean13,
}

impl EanKind {
    /// `ean8`, `upc_a` or `ean13`.
    pub fn as_str(&self) -> &'static str {
        match self {
            EanKind::Ean8 => "ean8",
            EanKind::UpcA => "upc_a",
            EanKind::Ean13 => "ean13",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum EanError {
    #[error("a barcode has digits only")]
    NotDigits,
    #[error("a barcode has 8, 12 or 13 digits, this one has {0}")]
    BadLength(usize),
    #[error("the check digit does not match; the number was probably misread or mistyped")]
    BadChecksum,
}

/// A barcode whose length and check digit are valid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ean {
    digits: String,
    kind: EanKind,
}

impl Ean {
    /// Parse text as typed or scanned: surrounding whitespace, inner spaces and hyphens are
    /// ignored; everything else must be an ASCII digit.
    pub fn parse(input: &str) -> Result<Ean, EanError> {
        let digits: String = input
            .trim()
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .collect();
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            return Err(EanError::NotDigits);
        }
        let kind = match digits.len() {
            8 => EanKind::Ean8,
            12 => EanKind::UpcA,
            13 => EanKind::Ean13,
            n => return Err(EanError::BadLength(n)),
        };
        if !Self::checksum_ok(&digits) {
            return Err(EanError::BadChecksum);
        }
        Ok(Ean { digits, kind })
    }

    /// All three formats share one rule: counted from the right, the check digit has weight 1,
    /// the digit before it 3, the next 1, and so on; the total must be a multiple of 10.
    fn checksum_ok(digits: &str) -> bool {
        let sum: u32 = digits
            .bytes()
            .rev()
            .enumerate()
            .map(|(i, b)| u32::from(b - b'0') * if i % 2 == 1 { 3 } else { 1 })
            .sum();
        sum.is_multiple_of(10)
    }

    pub fn kind(&self) -> EanKind {
        self.kind
    }

    /// The digits as scanned.
    pub fn as_str(&self) -> &str {
        &self.digits
    }

    /// The form Open Prices and Open Food Facts use: UPC-A gets a leading `0` (so it equals the
    /// EAN-13 of the same product); EAN-8 and EAN-13 stay as they are.
    pub fn canonical(&self) -> String {
        match self.kind {
            EanKind::UpcA => format!("0{}", self.digits),
            _ => self.digits.clone(),
        }
    }

    /// True when `other` (a configured barcode, possibly sloppy) is the same product.
    pub fn is_same_product(&self, other: &str) -> bool {
        match Ean::parse(other) {
            Ok(o) => o.canonical() == self.canonical(),
            Err(_) => other.trim() == self.digits,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_three_formats() {
        let ean13 = Ean::parse("4006381333931").unwrap();
        assert_eq!(ean13.kind(), EanKind::Ean13);
        let ean8 = Ean::parse("73513537").unwrap();
        assert_eq!(ean8.kind(), EanKind::Ean8);
        let upc = Ean::parse("036000291452").unwrap();
        assert_eq!(upc.kind(), EanKind::UpcA);
        assert_eq!(upc.canonical(), "0036000291452");
        assert_eq!(ean13.canonical(), "4006381333931");
        assert_eq!(ean8.canonical(), "73513537");
    }

    #[test]
    fn ignores_whitespace_and_hyphens() {
        let e = Ean::parse(" 4006381 333931\n").unwrap();
        assert_eq!(e.as_str(), "4006381333931");
        assert!(Ean::parse("4-006381-333931").is_ok());
    }

    #[test]
    fn a_wrong_check_digit_is_rejected() {
        assert_eq!(Ean::parse("4006381333932"), Err(EanError::BadChecksum));
        assert_eq!(Ean::parse("73513538"), Err(EanError::BadChecksum));
        assert_eq!(Ean::parse("036000291453"), Err(EanError::BadChecksum));
        // swapping two digits is caught as well
        assert_eq!(Ean::parse("4006381333391"), Err(EanError::BadChecksum));
    }

    #[test]
    fn wrong_lengths_and_characters_are_rejected() {
        assert_eq!(Ean::parse(""), Err(EanError::NotDigits));
        assert_eq!(Ean::parse("   "), Err(EanError::NotDigits));
        assert_eq!(Ean::parse("40063813339A1"), Err(EanError::NotDigits));
        assert_eq!(Ean::parse("-"), Err(EanError::NotDigits));
        assert_eq!(Ean::parse("1234567"), Err(EanError::BadLength(7)));
        assert_eq!(Ean::parse("12345678901"), Err(EanError::BadLength(11)));
        // GTIN-14 is not a shelf barcode
        assert_eq!(Ean::parse("14006381333938"), Err(EanError::BadLength(14)));
        // digits beyond ASCII (Arabic-Indic here) are not accepted
        assert_eq!(
            Ean::parse("\u{664}\u{660}\u{660}\u{666}\u{663}\u{668}\u{661}\u{663}"),
            Err(EanError::NotDigits)
        );
    }

    #[test]
    fn upc_a_and_ean13_with_leading_zero_are_the_same_product() {
        let upc = Ean::parse("036000291452").unwrap();
        assert!(upc.is_same_product("0036000291452"));
        assert!(upc.is_same_product(" 036000291452 "));
        assert!(!upc.is_same_product("4006381333931"));
        let ean13 = Ean::parse("0036000291452").unwrap();
        assert!(ean13.is_same_product("036000291452"));
    }

    #[test]
    fn known_codes() {
        assert!(Ean::parse("00000000").is_ok());
        assert!(Ean::parse("5449000000996").is_ok());
        assert!(Ean::parse("3017620422003").is_ok());
        assert!(Ean::parse("4001686301563").is_err());
    }
}
