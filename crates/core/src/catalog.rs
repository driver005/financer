//! The shared vocabulary of "generic items" (milk, pasta, onions…). Recipes, usual baskets,
//! parsed receipts and scraped product names are all mapped onto these keys, which is what
//! makes prices comparable across chains and brands.

use serde::{Deserialize, Serialize};

use crate::transaction::normalize_name;

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

const fn item(
    key: &'static str,
    name_de: &'static str,
    unit: Unit,
    pantry: bool,
    keywords: &'static [&'static str],
) -> GenericItem {
    GenericItem {
        key,
        name_de,
        unit,
        pantry,
        keywords,
    }
}

use Unit::{Kilogram as Kg, Liter as L, Piece as P};

pub const CATALOG: &[GenericItem] = &[
    item(
        "milch",
        "Milch",
        L,
        false,
        &["milch", "vollmilch", "hmilch", "frischmilch"],
    ),
    item(
        "butter",
        "Butter",
        Kg,
        false,
        &["butter", "markenbutter", "süßrahmbutter"],
    ),
    item(
        "eier",
        "Eier",
        P,
        false,
        &["eier", "ei", "freilandeier", "bodenhaltung"],
    ),
    item(
        "joghurt",
        "Joghurt",
        Kg,
        false,
        &["joghurt", "naturjoghurt"],
    ),
    item(
        "sahne",
        "Sahne",
        L,
        false,
        &["sahne", "schlagsahne", "kochsahne"],
    ),
    item("kaese-gouda", "Gouda", Kg, false, &["gouda"]),
    item("mozzarella", "Mozzarella", Kg, false, &["mozzarella"]),
    item(
        "parmesan",
        "Parmesan",
        Kg,
        false,
        &["parmesan", "grana padano"],
    ),
    item(
        "quark",
        "Quark",
        Kg,
        false,
        &["quark", "magerquark", "speisequark"],
    ),
    item(
        "brot",
        "Brot",
        Kg,
        false,
        &["brot", "vollkornbrot", "mischbrot", "toastbrot"],
    ),
    item(
        "broetchen",
        "Brötchen",
        P,
        false,
        &["brötchen", "semmel", "schrippen"],
    ),
    item("mehl", "Weizenmehl", Kg, false, &["weizenmehl", "mehl"]),
    item(
        "nudeln",
        "Nudeln",
        Kg,
        false,
        &["nudeln", "spaghetti", "penne", "fusilli", "makkaroni"],
    ),
    item(
        "reis",
        "Reis",
        Kg,
        false,
        &["reis", "basmatireis", "langkornreis"],
    ),
    item("haferflocken", "Haferflocken", Kg, false, &["haferflocken"]),
    item(
        "kartoffeln",
        "Kartoffeln",
        Kg,
        false,
        &["kartoffeln", "speisekartoffeln"],
    ),
    item(
        "zwiebeln",
        "Zwiebeln",
        Kg,
        false,
        &["zwiebeln", "speisezwiebeln"],
    ),
    item("knoblauch", "Knoblauch", P, false, &["knoblauch"]),
    item("karotten", "Karotten", Kg, false, &["karotten", "möhren"]),
    item(
        "tomaten",
        "Tomaten",
        Kg,
        false,
        &["tomaten", "rispentomaten", "cherrytomaten"],
    ),
    item(
        "tomaten-passiert",
        "Passierte Tomaten",
        L,
        false,
        &["passierte tomaten", "tomaten passiert", "pomito"],
    ),
    item("paprika", "Paprika", Kg, false, &["paprika"]),
    item("gurke", "Gurke", P, false, &["gurke", "salatgurke"]),
    item("zucchini", "Zucchini", Kg, false, &["zucchini"]),
    item("brokkoli", "Brokkoli", Kg, false, &["brokkoli"]),
    item("spinat", "Spinat", Kg, false, &["spinat", "blattspinat"]),
    item(
        "champignons",
        "Champignons",
        Kg,
        false,
        &["champignons", "pilze"],
    ),
    item("lauch", "Lauch", Kg, false, &["lauch", "porree"]),
    item(
        "salat",
        "Salat",
        P,
        false,
        &["eisbergsalat", "kopfsalat", "salatherzen"],
    ),
    item("aepfel", "Äpfel", Kg, false, &["äpfel", "apfel"]),
    item("bananen", "Bananen", Kg, false, &["bananen"]),
    item("zitronen", "Zitronen", P, false, &["zitronen", "zitrone"]),
    item(
        "haehnchenbrust",
        "Hähnchenbrust",
        Kg,
        false,
        &["hähnchenbrust", "hühnerbrust", "hähnchenbrustfilet"],
    ),
    item(
        "hackfleisch",
        "Hackfleisch gemischt",
        Kg,
        false,
        &["hackfleisch", "gehacktes"],
    ),
    item(
        "bacon",
        "Speck",
        Kg,
        false,
        &["speck", "bacon", "frühstücksspeck"],
    ),
    item(
        "wuerstchen",
        "Würstchen",
        P,
        false,
        &["würstchen", "bratwurst"],
    ),
    item("lachs", "Lachs", Kg, false, &["lachs", "lachsfilet"]),
    item("thunfisch", "Thunfisch (Dose)", P, false, &["thunfisch"]),
    item("linsen", "Linsen", Kg, false, &["linsen"]),
    item(
        "kichererbsen",
        "Kichererbsen (Dose)",
        P,
        false,
        &["kichererbsen"],
    ),
    item(
        "kidneybohnen",
        "Kidneybohnen (Dose)",
        P,
        false,
        &["kidneybohnen", "kidney bohnen"],
    ),
    item("mais", "Mais (Dose)", P, false, &["mais", "gemüsemais"]),
    item("tofu", "Tofu", Kg, false, &["tofu"]),
    item("kokosmilch", "Kokosmilch", L, false, &["kokosmilch"]),
    item("tomatenmark", "Tomatenmark", Kg, false, &["tomatenmark"]),
    item("zucker", "Zucker", Kg, true, &["zucker", "haushaltszucker"]),
    item("salz", "Salz", Kg, true, &["salz", "speisesalz", "jodsalz"]),
    item("pfeffer", "Pfeffer", Kg, true, &["pfeffer"]),
    item(
        "oel",
        "Speiseöl",
        L,
        true,
        &["speiseöl", "rapsöl", "sonnenblumenöl", "olivenöl"],
    ),
    item("essig", "Essig", L, true, &["essig"]),
    item("bruehe", "Gemüsebrühe", Kg, true, &["gemüsebrühe", "brühe"]),
    item("curry", "Currypulver", Kg, true, &["currypulver", "curry"]),
    item("kaffee", "Kaffee", Kg, false, &["kaffee", "bohnenkaffee"]),
    item("tee", "Tee", P, false, &["tee", "früchtetee", "schwarztee"]),
    item(
        "wasser",
        "Mineralwasser",
        L,
        false,
        &["mineralwasser", "wasser", "sprudel"],
    ),
    item(
        "apfelsaft",
        "Apfelsaft",
        L,
        false,
        &["apfelsaft", "orangensaft", "saft"],
    ),
    item(
        "schokolade",
        "Schokolade",
        Kg,
        false,
        &["schokolade", "vollmilchschokolade"],
    ),
    item("kekse", "Kekse", Kg, false, &["kekse", "butterkekse"]),
    item(
        "pizza-tk",
        "Tiefkühlpizza",
        P,
        false,
        &["tiefkühlpizza", "pizza"],
    ),
    item(
        "toilettenpapier",
        "Toilettenpapier",
        P,
        false,
        &["toilettenpapier", "klopapier"],
    ),
];

pub fn by_key(key: &str) -> Option<&'static GenericItem> {
    CATALOG.iter().find(|i| i.key == key)
}

/// Map a free-text product or receipt line ("Bio Vollmilch 3,5% 1L") to a generic item.
///
/// Matching is by whole words, so `Milchschnitte` never matches `milch`. When several items
/// match, the one with the longest (most specific) keyword wins.
pub fn match_product(text: &str) -> Option<&'static GenericItem> {
    let normalized = normalize_name(text);
    if normalized.is_empty() {
        return None;
    }
    let padded = format!(" {normalized} ");
    CATALOG
        .iter()
        .flat_map(|it| it.keywords.iter().map(move |k| (it, *k)))
        .filter(|(_, k)| padded.contains(&format!(" {} ", normalize_name(k))))
        .max_by_key(|(_, k)| k.len())
        .map(|(it, _)| it)
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
        let key = |s: &str| match_product(s).map(|i| i.key);
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
            match_product("Kokosmilch 400ml").map(|i| i.key),
            Some("kokosmilch")
        );
        assert_eq!(
            match_product("Apfelsaft naturtrüb").map(|i| i.key),
            Some("apfelsaft")
        );
    }

    #[test]
    fn lookup_by_key() {
        assert_eq!(by_key("milch").unwrap().name_de, "Milch");
        assert!(by_key("nope").is_none());
    }
}
