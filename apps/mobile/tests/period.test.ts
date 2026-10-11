import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { budgetPeriod, localIsoDate, periodDays, periodLabel, previousPeriod } from "../src/period";

// The expectations mirror the unit tests of BudgetPeriod in crates/core/src/period.rs.
describe("budgetPeriod", () => {
  it("is the calendar month at payday 1", () => {
    assert.deepEqual(budgetPeriod("2026-03-15", 1), { start: "2026-03-01", end: "2026-03-31" });
    assert.deepEqual(budgetPeriod("2026-02-01"), { start: "2026-02-01", end: "2026-02-28" });
    assert.deepEqual(budgetPeriod("2028-02-29"), { start: "2028-02-01", end: "2028-02-29" });
  });

  it("runs from the 25th to the 24th at payday 25", () => {
    assert.deepEqual(budgetPeriod("2026-10-11", 25), { start: "2026-09-25", end: "2026-10-24" });
    assert.deepEqual(budgetPeriod("2026-10-24", 25), { start: "2026-09-25", end: "2026-10-24" });
    assert.deepEqual(budgetPeriod("2026-10-25", 25), { start: "2026-10-25", end: "2026-11-24" });
  });

  it("crosses the year end", () => {
    assert.deepEqual(budgetPeriod("2026-12-30", 25), { start: "2026-12-25", end: "2027-01-24" });
    assert.deepEqual(budgetPeriod("2027-01-03", 25), { start: "2026-12-25", end: "2027-01-24" });
    assert.deepEqual(budgetPeriod("2027-01-03", 10), { start: "2026-12-10", end: "2027-01-09" });
  });

  it("clamps a payday beyond the month to its last day", () => {
    assert.deepEqual(budgetPeriod("2026-02-10", 31), { start: "2026-01-31", end: "2026-02-27" });
    assert.deepEqual(budgetPeriod("2026-02-28", 31), { start: "2026-02-28", end: "2026-03-30" });
    assert.deepEqual(budgetPeriod("2028-02-29", 30), { start: "2028-02-29", end: "2028-03-29" });
    assert.deepEqual(budgetPeriod("2026-03-15", 0), budgetPeriod("2026-03-15", 1));
  });

  it("tiles the calendar: every day is in exactly one period, and periods follow each other", () => {
    for (const payday of [1, 15, 25, 28, 29, 31]) {
      let prev = budgetPeriod("2026-01-01", payday);
      for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2029, 0, 1); ms += 86_400_000) {
        const day = new Date(ms).toISOString().slice(0, 10);
        const p = budgetPeriod(day, payday);
        assert.ok(p.start <= day && day <= p.end, `${day} payday ${payday}`);
        if (p.start !== prev.start) {
          assert.equal(previousPeriod(p, payday).start, prev.start);
          assert.equal(new Date(Date.parse(prev.end) + 86_400_000).toISOString().slice(0, 10), p.start);
          prev = p;
        }
      }
    }
  });
});

describe("period helpers", () => {
  it("counts days including both ends", () => {
    assert.equal(periodDays({ start: "2026-09-25", end: "2026-10-24" }), 30);
    assert.equal(periodDays(budgetPeriod("2026-03-10")), 31);
    assert.equal(periodDays(budgetPeriod("2026-02-10")), 28);
  });

  it("labels calendar months by name and other periods by their dates", () => {
    assert.equal(periodLabel(budgetPeriod("2026-10-11")), "October 2026");
    assert.equal(periodLabel(budgetPeriod("2026-10-11", 25)), "25.09. – 24.10.2026");
    assert.equal(periodLabel(budgetPeriod("2027-01-03", 25)), "25.12.2026 – 24.01.2027");
  });

  it("formats the local date, not UTC", () => {
    assert.equal(localIsoDate(new Date(2026, 9, 11, 23, 59)), "2026-10-11");
    assert.equal(localIsoDate(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
  });
});
