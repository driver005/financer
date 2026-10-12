/**
 * Pure logic for the local notifications: WHAT to tell the user and WHEN, with no device access.
 * `native/notifications.ts` schedules what this module decides. Three kinds:
 *
 *  - `evening`: "you have X left today", from the same numbers as the Today screen's
 *    safe-to-spend card.
 *  - `payday`: the day the next budget period starts (the app's existing period rule).
 *  - `priceDrop`: an item from the usual-items list got cheaper; each drop is announced once.
 *
 * The app is English-only (only the number format is German), so the texts are English.
 * Dates are ISO `YYYY-MM-DD` in the phone's local calendar; times are local hour and minute.
 */
import type { Price, SafeToSpend } from "./api/client";
import { formatCents } from "./format";
import { budgetPeriod, periodLabel } from "./period";

export type NotifyKind = "evening" | "payday" | "priceDrop";
export const NOTIFY_KINDS: NotifyKind[] = ["evening", "payday", "priceDrop"];

export type NotifyPrefs = Record<NotifyKind, boolean>;
export const DEFAULT_PREFS: NotifyPrefs = { evening: false, payday: false, priceDrop: false };

/** Everything is off until the user turns it on; unreadable stored data counts as off. */
export function parsePrefs(raw: string | null | undefined): NotifyPrefs {
  const prefs = { ...DEFAULT_PREFS };
  if (!raw) return prefs;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const kind of NOTIFY_KINDS) prefs[kind] = (parsed as Record<string, unknown>)[kind] === true;
    }
  } catch {
    // keep the defaults
  }
  return prefs;
}

export function anyEnabled(prefs: NotifyPrefs): boolean {
  return NOTIFY_KINDS.some((k) => prefs[k]);
}

export type ClockTime = { hour: number; minute: number };
export const EVENING_TIME: ClockTime = { hour: 18, minute: 0 };
export const PAYDAY_TIME: ClockTime = { hour: 8, minute: 0 };

/** A notification to be delivered at `date` + `hour:minute` local time. */
export type Planned = { id: string; date: string; hour: number; minute: number; title: string; body: string };

export const EVENING_ID_PREFIX = "financer.evening.";
export const PAYDAY_ID_PREFIX = "financer.payday.";

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function minutesOf(t: ClockTime): number {
  return t.hour * 60 + t.minute;
}

/**
 * The next few evening messages. The text is fixed when it is scheduled, so it is only as fresh
 * as the last time the app (or its background task) ran: today's message uses the number the app
 * shows now, later days a projection ("about") from the money still free, divided over the days
 * left. Every run replaces the earlier plan. Nothing is planned without detected income (there is
 * nothing to plan with) or past the end of the budget period (the period resets then).
 *
 * `nowMinutes` is the local time of day in minutes; today's message is skipped once its time passed.
 */
export function eveningPlan(
  safe: SafeToSpend,
  nowMinutes: number,
  opts: { time?: ClockTime; days?: number } = {},
): Planned[] {
  const time = opts.time ?? EVENING_TIME;
  const days = opts.days ?? 3;
  if (!safe.income_detected) return [];
  const out: Planned[] = [];
  for (let k = 0; k < days; k++) {
    const date = addDays(safe.today, k);
    const left = safe.days_left - k; // days left in the period counting that day
    if (date > safe.period_end || left < 1) break;
    if (k === 0 && nowMinutes >= minutesOf(time)) continue;
    let body: string;
    if (safe.available_cents < 0) {
      body = `This period is over budget by ${formatCents(-safe.available_cents)}. Go easy today.`;
    } else {
      const cents = k === 0 ? safe.daily_cents : Math.floor(safe.available_cents / left);
      if (cents <= 0) body = "Nothing is left to spend today.";
      else body = k === 0 ? `You have ${formatCents(cents)} left to spend today.` : `About ${formatCents(cents)} is free to spend today.`;
    }
    out.push({ id: `${EVENING_ID_PREFIX}${date}`, date, ...time, title: "Evening check", body });
  }
  return out;
}

/**
 * The next paydays (the first day of the next budget periods, by the same rule the server uses),
 * as morning reminders. Today counts when it is a payday and the reminder time has not passed.
 */
export function paydayPlan(
  today: string,
  payday: number,
  nowMinutes: number,
  opts: { time?: ClockTime; count?: number } = {},
): Planned[] {
  const time = opts.time ?? PAYDAY_TIME;
  const count = opts.count ?? 2;
  const out: Planned[] = [];
  let period = budgetPeriod(today, payday);
  const entry = (p: { start: string; end: string }): Planned => ({
    id: `${PAYDAY_ID_PREFIX}${p.start}`,
    date: p.start,
    ...time,
    title: "Payday",
    body: `Your new budget period (${periodLabel(p)}) starts today. A good moment to look at your budget.`,
  });
  if (period.start === today && nowMinutes < minutesOf(time)) out.push(entry(period));
  while (out.length < count) {
    period = budgetPeriod(addDays(period.end, 1), payday);
    out.push(entry(period));
  }
  return out;
}

// ---- price drops ----

/** What the app remembers between checks, so the same drop is announced once. */
export type PriceMemory = {
  /** Per catalog item, the price (cents) a drop is measured against. */
  refs: Record<string, number>;
  /** `item:chain:cents` of drops already announced (newest last, capped). */
  announced: string[];
};

export const EMPTY_MEMORY: PriceMemory = { refs: {}, announced: [] };

/** A drop needs to be at least this many percent AND this many cents, so noise stays quiet. */
export const MIN_DROP_PERCENT = 5;
export const MIN_DROP_CENTS = 10;
export const MAX_TRACKED_ITEMS = 40;
export const MAX_ANNOUNCED = 30;

export function parsePriceMemory(raw: string | null | undefined): PriceMemory {
  if (!raw) return { refs: {}, announced: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<PriceMemory> | null;
    const refs: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed?.refs ?? {})) if (typeof v === "number" && Number.isFinite(v) && v > 0) refs[k] = v;
    const announced = Array.isArray(parsed?.announced) ? parsed.announced.filter((a): a is string => typeof a === "string") : [];
    return { refs, announced: announced.slice(-MAX_ANNOUNCED) };
  } catch {
    return { refs: {}, announced: [] };
  }
}

export type PriceDrop = {
  item: string;
  name: string;
  chain: string;
  cents: number;
  wasCents: number;
  pack: string;
  isOffer: boolean;
};

/**
 * Compare today's cheapest price of each usual item with what was seen before.
 *
 *  - First time an item is seen: remember its price, announce nothing.
 *  - Cheaper by the thresholds above and not announced before: a drop; the new price becomes the
 *    reference. A smaller dip leaves the reference alone, so slow declines add up to a drop.
 *  - Dearer: the reference follows the price up, so a later fall is measured from the new level.
 *
 * Returns the drops (biggest saving first) and the memory to store. The input memory is not changed.
 */
export function findPriceDrops(
  items: { item: string; name: string }[],
  prices: Price[],
  memory: PriceMemory,
): { drops: PriceDrop[]; memory: PriceMemory } {
  const refs: Record<string, number> = {};
  const announced = [...memory.announced];
  const drops: PriceDrop[] = [];

  for (const { item, name } of items.slice(0, MAX_TRACKED_ITEMS)) {
    const candidates = prices.filter((p) => p.item === item && p.price_cents > 0);
    const before = memory.refs[item];
    const best = [...candidates].sort((a, b) => a.price_cents - b.price_cents || a.chain.localeCompare(b.chain))[0];
    if (!best) {
      if (before !== undefined) refs[item] = before; // nothing listed right now: keep what we knew
      continue;
    }
    if (before === undefined || best.price_cents > before) {
      refs[item] = best.price_cents;
      continue;
    }
    if (best.price_cents === before) {
      refs[item] = before;
      continue;
    }
    const saved = before - best.price_cents;
    if (saved < MIN_DROP_CENTS || saved * 100 < before * MIN_DROP_PERCENT) {
      refs[item] = before;
      continue;
    }
    refs[item] = best.price_cents;
    const key = `${item}:${best.chain}:${best.price_cents}`;
    if (announced.includes(key)) continue;
    announced.push(key);
    drops.push({ item, name, chain: best.chain, cents: best.price_cents, wasCents: before, pack: best.reference_pack, isOffer: best.is_offer });
  }

  drops.sort((a, b) => b.wasCents - b.cents - (a.wasCents - a.cents) || a.item.localeCompare(b.item));
  return { drops, memory: { refs, announced: announced.slice(-MAX_ANNOUNCED) } };
}

const CHAINS: Record<string, string> = { aldi: "Aldi", lidl: "Lidl", kaufland: "Kaufland", rewe: "Rewe" };

function chainName(chain: string): string {
  return CHAINS[chain] ?? chain;
}

/** One notification for all drops found in a check (null when there are none). */
export function priceDropMessage(drops: PriceDrop[]): { title: string; body: string } | null {
  if (drops.length === 0) return null;
  const line = (d: PriceDrop) =>
    `${d.name}: ${formatCents(d.cents)} per ${d.pack} at ${chainName(d.chain)} (was ${formatCents(d.wasCents)})${d.isOffer ? ", on offer" : ""}`;
  if (drops.length === 1) return { title: `Cheaper: ${drops[0].name}`, body: line(drops[0]) };
  const shown = drops.slice(0, 3).map(line).join("\n");
  const more = drops.length > 3 ? `\nand ${drops.length - 3} more` : "";
  return { title: `${drops.length} of your usual items got cheaper`, body: shown + more };
}
