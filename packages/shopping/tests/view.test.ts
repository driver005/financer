import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Comparison, SearchItem } from "../src/api/types";
import { bestOffer, compareView, dealBadges, isMonthly, savingNote, sortItems, understood } from "../src/logic/view";

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
