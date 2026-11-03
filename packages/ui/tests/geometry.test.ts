import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { areaPath, barRects, clamp01, dashOffset, donutArcs, linePath, ringGeometry, sparkPoints } from "../src/finance/geometry";

describe("sparkPoints", () => {
  it("scales from 0 to the maximum inside the padding", () => {
    const pts = sparkPoints([0, 50, 100], 100, 40, 2);
    assert.deepEqual(pts[0], { x: 2, y: 38 });
    assert.deepEqual(pts[2], { x: 98, y: 2 });
    assert.equal(pts[1].y, 20);
  });
  it("handles empty, single and all-zero input", () => {
    assert.deepEqual(sparkPoints([], 100, 40, 2), []);
    assert.equal(sparkPoints([5], 100, 40, 2)[0].x, 50);
    assert.ok(sparkPoints([0, 0], 100, 40, 2).every((p) => p.y === 38));
  });
  it("draws a line and a closed area", () => {
    const pts = sparkPoints([1, 2], 10, 10, 0);
    assert.equal(linePath(pts), "M0.0 5.0 L10.0 0.0");
    assert.ok(areaPath(pts, 10, 0).endsWith("Z"));
    assert.equal(linePath([]), "");
    assert.equal(areaPath([], 10, 0), "");
  });
});

describe("barRects", () => {
  it("fills the width and keeps tiny values visible", () => {
    const bars = barRects([100, 1, 0], 100, 50, 5, 2);
    assert.equal(bars.length, 3);
    assert.ok(Math.abs(bars[2].x + bars[2].width - 100) < 1e-9);
    assert.equal(bars[0].height, 50);
    assert.equal(bars[1].height, 2);
    assert.equal(bars[2].height, 0);
  });
  it("can share a scale and copes with no values", () => {
    assert.equal(barRects([50], 10, 100, 0, 2, 100)[0].height, 50);
    assert.deepEqual(barRects([], 10, 10, 0, 2), []);
  });
});

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

describe("donutArcs", () => {
  it("starts every share where the one before ended", () => {
    const r = 50;
    const circ = 2 * Math.PI * r;
    const arcs = donutArcs([0.5, 0.25, 0.25], r, 0);
    assert.equal(arcs[0].offset, 0);
    assert.ok(Math.abs(arcs[1].offset + 0.5 * circ) < 1e-9);
    assert.ok(Math.abs(arcs[2].offset + 0.75 * circ) < 1e-9);
  });
  it("leaves a gap between neighbours but none for a single share", () => {
    const r = 50;
    const circ = 2 * Math.PI * r;
    const [a] = donutArcs([0.5, 0.5], r, 4);
    assert.equal(a.dash, `${(0.5 * circ - 4).toFixed(2)} ${(circ - (0.5 * circ - 4)).toFixed(2)}`);
    assert.equal(donutArcs([1], r, 4)[0].dash.split(" ")[0], circ.toFixed(2));
  });
});
