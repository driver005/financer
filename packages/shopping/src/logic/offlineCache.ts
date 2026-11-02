// The last product page that loaded, kept on the device, so a product can still be shown (with its
// last known prices, marked as such) when the server cannot be reached.

import type { ProductDetail } from "../api/types";

export const cacheKey = (id: string): string => `shop.product.${id}`;

export type Cached = { savedAt: number; detail: ProductDetail };

export function serialize(detail: ProductDetail, now: number): string {
  return JSON.stringify({ savedAt: now, detail } satisfies Cached);
}

/** What was saved, or null when there is nothing usable (missing, damaged, or from another shape). */
export function parseCached(raw: string | null): Cached | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Cached>;
    if (typeof v.savedAt !== "number" || !v.detail || typeof v.detail !== "object" || !("product" in v.detail)) return null;
    return v as Cached;
  } catch {
    return null;
  }
}
