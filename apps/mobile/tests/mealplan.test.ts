import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api, type MealShoppingList } from "../src/api/client";
import type { Transport } from "../src/api/transport";
import {
  addDays,
  budgetVerdict,
  chainTotalText,
  clampServings,
  entryFromIdea,
  entryFromRecipe,
  itemDetail,
  parseTicks,
  planFromDays,
  planHeadline,
  planToInput,
  pruneTicks,
  serializeTicks,
  setDay,
  shiftWeek,
  shortDate,
  tickIds,
  tickProgress,
  toggleTick,
  unmatchedText,
  weekDays,
  weekLabel,
  weekRelation,
  weekStart,
  weekdayName,
} from "../src/mealplan";

describe("week math", () => {
  it("names a week by its Monday", () => {
    // 2026-10-12 is a Monday
    for (const d of ["2026-10-12", "2026-10-14", "2026-10-18"]) assert.equal(weekStart(d), "2026-10-12", d);
    assert.equal(weekStart("2026-10-19"), "2026-10-19");
    assert.equal(weekStart("2026-10-11"), "2026-10-05");
  });

  it("crosses month, year and leap day", () => {
    assert.equal(weekStart("2027-01-01"), "2026-12-28");
    assert.equal(weekStart("2028-03-01"), "2028-02-28");
    assert.equal(addDays("2028-02-28", 2), "2028-03-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });

  it("lists seven days Monday first and shifts by whole weeks", () => {
    assert.deepEqual(weekDays("2026-10-26"), [
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
    assert.equal(shiftWeek("2026-10-12", 1), "2026-10-19");
    assert.equal(shiftWeek("2026-10-12", -2), "2026-09-28");
    assert.equal(shiftWeek("2026-12-28", 1), "2027-01-04");
  });

  it("the daylight saving switch does not move a week", () => {
    // Europe switches on 2026-10-25; UTC maths keeps every day a day
    assert.deepEqual(weekDays("2026-10-19").slice(5), ["2026-10-24", "2026-10-25"]);
    assert.equal(weekStart("2026-10-26"), "2026-10-26");
  });

  it("labels days and weeks", () => {
    assert.equal(weekdayName("2026-10-12"), "Mon");
    assert.equal(weekdayName("2026-10-18"), "Sun");
    assert.equal(shortDate("2026-10-05"), "05.10.");
    assert.equal(weekLabel("2026-10-12"), "12.10. – 18.10.2026");
    assert.equal(weekLabel("2026-12-28"), "28.12.2026 – 03.01.2027");
  });

  it("tells this, next and last week apart", () => {
    assert.equal(weekRelation("2026-10-12", "2026-10-15"), "this");
    assert.equal(weekRelation("2026-10-19", "2026-10-15"), "next");
    assert.equal(weekRelation("2026-10-05", "2026-10-15"), "last");
    assert.equal(weekRelation("2026-11-02", "2026-10-15"), "other");
  });
});

const RECIPE = {
  id: "pfannkuchen",
  title: "Pfannkuchen",
  servings: 3,
  ingredients: [{ item: "mehl", name: "Weizenmehl", amount: "250 g" }],
};

describe("plan entries", () => {
  it("clamps servings to what the server accepts", () => {
    assert.equal(clampServings(0), 1);
    assert.equal(clampServings(-3), 1);
    assert.equal(clampServings(2.6), 3);
    assert.equal(clampServings(99), 20);
    assert.equal(clampServings(Number.NaN), 1);
  });

  it("builds entries from a recipe and from an idea", () => {
    const r = entryFromRecipe(RECIPE);
    assert.deepEqual(r, {
      recipe_id: "pfannkuchen",
      title: "Pfannkuchen",
      servings: 3,
      recipe_servings: 3,
      ingredients: [{ name: "Weizenmehl", amount: "250 g" }],
    });
    assert.equal(entryFromRecipe(RECIPE, 50).servings, 20);

    const idea = entryFromIdea({
      title: "  Nudelpfanne ",
      summary: "schnell",
      minutes: 20,
      servings: 2,
      ingredients: [{ name: "Nudeln", amount: "250 g" }],
      steps: ["kochen"],
    });
    assert.equal(idea.recipe_id, null);
    assert.equal(idea.title, "Nudelpfanne");
    assert.deepEqual([idea.servings, idea.recipe_servings], [2, 2]);
    assert.equal(entryFromIdea({ title: "X", summary: "", minutes: 1, servings: 2, ingredients: [], steps: [] }, 6).recipe_servings, 2);
  });

  it("sets and clears days without touching the original", () => {
    const a = setDay({}, "2026-10-13", entryFromRecipe(RECIPE));
    const b = setDay(a, "2026-10-14", entryFromRecipe(RECIPE, 1));
    assert.deepEqual(Object.keys(a), ["2026-10-13"]);
    assert.deepEqual(Object.keys(b), ["2026-10-13", "2026-10-14"]);
    const c = setDay(b, "2026-10-13", null);
    assert.deepEqual(Object.keys(c), ["2026-10-14"]);
    assert.deepEqual(Object.keys(b), ["2026-10-13", "2026-10-14"]);
  });

  it("makes the save request: planned days of that week only, in order, recipes by id", () => {
    const idea = entryFromIdea({ title: "Idee", summary: "", minutes: 5, servings: 2, ingredients: [{ name: "Reis", amount: "200 g" }], steps: ["x"] }, 4);
    let plan = setDay({}, "2026-10-18", idea);
    plan = setDay(plan, "2026-10-12", entryFromRecipe(RECIPE, 5));
    plan = setDay(plan, "2026-10-25", entryFromRecipe(RECIPE)); // another week: left out
    assert.deepEqual(planToInput(plan, "2026-10-12"), [
      { date: "2026-10-12", recipe_id: "pfannkuchen", servings: 5 },
      {
        date: "2026-10-18",
        title: "Idee",
        servings: 4,
        recipe_servings: 2,
        ingredients: [{ name: "Reis", amount: "200 g" }],
      },
    ]);
    assert.deepEqual(planToInput({}, "2026-10-12"), []);
  });

  it("round-trips what the server returns", () => {
    const plan = planFromDays([
      { date: "2026-10-12", recipe_id: "pfannkuchen", title: "Pfannkuchen", servings: 3, recipe_servings: 3, available: true, ingredients: [{ name: "Weizenmehl", amount: "250 g" }] },
      { date: "2026-10-13", recipe_id: null, title: "Reste", servings: 1, recipe_servings: 2, available: true, ingredients: [] },
    ]);
    assert.equal(plan["2026-10-13"].recipe_id, null);
    const input = planToInput(plan, "2026-10-12");
    assert.equal(input.length, 2);
    assert.deepEqual(input[0], { date: "2026-10-12", recipe_id: "pfannkuchen", servings: 3 });
  });
});

function list(over: Partial<MealShoppingList> = {}): MealShoppingList {
  const item = (key: string, name: string, extra = {}) => ({
    item: key, name, needed: "500 g", packs: 1, pack: "500 g", meals: ["A"], pack_price_cents: null, line_cents: null, is_offer: false, ...extra,
  });
  return {
    week_start: "2026-10-12",
    week_end: "2026-10-18",
    meals_planned: 2,
    skipped_meals: [],
    plan: {
      split: true,
      saving_cents: 90,
      single_chain_total_cents: 466,
      total_cents: 376,
      stops: [
        { chain: "aldi", subtotal_cents: 198, items: [item("milch", "Milch", { packs: 2, pack_price_cents: 99, line_cents: 198 })] },
        { chain: "lidl", subtotal_cents: 178, items: [item("brot", "Brot"), item("nudeln", "Nudeln")] },
      ],
    },
    per_chain: [],
    unpriced: [item("lachs", "Lachs")],
    unmatched: [{ name: "Safran", amounts: ["1 Prise", "2 Fäden"], meals: ["A"] }],
    pantry_skipped: [],
    budget: { budget_source: "none", estimated_cents: 376, unpriced_count: 0 },
    ...over,
  };
}

describe("ticking items off", () => {
  it("lists every tickable thing once", () => {
    assert.deepEqual(tickIds(list()), ["item:milch", "item:brot", "item:nudeln", "item:lachs", "name:safran"]);
    // an item that appears twice (two stops) is counted once
    const l = list();
    l.plan!.stops[1].items.push(l.plan!.stops[0].items[0]);
    assert.equal(tickIds(l).filter((t) => t === "item:milch").length, 1);
    assert.deepEqual(tickIds(list({ plan: null, unpriced: [], unmatched: [] })), []);
  });

  it("toggles and counts progress", () => {
    let ticks: string[] = [];
    ticks = toggleTick(ticks, "item:milch");
    ticks = toggleTick(ticks, "name:safran");
    assert.deepEqual(tickProgress(list(), ticks), { done: 2, total: 5 });
    ticks = toggleTick(ticks, "item:milch");
    assert.deepEqual(ticks, ["name:safran"]);
    assert.deepEqual(tickProgress(list(), []), { done: 0, total: 5 });
  });

  it("forgets ticks of things that left the list", () => {
    const l = list({ unmatched: [] });
    assert.deepEqual(pruneTicks(["item:milch", "name:safran", "item:gone"], l), ["item:milch"]);
    assert.deepEqual(tickProgress(l, ["name:safran"]), { done: 0, total: 4 });
  });

  it("stores ticks as JSON and survives garbage", () => {
    assert.equal(serializeTicks(["a", "b", "a"]), '["a","b"]');
    assert.deepEqual(parseTicks('["a","b"]'), ["a", "b"]);
    for (const bad of [null, undefined, "", "{", "{}", "null", "5"]) assert.deepEqual(parseTicks(bad), [], String(bad));
    assert.deepEqual(parseTicks('["a",3,null,"b"]'), ["a", "b"]);
  });
});

describe("wording", () => {
  const budget = (over: Partial<MealShoppingList["budget"]>): MealShoppingList["budget"] => ({
    budget_source: "groceries_envelope",
    budget_cents: 18_000,
    estimated_cents: 4_000,
    left_after_cents: 14_000,
    fits: true,
    unpriced_count: 0,
    ...over,
  });

  it("says when the list fits the budget", () => {
    const v = budgetVerdict(budget({}));
    assert.equal(v.tone, "good");
    assert.equal(v.title, "Fits your groceries budget");
    assert.match(v.detail, /About 40,00 € for the week\. 140,00 € of 180,00 € stays left\./);
  });

  it("says by how much it is over", () => {
    const v = budgetVerdict(budget({ budget_cents: 3_000, left_after_cents: -1_000, fits: false }));
    assert.equal(v.tone, "bad");
    assert.equal(v.title, "10,00 € over your groceries budget");
    assert.match(v.detail, /Only 30,00 € is left/);
    // an overspent envelope never shows a negative amount as "left"
    const broke = budgetVerdict(budget({ budget_cents: -500, left_after_cents: -4_500, fits: false }));
    assert.equal(broke.title, "45,00 € over your groceries budget");
    assert.match(broke.detail, /Only 0,00 € is left/);
  });

  it("still gives the cost without a limit, and flags unpriced items", () => {
    const none = budgetVerdict({ budget_source: "none", estimated_cents: 1_250, unpriced_count: 0 });
    assert.equal(none.tone, "neutral");
    assert.equal(none.title, "About 12,50 € for the week.");
    assert.match(none.detail, /Set a groceries limit/);

    const some = budgetVerdict(budget({ unpriced_count: 1 }));
    assert.match(some.detail, /1 item has no price and is not counted/);
    const more = budgetVerdict(budget({ unpriced_count: 3 }));
    assert.match(more.detail, /3 items have no price and are not counted/);

    const nothing = budgetVerdict({ budget_source: "none", estimated_cents: 0, unpriced_count: 4 });
    assert.equal(nothing.title, "No prices for this list yet");
  });

  it("describes the best plan, the shops and the items", () => {
    const l = list();
    assert.equal(planHeadline(l.plan!), "Best split over 2 shops: 3,76 €, 0,90 € cheaper than one shop");
    const single = { ...l.plan!, split: false, saving_cents: 0, stops: [l.plan!.stops[0]] };
    assert.equal(planHeadline(single), "Cheapest at Aldi: 3,76 €");
    assert.equal(chainTotalText({ chain: "rewe", total_cents: 1230, missing: ["Nudeln"], complete: false }), "Rewe 12,30 € (lacks 1)");
    assert.equal(chainTotalText({ chain: "lidl", total_cents: 99, missing: [], complete: true }), "Lidl 0,99 €");
    assert.equal(itemDetail({ packs: 2, pack: "500 g", needed: "1 kg" }), "2 × 500 g, need 1 kg");
    assert.equal(unmatchedText(l.unmatched[0]), "Safran: 1 Prise, 2 Fäden");
    assert.equal(unmatchedText({ name: "Salz", amounts: [], meals: [] }), "Salz");
  });
});

describe("Api meal plan calls", () => {
  it("asks for the right paths and sends the plan as JSON", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const transport: Transport = {
      async send(req) {
        calls.push({ method: req.method, path: req.path, body: typeof req.body === "string" ? JSON.parse(req.body) : undefined });
        return { status: 200, text: "{}" };
      },
    };
    const api = new Api(transport);
    await api.mealPlan("2026-10-12");
    await api.saveMealPlan("2026-10-12", [{ date: "2026-10-12", recipe_id: "pfannkuchen", servings: 2 }]);
    await api.mealShoppingList("2026-10-12");
    await api.mealShoppingList("2026-10-12", "2026-10-14");
    await api.pantry();
    await api.savePantry(["salz", "oel"]);
    assert.deepEqual(calls, [
      { method: "GET", path: "/v1/meal-plan?week=2026-10-12", body: undefined },
      { method: "PUT", path: "/v1/meal-plan?week=2026-10-12", body: { days: [{ date: "2026-10-12", recipe_id: "pfannkuchen", servings: 2 }] } },
      { method: "GET", path: "/v1/meal-plan/shopping-list?week=2026-10-12", body: undefined },
      { method: "GET", path: "/v1/meal-plan/shopping-list?week=2026-10-12&date=2026-10-14", body: undefined },
      { method: "GET", path: "/v1/meal-plan/pantry", body: undefined },
      { method: "PUT", path: "/v1/meal-plan/pantry", body: { items: ["salz", "oel"] } },
    ]);
  });
});
