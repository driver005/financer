import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dailyAllowanceOn, spentOn } from "../src/game";
import { DEMO_TAG, demoExport, demoGate, demoTransactions, isDemoBooking } from "../src/onboardingDemo";

const TODAY = "2026-10-12";

describe("demo bookings", () => {
  it("labels every booking as demo", () => {
    const rows = demoTransactions(TODAY, 1);
    assert.ok(rows.length > 40);
    for (const r of rows) {
      assert.ok(r.counterparty.startsWith(DEMO_TAG));
      assert.match(r.purpose, /DEMO/);
      assert.ok(isDemoBooking(r));
    }
  });

  it("is deterministic and never in the future", () => {
    assert.deepEqual(demoTransactions(TODAY, 15, ["lidl"]), demoTransactions(TODAY, 15, ["lidl"]));
    assert.ok(demoTransactions(TODAY, 28).every((r) => r.booking_date <= TODAY));
    assert.ok(demoTransactions("2026-01-01", 1).every((r) => r.booking_date <= "2026-01-01"));
  });

  it("has at least three salary bookings on the payday so income is recognised as recurring", () => {
    for (const today of ["2026-10-12", "2026-10-31", "2026-03-01"]) {
      const salary = demoTransactions(today, 25).filter((r) => r.category === "income");
      assert.ok(salary.length >= 3, today);
      assert.ok(salary.every((r) => r.booking_date.endsWith("-25") && r.amount_cents === 245_000));
      const rent = demoTransactions(today, 25).filter((r) => r.category === "housing");
      assert.ok(rent.length >= 3);
    }
  });

  it("only uses the stores the user picked", () => {
    const names = new Set(demoTransactions(TODAY, 1, ["aldi", "rewe"]).filter((r) => r.category === "groceries").map((r) => r.counterparty));
    assert.deepEqual([...names].sort(), [`${DEMO_TAG} Aldi`, `${DEMO_TAG} Rewe`]);
    const all = new Set(demoTransactions(TODAY, 1).filter((r) => r.category === "groceries").map((r) => r.counterparty));
    assert.equal(all.size, 4);
  });

  it("spends groceries on most days of the week so the daily goal has something to show", () => {
    const rows = demoTransactions(TODAY, 1);
    const txs = rows.map((r) => ({ booking_date: r.booking_date, amount_cents: r.amount_cents, category: r.category }));
    const trips = rows.filter((r) => r.category === "groceries" && r.booking_date.startsWith("2026-09"));
    assert.ok(trips.length >= 6);
    // a plausible grocery month fits a 10 EUR a day goal
    const month = trips.reduce((s, r) => s - r.amount_cents, 0);
    assert.ok(month < 30_000 && month > 8_000);
    assert.ok(spentOn(txs, trips[0].booking_date, "groceries") > 0);
    assert.ok(dailyAllowanceOn(30_000, TODAY, 1) > 0);
  });

  it("clamps days to short months", () => {
    const rows = demoTransactions("2026-03-31", 28);
    assert.ok(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.booking_date)));
  });

  it("sends bookings only: no budget, usual items, receipts or settings that the import would replace", () => {
    const doc = demoExport(TODAY, 1);
    assert.equal(doc.version, 1);
    assert.deepEqual([doc.budget, doc.basket, doc.receipts, doc.settings], [[], [], [], {}]);
    assert.ok(doc.transactions.length > 0);
  });
});

describe("demo gate", () => {
  it("is open on an empty setup", () => assert.deepEqual(demoGate([]), { allowed: true }));

  it("refuses when real bookings exist and says why", () => {
    const g = demoGate([{ counterparty: "REWE SAGT DANKE" }, { counterparty: `${DEMO_TAG} Employer` }]);
    assert.equal(g.allowed, false);
    assert.match(g.reason!, /2 bookings/);
  });

  it("recognises demo data that is already loaded", () => {
    const g = demoGate([{ counterparty: `${DEMO_TAG} Rewe` }]);
    assert.equal(g.allowed, false);
    assert.match(g.reason!, /already loaded/);
  });
});
