import { afterEach, describe, expect, it, vi } from "vitest";
import {
  categoriesByName,
  categorySlices,
  categoryTrendSeries,
  isMissingFunction,
  kindTotal,
  monthSeries,
  normalizeNet,
  normalizeTotals,
  once,
  resetAggregateState,
  spentByCategory,
  sqlOrFallback,
  sumCategories,
  sumMonthCategories,
  sumMonthKind,
  sumMonthlyNet,
  topCategoryTrend,
} from "../lib/aggregate";

const food = { name: "Makan", color: "#d0703c" };
const rows = [
  {
    kind: "income",
    amount_idr: "1000000.00",
    occurred_at: "2026-01-05",
    category_id: "g",
    category: { name: "Gaji", color: null },
  },
  {
    kind: "expense",
    amount_idr: "0.10",
    occurred_at: "2026-01-06",
    category_id: "m",
    category: food,
  },
  {
    kind: "expense",
    amount_idr: "0.20",
    occurred_at: "2026-01-31",
    category_id: "m",
    category: food,
  },
  {
    kind: "expense",
    amount_idr: 500,
    occurred_at: "2026-02-01",
    category_id: null,
    category: null,
  },
  {
    kind: "transfer",
    amount_idr: 999,
    occurred_at: "2026-02-02",
    category_id: null,
    category: null,
  },
  { kind: "expense", amount_idr: 300, occurred_at: "2026-02-03", category_id: "m", category: food },
];
const expenses = rows.filter((r) => r.kind === "expense");

describe("isMissingFunction", () => {
  it("detects PostgREST / Postgres missing-function errors only", () => {
    expect(isMissingFunction({ code: "PGRST202", message: "x" })).toBe(true);
    expect(
      isMissingFunction({
        message:
          "Could not find the function public.dk_month_totals(p_end, p_start) in the schema cache",
      }),
    ).toBe(true);
    expect(isMissingFunction({ code: "42883", message: "function dk_x() does not exist" })).toBe(
      true,
    );
    expect(isMissingFunction({ code: "PGRST205", message: "Could not find the table" })).toBe(
      false,
    );
    expect(isMissingFunction({ message: "permission denied" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

describe("JS aggregators match SQL function semantics", () => {
  it("sums per month & kind, excluding transfers, rounded to cents", () => {
    expect(sumMonthKind(rows)).toEqual([
      { month: "2026-01", kind: "income", total: 1000000 },
      { month: "2026-01", kind: "expense", total: 0.3 },
      { month: "2026-02", kind: "expense", total: 800 },
    ]);
  });
  it("sums per category with null category kept", () => {
    expect(sumCategories(expenses)).toEqual([
      { category_id: "m", name: "Makan", color: "#d0703c", total: 300.3 },
      { category_id: null, name: null, color: null, total: 500 },
    ]);
  });
  it("sums per month & category", () => {
    expect(sumMonthCategories(expenses)).toHaveLength(3);
  });
  it("computes monthly net", () => {
    expect(sumMonthlyNet(rows)).toEqual([
      { month: "2026-01", net: 999999.7 },
      { month: "2026-02", net: -800 },
    ]);
  });
});

describe("builders give the same result for SQL (string numeric) and JS rows", () => {
  const sql = normalizeTotals([
    { month: "2026-02", kind: "expense", total: "800.00" },
    { month: "2026-01", kind: "expense", total: "0.30" },
    { month: "2026-01", kind: "income", total: "1000000.00" },
  ]);
  const js = sumMonthKind(rows);
  it("monthSeries / kindTotal", () => {
    const months = ["2025-12", "2026-01", "2026-02"];
    expect(monthSeries(months, sql)).toEqual(monthSeries(months, js));
    expect(monthSeries(months, js)[0]).toEqual({ month: "2025-12", income: 0, expense: 0 });
    expect(kindTotal(sql, "expense")).toBe(800.3);
    expect(kindTotal(js, "expense", "2026-01")).toBe(0.3);
  });
  it("normalizeNet converts strings", () => {
    expect(normalizeNet([{ month: "2026-01", net: "-12.50" }])).toEqual([
      { month: "2026-01", net: -12.5 },
    ]);
  });
  it("category builders", () => {
    const cats = sumCategories(expenses);
    expect(categorySlices(cats)).toEqual([
      { name: "Tanpa kategori", color: null, value: 500 },
      { name: "Makan", color: "#d0703c", value: 300.3 },
    ]);
    expect(
      categoriesByName([...cats, { category_id: "x", name: "Makan", color: null, total: 1 }])[0],
    ).toEqual({
      name: "Tanpa kategori",
      color: null,
      value: 500,
    });
    expect(spentByCategory(cats)).toEqual(new Map([["m", 300.3]]));
  });
  it("topCategoryTrend and categoryTrendSeries", () => {
    const mc = sumMonthCategories(expenses);
    const t = topCategoryTrend(["2026-01", "2026-02"], mc, 1);
    expect(t.categories).toEqual(["Tanpa kategori"]);
    expect(t.rows).toEqual([
      { month: "2026-01", "Tanpa kategori": 0 },
      { month: "2026-02", "Tanpa kategori": 500 },
    ]);
    const s = categoryTrendSeries(["2026-01", "2026-02"], mc);
    expect(s.categories.map((c) => c.id)).toEqual(["none", "m"]);
    expect(s.series).toEqual([
      { month: "2026-01", m: 0.3 },
      { month: "2026-02", none: 500, m: 300 },
    ]);
  });
});

describe("sqlOrFallback", () => {
  afterEach(() => resetAggregateState());
  it("uses SQL rows when the function exists", async () => {
    const fb = vi.fn(async () => [2]);
    const r = await sqlOrFallback(async () => ({ data: [1], error: null }), fb);
    expect(r).toEqual({ rows: [1], via: "sql" });
    expect(fb).not.toHaveBeenCalled();
  });
  it("falls back when the function is missing and skips SQL for a while", async () => {
    let now = 1000;
    const sql = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "x" } }));
    const r = await sqlOrFallback(
      sql,
      async () => [2],
      () => now,
    );
    expect(r).toEqual({ rows: [2], via: "js" });
    await sqlOrFallback(
      sql,
      async () => [2],
      () => now,
    );
    expect(sql).toHaveBeenCalledTimes(1);
    now += 10 * 60 * 1000;
    await sqlOrFallback(
      sql,
      async () => [2],
      () => now,
    );
    expect(sql).toHaveBeenCalledTimes(2);
  });
  it("falls back on other errors and on throws without remembering", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sql = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    expect((await sqlOrFallback(sql, async () => [3])).via).toBe("js");
    expect(
      (
        await sqlOrFallback(
          () => {
            throw new Error("no rpc");
          },
          async () => [4],
        )
      ).rows,
    ).toEqual([4]);
    await sqlOrFallback(sql, async () => [3]);
    expect(sql).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it("once shares one fallback fetch", async () => {
    const f = vi.fn(async () => 1);
    const g = once(f);
    await Promise.all([g(), g()]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
