/** Pure, client-safe scheduling helpers for recurring transactions (unit-tested). */
import { addDays, addMonthsKeepDay } from "./dates";

export type RecurringCycle = "weekly" | "monthly" | "yearly";
export const RECURRING_CYCLES = ["weekly", "monthly", "yearly"] as const;
/** Max occurrences posted for one item in one catch-up run (older missed ones are skipped). */
export const RECURRING_CATCHUP_CAP = 12;

export type RecurringSchedule = {
  cycle: RecurringCycle;
  interval?: number | null;
  day_of_month?: number | null;
  start_date: string;
};

const dayOf = (date: string) => Number(date.slice(8, 10));
const step = (s: RecurringSchedule) => Math.max(1, Math.floor(Number(s.interval) || 1));

/** Day of month the schedule is anchored to (explicit day_of_month, else the start date's day). */
export function anchorDay(s: RecurringSchedule): number {
  const d = Number(s.day_of_month);
  return d >= 1 && d <= 31 ? Math.floor(d) : dayOf(s.start_date);
}

/** Occurrence after `date`; monthly/yearly clamp to month end (31 → Feb 28/29) and keep the anchor. */
export function nextOccurrence(date: string, s: RecurringSchedule): string {
  if (s.cycle === "weekly") return addDays(date, 7 * step(s));
  const months = s.cycle === "yearly" ? 12 * step(s) : step(s);
  return addMonthsKeepDay(date, months, anchorDay(s));
}

/** First occurrence on/after start_date (respecting day_of_month for monthly/yearly). */
export function firstDue(s: RecurringSchedule): string {
  if (s.cycle === "weekly" || s.day_of_month == null) return s.start_date;
  const sameMonth = addMonthsKeepDay(s.start_date, 0, anchorDay(s));
  if (sameMonth >= s.start_date) return sameMonth;
  return addMonthsKeepDay(s.start_date, s.cycle === "yearly" ? 12 : 1, anchorDay(s));
}

export type DueResult = {
  /** Occurrence dates to post now (oldest first, at most `cap`). */
  dates: string[];
  /** next_due after posting them. */
  next: string;
  /** True when the next occurrence lies after end_date (item should be deactivated). */
  ended: boolean;
  /** Missed occurrences skipped because of the catch-up cap. */
  skipped: number;
};

/** Due occurrences from next_due up to and including `today` (and end_date), capped to the latest `cap`. */
export function dueOccurrences(
  item: RecurringSchedule & { next_due: string; end_date?: string | null },
  today: string,
  cap = RECURRING_CATCHUP_CAP,
): DueResult {
  const end = item.end_date || null;
  const all: string[] = [];
  let d = item.next_due;
  // Guard against runaway loops (e.g. weekly items untouched for decades).
  for (let i = 0; i < 5000 && d <= today && (!end || d <= end); i++) {
    all.push(d);
    d = nextOccurrence(d, item);
  }
  const dates = all.slice(Math.max(0, all.length - cap));
  return { dates, next: d, ended: !!end && d > end, skipped: all.length - dates.length };
}

/** next_due when resuming a paused item: the first occurrence on/after today (no catch-up burst). */
export function resumeNextDue(
  item: RecurringSchedule & { next_due: string },
  today: string,
): string {
  let d = item.next_due;
  for (let i = 0; i < 5000 && d < today; i++) d = nextOccurrence(d, item);
  return d;
}

/** Notes marker that makes auto-posting idempotent (same idea as monthlyFeeMarker). */
export const recurringMarker = (id: string, date: string) => `[auto:recurring:${id}:${date}]`;
/** Idempotency key stored in transactions.external_id (unique index from schema v7). */
export const recurringExternalId = (id: string, date: string) => `recurring:${id}:${date}`;

/** Monthly-equivalent amount, for summary cards. */
export function monthlyEquivalent(amount: number, cycle: RecurringCycle, interval = 1): number {
  const n = Math.max(1, interval || 1);
  if (cycle === "weekly") return (amount * 52) / 12 / n;
  if (cycle === "yearly") return amount / 12 / n;
  return amount / n;
}
