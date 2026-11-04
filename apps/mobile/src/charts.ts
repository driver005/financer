/**
 * Data and geometry for the small charts (sparkline and bars) plus the sentence that goes with
 * each, so a screen reader and a glance at the text get the same message as the picture. The rules
 * are in Rust (crates/logic, charts.rs); the types are here.
 */
import { logic } from "../../../packages/wire/src/logic";

export type Point = { x: number; y: number };

export type SpendingTrend = {
  /** Cents spent per day, oldest first, `days` long. Refunds and income do not count. */
  series: number[];
  /** First day of the series (`YYYY-MM-DD`). */
  from: string;
  total: number;
  /** Total of the `days` days right before the series. */
  previousTotal: number;
  /** Change against the previous window in whole percent; `null` when there is nothing to compare with. */
  deltaPercent: number | null;
  /** Index of the most expensive day in the series; `null` when nothing was spent. */
  peak: number | null;
};

type Tx = { booking_date: string; amount_cents: number };

/** Spending per day over the last `days` days up to and including `today`, and the window before it. */
export const spendingTrend = (txs: Tx[], today: string, days: number): SpendingTrend => logic("charts.spending_trend", { txs, today, days });

/** One sentence for the spending chart, e.g. `Spent 412,30 € in the last 14 days, 12 % less than the 14 days before.` */
export const trendSummary = (t: SpendingTrend, days: number): string => logic("charts.trend_summary", { t, days });

/** The day with the highest spend as text, or `null`. */
export const peakText = (t: SpendingTrend): string | null => logic("charts.peak_text", { t });

export type CategoryCompare = { category: string; current: number; previous: number };

/** The `limit` categories with the highest spend this or last period, for a grouped bar chart. */
export const topCategories = (
  current: { category: string; spent_cents: number }[],
  previous: { category: string; spent_cents: number }[],
  limit = 5,
): CategoryCompare[] => logic("charts.top_categories", { current, previous, limit });

/** One sentence for the category comparison. */
export const compareSummary = (rows: CategoryCompare[]): string => logic("charts.compare_summary", { rows });
