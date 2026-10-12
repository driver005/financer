//! Which retailer a name belongs to, for receipts and bank counterparties alike.

use financer_core::Chain;

/// Brands recognised besides the four price-tracked chains. Each is matched as a whole word
/// (or a word starting with it, for names of at least four letters), so `dm` does not match
/// `Admin`.
const OTHER_BRANDS: &[&str] = &[
    "edeka",
    "dm",
    "rossmann",
    "penny",
    "netto",
    "norma",
    "globus",
    "tegut",
    "denns",
    "alnatura",
];

/// Brand key (`rewe`, `lidl`, `edeka`, ...) found in a merchant, store or counterparty name.
pub fn brand_of(name: &str) -> Option<String> {
    if let Some(chain) = Chain::from_name(name) {
        return Some(chain_key(chain).to_string());
    }
    let lower = name.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    OTHER_BRANDS
        .iter()
        .find(|b| {
            words
                .iter()
                .any(|w| w == *b || (b.len() >= 4 && w.starts_with(**b)))
        })
        .map(|b| b.to_string())
}

/// The brand key of a price-tracked chain.
pub fn chain_key(chain: Chain) -> &'static str {
    match chain {
        Chain::Rewe => "rewe",
        Chain::Lidl => "lidl",
        Chain::Aldi => "aldi",
        Chain::Kaufland => "kaufland",
    }
}

/// Normalise a configured or detected retailer name to a brand key where it is one.
pub fn normalize_brand(name: &str) -> String {
    brand_of(name).unwrap_or_else(|| name.trim().to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_chains_and_other_brands() {
        assert_eq!(brand_of("REWE Markt GmbH").as_deref(), Some("rewe"));
        assert_eq!(brand_of("LIDL SAGT DANKE").as_deref(), Some("lidl"));
        assert_eq!(brand_of("ALDI SUED").as_deref(), Some("aldi"));
        assert_eq!(brand_of("EDEKA Müller e.K.").as_deref(), Some("edeka"));
        assert_eq!(brand_of("dm-drogerie markt GmbH").as_deref(), Some("dm"));
        assert_eq!(brand_of("PENNY-Markt GmbH").as_deref(), Some("penny"));
    }

    #[test]
    fn short_brands_need_a_whole_word() {
        assert_eq!(brand_of("Admin Services GmbH"), None);
        assert_eq!(brand_of("Café Müller"), None);
        assert_eq!(brand_of(""), None);
    }

    #[test]
    fn normalize_keeps_unknown_names_lowercase() {
        assert_eq!(normalize_brand("Rewe"), "rewe");
        assert_eq!(normalize_brand(" Bäckerei Schmidt "), "bäckerei schmidt");
    }
}
