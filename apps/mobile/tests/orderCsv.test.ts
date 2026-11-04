import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectColumns, parseAmount, parseCsv, parseDay, previewText, readOrders, shopFromWebsite } from "../src/orderCsv";

const AMAZON = [
  "Website,Order ID,Order Date,Currency,Unit Price,Unit Price Tax,Shipping Charge,Total Owed,Quantity,Order Status,Product Name",
  'Amazon.de,302-1111111-1111111,2026-02-11T09:21:33Z,EUR,12.99,2.07,0,25.98,2,Closed,"USB-C Kabel, 2 m, ""geflochten"""',
  "Amazon.de,302-1111111-1111111,2026-02-11T09:21:33Z,EUR,11.99,1.91,0,11.99,1,Closed,Handyhülle",
  "Amazon.de,302-2222222-2222222,2026-02-12T23:30:00Z,EUR,8.99,1.43,0,8.99,1,Cancelled,Maus",
  "Amazon.de,302-3333333-3333333,2026-02-13T10:00:00Z,USD,5.00,0,0,5.00,1,Closed,Dollar item",
  "Amazon.de,302-4444444-4444444,2026-03-01T10:00:00Z,EUR,3.50,0.56,0,,3,Closed,Batterien",
].join("\n");

describe("the csv", () => {
  it("reads quotes, commas and line breaks inside a cell, a byte order mark and the separator", () => {
    assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",z'), [["a", "b"], ["x, y", 'say "hi"'], ["line\nbreak", "z"]]);
    assert.deepEqual(parseCsv("a;b\n1,5;2"), [["a", "b"], ["1,5", "2"]]);
    assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(parseCsv("a,b\n\n1,2\n"), [["a", "b"], ["1", "2"]]);
  });
});

describe("columns", () => {
  it("are found by heading, in English and German, whatever the version", () => {
    const a = detectColumns(["Order ID", "Order Date", "Total Amount", "Product Name"]);
    assert.deepEqual(a.missing, []);
    assert.equal(a.columns.total, 2);
    const g = detectColumns(["Bestellnummer", "Bestelldatum", "Artikel", "Menge", "Gesamtbetrag", "Währung"]);
    assert.deepEqual(g.missing, []);
    assert.equal(g.columns.currency, 5);
    // "Total Owed" beats "Unit Price"
    assert.equal(detectColumns(["Order ID", "Order Date", "Product Name", "Unit Price", "Total Owed"]).columns.total, 4);
  });
  it("say what is missing", () => {
    assert.deepEqual(detectColumns(["Foo", "Bar"]).missing, ["id", "date", "name", "total"]);
  });
});

describe("amounts and days", () => {
  it("reads the usual ways to write an amount", () => {
    const cases: [string, number | null][] = [["12.99", 1299], ["12,99", 1299], ["1.234,56", 123456], ["1,234.56", 123456], ["€ 12,99", 1299], ["-5", -500], ["1.234", 123400], ["7", 700], ["abc", null], ["", null], ["12,99 EUR", 1299]];
    for (const [t, c] of cases) assert.equal(parseAmount(t), c, t);
  });
  it("reads a day from an ISO stamp (in the local zone), a plain date or a German date", () => {
    assert.equal(parseDay("2026-02-11T09:21:33Z", 60), "2026-02-11");
    assert.equal(parseDay("2026-02-11T23:30:00Z", 60), "2026-02-12");
    assert.equal(parseDay("2026-02-11", 60), "2026-02-11");
    assert.equal(parseDay("11.02.2026"), "2026-02-11");
    assert.equal(parseDay("31.02.2026"), null);
    assert.equal(parseDay("yesterday"), null);
  });
  it("makes a shop name from a website", () => {
    assert.equal(shopFromWebsite("Amazon.de"), "Amazon");
    assert.equal(shopFromWebsite("www.ebay.co.uk"), "Ebay");
    assert.equal(shopFromWebsite("Mein Shop"), "Mein Shop");
  });
});

describe("an order file", () => {
  it("makes one order of the rows with the same number and leaves out what it cannot use", () => {
    const r = readOrders(AMAZON, 60);
    assert.ok(r.ok);
    if (!r.ok) return;
    const f = r.file;
    assert.equal(f.shop, "Amazon");
    assert.deepEqual(f.orders.map((o) => o.id), ["302-4444444-4444444", "302-1111111-1111111"], "newest first");
    const first = f.orders.find((o) => o.id === "302-1111111-1111111")!;
    assert.equal(first.date, "2026-02-11");
    assert.equal(first.total_cents, 3797);
    assert.deepEqual(first.lines.map((l) => [l.name, l.quantity, l.total_cents]), [['USB-C Kabel, 2 m, "geflochten"', 2, 2598], ["Handyhülle", 1, 1199]]);
    assert.equal(f.skipped.cancelled, 1);
    assert.equal(f.skipped.otherCurrency, 1);
    // a missing total falls back to unit price times quantity
    assert.equal(f.orders.find((o) => o.id === "302-4444444-4444444")!.total_cents, 1050);
    assert.equal(f.orders.length, 2);
    assert.equal(f.first, "2026-02-11");
    assert.equal(f.last, "2026-03-01");
  });
  it("is refused with the headings it has when the columns are not there", () => {
    const r = readOrders("Foo,Bar\n1,2");
    assert.ok(!r.ok);
    if (!r.ok) assert.ok(r.reason.includes("Foo, Bar") && r.reason.includes("order number"));
    assert.ok(!readOrders("only a heading").ok);
  });
  it("says what it found", () => {
    const r = readOrders(AMAZON, 60);
    assert.ok(r.ok);
    if (r.ok) assert.equal(previewText(r.file), "2 orders with 3 lines, 2026-02-11 to 2026-03-01; left out: 1 cancelled, 1 not in euro.");
  });
});
