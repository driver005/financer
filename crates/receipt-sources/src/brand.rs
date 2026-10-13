//! Which retailer a name belongs to, for receipts and bank counterparties alike. The chain table
//! is the one of the Stores screen (`financer_core::StoreMatcher`); there is no second list.

use std::sync::OnceLock;

use financer_core::{Chain, StoreMatcher};

fn builtin() -> &'static StoreMatcher {
    static MATCHER: OnceLock<StoreMatcher> = OnceLock::new();
    MATCHER.get_or_init(StoreMatcher::builtin)
}

/// Chain id (`rewe`, `lidl`, `edeka`, `dm`, ...) found in a merchant or store name, by the
/// built-in table of the Stores screen.
pub fn brand_of(name: &str) -> Option<String> {
    builtin().match_text(name, "").map(|c| c.id.clone())
}

/// The id of a price-tracked chain; the same ids the Stores screen uses.
pub fn chain_key(chain: Chain) -> &'static str {
    match chain {
        Chain::Rewe => "rewe",
        Chain::Lidl => "lidl",
        Chain::Aldi => "aldi",
        Chain::Kaufland => "kaufland",
    }
}

/// A configured or detected retailer name as a chain id: the id of a known chain, or else the
/// name written the way the Stores screen writes ids of chains of your own.
pub fn normalize_brand(name: &str) -> String {
    brand_of(name).unwrap_or_else(|| StoreMatcher::slug(name))
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
    fn look_alikes_and_short_names_are_not_chains() {
        assert_eq!(brand_of("Admin Services GmbH"), None);
        assert_eq!(brand_of("Café Müller"), None);
        assert_eq!(brand_of("Lidl Connect"), None);
        assert_eq!(brand_of(""), None);
    }

    #[test]
    fn chain_ids_agree_with_the_stores_screen() {
        for c in [Chain::Rewe, Chain::Lidl, Chain::Aldi, Chain::Kaufland] {
            assert!(builtin().chain(chain_key(c)).is_some(), "{c:?}");
        }
    }

    #[test]
    fn normalize_gives_ids_for_unknown_names() {
        assert_eq!(normalize_brand("Rewe"), "rewe");
        assert_eq!(normalize_brand(" Bäckerei Schmidt "), "bäckerei-schmidt");
    }
}
