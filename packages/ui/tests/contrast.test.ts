import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { darkColors, lightColors, tones, type ThemeColors } from "../src/constants/colors";
import { contrast } from "../src/responsive/contrast";

const TEXT = 4.5; // WCAG 2.2 AA, normal text
const PARTS = 3; // WCAG 2.2 AA, parts of the interface (borders of inputs, focus)

function check(name: string, colors: ThemeColors) {
  describe(`contrast in the ${name} theme`, () => {
    const surfaces = { background: colors.background, surface: colors.surface, raised: colors.raised, sunken: colors.sunken };

    it("reads default and muted text on every surface", () => {
      for (const [s, bg] of Object.entries(surfaces)) {
        for (const role of ["default", "muted"] as const) {
          const ratio = contrast(colors.text[role], bg);
          assert.ok(ratio >= TEXT, `${role} text on ${s} is ${ratio.toFixed(2)}:1`);
        }
      }
    });

    it("reads subtle text (captions, hints) on the surfaces it is used on, never on a recessed fill", () => {
      // inputs and meter tracks are recessed; their text is `muted`, not `subtle`
      for (const bg of [colors.background, colors.surface, colors.raised]) {
        const ratio = contrast(colors.text.subtle, bg);
        assert.ok(ratio >= TEXT, `subtle text is ${ratio.toFixed(2)}:1`);
      }
    });

    it("reads every tone's text on the plain surfaces", () => {
      for (const t of tones) {
        for (const bg of [colors.background, colors.surface]) {
          const ratio = contrast(colors.tones[t].text, bg);
          assert.ok(ratio >= TEXT, `${t} text is ${ratio.toFixed(2)}:1`);
        }
      }
    });

    it("reads the text on solid and soft fills of every tone", () => {
      for (const t of tones) {
        const c = colors.tones[t];
        assert.ok(contrast(c.onSolid, c.solid) >= TEXT, `${t}: on solid ${contrast(c.onSolid, c.solid).toFixed(2)}`);
        assert.ok(contrast(c.onSoft, c.soft) >= TEXT, `${t}: on soft ${contrast(c.onSoft, c.soft).toFixed(2)}`);
      }
    });

    it("makes borders of controls and the focus ring visible", () => {
      assert.ok(contrast(colors.border.strong, colors.surface) >= 1.3, "strong border is at least faintly visible");
      assert.ok(contrast(colors.border.focus, colors.surface) >= PARTS, "focus ring");
      assert.ok(contrast(colors.border.focus, colors.background) >= PARTS, "focus ring on the background");
    });

    it("tells a solid control from the surface it sits on (its face or its thick edge reaches 3:1)", () => {
      for (const t of tones) {
        const c = colors.tones[t];
        const best = Math.max(contrast(c.solid, colors.surface), contrast(c.edge, colors.surface));
        assert.ok(best >= PARTS, `${t} solid control on surface is ${best.toFixed(2)}:1`);
      }
    });
  });
}

check("light", lightColors);
check("dark", darkColors);

describe("the contrast helper", () => {
  it("knows black on white and a colour on itself", () => {
    assert.ok(Math.abs(contrast("#000000", "#ffffff") - 21) < 0.01);
    assert.equal(contrast("#7f56d9", "#7f56d9"), 1);
  });
});
