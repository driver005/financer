// Pure, client-safe math for the dashboard "share of income" widget and the stat-card
// footers (month-over-month change, savings rate). No server imports.

export type RatioCategory = { name: string; color: string | null; value: number };

export type RatioSlice = {
  /** Stable React key. */
  key: string;
  kind: "category" | "other" | "leftover";
  name: string;
  /** Category colour (null → caller picks a palette colour by `index`). */
  color: string | null;
  /** Position in the input category list (same order the donut uses for palette colours). */
  index: number;
  value: number;
  /** Share of income in percent (may exceed 100 when overspent). */
  percent: number;
  /** Width of the segment in percent of the bar (bar = max(income, expense)). */
  width: number;
};

export type IncomeRatios = {
  /** income <= 0: nothing meaningful to show. */
  empty: boolean;
  income: number;
  expense: number;
  /** income − expense when positive, else 0. */
  leftover: number;
  /** expense − income when positive, else 0. */
  deficit: number;
  /** expense / income in percent (0 when income is 0). */
  spentPercent: number;
  /** Where income ends on the bar, in percent of the bar (100 unless overspent). */
  incomeMark: number;
  slices: RatioSlice[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const num = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

/**
 * Split this month's income into the top N expense categories, an "other" bucket and
 * the leftover (income − expense). Transfers (e.g. to goal accounts) are not expenses,
 * so savings moved to a goal stay inside the leftover.
 */
export function incomeRatios({
  income,
  expense,
  categories,
  top = 5,
}: {
  income: number;
  /** Total expense; defaults to the sum of the categories. */
  expense?: number;
  categories: readonly RatioCategory[];
  top?: number;
}): IncomeRatios {
  const inc = Math.max(0, num(income));
  const cats = categories
    .map((c, index) => ({ ...c, value: Math.max(0, num(c.value)), index }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index);
  const catSum = cats.reduce((a, c) => a + c.value, 0);
  const exp = Math.max(0, expense === undefined ? catSum : num(expense));
  const leftover = Math.max(0, inc - exp);
  const deficit = Math.max(0, exp - inc);

  if (inc <= 0) {
    return {
      empty: true,
      income: 0,
      expense: exp,
      leftover: 0,
      deficit,
      spentPercent: 0,
      incomeMark: 0,
      slices: [],
    };
  }

  const scale = Math.max(inc, exp);
  const pct = (v: number) => r1((v / inc) * 100);
  const width = (v: number) => (v / scale) * 100;
  const n = Math.max(0, Math.floor(top));
  const head = cats.slice(0, n);
  // "Other" = rest of the categories plus any expense not covered by them (e.g. the
  // totals and the per-category list disagree by a rounding cent or an orphan row).
  const other = Math.max(0, exp - head.reduce((a, c) => a + c.value, 0));

  const slices: RatioSlice[] = head.map((c) => ({
    key: `cat:${c.index}`,
    kind: "category",
    name: c.name,
    color: c.color,
    index: c.index,
    value: c.value,
    percent: pct(c.value),
    width: width(c.value),
  }));
  if (other > 0.005)
    slices.push({
      key: "other",
      kind: "other",
      name: "Lainnya",
      color: null,
      index: -1,
      value: other,
      percent: pct(other),
      width: width(other),
    });
  if (leftover > 0)
    slices.push({
      key: "leftover",
      kind: "leftover",
      name: "Sisa / ditabung",
      color: null,
      index: -1,
      value: leftover,
      percent: pct(leftover),
      width: width(leftover),
    });

  return {
    empty: false,
    income: inc,
    expense: exp,
    leftover,
    deficit,
    spentPercent: pct(exp),
    incomeMark: width(inc),
    slices,
  };
}

/** Display a percentage: "<1%" for tiny non-zero shares, otherwise rounded. */
export function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p > 0 && p < 1) return "<1%";
  return `${Math.round(p)}%`;
}

/**
 * Month-over-month change in percent; null when there is no previous value to compare
 * against (previous <= 0) so the UI can hide it instead of showing ∞.
 */
export function monthChange(current: number, previous: number | null | undefined): number | null {
  const prev = num(previous);
  if (prev <= 0) return null;
  return r1(((num(current) - prev) / prev) * 100);
}

/** Net / income in percent; null when there is no income. */
export function savingsRate(net: number, income: number): number | null {
  const inc = num(income);
  if (inc <= 0) return null;
  return r1((num(net) / inc) * 100);
}

/** The month before the last entry of a trend series (series ends at the viewed month). */
export function previousOf<T>(series: readonly T[] | null | undefined): T | null {
  return series && series.length >= 2 ? series[series.length - 2]! : null;
}
