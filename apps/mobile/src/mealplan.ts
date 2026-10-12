/**
 * Pure logic behind the meal plan screen, kept free of React so it can be unit-tested with plain
 * Node: week math (weeks run Monday to Sunday and are named by their Monday), turning picked
 * recipes into plan entries, the ticks on the shopping list, and the wording of the budget check.
 * Money is integer cents; the server does the arithmetic, the words are chosen here.
 */
import type { Idea, MealDay, MealDayInput, MealShoppingList, RecipeMatch } from "./api/client";
import { formatCents } from "./format";

export const MAX_SERVINGS = 20;

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHAIN_NAMES: Record<string, string> = { aldi: "Aldi", lidl: "Lidl", kaufland: "Kaufland", rewe: "Rewe" };

export function chainName(chain: string): string {
  return CHAIN_NAMES[chain] ?? chain;
}

// ---- weeks ----

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  return toIso(toUtc(iso) + days * DAY_MS);
}

/** The Monday of the week that contains `iso` (`YYYY-MM-DD`). */
export function weekStart(iso: string): string {
  const sinceMonday = (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
  return addDays(iso, -sinceMonday);
}

/** The seven days of the week, Monday first. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The Monday `weeks` weeks after (or, negative, before) `start`. */
export function shiftWeek(start: string, weeks: number): string {
  return addDays(start, weeks * 7);
}

/** `Mon` ... `Sun` */
export function weekdayName(iso: string): string {
  return WEEKDAYS[(new Date(toUtc(iso)).getUTCDay() + 6) % 7];
}

/** `2026-10-12` -> `12.10.` */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

/** `12.10. – 18.10.2026`, with both years when the week spans New Year. */
export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const [sy] = start.split("-");
  const [ey] = end.split("-");
  const from = sy === ey ? shortDate(start) : `${shortDate(start)}${sy}`;
  return `${from} – ${shortDate(end)}${ey}`;
}

/** Where `start` is relative to the week that contains `today`. */
export function weekRelation(start: string, today: string): "this" | "next" | "last" | "other" {
  const current = weekStart(today);
  if (start === current) return "this";
  if (start === shiftWeek(current, 1)) return "next";
  if (start === shiftWeek(current, -1)) return "last";
  return "other";
}

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

export function clampServings(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.round(n), 1), MAX_SERVINGS);
}

export function planFromDays(days: MealDay[]): WeekPlan {
  const plan: WeekPlan = {};
  for (const d of days) {
    plan[d.date] = {
      recipe_id: d.recipe_id ?? null,
      title: d.title,
      servings: d.servings,
      recipe_servings: d.recipe_servings,
      ingredients: d.ingredients.map((i) => ({ name: i.name, amount: i.amount })),
    };
  }
  return plan;
}

export function entryFromRecipe(r: Pick<RecipeMatch, "id" | "title" | "servings" | "ingredients">, servings?: number): MealEntry {
  return {
    recipe_id: r.id,
    title: r.title,
    servings: clampServings(servings ?? r.servings),
    recipe_servings: r.servings,
    ingredients: r.ingredients.map((i) => ({ name: i.name, amount: i.amount })),
  };
}

export function entryFromIdea(i: Idea, servings?: number): MealEntry {
  return {
    recipe_id: null,
    title: i.title.trim(),
    servings: clampServings(servings ?? i.servings),
    recipe_servings: clampServings(i.servings),
    ingredients: i.ingredients.map((g) => ({ name: g.name, amount: g.amount })),
  };
}

/** A copy of the plan with `iso` set to `entry`, or cleared when `entry` is null. */
export function setDay(plan: WeekPlan, iso: string, entry: MealEntry | null): WeekPlan {
  const next = { ...plan };
  if (entry) next[iso] = entry;
  else delete next[iso];
  return next;
}

/** The request body for saving the week that starts on `start`: planned days only, in order. */
export function planToInput(plan: WeekPlan, start: string): MealDayInput[] {
  return weekDays(start).flatMap((date): MealDayInput[] => {
    const e = plan[date];
    if (!e) return [];
    const servings = clampServings(e.servings);
    if (e.recipe_id) return [{ date, recipe_id: e.recipe_id, servings }];
    return [
      {
        date,
        title: e.title,
        servings,
        recipe_servings: clampServings(e.recipe_servings),
        ingredients: e.ingredients.map((i) => ({ name: i.name, amount: i.amount })),
      },
    ];
  });
}

export function plannedCount(plan: WeekPlan): number {
  return Object.keys(plan).length;
}

// ---- ticking items off ----

type List = Pick<MealShoppingList, "plan" | "unpriced" | "unmatched">;

/** Ticks are per item, so they survive the best split moving an item to another shop. */
export function itemTickId(item: string): string {
  return `item:${item}`;
}

export function unmatchedTickId(name: string): string {
  return `name:${name.trim().toLowerCase()}`;
}

/** Everything on the list that can be ticked, each once. */
export function tickIds(list: List): string[] {
  const ids = new Set<string>();
  for (const stop of list.plan?.stops ?? []) for (const i of stop.items) ids.add(itemTickId(i.item));
  for (const i of list.unpriced) ids.add(itemTickId(i.item));
  for (const u of list.unmatched) ids.add(unmatchedTickId(u.name));
  return [...ids];
}

export function toggleTick(ticks: readonly string[], id: string): string[] {
  return ticks.includes(id) ? ticks.filter((t) => t !== id) : [...ticks, id];
}

/** Drops ticks of things that are no longer on the list (a recipe was swapped, say). */
export function pruneTicks(ticks: readonly string[], list: List): string[] {
  const valid = new Set(tickIds(list));
  return ticks.filter((t) => valid.has(t));
}

export function tickProgress(list: List, ticks: readonly string[]): { done: number; total: number } {
  const ids = tickIds(list);
  const ticked = new Set(ticks);
  return { done: ids.filter((id) => ticked.has(id)).length, total: ids.length };
}

/** Where the ticks of a week are kept on the device. */
export function ticksKey(start: string): string {
  return `financer.mealplan.ticks.${start}`;
}

export function serializeTicks(ticks: readonly string[]): string {
  return JSON.stringify([...new Set(ticks)]);
}

/** Unreadable or foreign data gives no ticks instead of an error. */
export function parseTicks(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ---- wording ----

export type Verdict = { tone: "good" | "bad" | "neutral"; title: string; detail: string };

/** Whether the week's shopping fits what is left of the groceries budget. */
export function budgetVerdict(b: MealShoppingList["budget"]): Verdict {
  const unpriced =
    b.unpriced_count > 0
      ? ` ${b.unpriced_count} item${b.unpriced_count === 1 ? " has" : "s have"} no price and ${b.unpriced_count === 1 ? "is" : "are"} not counted.`
      : "";
  if (b.estimated_cents === 0 && b.unpriced_count > 0) {
    return { tone: "neutral", title: "No prices for this list yet", detail: `Refresh the prices on the Prices tab to see the cost.${unpriced}` };
  }
  const cost = `About ${formatCents(b.estimated_cents)} for the week.`;
  if (b.budget_cents == null || b.left_after_cents == null || b.fits == null) {
    return { tone: "neutral", title: cost, detail: `Set a groceries limit in Budget to see if it fits.${unpriced}` };
  }
  if (b.fits) {
    return {
      tone: "good",
      title: "Fits your groceries budget",
      detail: `${cost} ${formatCents(b.left_after_cents)} of ${formatCents(b.budget_cents)} stays left.${unpriced}`,
    };
  }
  return {
    tone: "bad",
    title: `${formatCents(-b.left_after_cents)} over your groceries budget`,
    detail: `${cost} Only ${formatCents(Math.max(b.budget_cents, 0))} is left this period.${unpriced}`,
  };
}

/** One line on what the best plan is. */
export function planHeadline(plan: NonNullable<MealShoppingList["plan"]>): string {
  if (plan.split) {
    return `Best split over ${plan.stops.length} shops: ${formatCents(plan.total_cents)}, ${formatCents(plan.saving_cents)} cheaper than one shop`;
  }
  const only = plan.stops[0];
  return only ? `Cheapest at ${chainName(only.chain)}: ${formatCents(plan.total_cents)}` : formatCents(plan.total_cents);
}

/** `Lidl 12,30 €`, with a note when the shop lacks some of the items. */
export function chainTotalText(c: MealShoppingList["per_chain"][number]): string {
  const base = `${chainName(c.chain)} ${formatCents(c.total_cents)}`;
  return c.complete ? base : `${base} (lacks ${c.missing.length})`;
}

/** The detail line of a list item: `2 × 500 g, need 1 kg`. */
export function itemDetail(i: Pick<MealShoppingList["unpriced"][number], "packs" | "pack" | "needed">): string {
  return `${i.packs} × ${i.pack}, need ${i.needed}`;
}

/** Ingredient of a suggested recipe that has no known item: `Safran: 1 Prise, 2 Fäden`. */
export function unmatchedText(u: MealShoppingList["unmatched"][number]): string {
  return u.amounts.length ? `${u.name}: ${u.amounts.join(", ")}` : u.name;
}
