//! Pack sizes from product titles: `500 g`, `1,5 l`, `6 x 1,5 l`, `10er`, `10 Stück`.

use financer_core::Unit;
use regex::Regex;
use std::sync::OnceLock;

/// An amount in thousandths of the base unit (kg, l or piece).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PackSize {
    pub unit: Unit,
    pub milli: u64,
}

impl PackSize {
    fn multipack() -> &'static Regex {
        static R: OnceLock<Regex> = OnceLock::new();
        R.get_or_init(|| {
            Regex::new(r"(\d{1,3})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b")
                .expect("valid regex")
        })
    }

    fn single() -> &'static Regex {
        static R: OnceLock<Regex> = OnceLock::new();
        R.get_or_init(|| {
            Regex::new(r"(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|stk|stück|st)\b\.?")
                .expect("valid regex")
        })
    }

    fn pieces() -> &'static Regex {
        static R: OnceLock<Regex> = OnceLock::new();
        R.get_or_init(|| Regex::new(r"\b(\d{1,3})\s*er\b").expect("valid regex"))
    }

    /// `1,5` or `1.5` -> 1500 (thousandths), no floating point.
    fn milli_of(number: &str) -> Option<u64> {
        let n = number.replace(',', ".");
        let (int, frac) = n.split_once('.').unwrap_or((n.as_str(), ""));
        let frac: String = frac.chars().take(3).collect();
        let int: u64 = int.parse().ok()?;
        let frac_milli: u64 = format!("{frac:0<3}").parse().ok()?;
        int.checked_mul(1000)?.checked_add(frac_milli)
    }

    fn with_unit(milli: u64, unit: &str) -> Option<PackSize> {
        // milli is in thousandths of the written unit; convert to thousandths of the base unit
        let (unit, num, den) = match unit {
            "kg" => (Unit::Kilogram, 1, 1),
            "g" => (Unit::Kilogram, 1, 1000),
            "l" => (Unit::Liter, 1, 1),
            "ml" => (Unit::Liter, 1, 1000),
            "cl" => (Unit::Liter, 1, 100),
            "stk" | "stück" | "st" => (Unit::Piece, 1, 1),
            _ => return None,
        };
        let milli = milli.checked_mul(num)? / den;
        (milli > 0).then_some(PackSize { unit, milli })
    }

    /// What a whole kg or l costs when this pack costs `price` cents, rounded to the cent.
    /// `None` for pieces, which have no unit price.
    pub fn unit_price_cents(&self, price_cents: i64) -> Option<i64> {
        Self::per_kg_or_l(self.unit, self.milli, price_cents)
    }

    /// Cents per kg/l for `price_cents` paid for `milli` thousandths of a kg/l.
    pub fn per_kg_or_l(unit: Unit, milli: u64, price_cents: i64) -> Option<i64> {
        if unit == Unit::Piece || milli == 0 || price_cents < 0 {
            return None;
        }
        let milli = i128::from(milli);
        let cents = (i128::from(price_cents) * 1000 * 2 + milli) / (milli * 2);
        i64::try_from(cents).ok()
    }

    pub fn parse(text: &str) -> Option<PackSize> {
        let t = text.to_lowercase();

        if let Some(c) = Self::multipack().captures(&t) {
            let count: u64 = c[1].parse().ok()?;
            let each = Self::with_unit(Self::milli_of(&c[2])?, &c[3])?;
            return Some(PackSize {
                unit: each.unit,
                milli: each.milli.checked_mul(count)?,
            });
        }
        if let Some(c) = Self::single().captures(&t) {
            // Piece counts are written as whole numbers, so "10 Stück" is 10 pieces (10000 milli)
            return Self::with_unit(Self::milli_of(&c[1])?, &c[2]);
        }
        if let Some(c) = Self::pieces().captures(&t) {
            let n: u64 = c[1].parse().ok()?;
            return (n > 0).then_some(PackSize {
                unit: Unit::Piece,
                milli: n * 1000,
            });
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Sizes;

    impl Sizes {
        fn p(s: &str) -> Option<(Unit, u64)> {
            PackSize::parse(s).map(|p| (p.unit, p.milli))
        }
    }

    #[test]
    fn weights_and_volumes() {
        assert_eq!(Sizes::p("Spaghetti 500 g"), Some((Unit::Kilogram, 500)));
        assert_eq!(Sizes::p("Mehl 1kg"), Some((Unit::Kilogram, 1000)));
        assert_eq!(Sizes::p("Vollmilch 3,5% 1 l"), Some((Unit::Liter, 1000)));
        assert_eq!(Sizes::p("Wasser 1,5l"), Some((Unit::Liter, 1500)));
        assert_eq!(Sizes::p("Saft 750ml"), Some((Unit::Liter, 750)));
        assert_eq!(Sizes::p("Sahne 200 ml"), Some((Unit::Liter, 200)));
        assert_eq!(Sizes::p("Kokosmilch 40cl"), Some((Unit::Liter, 400)));
        assert_eq!(Sizes::p("Butter 250g"), Some((Unit::Kilogram, 250)));
    }

    #[test]
    fn multipacks_and_pieces() {
        assert_eq!(
            Sizes::p("Mineralwasser 6 x 1,5 l"),
            Some((Unit::Liter, 9000))
        );
        assert_eq!(Sizes::p("Joghurt 4x150g"), Some((Unit::Kilogram, 600)));
        assert_eq!(
            Sizes::p("Eier Bodenhaltung 10er"),
            Some((Unit::Piece, 10_000))
        );
        assert_eq!(Sizes::p("Eier 6 Stück"), Some((Unit::Piece, 6_000)));
        assert_eq!(Sizes::p("Brötchen 4 Stk."), Some((Unit::Piece, 4_000)));
    }

    #[test]
    fn no_size_means_none() {
        assert_eq!(Sizes::p("Bananen"), None);
        assert_eq!(Sizes::p("Playstation 5"), None);
        assert_eq!(Sizes::p(""), None);
        assert_eq!(Sizes::p("0 g"), None);
        // "3,5%" must not be read as a size
        assert_eq!(Sizes::p("Milch 3,5%"), None);
    }

    #[test]
    fn unit_prices() {
        let pack = |t: &str| PackSize::parse(t).unwrap();
        assert_eq!(pack("500 g").unit_price_cents(129), Some(258));
        assert_eq!(pack("1,5 l").unit_price_cents(89), Some(59)); // 59.33
        assert_eq!(pack("750 ml").unit_price_cents(199), Some(265)); // 265.33
        assert_eq!(pack("6 x 1,5 l").unit_price_cents(450), Some(50));
        assert_eq!(pack("10er").unit_price_cents(199), None);
        assert_eq!(pack("1 kg").unit_price_cents(-1), None);
    }

    #[test]
    fn decimals_without_floats() {
        assert_eq!(PackSize::milli_of("1,5"), Some(1500));
        assert_eq!(PackSize::milli_of("0.25"), Some(250));
        assert_eq!(PackSize::milli_of("2"), Some(2000));
        assert_eq!(PackSize::milli_of("0,0005"), Some(0));
        assert_eq!(PackSize::milli_of("x"), None);
    }
}
