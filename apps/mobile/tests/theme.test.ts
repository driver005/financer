import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AA_LARGE, AA_TEXT, MIN_TOUCH, blend, contrast, luminance, parseHex } from "../src/a11y";
import { palette, type Palette } from "../src/colors";
import { motion, radius, space, tabular, typography } from "../src/tokens";

describe("contrast helpers", () => {
  it("matches the WCAG reference values", () => {
    assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
    assert.equal(contrast("#ffffff", "#ffffff").toFixed(2), "1.00");
    // order does not matter
    assert.equal(contrast("#777777", "#ffffff").toFixed(2), contrast("#ffffff", "#777777").toFixed(2));
    // #767676 is the well-known lightest grey that still passes AA on white
    assert.ok(contrast("#767676", "#ffffff") >= AA_TEXT);
    assert.ok(contrast("#777777", "#ffffff") < AA_TEXT);
  });
  it("parses short and long hex and rejects junk", () => {
    assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
    assert.deepEqual(parseHex("#7c3aed"), [124, 58, 237]);
    assert.throws(() => parseHex("purple"));
    assert.ok(luminance("#000000") < luminance("#ffffff"));
  });
  it("blends a translucent colour over a background", () => {
    assert.equal(blend("#000000", "#ffffff", 0.5), "#808080");
    assert.equal(blend("#ff0000", "#ffffff", 1), "#ff0000");
  });
});

const TEXT_ROLES = ["text", "muted", "accent", "good", "bad", "warn", "blue", "goldText"] as const;
const SURFACES = ["background", "surface", "surfaceAlt"] as const;
const SOFT: [keyof Palette, keyof Palette][] = [
  ["accent", "accentSoft"],
  ["good", "goodSoft"],
  ["bad", "badSoft"],
  ["warn", "warnSoft"],
  ["blue", "blueSoft"],
  ["goldText", "goldSoft"],
  ["text", "accentSoft"],
  ["muted", "accentSoft"],
];
const BUTTONS: [keyof Palette, keyof Palette][] = [
  ["onAccent", "accent"],
  ["onBlue", "blue"],
  ["onBad", "bad"],
];

for (const scheme of ["light", "dark"] as const) {
  const p = palette[scheme];
  describe(`${scheme} palette contrast`, () => {
    it("text colours reach 4.5:1 on every surface", () => {
      for (const role of TEXT_ROLES) {
        for (const surface of SURFACES) {
          const ratio = contrast(p[role], p[surface]);
          assert.ok(ratio >= AA_TEXT, `${role} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    });
    it("coloured text reaches 4.5:1 on its own soft tint", () => {
      for (const [fg, bg] of SOFT) {
        const ratio = contrast(p[fg], p[bg]);
        assert.ok(ratio >= AA_TEXT, `${fg} on ${bg}: ${ratio.toFixed(2)}`);
      }
    });
    it("button labels reach 4.5:1 on the button face", () => {
      for (const [fg, bg] of BUTTONS) {
        const ratio = contrast(p[fg], p[bg]);
        assert.ok(ratio >= AA_TEXT, `${fg} on ${bg}: ${ratio.toFixed(2)}`);
      }
    });
    it("progress fills are visible (3:1) against the surface they sit on", () => {
      assert.ok(contrast(p.fill, p.surface) >= AA_LARGE, `fill on surface: ${contrast(p.fill, p.surface).toFixed(2)}`);
    });
    it("only holds valid hex colours", () => {
      for (const [name, value] of Object.entries(p)) assert.doesNotThrow(() => parseHex(value), name);
    });
  });
}

describe("tokens", () => {
  it("spacing is on the 4pt grid", () => {
    for (const [name, v] of Object.entries(space)) assert.equal(v % 4, 0, name);
  });
  it("radii grow", () => {
    assert.ok(radius.sm < radius.md && radius.md < radius.lg && radius.lg < radius.xl && radius.xl < radius.pill);
  });
  it("type scale has no text under 12 and line height above font size", () => {
    for (const [name, t] of Object.entries(typography)) {
      assert.ok(t.fontSize >= 12, name);
      assert.ok(t.lineHeight > t.fontSize, name);
    }
  });
  it("amounts use tabular numerals", () => assert.deepEqual(tabular.fontVariant, ["tabular-nums"]));
  it("motion is restrained", () => {
    for (const ms of Object.values(motion)) assert.ok(ms <= 1000);
    assert.equal(MIN_TOUCH, 44);
  });
});
