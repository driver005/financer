/**
 * Budget periods on the phone: the same rule as `BudgetPeriod` in crates/core/src/period.rs,
 * so the game layer (streaks, daily goals) agrees with what the server counts as "this month".
 * With payday 1 a period is the calendar month; with payday 25 it runs from the 25th to the
 * 24th. The start day in a month is `min(payday, days in that month)`.
 */

export type Period = { start: string; end: string };

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The date a period starts on in `year`/`month` (1-12). */
function startIn(year: number, month: number, payday: number): string {
  const day = Math.min(Math.max(Math.trunc(payday) || 1, 1), daysInMonth(year, month));
  return toIso(Date.UTC(year, month - 1, day));
}

/** The period that starts in `year`/`month`; `month` may be 0 to mean December of the year before. */
function periodStartingIn(year: number, month: number, payday: number): Period {
  const index = year * 12 + (month - 1);
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const next = index + 1;
  const start = startIn(y, m, payday);
  const end = toIso(toUtc(startIn(Math.floor(next / 12), (next % 12) + 1, payday)) - DAY_MS);
  return { start, end };
}

/** The period that contains `date` (ISO `YYYY-MM-DD`). */
export function budgetPeriod(date: string, payday = 1): Period {
  const [y, m] = date.split("-").map(Number);
  return date >= startIn(y, m, payday) ? periodStartingIn(y, m, payday) : periodStartingIn(y, m - 1, payday);
}

/** The period right before `period`. */
export function previousPeriod(period: Period, payday = 1): Period {
  return budgetPeriod(toIso(toUtc(period.start) - DAY_MS), payday);
}

/** Number of days in the period, both ends included. */
export function periodDays(period: Period): number {
  return Math.round((toUtc(period.end) - toUtc(period.start)) / DAY_MS) + 1;
}

/**
 * A short label: the month name for a calendar-month period (`October 2026`), otherwise the
 * date range in German notation (`25.09. – 24.10.2026`).
 */
export function periodLabel(period: Period): string {
  const [sy, sm, sd] = period.start.split("-").map(Number);
  const [ey, em, ed] = period.end.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (sd === 1 && sy === ey && sm === em) return `${MONTH_NAMES[sm - 1]} ${sy}`;
  const from = sy === ey ? `${pad(sd)}.${pad(sm)}.` : `${pad(sd)}.${pad(sm)}.${sy}`;
  return `${from} – ${pad(ed)}.${pad(em)}.${ey}`;
}

/** The calendar date on this device (not UTC) as `YYYY-MM-DD`. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
