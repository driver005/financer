/**
 * Data and geometry for the pictures on the Today screen: the spending curve of the budget
 * period, the last seven days and the split by category. The rules are in Rust (crates/logic,
 * charts.rs). Every picture comes with a sentence (see the `*Summary` functions) so it never is
 * the only place the information lives.
 */
import { logic } from "../../../packages/wire/src/logic";
import type { Point } from "./charts";

type Tx = { booking_date: string; amount_cents: number; category?: string | null };
export type Span = { start: string; end: string };

/** Money that left the account for something bought: not income, not a transfer to savings. */
export const isSpend = (t: Tx): boolean => logic("charts.is_spend", { t });

export type PeriodCurve = {
  /** Days in the period, both ends included. */
  days: number;
  /** Index (0-based) of today inside the period, clamped to `0..days-1`. */
  todayIndex: number;
  /** Cents spent in total up to and including each day, from the first day to today. */
  cumulative: number[];
  /** Spent in the period up to today. */
  spent: number;
  /** Where the period is expected to end: `spent` plus what is still planned. `null` without a forecast. */
  projectedEnd: number | null;
};

/**
 * The running total of spending from the first day of the period to `today`. `stillToCome` is the
 * money the forecast expects on top (fixed costs still due plus the pace of everyday spending);
 * without it the curve has no projected end.
 */
export const periodCurve = (txs: Tx[], period: Span, today: string, stillToCome: number | null): PeriodCurve =>
  logic("charts.period_curve", { txs, period, today, still_to_come: stillToCome });

export type CurveGeometry = {
  /** The solid line, first day to today. */
  solid: Point[];
  /** From today to the projected end of the period; empty without a projection. */
  dashed: Point[];
  today: Point;
};

/**
 * Points for `curve` in a `width` x `height` box. The y axis starts at 0 and ends at the larger
 * of the spending so far and the projected end, so the dashed part always fits. The x axis is
 * the whole period, so the curve visibly stops at today.
 */
export const curveGeometry = (curve: PeriodCurve, width: number, height: number, pad = 4): CurveGeometry =>
  logic("charts.curve_geometry", { curve, width, height, pad });

/** One sentence for the curve. */
export const curveSummary = (curve: PeriodCurve): string => logic("charts.curve_summary", { curve });

export type SpendComparison = {
  /** Spent in the first `days` days of the period. */
  current: number;
  /** Spent in the first `days` days of the period before. */
  previous: number;
  /** Whole percent against the period before at the same point; `null` when it had nothing to compare. */
  deltaPercent: number | null;
  days: number;
};

/**
 * Spending so far against the same number of days of the previous period, so a half-finished month
 * is not compared with a whole one. `previous` is the period right before `period`.
 */
export const spendComparison = (txs: Tx[], period: Span, previous: Span, today: string): SpendComparison =>
  logic("charts.spend_comparison", { txs, period, previous, today });

export type WeekBar = { iso: string; letter: string; cents: number; today: boolean };
export type Week = {
  bars: WeekBar[];
  total: number;
  /** Total of the seven days before. */
  previousTotal: number;
  /** Whole percent against the seven days before; `null` when there is nothing to compare with. */
  deltaPercent: number | null;
  /** Average per day over the seven days. */
  average: number;
};

/** Spending of the last seven days up to and including `today`, oldest first. */
export const lastWeek = (txs: Tx[], today: string): Week => logic("charts.last_week", { txs, today });

/** One sentence for the week chart. */
export const weekSummary = (w: Week): string => logic("charts.week_summary", { w });

export type Share = { category: string; label: string; cents: number; share: number };

/** What the period's spending went to: the biggest categories, the rest folded into `Other`. */
export const categoryShares = (txs: Tx[], period: Span, limit = 5): { total: number; shares: Share[] } =>
  logic("charts.category_shares", { txs, period, limit });

/** One sentence for the donut. */
export const sharesSummary = (total: number, shares: Share[]): string => logic("charts.shares_summary", { total, shares });
