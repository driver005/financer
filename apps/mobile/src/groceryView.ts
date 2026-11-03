/**
 * Pure helpers behind the grocery screens' look (no React, so they are unit-tested in plain
 * Node): which tone a chain or meal avatar takes, the price comparison
 * per item, the "who is cheapest overall" summary, and the cost per serving of a recipe.
 * Money stays integer cents; wording of amounts goes through `formatCents`.
 */
import type { Price, RecipeMatch } from "./api/client";
import { formatCents } from "./format";

// ---- avatars ----

/** The colour role of a tile (a design-system tone). */
export type AvatarTone = "accent" | "success" | "warning" | "danger" | "info" | "neutral";

/** Chain avatar tones. */
const CHAIN_TONE: Record<string, AvatarTone> = { aldi: "info", lidl: "warning", kaufland: "danger", rewe: "danger" };

/** Calm, distinct tones for meal and recipe avatars. */
export const MEAL_TONES: readonly AvatarTone[] = ["accent", "info", "warning", "success", "danger", "neutral"];

/** A small stable number for a text (FNV-1a), used to pick a colour. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mealTone(seed: string): AvatarTone {
  return MEAL_TONES[hashText(seed) % MEAL_TONES.length];
}

export function chainTone(chain: string): AvatarTone {
  return CHAIN_TONE[chain.toLowerCase()] ?? mealTone(chain);
}

/** Letter(s) on an avatar: the first letter of the first word, or two for a short two-word name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "?";
  return first.toLocaleUpperCase("de");
}

// ---- price comparison ----

export type PriceRow = {
  price: Price;
  /** Cheapest price of the item (ties count as cheapest too, as long as chains compete). */
  isCheapest: boolean;
  /** Cents more than the cheapest; 0 for the cheapest. */
  extraCents: number;
};

export type PriceGroup = { item: string; name: string; pack: string; prices: Price[] };

/** Rows of one item, cheapest first. Nobody is "cheapest" when only one chain has a price. */
export function rankPrices(prices: readonly Price[]): PriceRow[] {
  const sorted = [...prices].sort((a, b) => a.price_cents - b.price_cents);
  const best = sorted[0]?.price_cents ?? 0;
  const competing = new Set(sorted.map((p) => p.chain)).size > 1;
  return sorted.map((price) => ({
    price,
    isCheapest: competing && price.price_cents === best,
    extraCents: price.price_cents - best,
  }));
}

/** What picking the cheapest chain saves over the dearest one for one item (0 with one chain). */
export function itemSaving(prices: readonly Price[]): { cents: number; versus: string | null } {
  if (new Set(prices.map((p) => p.chain)).size < 2) return { cents: 0, versus: null };
  const sorted = [...prices].sort((a, b) => a.price_cents - b.price_cents);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const cents = high.price_cents - low.price_cents;
  return { cents, versus: cents > 0 ? high.chain : null };
}

export type PriceSummary = {
  /** Number of items that are priced at two or more chains. */
  compared: number;
  /** Chains by how many of those items they win (ties count for each), most first. */
  wins: { chain: string; count: number }[];
  /** The best chain, when one is ahead of the rest. */
  leader: { chain: string; count: number } | null;
  /** The chains at the top of `wins`: one when there is a leader, several on a tie. */
  top: string[];
  /** Sum over the items of dearest minus cheapest: what you keep by choosing well. */
  savingCents: number;
};

export function summarizePrices(groups: readonly PriceGroup[]): PriceSummary {
  const count = new Map<string, number>();
  let compared = 0;
  let savingCents = 0;
  for (const g of groups) {
    const rows = rankPrices(g.prices);
    if (!rows.some((r) => r.isCheapest)) continue;
    compared++;
    savingCents += itemSaving(g.prices).cents;
    const winners = new Set(rows.filter((r) => r.isCheapest).map((r) => r.price.chain));
    for (const chain of winners) count.set(chain, (count.get(chain) ?? 0) + 1);
  }
  const wins = [...count.entries()].map(([chain, n]) => ({ chain, count: n })).sort((a, b) => b.count - a.count || a.chain.localeCompare(b.chain));
  const leader = wins.length > 0 && (wins.length === 1 || wins[0].count > wins[1].count) ? wins[0] : null;
  const top = wins.filter((w) => w.count === wins[0]?.count).map((w) => w.chain);
  return { compared, wins, leader, top, savingCents };
}

/** `0,06 € more` for a dearer chain, `` for the cheapest. */
export function extraText(extraCents: number): string {
  return extraCents > 0 ? `+${formatCents(extraCents)}` : "";
}

// ---- recipes ----

/** Cost of the missing, priced ingredients per serving (rounded to a cent); `null` when nothing is missing. */
export function costPerServing(r: Pick<RecipeMatch, "missing_cost_cents" | "servings" | "missing">): number | null {
  if (r.missing.length === 0 || r.servings <= 0) return null;
  return Math.round(r.missing_cost_cents / r.servings);
}

export type MatchTone = "high" | "mid" | "low";

/** How good a match is: 75+ high, 40+ middle, below that low. */
export function matchTone(percent: number): MatchTone {
  return percent >= 75 ? "high" : percent >= 40 ? "mid" : "low";
}

/** `3 more` for the tail of a list that is cut after `max` names. */
export function shortList(names: readonly string[], max = 2): { shown: string[]; more: number } {
  return { shown: names.slice(0, max), more: Math.max(0, names.length - max) };
}

// ---- meal plan ----

/** Shopping list progress as a whole percent, 0 for an empty list. */
export function percentDone(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}
