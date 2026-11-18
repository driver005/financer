/**
 * Pure, client-safe budget math (v11): rollover carry, percent of the effective limit and
 * threshold crossings for instant alerts. Shared by computeBudgets, the alert check and tests.
 *
 * Rollover rule: when `rollover` is on, what is left of a month (effective − spent, negative when
 * overspent) carries into the next month: effective(m) = amount + carry(m),
 * carry(m+1) = effective(m) − spent(m). The chain starts at the month the budget was created and
 * looks back at most ROLLOVER_MAX_MONTHS months, so very old history never dominates. The current
 * `amount` is used for every month in the chain (past limit changes are not recorded).
 */
import { shiftMonth } from "./dates";

export const ROLLOVER_MAX_MONTHS = 12;
/** Alert levels stored in `budget_alerts.level`: 80 = the budget's own alert_percent, 100 = limit. */
export type AlertLevel = 80 | 100;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** First month of the carry chain for `month` (inclusive), or null when nothing can carry. */
export function rolloverStart(month: string, createdMonth: string | null | undefined): string {
  const floor = shiftMonth(month, -ROLLOVER_MAX_MONTHS);
  const created = createdMonth && /^\d{4}-\d{2}$/.test(createdMonth) ? createdMonth : floor;
  return created > floor ? created : floor;
}

/**
 * Amount carried into `month`: walks every month from rolloverStart() to the month before
 * `month`, using `spentByMonth` (YYYY-MM → spent). Returns 0 when the chain is empty.
 */
export function rolloverCarry(
  amount: number,
  month: string,
  createdMonth: string | null | undefined,
  spentByMonth: ReadonlyMap<string, number>,
): number {
  let carry = 0;
  for (let m = rolloverStart(month, createdMonth); m < month; m = shiftMonth(m, 1))
    carry = carry + amount - (spentByMonth.get(m) ?? 0);
  return r2(carry);
}

/**
 * Percent of the limit used. A non-positive effective limit (rollover debt ate it all) counts as
 * already exhausted: 100% plus the spending measured against the base amount.
 */
export function budgetPercent(spent: number, effective: number, amount = effective): number {
  if (effective > 0) return (spent / effective) * 100;
  if (effective === 0 && amount === 0) return 0;
  return 100 + (amount > 0 ? (spent / amount) * 100 : 0);
}

/** Levels crossed going from `before`% to `after`% (warning at alertPercent, limit at 100). */
export function crossedLevels(before: number, after: number, alertPercent: number): AlertLevel[] {
  const warn = Math.min(100, Math.max(1, alertPercent || 80));
  const out: AlertLevel[] = [];
  if (warn < 100 && before < warn && after >= warn) out.push(80);
  if (before < 100 && after >= 100) out.push(100);
  return out;
}

export type BudgetAlert = {
  budget_id: string;
  category: string;
  level: AlertLevel;
  percent: number;
  spent: number;
  effective: number;
  alert_percent: number;
};

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

/** One-line Indonesian alert text (Telegram reply). */
export function budgetAlertText(a: BudgetAlert): string {
  const pct = Math.round(a.percent);
  return a.level === 100
    ? `🔴 Budget ${a.category} terlampaui: ${pct}% (${idr(a.spent)} / ${idr(a.effective)})`
    : `🟠 Budget ${a.category} sudah ${pct}% (${idr(a.spent)} / ${idr(a.effective)})`;
}
