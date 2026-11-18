import test from "node:test";
import assert from "node:assert/strict";

import { monthKey, weekKey, periodKey, periodLabel, shiftPeriod } from "../src/lib/period";
import { formatEuro, parseEuro, scaleAmount } from "../src/lib/money";
import { parseTransactionCsv } from "../src/lib/csv";
import { matchStore, parseOffers, storeSummary, SUPERMARKETS } from "../src/lib/stores";
import { normalizeMeal } from "../src/lib/provider";

test("period keys and navigation", () => {
  const d = new Date(2026, 10, 17);
  assert.equal(monthKey(d), "2026-11");
  assert.match(weekKey(d), /^2026-W\d{2}$/);
  assert.equal(periodKey("month", d), "2026-11");
  assert.equal(shiftPeriod("month", "2026-01", -1), "2025-12");
  assert.equal(periodLabel("month", "2026-11").includes("November"), true);
});

test("euro parsing and scaling", () => {
  assert.equal(parseEuro("5,50"), 550);
  assert.equal(parseEuro("12.5"), 1250);
  assert.equal(parseEuro("abc"), null);
  assert.match(formatEuro(1250), /12[.,]50/);
  assert.equal(scaleAmount("200 g", 4, 2), "400 g");
  assert.equal(scaleAmount("1,5 cups", 1, 2), "0,8 cups");
});

test("transaction CSV import", () => {
  const csv = "date;merchant;amount;category\n2026-11-02;REWE Markt;12,40;groceries\n2026-11-03;Lidl;8.99\n";
  const { rows, errors } = parseTransactionCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amountCents, 1240);
  assert.equal(rows[0].category, "groceries");
  assert.equal(rows[1].amountCents, 899);
  assert.equal(errors.length, 0);
});

test("supermarket alias matching for all six chains", () => {
  for (const store of SUPERMARKETS) {
    const merchant = store.aliases.split(",")[0].trim();
    assert.equal(matchStore(merchant, SUPERMARKETS), store.id, `should match ${merchant}`);
  }
  assert.equal(matchStore("Unknown Shop", SUPERMARKETS), null);
});

test("Angebote parsing and store summary", () => {
  const offers = parseOffers("Milch 1,29 €\n- Joghurt 0,99\nnot a price", "lidl");
  assert.equal(offers.length, 2);
  assert.equal(offers[0].product, "Milch");
  assert.equal(offers[0].price, "1,29 €");
  const rows = [
    { date: "2026-11-02", amountCents: 1240, storeId: "rewe" },
    { date: "2026-11-04", amountCents: 860, storeId: "rewe" },
    { date: "2025-10-01", amountCents: 999, storeId: "rewe" },
  ];
  const summary = storeSummary(rows, "rewe", "2026-11");
  assert.deepEqual(summary, { visits: 2, total: 2100, average: 1050 });
});

test("recipe provider normalises a meal", () => {
  const meal = {
    idMeal: "1",
    strMeal: "Test Stew",
    strCategory: "Beef",
    strArea: "German",
    strInstructions: "Chop.\nSimmer.",
    strMealThumb: "http://example/x.jpg",
    strIngredient1: "Beef",
    strMeasure1: "200 g",
    strIngredient2: "Onion",
    strMeasure2: "1",
  };
  const recipe = normalizeMeal(meal as never);
  assert.equal(recipe.title, "Test Stew");
  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.steps.length, 2);
  assert.equal(recipe.ingredients[0].amount, "200 g");
});
