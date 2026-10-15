import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { demoCsv } = require("../scripts/demo-seed.js");

describe("CI demo data", () => {
  const now = new Date(2026, 9, 15);
  const lines = demoCsv(now).trim().split("\n");

  it("has the Sparkasse header and complete rows", () => {
    assert.match(lines[0], /^"Auftragskonto";"Buchungstag"/);
    for (const l of lines.slice(1)) assert.equal(l.split('";"').length, 11, l);
  });

  it("puts bookings in the current month, so the current period is never empty", () => {
    const month = lines.slice(1).filter((l) => /";"\d\d\.10\.26";/.test(l));
    assert.ok(month.length >= 5, `only ${month.length} bookings in October`);
  });

  it("mixes supermarkets, income and fixed costs", () => {
    const text = lines.join("\n");
    for (const needle of ["LIDL", "REWE", "ALDI", "KAUFLAND", "GEHALT", "Miete", "Netflix"]) assert.ok(text.includes(needle), needle);
  });

  it("never dates a booking in the future", () => {
    for (const l of lines.slice(1)) {
      const [, d, m, y] = l.match(/";"(\d\d)\.(\d\d)\.(\d\d)";/);
      assert.ok(new Date(2000 + Number(y), Number(m) - 1, Number(d)) <= now, l);
    }
  });
});
