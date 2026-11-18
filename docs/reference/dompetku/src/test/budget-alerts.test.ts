import { beforeEach, describe, expect, it, vi } from "vitest";

// budget_alerts stub: unique (budget_id, month, level); `missing` simulates schema v11 not run.
const state = { rows: new Set<string>(), missing: false, budgets: [] as any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock("../lib/db.server", () => ({
  db: () => ({
    from: () => ({
      insert: async (r: { budget_id: string; month: string; level: number }) => {
        if (state.missing)
          return { error: { code: "PGRST205", message: "Could not find the table" } };
        const k = `${r.budget_id}|${r.month}|${r.level}`;
        if (state.rows.has(k)) return { error: { code: "23505", message: "duplicate key value" } };
        state.rows.add(k);
        return { error: null };
      },
    }),
  }),
}));
vi.mock("../lib/finance.server", () => ({
  today: () => "2026-10-04",
  computeBudgets: async () => state.budgets,
  isMissingTable: (e: { code?: string }) => e?.code === "PGRST205",
}));
vi.mock("../lib/monitoring.server", () => ({ logError: vi.fn() }));

import { budgetAlertLines, budgetAlertsFor } from "../lib/budget.server";

const budget = (spent: number) => ({
  id: "b1",
  category_id: "c1",
  category: "Makan",
  amount: 1000,
  alert_percent: 80,
  spent,
  percent: (spent / 1000) * 100,
  rollover: false,
  carry: 0,
  effective: 1000,
});
const tx = (amount: number) => ({
  kind: "expense",
  category_id: "c1",
  amount_idr: amount,
  occurred_at: "2026-10-04",
});

beforeEach(() => {
  state.rows.clear();
  state.missing = false;
});

describe("budgetAlertsFor", () => {
  it("alerts once when crossing the warning level", async () => {
    state.budgets = [budget(850)];
    expect((await budgetAlertsFor(tx(100))).map((a) => a.level)).toEqual([80]);
    // a later expense that re-crosses (after an edit) is deduplicated for the month
    expect(await budgetAlertsFor(tx(100))).toEqual([]);
  });
  it("reports both levels when one expense jumps past 100%", async () => {
    state.budgets = [budget(1200)];
    const a = await budgetAlertsFor(tx(1000));
    expect(a.map((x) => x.level)).toEqual([80, 100]);
    expect(budgetAlertLines(a)).toContain("🔴 Budget Makan terlampaui: 120%");
  });
  it("still alerts (no dedup) before schema v11", async () => {
    state.missing = true;
    state.budgets = [budget(900)];
    expect(await budgetAlertsFor(tx(200))).toHaveLength(1);
    expect(await budgetAlertsFor(tx(200))).toHaveLength(1);
  });
  it("ignores income, other months and unbudgeted categories", async () => {
    state.budgets = [budget(900)];
    expect(await budgetAlertsFor({ ...tx(200), kind: "income" })).toEqual([]);
    expect(await budgetAlertsFor({ ...tx(200), occurred_at: "2026-09-30" })).toEqual([]);
    expect(await budgetAlertsFor({ ...tx(200), category_id: "x" })).toEqual([]);
    expect(budgetAlertLines([])).toBe("");
  });
});
