import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Price, RecipeMatch } from "../src/api/client";
import {
  CHAIN_TINTS,
  MEAL_TINTS,
  blend,
  chainTint,
  contrast,
  costPerServing,
  extraText,
  hashText,
  initials,
  itemSaving,
  matchTone,
  mealTint,
  percentDone,
  rankPrices,
  shortList,
  summarizePrices,
  toneColours,
} from "../src/groceryView";

const price = (chain: string, cents: number, extra: Partial<Price> = {}): Price => ({
  chain,
  item: "milch",
  item_name: "Milch",
  reference_pack: "1 l",
  product_name: "Milch",
  price_cents: cents,
  shelf_price_cents: cents,
  is_offer: false,
  source: "web",
  ...extra,
});

describe("colour maths", () => {
  it("black on white is 21:1 and white on white 1:1", () => {
    assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
    assert.equal(contrast("#ffffff", "#ffffff"), 1);
  });

  it("blend mixes by alpha", () => {
    assert.equal(blend("#000000", "#ffffff", 0.5), "#808080");
    assert.equal(blend("#ff0000", "#ffffff", 1), "#ff0000");
    assert.equal(blend("#ff0000", "#ffffff", 0), "#ffffff");
  });
});

describe("accessible colours", () => {
  it("chain and meal avatars have readable letters", () => {
    for (const t of [...Object.values(CHAIN_TINTS), ...MEAL_TINTS]) {
      assert.ok(contrast(t.bg, t.fg) >= 4.5, `${t.bg} / ${t.fg} = ${contrast(t.bg, t.fg)}`);
    }
  });

  it("status text on its tint is readable on card, tinted card and page, light and dark", () => {
    const surfaces = {
      light: ["#ffffff", "#faf5ff"],
      dark: ["#16161b", "#1e1e25", "#0a0a0d"],
    } as const;
    for (const scheme of ["light", "dark"] as const) {
      for (const surface of surfaces[scheme]) {
        const tones = toneColours(scheme, surface);
        for (const [name, t] of Object.entries(tones)) {
          assert.ok(contrast(t.fg, t.bg) >= 4.5, `${scheme} ${surface} ${name} on tint = ${contrast(t.fg, t.bg)}`);
          assert.ok(contrast(t.fg, surface) >= 4.5, `${scheme} ${surface} ${name} on surface = ${contrast(t.fg, surface)}`);
        }
      }
    }
  });
});

describe("avatars", () => {
  it("picks the same colour for the same text and a chain colour for a known chain", () => {
    assert.deepEqual(mealTint("Spaghetti"), mealTint("Spaghetti"));
    assert.equal(hashText("a"), hashText("a"));
    assert.notEqual(hashText("a"), hashText("b"));
    assert.deepEqual(chainTint("Lidl"), CHAIN_TINTS.lidl);
    assert.ok(MEAL_TINTS.includes(chainTint("netto")));
  });

  it("initials are the first letter, upper case, with a fallback", () => {
    assert.equal(initials("rewe markt"), "R");
    assert.equal(initials("  Öl "), "Ö");
    assert.equal(initials(""), "?");
  });
});

describe("price comparison", () => {
  it("sorts cheapest first and marks the cheapest with the gap of the others", () => {
    const rows = rankPrices([price("rewe", 119), price("aldi", 109), price("lidl", 115)]);
    assert.deepEqual(
      rows.map((r) => [r.price.chain, r.isCheapest, r.extraCents]),
      [
        ["aldi", true, 0],
        ["lidl", false, 6],
        ["rewe", false, 10],
      ],
    );
  });

  it("marks ties as cheapest, but nobody when only one chain has a price", () => {
    assert.deepEqual(
      rankPrices([price("aldi", 189), price("lidl", 189), price("rewe", 249)]).map((r) => r.isCheapest),
      [true, true, false],
    );
    assert.deepEqual(rankPrices([price("aldi", 100)]).map((r) => r.isCheapest), [false]);
    // two offers of the same chain do not compete
    assert.deepEqual(rankPrices([price("aldi", 100), price("aldi", 120)]).map((r) => r.isCheapest), [false, false]);
    assert.deepEqual(rankPrices([]), []);
  });

  it("the saving is dearest minus cheapest, against the dearest chain", () => {
    assert.deepEqual(itemSaving([price("aldi", 189), price("lidl", 189), price("rewe", 249)]), { cents: 60, versus: "rewe" });
    assert.deepEqual(itemSaving([price("aldi", 189), price("lidl", 189)]), { cents: 0, versus: null });
    assert.deepEqual(itemSaving([price("aldi", 189)]), { cents: 0, versus: null });
  });

  it("summarises who wins how many items and what choosing well saves", () => {
    const groups = [
      { item: "a", name: "A", pack: "1", prices: [price("aldi", 100), price("lidl", 120)] },
      { item: "b", name: "B", pack: "1", prices: [price("aldi", 200), price("rewe", 250)] },
      { item: "c", name: "C", pack: "1", prices: [price("lidl", 80), price("rewe", 90)] },
      { item: "d", name: "D", pack: "1", prices: [price("lidl", 80)] }, // single chain: not compared
    ];
    const s = summarizePrices(groups);
    assert.equal(s.compared, 3);
    assert.equal(s.savingCents, 20 + 50 + 10);
    assert.deepEqual(s.wins, [
      { chain: "aldi", count: 2 },
      { chain: "lidl", count: 1 },
    ]);
    assert.deepEqual(s.leader, { chain: "aldi", count: 2 });
    assert.deepEqual(s.top, ["aldi"]);
  });

  it("has no leader on an even split, and an empty summary without data", () => {
    const even = summarizePrices([
      { item: "a", name: "A", pack: "1", prices: [price("aldi", 100), price("lidl", 120)] },
      { item: "b", name: "B", pack: "1", prices: [price("lidl", 100), price("aldi", 120)] },
    ]);
    assert.equal(even.leader, null);
    assert.deepEqual(even.top, ["aldi", "lidl"]);
    assert.deepEqual(summarizePrices([]), { compared: 0, wins: [], leader: null, top: [], savingCents: 0 });
  });

  it("writes the gap in German notation", () => {
    assert.equal(extraText(6), "+0,06 €");
    assert.equal(extraText(0), "");
  });
});

describe("recipes", () => {
  const recipe = (over: Partial<Pick<RecipeMatch, "missing_cost_cents" | "servings" | "missing">>) => ({
    missing_cost_cents: 0,
    servings: 2,
    missing: [] as string[],
    ...over,
  });

  it("cost per serving is the missing cost over the servings, rounded", () => {
    assert.equal(costPerServing(recipe({ missing_cost_cents: 129, servings: 2, missing: ["knoblauch"] })), 65);
    assert.equal(costPerServing(recipe({ missing_cost_cents: 100, servings: 3, missing: ["x"] })), 33);
  });

  it("is null when nothing is missing or the servings are not positive", () => {
    assert.equal(costPerServing(recipe({})), null);
    assert.equal(costPerServing(recipe({ missing: ["x"], servings: 0 })), null);
  });

  it("a recipe with only unpriced missing items costs 0 per serving, not null", () => {
    assert.equal(costPerServing(recipe({ missing: ["apfelmus"], missing_cost_cents: 0 })), 0);
  });

  it("match tone has three steps", () => {
    assert.equal(matchTone(100), "high");
    assert.equal(matchTone(75), "high");
    assert.equal(matchTone(74), "mid");
    assert.equal(matchTone(40), "mid");
    assert.equal(matchTone(39), "low");
    assert.equal(matchTone(0), "low");
  });

  it("cuts a list after a few names", () => {
    assert.deepEqual(shortList(["a", "b", "c", "d"]), { shown: ["a", "b"], more: 2 });
    assert.deepEqual(shortList(["a"]), { shown: ["a"], more: 0 });
    assert.deepEqual(shortList([], 3), { shown: [], more: 0 });
  });
});

describe("progress", () => {
  it("is a whole percent and 0 for an empty list", () => {
    assert.equal(percentDone(1, 3), 33);
    assert.equal(percentDone(3, 3), 100);
    assert.equal(percentDone(0, 0), 0);
  });
});
