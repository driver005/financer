import test from "node:test";
import assert from "node:assert/strict";

import { coreFallback as core } from "../src/rust/coreFallback";

test("native fallback mirrors the Rust core API", () => {
  assert.equal(core.parseEuro("5,50"), 550);
  assert.equal(core.formatEuro(1250), "12,50 €");
  assert.equal(core.scaleAmount("200 g", 4, 2), "400 g");
  assert.equal(core.periodKey("week", new Date(2026, 10, 17)), "2026-W47");
  assert.equal(core.periodStartKey(new Date(2026, 10, 17), 18), "2026-10");
  assert.equal(core.evaluate("12,50 + 2*3"), 1850);
  assert.equal(core.ledgerBalance([
    { txId: "t", accountId: "bank", side: "credit", cents: 1000 },
    { txId: "t", accountId: "bank", side: "debit", cents: 400 },
  ], "bank"), 600);
  assert.equal(core.ledgerCheck([
    { txId: "t", accountId: "bank", side: "credit", cents: 1000 },
    { txId: "t", accountId: "cash", side: "debit", cents: 1000 },
  ]).balanced, true);
  assert.equal(core.goldProfit(2, 5000, 6000).profit, 2000);
  assert.deepEqual(core.splitBill(1000, 3, "equal", []), [334, 333, 333]);
  assert.equal(core.invoiceTotal([{ qty: 2, cents: 1000 }], 19), 2380);
  assert.equal(core.creditPayoff(100000, 10000, 0).months, 10);
});

test("native fallback parses receipts, offers and XLSX without WebAssembly", () => {
  assert.deepEqual(core.parseReceipt("Milk 1,29\nBread 2,50"), [
    { name: "Milk", cents: 129 }, { name: "Bread", cents: 250 },
  ]);
  const offers = core.parseOffers("Milk 1,29 €", "rewe");
  assert.equal(offers[0].price, "1,29 €");
  const rows = [{ date: "2026-11-02", merchant: "REWE", amountCents: 2040, category: "Groceries", kind: "expense" }];
  const xlsx = core.xlsx(rows);
  assert.ok(xlsx.startsWith("UEsD")); // ZIP local header, base64 "PK\x03\x04"
  const parsed = core.xlsxImport(xlsx);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].amountCents, 2040);
  assert.ok(core.reportPdf(rows, "Report").length > 100);
});

test("native fallback chat commands and forecasting", () => {
  const command = core.chatCommand("/add 12,50 Food Lidl");
  assert.equal(command.cents, 1250);
  assert.equal(command.merchant, "Lidl");
  const prices = [
    { name: "Milk", storeId: "rewe", date: "2026-11-03", cents: 149 },
    { name: "Milk", storeId: "rewe", date: "2026-11-10", cents: 129 },
    { name: "Milk", storeId: "lidl", date: "2026-11-10", cents: 139 },
  ];
  assert.equal(core.priceStats(prices, "Milk", "rewe").current, 129);
  const plan = core.optimize(prices, [{ name: "Milk" }], ["rewe", "lidl"], "2026-11-17");
  assert.ok(plan[0]);
  assert.equal(plan[0]!.store, "rewe");
  assert.equal(core.paycheckPlan(200000, [{ label: "Bills", kind: "fixed", cents: 90000 }])[1].label, "Guilt-free");
});
