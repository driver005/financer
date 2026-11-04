// Budget periods live in Rust (crates/logic, period.rs), on the rule of `BudgetPeriod` in
// crates/core: the game layer (streaks, daily goals) agrees with what the server counts as "this
// month". What stays here is what asks the device: its clock.
import { logic } from "../../../packages/wire/src/logic";

export type Period = { start: string; end: string };

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The period that contains `date` (ISO `YYYY-MM-DD`). */
export const budgetPeriod = (date: string, payday = 1): Period => logic("period.budget_period", { date, payday });

/** Number of days in `month` (1-12) of `year`. */
export const daysInMonth = (year: number, month: number): number => logic("period.days_in_month", { year, month });

/** The period right before `period`. */
export const previousPeriod = (period: Period, payday = 1): Period => logic("period.previous_period", { period, payday });

/** Number of days in the period, both ends included. */
export const periodDays = (period: Period): number => logic("period.period_days", { period });

/**
 * A short label: the month name for a calendar-month period (`October 2026`), otherwise the
 * date range in German notation (`25.09. – 24.10.2026`).
 */
export const periodLabel = (period: Period): string => logic("period.period_label", { period });

/** The calendar date on this device (not UTC) as `YYYY-MM-DD`. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
