import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Comparison, DealItem, SearchItem } from "../src/api/types";
import { parseCached, serialize } from "../src/logic/offlineCache";
import {
  bestOffer, bestSaving, budgetPresets, compareView, dealBadges, dealFilters, filterDeals, isMonthly, savingNote, savingShare, sortItems, understood, understoodLine,
} from "../src/logic/view";

const item = (id: string, price: number | null, discount = 0, monthly = false): SearchItem =>
  ({
    product: {
      id,
      category: "smartphone",
      title: id,
      attributes: {},
      offers: [{ shop: "s", url: `https://s/${id}`, price_cents: price ?? 0, recurring: monthly ? { monthly_cents: price ?? 0 } : null }],
    },
    ranked: { product_id: id, score: 50, price_cents: price, url: `https://s/${id}` },
    deal: { discount_pct: discount, verdict: "none" },
    saving: null,
  }) as unknown as SearchItem;

describe("sorting results", () => {
  const items = [item("b", 500, 5), item("a", 300, 20), item("c", null, 0), item("d", 400, 10)];
  it("keeps the server's order for best match", () => assert.deepEqual(sortItems(items, "best").map((i) => i.product.id), ["b", "a", "c", "d"]));
  it("puts the cheapest first and unknown prices last", () => assert.deepEqual(sortItems(items, "price").map((i) => i.product.id), ["a", "d", "b", "c"]));
  it("puts the biggest discount first", () => assert.deepEqual(sortItems(items, "deal").map((i) => i.product.id), ["a", "d", "b", "c"]));
  it("does not change the list it was given", () => {
    sortItems(items, "price");
    assert.equal(items[0].product.id, "b");
  });
});

describe("reading a result", () => {
  it("knows plans from purchases and finds the offer behind the price", () => {
    assert.ok(isMonthly(item("p", 1999, 0, true)));
    assert.ok(!isMonthly(item("x", 1999)));
    assert.equal(bestOffer(item("x", 100))?.url, "https://s/x");
  });

  it("badges only real deals", () => {
    assert.deepEqual(dealBadges("great"), [{ label: "Great deal", tone: "success" }]);
    assert.deepEqual(dealBadges("fair"), []);
    assert.deepEqual(dealBadges(undefined), []);
  });

  it("words a saving", () => {
    const i = item("p", 1500, 0, true);
    i.saving = { per_month_cents: 1000, over_horizon_cents: 24000, current: "Old plan" };
    assert.equal(savingNote(i, 24), "Save 10,00 € a month (240,00 € over 24 months)");
    assert.equal(savingNote(item("q", 1), 24), null);
  });

  it("explains what the query was understood as", () => {
    assert.deepEqual(understood({ max_price_cents: 60000, constraints: [{ attribute: "ram_gb", op: "gte", value: 8 }] }), [
      { key: "price", label: "under 600 €" },
      { key: "ram_gbgte8", label: "ram gb ≥ 8" },
    ]);
    assert.deepEqual(understood({ max_price_cents: null, constraints: [] }), []);
  });
});

describe("the comparison table's input", () => {
  const cmp: Comparison = {
    category: "smartphone",
    columns: [
      { product_id: "a", title: "A", brand: null, price_cents: 50000, shop: "s", score: 70, confidence: 1, tier: null },
      { product_id: "b", title: "B", brand: null, price_cents: null, shop: null, score: 40, confidence: 1, tier: null },
    ],
    rows: [
      { key: "price", label: "Price", group: "cost", kind: "price", weight: 0, cells: [{ value: "500,00 EUR", score: null, best: true }, { value: null, score: null, best: false }] },
      { key: "battery", label: "Battery", group: "battery", kind: "criterion", weight: 2, cells: [{ value: "5000 mAh", score: 0.8, best: true }, { value: "4000 mAh", score: 0.4, best: false }] },
    ],
    winner: "a",
  };
  it("moves the price into the header and drops the price row", () => {
    const v = compareView(cmp);
    assert.deepEqual(v.columns.map((c) => c.priceText), ["500,00 €", null]);
    assert.deepEqual(v.rows.map((r) => r.key), ["battery"]);
    assert.deepEqual(v.rows[0].cells, [{ value: "5000 mAh", best: true }, { value: "4000 mAh", best: false }]);
  });
});

describe("the line about what was understood", () => {
  it("counts the price and the conditions", () => {
    assert.equal(understoodLine({ max_price_cents: 70000, constraints: [{}, {}] }), "Understood 3 conditions · budget 700 €");
    assert.equal(understoodLine({ max_price_cents: null, constraints: [{}] }), "Understood 1 condition");
  });
  it("says nothing when nothing was understood", () => assert.equal(understoodLine({ max_price_cents: null, constraints: [] }), null));
});

describe("savings against what you pay now", () => {
  const withSaving = (id: string, perMonth: number | null): SearchItem =>
    ({ ...item(id, 1000, 0, true), saving: perMonth === null ? null : { per_month_cents: perMonth, over_horizon_cents: perMonth * 24, current: "My plan" } }) as SearchItem;
  it("finds the plan that saves the most a month", () => {
    const best = bestSaving([withSaving("a", 500), withSaving("b", 1200), withSaving("c", null), withSaving("d", -300)]);
    assert.equal(best?.perMonthCents, 1200);
    assert.equal(best?.title, "b");
    assert.equal(best?.overHorizonCents, 28800);
  });
  it("finds nothing when no plan is cheaper", () => assert.equal(bestSaving([withSaving("a", -100), withSaving("b", null)]), null));
  it("is a share of the current price, between 0 and 1", () => {
    assert.equal(savingShare(800, 2999)?.toFixed(2), "0.27");
    assert.equal(savingShare(5000, 2999), 1);
    assert.equal(savingShare(800, null), null);
    assert.equal(savingShare(800, 0), null);
  });
});

describe("quick budgets", () => {
  it("are per month for plans and in total for devices", () => {
    assert.deepEqual(budgetPresets("subscription"), [10, 20, 30, 50]);
    assert.deepEqual(budgetPresets("product"), [300, 500, 700, 1000]);
  });
});

describe("filtering deals", () => {
  const deal = (id: string, category: string, pct: number): DealItem =>
    ({ product: { id, category, title: id, attributes: {}, offers: [] }, deal: { discount_pct: pct, verdict: "good" } }) as unknown as DealItem;
  const deals = [deal("a", "smartphone", 19), deal("b", "smartphone", 10), deal("c", "laptop", 17), deal("d", "smartphone", 5)];
  it("offers all, big discounts and each category that has deals, the busiest first", () => {
    assert.deepEqual(dealFilters(deals).map((f) => f.key), ["all", "big", "category:smartphone", "category:laptop"]);
  });
  it("offers no category chips when there is only one", () => {
    assert.deepEqual(dealFilters([deal("a", "smartphone", 5)]).map((f) => f.key), ["all"]);
  });
  it("filters", () => {
    assert.equal(filterDeals(deals, "all").length, 4);
    assert.deepEqual(filterDeals(deals, "big").map((d) => d.product.id), ["a", "c"]);
    assert.deepEqual(filterDeals(deals, "category:laptop").map((d) => d.product.id), ["c"]);
  });
});

describe("pictures in the compare headers", () => {
  const cmp = { columns: [{ product_id: "a", title: "A", price_cents: 100, score: 1 }, { product_id: "b", title: "B", price_cents: null, score: 2 }], rows: [] } as unknown as Comparison;
  it("puts each product's picture on its column", () => {
    const v = compareView(cmp, { a: "https://x/a.png" });
    assert.equal(v.columns[0].imageUri, "https://x/a.png");
    assert.equal(v.columns[1].imageUri, null);
  });
  it("works without any pictures", () => assert.equal(compareView(cmp).columns[0].imageUri, null));
});

describe("the saved copy of a product", () => {
  const detail = { product: { id: "a", title: "A" }, deal: null, history: [], schema: {} } as never;
  it("round-trips", () => {
    const back = parseCached(serialize(detail, 1700000000));
    assert.equal(back?.savedAt, 1700000000);
    assert.equal((back?.detail as { product: { id: string } }).product.id, "a");
  });
  it("ignores anything that is not a saved product", () => {
    assert.equal(parseCached(null), null);
    assert.equal(parseCached("not json"), null);
    assert.equal(parseCached('{"savedAt":1}'), null);
    assert.equal(parseCached('{"savedAt":"x","detail":{"product":{}}}'), null);
  });
});
