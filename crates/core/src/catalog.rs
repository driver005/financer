//! The shared vocabulary of "generic items" (milk, pasta, onions…). Recipes, usual baskets,
//! parsed receipts and scraped product names are all mapped onto these keys, which is what
//! makes prices comparable across chains and brands.

use serde::{Deserialize, Serialize};

use crate::transaction::NameNormalizer;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Unit {
    Piece,
    Kilogram,
    Liter,
}

#[derive(Debug, Clone, Copy)]
pub struct GenericItem {
    pub key: &'static str,
    pub name_de: &'static str,
    pub unit: Unit,
    /// Assumed to be in the cupboard already (salt, oil…); never counted as "missing".
    pub pantry: bool,
    /// Lowercase, normalized (no punctuation) names a product title may contain as whole
    /// words. Multi-word keywords must appear as consecutive words.
    pub keywords: &'static [&'static str],
}

impl GenericItem {
    const fn new(
        key: &'static str,
        name_de: &'static str,
        unit: Unit,
        pantry: bool,
        keywords: &'static [&'static str],
    ) -> Self {
        Self {
            key,
            name_de,
            unit,
            pantry,
            keywords,
        }
    }
}

use Unit::{Kilogram as Kg, Liter as L, Piece as P};

pub const CATALOG: &[GenericItem] = &[
    GenericItem::new(
        "milch",
        "Milch",
        L,
        false,
        &["milch", "vollmilch", "hmilch", "frischmilch"],
    ),
    GenericItem::new(
        "butter",
        "Butter",
        Kg,
        false,
        &["butter", "markenbutter", "süßrahmbutter"],
    ),
    GenericItem::new(
        "eier",
        "Eier",
        P,
        false,
        &["eier", "ei", "freilandeier", "bodenhaltung"],
    ),
    GenericItem::new(
        "joghurt",
        "Joghurt",
        Kg,
        false,
        &["joghurt", "naturjoghurt"],
    ),
    GenericItem::new(
        "sahne",
        "Sahne",
        L,
        false,
        &["sahne", "schlagsahne", "kochsahne"],
    ),
    GenericItem::new("kaese-gouda", "Gouda", Kg, false, &["gouda"]),
    GenericItem::new("mozzarella", "Mozzarella", Kg, false, &["mozzarella"]),
    GenericItem::new(
        "parmesan",
        "Parmesan",
        Kg,
        false,
        &["parmesan", "grana padano"],
    ),
    GenericItem::new(
        "quark",
        "Quark",
        Kg,
        false,
        &["quark", "magerquark", "speisequark"],
    ),
    GenericItem::new(
        "brot",
        "Brot",
        Kg,
        false,
        &["brot", "vollkornbrot", "mischbrot", "toastbrot"],
    ),
    GenericItem::new(
        "broetchen",
        "Brötchen",
        P,
        false,
        &["brötchen", "semmel", "schrippen"],
    ),
    GenericItem::new("mehl", "Weizenmehl", Kg, false, &["weizenmehl", "mehl"]),
    GenericItem::new(
        "nudeln",
        "Nudeln",
        Kg,
        false,
        &["nudeln", "spaghetti", "penne", "fusilli", "makkaroni"],
    ),
    GenericItem::new(
        "reis",
        "Reis",
        Kg,
        false,
        &["reis", "basmatireis", "langkornreis"],
    ),
    GenericItem::new("haferflocken", "Haferflocken", Kg, false, &["haferflocken"]),
    GenericItem::new(
        "kartoffeln",
        "Kartoffeln",
        Kg,
        false,
        &["kartoffeln", "speisekartoffeln"],
    ),
    GenericItem::new(
        "zwiebeln",
        "Zwiebeln",
        Kg,
        false,
        &["zwiebeln", "speisezwiebeln"],
    ),
    GenericItem::new("knoblauch", "Knoblauch", P, false, &["knoblauch"]),
    GenericItem::new("karotten", "Karotten", Kg, false, &["karotten", "möhren"]),
    GenericItem::new(
        "tomaten",
        "Tomaten",
        Kg,
        false,
        &["tomaten", "rispentomaten", "cherrytomaten"],
    ),
    GenericItem::new(
        "tomaten-passiert",
        "Passierte Tomaten",
        L,
        false,
        &["passierte tomaten", "tomaten passiert", "pomito"],
    ),
    GenericItem::new("paprika", "Paprika", Kg, false, &["paprika"]),
    GenericItem::new("gurke", "Gurke", P, false, &["gurke", "salatgurke"]),
    GenericItem::new("zucchini", "Zucchini", Kg, false, &["zucchini"]),
    GenericItem::new("brokkoli", "Brokkoli", Kg, false, &["brokkoli"]),
    GenericItem::new("spinat", "Spinat", Kg, false, &["spinat", "blattspinat"]),
    GenericItem::new(
        "champignons",
        "Champignons",
        Kg,
        false,
        &["champignons", "pilze"],
    ),
    GenericItem::new("lauch", "Lauch", Kg, false, &["lauch", "porree"]),
    GenericItem::new(
        "salat",
        "Salat",
        P,
        false,
        &["eisbergsalat", "kopfsalat", "salatherzen"],
    ),
    GenericItem::new("aepfel", "Äpfel", Kg, false, &["äpfel", "apfel"]),
    GenericItem::new("bananen", "Bananen", Kg, false, &["bananen"]),
    GenericItem::new("zitronen", "Zitronen", P, false, &["zitronen", "zitrone"]),
    GenericItem::new(
        "haehnchenbrust",
        "Hähnchenbrust",
        Kg,
        false,
        &["hähnchenbrust", "hühnerbrust", "hähnchenbrustfilet"],
    ),
    GenericItem::new(
        "hackfleisch",
        "Hackfleisch gemischt",
        Kg,
        false,
        &["hackfleisch", "gehacktes"],
    ),
    GenericItem::new(
        "bacon",
        "Speck",
        Kg,
        false,
        &["speck", "bacon", "frühstücksspeck"],
    ),
    GenericItem::new(
        "wuerstchen",
        "Würstchen",
        P,
        false,
        &["würstchen", "bratwurst"],
    ),
    GenericItem::new("lachs", "Lachs", Kg, false, &["lachs", "lachsfilet"]),
    GenericItem::new("thunfisch", "Thunfisch (Dose)", P, false, &["thunfisch"]),
    GenericItem::new("linsen", "Linsen", Kg, false, &["linsen"]),
    GenericItem::new(
        "kichererbsen",
        "Kichererbsen (Dose)",
        P,
        false,
        &["kichererbsen"],
    ),
    GenericItem::new(
        "kidneybohnen",
        "Kidneybohnen (Dose)",
        P,
        false,
        &["kidneybohnen", "kidney bohnen"],
    ),
    GenericItem::new("mais", "Mais (Dose)", P, false, &["mais", "gemüsemais"]),
    GenericItem::new("tofu", "Tofu", Kg, false, &["tofu"]),
    GenericItem::new("kokosmilch", "Kokosmilch", L, false, &["kokosmilch"]),
    GenericItem::new("tomatenmark", "Tomatenmark", Kg, false, &["tomatenmark"]),
    GenericItem::new("zucker", "Zucker", Kg, true, &["zucker", "haushaltszucker"]),
    GenericItem::new("salz", "Salz", Kg, true, &["salz", "speisesalz", "jodsalz"]),
    GenericItem::new("pfeffer", "Pfeffer", Kg, true, &["pfeffer"]),
    GenericItem::new(
        "oel",
        "Speiseöl",
        L,
        true,
        &["speiseöl", "rapsöl", "sonnenblumenöl", "olivenöl"],
    ),
    GenericItem::new("essig", "Essig", L, true, &["essig"]),
    GenericItem::new("bruehe", "Gemüsebrühe", Kg, true, &["gemüsebrühe", "brühe"]),
    GenericItem::new("curry", "Currypulver", Kg, true, &["currypulver", "curry"]),
    GenericItem::new("kaffee", "Kaffee", Kg, false, &["kaffee", "bohnenkaffee"]),
    GenericItem::new("tee", "Tee", P, false, &["tee", "früchtetee", "schwarztee"]),
    GenericItem::new(
        "wasser",
        "Mineralwasser",
        L,
        false,
        &["mineralwasser", "wasser", "sprudel"],
    ),
    GenericItem::new(
        "apfelsaft",
        "Apfelsaft",
        L,
        false,
        &["apfelsaft", "orangensaft", "saft"],
    ),
    GenericItem::new(
        "schokolade",
        "Schokolade",
        Kg,
        false,
        &["schokolade", "vollmilchschokolade"],
    ),
    GenericItem::new("kekse", "Kekse", Kg, false, &["kekse", "butterkekse"]),
    GenericItem::new(
        "pizza-tk",
        "Tiefkühlpizza",
        P,
        false,
        &["tiefkühlpizza", "pizza"],
    ),
    GenericItem::new(
        "toilettenpapier",
        "Toilettenpapier",
        P,
        false,
        &["toilettenpapier", "klopapier"],
    ),
];

/// Lookups over the generic item [`CATALOG`].
pub struct Catalog;

impl Catalog {
    /// Size of the reference pack all prices of an item are normalised to, in thousandths of
    /// the item's base unit (kg, l or piece): `1000` is 1 kg / 1 l / 1 piece. Chains sell
    /// different pack sizes, so a quote is always converted to this pack before comparing.
    pub fn reference_milli(key: &str) -> u32 {
        match key {
            "eier" => 10_000,
            "nudeln" | "mehl" | "haferflocken" | "linsen" | "quark" | "tofu" | "zucker"
            | "salz" => 500,
            "butter" | "kaese-gouda" | "mozzarella" | "parmesan" | "joghurt" | "champignons"
            | "hackfleisch" | "haehnchenbrust" | "lachs" | "bacon" | "spinat" | "brokkoli"
            | "schokolade" | "kekse" | "kaffee" | "tomatenmark" | "curry" | "pfeffer" => 250,
            "sahne" | "kokosmilch" | "tomaten-passiert" => 500,
            "broetchen" | "wuerstchen" | "toilettenpapier" => 4_000,
            _ => 1_000,
        }
    }

    /// `500 g`, `1 l`, `10 Stück`: the reference pack as shown to the user.
    pub fn reference_label(key: &str) -> Option<String> {
        let item = Self::by_key(key)?;
        let milli = Self::reference_milli(key);
        Some(match item.unit {
            Unit::Piece => format!("{} Stück", milli / 1000),
            Unit::Kilogram if milli < 1000 => format!("{milli} g"),
            Unit::Kilogram => format!("{} kg", milli / 1000),
            Unit::Liter if milli < 1000 => format!("{milli} ml"),
            Unit::Liter => format!("{} l", milli / 1000),
        })
    }

    pub fn by_key(key: &str) -> Option<&'static GenericItem> {
        CATALOG.iter().find(|i| i.key == key)
    }

    /// Map a free-text product or receipt line ("Bio Vollmilch 3,5% 1L") to a generic item.
    ///
    /// Matching is by whole words, so `Milchschnitte` never matches `milch`. When several items
    /// match, the one with the longest (most specific) keyword wins.
    pub fn match_product(text: &str) -> Option<&'static GenericItem> {
        let normalized = NameNormalizer::normalize(text);
        if normalized.is_empty() {
            return None;
        }
        let padded = format!(" {normalized} ");
        CATALOG
            .iter()
            .flat_map(|it| it.keywords.iter().map(move |k| (it, *k)))
            .filter(|(_, k)| padded.contains(&format!(" {} ", NameNormalizer::normalize(k))))
            .max_by_key(|(_, k)| k.len())
            .map(|(it, _)| it)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn keys_are_unique() {
        let mut seen = HashSet::new();
        for i in CATALOG {
            assert!(seen.insert(i.key), "duplicate key {}", i.key);
        }
    }

    #[test]
    fn matches_on_whole_words_only() {
        let key = |s: &str| Catalog::match_product(s).map(|i| i.key);
        assert_eq!(key("Bio Vollmilch 3,5% 1L"), Some("milch"));
        assert_eq!(key("Milchschnitte 5er"), None);
        assert_eq!(key("Spaghetti No. 5 500g"), Some("nudeln"));
        assert_eq!(key("Passierte Tomaten 500 g"), Some("tomaten-passiert"));
        assert_eq!(key("Cherrytomaten 250g"), Some("tomaten"));
        assert_eq!(key("Hähnchenbrustfilet 400 g"), Some("haehnchenbrust"));
        assert_eq!(key("Tomatenmark"), Some("tomatenmark"));
        assert_eq!(key("Playstation"), None);
        assert_eq!(key(""), None);
    }

    #[test]
    fn longest_keyword_wins() {
        // "kokosmilch" must not be read as milk, "apfelsaft" not as apples
        assert_eq!(
            Catalog::match_product("Kokosmilch 400ml").map(|i| i.key),
            Some("kokosmilch")
        );
        assert_eq!(
            Catalog::match_product("Apfelsaft naturtrüb").map(|i| i.key),
            Some("apfelsaft")
        );
    }

    #[test]
    fn reference_packs_are_sensible_for_every_item() {
        for i in CATALOG {
            let m = Catalog::reference_milli(i.key);
            assert!(m > 0, "{}", i.key);
            assert!(Catalog::reference_label(i.key).is_some());
            if i.unit != Unit::Piece {
                assert!(m <= 5_000, "{} reference pack is unreasonably large", i.key);
            }
        }
        assert_eq!(Catalog::reference_label("milch").as_deref(), Some("1 l"));
        assert_eq!(Catalog::reference_label("nudeln").as_deref(), Some("500 g"));
        assert_eq!(
            Catalog::reference_label("eier").as_deref(),
            Some("10 Stück")
        );
        assert_eq!(
            Catalog::reference_label("tomaten-passiert").as_deref(),
            Some("500 ml")
        );
        assert_eq!(Catalog::reference_label("nope"), None);
    }

    #[test]
    fn lookup_by_key() {
        assert_eq!(Catalog::by_key("milch").unwrap().name_de, "Milch");
        assert!(Catalog::by_key("nope").is_none());
    }
}
