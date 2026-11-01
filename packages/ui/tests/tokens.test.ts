import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { breakpointFor, breakpoints, gridColumns, layoutClassFor } from "../src/constants/breakpoints";
import { tones, lightColors, darkColors } from "../src/constants/colors";
import { palette } from "../src/constants/palette";
import { radius } from "../src/constants/radius";
import { size } from "../src/constants/sizes";
import { space, spacing } from "../src/constants/spacing";
import { fontSize, lineHeight, textVariants } from "../src/constants/typography";
import { resolve } from "../src/responsive/resolve";

describe("spacing", () => {
  it("is Tailwind's scale on a grid of 4", () => {
    // every step of the scale from 1 up is a multiple of 4 except the half steps, which are 2 and 6 and 10 and 14
    for (const [key, value] of Object.entries(spacing)) {
      if (key === "px" || key === "0") continue;
      assert.equal(value, Number(key) * 4, `spacing ${key}`);
    }
    assert.equal(spacing.px, 1);
  });

  it("names steps that only point into the scale", () => {
    const values = new Set(Object.values(spacing));
    for (const [name, v] of Object.entries(space)) assert.ok(values.has(v), `${name} = ${v} is not a Tailwind step`);
    const ordered = Object.values(space);
    assert.deepEqual([...ordered].sort((a, b) => a - b), ordered, "named steps grow");
  });

  it("makes every size from the scale", () => {
    const values = new Set<number>(Object.values(spacing));
    const walk = (o: object, path: string) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "number") {
          if (path === "size.content" || (path === "size.sheet" && k === "maxWidth")) continue; // max widths are Tailwind screens, not spacing
          assert.ok(values.has(v), `${path}.${k} = ${v}`);
        } else walk(v as object, `${path}.${k}`);
      }
    };
    walk(size, "size");
  });

  it("keeps the touch target at 44 and the comfortable one at 48", () => {
    assert.equal(size.touch, 44);
    assert.equal(size.touchComfortable, 48);
    assert.ok(size.control.md >= size.touch && size.control.lg >= size.touchComfortable);
  });
});

describe("type and corners", () => {
  it("copies Tailwind's sizes and line heights", () => {
    assert.deepEqual([fontSize.sm, fontSize.base, fontSize.xl, fontSize["3xl"]], [14, 16, 20, 30]);
    assert.deepEqual([lineHeight.sm, lineHeight.base, lineHeight.xl], [20, 24, 28]);
    assert.equal(radius.lg, 8);
    assert.equal(radius.xl, 12);
  });

  it("builds every text variant from existing tokens and never sets text smaller than 12", () => {
    for (const [name, v] of Object.entries(textVariants)) {
      assert.ok(fontSize[v.size] >= 12, name);
      assert.ok(lineHeight[v.size] >= fontSize[v.size], `${name}: line height must not be tighter than the size`);
    }
  });
});

describe("breakpoints and layout classes", () => {
  it("are Tailwind's screens", () => {
    assert.deepEqual(breakpoints, { base: 0, sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 });
  });

  it("map widths to a breakpoint and to phone, tablet or desktop", () => {
    assert.equal(breakpointFor(320), "base");
    assert.equal(breakpointFor(640), "sm");
    assert.equal(breakpointFor(767), "sm");
    assert.equal(breakpointFor(1600), "2xl");
    assert.deepEqual([375, 430, 767, 768, 1023, 1024, 1920].map(layoutClassFor), ["compact", "compact", "compact", "medium", "medium", "expanded", "expanded"]);
  });

  it("show two product columns on a phone and more on larger screens", () => {
    assert.equal(gridColumns.base, 2);
    assert.ok(gridColumns.md > gridColumns.base && gridColumns["2xl"] >= gridColumns.xl);
  });
});

describe("responsive values", () => {
  it("pass plain values through", () => {
    assert.equal(resolve("md", 300), "md");
    assert.equal(resolve(4, 3000), 4);
  });

  it("cascade upward like min-width queries", () => {
    const v = { base: 1, md: 3, xl: 5 };
    assert.deepEqual([320, 700, 768, 1000, 1280, 2000].map((w) => resolve(v, w)), [1, 1, 3, 3, 5, 5]);
  });

  it("skip breakpoints that were not given and handle a missing base", () => {
    assert.equal(resolve({ md: "a" }, 400), undefined);
    assert.equal(resolve({ lg: "x" }, 1100), "x");
  });
});

describe("palette", () => {
  it("is HeroUI's: its eclipse and snow, its green and amber faces", () => {
    assert.equal(palette.eclipse, "#18181b");
    assert.equal(palette.snow, "#fcfcfc");
    assert.equal(palette.hero.light.success.face, "#17c964");
    assert.equal(palette.hero.light.warning.face, "#f5a524");
    assert.equal(palette.hero.dark.background, "#060607");
  });

  it("has a role for every tone in both themes", () => {
    for (const t of tones) {
      for (const c of [lightColors, darkColors]) {
        const tc = c.tones[t];
        for (const key of ["solid", "onSolid", "soft", "onSoft", "text", "line"] as const) assert.match(tc[key], /^#[0-9a-f]{6}$/, `${t}.${key}`);
      }
    }
  });
});
