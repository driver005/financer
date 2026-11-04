/**
 * The meal plan screen: week math (weeks run Monday to Sunday and are named by their Monday), turning
 * picked recipes into plan entries, the ticks on the shopping list, and the wording of the budget
 * check. The rules are in Rust (crates/logic, mealplan.rs). Money is integer cents; the server does
 * the arithmetic, the words are chosen there.
 */
import type { Idea, MealDay, MealDayInput, MealShoppingList, RecipeMatch } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";

export const MAX_SERVINGS = 20;

export const chainName = (chain: string): string => logic("mealplan.chain_name", { chain });

// ---- weeks ----

export const addDays = (iso: string, days: number): string => logic("calendar.add_days", { iso, n: days });

/** The Monday of the week that contains `iso` (`YYYY-MM-DD`). */
export const weekStart = (iso: string): string => logic("calendar.start_of_week", { iso });

/** The seven days of the week, Monday first. */
export const weekDays = (start: string): string[] => logic("mealplan.week_days", { start });

/** The Monday `weeks` weeks after (or, negative, before) `start`. */
export const shiftWeek = (start: string, weeks: number): string => logic("mealplan.shift_week", { start, weeks });

/** `Mon` ... `Sun` */
export const weekdayName = (iso: string): string => logic("mealplan.weekday_name", { iso });

/** `2026-10-12` -> `12.10.` */
export const shortDate = (iso: string): string => logic("mealplan.short_date", { iso });

/** `12.10. – 18.10.2026`, with both years when the week spans New Year. */
export const weekLabel = (start: string): string => logic("mealplan.week_label", { start });

/** Where `start` is relative to the week that contains `today`. */
export const weekRelation = (start: string, today: string): "this" | "next" | "last" | "other" => logic("mealplan.week_relation", { start, today });

export const RELATION_LABEL = { this: "This week", next: "Next week", last: "Last week", other: "" } as const;

// ---- the plan ----

/** One planned meal. `recipe_id` is null for a suggested recipe that is not in the dataset. */
export type MealEntry = {
  recipe_id: string | null;
  title: string;
  servings: number;
  /** Servings the ingredient amounts are written for. */
  recipe_servings: number;
  ingredients: { name: string; amount: string }[];
};

/** The plan of one week by day; a day without a meal has no key. */
export type WeekPlan = Record<string, MealEntry>;

export const clampServings = (n: number): number => logic("mealplan.clamp_servings", { n });

export const planFromDays = (days: MealDay[]): WeekPlan => logic("mealplan.plan_from_days", { days });

export const entryFromRecipe = (r: Pick<RecipeMatch, "id" | "title" | "servings" | "ingredients">, servings?: number): MealEntry =>
  logic("mealplan.entry_from_recipe", { r, servings: servings ?? null });

export const entryFromIdea = (i: Idea, servings?: number): MealEntry => logic("mealplan.entry_from_idea", { i, servings: servings ?? null });

/** A copy of the plan with `iso` set to `entry`, or cleared when `entry` is null. */
export const setDay = (plan: WeekPlan, iso: string, entry: MealEntry | null): WeekPlan => logic("mealplan.set_day", { plan, iso, entry });

/** The request body for saving the week that starts on `start`: planned days only, in order. */
export const planToInput = (plan: WeekPlan, start: string): MealDayInput[] => logic("mealplan.plan_to_input", { plan, start });

export function plannedCount(plan: WeekPlan): number {
  return Object.keys(plan).length;
}

// ---- ticking items off ----

type List = Pick<MealShoppingList, "plan" | "unpriced" | "unmatched">;

/** Ticks are per item, so they survive the best split moving an item to another shop. */
export const itemTickId = (item: string): string => logic("mealplan.item_tick_id", { item });

export const unmatchedTickId = (name: string): string => logic("mealplan.unmatched_tick_id", { name });

/** Everything on the list that can be ticked, each once. */
export const tickIds = (list: List): string[] => logic("mealplan.tick_ids", { list });

export const toggleTick = (ticks: readonly string[], id: string): string[] => logic("mealplan.toggle_tick", { ticks, id });

/** Drops ticks of things that are no longer on the list (a recipe was swapped, say). */
export const pruneTicks = (ticks: readonly string[], list: List): string[] => logic("mealplan.prune_ticks", { ticks, list });

export const tickProgress = (list: List, ticks: readonly string[]): { done: number; total: number } => logic("mealplan.tick_progress", { list, ticks });

/** Where the ticks of a week are kept on the device. */
export const ticksKey = (start: string): string => logic("mealplan.ticks_key", { start });

export const serializeTicks = (ticks: readonly string[]): string => logic("mealplan.serialize_ticks", { ticks });

/** Unreadable or foreign data gives no ticks instead of an error. */
export const parseTicks = (raw: string | null | undefined): string[] => logic("mealplan.parse_ticks", { raw: raw ?? null });

// ---- wording ----

export type Verdict = { tone: "good" | "bad" | "neutral"; title: string; detail: string };

/** Whether the week's shopping fits what is left of the groceries budget. */
export const budgetVerdict = (b: MealShoppingList["budget"]): Verdict => logic("mealplan.budget_verdict", { b });

/** One line on what the best plan is. */
export const planHeadline = (plan: NonNullable<MealShoppingList["plan"]>): string => logic("mealplan.plan_headline", { plan });

/** `Lidl 12,30 €`, with a note when the shop lacks some of the items. */
export const chainTotalText = (c: MealShoppingList["per_chain"][number]): string => logic("mealplan.chain_total_text", { c });

/** The detail line of a list item: `2 × 500 g, need 1 kg`. */
export const itemDetail = (i: Pick<MealShoppingList["unpriced"][number], "packs" | "pack" | "needed">): string => logic("mealplan.item_detail", { i });

/** Ingredient of a suggested recipe that has no known item: `Safran: 1 Prise, 2 Fäden`. */
export const unmatchedText = (u: MealShoppingList["unmatched"][number]): string => logic("mealplan.unmatched_text", { u });
