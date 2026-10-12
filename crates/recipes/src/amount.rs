//! Free-text ingredient amounts ("250 g", "2 EL", "1/2 Dose", "nach Geschmack") and their
//! conversion to the base unit of a catalog item, so amounts from different recipes can be added
//! up. All arithmetic is integer: quantities are thousandths of the unit.

use financer_core::{Catalog, GenericItem, Unit};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AmountUnit {
    Gram,
    Kilogram,
    Milliliter,
    Liter,
    Tablespoon,
    Teaspoon,
    Pinch,
    /// A plain count ("2") or "Stück".
    Piece,
    Clove,
    Slice,
    Stalk,
    Can,
    Bunch,
    Pack,
    /// "nach Geschmack": no amount, but the ingredient is still needed.
    ToTaste,
}

impl AmountUnit {
    fn from_word(rest: &str) -> AmountUnit {
        let word = rest
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_lowercase();
        match word.as_str() {
            "g" | "gr" | "gramm" => AmountUnit::Gram,
            "kg" | "kilo" => AmountUnit::Kilogram,
            "ml" => AmountUnit::Milliliter,
            "l" | "liter" => AmountUnit::Liter,
            "el" | "essl" | "esslöffel" => AmountUnit::Tablespoon,
            "tl" | "teelöffel" => AmountUnit::Teaspoon,
            "prise" | "prisen" => AmountUnit::Pinch,
            "zehe" | "zehen" => AmountUnit::Clove,
            "scheibe" | "scheiben" => AmountUnit::Slice,
            "stange" | "stangen" => AmountUnit::Stalk,
            "dose" | "dosen" => AmountUnit::Can,
            "bund" | "bünde" => AmountUnit::Bunch,
            "packung" | "packungen" | "pkg" | "pck" | "päckchen" | "pack" => AmountUnit::Pack,
            // "Stück", "Stk", a plain number, or a word we do not know: count it as pieces
            _ => AmountUnit::Piece,
        }
    }
}

/// A parsed amount: `thousandths` of `unit` (`250 g` is 250 000 thousandths of grams).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Amount {
    pub thousandths: u64,
    pub unit: AmountUnit,
}

/// Reads the number at the start of an amount text.
struct NumberReader;

impl NumberReader {
    fn vulgar(c: char) -> Option<u64> {
        Some(match c {
            '½' => 500,
            '¼' => 250,
            '¾' => 750,
            '⅓' => 333,
            '⅔' => 667,
            _ => return None,
        })
    }

    fn digits(s: &str) -> (&str, &str) {
        let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
        s.split_at(end)
    }

    fn parse_int(digits: &str) -> Option<u64> {
        // more than 9 digits is not a recipe amount
        (!digits.is_empty() && digits.len() <= 9)
            .then(|| digits.parse().ok())
            .flatten()
    }

    /// A fraction without a whole part: `1/2` or `½`.
    fn fraction(s: &str) -> Option<(u64, &str)> {
        if let Some(c) = s.chars().next() {
            if let Some(v) = Self::vulgar(c) {
                return Some((v, &s[c.len_utf8()..]));
            }
        }
        let (num, rest) = Self::digits(s);
        let den_text = rest.strip_prefix('/')?;
        let (den, rest) = Self::digits(den_text);
        let (num, den) = (Self::parse_int(num)?, Self::parse_int(den)?);
        (den > 0).then(|| (num * 1000 / den, rest))
    }

    /// One number: `250`, `1,5`, `1.5`, `1/2`, `1 1/2`, `½`.
    fn one(s: &str) -> Option<(u64, &str)> {
        if let Some(f) = Self::fraction(s) {
            return Some(f);
        }
        let (whole_text, rest) = Self::digits(s);
        let whole = Self::parse_int(whole_text)?;
        if let Some(after) = rest.strip_prefix([',', '.']) {
            let (frac, rest) = Self::digits(after);
            if !frac.is_empty() {
                let kept: String = frac.chars().take(3).collect();
                let thousandths = Self::parse_int(&format!("{kept:0<3}"))?;
                return Some((whole * 1000 + thousandths, rest));
            }
        }
        if rest.starts_with(' ') {
            if let Some((frac, after)) = Self::fraction(rest.trim_start()) {
                return Some((whole * 1000 + frac, after));
            }
        }
        Some((whole * 1000, rest))
    }

    /// A number or a range (`2-3` counts as the upper bound, so the list is never short).
    fn take(s: &str) -> Option<(u64, &str)> {
        let (first, rest) = Self::one(s.trim_start())?;
        let after = rest.trim_start();
        if let Some(upper) = after.strip_prefix(['-', '–']) {
            if let Some((second, rest)) = Self::one(upper.trim_start()) {
                return Some((first.max(second), rest));
            }
        }
        Some((first, rest))
    }
}

impl Amount {
    /// Anything that does not start with a number ("nach Geschmack", "etwas") is `ToTaste`.
    pub fn parse(text: &str) -> Amount {
        match NumberReader::take(text) {
            Some((thousandths, rest)) => Amount {
                thousandths,
                unit: AmountUnit::from_word(rest),
            },
            None => Amount {
                thousandths: 1000,
                unit: AmountUnit::ToTaste,
            },
        }
    }

    /// Weight of one counted unit of `item` in grams, for items sold by weight or volume.
    fn grams_each(unit: AmountUnit, key: &str) -> u64 {
        match unit {
            AmountUnit::Slice => match key {
                "brot" => 40,
                "kaese-gouda" => 20,
                _ => 30,
            },
            AmountUnit::Stalk => 200,
            AmountUnit::Can => 400,
            AmountUnit::Bunch => 100,
            AmountUnit::Clove => 5,
            _ => match key {
                "zwiebeln" | "karotten" => 80,
                "aepfel" => 150,
                "bananen" => 120,
                "paprika" => 150,
                "zucchini" => 250,
                "champignons" => 20,
                "lauch" => 200,
                _ => 100,
            },
        }
    }

    /// Weight of one piece of `item` in grams, for items sold by the piece.
    fn piece_grams(key: &str) -> u64 {
        match key {
            "eier" => 60,
            "zitronen" => 100,
            "gurke" => 400,
            "knoblauch" => 50,
            "broetchen" => 60,
            "wuerstchen" => 100,
            "salat" => 300,
            "pizza-tk" => 350,
            "thunfisch" => 150,
            "kichererbsen" | "kidneybohnen" => 240,
            "mais" => 285,
            _ => 100,
        }
    }

    /// The amount in thousandths of the item's base unit (kg, l or piece). Weight and volume are
    /// treated alike (1 g is 1 ml), which is close enough for packs of groceries. A non-zero
    /// amount is never rounded down to zero.
    pub fn to_base_milli(&self, item: &GenericItem) -> u64 {
        let n = self.thousandths;
        let by_piece = item.unit == Unit::Piece;
        let value = match self.unit {
            AmountUnit::ToTaste => return 1,
            // weight, volume and spoons: first to thousandths of a gram
            AmountUnit::Gram
            | AmountUnit::Kilogram
            | AmountUnit::Milliliter
            | AmountUnit::Liter
            | AmountUnit::Tablespoon
            | AmountUnit::Teaspoon
            | AmountUnit::Pinch => {
                let grams_thousandths = match self.unit {
                    AmountUnit::Kilogram | AmountUnit::Liter => n * 1000,
                    AmountUnit::Tablespoon => n * 15,
                    AmountUnit::Teaspoon => n * 5,
                    AmountUnit::Pinch => n / 2,
                    _ => n,
                };
                if by_piece {
                    grams_thousandths.div_ceil(Self::piece_grams(item.key))
                } else {
                    grams_thousandths.div_ceil(1000)
                }
            }
            AmountUnit::Pack => n * u64::from(Catalog::reference_milli(item.key)) / 1000,
            // counted units
            unit => {
                if by_piece {
                    if unit == AmountUnit::Clove && item.key == "knoblauch" {
                        n / 10 // a bulb has about ten cloves
                    } else {
                        n
                    }
                } else {
                    (n * Self::grams_each(unit, item.key)).div_ceil(1000)
                }
            }
        };
        if n > 0 {
            value.max(1)
        } else {
            0
        }
    }
}

/// Shows a quantity in the item's base unit the way a shopper reads it.
pub struct QuantityLabel;

impl QuantityLabel {
    fn decimal(milli: u64) -> String {
        let whole = milli / 1000;
        let frac = (milli % 1000) / 10; // two decimals
        match frac {
            0 => format!("{whole}"),
            f if f % 10 == 0 => format!("{whole},{}", f / 10),
            f => format!("{whole},{f:02}"),
        }
    }

    /// `750 g`, `1,2 kg`, `300 ml`, `2 l`, `3 Stück` (pieces are rounded up).
    pub fn label(unit: Unit, milli: u64) -> String {
        match unit {
            Unit::Piece => format!("{} Stück", milli.div_ceil(1000)),
            Unit::Kilogram if milli < 1000 => format!("{milli} g"),
            Unit::Kilogram => format!("{} kg", Self::decimal(milli)),
            Unit::Liter if milli < 1000 => format!("{milli} ml"),
            Unit::Liter => format!("{} l", Self::decimal(milli)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(key: &str) -> &'static GenericItem {
        Catalog::by_key(key).unwrap()
    }

    fn base(text: &str, key: &str) -> u64 {
        Amount::parse(text).to_base_milli(item(key))
    }

    #[test]
    fn parses_numbers_units_and_fractions() {
        let p = |t: &str| {
            let a = Amount::parse(t);
            (a.thousandths, a.unit)
        };
        assert_eq!(p("250 g"), (250_000, AmountUnit::Gram));
        assert_eq!(p("250g"), (250_000, AmountUnit::Gram));
        assert_eq!(p("1,5 kg"), (1_500, AmountUnit::Kilogram));
        assert_eq!(p("1.5 l"), (1_500, AmountUnit::Liter));
        assert_eq!(p("0,25 l"), (250, AmountUnit::Liter));
        assert_eq!(p("1/2 Dose"), (500, AmountUnit::Can));
        assert_eq!(p("1 1/2 EL"), (1_500, AmountUnit::Tablespoon));
        assert_eq!(p("½ TL"), (500, AmountUnit::Teaspoon));
        assert_eq!(p("2 Zehen"), (2_000, AmountUnit::Clove));
        assert_eq!(p("2 Scheiben"), (2_000, AmountUnit::Slice));
        assert_eq!(p("1 Prise"), (1_000, AmountUnit::Pinch));
        assert_eq!(p("3"), (3_000, AmountUnit::Piece));
        assert_eq!(p("6 Stück"), (6_000, AmountUnit::Piece));
        assert_eq!(p("2-3 EL"), (3_000, AmountUnit::Tablespoon));
        assert_eq!(p("  400 ml  "), (400_000, AmountUnit::Milliliter));
        assert_eq!(p("1 Bund"), (1_000, AmountUnit::Bunch));
    }

    #[test]
    fn text_without_a_number_is_to_taste() {
        for t in ["nach Geschmack", "etwas", "", "   "] {
            assert_eq!(Amount::parse(t).unit, AmountUnit::ToTaste, "{t:?}");
        }
        assert_eq!(base("nach Geschmack", "salz"), 1);
    }

    #[test]
    fn absurd_numbers_do_not_panic() {
        assert_eq!(
            Amount::parse("99999999999999999999 g").unit,
            AmountUnit::ToTaste
        );
        assert_eq!(Amount::parse("1/0 g").unit, AmountUnit::Piece);
        let _ = base("999999999 kg", "mehl");
    }

    #[test]
    fn weight_and_volume_convert_to_the_base_unit() {
        assert_eq!(base("250 g", "nudeln"), 250); // milli-kg
        assert_eq!(base("1,5 kg", "kartoffeln"), 1_500);
        assert_eq!(base("500 ml", "tomaten-passiert"), 500); // milli-l
        assert_eq!(base("0,5 l", "milch"), 500);
        assert_eq!(base("2 EL", "oel"), 30);
        assert_eq!(base("1 TL", "salz"), 5);
        assert_eq!(base("1 Prise", "salz"), 1);
        // mass for an item sold by the piece
        assert_eq!(base("120 g", "eier"), 2_000);
        assert_eq!(base("1 EL", "milch"), 15);
    }

    #[test]
    fn counted_units_convert_by_item() {
        // pieces stay pieces
        assert_eq!(base("2", "eier"), 2_000);
        assert_eq!(base("6", "wuerstchen"), 6_000);
        assert_eq!(base("1 Dose", "kichererbsen"), 1_000);
        assert_eq!(base("2 Dosen", "kidneybohnen"), 2_000);
        // ten cloves are a bulb
        assert_eq!(base("2 Zehen", "knoblauch"), 200);
        assert_eq!(base("1 Zehe", "knoblauch"), 100);
        // counts for items sold by weight use a typical weight
        assert_eq!(base("2", "zwiebeln"), 160);
        assert_eq!(base("1", "paprika"), 150);
        assert_eq!(base("2 Scheiben", "brot"), 80);
        assert_eq!(base("2 Scheiben", "kaese-gouda"), 40);
        assert_eq!(base("1 Stange", "lauch"), 200);
        // a pack is the reference pack
        assert_eq!(base("1 Packung", "nudeln"), 500);
    }

    #[test]
    fn nonzero_amounts_never_round_to_zero() {
        assert_eq!(base("1 Prise", "pfeffer"), 1);
        assert_eq!(base("1 g", "kaffee"), 1);
        assert_eq!(base("0 g", "kaffee"), 0);
    }

    #[test]
    fn quantities_are_labelled_for_shoppers() {
        assert_eq!(QuantityLabel::label(Unit::Kilogram, 750), "750 g");
        assert_eq!(QuantityLabel::label(Unit::Kilogram, 1_000), "1 kg");
        assert_eq!(QuantityLabel::label(Unit::Kilogram, 1_200), "1,2 kg");
        assert_eq!(QuantityLabel::label(Unit::Kilogram, 1_250), "1,25 kg");
        assert_eq!(QuantityLabel::label(Unit::Liter, 300), "300 ml");
        assert_eq!(QuantityLabel::label(Unit::Liter, 2_000), "2 l");
        assert_eq!(QuantityLabel::label(Unit::Piece, 2_000), "2 Stück");
        assert_eq!(QuantityLabel::label(Unit::Piece, 100), "1 Stück");
    }

    #[test]
    fn every_bundled_amount_parses_to_something_sensible() {
        for r in crate::Recipe::bundled() {
            for ing in &r.ingredients {
                let it = item(&ing.item);
                let milli = Amount::parse(&ing.amount).to_base_milli(it);
                assert!(milli > 0, "{} / {} / {}", r.id, ing.item, ing.amount);
                // nothing in a single-recipe plan should need more than a few reference packs
                let packs = milli.div_ceil(u64::from(Catalog::reference_milli(it.key)));
                assert!(
                    packs <= 4,
                    "{} / {} / {}: {packs} packs",
                    r.id,
                    ing.item,
                    ing.amount
                );
            }
        }
    }
}
