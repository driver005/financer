// Decisions around a search, kept out of the screen so they can be tested.

import type { IndexRequest, SearchRequest, SearchResponse } from "../api/types";

export type NextStep =
  | { kind: "show" }
  /** Nothing (or nothing recent) is known for this search: offer to build the index. */
  | { kind: "suggest-index"; reason: "empty" | "stale" | "no-category" }
  | { kind: "none-found" };

export function nextStep(r: SearchResponse, integrated: boolean): NextStep {
  if (r.category === null) return { kind: "suggest-index", reason: "no-category" };
  if (r.catalogue.products_in_category === 0) return { kind: "suggest-index", reason: "empty" };
  if (r.items.length === 0) return r.catalogue.stale || integrated ? { kind: "suggest-index", reason: r.catalogue.stale ? "stale" : "empty" } : { kind: "none-found" };
  if (r.catalogue.stale && integrated) return { kind: "suggest-index", reason: "stale" };
  return { kind: "show" };
}

export function suggestionText(reason: "empty" | "stale" | "no-category"): string {
  switch (reason) {
    case "empty":
      return "Nothing is known about this yet. Build the index to read prices and specs from your shops.";
    case "stale":
      return "The prices on file are more than a week old. Build the index again to refresh them.";
    case "no-category":
      return "Could not tell what kind of product this is. Pick a category, or build the index first.";
  }
}

export function indexRequestFor(req: SearchRequest, r?: SearchResponse): IndexRequest {
  const category = req.category ?? r?.category ?? undefined;
  return { query: req.query.trim(), ...(category ? { category } : {}) };
}

/** A search that can be shared back into the query box: `ram_gb>=8 price<500`. */
export function chipsFor(r: SearchResponse): string[] {
  const out: string[] = [];
  if (r.parsed.max_price_cents) out.push(`under ${Math.round(r.parsed.max_price_cents / 100)} €`);
  for (const c of r.parsed.constraints) {
    const sym = c.op === "gte" ? "≥" : c.op === "lte" ? "≤" : c.op === "eq" ? "=" : c.op === "ne" ? "≠" : ":";
    out.push(`${c.attribute.replace(/_/g, " ")} ${sym} ${String(c.value)}`);
  }
  return out;
}
