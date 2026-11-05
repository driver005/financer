/**
 * Helpers behind the grocery screens' look: which tone a chain or meal avatar takes, the price
 * comparison per item, the "who is cheapest overall" summary, and the cost per serving of a recipe.
 * The rules are in Rust (crates/logic, grocery_view.rs); money stays integer cents.
 */
import type { Price, RecipeMatch } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";

// ---- avatars ----

/** The colour role of a tile (a design-system tone). */
export type AvatarTone = "accent" | "success" | "warning" | "danger" | "info" | "neutral";

/** Calm, distinct tones for meal and recipe avatars. */
export const MEAL_TONES: readonly AvatarTone[] = ["accent", "info", "warning", "success", "danger", "neutral"];

/** A small stable number for a text (FNV-1a), used to pick a colour. */
export const hashText = (text: string): number => logic("grocery_view.hash_text", { text });

export const mealTone = (seed: string): AvatarTone => logic("grocery_view.meal_tone", { seed });

export const chainTone = (chain: string): AvatarTone => logic("grocery_view.chain_tone", { chain });

/** Letter on an avatar: the first letter of the first word. */
export const initials = (name: string): string => logic("grocery_view.initials", { name });

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
export const rankPrices = (prices: readonly Price[]): PriceRow[] => logic("grocery_view.rank_prices", { prices });

/** What picking the cheapest chain saves over the dearest one for one item (0 with one chain). */
export const itemSaving = (prices: readonly Price[]): { cents: number; versus: string | null } => logic("grocery_view.item_saving", { prices });

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

export const summarizePrices = (groups: readonly PriceGroup[]): PriceSummary =>
  logic("grocery_view.summarize_prices", { groups: groups.map((g) => g.prices) });

/** `+0,06 €` for a dearer chain, nothing for the cheapest. */
export const extraText = (extraCents: number): string => logic("grocery_view.extra_text", { extra_cents: extraCents });

// ---- recipes ----

/** Cost of the missing, priced ingredients per serving (rounded to a cent); `null` when nothing is missing. */
export const costPerServing = (r: Pick<RecipeMatch, "missing_cost_cents" | "servings" | "missing">): number | null =>
  logic("grocery_view.cost_per_serving", { missing_cost_cents: r.missing_cost_cents, servings: r.servings, missing: r.missing.length });

export type MatchTone = "high" | "mid" | "low";

/** How good a match is: 75+ high, 40+ middle, below that low. */
export const matchTone = (percent: number): MatchTone => logic("grocery_view.match_tone", { percent });

/** `3 more` for the tail of a list that is cut after `max` names. */
export const shortList = (names: readonly string[], max = 2): { shown: string[]; more: number } => logic("grocery_view.short_list", { names, max });

// ---- meal plan ----

/** Shopping list progress as a whole percent, 0 for an empty list. */
export const percentDone = (done: number, total: number): number => logic("grocery_view.percent_done", { done, total });

// ---- a recipe page ----

/** An amount text for `servings` instead of the `base` the recipe is written for ("250 g" for 2 is "500 g" for 4). */
export const scaleAmount = (text: string, servings: number, base: number): string => logic("recipe_view.scale_amount", { text, servings, base });

/** The servings a person can pick: at least one, at most 24. */
export const clampServings = (n: number): number => logic("recipe_view.clamp_servings", { n });
