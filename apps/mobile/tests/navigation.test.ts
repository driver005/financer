import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { BARE_SCREENS, SWITCHES, TABS, switchFor, tabFor } from "../src/navigation";

/** Every route file of the app, as the path it is served at (`index` is `/`). */
function routes(): string[] {
  return readdirSync("src/app")
    .filter((f) => /\.tsx$/.test(f) && !f.startsWith("_") && !f.startsWith("+"))
    .map((f) => (f === "index.tsx" ? "/" : `/${f.replace(/\.tsx$/, "")}`));
}

describe("tabs", () => {
  it("has at most four tabs", () => assert.ok(TABS.length <= 4));
  it("gives every screen a home tab, or marks it bare", () => {
    const owned = new Set(TABS.flatMap((t) => t.screens));
    for (const r of routes()) assert.ok(owned.has(r) || BARE_SCREENS.includes(r), `${r} belongs to no tab`);
  });
  it("lists a screen under one tab only", () => {
    const all = TABS.flatMap((t) => t.screens);
    assert.equal(new Set(all).size, all.length);
  });
  it("every tab and switcher target is a real screen", () => {
    const real = new Set(routes());
    for (const t of TABS) {
      assert.ok(real.has(t.href), t.href);
      for (const s of t.screens) assert.ok(real.has(s), s);
    }
    for (const items of Object.values(SWITCHES)) for (const i of items ?? []) assert.ok(real.has(i.href), i.href);
  });
  it("the switcher only offers screens of its own tab", () => {
    for (const [id, items] of Object.entries(SWITCHES)) {
      const tab = TABS.find((t) => t.id === id)!;
      for (const i of items ?? []) assert.ok(tab.screens.includes(i.href), `${i.href} is not in ${id}`);
    }
  });
});

describe("tabFor", () => {
  it("maps screens to their tab", () => {
    assert.equal(tabFor("/"), "today");
    assert.equal(tabFor("/budget"), "money");
    assert.equal(tabFor("/recipes"), "groceries");
    assert.equal(tabFor("/receipt-sources"), "groceries");
    assert.equal(tabFor("/settings"), "settings");
  });
  it("ignores a trailing slash and falls back to Today", () => {
    assert.equal(tabFor("/budget/"), "money");
    assert.equal(tabFor("/nope"), "today");
  });
});

describe("switchFor", () => {
  it("is offered on the lead screens of Money and Groceries", () => {
    assert.equal(switchFor("/spending")?.items.length, 2);
    assert.equal(switchFor("/mealplan")?.items.length, 4);
    assert.equal(switchFor("/mealplan")?.active, "/mealplan");
  });
  it("is not offered on screens opened from Settings", () => {
    assert.equal(switchFor("/sync"), null);
    assert.equal(switchFor("/receipts"), null);
    assert.equal(switchFor("/settings"), null);
  });
});
