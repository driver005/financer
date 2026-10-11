import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api } from "../src/api/client";
import type { Transport } from "../src/api/transport";
import {
  EMPTY_DRAFT,
  describeRule,
  draftFromRule,
  draftFromSplit,
  initialSplit,
  moveId,
  ruleFromDraft,
  splitFromDraft,
  splitRemainder,
  type RuleFields,
} from "../src/rules";

describe("rule form", () => {
  it("turns a filled form into an API body with cents", () => {
    const r = ruleFromDraft({ ...EMPTY_DRAFT, pattern: "  Kiosk ", kind: "starts_with", sign: "expense", min: "5", max: "20,50", category: "dining" });
    assert.deepEqual(r, {
      rule: { pattern: "Kiosk", kind: "starts_with", sign: "expense", min_cents: 500, max_cents: 2050, category: "dining" },
    });
  });

  it("leaves empty amounts and 'any' sign out", () => {
    const r = ruleFromDraft({ ...EMPTY_DRAFT, pattern: "rewe" });
    assert.deepEqual(r, { rule: { pattern: "rewe", kind: "contains", sign: null, min_cents: null, max_cents: null, category: "groceries" } });
  });

  it("explains what is wrong", () => {
    assert.deepEqual(ruleFromDraft({ ...EMPTY_DRAFT, pattern: " 123 " }), { error: "The name needs at least one letter" });
    assert.match((ruleFromDraft({ ...EMPTY_DRAFT, pattern: "x", min: "abc" }) as { error: string }).error, /smallest/);
    assert.match((ruleFromDraft({ ...EMPTY_DRAFT, pattern: "x", max: "1,234" }) as { error: string }).error, /largest/);
    assert.match((ruleFromDraft({ ...EMPTY_DRAFT, pattern: "x", min: "10", max: "5" }) as { error: string }).error, /larger/);
  });

  it("round-trips a stored rule through the form", () => {
    const stored: RuleFields = { pattern: "kiosk", kind: "equals", sign: "income", min_cents: 150, max_cents: null, category: "other" };
    const draft = draftFromRule(stored);
    assert.deepEqual(draft, { pattern: "kiosk", kind: "equals", sign: "income", min: "1,50", max: "", category: "other" });
    assert.deepEqual(ruleFromDraft(draft), { rule: stored });
  });

  it("describes a rule in one line", () => {
    assert.equal(
      describeRule({ pattern: "kiosk", kind: "starts_with", sign: "expense", min_cents: 500, max_cents: 2000, category: "dining" }),
      'Name starts with "kiosk" · expenses · 5,00 € to 20,00 € → dining',
    );
    assert.equal(describeRule({ pattern: "rewe", kind: "contains", category: "groceries" }), 'Name contains "rewe" → groceries');
    assert.equal(describeRule({ pattern: "x", kind: "equals", max_cents: 99, category: "other" }), 'Name is exactly "x" · up to 0,99 € → other');
  });
});

describe("rule order", () => {
  it("moves one id and refuses to leave the list", () => {
    assert.deepEqual(moveId([1, 2, 3], 1, -1), [2, 1, 3]);
    assert.deepEqual(moveId([1, 2, 3], 1, 1), [1, 3, 2]);
    assert.deepEqual(moveId([1, 2, 3], 0, -1), [1, 2, 3]);
    assert.deepEqual(moveId([1, 2, 3], 2, 1), [1, 2, 3]);
    const original = [1, 2];
    moveId(original, 0, 1);
    assert.deepEqual(original, [1, 2], "does not mutate its input");
  });
});

describe("split form", () => {
  it("starts with the whole amount in the first part", () => {
    assert.deepEqual(initialSplit(-5000, "groceries"), [
      { amount: "50,00", category: "groceries", note: "" },
      { amount: "", category: "other", note: "" },
    ]);
  });

  it("tracks what is left to assign", () => {
    const parts = [
      { amount: "30", category: "groceries", note: "" },
      { amount: "", category: "shopping", note: "" },
    ];
    assert.equal(splitRemainder(-5000, parts), 2000);
    parts[1].amount = "20,01";
    assert.equal(splitRemainder(-5000, parts), -1);
    assert.equal(splitRemainder(5000, parts), -1, "income splits use the absolute amount");
  });

  it("builds signed cents only when the parts add up exactly", () => {
    const ok = splitFromDraft(-5000, [
      { amount: "30", category: "groceries", note: " food " },
      { amount: "20,00", category: "shopping", note: "" },
    ]);
    assert.deepEqual(ok, {
      parts: [
        { amount_cents: -3000, category: "groceries", note: "food" },
        { amount_cents: -2000, category: "shopping", note: null },
      ],
    });
    const income = splitFromDraft(10000, [
      { amount: "70", category: "income", note: "" },
      { amount: "30", category: "other", note: "" },
    ]);
    assert.ok("parts" in income && income.parts[0].amount_cents === 7000);
  });

  it("says why a split is not valid", () => {
    const part = (amount: string) => ({ amount, category: "other", note: "" });
    assert.deepEqual(splitFromDraft(-5000, [part("30"), part("19,99")]), { error: "0,01 € still to assign" });
    assert.deepEqual(splitFromDraft(-5000, [part("30"), part("20,50")]), { error: "0,50 € too much" });
    assert.match((splitFromDraft(-5000, [part("50"), part("")]) as { error: string }).error, /Part 2/);
    assert.match((splitFromDraft(-5000, [part("50"), part("0")]) as { error: string }).error, /Part 2/);
    assert.match((splitFromDraft(-5000, [part("50")]) as { error: string }).error, /at least two/);
    assert.match((splitFromDraft(0, [part("1"), part("1")]) as { error: string }).error, /0 €/);
  });

  it("loads stored parts back into the form", () => {
    assert.deepEqual(draftFromSplit([{ amount_cents: -3050, category: "groceries", note: null }, { amount_cents: -1950, category: "other", note: "x" }]), [
      { amount: "30,50", category: "groceries", note: "" },
      { amount: "19,50", category: "other", note: "x" },
    ]);
  });
});

describe("categorization API calls", () => {
  function api() {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const transport: Transport = {
      async send(req) {
        calls.push({ method: req.method, path: req.path, body: typeof req.body === "string" ? JSON.parse(req.body) : undefined });
        return { status: req.method === "DELETE" ? 204 : 200, text: req.method === "DELETE" ? "" : "{}" };
      },
    };
    return { client: new Api(transport), calls };
  }

  it("uses the documented routes and bodies", async () => {
    const { client, calls } = api();
    await client.rules();
    await client.createRule({ pattern: "a", kind: "contains", category: "dining" });
    await client.updateRule(7, { pattern: "a", kind: "equals", category: "dining" });
    await client.deleteRule(7);
    await client.reorderRules([3, 1]);
    await client.applyRules();
    await client.setCategory(9, "dining", true);
    await client.splits();
    await client.putSplit(9, { parts: [{ amount_cents: -1, category: "a" }] });
    await client.deleteSplit(9);
    await client.suggestCategories();
    await client.acceptSuggestions([{ merchant: "kiosk", category: "dining" }]);
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.path}`),
      [
        "GET /v1/rules",
        "POST /v1/rules",
        "PUT /v1/rules/7",
        "DELETE /v1/rules/7",
        "POST /v1/rules/reorder",
        "POST /v1/rules/apply",
        "PUT /v1/transactions/9/category",
        "GET /v1/transactions/splits",
        "PUT /v1/transactions/9/split",
        "DELETE /v1/transactions/9/split",
        "POST /v1/transactions/categorize-unknown",
        "POST /v1/transactions/categorize-unknown/accept",
      ],
    );
    assert.deepEqual(calls[4].body, { ids: [3, 1] });
    assert.deepEqual(calls[6].body, { category: "dining", remember: true });
    assert.deepEqual(calls[11].body, { suggestions: [{ merchant: "kiosk", category: "dining" }] });
  });
});
