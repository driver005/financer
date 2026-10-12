import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dayHeading, formatCents, formatDate, formatMoney, moneyTone, parseEuroInput, spokenMoney, splitMoney } from "../src/format";

describe("formatCents", () => {
  it("uses German notation without floating point", () => {
    assert.equal(formatCents(-2347), "-23,47 €");
    assert.equal(formatCents(123456), "1.234,56 €");
    assert.equal(formatCents(5), "0,05 €");
    assert.equal(formatCents(100000000), "1.000.000,00 €");
    assert.equal(formatCents(0), "0,00 €");
  });
});

describe("formatMoney", () => {
  it("uses a real minus and a non-breaking space before the euro sign", () => {
    assert.equal(formatMoney(-2347), "−23,47 €");
    assert.equal(formatMoney(123456), "1.234,56 €");
    assert.equal(formatMoney(0, { signed: true }), "0,00 €");
  });
  it("shows a plus only when asked", () => {
    assert.equal(formatMoney(2850, { signed: true }), "+28,50 €");
    assert.equal(formatMoney(2850), "28,50 €");
    assert.equal(formatMoney(-5, { signed: true }), "−0,05 €");
  });
});

describe("moneyTone, spokenMoney, splitMoney", () => {
  it("tones by sign", () => {
    assert.equal(moneyTone(5), "income");
    assert.equal(moneyTone(-5), "expense");
    assert.equal(moneyTone(0), "zero");
  });
  it("speaks amounts for screen readers", () => {
    assert.equal(spokenMoney(-2347), "minus 23,47 euros");
    assert.equal(spokenMoney(100000), "1.000,00 euros");
  });
  it("splits an amount for a hero figure", () => {
    assert.deepEqual(splitMoney(3062), { sign: "", whole: "30", fraction: "62" });
    assert.deepEqual(splitMoney(-123456), { sign: "−", whole: "1.234", fraction: "56" });
  });
});

describe("dayHeading", () => {
  it("names today and yesterday, otherwise weekday and date", () => {
    assert.equal(dayHeading("2026-10-12", "2026-10-12"), "Today");
    assert.equal(dayHeading("2026-10-11", "2026-10-12"), "Yesterday");
    assert.equal(dayHeading("2026-10-09", "2026-10-12"), "Fri 09.10.2026");
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
