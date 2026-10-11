import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCents, formatDate, parseEuroInput } from "../src/format";

describe("formatCents", () => {
  it("uses German notation without floating point", () => {
    assert.equal(formatCents(-2347), "-23,47 €");
    assert.equal(formatCents(123456), "1.234,56 €");
    assert.equal(formatCents(5), "0,05 €");
    assert.equal(formatCents(100000000), "1.000.000,00 €");
    assert.equal(formatCents(0), "0,00 €");
  });
});

describe("formatDate", () => {
  it("turns ISO dates into German dates", () => assert.equal(formatDate("2026-03-02"), "02.03.2026"));
});

describe("parseEuroInput", () => {
  it("accepts plain and German notation", () => {
    assert.equal(parseEuroInput("40"), 4000);
    assert.equal(parseEuroInput("40,5"), 4050);
    assert.equal(parseEuroInput("1.234,56"), 123456);
    assert.equal(parseEuroInput(" 12 € "), 1200);
  });
  it("rejects everything else", () => {
    for (const bad of ["abc", "1,234", "", "1.2.3", "-5", "1,2,3"]) assert.equal(parseEuroInput(bad), null, bad);
  });
});
