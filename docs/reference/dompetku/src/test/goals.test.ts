import { describe, expect, it } from "vitest";
import { activityDetail } from "../lib/activity";
import { goalMarker, goalTransferDescription, planGoalFunds, projectGoal } from "../lib/goals";

const base = {
  goalId: "g1",
  goalName: "Dana darurat",
  goalAccountId: "save",
  saved: 1_000_000,
  amount: 500_000,
  accountId: "bca",
  date: "2026-10-04",
};

describe("planGoalFunds", () => {
  it("deposit transfers source -> goal account and bumps saved", () => {
    const p = planGoalFunds(base);
    expect(p).toMatchObject({ direction: "deposit", moved: 500_000, newSaved: 1_500_000 });
    expect(p.transfer).toEqual({
      account_id: "bca",
      to_account_id: "save",
      amount: 500_000,
      description: "Setor target Dana darurat",
      notes: "[goal:g1]",
      occurred_at: "2026-10-04",
    });
  });
  it("withdrawal transfers goal account -> chosen account, capped at saved", () => {
    const p = planGoalFunds({ ...base, amount: -3_000_000 });
    expect(p).toMatchObject({ direction: "withdraw", moved: 1_000_000, newSaved: 0 });
    expect(p.transfer).toMatchObject({
      account_id: "save",
      to_account_id: "bca",
      amount: 1_000_000,
      description: "Tarik target Dana darurat",
    });
  });
  it("no transfer without both accounts or when they are the same", () => {
    expect(planGoalFunds({ ...base, goalAccountId: null }).transfer).toBeNull();
    expect(planGoalFunds({ ...base, accountId: null }).transfer).toBeNull();
    expect(planGoalFunds({ ...base, accountId: "save" }).transfer).toBeNull();
    expect(planGoalFunds({ ...base, accountId: null }).newSaved).toBe(1_500_000);
  });
  it("rejects zero, non-finite and withdrawing from an empty goal", () => {
    expect(() => planGoalFunds({ ...base, amount: 0 })).toThrow();
    expect(() => planGoalFunds({ ...base, amount: Number.NaN })).toThrow();
    expect(() => planGoalFunds({ ...base, saved: 0, amount: -10 })).toThrow();
  });
  it("helpers", () => {
    expect(goalMarker("x")).toBe("[goal:x]");
    expect(goalTransferDescription("withdraw", "Liburan")).toBe("Tarik target Liburan");
  });
  it("activity detail shows the transfer route", () => {
    expect(
      activityDetail(
        { name: "Liburan", amount: 5, currency: "IDR", from: "BCA", to: "Jago" },
        (n) => String(n),
      ),
    ).toBe("Liburan · 5 · BCA → Jago");
  });
});

describe("projectGoal", () => {
  const today = "2026-10-04";
  it("no deadline: only remaining + ETA", () => {
    const p = projectGoal({ target: 10_000_000, saved: 2_000_000, today, createdAt: "2026-06-04" });
    expect(p).toMatchObject({
      remaining: 8_000_000,
      daysLeft: null,
      monthsLeft: null,
      monthlyNeeded: null,
      weeklyNeeded: null,
      status: "no_deadline",
      expectedByNow: null,
    });
    // 2jt over 4 months = 500rb/mo → 16 months
    expect(p.eta).toBe("2028-02");
  });
  it("monthly/weekly needed ceil to rupiah", () => {
    const p = projectGoal({ target: 1_000_000, saved: 0, deadline: "2027-01-04", today });
    expect(p.monthsLeft).toBe(3);
    expect(p.monthlyNeeded).toBe(333_334);
    expect(p.daysLeft).toBe(92);
    expect(p.weeklyNeeded).toBe(Math.ceil(1_000_000 / 13));
  });
  it("calendar months: partial month floors but min 1", () => {
    expect(projectGoal({ target: 100, saved: 0, deadline: "2026-12-03", today }).monthsLeft).toBe(
      1,
    );
    expect(projectGoal({ target: 100, saved: 0, deadline: "2026-10-20", today }).monthsLeft).toBe(
      1,
    );
    expect(
      projectGoal({ target: 100, saved: 0, deadline: "2027-02-28", today: "2027-01-31" })
        .monthsLeft,
    ).toBe(1);
  });
  it("on_track vs behind uses linear progress since createdAt", () => {
    const base = { target: 1_200_000, deadline: "2027-10-04", today, createdAt: "2025-10-04" };
    const on = projectGoal({ ...base, saved: 600_000 });
    expect(on.expectedByNow).toBe(600_000);
    expect(on.status).toBe("on_track");
    expect(projectGoal({ ...base, saved: 599_999 }).status).toBe("behind");
  });
  it("accepts ISO timestamps for createdAt", () => {
    const p = projectGoal({
      target: 100,
      saved: 50,
      deadline: "2026-10-14",
      today,
      createdAt: "2026-09-24T08:00:00.000Z",
    });
    expect(p.expectedByNow).toBe(50);
    expect(p.status).toBe("on_track");
  });
  it("missing createdAt: no expectation, no ETA, still on_track", () => {
    const p = projectGoal({ target: 100, saved: 10, deadline: "2027-01-01", today });
    expect(p).toMatchObject({ expectedByNow: null, eta: null, status: "on_track" });
  });
  it("done when saved >= target or target 0", () => {
    const over = projectGoal({ target: 100, saved: 150, deadline: "2025-01-01", today });
    expect(over).toMatchObject({ remaining: 0, status: "done", monthlyNeeded: null, eta: null });
    expect(projectGoal({ target: 0, saved: 0, today }).status).toBe("done");
  });
  it("deadline today: whole remainder due now", () => {
    const p = projectGoal({
      target: 100,
      saved: 40,
      deadline: today,
      today,
      createdAt: "2026-01-01",
    });
    expect(p).toMatchObject({ daysLeft: 0, monthsLeft: 1, monthlyNeeded: 60, weeklyNeeded: 60 });
    expect(p.status).toBe("behind");
  });
  it("past deadline: overdue, no monthly need", () => {
    const p = projectGoal({
      target: 100,
      saved: 40,
      deadline: "2026-09-01",
      today,
      createdAt: "2026-01-01",
    });
    expect(p).toMatchObject({
      status: "overdue",
      monthsLeft: 0,
      monthlyNeeded: null,
      daysLeft: -33,
    });
    expect(p.expectedByNow).toBe(100);
  });
  it("ETA null without progress; new goals use a 1-month minimum window", () => {
    expect(projectGoal({ target: 100, saved: 0, today, createdAt: "2026-01-01" }).eta).toBeNull();
    // created today with 50 saved → pace 50/mo → 1 month
    expect(projectGoal({ target: 100, saved: 50, today, createdAt: today }).eta).toBe("2026-11");
  });
  it("ignores garbage inputs", () => {
    const p = projectGoal({
      target: Number.NaN,
      saved: -5,
      deadline: "nope",
      today,
      createdAt: "bad",
    });
    expect(p).toMatchObject({ remaining: 0, status: "done", daysLeft: null });
  });
});
