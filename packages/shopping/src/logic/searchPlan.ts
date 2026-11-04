// Decisions around a search, kept out of the screen so they can be tested. The rules are in Rust
// (crates/logic, shop_misc.rs).

import { logic } from "../../../wire/src/logic";
import type { IndexRequest, SearchRequest, SearchResponse } from "../api/types";

export type NextStep =
  | { kind: "show" }
  /** Nothing (or nothing recent) is known for this search: offer to build the index. */
  | { kind: "suggest-index"; reason: "empty" | "stale" | "no-category" }
  | { kind: "none-found" };

export const nextStep = (r: SearchResponse, integrated: boolean): NextStep => logic("shop_misc.next_step", { r, integrated });

export const suggestionText = (reason: "empty" | "stale" | "no-category"): string => logic("shop_misc.suggestion_text", { reason });

export const indexRequestFor = (req: SearchRequest, r?: SearchResponse): IndexRequest => logic("shop_misc.index_request_for", { req, r: r ?? null });

/** A search that can be shared back into the query box: `ram_gb>=8 price<500`. */
export const chipsFor = (r: SearchResponse): string[] => logic("shop_misc.chips_for", { r });
