/**
 * Logic for the local notifications: WHAT to tell the user and WHEN, with no device access. The evening,
 * payday and price-drop rules are in Rust (crates/logic, notify_plan.rs); the calendar reminders are
 * planned here, beside the calendar.
 * `native/notifications.ts` schedules what this module decides. Three kinds:
 *
 *  - `evening`: "you have X left today", from the same numbers as the Today screen's
 *    safe-to-spend card.
 *  - `payday`: the day the next budget period starts (the app's existing period rule).
 *  - `priceDrop`: an item from the usual-items list got cheaper; each drop is announced once.
 *  - `events`: the reminders of the calendar's events ("Dentist, in 1 hour").
 *
 * The app is English-only (only the number format is German), so the texts are English.
 * Dates are ISO `YYYY-MM-DD` in the phone's local calendar; times are local hour and minute.
 */
import type { Price, SafeToSpend } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";
import { addDays as addCalendarDays, expand, fromDayNumber, reminderText, stamp, timeOf, type EventRule } from "./calendar";

export type NotifyKind = "evening" | "payday" | "priceDrop" | "events";
export const NOTIFY_KINDS: NotifyKind[] = ["evening", "payday", "priceDrop", "events"];

export type NotifyPrefs = Record<NotifyKind, boolean>;
export const DEFAULT_PREFS: NotifyPrefs = { evening: false, payday: false, priceDrop: false, events: false };

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
export const EVENT_ID_PREFIX = "financer.event.";

/** The next few evening messages (today's with the app's number, later days a projection). */
export function eveningPlan(safe: SafeToSpend, nowMinutes: number, opts: { time?: ClockTime; days?: number } = {}): Planned[] {
  return logic("notify_plan.evening_plan", { safe, now_minutes: nowMinutes, time: opts.time, days: opts.days });
}

/** The next paydays (the first day of the next budget periods) as morning reminders. */
export function paydayPlan(today: string, payday: number, nowMinutes: number, opts: { time?: ClockTime; count?: number } = {}): Planned[] {
  return logic("notify_plan.payday_plan", { today, payday, now_minutes: nowMinutes, time: opts.time, count: opts.count });
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
  return logic("notify_plan.parse_price_memory", { raw: raw ?? null });
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
 * Compare today's cheapest price of each usual item with what was seen before (first sight: remember;
 * a real drop, once: announce; a rise: follow it). Returns the drops (biggest saving first) and the
 * memory to store.
 */
export function findPriceDrops(
  items: { item: string; name: string }[],
  prices: Price[],
  memory: PriceMemory,
): { drops: PriceDrop[]; memory: PriceMemory } {
  return logic("notify_plan.find_price_drops", { items, prices, memory });
}

/** One notification for all drops found in a check (null when there are none). */
export function priceDropMessage(drops: PriceDrop[]): { title: string; body: string } | null {
  return logic("notify_plan.price_drop_message", { drops });
}

// ---- calendar events ----

/** The hour an all-day event's reminders count from (a reminder "1 day before" arrives at 09:00 the day before). */
export const ALL_DAY_TIME = "09:00";
/** The phone keeps at most 64 scheduled notifications; the events get this many of them. */
export const MAX_EVENT_NOTIFICATIONS = 40;
/** How far ahead event reminders are planned. */
export const EVENT_HORIZON_DAYS = 14;

/**
 * The reminders of the events that start in the next two weeks, soonest first, at most
 * `MAX_EVENT_NOTIFICATIONS`. A reminder is "minutes before the start"; an all-day event starts at
 * 09:00 for this. One that is already past is left out. The ids are stable, so a repeated run
 * replaces the earlier schedule instead of doubling it.
 */
export function eventPlan(rules: EventRule[], now: { date: string; minutes: number }, opts: { days?: number; max?: number } = {}): Planned[] {
  const to = addCalendarDays(now.date, opts.days ?? EVENT_HORIZON_DAYS);
  // a reminder a week before an event two weeks away is due today, so look a week past the horizon
  const lookTo = addCalendarDays(to, 7);
  const nowStamp = stamp(now.date, timeOf(now.minutes));
  const out: (Planned & { at: number })[] = [];
  for (const rule of rules) {
    for (const o of expand(rule, now.date, lookTo, "accent")) {
      const start = stamp(o.startDate, o.allDay ? ALL_DAY_TIME : o.startTime);
      for (const before of rule.reminders) {
        const at = start - before;
        if (at <= nowStamp || at > stamp(to, "23:59")) continue;
        const date = fromDayNumber(Math.floor(at / 1440));
        const clock = at - Math.floor(at / 1440) * 1440;
        const when = o.allDay ? "All day" : `Starts at ${o.startTime}`;
        const body = [before === 0 ? when : `${when} (${reminderText(before).replace(/^At the start$/, "now")})`, o.location].filter(Boolean).join(" · ");
        out.push({ id: `${EVENT_ID_PREFIX}${rule.id}:${o.startDate}:${before}`, date, hour: Math.floor(clock / 60), minute: clock % 60, title: o.title, body, at });
      }
    }
  }
  return out
    .sort((a, b) => a.at - b.at)
    .slice(0, opts.max ?? MAX_EVENT_NOTIFICATIONS)
    .map(({ at: _at, ...planned }) => planned);
}
