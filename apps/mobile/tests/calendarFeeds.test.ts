import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chargeOccurrences, contractOccurrences, mealOccurrences, paydayOccurrences, weekStarts } from "../src/calendarFeeds";

describe("calendar feeds", () => {
  it("payday falls once in every month the range touches", () => {
    const days = paydayOccurrences(25, "2026-10-26", "2026-12-06").map((o) => o.startDate);
    assert.deepEqual(days, ["2026-11-25"]);
    assert.deepEqual(paydayOccurrences(1, "2026-10-26", "2026-12-06").map((o) => o.startDate), ["2026-11-01", "2026-12-01"]);
  });
  it("feed events are read-only, all-day and lead to their screen", () => {
    const [p] = paydayOccurrences(25, "2026-11-01", "2026-11-30");
    assert.equal(p.readOnly, true);
    assert.equal(p.allDay, true);
    assert.equal(p.href, "/budget");
    assert.equal(p.tone, "success");
  });
  it("charges inside the range show with the amount as a cost", () => {
    const list = chargeOccurrences(
      [
        { counterparty: "Netflix", date: "2026-11-05", amount_cents: 1299 },
        { counterparty: "Gym", date: "2027-01-05", amount_cents: 2500 },
      ],
      "2026-11-01",
      "2026-11-30",
    );
    assert.equal(list.length, 1);
    assert.ok(list[0].title.startsWith("Netflix"));
    assert.ok(list[0].title.includes("12,99"));
    assert.equal(list[0].href, "/subscriptions");
  });
  it("meals show on their day with the servings", () => {
    const [m] = mealOccurrences([{ date: "2026-11-04", title: "Lentil soup", servings: 2 }], "2026-11-01", "2026-11-30");
    assert.equal(m.title, "Lentil soup");
    assert.equal(m.notes, "2 servings");
    assert.equal(m.href, "/mealplan");
  });
  it("a contract shows its end and a reminder two months before", () => {
    const list = contractOccurrences([{ category: "mobile", name: "Mobile plan", plan: "Flex 20 GB", endsOn: "2027-01-15" }], "2026-11-01", "2027-01-31");
    assert.deepEqual(list.map((o) => o.startDate).sort(), ["2026-11-15", "2027-01-15"]);
    assert.ok(list.every((o) => o.href === "/shop"));
  });
  it("week starts are the Mondays touching the range", () => {
    assert.deepEqual(weekStarts("2026-11-03", "2026-11-17"), ["2026-11-02", "2026-11-09", "2026-11-16"]);
  });
});
