import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api } from "../src/api/client";
import type { Alert, PriceHike, Subscriptions, UpcomingCharge } from "../src/api/client";
import type { Transport } from "../src/api/transport";
import {
  alertText,
  badgesFor,
  duplicateText,
  groupByWeek,
  hikeText,
  nextChargeText,
  percentText,
  sortAlerts,
  staleText,
  weekStart,
} from "../src/watchdog";

const charge = (date: string, counterparty: string, amount_cents: number, extra: Partial<UpcomingCharge> = {}): UpcomingCharge => ({
  date,
  counterparty,
  amount_cents,
  cadence: "monthly",
  confidence: 80,
  overdue: false,
  ...extra,
});

const alert = (extra: Partial<Alert>): Alert => ({
  id: "dup-1",
  kind: "duplicate_charge",
  severity: "medium",
  reason: "english",
  transaction_id: 1,
  booking_date: "2026-03-01",
  counterparty: "Shop",
  amount_cents: 5000,
  reference_cents: 5000,
  history_count: 0,
  dismissed: false,
  ...extra,
});

describe("weekStart", () => {
  it("is the Monday of the week, also over month and year boundaries", () => {
    assert.equal(weekStart("2026-10-05"), "2026-10-05"); // a Monday
    assert.equal(weekStart("2026-10-11"), "2026-10-05"); // the Sunday after
    assert.equal(weekStart("2026-10-12"), "2026-10-12");
    assert.equal(weekStart("2027-01-01"), "2026-12-28"); // Friday
    assert.equal(weekStart("2028-03-01"), "2028-02-28"); // leap year
  });
});

describe("groupByWeek", () => {
  const asOf = "2026-10-07"; // Wednesday
  it("groups by week with this week, next week and dated headings, and sums each week", () => {
    const groups = groupByWeek(
      [
        charge("2026-10-20", "Gym", 2990),
        charge("2026-10-09", "Netflix", 1299),
        charge("2026-10-07", "Spotify", 999),
        charge("2026-10-14", "Zeitung", 1500),
        charge("2026-10-22", "Strom", 6000),
      ],
      asOf,
    );
    assert.deepEqual(
      groups.map((g) => [g.label, g.items.map((i) => i.counterparty), g.totalCents]),
      [
        ["This week", ["Spotify", "Netflix"], 2298],
        ["Next week", ["Zeitung"], 1500],
        ["19.10. - 25.10.", ["Gym", "Strom"], 8990],
      ],
    );
  });

  it("puts overdue charges first in their own group, whatever their date", () => {
    const groups = groupByWeek([charge("2026-10-08", "Netflix", 1299), charge("2026-10-02", "Spotify", 999, { overdue: true })], asOf);
    assert.deepEqual(groups.map((g) => g.label), ["Overdue", "This week"]);
    assert.equal(groups[0].items[0].counterparty, "Spotify");
  });

  it("returns nothing for an empty calendar", () => assert.deepEqual(groupByWeek([], asOf), []));
});

describe("percent and price hike wording", () => {
  const hike: PriceHike = {
    counterparty: "Spotify",
    cadence: "monthly",
    old_amount_cents: 999,
    new_amount_cents: 1199,
    delta_cents: 200,
    percent_bp: 2002,
    since: "2026-09-15",
  };
  it("formats basis points as a German percentage", () => {
    assert.equal(percentText(2002), "+20,0 %");
    assert.equal(percentText(250), "+2,5 %");
    assert.equal(percentText(5), "+0,1 %");
    assert.equal(percentText(-1000), "-10,0 %");
  });
  it("explains old, new, delta, percent and since", () => {
    assert.equal(hikeText(hike), "Spotify went from 9,99 € to 11,99 € (+20,0 %, +2,00 € per month) since 15.09.2026.");
  });
});

describe("badgesFor", () => {
  const report: Pick<Subscriptions, "price_hikes" | "duplicates"> = {
    price_hikes: [
      { counterparty: "Spotify", cadence: "monthly", old_amount_cents: 999, new_amount_cents: 1199, delta_cents: 200, percent_bp: 2002, since: "2026-09-15" },
    ],
    duplicates: [
      {
        reason: "similar_merchant",
        first: { counterparty: "Netflix" } as Subscriptions["duplicates"][number]["first"],
        second: { counterparty: "NETFLIX BV" } as Subscriptions["duplicates"][number]["second"],
      },
    ],
  };
  it("marks hikes, duplicates, late and unsure charges", () => {
    assert.deepEqual(badgesFor(charge("2026-10-15", "Spotify", 1199), report).map((b) => b.id), ["hike"]);
    assert.deepEqual(badgesFor(charge("2026-10-05", "NETFLIX BV", 1199), report).map((b) => b.id), ["duplicate"]);
    assert.deepEqual(
      badgesFor(charge("2026-10-05", "Netflix", 1299, { overdue: true, confidence: 30 }), report).map((b) => b.id),
      ["duplicate", "late", "unsure"],
    );
    assert.deepEqual(badgesFor(charge("2026-10-05", "Gym", 2990), report), []);
  });
});

describe("duplicate and stale wording", () => {
  const sub = (counterparty: string, amount_cents: number, last_date = "2026-03-10") =>
    ({ counterparty, amount_cents, monthly_cents: amount_cents, cadence: "monthly", first_date: "2026-01-10", last_date, next_expected: "2026-04-10", occurrences: 3, confidence: 55 }) as Subscriptions["active"][number];
  it("names both merchants, or one when it is billed twice", () => {
    assert.match(
      duplicateText({ reason: "similar_merchant", first: sub("Netflix", 1299), second: sub("NETFLIX BV", 1199) }),
      /^Netflix and NETFLIX BV look like the same service, both monthly at 12,99 € and 11,99 €/,
    );
    assert.match(duplicateText({ reason: "same_merchant", first: sub("Netflix", 1299), second: sub("Netflix", 1299) }), /^Netflix is billed twice/);
  });
  it("tells when the last charge was and how many were missed", () => {
    assert.match(staleText({ subscription: sub("Fitness", 2990), days_since_last: 199, periods_missed: 6 }), /^Last 29,90 € on 10.03.2026; 6 monthly charges did not come/);
  });
});

describe("alerts", () => {
  it("words each kind from its numbers, and falls back to the server's reason", () => {
    assert.match(alertText(alert({})), /^Shop charged 50,00 € again within a few days/);
    assert.equal(
      alertText(alert({ kind: "unusual_amount", amount_cents: 25000, reference_cents: 6000, history_count: 8, counterparty: "Aral" })),
      "250,00 € is far above the usual 60,00 € at Aral (based on 8 earlier charges).",
    );
    assert.match(alertText(alert({ kind: "new_merchant", amount_cents: 45000, counterparty: "Möbelhaus" })), /^First payment to Möbelhaus, and it is 450,00 €/);
    assert.match(alertText(alert({ kind: "large_for_category", amount_cents: 30000, reference_cents: 3000 })), /large for this category, where the usual is about 30,00 €/);
    assert.equal(alertText(alert({ kind: "something_new", reason: "Server says so" })), "Server says so");
    assert.equal(alertText(alert({ kind: "unusual_amount", reference_cents: null, reason: "fallback" })), "fallback");
  });

  it("sorts open alerts first, then by severity, then newest", () => {
    const sorted = sortAlerts([
      alert({ id: "a", severity: "low", booking_date: "2026-03-09" }),
      alert({ id: "b", severity: "high", booking_date: "2026-03-01" }),
      alert({ id: "c", severity: "high", booking_date: "2026-03-05" }),
      alert({ id: "d", severity: "high", booking_date: "2026-03-30", dismissed: true }),
      alert({ id: "e", severity: "medium", booking_date: "2026-03-20" }),
    ]);
    assert.deepEqual(sorted.map((a) => a.id), ["c", "b", "e", "a", "d"]);
  });
});

describe("nextChargeText", () => {
  it("names the soonest charge inside the window", () => {
    const upcoming = [charge("2026-10-15", "Spotify", 1199), charge("2026-10-09", "Netflix", 1299)];
    assert.equal(nextChargeText(upcoming, "2026-10-07", 14), "Next: Netflix 12,99 € on 09.10.");
    assert.equal(nextChargeText(upcoming, "2026-10-07", 1), null);
    assert.equal(nextChargeText([], "2026-10-07", 14), null);
  });
});

describe("Api watchdog calls", () => {
  function recording(body: string) {
    const calls: Array<{ method: string; path: string }> = [];
    const transport: Transport = {
      async send(req) {
        calls.push({ method: req.method, path: req.path });
        return { status: 200, text: body };
      },
    };
    return { api: new Api(transport), calls };
  }

  it("asks for the right paths", async () => {
    const { api, calls } = recording("{}");
    await api.subscriptions();
    await api.subscriptions(60);
    await api.alerts();
    await api.alerts(true);
    await api.dismissAlert("dup-0123abcd");
    assert.deepEqual(calls, [
      { method: "GET", path: "/v1/subscriptions" },
      { method: "GET", path: "/v1/subscriptions?days=60" },
      { method: "GET", path: "/v1/alerts" },
      { method: "GET", path: "/v1/alerts?include_dismissed=true" },
      { method: "POST", path: "/v1/alerts/dup-0123abcd/dismiss" },
    ]);
  });
});
