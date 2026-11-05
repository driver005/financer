import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NO_FILTERS, applyFilters, dayTotal, filterChips, filterTx, incomeSpent, searchTx, withoutFilter, type BookingFilters } from "../src/spendingView";

const tx = (counterparty: string, purpose: string, category: string | null, amount_cents: number) => ({ counterparty, purpose, category, amount_cents });

const items = [tx("REWE Markt GmbH", "Einkauf 14.10.", "groceries", -4674), tx("Netflix International", "Abo", "subscriptions", -1299), tx("Arbeitgeber AG", "Gehalt", null, 285000)];

describe("the Spending list", () => {
  it("keeps everything for a blank search", () => {
    assert.equal(searchTx(items, "").length, 3);
    assert.equal(searchTx(items, "   ").length, 3);
  });
  it("finds every typed word in the shop, the purpose or the category", () => {
    assert.deepEqual(searchTx(items, "rewe").map((t) => t.counterparty), ["REWE Markt GmbH"]);
    assert.equal(searchTx(items, "REWE einkauf").length, 1);
    assert.equal(searchTx(items, "rewe netflix").length, 0);
    assert.equal(searchTx(items, "subscriptions").length, 1);
  });
  it("adds up what came in and what went out of what is listed", () => {
    assert.deepEqual(incomeSpent(items), { income: 285000, spent: 5973 });
    assert.deepEqual(incomeSpent(searchTx(items, "netflix")), { income: 0, spent: 1299 });
    assert.deepEqual(incomeSpent([]), { income: 0, spent: 0 });
  });
  it("works together with the filter and the day total", () => {
    const spending = filterTx(items, "spending");
    assert.equal(searchTx(spending, "gehalt").length, 0);
    assert.equal(dayTotal(searchTx(spending, "netflix")), -1299);
  });
});

const booking = (booking_date: string, counterparty: string, category: string | null, amount_cents: number) => ({ booking_date, counterparty, purpose: "", category, amount_cents });
const book = [
  booking("2026-11-05", "REWE", "groceries", -4674),
  booking("2026-11-03", "Lidl", "groceries", -1294),
  booking("2026-10-30", "Netflix", "subscriptions", -1299),
  booking("2026-10-01", "Arbeitgeber", null, 285000),
];
const today = "2026-11-05";

describe("the filters of the list", () => {
  it("shows everything with no filter, newest first", () => {
    assert.deepEqual(applyFilters(book, NO_FILTERS, today).map((t) => t.counterparty), ["REWE", "Lidl", "Netflix", "Arbeitgeber"]);
    assert.deepEqual(filterChips(NO_FILTERS), []);
  });
  it("narrows by kind, category, period and amount together", () => {
    const f: BookingFilters = { ...NO_FILTERS, kind: "spending", categories: ["groceries"], preset: "30d", max_cents: 2000 };
    assert.deepEqual(applyFilters(book, f, today).map((t) => t.counterparty), ["Lidl"]);
    assert.deepEqual(applyFilters(book, { ...NO_FILTERS, categories: ["uncategorized"] }, today).map((t) => t.counterparty), ["Arbeitgeber"]);
  });
  it("orders by amount, whichever way it went", () => {
    assert.deepEqual(applyFilters(book, { ...NO_FILTERS, sort: "largest" }, today).map((t) => t.counterparty), ["Arbeitgeber", "REWE", "Netflix", "Lidl"]);
    assert.deepEqual(applyFilters(book, { ...NO_FILTERS, sort: "oldest" }, today).map((t) => t.counterparty), ["Arbeitgeber", "Netflix", "Lidl", "REWE"]);
  });
  it("has a chip for every filter that is on, and each chip switches its filter off", () => {
    const f: BookingFilters = { ...NO_FILTERS, query: "re", kind: "spending", categories: ["groceries", "utilities"], preset: "month", min_cents: 500, sort: "largest" };
    const chips = filterChips(f);
    assert.deepEqual(chips.map((c) => c.key), ["query", "kind", "preset", "category:groceries", "category:utilities", "amount", "sort"]);
    let left = f;
    for (const c of chips) left = withoutFilter(left, c.key);
    assert.deepEqual(left, NO_FILTERS);
    assert.deepEqual(withoutFilter(f, "category:groceries").categories, ["utilities"]);
  });
});
