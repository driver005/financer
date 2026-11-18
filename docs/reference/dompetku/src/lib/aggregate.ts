/**
 * Pure, client-safe aggregation helpers shared by the SQL path (v9 `dk_*` functions via rpc) and the
 * JS fallback (fetchAll + reduce). Both paths produce the same intermediate rows, which the builders
 * below turn into the shapes the UI expects, so the two paths give identical results.
 * Totals are rounded to cents so the float sum (JS) and the exact numeric sum (SQL) agree.
 */
export const UNCATEGORIZED = "Tanpa kategori";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type MonthKindTotal = { month: string; kind: string; total: number };
export type CategoryTotal = {
  category_id: string | null;
  name: string | null;
  color: string | null;
  total: number;
};
export type MonthCategoryTotal = CategoryTotal & { month: string };
export type MonthNet = { month: string; net: number };

/** True when PostgREST/Postgres reports an rpc function that does not exist (schema v9 not run). */
export function isMissingFunction(
  err: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST202" ||
    err.code === "42883" ||
    /could not find the function|function .* does not exist/i.test(err.message ?? "")
  );
}

/* ---------------- rpc row normalisation (numeric may arrive as string) ---------------- */
export function normalizeTotals<T extends { total: unknown }>(
  rows: readonly T[] | null | undefined,
): (Omit<T, "total"> & { total: number })[] {
  return (rows ?? []).map((r) => ({ ...r, total: r2(Number(r.total)) }));
}

export function normalizeNet<T extends { month: unknown; net: unknown }>(
  rows: readonly T[] | null | undefined,
): MonthNet[] {
  return (rows ?? []).map((r) => ({ month: String(r.month), net: r2(Number(r.net)) }));
}

/* ---------------- JS fallback aggregators (same output as the SQL functions) ---------------- */
type CatRef = { name?: string | null; color?: string | null } | null | undefined;
type AmountRow = {
  amount_idr: unknown;
  kind?: string | null | undefined;
  occurred_at?: unknown;
  category_id?: string | null | undefined;
  category?: CatRef;
};

const monthOf = (d: unknown) => String(d).slice(0, 7);
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** = dk_month_totals: per month & kind, transfers excluded. */
export function sumMonthKind(rows: readonly AmountRow[]): MonthKindTotal[] {
  const m = new Map<string, MonthKindTotal>();
  for (const t of rows) {
    if (t.kind === "transfer") continue;
    const month = monthOf(t.occurred_at);
    const kind = String(t.kind);
    const key = `${month}|${kind}`;
    const cur = m.get(key) ?? { month, kind, total: 0 };
    cur.total += Number(t.amount_idr);
    m.set(key, cur);
  }
  return [...m.values()].map((x) => ({ ...x, total: r2(x.total) }));
}

/** = dk_category_totals: per category (caller pre-filters the kind). */
export function sumCategories(rows: readonly AmountRow[]): CategoryTotal[] {
  const m = new Map<string, CategoryTotal>();
  for (const t of rows) {
    const id = t.category_id ?? null;
    const key = id ?? "";
    const cur = m.get(key) ?? {
      category_id: id,
      name: t.category?.name ?? null,
      color: t.category?.color ?? null,
      total: 0,
    };
    cur.total += Number(t.amount_idr);
    m.set(key, cur);
  }
  return [...m.values()].map((x) => ({ ...x, total: r2(x.total) }));
}

/** = dk_month_category_totals: per month & category (caller pre-filters to expenses). */
export function sumMonthCategories(rows: readonly AmountRow[]): MonthCategoryTotal[] {
  const m = new Map<string, MonthCategoryTotal>();
  for (const t of rows) {
    const month = monthOf(t.occurred_at);
    const id = t.category_id ?? null;
    const key = `${month}|${id ?? ""}`;
    const cur = m.get(key) ?? {
      month,
      category_id: id,
      name: t.category?.name ?? null,
      color: t.category?.color ?? null,
      total: 0,
    };
    cur.total += Number(t.amount_idr);
    m.set(key, cur);
  }
  return [...m.values()].map((x) => ({ ...x, total: r2(x.total) }));
}

/** = dk_monthly_net: income − expense per month, transfers excluded. */
export function sumMonthlyNet(rows: readonly AmountRow[]): MonthNet[] {
  const m = new Map<string, number>();
  for (const t of rows) {
    if (t.kind === "transfer") continue;
    const month = monthOf(t.occurred_at);
    const v = Number(t.amount_idr);
    m.set(month, (m.get(month) ?? 0) + (t.kind === "income" ? v : -v));
  }
  return [...m.entries()].map(([month, net]) => ({ month, net: r2(net) }));
}

/* ---------------- Builders ---------------- */
/** Income/expense per month for the given month keys (missing months = 0). */
export function monthSeries(
  months: readonly string[],
  totals: readonly MonthKindTotal[],
): { month: string; income: number; expense: number }[] {
  const out = new Map(months.map((m) => [m, { month: m, income: 0, expense: 0 }]));
  for (const t of totals) {
    const row = out.get(t.month);
    if (!row) continue;
    if (t.kind === "income") row.income = r2(row.income + t.total);
    else if (t.kind === "expense") row.expense = r2(row.expense + t.total);
  }
  return [...out.values()];
}

/** Sum of one kind, optionally limited to one month. */
export function kindTotal(totals: readonly MonthKindTotal[], kind: string, month?: string): number {
  return r2(
    totals
      .filter((t) => t.kind === kind && (month === undefined || t.month === month))
      .reduce((a, t) => a + t.total, 0),
  );
}

/** Dashboard pie: one slice per category id, biggest first. */
export function categorySlices(
  cats: readonly CategoryTotal[],
): { name: string; color: string | null; value: number }[] {
  return cats
    .map((c) => ({ name: c.name ?? UNCATEGORIZED, color: c.color, value: c.total }))
    .sort((a, b) => b.value - a.value || byName(a.name, b.name));
}

/** Yearly recap: categories merged by display name, biggest first. */
export function categoriesByName(
  cats: readonly CategoryTotal[],
): { name: string; color: string | null; value: number }[] {
  const m = new Map<string, { name: string; color: string | null; value: number }>();
  for (const c of cats) {
    const name = c.name ?? UNCATEGORIZED;
    const cur = m.get(name) ?? { name, color: c.color, value: 0 };
    cur.value = r2(cur.value + c.total);
    m.set(name, cur);
  }
  return [...m.values()].sort((a, b) => b.value - a.value || byName(a.name, b.name));
}

/** Budget spending per category id (uncategorised spending is ignored). */
export function spentByCategory(cats: readonly CategoryTotal[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cats)
    if (c.category_id) m.set(c.category_id, r2((m.get(c.category_id) ?? 0) + c.total));
  return m;
}

/** Dashboard stacked chart: top-N categories (by name) over the given months. */
export function topCategoryTrend(
  months: readonly string[],
  rows: readonly MonthCategoryTotal[],
  top = 5,
): { categories: string[]; rows: Record<string, number | string>[] } {
  const totals = new Map<string, number>();
  const byMonth = new Map<string, Map<string, number>>();
  const inRange = new Set(months);
  for (const r of rows) {
    if (!inRange.has(r.month)) continue;
    const name = r.name ?? UNCATEGORIZED;
    totals.set(name, r2((totals.get(name) ?? 0) + r.total));
    const mm = byMonth.get(r.month) ?? new Map<string, number>();
    mm.set(name, r2((mm.get(name) ?? 0) + r.total));
    byMonth.set(r.month, mm);
  }
  const categories = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))
    .slice(0, top)
    .map(([name]) => name);
  return {
    categories,
    rows: months.map((m) => {
      const row: Record<string, number | string> = { month: m };
      const mm = byMonth.get(m);
      for (const c of categories) row[c] = mm?.get(c) ?? 0;
      return row;
    }),
  };
}

/** Reports: per-category (by id, "none" = uncategorised) totals and monthly series. */
export function categoryTrendSeries(
  months: readonly string[],
  rows: readonly MonthCategoryTotal[],
): {
  categories: { id: string; name: string; color: string | null; total: number }[];
  series: Record<string, number | string>[];
} {
  const cats = new Map<string, { id: string; name: string; color: string | null; total: number }>();
  const series = new Map<string, Record<string, number | string>>(
    months.map((m) => [m, { month: m }]),
  );
  for (const r of rows) {
    const id = r.category_id ?? "none";
    const c = cats.get(id) ?? { id, name: r.name ?? UNCATEGORIZED, color: r.color, total: 0 };
    c.total = r2(c.total + r.total);
    cats.set(id, c);
    const row = series.get(r.month);
    if (row) row[id] = r2(Number(row[id] ?? 0) + r.total);
  }
  return {
    categories: [...cats.values()].sort((a, b) => b.total - a.total || byName(a.id, b.id)),
    series: [...series.values()],
  };
}

/* ---------------- SQL first, JS fallback ---------------- */
type RpcResult<T> = { data: T[] | null; error: { message?: string; code?: string } | null };

// After a "function missing" error the SQL path is skipped for a while (one wasted round trip at
// most every few minutes until the user runs schema v9).
const MISSING_RETRY_MS = 5 * 60 * 1000;
let sqlMissingUntil = 0;

/** Test hook: forget a remembered "function missing" state. */
export function resetAggregateState(): void {
  sqlMissingUntil = 0;
}

/**
 * Runs the SQL aggregation and falls back to the JS aggregation when the function is missing
 * (schema v9 not run), errors, or throws. Results are numerically identical either way.
 */
export async function sqlOrFallback<T>(
  sql: () => PromiseLike<RpcResult<T>>,
  fallback: () => Promise<T[]>,
  now: () => number = Date.now,
): Promise<{ rows: T[]; via: "sql" | "js" }> {
  if (now() >= sqlMissingUntil) {
    try {
      const res = await sql();
      if (!res.error) return { rows: res.data ?? [], via: "sql" };
      if (isMissingFunction(res.error)) sqlMissingUntil = now() + MISSING_RETRY_MS;
      else console.error("aggregation rpc failed, using fallback", res.error.message);
    } catch (e) {
      console.error("aggregation rpc failed, using fallback", e);
    }
  }
  return { rows: await fallback(), via: "js" };
}

/** Lazily runs `f` once and shares the promise (one fallback fetch for several aggregates). */
export function once<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= f());
}
