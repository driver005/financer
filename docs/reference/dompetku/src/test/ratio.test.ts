import { describe, expect, it } from "vitest";
import { formatPercent, incomeRatios, monthChange, previousOf, savingsRate } from "../lib/ratio";

const cats = [
  { name: "Makan", color: "#f00", value: 3_000_000 },
  { name: "Transport", color: null, value: 1_000_000 },
  { name: "Belanja", color: "#0f0", value: 500_000 },
];

describe("incomeRatios", () => {
  it("splits income into categories and leftover", () => {
    const r = incomeRatios({ income: 10_000_000, expense: 4_500_000, categories: cats });
    expect(r.empty).toBe(false);
    expect(r.leftover).toBe(5_500_000);
    expect(r.deficit).toBe(0);
    expect(r.spentPercent).toBe(45);
    expect(r.incomeMark).toBe(100);
    expect(r.slices.map((s) => [s.kind, s.name, s.percent])).toEqual([
      ["category", "Makan", 30],
      ["category", "Transport", 10],
      ["category", "Belanja", 5],
      ["leftover", "Sisa / ditabung", 55],
    ]);
    expect(r.slices.reduce((a, s) => a + s.width, 0)).toBeCloseTo(100);
  });

  it("folds categories beyond top N into Lainnya and keeps palette index", () => {
    const r = incomeRatios({ income: 10_000_000, categories: cats, top: 1 });
    expect(r.slices.map((s) => s.name)).toEqual(["Makan", "Lainnya", "Sisa / ditabung"]);
    expect(r.slices[1]).toMatchObject({ kind: "other", value: 1_500_000, percent: 15 });
    expect(r.slices[0]!.index).toBe(0);
  });

  it("puts expense not covered by categories into Lainnya", () => {
    const r = incomeRatios({ income: 10_000_000, expense: 5_000_000, categories: cats });
    expect(r.slices.find((s) => s.kind === "other")?.value).toBe(500_000);
  });

  it("flags overspending and scales the bar to the expense", () => {
    const r = incomeRatios({
      income: 4_000_000,
      expense: 5_000_000,
      categories: cats.concat({ name: "X", color: null, value: 500_000 }),
    });
    expect(r.deficit).toBe(1_000_000);
    expect(r.leftover).toBe(0);
    expect(r.spentPercent).toBe(125);
    expect(r.incomeMark).toBe(80);
    expect(r.slices.some((s) => s.kind === "leftover")).toBe(false);
    expect(r.slices[0]!.percent).toBe(75);
    expect(r.slices.reduce((a, s) => a + s.width, 0)).toBeCloseTo(100);
  });

  it("returns an empty state without income", () => {
    const r = incomeRatios({ income: 0, expense: 200, categories: cats });
    expect(r).toMatchObject({ empty: true, slices: [], deficit: 200 });
    expect(incomeRatios({ income: -5, categories: [] }).empty).toBe(true);
  });

  it("all income left over when nothing spent; ignores zero/invalid categories", () => {
    const r = incomeRatios({
      income: 1000,
      categories: [
        { name: "Nol", color: null, value: 0 },
        { name: "Bad", color: null, value: Number.NaN },
      ],
    });
    expect(r.slices).toEqual([
      expect.objectContaining({ kind: "leftover", percent: 100, width: 100 }),
    ]);
  });

  it("re-sorts unsorted input descending", () => {
    const r = incomeRatios({ income: 100, categories: [...cats].reverse(), top: 2 });
    expect(r.slices.slice(0, 2).map((s) => s.name)).toEqual(["Makan", "Transport"]);
  });

  it("rounds percents to one decimal", () => {
    const r = incomeRatios({ income: 3, categories: [{ name: "A", color: null, value: 1 }] });
    expect(r.slices[0]!.percent).toBe(33.3);
  });
});

describe("helpers", () => {
  it("formatPercent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.4)).toBe("<1%");
    expect(formatPercent(12.6)).toBe("13%");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("monthChange handles zero/missing previous", () => {
    expect(monthChange(112, 100)).toBe(12);
    expect(monthChange(50, 100)).toBe(-50);
    expect(monthChange(100, 0)).toBeNull();
    expect(monthChange(100, null)).toBeNull();
  });

  it("savingsRate", () => {
    expect(savingsRate(250, 1000)).toBe(25);
    expect(savingsRate(-500, 1000)).toBe(-50);
    expect(savingsRate(100, 0)).toBeNull();
  });

  it("previousOf returns second-to-last entry", () => {
    expect(previousOf([1, 2, 3])).toBe(2);
    expect(previousOf([1])).toBeNull();
    expect(previousOf(undefined)).toBeNull();
  });
});
