import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { areaPath, barRects, compareSummary, linePath, peakText, sparkPoints, spendingTrend, topCategories, trendSummary } from "../src/charts";
import { categoryIcon, categoryLabel } from "../src/categoryIcons";

describe("sparkPoints", () => {
  it("scales from 0 to the maximum inside the padding", () => {
    const pts = sparkPoints([0, 50, 100], 100, 40, 2);
    assert.deepEqual(pts[0], { x: 2, y: 38 });
    assert.deepEqual(pts[2], { x: 98, y: 2 });
    assert.equal(pts[1].y, 20);
  });
  it("handles empty, single and all-zero input", () => {
    assert.deepEqual(sparkPoints([], 100, 40), []);
    assert.equal(sparkPoints([5], 100, 40)[0].x, 50);
    assert.ok(sparkPoints([0, 0], 100, 40).every((p) => p.y === 38));
  });
  it("draws a line and a closed area", () => {
    const pts = sparkPoints([1, 2], 10, 10, 0);
    assert.equal(linePath(pts), "M0.0 5.0 L10.0 0.0");
    assert.ok(areaPath(pts, 10, 0).endsWith("Z"));
    assert.equal(linePath([]), "");
    assert.equal(areaPath([], 10), "");
  });
});

describe("barRects", () => {
  it("fills the width and keeps tiny values visible", () => {
    const bars = barRects([100, 1, 0], 100, 50, 5);
    assert.equal(bars.length, 3);
    assert.equal(bars[0].height, 50);
    assert.equal(bars[1].height, 2);
    assert.equal(bars[2].height, 0);
    const last = bars[2];
    assert.ok(Math.abs(last.x + last.width - 100) < 1e-9);
  });
  it("shares a scale when a max is given", () => {
    assert.equal(barRects([50], 10, 100, 0, 100)[0].height, 50);
    assert.deepEqual(barRects([], 10, 10), []);
  });
});

const txs = [
  { booking_date: "2026-10-12", amount_cents: -2000 },
  { booking_date: "2026-10-12", amount_cents: -500 },
  { booking_date: "2026-10-10", amount_cents: -1000 },
  { booking_date: "2026-10-05", amount_cents: 285000 }, // income: ignored
  { booking_date: "2026-10-03", amount_cents: -5000 }, // previous window: 10-03 to 10-07
  { booking_date: "2026-09-30", amount_cents: -4000 }, // older than both windows
  { booking_date: "2026-09-20", amount_cents: -9000 }, // older than both windows
];

describe("spendingTrend", () => {
  const t = spendingTrend(txs, "2026-10-12", 5);
  it("buckets spending per day, oldest first", () => {
    assert.equal(t.from, "2026-10-08");
    assert.deepEqual(t.series, [0, 0, 1000, 0, 2500]);
    assert.equal(t.total, 3500);
    assert.equal(t.peak, 4);
  });
  it("compares with the window before", () => {
    assert.equal(t.previousTotal, 5000);
    assert.equal(t.deltaPercent, -30);
  });
  it("has no percentage without a previous window", () => {
    assert.equal(spendingTrend([{ booking_date: "2026-10-12", amount_cents: -100 }], "2026-10-12", 3).deltaPercent, null);
  });
  it("says it in a sentence", () => {
    assert.equal(trendSummary(t, 5), "Spent 35,00 € in the last 5 days, 30 % less than the 5 days before.");
    assert.equal(peakText(t), "Most on 12.10.2026: 25,00 €");
    const none = spendingTrend([], "2026-10-12", 5);
    assert.equal(trendSummary(none, 5), "Nothing spent in the last 5 days.");
    assert.equal(peakText(none), null);
  });
});

describe("category comparison", () => {
  const rows = topCategories(
    [
      { category: "groceries", spent_cents: 20000 },
      { category: "dining", spent_cents: 0 },
      { category: "transport", spent_cents: 5000 },
    ],
    [
      { category: "groceries", spent_cents: 25000 },
      { category: "leisure", spent_cents: 7000 },
    ],
    2,
  );
  it("keeps the biggest, merges both periods and drops empty ones", () => {
    assert.deepEqual(rows.map((r) => r.category), ["groceries", "leisure"]);
    assert.equal(rows[0].previous, 25000);
    assert.equal(rows[1].current, 0);
  });
  it("summarises in words", () => {
    assert.match(compareSummary(rows), /groceries 200,00 € \(before 250,00 €\)/);
    assert.equal(compareSummary([]), "No spending against your limits yet.");
  });
});

describe("categoryIcon", () => {
  it("knows the categories and falls back for others", () => {
    assert.equal(categoryIcon("groceries").icon, "cart-outline");
    assert.equal(categoryIcon(null).icon, "tag-outline");
    assert.equal(categoryIcon("nonsense").icon, "tag-outline");
    assert.equal(categoryLabel("groceries"), "Groceries");
    assert.equal(categoryLabel(null), "Uncategorized");
  });
});
