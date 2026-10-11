//! Money as integer cents. No floating point anywhere in the domain.

use std::fmt;
use std::iter::Sum;
use std::ops::{Add, AddAssign, Neg, Sub, SubAssign};

use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Money(i64);

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ParseMoneyError {
    #[error("empty amount")]
    Empty,
    #[error("invalid amount: {0:?}")]
    Invalid(String),
    #[error("more than two decimal places: {0:?}")]
    TooPrecise(String),
}

impl Money {
    pub const ZERO: Money = Money(0);

    pub const fn from_cents(cents: i64) -> Self {
        Money(cents)
    }

    pub const fn cents(self) -> i64 {
        self.0
    }

    pub const fn abs(self) -> Money {
        Money(self.0.abs())
    }

    pub const fn is_negative(self) -> bool {
        self.0 < 0
    }

    /// Multiply by a whole quantity.
    pub const fn times(self, quantity: u32) -> Money {
        Money(self.0 * quantity as i64)
    }

    /// Parse German (`1.234,56`) or plain (`1234.56`) notation, with optional sign and
    /// `EUR`/`€`. Without a comma, a dot followed by exactly three digits is a thousands
    /// separator (`1.234` is 1234 euros); otherwise it is a decimal point.
    pub fn parse(input: &str) -> Result<Money, ParseMoneyError> {
        let mut s = input.trim().to_string();
        if s.is_empty() {
            return Err(ParseMoneyError::Empty);
        }
        for token in ["EUR", "eur", "€"] {
            s = s.replace(token, "");
        }
        let s = s.trim();
        let (negative, digits) = match s.as_bytes().first() {
            Some(b'-') => (true, &s[1..]),
            Some(b'+') => (false, &s[1..]),
            _ => (false, s),
        };
        let digits = digits.trim();
        if digits.is_empty() {
            return Err(ParseMoneyError::Empty);
        }
        let invalid = || ParseMoneyError::Invalid(input.to_string());

        let normalized: String = if digits.contains(',') {
            if digits.matches(',').count() > 1 {
                return Err(invalid());
            }
            digits.replace('.', "").replace(',', ".")
        } else if let Some(pos) = digits.rfind('.') {
            let after = digits.len() - pos - 1;
            if after == 3 || digits.matches('.').count() > 1 {
                digits.replace('.', "")
            } else {
                digits.to_string()
            }
        } else {
            digits.to_string()
        };

        let (int_part, frac_part) = match normalized.split_once('.') {
            Some((i, f)) => (i, f),
            None => (normalized.as_str(), ""),
        };
        if int_part.is_empty() && frac_part.is_empty() {
            return Err(invalid());
        }
        if !int_part.chars().all(|c| c.is_ascii_digit())
            || !frac_part.chars().all(|c| c.is_ascii_digit())
        {
            return Err(invalid());
        }
        if frac_part.len() > 2 {
            return Err(ParseMoneyError::TooPrecise(input.to_string()));
        }
        let euros: i64 = if int_part.is_empty() {
            0
        } else {
            int_part.parse().map_err(|_| invalid())?
        };
        let mut cents: i64 = if frac_part.is_empty() {
            0
        } else {
            frac_part.parse().map_err(|_| invalid())?
        };
        if frac_part.len() == 1 {
            cents *= 10;
        }
        let total = euros
            .checked_mul(100)
            .and_then(|v| v.checked_add(cents))
            .ok_or_else(invalid)?;
        Ok(Money(if negative { -total } else { total }))
    }
}

impl fmt::Display for Money {
    /// German notation, e.g. `-1.234,56 €`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let abs = self.0.unsigned_abs();
        let euros = (abs / 100).to_string();
        let mut grouped = String::new();
        for (i, c) in euros.chars().enumerate() {
            if i > 0 && (euros.len() - i).is_multiple_of(3) {
                grouped.push('.');
            }
            grouped.push(c);
        }
        let sign = if self.0 < 0 { "-" } else { "" };
        write!(f, "{sign}{grouped},{:02} €", abs % 100)
    }
}

impl Add for Money {
    type Output = Money;
    fn add(self, rhs: Money) -> Money {
        Money(self.0 + rhs.0)
    }
}
impl Sub for Money {
    type Output = Money;
    fn sub(self, rhs: Money) -> Money {
        Money(self.0 - rhs.0)
    }
}
impl Neg for Money {
    type Output = Money;
    fn neg(self) -> Money {
        Money(-self.0)
    }
}
impl AddAssign for Money {
    fn add_assign(&mut self, rhs: Money) {
        self.0 += rhs.0;
    }
}
impl SubAssign for Money {
    fn sub_assign(&mut self, rhs: Money) {
        self.0 -= rhs.0;
    }
}
impl Sum for Money {
    fn sum<I: Iterator<Item = Money>>(iter: I) -> Money {
        iter.fold(Money::ZERO, |a, b| a + b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_german_and_plain_notation() {
        assert_eq!(Money::parse("23,47"), Ok(Money(2347)));
        assert_eq!(Money::parse("-23,47"), Ok(Money(-2347)));
        assert_eq!(Money::parse("1.234,56"), Ok(Money(123_456)));
        assert_eq!(Money::parse("1234.56"), Ok(Money(123_456)));
        assert_eq!(Money::parse("+5,5 €"), Ok(Money(550)));
        assert_eq!(Money::parse("12 EUR"), Ok(Money(1200)));
        assert_eq!(Money::parse("1.234"), Ok(Money(123_400)));
        assert_eq!(Money::parse("0,05"), Ok(Money(5)));
        assert_eq!(Money::parse(",5"), Ok(Money(50)));
    }

    #[test]
    fn rejects_bad_input() {
        assert_eq!(Money::parse(""), Err(ParseMoneyError::Empty));
        assert_eq!(Money::parse("-"), Err(ParseMoneyError::Empty));
        assert!(matches!(
            Money::parse("abc"),
            Err(ParseMoneyError::Invalid(_))
        ));
        assert!(matches!(
            Money::parse("1,2,3"),
            Err(ParseMoneyError::Invalid(_))
        ));
        assert!(matches!(
            Money::parse("1,234"),
            Err(ParseMoneyError::TooPrecise(_))
        ));
        assert!(matches!(
            Money::parse("99999999999999999999"),
            Err(ParseMoneyError::Invalid(_))
        ));
    }

    #[test]
    fn displays_in_german_notation() {
        assert_eq!(Money(123_456).to_string(), "1.234,56 €");
        assert_eq!(Money(-5).to_string(), "-0,05 €");
        assert_eq!(Money(100_000_000).to_string(), "1.000.000,00 €");
        assert_eq!(Money::ZERO.to_string(), "0,00 €");
    }

    #[test]
    fn arithmetic_and_sum() {
        let total: Money = [Money(100), Money(250), Money(-50)].into_iter().sum();
        assert_eq!(total, Money(300));
        assert_eq!(Money(250).times(3), Money(750));
        assert_eq!(-Money(5), Money(-5));
    }

    #[test]
    fn serializes_as_plain_integer() {
        assert_eq!(serde_json::to_string(&Money(1234)).unwrap(), "1234");
    }
}
