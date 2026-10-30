import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { categoryShares, curveGeometry, curveSummary, donutArcs, isSpend, lastWeek, periodCurve, sharesSummary, spendComparison, weekSummary } from "../src/todayCharts";

const tx = (booking_date: string, amount_cents: number, category: string | null = "groceries") => ({ booking_date, amount_cents, category });
const period = { start: "2026-10-01", end: "2026-10-31" };

describe("isSpend", () => {
  it("counts purchases, not income, refunds or savings transfers", () => {
    assert.equal(isSpend(tx("2026-10-02", -100)), true);
    assert.equal(isSpend(tx("2026-10-02", 100)), false);
    assert.equal(isSpend(tx("2026-10-02", -100, "savings")), false);
    assert.equal(isSpend(tx("2026-10-02", -100, "income")), false);
    assert.equal(isSpend(tx("2026-10-02", -100, null)), true);
  });
});

describe("periodCurve", () => {
  const txs = [tx("2026-10-01", -1000), tx("2026-10-03", -500), tx("2026-10-03", -250, "dining"), tx("2026-10-02", 90000, "income"), tx("2026-10-20", -999), tx("2026-09-30", -777)];
  const c = periodCurve(txs, period, "2026-10-04", 3000);
  it("runs up from the first day to today and ignores later and earlier bookings", () => {
    assert.equal(c.days, 31);
    assert.equal(c.todayIndex, 3);
    assert.deepEqual(c.cumulative, [1000, 1000, 1750, 1750]);
    assert.equal(c.spent, 1750);
  });
  it("projects the end from what is still to come", () => {
    assert.equal(c.projectedEnd, 4750);
    assert.equal(periodCurve(txs, period, "2026-10-04", null).projectedEnd, null);
    assert.equal(periodCurve(txs, period, "2026-10-04", -5).projectedEnd, 1750);
  });
  it("clamps today into the period", () => {
    assert.equal(periodCurve([], period, "2026-12-01", null).todayIndex, 30);
    assert.equal(periodCurve([], period, "2026-09-01", null).todayIndex, 0);
    assert.deepEqual(periodCurve([], period, "2026-10-02", null).cumulative, [0, 0]);
  });
});

describe("curveGeometry", () => {
  const c = periodCurve([tx("2026-10-01", -1000), tx("2026-10-02", -1000)], { start: "2026-10-01", end: "2026-10-05" }, "2026-10-02", 2000);
  const g = curveGeometry(c, 100, 50, 0);
  it("puts the first day at the left and the end of the period at the right", () => {
    assert.deepEqual(g.solid[0], { x: 0, y: 37.5 });
    assert.deepEqual(g.today, { x: 25, y: 25 });
    assert.deepEqual(g.dashed[1], { x: 100, y: 0 });
  });
  it("has no dashed part without a projection or on the last day", () => {
    assert.deepEqual(curveGeometry(periodCurve([], period, "2026-10-04", null), 100, 50).dashed, []);
    assert.deepEqual(curveGeometry(periodCurve([], period, "2026-10-31", 100), 100, 50).dashed, []);
  });
  it("stays inside the box when nothing was spent", () => {
    const flat = curveGeometry(periodCurve([], period, "2026-10-04", null), 100, 50, 4);
    assert.ok(flat.solid.every((p) => p.y === 46));
  });
});

describe("curveSummary", () => {
  it("says what was spent and, when known, where it ends", () => {
    const c = periodCurve([tx("2026-10-01", -1000)], period, "2026-10-02", 2000);
    assert.match(curveSummary(c), /first 2 of 31 days/);
    assert.match(curveSummary(c), /about .*30,00/);
    assert.ok(!/about/.test(curveSummary(periodCurve([], period, "2026-10-02", null))));
  });
});

describe("lastWeek", () => {
  // 2026-10-14 is a Wednesday
  const txs = [tx("2026-10-14", -2000), tx("2026-10-14", -500), tx("2026-10-12", -1000), tx("2026-10-08", -300), tx("2026-10-07", -700), tx("2026-09-30", -9999), tx("2026-10-13", 5000, "income")];
  const w = lastWeek(txs, "2026-10-14");
  it("lists seven days ending today with weekday letters", () => {
    assert.equal(w.bars.length, 7);
    assert.equal(w.bars[0].iso, "2026-10-08");
    assert.equal(w.bars[6].iso, "2026-10-14");
    assert.deepEqual(w.bars.map((b) => b.letter), ["T", "F", "S", "S", "M", "T", "W"]);
    assert.equal(w.bars[6].today, true);
    assert.equal(w.bars.filter((b) => b.today).length, 1);
    assert.deepEqual(w.bars.map((b) => b.cents), [300, 0, 0, 0, 1000, 0, 2500]);
  });
  it("totals, averages and compares with the week before", () => {
    assert.equal(w.total, 3800);
    assert.equal(w.average, 543);
    assert.equal(w.previousTotal, 700);
    assert.equal(w.deltaPercent, 443);
    assert.equal(lastWeek([], "2026-10-14").deltaPercent, null);
  });
  it("summarises in a sentence", () => {
    assert.match(weekSummary(w), /Spent .*38,00.* in the last 7 days/);
    assert.match(weekSummary(w), /443 % more/);
    assert.equal(weekSummary(lastWeek([], "2026-10-14")), "Nothing spent in the last 7 days.");
  });
});

describe("categoryShares", () => {
  const p = { start: "2026-10-01", end: "2026-10-31" };
  it("sorts by amount and gives shares that add up to 1", () => {
    const r = categoryShares([tx("2026-10-02", -600, "groceries"), tx("2026-10-03", -300, "dining"), tx("2026-10-04", -100, "transport"), tx("2026-09-30", -5000), tx("2026-10-05", 5000, "income")], p);
    assert.equal(r.total, 1000);
    assert.deepEqual(r.shares.map((s) => s.category), ["groceries", "dining", "transport"]);
    assert.equal(r.shares[0].label, "Groceries");
    assert.ok(Math.abs(r.shares.reduce((a, s) => a + s.share, 0) - 1) < 1e-9);
  });
  it("folds the small ones into Other once there are more than the limit", () => {
    const cats = ["a", "b", "c", "d", "e", "f"];
    const r = categoryShares(cats.map((c, i) => tx("2026-10-02", -(1000 - i * 100), c)), p, 4);
    assert.equal(r.shares.length, 4);
    assert.deepEqual(r.shares.map((s) => s.category), ["a", "b", "c", "other"]);
    assert.equal(r.shares[3].cents, 700 + 600 + 500);
    assert.equal(r.shares[3].label, "Other");
  });
  it("treats a missing category as other and handles an empty period", () => {
    assert.deepEqual(categoryShares([tx("2026-10-02", -100, null)], p).shares.map((s) => s.category), ["other"]);
    assert.deepEqual(categoryShares([], p), { total: 0, shares: [] });
  });
  it("summarises in a sentence", () => {
    const r = categoryShares([tx("2026-10-02", -750, "groceries"), tx("2026-10-02", -250, "dining")], p);
    assert.match(sharesSummary(r.total, r.shares), /Groceries 75 %, Dining 25 %/);
    assert.equal(sharesSummary(0, []), "No spending in this period yet.");
  });
});

describe("donutArcs", () => {
  const r = 50;
  const circ = 2 * Math.PI * r;
  it("lays the shares end to end around the circle", () => {
    const arcs = donutArcs([0.5, 0.25, 0.25], r, 0);
    assert.equal(arcs[0].offset, 0);
    assert.ok(Math.abs(arcs[1].offset + circ * 0.5) < 1e-9);
    assert.ok(Math.abs(arcs[2].offset + circ * 0.75) < 1e-9);
    assert.equal(arcs[0].dash, `${(circ * 0.5).toFixed(2)} ${(circ * 0.5).toFixed(2)}`);
  });
  it("leaves a gap between neighbours but none for a single share", () => {
    const [a, b] = donutArcs([0.5, 0.5], r, 4);
    assert.equal(Number(a.dash.split(" ")[0]), Number((circ * 0.5 - 4).toFixed(2)));
    assert.ok(b.offset < a.offset);
    assert.equal(donutArcs([1], r, 4)[0].dash.split(" ")[0], circ.toFixed(2));
  });
  it("never goes negative for a sliver", () => {
    assert.ok(donutArcs([0.0001, 0.9999], r, 6).every((a) => Number(a.dash.split(" ")[0]) >= 0));
  });
});

describe("spendComparison", () => {
  const sep = { start: "2026-09-01", end: "2026-09-30" };
  const txs = [tx("2026-10-02", -3000), tx("2026-10-09", -9999), tx("2026-09-02", -2000), tx("2026-09-04", -1000), tx("2026-09-20", -50000), tx("2026-10-01", 100000, "income")];
  it("compares the first days of this period with the same days of the last", () => {
    const c = spendComparison(txs, period, sep, "2026-10-05");
    assert.equal(c.days, 5);
    assert.equal(c.current, 3000);
    assert.equal(c.previous, 3000); // Sep 1-5 only; the 20th is later than day 5
    assert.equal(c.deltaPercent, 0);
  });
  it("reports the change in percent", () => {
    const c = spendComparison(txs, period, sep, "2026-10-03");
    assert.equal(c.previous, 2000);
    assert.equal(c.deltaPercent, 50);
  });
  it("has no percent when the last period had nothing to compare", () => {
    assert.equal(spendComparison(txs, period, { start: "2025-01-01", end: "2025-01-31" }, "2026-10-05").deltaPercent, null);
  });
  it("clamps today into the period and handles a shorter previous period", () => {
    assert.equal(spendComparison([], period, sep, "2026-12-01").days, 31);
    assert.equal(spendComparison([tx("2026-09-30", -100)], period, sep, "2026-10-31").previous, 100);
  });
});

import { dayTotal, emptyFilterText, filterTx } from "../src/spendingView";

describe("spending view", () => {
  const items = [{ amount_cents: -500 }, { amount_cents: 200000 }, { amount_cents: -250 }, { amount_cents: 0 }];
  it("filters by direction and keeps the order", () => {
    assert.deepEqual(filterTx(items, "all"), items);
    assert.deepEqual(filterTx(items, "spending"), [{ amount_cents: -500 }, { amount_cents: -250 }]);
    assert.deepEqual(filterTx(items, "income"), [{ amount_cents: 200000 }]);
  });
  it("sums a day net", () => {
    assert.equal(dayTotal(items), 199250);
    assert.equal(dayTotal([]), 0);
  });
  it("words an empty list", () => {
    assert.match(emptyFilterText("spending"), /spending/);
    assert.match(emptyFilterText("income"), /income/);
    assert.equal(emptyFilterText("all"), "Nothing to show.");
  });
});
