import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SafeToSpend } from "../src/api/client";
import { breakdownRows, daysLeftText, headlineHint, paceInfo } from "../src/safeToSpend";

const base: SafeToSpend = {
  payday: 25,
  period_start: "2026-09-25",
  period_end: "2026-10-24",
  today: "2026-10-11",
  days_left: 14,
  days_total: 30,
  daily_cents: 9214,
  available_cents: 129000,
  income_detected: true,
  income_cents: 250000,
  income_received_cents: 250000,
  income_upcoming_cents: 0,
  spent_so_far_cents: 100000,
  fixed_costs_due_cents: 1000,
  envelope_headroom_cents: 20000,
  pace: "on_track",
  pace_target_cents: 95766,
  discretionary_spent_cents: 20000,
};

describe("breakdown", () => {
  it("adds up to the available amount", () => {
    const rows = breakdownRows(base);
    assert.equal(rows.reduce((a, r) => a + r.cents, 0), base.available_cents);
    assert.deepEqual(rows.map((r) => r.id), ["income", "spent", "fixed", "envelopes"]);
  });

  it("says where the income comes from, or that there is none", () => {
    assert.match(breakdownRows(base)[0].hint, /2\.500,00 € arrived, 0,00 € still expected/);
    const none = breakdownRows({ ...base, income_detected: false, income_cents: 0 })[0];
    assert.match(none.hint, /No recurring income/);
  });
});

describe("wording", () => {
  it("describes the days left", () => {
    assert.equal(daysLeftText(14), "14 days left in this period");
    assert.equal(daysLeftText(1), "the last day of this period");
  });

  it("explains the pace", () => {
    assert.equal(paceInfo(base).title, "On track");
    assert.equal(paceInfo(base).tone, "good");
    assert.equal(paceInfo({ ...base, pace: "over_pace" }).tone, "warn");
    assert.equal(paceInfo({ ...base, pace: "unknown" }).tone, "muted");
    assert.match(paceInfo(base).detail, /957,66 €/);
  });

  it("summarises the situation", () => {
    assert.match(headlineHint(base), /1\.290,00 € free for 14 days left/);
    assert.match(headlineHint({ ...base, available_cents: -2500 }), /over budget by 25,00 €/);
    assert.match(headlineHint({ ...base, income_detected: false }), /No recurring income/);
  });
});
