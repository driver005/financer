import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countUpValue, easeOutCubic } from "../src/ring";

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
