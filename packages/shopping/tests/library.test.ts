import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AttributeDef, JobView, Profile } from "../src/api/types";
import { buildProduct, EMPTY_FORM, parseAttribute, parseCents } from "../src/logic/library";
import { orderProfiles, profileNameProblem, profileSummary } from "../src/logic/profiles";
import { isActive, orderRuns, phaseTone, runProblems, runSummary } from "../src/logic/runs";

describe("parseCents", () => {
  it("reads prices the way people write them", () => {
    assert.equal(parseCents("649"), 64900);
    assert.equal(parseCents("649,90"), 64990);
    assert.equal(parseCents("1.299,00 €"), 129900);
    assert.equal(parseCents("1.299"), 129900);
    assert.equal(parseCents("12.5"), 1250);
    assert.equal(parseCents(" 19,99 EUR "), 1999);
    assert.equal(parseCents("0"), 0);
  });
  it("refuses what is not a price", () => {
    for (const t of ["", "abc", "12,345", "-5", "1,2,3", "€"]) assert.equal(parseCents(t), null, t);
  });
});

describe("parseAttribute", () => {
  it("reads numbers with or without their unit", () => {
    assert.equal(parseAttribute({ kind: "number" }, "5000 mAh"), 5000);
    assert.equal(parseAttribute({ kind: "number" }, "5,5"), 5.5);
    assert.equal(parseAttribute({ kind: "number" }, "1.299"), 1299);
    assert.equal(parseAttribute({ kind: "number" }, "-3"), -3);
    assert.equal(parseAttribute({ kind: "number" }, "many"), undefined);
  });
  it("reads yes and no in both languages", () => {
    assert.equal(parseAttribute({ kind: "bool" }, "Ja"), true);
    assert.equal(parseAttribute({ kind: "bool" }, "no"), false);
    assert.equal(parseAttribute({ kind: "bool" }, "maybe"), undefined);
  });
  it("splits lists, keeps text, and treats empty as not given", () => {
    assert.deepEqual(parseAttribute({ kind: "list" }, "5G, WiFi 6; NFC"), ["5G", "WiFi 6", "NFC"]);
    assert.equal(parseAttribute({ kind: "text" }, " OLED "), "OLED");
    assert.equal(parseAttribute({}, "x"), "x");
    assert.equal(parseAttribute({ kind: "number" }, "  "), null);
  });
});

const defs: AttributeDef[] = [
  { key: "ram_gb", label: "RAM", kind: "number", unit: "GB" },
  { key: "nfc", label: "NFC", kind: "bool" },
  { key: "network", label: "Network", kind: "list" },
];

describe("buildProduct", () => {
  const base = { ...EMPTY_FORM, category: "phones", title: " Pixel 9 " };

  it("builds the request from a typed form", () => {
    const r = buildProduct({ ...base, brand: "Google", gtin: "0840353900001", attributes: { ram_gb: "12 GB", nfc: "yes", network: "5G, LTE" }, shop: "Shop A", url: "https://a.example/p", price: "799,00" }, defs, false);
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.request.attributes, { ram_gb: 12, nfc: true, network: ["5G", "LTE"] });
      assert.equal(r.request.title, "Pixel 9");
      assert.equal(r.request.brand, "Google");
      assert.deepEqual(r.request.offers, [{ shop: "Shop A", url: "https://a.example/p", price_cents: 79900, in_stock: true, condition: "new", recurring: null }]);
    }
  });

  it("needs only a category and a name", () => {
    const r = buildProduct(base, defs, false);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.request.attributes, r.request.offers], [{}, []]);
    const bad = buildProduct(EMPTY_FORM, defs, false);
    assert.ok(!bad.ok && bad.problems.length === 2);
  });

  it("makes a plan from the monthly price", () => {
    const r = buildProduct({ ...base, category: "mobile_plans", shop: "Telco", monthly: "19,99" }, [], true);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.request.offers[0].recurring, { monthly_cents: 1999 });
  });

  it("names every problem at once", () => {
    const r = buildProduct({ ...base, attributes: { ram_gb: "lots", nfc: "maybe" }, price: "cheap", url: "ftp://x", gtin: "123" }, defs, false);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.problems.length, 6, r.problems.join(" | "));
      assert.ok(r.problems.some((p) => p.startsWith("RAM")));
      assert.ok(r.problems.some((p) => p.includes("which shop")));
    }
  });

  it("asks for the price when only the shop is given", () => {
    const r = buildProduct({ ...base, shop: "Shop A" }, defs, false);
    assert.ok(!r.ok && r.problems[0].includes("price"));
  });
});

describe("profiles", () => {
  it("sums up what a profile asks for", () => {
    const p: Profile = { weights: { camera: 3, battery: 2, price: 0 }, preferences: { os: { prefer: ["android"] }, brand: {} }, max_price_cents: 60000, conditions: ["new"], exclude_brands: ["Acme"], in_stock_only: true };
    assert.equal(profileSummary(p), "2 priorities, 1 wish, under 600,00 €, in stock only, new only, without Acme");
    assert.equal(profileSummary({}), "Nothing set: everything counts the same");
    assert.equal(profileSummary({ weights: { a: 1 }, constraints: [{ attribute: "x", op: "gte", value: 1 }] }), "1 priority, 1 requirement");
  });

  it("checks the name of a copy", () => {
    const have = ["default", "Work"];
    assert.equal(profileNameProblem("Holiday", have), null);
    assert.equal(profileNameProblem("  ", have), "Give it a name.");
    assert.match(profileNameProblem("Default", have)!, /taken/);
    assert.match(profileNameProblem("work", have)!, /already/);
    assert.match(profileNameProblem("a/b", have)!, /characters/);
    assert.match(profileNameProblem("x".repeat(41), have)!, /40/);
  });

  it("puts the default first", () => {
    assert.deepEqual(orderProfiles([{ name: "b" }, { name: "default" }, { name: "a" }]).map((p) => p.name), ["default", "a", "b"]);
  });
});

function job(id: string, started: number, phase: JobView["progress"]["phase"], report: JobView["report"] = null): JobView {
  return { id, query: `q ${id}`, category: null, started_at: started, progress: { phase, message: "", done: 3, total: 10, products: 4, failed: 0, percent: 30 }, report };
}

describe("runs", () => {
  it("lists a running one first, then newest first", () => {
    const list = orderRuns([job("old", 100, "done"), job("new", 300, "done"), job("now", 200, "running")]);
    assert.deepEqual(list.map((j) => j.id), ["now", "new", "old"]);
    assert.ok(isActive(list[0]) && !isActive(list[1]));
  });

  it("says what a run found", () => {
    const report = { pages: 22, failed: 2, new_products: 4, price_changes: 1, unchanged: 15, skipped: 0, sources: {}, unclaimed_labels: [], cancelled: false };
    assert.equal(runSummary(job("a", 1, "done", report)), "22 pages, 4 new products, 1 price change, 2 pages failed");
    assert.equal(runSummary(job("b", 1, "running")), "3 of 10 pages · 4 products");
    assert.equal(runSummary(job("c", 1, "done", { ...report, pages: 1, failed: 0, new_products: 0, price_changes: 0 })), "1 page");
  });

  it("lists the shops with trouble", () => {
    const report = { pages: 5, failed: 3, new_products: 0, price_changes: 0, unchanged: 0, skipped: 0, unclaimed_labels: [], cancelled: false, sources: { A: { pages: 3, failed: 0, products: 3, last_error: null }, B: { pages: 2, failed: 2, products: 0, last_error: "HTTP 403" }, C: { pages: 3, failed: 1, products: 2, last_error: null } } };
    assert.deepEqual(runProblems(job("x", 1, "done", report)), [{ shop: "B", text: "HTTP 403" }, { shop: "C", text: "1 of 3 pages failed" }]);
  });

  it("colours the phases", () => {
    assert.deepEqual(["done", "failed", "cancelled", "running", "queued"].map((p) => phaseTone(p as never)), ["success", "danger", "warning", "info", "neutral"]);
  });
});
