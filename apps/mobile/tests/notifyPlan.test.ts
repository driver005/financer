import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Price, SafeToSpend } from "../src/api/client";
import {
  DEFAULT_PREFS,
  EMPTY_MEMORY,
  MAX_ANNOUNCED,
  anyEnabled,
  eveningPlan,
  findPriceDrops,
  parsePrefs,
  parsePriceMemory,
  paydayPlan,
  priceDropMessage,
  type PriceMemory,
} from "../src/notifyPlan";

const safe: SafeToSpend = {
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

describe("preferences", () => {
  it("are all off by default and for unreadable data", () => {
    assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs(""), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs("{not json"), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs("42"), DEFAULT_PREFS);
    assert.equal(anyEnabled(DEFAULT_PREFS), false);
  });

  it("read the stored flags and ignore anything that is not exactly true", () => {
    const prefs = parsePrefs('{"evening":true,"payday":"yes","priceDrop":true,"other":true}');
    assert.deepEqual(prefs, { evening: true, payday: false, priceDrop: true });
    assert.equal(anyEnabled(prefs), true);
  });
});

describe("eveningPlan", () => {
  it("tells today's number before the evening time, with later days as projections", () => {
    const plan = eveningPlan(safe, 12 * 60);
    assert.deepEqual(
      plan.map((p) => [p.id, p.hour, p.minute]),
      [
        ["financer.evening.2026-10-11", 18, 0],
        ["financer.evening.2026-10-12", 18, 0],
        ["financer.evening.2026-10-13", 18, 0],
      ],
    );
    assert.equal(plan[0].body, "You have 92,14 € left to spend today.");
    // 129000 / 13 days left on the 12th
    assert.equal(plan[1].body, "About 99,23 € is free to spend today.");
    assert.equal(plan[2].body, "About 107,50 € is free to spend today."); // 129000 / 12
  });

  it("skips today once the evening time has passed", () => {
    const plan = eveningPlan(safe, 18 * 60);
    assert.equal(plan[0].date, "2026-10-12");
    assert.equal(plan.length, 2);
    assert.equal(eveningPlan(safe, 18 * 60 - 1)[0].date, "2026-10-11");
  });

  it("does not plan past the end of the budget period", () => {
    const lastDay = { ...safe, today: "2026-10-24", days_left: 1 };
    assert.deepEqual(eveningPlan(lastDay, 0).map((p) => p.date), ["2026-10-24"]);
    assert.deepEqual(eveningPlan(lastDay, 23 * 60), []);
  });

  it("plans nothing without detected income", () => {
    assert.deepEqual(eveningPlan({ ...safe, income_detected: false }, 0), []);
  });

  it("says so when the period is over budget or nothing is left", () => {
    const over = eveningPlan({ ...safe, available_cents: -2347, daily_cents: 0 }, 0)[0];
    assert.equal(over.body, "This period is over budget by 23,47 €. Go easy today.");
    const none = eveningPlan({ ...safe, available_cents: 0, daily_cents: 0 }, 0);
    assert.equal(none[0].body, "Nothing is left to spend today.");
    assert.equal(none[1].body, "Nothing is left to spend today.");
  });

  it("honours a custom time and day count", () => {
    const plan = eveningPlan(safe, 0, { time: { hour: 20, minute: 30 }, days: 1 });
    assert.equal(plan.length, 1);
    assert.deepEqual([plan[0].hour, plan[0].minute], [20, 30]);
  });
});

describe("paydayPlan", () => {
  it("names the next paydays by the existing period rule", () => {
    const plan = paydayPlan("2026-10-11", 25, 9 * 60);
    assert.deepEqual(plan.map((p) => p.date), ["2026-10-25", "2026-11-25"]);
    assert.deepEqual(plan.map((p) => p.id), ["financer.payday.2026-10-25", "financer.payday.2026-11-25"]);
    assert.equal(plan[0].hour, 8);
    assert.match(plan[0].body, /25\.10\. – 24\.11\.2026/);
  });

  it("uses calendar months at payday 1 and names the month", () => {
    const plan = paydayPlan("2026-10-11", 1, 0);
    assert.deepEqual(plan.map((p) => p.date), ["2026-11-01", "2026-12-01"]);
    assert.match(plan[0].body, /November 2026/);
  });

  it("includes today only while the morning reminder time is still ahead", () => {
    assert.equal(paydayPlan("2026-10-25", 25, 7 * 60)[0].date, "2026-10-25");
    assert.equal(paydayPlan("2026-10-25", 25, 8 * 60)[0].date, "2026-11-25");
  });

  it("copes with short months and year ends", () => {
    assert.deepEqual(paydayPlan("2026-01-31", 31, 9 * 60).map((p) => p.date), ["2026-02-28", "2026-03-31"]);
    assert.deepEqual(paydayPlan("2026-12-20", 25, 0).map((p) => p.date), ["2026-12-25", "2027-01-25"]);
  });

  it("returns the requested number of entries", () => {
    assert.equal(paydayPlan("2026-10-11", 25, 0, { count: 3 }).length, 3);
  });
});

function price(item: string, chain: string, cents: number, extra: Partial<Price> = {}): Price {
  return {
    chain,
    is_offer: false,
    item,
    item_name: item,
    price_cents: cents,
    product_name: `${item} ${chain}`,
    reference_pack: "1 l",
    shelf_price_cents: cents,
    source: "test",
    ...extra,
  };
}

const milk = { item: "milch", name: "Milk" };
const butter = { item: "butter", name: "Butter" };

describe("findPriceDrops", () => {
  it("announces nothing the first time an item is seen, but remembers its price", () => {
    const r = findPriceDrops([milk], [price("milch", "aldi", 109), price("milch", "lidl", 99)], EMPTY_MEMORY);
    assert.deepEqual(r.drops, []);
    assert.deepEqual(r.memory.refs, { milch: 99 });
  });

  it("announces a drop of the cheapest price once", () => {
    const m1 = findPriceDrops([milk], [price("milch", "lidl", 109)], EMPTY_MEMORY).memory;
    const r = findPriceDrops([milk], [price("milch", "lidl", 109), price("milch", "aldi", 89, { is_offer: true })], m1);
    assert.equal(r.drops.length, 1);
    assert.deepEqual(r.drops[0], { item: "milch", name: "Milk", chain: "aldi", cents: 89, wasCents: 109, pack: "1 l", isOffer: true });
    assert.equal(r.memory.refs.milch, 89);

    // the same prices again: not announced a second time
    const again = findPriceDrops([milk], [price("milch", "aldi", 89, { is_offer: true })], r.memory);
    assert.deepEqual(again.drops, []);
  });

  it("does not repeat a drop after a rise and fall back to the same price", () => {
    const m1: PriceMemory = { refs: { milch: 109 }, announced: [] };
    const dropped = findPriceDrops([milk], [price("milch", "aldi", 89)], m1);
    assert.equal(dropped.drops.length, 1);
    const rose = findPriceDrops([milk], [price("milch", "aldi", 109)], dropped.memory);
    assert.deepEqual(rose.drops, []);
    assert.equal(rose.memory.refs.milch, 109);
    const fell = findPriceDrops([milk], [price("milch", "aldi", 89)], rose.memory);
    assert.deepEqual(fell.drops, []); // same item, chain and price as announced before
    const fellFurther = findPriceDrops([milk], [price("milch", "aldi", 79)], fell.memory);
    assert.equal(fellFurther.drops.length, 1); // a new, lower price is news
  });

  it("ignores small dips and lets slow declines add up", () => {
    // 5 cents: under the 10 cent floor, and the reference stays where it was
    let r = findPriceDrops([milk], [price("milch", "aldi", 195)], { refs: { milch: 200 }, announced: [] });
    assert.deepEqual(r.drops, []);
    assert.equal(r.memory.refs.milch, 200);
    // the next day 15 cents below the original 200 (7.5 %): now it is a drop
    r = findPriceDrops([milk], [price("milch", "aldi", 185)], r.memory);
    assert.equal(r.drops.length, 1);
    // 8 % but only 6 cents on a 75 cent item: under the cent floor
    r = findPriceDrops([milk], [price("milch", "aldi", 69)], { refs: { milch: 75 }, announced: [] });
    assert.deepEqual(r.drops, []);
    // 4 % of 1000 is 40 cents: above the cent floor but under the percent floor
    r = findPriceDrops([milk], [price("milch", "aldi", 960)], { refs: { milch: 1000 }, announced: [] });
    assert.deepEqual(r.drops, []);
  });

  it("moves the reference up when the price rises", () => {
    const r = findPriceDrops([milk], [price("milch", "aldi", 150)], { refs: { milch: 100 }, announced: [] });
    assert.deepEqual(r.drops, []);
    assert.equal(r.memory.refs.milch, 150);
  });

  it("keeps what it knew when an item has no price right now, and forgets items that left the list", () => {
    const r = findPriceDrops([milk], [price("butter", "lidl", 199)], { refs: { milch: 109, butter: 250 }, announced: [] });
    assert.deepEqual(r.memory.refs, { milch: 109 });
    assert.deepEqual(r.drops, []);
  });

  it("ignores free or invalid prices", () => {
    const r = findPriceDrops([milk], [price("milch", "aldi", 0)], { refs: { milch: 109 }, announced: [] });
    assert.deepEqual(r.drops, []);
    assert.equal(r.memory.refs.milch, 109);
  });

  it("orders drops by the saving and does not change its input", () => {
    const memory: PriceMemory = { refs: { milch: 109, butter: 299 }, announced: ["x:y:1"] };
    const copy = JSON.stringify(memory);
    const r = findPriceDrops([milk, butter], [price("milch", "lidl", 89), price("butter", "aldi", 199)], memory);
    assert.deepEqual(r.drops.map((d) => d.item), ["butter", "milch"]);
    assert.equal(JSON.stringify(memory), copy);
    assert.deepEqual(r.memory.announced, ["x:y:1", "milch:lidl:89", "butter:aldi:199"]);
  });

  it("breaks price ties between chains deterministically", () => {
    const a = findPriceDrops([milk], [price("milch", "rewe", 89), price("milch", "aldi", 89)], { refs: { milch: 109 }, announced: [] });
    const b = findPriceDrops([milk], [price("milch", "aldi", 89), price("milch", "rewe", 89)], { refs: { milch: 109 }, announced: [] });
    assert.equal(a.drops[0].chain, "aldi");
    assert.equal(b.drops[0].chain, "aldi");
  });

  it("caps the announced list", () => {
    const announced = Array.from({ length: MAX_ANNOUNCED + 10 }, (_, i) => `k${i}`);
    const r = findPriceDrops([milk], [price("milch", "aldi", 50)], { refs: { milch: 109 }, announced });
    assert.equal(r.memory.announced.length, MAX_ANNOUNCED);
    assert.equal(r.memory.announced.at(-1), "milch:aldi:50");
  });
});

describe("parsePriceMemory", () => {
  it("falls back to an empty memory for missing or broken data", () => {
    assert.deepEqual(parsePriceMemory(null), EMPTY_MEMORY);
    assert.deepEqual(parsePriceMemory("nope"), EMPTY_MEMORY);
    assert.deepEqual(parsePriceMemory("null"), EMPTY_MEMORY);
  });

  it("keeps valid entries only", () => {
    const m = parsePriceMemory('{"refs":{"a":100,"b":"x","c":-5,"d":0},"announced":["k",5,"j"]}');
    assert.deepEqual(m, { refs: { a: 100 }, announced: ["k", "j"] });
  });

  it("round-trips what findPriceDrops returns", () => {
    const r = findPriceDrops([milk], [price("milch", "aldi", 99)], EMPTY_MEMORY);
    assert.deepEqual(parsePriceMemory(JSON.stringify(r.memory)), r.memory);
  });
});

describe("priceDropMessage", () => {
  const drop = { item: "milch", name: "Milk", chain: "aldi", cents: 89, wasCents: 109, pack: "1 l", isOffer: false };

  it("is null without drops", () => {
    assert.equal(priceDropMessage([]), null);
  });

  it("describes a single drop", () => {
    assert.deepEqual(priceDropMessage([drop]), { title: "Cheaper: Milk", body: "Milk: 0,89 € per 1 l at Aldi (was 1,09 €)" });
    assert.match(priceDropMessage([{ ...drop, isOffer: true }])!.body, /, on offer$/);
  });

  it("sums up several drops in one message", () => {
    const many = ["a", "b", "c", "d", "e"].map((n) => ({ ...drop, item: n, name: n.toUpperCase() }));
    const msg = priceDropMessage(many)!;
    assert.equal(msg.title, "5 of your usual items got cheaper");
    assert.equal(msg.body.split("\n").length, 4);
    assert.match(msg.body, /and 2 more$/);
  });
});
