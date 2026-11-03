/**
 * The calendars that fill themselves from the rest of the app: payday and the charges of
 * subscriptions (money), the planned meals (groceries) and the end of a contract (the shopping
 * assistant). Each one is a read-only calendar with its own colour that can be hidden; tapping an
 * event opens the screen it comes from. The builders are pure and unit-tested; `loadFeeds` fetches.
 */
import type { Api } from "./api/client";
import { formatMoney } from "./format";
import { addDays, isoOf, parseDate, weekdayIndex, type Occurrence, type Tone } from "./calendar";

export type FeedKey = "payday" | "charges" | "meals" | "shopping";

export type FeedDef = { key: FeedKey; name: string; description: string; tone: Tone; source: string };

export const FEEDS: readonly FeedDef[] = [
  { key: "payday", name: "Payday", description: "The day your budget period starts.", tone: "success", source: "Money" },
  { key: "charges", name: "Subscription charges", description: "Charges expected from your subscriptions.", tone: "warning", source: "Subscription" },
  { key: "meals", name: "Meal plan", description: "The meals you planned.", tone: "info", source: "Meal" },
  { key: "shopping", name: "Shopping", description: "When a phone or internet contract can be ended.", tone: "neutral", source: "Shopping" },
];

const feed = (key: FeedKey): FeedDef => FEEDS.find((f) => f.key === key)!;

type Base = Omit<Occurrence, "key" | "eventId" | "title" | "startDate" | "endDate" | "notes" | "tone" | "href" | "source" | "location" | "calendarId">;
const BASE: Base = { allDay: true, startTime: null, endTime: null, repeats: false, readOnly: true };

function occurrence(key: FeedKey, id: string, title: string, date: string, href: string, notes?: string): Occurrence {
  const f = feed(key);
  return { ...BASE, key: `${key}:${id}`, eventId: `${key}:${id}`, calendarId: key, title, startDate: date, endDate: date, notes, tone: f.tone, href, source: f.source };
}

/** The payday of every month that touches the range (a day from 1 to 28). */
export function paydayOccurrences(payday: number, from: string, to: string): Occurrence[] {
  const day = Math.min(28, Math.max(1, payday));
  const a = parseDate(from);
  const b = parseDate(to);
  const out: Occurrence[] = [];
  for (let index = a.y * 12 + (a.m - 1); index <= b.y * 12 + (b.m - 1); index++) {
    const date = isoOf(Math.floor(index / 12), (index % 12) + 1, day);
    if (date >= from && date <= to) out.push(occurrence("payday", date, day === 1 ? "New budget month" : "Payday", date, "/budget", "A new budget period starts."));
  }
  return out;
}

export type Charge = { counterparty: string; date: string; amount_cents: number; overdue?: boolean };

/** Expected subscription charges inside the range (an overdue one shows on its expected day). */
export function chargeOccurrences(charges: Charge[], from: string, to: string): Occurrence[] {
  return charges
    .filter((c) => c.date >= from && c.date <= to)
    .map((c) => occurrence("charges", `${c.counterparty}:${c.date}`, `${c.counterparty} ${formatMoney(-c.amount_cents)}`, c.date, "/subscriptions", c.overdue ? "Expected, not booked yet." : "Expected charge."));
}

export type PlannedMeal = { date: string; title: string; servings: number };

export function mealOccurrences(meals: PlannedMeal[], from: string, to: string): Occurrence[] {
  return meals
    .filter((m) => m.date >= from && m.date <= to)
    .map((m) => occurrence("meals", m.date, m.title, m.date, "/mealplan", `${m.servings} ${m.servings === 1 ? "serving" : "servings"}`));
}

export type Contract = { category: string; name: string; plan: string | null; endsOn: string };

/** The day a contract ends, and the day to look for a new one: two months before. */
export function contractOccurrences(contracts: Contract[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const c of contracts) {
    const label = c.plan ? `${c.name}: ${c.plan}` : c.name;
    if (c.endsOn >= from && c.endsOn <= to) out.push(occurrence("shopping", `${c.category}:ends`, `${label} ends`, c.endsOn, "/shop", "Time to compare plans."));
    const look = addMonthsSimple(c.endsOn, -2);
    if (look >= from && look <= to) out.push(occurrence("shopping", `${c.category}:look`, `Look for a new ${c.name.toLowerCase()} plan`, look, "/shop", `${label} ends on ${c.endsOn}.`));
  }
  return out;
}

function addMonthsSimple(iso: string, n: number): string {
  const { y, m, d } = parseDate(iso);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return isoOf(ny, nm, Math.min(d, new Date(Date.UTC(ny, nm, 0)).getUTCDate()));
}

/** The Mondays of the weeks that touch the range. */
export function weekStarts(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = addDays(from, -weekdayIndex(from)); d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}

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
