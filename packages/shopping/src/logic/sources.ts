// Starting points for the shop sources a phone reads, and a check before they are saved. The
// server validates again; this only saves a round trip and explains in plain words. The check is in
// Rust (crates/logic, shop_misc.rs).

import { logic } from "../../../wire/src/logic";

export const SOURCES_EXAMPLE = `[
  {
    "name": "my-shop-search",
    "shop": "My Shop",
    "kind": "search",
    "search_url": "https://shop.example/search?q={query}",
    "follow": ["/product/"],
    "max_depth": 1,
    "max_pages": 30,
    "category": "smartphone"
  },
  {
    "name": "tariff-feed",
    "shop": "Tariff Portal",
    "kind": "feed",
    "feed_url": "https://tariffs.example/feed.csv",
    "category": "mobile_plan",
    "mapping": {
      "title": "name", "price": "setup_fee", "url": "link",
      "monthly": "monthly", "min_term_months": "term",
      "promo_months": "promo_months", "promo_monthly": "promo_price", "setup": "setup_fee"
    }
  }
]`;

export type SourcesCheck = { ok: true; count: number } | { ok: false; problems: string[] };

export const checkSources = (text: string): SourcesCheck => logic("shop_misc.check_sources", { input: text });
