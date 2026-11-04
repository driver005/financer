// The last product page that loaded, kept on the device, so a product can still be shown (with its
// last known prices, marked as such) when the server cannot be reached. The rules are in Rust
// (crates/logic, shop_misc.rs).

import { logic } from "../../../wire/src/logic";
import type { ProductDetail } from "../api/types";

export const cacheKey = (id: string): string => `shop.product.${id}`;

export type Cached = { savedAt: number; detail: ProductDetail };

export const serialize = (detail: ProductDetail, now: number): string => logic("shop_misc.serialize_cached", { detail, now });

/** What was saved, or null when there is nothing usable (missing, damaged, or from another shape). */
export const parseCached = (raw: string | null): Cached | null => logic("shop_misc.parse_cached", { raw });
