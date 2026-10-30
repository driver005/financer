/**
 * Data and geometry for the pictures on the Today screen: the spending curve of the budget
 * period, the last seven days and the split by category. Pure (no React Native), unit-tested.
 * Every picture comes with a sentence (see the `*Summary` functions) so it never is the only
 * place the information lives.
 */
import { formatMoney } from "./format";
import { categoryLabel } from "./categoryIcons";
import type { Point } from "./charts";

const DAY_MS = 86_400_000;

type Tx = { booking_date: string; amount_cents: number; category?: string | null };
export type Span = { start: string; end: string };

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Money that left the account for something bought: not income, not a transfer to savings. */
export function isSpend(t: Tx): boolean {
  return t.amount_cents < 0 && t.category !== "savings" && t.category !== "income";
}

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
export function periodCurve(txs: Tx[], period: Span, today: string, stillToCome: number | null): PeriodCurve {
  const start = toUtc(period.start);
  const days = Math.max(1, Math.round((toUtc(period.end) - start) / DAY_MS) + 1);
  const todayIndex = Math.min(days - 1, Math.max(0, Math.round((toUtc(today) - start) / DAY_MS)));
  const perDay = new Array<number>(todayIndex + 1).fill(0);
  for (const t of txs) {
    if (!isSpend(t)) continue;
    const i = Math.round((toUtc(t.booking_date) - start) / DAY_MS);
    if (i >= 0 && i <= todayIndex) perDay[i] += -t.amount_cents;
  }
  let run = 0;
  const cumulative = perDay.map((v) => (run += v));
  const spent = cumulative[cumulative.length - 1] ?? 0;
  return { days, todayIndex, cumulative, spent, projectedEnd: stillToCome === null ? null : spent + Math.max(0, stillToCome) };
}

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
export function curveGeometry(curve: PeriodCurve, width: number, height: number, pad = 4): CurveGeometry {
  const top = Math.max(curve.spent, curve.projectedEnd ?? 0, 1);
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  const x = (i: number) => pad + (curve.days === 1 ? innerW / 2 : (innerW * i) / (curve.days - 1));
  const y = (cents: number) => pad + innerH - (innerH * Math.max(0, cents)) / top;
  const solid = curve.cumulative.map((c, i) => ({ x: x(i), y: y(c) }));
  const today = solid[solid.length - 1] ?? { x: x(0), y: y(0) };
  const dashed =
    curve.projectedEnd !== null && curve.todayIndex < curve.days - 1 ? [today, { x: x(curve.days - 1), y: y(curve.projectedEnd) }] : [];
  return { solid, dashed, today };
}

/** One sentence for the curve. */
export function curveSummary(curve: PeriodCurve): string {
  const so = `Spent ${formatMoney(curve.spent)} in the first ${curve.todayIndex + 1} of ${curve.days} days of this period`;
  return curve.projectedEnd === null ? `${so}.` : `${so}; at this pace about ${formatMoney(curve.projectedEnd)} by the end.`;
}

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

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Spending of the last seven days up to and including `today`, oldest first. */
export function lastWeek(txs: Tx[], today: string): Week {
  const end = toUtc(today);
  const start = end - 6 * DAY_MS;
  const prevStart = start - 7 * DAY_MS;
  const cents = new Array<number>(7).fill(0);
  let previousTotal = 0;
  for (const t of txs) {
    if (!isSpend(t)) continue;
    const ms = toUtc(t.booking_date);
    if (ms >= start && ms <= end) cents[Math.round((ms - start) / DAY_MS)] += -t.amount_cents;
    else if (ms >= prevStart && ms < start) previousTotal += -t.amount_cents;
  }
  const total = cents.reduce((a, b) => a + b, 0);
  return {
    bars: cents.map((c, i) => {
      const ms = start + i * DAY_MS;
      return { iso: toIso(ms), letter: LETTERS[new Date(ms).getUTCDay()], cents: c, today: i === 6 };
    }),
    total,
    previousTotal,
    deltaPercent: previousTotal > 0 ? Math.round(((total - previousTotal) / previousTotal) * 100) : null,
    average: Math.round(total / 7),
  };
}

/** One sentence for the week chart. */
export function weekSummary(w: Week): string {
  if (w.total === 0) return "Nothing spent in the last 7 days.";
  const base = `Spent ${formatMoney(w.total)} in the last 7 days, ${formatMoney(w.average)} a day`;
  if (w.deltaPercent === null) return `${base}.`;
  if (w.deltaPercent === 0) return `${base}, the same as the 7 days before.`;
  return `${base}, ${Math.abs(w.deltaPercent)} % ${w.deltaPercent > 0 ? "more" : "less"} than the 7 days before.`;
}

export type Share = { category: string; label: string; cents: number; share: number };

/** What the period's spending went to: the biggest categories, the rest folded into `Other`. */
export function categoryShares(txs: Tx[], period: Span, limit = 5): { total: number; shares: Share[] } {
  const sums = new Map<string, number>();
  for (const t of txs) {
    if (!isSpend(t) || t.booking_date < period.start || t.booking_date > period.end) continue;
    const key = t.category || "other";
    sums.set(key, (sums.get(key) ?? 0) + -t.amount_cents);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return { total: 0, shares: [] };
  const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const row = (category: string, cents: number): Share => ({ category, label: categoryLabel(category), cents, share: cents / total });
  if (sorted.length <= limit) return { total, shares: sorted.map(([c, v]) => row(c, v)) };
  // too many: keep the biggest named ones and fold everything else (including "other") into "other"
  const head = sorted.filter(([c]) => c !== "other").slice(0, Math.max(1, limit - 1));
  const rest = sorted.filter(([c]) => !head.some(([h]) => h === c));
  const restCents = rest.reduce((a, [, v]) => a + v, 0);
  return { total, shares: [...head.map(([c, v]) => row(c, v)), row("other", restCents)] };
}

export type Arc = { dash: string; offset: number };

/**
 * Stroke settings for drawing each share as a full circle that shows only its part: pass `dash` as
 * `strokeDasharray` and `offset` as `strokeDashoffset` on a circle of radius `r`, rotated -90 degrees
 * so the first share starts at 12 o'clock. `gap` (in px) separates neighbours; a single share has none.
 */
export function donutArcs(shares: number[], r: number, gap = 3): Arc[] {
  const circumference = 2 * Math.PI * r;
  const g = shares.length > 1 ? gap : 0;
  let start = 0;
  return shares.map((s) => {
    const full = s * circumference;
    const len = Math.max(0, full - g);
    const arc = { dash: `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`, offset: 0 - start };
    start += full;
    return arc;
  });
}

/** One sentence for the donut. */
export function sharesSummary(total: number, shares: Share[]): string {
  if (shares.length === 0) return "No spending in this period yet.";
  return `Spent ${formatMoney(total)} this period: ${shares.map((s) => `${s.label} ${Math.round(s.share * 100)} %`).join(", ")}.`;
}
