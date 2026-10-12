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

import {
  BADGE_IDS,
  MAX_FREEZES,
  badges,
  completeWeeks,
  computeRewards,
  freshBadges,
  personalBests,
  savedThisPeriod,
  streakState,
  trophyMessage,
  trophyMood,
  weekStart,
  type Badge,
  type BadgeInput,
  type Progress,
} from "../src/game";

// April 2026 has 30 days, so a limit of 300,00 € is 10,00 € a day; 1 April is a Wednesday.
const LIMIT = 30000;
const day = (d: number) => `2026-04-${String(d).padStart(2, "0")}`;
const save = (booking_date: string, cents: number): Tx => ({ booking_date, amount_cents: -cents, category: "savings" });
const other = (booking_date: string, cents: number): Tx => ({ booking_date, amount_cents: -cents, category: "dining" });

describe("streak freezes", () => {
  it("earns a freeze with the 7th day of a streak", () => {
    const txs = [g(day(1), 500)];
    const six = streakState(txs, LIMIT, day(6));
    assert.deepEqual([six.days, six.freezes, six.earned], [6, 0, 0]);
    const seven = streakState(txs, LIMIT, day(7));
    assert.deepEqual([seven.days, seven.freezes, seven.earned], [7, 1, 1]);
    assert.equal(seven.reached[7], day(7));
    assert.equal(seven.reached[30], null);
  });

  it("uses a freeze automatically on a missed day and keeps the streak", () => {
    const txs = [g(day(1), 500), g(day(8), 5000)];
    const s = streakState(txs, LIMIT, day(8));
    assert.equal(s.days, 7); // the missed day is bridged, not counted
    assert.equal(s.freezes, 0);
    assert.deepEqual(s.usedOn, [day(8)]);
    assert.equal(s.frozenToday, true);
    // a good day after it continues from 7; the bridged day is not in the count
    const next = streakState(txs, LIMIT, day(9));
    assert.equal(next.days, 8);
    assert.equal(next.frozenToday, false);
    assert.deepEqual(next.usedOn, [day(8)]);
  });

  it("a second miss without a freeze ends the streak, and the longest one is remembered", () => {
    const txs = [g(day(1), 500), g(day(8), 5000), g(day(9), 5000)];
    const s = streakState(txs, LIMIT, day(9));
    assert.equal(s.days, 0);
    assert.equal(s.best, 7);
    assert.equal(s.bestEndedOn, day(7));
    assert.equal(s.freezes, 0);
    assert.deepEqual(s.usedOn, [day(8)]);
  });

  it("holds at most two freezes and loses the extra ones", () => {
    const txs = [g(day(1), 500)];
    const s = streakState(txs, LIMIT, day(21));
    assert.equal(s.days, 21);
    assert.equal(s.freezes, MAX_FREEZES);
    assert.equal(s.earned, 2); // the 21st day would have been a third
    // two freezes cover two misses in a row, the third ends the streak
    const missed = (n: number) => [...txs, ...Array.from({ length: n }, (_, i) => g(day(22 + i), 5000))];
    assert.equal(streakState(missed(2), LIMIT, day(23)).days, 21);
    assert.equal(streakState(missed(2), LIMIT, day(23)).freezes, 0);
    assert.equal(streakState(missed(3), LIMIT, day(24)).days, 0);
  });

  it("earns the next freeze after the next 7 counted days, not by the calendar", () => {
    const txs = [g(day(1), 500), g(day(8), 5000)];
    // 7 counted days, freeze used on the 8th, then the 9th to the 14th make 13 counted days
    assert.equal(streakState(txs, LIMIT, day(14)).freezes, 0);
    const s = streakState(txs, LIMIT, day(15)); // the 14th counted day
    assert.equal(s.days, 14);
    assert.equal(s.freezes, 1);
    assert.equal(s.earned, 2);
  });

  it("is the plain streak when no freeze was ever earned", () => {
    const cases: Tx[][] = [
      [g("2026-04-05", 900), g("2026-04-08", 5000)],
      [g("2026-04-06", 100), g("2026-04-10", 2000)],
      [g("2026-04-08", 100)],
      [g("2026-03-30", 900), g("2026-03-31", 900), g("2026-04-01", 900)],
    ];
    for (const txs of cases) {
      for (const today of ["2026-04-02", "2026-04-06", "2026-04-10"]) {
        assert.equal(streakState(txs, LIMIT, today).days, streak(txs, LIMIT, today), `${JSON.stringify(txs)} on ${today}`);
      }
    }
  });

  it("judges days by their own payday period", () => {
    // payday 25, 300,00 € for a period of 30 days: 10,00 € a day, 24 / 25 Oct is the boundary
    const txs = [g("2026-10-24", 900), g("2026-10-25", 900), g("2026-10-26", 900)];
    assert.equal(streakState(txs, 30000, "2026-10-26", "groceries", 25).days, 3);
    assert.equal(streakState([...txs, g("2026-10-25", 200)], 30000, "2026-10-26", "groceries", 25).days, 1);
  });

  it("is empty without a limit or without data", () => {
    assert.equal(streakState([g(day(1), 100)], 0, day(5)).days, 0);
    assert.equal(streakState([], LIMIT, day(5)).days, 0);
    assert.deepEqual(streakState([], LIMIT, day(5)).usedOn, []);
    // bookings in the future: nothing to judge yet
    assert.equal(streakState([g(day(20), 100)], LIMIT, day(5)).days, 0);
  });

  it("is deterministic: the same data always replays to the same result", () => {
    const txs = [g(day(1), 500), g(day(8), 5000), g(day(12), 3000)];
    assert.deepEqual(streakState(txs, LIMIT, day(15)), streakState([...txs].reverse(), LIMIT, day(15)));
  });
});

describe("weeks and personal bests", () => {
  it("finds the Monday of a week, across month and year ends", () => {
    assert.equal(weekStart("2026-04-06"), "2026-04-06"); // Monday
    assert.equal(weekStart("2026-04-12"), "2026-04-06"); // Sunday
    assert.equal(weekStart("2026-04-01"), "2026-03-30"); // Wednesday
    assert.equal(weekStart("2027-01-01"), "2026-12-28");
  });

  it("only counts complete weeks inside the data", () => {
    const txs = [g(day(1), 300), g(day(7), 6000), g(day(14), 3000), g(day(21), 700)];
    // the week of 30 March starts before the first booking, the week of the 20th is still running
    assert.deepEqual(completeWeeks(txs, day(22)), [
      { start: day(6), end: day(12), spentCents: 6000 },
      { start: day(13), end: day(19), spentCents: 3000 },
    ]);
    // a week is complete only once it ended before today
    assert.equal(completeWeeks(txs, day(19)).length, 1);
    assert.equal(completeWeeks(txs, day(20)).length, 2);
    assert.deepEqual(completeWeeks([], day(22)), []);
  });

  it("reports the cheapest week, the running week and the longest streak", () => {
    const txs = [g(day(1), 300), g(day(7), 6000), g(day(14), 3000), g(day(21), 700)];
    const s = streakState(txs, LIMIT, day(22));
    const b = personalBests(txs, s, day(22));
    assert.deepEqual(b.bestWeek, { start: day(13), end: day(19), spentCents: 3000 });
    assert.equal(b.thisWeekCents, 700);
    assert.equal(b.longestStreak, s.best);
    assert.equal(b.longestStreakEndedOn, s.bestEndedOn);
    // a week without grocery bookings is not a best week
    assert.equal(personalBests([other(day(3), 100)], streakState([], LIMIT, day(22)), day(22)).bestWeek, null);
  });

  it("breaks a tie for the best week in favour of the latest", () => {
    const txs = [g(day(1), 100), g(day(7), 2000), g(day(14), 2000)];
    assert.equal(personalBests(txs, streakState(txs, LIMIT, day(22)), day(22)).bestWeek?.start, day(13));
  });
});

describe("badges", () => {
  const progress: Progress = { transactions: 1, limits: 1, usualItems: 0, prices: 0, receipts: 0 };
  const input = (txs: Tx[], today: string, extra: Partial<BadgeInput> = {}): BadgeInput => {
    const base = { txs, groceryLimit: LIMIT, savingsGoal: 0, today, payday: 1, progress };
    return { ...base, streak: streakState(txs, base.groceryLimit, today, "groceries", base.payday), ...extra };
  };
  const find = (list: Badge[], id: string) => list.find((b) => b.id === id)!;

  it("defines eight distinct badges with a rule each", () => {
    assert.equal(BADGE_IDS.length, 8);
    assert.equal(new Set(BADGE_IDS).size, 8);
    const all = badges(input([], day(5)));
    assert.deepEqual(all.map((b) => b.id), BADGE_IDS);
    assert.ok(all.every((b) => b.rule.length > 10 && b.icon.length > 0 && !b.earned && b.earnedOn === null));
  });

  it("awards the streak badges on the day the streak got there", () => {
    const txs = [g("2026-03-01", 500)];
    const early = badges(input(txs, "2026-03-29"));
    assert.equal(find(early, "first-week").earnedOn, "2026-03-07");
    assert.equal(find(early, "streak-30").earned, false);
    const late = badges(input(txs, "2026-03-30"));
    assert.equal(find(late, "streak-30").earnedOn, "2026-03-30");
    // once earned it stays earned although the streak ends later
    const broken = badges(input([...txs, g("2026-04-05", 99999), g("2026-04-06", 99999), g("2026-04-07", 99999)], "2026-04-07"));
    assert.equal(find(broken, "first-week").earned, true);
  });

  it("awards 'streak saved' on the first day a freeze was used", () => {
    const txs = [g(day(1), 500), g(day(8), 5000)];
    assert.equal(find(badges(input(txs, day(7))), "streak-saved").earned, false);
    assert.equal(find(badges(input(txs, day(8))), "streak-saved").earnedOn, day(8));
  });

  it("awards a week under budget only for a complete week inside the data", () => {
    // week 6 to 12 April: 60,00 € against 7 x 10,00 €
    const ok = [g(day(1), 100), g(day(6), 1000), g(day(8), 2000), g(day(10), 3000)];
    assert.equal(find(badges(input(ok, day(14))), "week-under-budget").earnedOn, day(12));
    // still running on the 12th
    assert.equal(find(badges(input(ok, day(12))), "week-under-budget").earned, false);
    // 80,00 € is over
    const over = [g(day(1), 100), g(day(6), 4000), g(day(8), 4000)];
    assert.equal(find(badges(input(over, day(14))), "week-under-budget").earned, false);
    // the week of the first booking started before it: not enough evidence
    assert.equal(find(badges(input([g(day(1), 100)], day(6))), "week-under-budget").earned, false);
    // weeks without any booking prove nothing; the first week with data counts
    assert.equal(find(badges(input([g(day(1), 100), g(day(20), 100)], day(30))), "week-under-budget").earnedOn, day(26));
    // without a limit there is no budget to be under
    assert.equal(find(badges(input(ok, day(14), { groceryLimit: 0 })), "week-under-budget").earned, false);
  });

  it("awards a period under budget when a whole payday period fits the limit", () => {
    const march = [g("2026-03-01", 10000), g("2026-03-20", 10000)];
    assert.equal(find(badges(input(march, "2026-04-02")), "month-under-budget").earnedOn, "2026-03-31");
    // still running on the 31st
    assert.equal(find(badges(input(march, "2026-03-31")), "month-under-budget").earned, false);
    // 400,00 € against 300,00 €
    assert.equal(find(badges(input([...march, g("2026-03-25", 20000)], "2026-04-02")), "month-under-budget").earned, false);
    // the first booking is in the middle of March: that period does not count, April is not over
    assert.equal(find(badges(input([g("2026-03-15", 100)], "2026-04-02")), "month-under-budget").earned, false);
    // payday 25: the period 25 Mar to 24 Apr ends on the 24th
    const p25 = [g("2026-03-25", 10000), g("2026-04-10", 10000)];
    assert.equal(find(badges(input(p25, "2026-04-25", { payday: 25 })), "month-under-budget").earnedOn, "2026-04-24");
  });

  it("awards a no-spend day for a quiet day between the first and the latest booking", () => {
    const txs = [other(day(1), 800), other(day(3), 800)];
    assert.equal(find(badges(input(txs, day(10))), "no-spend-day").earnedOn, day(2));
    // a transfer to savings is not spending
    assert.equal(find(badges(input([...txs, save(day(2), 5000)], day(10))), "no-spend-day").earnedOn, day(2));
    // money coming in does not break the day either
    const salary: Tx = { booking_date: day(2), amount_cents: 100000, category: "income" };
    assert.equal(find(badges(input([...txs, salary], day(10))), "no-spend-day").earnedOn, day(2));
    // an expense on every day: none
    assert.equal(find(badges(input([other(day(1), 1), other(day(2), 1), other(day(3), 1)], day(10))), "no-spend-day").earned, false);
    // days after the latest booking say nothing (the data may simply not be synced)
    assert.equal(find(badges(input([other(day(1), 800)], day(10))), "no-spend-day").earned, false);
    // today is not over yet
    assert.equal(find(badges(input(txs, day(2))), "no-spend-day").earned, false);
  });

  it("awards the savings goal once a period's savings reach it", () => {
    const base = [save(day(5), 12000), save(day(20), 9000)];
    assert.equal(find(badges(input(base, day(22), { savingsGoal: 20000 })), "savings-goal").earnedOn, day(20));
    assert.equal(find(badges(input(base, day(22), { savingsGoal: 22000 })), "savings-goal").earned, false);
    assert.equal(find(badges(input(base, day(22), { savingsGoal: 0 })), "savings-goal").earned, false);
    // payday 25: the 5th and the 26th are in different periods
    const split = [save(day(5), 12000), save(day(26), 9000)];
    assert.equal(find(badges(input(split, day(28), { savingsGoal: 20000, payday: 25 })), "savings-goal").earned, false);
    assert.equal(find(badges(input(split, day(28), { savingsGoal: 20000, payday: 1 })), "savings-goal").earnedOn, day(26));
    // money taken out of savings counts against it ...
    const out: Tx = { booking_date: day(4), amount_cents: 5000, category: "savings" };
    assert.equal(find(badges(input([out, save(day(5), 12000)], day(22), { savingsGoal: 10000 })), "savings-goal").earned, false);
    // ... but a goal that was reached stays reached
    assert.equal(find(badges(input([save(day(4), 12000), { ...out, booking_date: day(5) }], day(22), { savingsGoal: 10000 })), "savings-goal").earnedOn, day(4));
  });

  it("awards quest master when every quest is done", () => {
    const done = { transactions: 3, limits: 1, usualItems: 2, prices: 5, receipts: 1 };
    const b = find(badges(input([], day(5), { progress: done })), "quest-master");
    assert.deepEqual([b.earned, b.earnedOn], [true, null]);
    assert.equal(find(badges(input([], day(5), { progress: { ...done, receipts: 0 } })), "quest-master").earned, false);
  });
});

describe("saved this period", () => {
  it("adds up the money put aside since the period started, never below zero", () => {
    const txs = [save(day(5), 12000), save(day(20), 9000), save("2026-03-31", 5000), g(day(6), 100)];
    assert.equal(savedThisPeriod(txs, day(22)), 21000);
    assert.equal(savedThisPeriod(txs, day(10)), 12000); // later bookings are not here yet
    // payday 25: the period 25 Mar to 24 Apr holds the 31 March transfer as well
    assert.equal(savedThisPeriod(txs, day(22), 25), 26000);
    assert.equal(savedThisPeriod([{ booking_date: day(5), amount_cents: 500, category: "savings" }], day(22)), 0);
  });
});

describe("celebration guard", () => {
  const badge = (id: string, earned = true): Badge => ({ id, title: id, rule: "", icon: "", earned, earnedOn: null });

  it("celebrates only earned badges that are neither seen nor celebrated in this session", () => {
    const all = [badge("a"), badge("b"), badge("c"), badge("d", false)];
    assert.deepEqual(freshBadges(all, [], new Set()).map((b) => b.id), ["a", "b", "c"]);
    assert.deepEqual(freshBadges(all, ["a"], new Set()).map((b) => b.id), ["b", "c"]);
    assert.deepEqual(freshBadges(all, ["a"], new Set(["c"])).map((b) => b.id), ["b"]);
    assert.deepEqual(freshBadges(all, ["a", "b", "c"], new Set()), []);
  });

  it("does not celebrate twice when called again with the guard filled in", () => {
    const guard = new Set<string>();
    const all = [badge("a"), badge("b")];
    const first = freshBadges(all, [], guard);
    first.forEach((b) => guard.add(b.id));
    assert.equal(first.length, 2);
    assert.equal(freshBadges(all, [], guard).length, 0);
  });
});

describe("rewards together", () => {
  const progress: Progress = { transactions: 1, limits: 1, usualItems: 0, prices: 0, receipts: 0 };
  const rewardsFor = (txs: Tx[], today: string) => computeRewards({ txs, groceryLimit: LIMIT, savingsGoal: 0, today, payday: 1, progress });

  it("computes streak, badges and bests from one input", () => {
    const r = rewardsFor([g(day(1), 500), g(day(8), 5000)], day(8));
    assert.equal(r.streak.days, 7);
    assert.equal(r.streak.frozenToday, true);
    assert.ok(r.badges.some((b) => b.id === "streak-saved" && b.earned));
    assert.equal(r.bests.longestStreak, 7);
  });

  it("talks about the freeze, then the collection", () => {
    assert.match(trophyMessage(rewardsFor([g(day(1), 500), g(day(8), 5000)], day(8))), /streak freeze saved your 7-day streak/);
    const none = rewardsFor([], day(8));
    assert.match(trophyMessage(none), /first trophy/);
    assert.equal(trophyMood(none, false), "happy");
    assert.equal(trophyMood(none, true), "cheer");
    assert.match(trophyMessage(rewardsFor([g(day(1), 500)], day(14))), /Two streak freezes in stock/);
  });

  it("lets the coach and the mascot react to a freeze", () => {
    const args = { progress, streakDays: 7, allowanceCents: 1000, spentTodayCents: 5000, freezeUsedToday: true };
    assert.match(coachMessage(args), /streak freeze covered today.*7-day streak/);
    assert.equal(moodFor(args), "happy");
    assert.equal(moodFor({ ...args, celebrating: true }), "cheer");
    // without the freeze the old behaviour stays
    assert.match(coachMessage({ ...args, freezeUsedToday: false }), /fresh start/);
    assert.equal(moodFor({ ...args, freezeUsedToday: false }), "worried");
  });
});
