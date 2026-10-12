import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clamp01, countUpValue, dashOffset, easeOutCubic, heroFontSize, periodLeft, ringGeometry } from "../src/ring";

describe("ringGeometry", () => {
  it("keeps the stroke inside the box", () => {
    const g = ringGeometry(200, 16);
    assert.equal(g.c, 100);
    assert.equal(g.r, 92);
    assert.ok(g.c + g.r + 8 <= 200);
    assert.ok(Math.abs(g.circumference - 2 * Math.PI * 92) < 1e-9);
  });
  it("never goes negative for a stroke wider than the box", () => assert.equal(ringGeometry(10, 40).r, 0));
});

describe("dashOffset", () => {
  it("draws nothing at 0, everything at 1 and half at 0.5", () => {
    assert.equal(dashOffset(100, 0), 100);
    assert.equal(dashOffset(100, 1), 0);
    assert.equal(dashOffset(100, 0.5), 50);
  });
  it("clamps out-of-range and broken progress", () => {
    assert.equal(dashOffset(100, 2), 0);
    assert.equal(dashOffset(100, -1), 100);
    assert.equal(dashOffset(100, Number.NaN), 100);
    assert.equal(clamp01(Infinity), 0);
  });
});

describe("periodLeft", () => {
  it("is the share of the period still ahead", () => {
    assert.equal(periodLeft(15, 30), 0.5);
    assert.equal(periodLeft(30, 30), 1);
    assert.equal(periodLeft(0, 30), 0);
  });
  it("copes with a zero-length period and overshoot", () => {
    assert.equal(periodLeft(5, 0), 0);
    assert.equal(periodLeft(40, 30), 1);
  });
});

describe("heroFontSize", () => {
  it("keeps short amounts at full size and shrinks long ones", () => {
    assert.equal(heroFontSize("30"), 44);
    assert.equal(heroFontSize("4.061"), 40);
    assert.ok(heroFontSize("81.234") < heroFontSize("4.061"));
  });
  it("stays inside the bounds", () => {
    assert.equal(heroFontSize("0"), 44);
    assert.equal(heroFontSize("1.000.000.000"), 24);
    assert.equal(heroFontSize(""), 44);
  });
  it("makes the text fit the room it is given", () => {
    for (const whole of ["5", "30", "999", "1.234", "12.345", "123.456"]) {
      const em = [...whole].reduce((a, ch) => a + (/\d/.test(ch) ? 0.62 : 0.32), 0);
      assert.ok(em * heroFontSize(whole) <= 112 + 1e-9 || heroFontSize(whole) === 24, whole);
    }
  });
});

describe("count-up", () => {
  it("starts at the old value and ends exactly on the new one", () => {
    assert.equal(countUpValue(0, 3062, 0), 0);
    assert.equal(countUpValue(0, 3062, 1), 3062);
    assert.equal(countUpValue(500, 100, 1), 100);
  });
  it("eases out: more than half way at half time, never overshooting", () => {
    assert.ok(countUpValue(0, 1000, 0.5) > 500);
    for (let t = 0; t <= 1; t += 0.05) assert.ok(countUpValue(0, 1000, t) <= 1000);
    assert.equal(easeOutCubic(2), 1);
  });
});
