/**
 * Data and geometry for the small charts (sparkline and bars) plus the sentence that goes with
 * each, so a screen reader and a glance at the text get the same message as the picture.
 * Pure (no React Native), unit-tested.
 */
import { formatMoney, formatDate } from "./format";

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type Point = { x: number; y: number };

/**
 * Points for a line over `values`, scaled into a `width` x `height` box with `pad` on every side.
 * The y axis starts at 0 (a spending trend should not exaggerate small changes), the highest
 * value touches the top padding. One value gives one point in the middle.
 */
export function sparkPoints(values: number[], width: number, height: number, pad = 2): Point[] {
  if (values.length === 0) return [];
  const max = Math.max(...values, 0);
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  return values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : pad + (innerW * i) / (values.length - 1),
    y: pad + innerH - (max > 0 ? (innerH * Math.max(0, v)) / max : 0),
  }));
}

/** SVG path (`M x y L x y ...`) through the points; empty string without points. */
export function linePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/** The same line closed down to the baseline, for a soft fill under it. */
export function areaPath(points: Point[], height: number, pad = 2): string {
  if (points.length === 0) return "";
  const base = height - pad;
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${last.x.toFixed(1)} ${base} L${first.x.toFixed(1)} ${base} Z`;
}

export type Bar = { x: number; y: number; width: number; height: number };

/**
 * Bars for `values` in a `width` x `height` box, `gap` apart. A bar is at least 2 tall when its
 * value is above 0, so a small amount stays visible next to a big one; a zero value has height 0.
 * `max` lets several charts share one scale (grouped bars).
 */
export function barRects(values: number[], width: number, height: number, gap = 4, max?: number): Bar[] {
  if (values.length === 0) return [];
  const top = max ?? Math.max(...values, 0);
  const barW = Math.max(1, (width - gap * (values.length - 1)) / values.length);
  return values.map((v, i) => {
    const h = top > 0 && v > 0 ? Math.max(2, (height * v) / top) : 0;
    return { x: i * (barW + gap), y: height - h, width: barW, height: h };
  });
}

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
export function spendingTrend(txs: Tx[], today: string, days: number): SpendingTrend {
  const end = toUtc(today);
  const start = end - (days - 1) * DAY_MS;
  const prevStart = start - days * DAY_MS;
  const series = new Array<number>(days).fill(0);
  let previousTotal = 0;
  for (const t of txs) {
    if (t.amount_cents >= 0) continue;
    const ms = toUtc(t.booking_date);
    if (ms >= start && ms <= end) series[Math.round((ms - start) / DAY_MS)] += -t.amount_cents;
    else if (ms >= prevStart && ms < start) previousTotal += -t.amount_cents;
  }
  const total = series.reduce((a, b) => a + b, 0);
  const max = Math.max(...series);
  return {
    series,
    from: toIso(start),
    total,
    previousTotal,
    deltaPercent: previousTotal > 0 ? Math.round(((total - previousTotal) / previousTotal) * 100) : null,
    peak: max > 0 ? series.indexOf(max) : null,
  };
}

/** One sentence for the spending chart, e.g. `Spent 412,30 € in the last 14 days, 12 % less than the 14 days before.` */
export function trendSummary(t: SpendingTrend, days: number): string {
  if (t.total === 0) return `Nothing spent in the last ${days} days.`;
  const base = `Spent ${formatMoney(t.total)} in the last ${days} days`;
  if (t.deltaPercent === null) return `${base}.`;
  if (t.deltaPercent === 0) return `${base}, the same as the ${days} days before.`;
  const word = t.deltaPercent > 0 ? "more" : "less";
  return `${base}, ${Math.abs(t.deltaPercent)} % ${word} than the ${days} days before.`;
}

/** The day with the highest spend as text, or `null`. */
export function peakText(t: SpendingTrend): string | null {
  if (t.peak === null) return null;
  const ms = toUtc(t.from) + t.peak * DAY_MS;
  return `Most on ${formatDate(toIso(ms))}: ${formatMoney(t.series[t.peak])}`;
}

export type CategoryCompare = { category: string; current: number; previous: number };

/** The `limit` categories with the highest spend this or last period, for a grouped bar chart. */
export function topCategories(
  current: { category: string; spent_cents: number }[],
  previous: { category: string; spent_cents: number }[],
  limit = 5,
): CategoryCompare[] {
  const map = new Map<string, CategoryCompare>();
  for (const c of current) map.set(c.category, { category: c.category, current: c.spent_cents, previous: 0 });
  for (const p of previous) {
    const row = map.get(p.category) ?? { category: p.category, current: 0, previous: 0 };
    row.previous = p.spent_cents;
    map.set(p.category, row);
  }
  return [...map.values()]
    .filter((r) => r.current > 0 || r.previous > 0)
    .sort((a, b) => Math.max(b.current, b.previous) - Math.max(a.current, a.previous))
    .slice(0, limit);
}

/** One sentence for the category comparison. */
export function compareSummary(rows: CategoryCompare[]): string {
  if (rows.length === 0) return "No spending against your limits yet.";
  const cur = rows.reduce((a, r) => a + r.current, 0);
  const prev = rows.reduce((a, r) => a + r.previous, 0);
  const parts = rows.map((r) => `${r.category} ${formatMoney(r.current)} (before ${formatMoney(r.previous)})`);
  return `Top categories, this period against last: ${parts.join(", ")}. Together ${formatMoney(cur)} against ${formatMoney(prev)}.`;
}
