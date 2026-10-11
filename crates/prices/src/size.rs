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

fn multipack() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(\d{1,3})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b").expect("valid regex")
    })
}

fn single() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|stk|stück|st)\b\.?").expect("valid regex")
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

pub fn parse_pack_size(text: &str) -> Option<PackSize> {
    let t = text.to_lowercase();

    if let Some(c) = multipack().captures(&t) {
        let count: u64 = c[1].parse().ok()?;
        let each = with_unit(milli_of(&c[2])?, &c[3])?;
        return Some(PackSize {
            unit: each.unit,
            milli: each.milli.checked_mul(count)?,
        });
    }
    if let Some(c) = single().captures(&t) {
        // Piece counts are written as whole numbers, so "10 Stück" is 10 pieces (10000 milli)
        return with_unit(milli_of(&c[1])?, &c[2]);
    }
    if let Some(c) = pieces().captures(&t) {
        let n: u64 = c[1].parse().ok()?;
        return (n > 0).then_some(PackSize {
            unit: Unit::Piece,
            milli: n * 1000,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Option<(Unit, u64)> {
        parse_pack_size(s).map(|p| (p.unit, p.milli))
    }

    #[test]
    fn weights_and_volumes() {
        assert_eq!(p("Spaghetti 500 g"), Some((Unit::Kilogram, 500)));
        assert_eq!(p("Mehl 1kg"), Some((Unit::Kilogram, 1000)));
        assert_eq!(p("Vollmilch 3,5% 1 l"), Some((Unit::Liter, 1000)));
        assert_eq!(p("Wasser 1,5l"), Some((Unit::Liter, 1500)));
        assert_eq!(p("Saft 750ml"), Some((Unit::Liter, 750)));
        assert_eq!(p("Sahne 200 ml"), Some((Unit::Liter, 200)));
        assert_eq!(p("Kokosmilch 40cl"), Some((Unit::Liter, 400)));
        assert_eq!(p("Butter 250g"), Some((Unit::Kilogram, 250)));
    }

    #[test]
    fn multipacks_and_pieces() {
        assert_eq!(p("Mineralwasser 6 x 1,5 l"), Some((Unit::Liter, 9000)));
        assert_eq!(p("Joghurt 4x150g"), Some((Unit::Kilogram, 600)));
        assert_eq!(p("Eier Bodenhaltung 10er"), Some((Unit::Piece, 10_000)));
        assert_eq!(p("Eier 6 Stück"), Some((Unit::Piece, 6_000)));
        assert_eq!(p("Brötchen 4 Stk."), Some((Unit::Piece, 4_000)));
    }

    #[test]
    fn no_size_means_none() {
        assert_eq!(p("Bananen"), None);
        assert_eq!(p("Playstation 5"), None);
        assert_eq!(p(""), None);
        assert_eq!(p("0 g"), None);
        // "3,5%" must not be read as a size
        assert_eq!(p("Milch 3,5%"), None);
    }

    #[test]
    fn decimals_without_floats() {
        assert_eq!(milli_of("1,5"), Some(1500));
        assert_eq!(milli_of("0.25"), Some(250));
        assert_eq!(milli_of("2"), Some(2000));
        assert_eq!(milli_of("0,0005"), Some(0));
        assert_eq!(milli_of("x"), None);
    }
}
