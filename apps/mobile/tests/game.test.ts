import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coachMessage, dailyAllowance, dailyAllowanceForDays, dailyAllowanceOn, daysInMonth, level, quests, spentOn, streak, xp, type Tx } from "../src/game";

const g = (booking_date: string, cents: number): Tx => ({ booking_date, amount_cents: -cents, category: "groceries" });

describe("allowance", () => {
  it("splits the monthly limit over the days of that month", () => {
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(dailyAllowance(30000, 2026, 4), 1000); // 30 days
    assert.equal(dailyAllowance(10000, 2026, 3), 322); // 31 days, rounded down
  });

  it("sums only the category and day, and refunds reduce it", () => {
    const txs = [g("2026-04-10", 500), g("2026-04-10", 250), { booking_date: "2026-04-10", amount_cents: -999, category: "dining" }, g("2026-04-11", 100)];
    assert.equal(spentOn(txs, "2026-04-10", "groceries"), 750);
    assert.equal(spentOn([g("2026-04-10", 100), { booking_date: "2026-04-10", amount_cents: 300, category: "groceries" }], "2026-04-10", "groceries"), 0);
  });
});

describe("streak", () => {
  const limit = 30000; // 10,00 € a day in a 30-day month

  it("counts days in a row within the allowance, ending today", () => {
    const txs = [g("2026-04-01", 500), g("2026-04-05", 900), g("2026-04-08", 5000)];
    // Apr 8 is over (50 > 10): streak is Apr 9 and Apr 10
    assert.equal(streak(txs, limit, "2026-04-10"), 2);
  });

  it("a day over the allowance today means no streak", () => {
    assert.equal(streak([g("2026-04-01", 100), g("2026-04-10", 2000)], limit, "2026-04-10"), 0);
  });

  it("does not count days before the first transaction", () => {
    assert.equal(streak([g("2026-04-08", 100)], limit, "2026-04-10"), 3);
  });

  it("is zero without a limit or without data", () => {
    assert.equal(streak([g("2026-04-08", 100)], 0, "2026-04-10"), 0);
    assert.equal(streak([], limit, "2026-04-10"), 0);
  });

  it("crosses month boundaries using each month's own allowance", () => {
    // 31-day March: 31000 / 31 = 1000; 30-day April: 1000 as well, but 9 € is fine in both
    const txs = [g("2026-03-30", 900), g("2026-03-31", 900), g("2026-04-01", 900)];
    assert.equal(streak(txs, 30000, "2026-04-02"), 4);
  });
});

describe("quests, xp and levels", () => {
  const none = { transactions: 0, limits: 0, usualItems: 0, prices: 0, receipts: 0 };

  it("marks quests done from real counts", () => {
    const q = quests({ ...none, transactions: 44, limits: 3 });
    assert.deepEqual(q.filter((x) => x.done).map((x) => x.id), ["import", "limit"]);
    assert.equal(q.length, 5);
  });

  it("awards xp for quests and streak days and derives a level", () => {
    assert.equal(xp(2, 3), 35);
    assert.deepEqual(level(0), { level: 1, title: "Penny Pincher", into: 0, size: 50 });
    assert.equal(level(49).level, 1);
    assert.equal(level(50).level, 2);
    assert.equal(level(50).title, "Budget Bee");
    assert.equal(level(10_000).title, "Money Master");
  });
});

describe("coach", () => {
  const base = { progress: { transactions: 5, limits: 1, usualItems: 0, prices: 0, receipts: 0 }, streakDays: 0, allowanceCents: 1000, spentTodayCents: 0 };
  it("reacts to the real situation", () => {
    assert.match(coachMessage({ ...base, progress: { ...base.progress, transactions: 0 } }), /Import your spending/);
    assert.match(coachMessage({ ...base, allowanceCents: 0 }), /grocery limit/);
    assert.match(coachMessage({ ...base, spentTodayCents: 1500 }), /fresh start/);
    assert.match(coachMessage({ ...base, streakDays: 9 }), /9 days in a row/);
    assert.match(coachMessage({ ...base, streakDays: 3 }), /3-day streak/);
  });
});

import { moodFor } from "../src/game";

describe("mood", () => {
  const base = { streakDays: 0, allowanceCents: 1000, spentTodayCents: 0 };
  it("is worried over the goal, cheering on a win or a week-long streak, otherwise happy", () => {
    assert.equal(moodFor(base), "happy");
    assert.equal(moodFor({ ...base, spentTodayCents: 1001 }), "worried");
    assert.equal(moodFor({ ...base, spentTodayCents: 1000 }), "happy");
    assert.equal(moodFor({ ...base, streakDays: 7 }), "cheer");
    assert.equal(moodFor({ ...base, celebrating: true }), "cheer");
    // worry beats cheering: an overspent day is not a win
    assert.equal(moodFor({ ...base, spentTodayCents: 2000, streakDays: 9, celebrating: true }), "worried");
    // no limit set: nothing to be worried about
    assert.equal(moodFor({ streakDays: 0, allowanceCents: 0, spentTodayCents: 5000 }), "happy");
  });
});

describe("payday periods", () => {
  it("splits the limit over the days of the payday period, not the calendar month", () => {
    assert.equal(dailyAllowanceForDays(30000, 30), 1000);
    assert.equal(dailyAllowanceForDays(10000, 31), 322);
    // 25 Sep to 24 Oct is 30 days, the calendar month October has 31
    assert.equal(dailyAllowanceOn(31000, "2026-10-11", 25), 1033);
    assert.equal(dailyAllowanceOn(31000, "2026-10-11", 1), 1000);
    // payday 1 matches the calendar-month allowance exactly
    assert.equal(dailyAllowanceOn(10000, "2026-03-15"), dailyAllowance(10000, 2026, 3));
  });

  it("judges every day by the period it belongs to", () => {
    // payday 25, limit 300 for a 30-day period = 10 a day; 24 Oct ends one period, 25 Oct starts the next
    const txs = [g("2026-10-24", 900), g("2026-10-25", 900), g("2026-10-26", 900)];
    assert.equal(streak(txs, 30000, "2026-10-26", "groceries", 25), 3);
    assert.equal(streak([...txs, g("2026-10-25", 200)], 30000, "2026-10-26", "groceries", 25), 1);
  });

  it("is unchanged by default", () => {
    const txs = [g("2026-04-01", 500), g("2026-04-05", 900), g("2026-04-08", 5000)];
    assert.equal(streak(txs, 30000, "2026-04-10"), streak(txs, 30000, "2026-04-10", "groceries", 1));
  });
});
