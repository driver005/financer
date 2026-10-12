import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Forecast } from "../src/api/client";
import { daysBetween, forecastView, groceryText, shortDate } from "../src/forecast";

const base: Forecast = {
  payday: 25,
  period_start: "2026-09-25",
  period_end: "2026-10-24",
  today: "2026-10-11",
  days_through: 17,
  days_after_today: 13,
  early: false,
  income_detected: true,
  income_received_cents: 250000,
  income_upcoming_cents: 0,
  next_income_date: null,
  spent_so_far_cents: 100000,
  fixed_costs_due_cents: 1000,
  grocery_spent_cents: 20000,
  other_spent_cents: 0,
  grocery_daily_cents: 1176,
  other_daily_cents: 0,
  projected_extra_spend_cents: 15294,
  projected_leftover_cents: 133706,
  grocery_limit_cents: 40000,
  grocery_run_out: null,
  grocery_exhausted: false,
  level: "ok",
  reason: "on_track",
};

describe("dates", () => {
  it("shortens and subtracts ISO dates", () => {
    assert.equal(shortDate("2026-10-19"), "19.10.");
    assert.equal(daysBetween("2026-10-19", "2026-10-24"), 5);
    assert.equal(daysBetween("2026-12-30", "2027-01-02"), 3);
    assert.equal(daysBetween("2026-10-24", "2026-10-24"), 0);
  });
});

describe("grocery wording", () => {
  it("says nothing without a grocery limit", () => {
    assert.equal(groceryText({ ...base, grocery_limit_cents: null }), null);
    assert.equal(forecastView({ ...base, grocery_limit_cents: null }).groceries, null);
  });

  it("names the run-out date and how many days early it is", () => {
    const f = { ...base, grocery_run_out: "2026-10-19", level: "watch", reason: "groceries_run_out" } as const;
    assert.equal(groceryText(f), "At this pace the grocery budget runs out on 19.10., 5 days before the period ends.");
    assert.match(groceryText({ ...f, grocery_run_out: "2026-10-23" })!, /on 23\.10\., 1 day before/);
  });

  it("says when the budget is already used up, and when it lasts", () => {
    assert.equal(
      groceryText({ ...base, grocery_exhausted: true, grocery_run_out: "2026-10-09" }),
      "Your grocery budget of 400,00 € was used up on 09.10.",
    );
    assert.match(groceryText(base)!, /should last until the period ends/);
    assert.match(groceryText({ ...base, grocery_spent_cents: 0 })!, /No grocery spending yet/);
  });
});

describe("forecast view", () => {
  it("is good news when on track", () => {
    const v = forecastView(base);
    assert.equal(v.tone, "good");
    assert.equal(v.status, "On track");
    assert.equal(v.amountCents, 133706);
    assert.equal(v.reason, "At the current pace you end the period with 1.337,06 € to spare.");
    assert.equal(v.early, null);
  });

  it("calls a shortfall a shortfall, and softens it early in the period", () => {
    const short = { ...base, projected_leftover_cents: -25117, level: "danger", reason: "projected_shortfall" } as const;
    const v = forecastView(short);
    assert.equal(v.tone, "bad");
    assert.equal(v.status, "Heading for a shortfall");
    assert.equal(v.amountCents, -25117);
    assert.equal(v.reason, "At the current pace you would end the period 251,17 € short.");

    const early = forecastView({ ...short, level: "watch", early: true, days_through: 1, days_after_today: 29 });
    assert.equal(early.tone, "warn");
    assert.equal(early.status, "Could end short");
    assert.equal(early.early, "Only 1 day of this period is over, so this is a rough guess.");
  });

  it("explains pending and late income", () => {
    const pending = forecastView({
      ...base,
      income_received_cents: 0,
      income_upcoming_cents: 250000,
      next_income_date: "2026-10-28",
      reason: "income_pending",
    });
    assert.equal(pending.tone, "good");
    assert.equal(pending.reason, "Counting on 2.500,00 € arriving on 28.10.2026.");

    const late = forecastView({ ...base, income_upcoming_cents: 250000, next_income_date: "2026-10-09", level: "watch", reason: "income_overdue" });
    assert.equal(late.tone, "warn");
    assert.equal(late.status, "Income is late");
    assert.match(late.reason, /expected on 09\.10\.2026 and is not booked yet/);
  });

  it("warns about groceries with the date", () => {
    const v = forecastView({ ...base, grocery_run_out: "2026-10-19", level: "watch", reason: "groceries_run_out" });
    assert.equal(v.tone, "warn");
    assert.equal(v.status, "Keep an eye on groceries");
    assert.match(v.reason, /runs out on 19\.10\./);
    assert.equal(v.reason, v.groceries);
  });

  it("flags a thin margin", () => {
    const v = forecastView({ ...base, projected_leftover_cents: 4883, level: "watch", reason: "thin_margin" });
    assert.equal(v.tone, "warn");
    assert.match(v.reason, /Only 48,83 € would be left/);
  });

  it("does not invent a number without data or income", () => {
    const none = forecastView({ ...base, level: "ok", reason: "no_data", early: true, projected_leftover_cents: 0 });
    assert.equal(none.amountCents, null);
    assert.equal(none.tone, "muted");
    assert.equal(none.early, null);
    const noIncome = forecastView({ ...base, income_detected: false, reason: "no_income" });
    assert.equal(noIncome.amountCents, null);
    assert.match(noIncome.reason, /No recurring income/);
  });

  it("only mentions an early guess while days remain", () => {
    assert.equal(forecastView({ ...base, early: true, days_through: 3, days_after_today: 27 }).early, "Only 3 days of this period are over, so this is a rough guess.");
    assert.equal(forecastView({ ...base, early: true, days_through: 3, days_after_today: 0 }).early, null);
  });
});
