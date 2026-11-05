import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dayTotal, filterTx, incomeSpent, searchTx } from "../src/spendingView";

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
