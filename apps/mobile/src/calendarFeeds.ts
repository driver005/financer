/**
 * The calendars that fill themselves from the rest of the app: payday and the charges of
 * subscriptions (money), the planned meals (groceries) and the end of a contract (the shopping
 * assistant). Each one is a read-only calendar with its own colour that can be hidden; tapping an
 * event opens the screen it comes from. The builders are in Rust (crates/logic, calendar_feeds.rs); `loadFeeds` fetches.
 */
import type { Api } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";
import type { Occurrence, Tone } from "./calendar";

export type FeedKey = "payday" | "charges" | "meals" | "shopping";

export type FeedDef = { key: FeedKey; name: string; description: string; tone: Tone; source: string };

export const FEEDS: readonly FeedDef[] = [
  { key: "payday", name: "Payday", description: "The day your budget period starts.", tone: "success", source: "Money" },
  { key: "charges", name: "Subscription charges", description: "Charges expected from your subscriptions.", tone: "warning", source: "Subscription" },
  { key: "meals", name: "Meal plan", description: "The meals you planned.", tone: "info", source: "Meal" },
  { key: "shopping", name: "Shopping", description: "When a phone or internet contract can be ended.", tone: "neutral", source: "Shopping" },
];

/** The payday of every month that touches the range (a day from 1 to 28). */
export const paydayOccurrences = (payday: number, from: string, to: string): Occurrence[] =>
  logic("calendar_feeds.payday_occurrences", { payday, from, to });

export type Charge = { counterparty: string; date: string; amount_cents: number; overdue?: boolean };

/** Expected subscription charges inside the range (an overdue one shows on its expected day). */
export const chargeOccurrences = (charges: Charge[], from: string, to: string): Occurrence[] =>
  logic("calendar_feeds.charge_occurrences", { charges, from, to });

export type PlannedMeal = { date: string; title: string; servings: number };

export const mealOccurrences = (meals: PlannedMeal[], from: string, to: string): Occurrence[] =>
  logic("calendar_feeds.meal_occurrences", { meals, from, to });

export type Contract = { category: string; name: string; plan: string | null; endsOn: string };

/** The day a contract ends, and the day to look for a new one: two months before. */
export const contractOccurrences = (contracts: Contract[], from: string, to: string): Occurrence[] =>
  logic("calendar_feeds.contract_occurrences", { contracts, from, to });

/** The Mondays of the weeks that touch the range. */
export const weekStarts = (from: string, to: string): string[] => logic("calendar_feeds.week_starts", { from, to });

/** Fetches what the visible feeds need. A feed that cannot be loaded (no shop, nothing planned) is left out, never an error. */
export async function loadFeeds(api: Api, from: string, to: string, hidden: ReadonlySet<string>): Promise<Occurrence[]> {
  const shown = (k: FeedKey) => !hidden.has(k);
  const safe = async <T>(run: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await run();
    } catch {
      return empty;
    }
  };
  const [payday, charges, meals, contracts] = await Promise.all([
    shown("payday") ? safe(async () => (await api.settings()).payday, null) : null,
    shown("charges") ? safe(async () => (await api.subscriptions(120)).upcoming, [] as Charge[]) : [],
    shown("meals")
      ? safe(async () => (await Promise.all(weekStarts(from, to).map((w) => api.mealPlan(w)))).flatMap((p) => p.days.map((d) => ({ date: d.date, title: d.title, servings: d.servings }))), [] as PlannedMeal[])
      : [],
    shown("shopping") ? api.shopContracts() : [],
  ]);
  return [
    ...(payday ? paydayOccurrences(payday, from, to) : []),
    ...chargeOccurrences(charges, from, to),
    ...mealOccurrences(meals, from, to),
    ...contractOccurrences(contracts, from, to),
  ];
}
