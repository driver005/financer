import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { BARE_SCREENS, SETTINGS_SCREENS, SWITCHES, TABS, areaFor, switchFor, tabFor } from "../src/navigation";

/** Every route file of the app, as the path it is served at (`index` is `/`). */
function routes(): string[] {
  return readdirSync("src/app")
    .filter((f) => /\.tsx$/.test(f) && !f.startsWith("_") && !f.startsWith("+"))
    .map((f) => (f === "index.tsx" ? "/" : `/${f.replace(/\.tsx$/, "")}`));
}

describe("tabs", () => {
  it("has at most three tabs", () => assert.ok(TABS.length <= 3));
  it("gives every screen a home tab, or marks it bare", () => {
    const owned = new Set([...TABS.flatMap((t) => t.screens), ...SETTINGS_SCREENS, ...BARE_SCREENS]);
    for (const r of routes()) assert.ok(owned.has(r), `${r} belongs to no tab and is not in the settings area`);
  });
  it("lists a screen under one tab only", () => {
    const all = [...TABS.flatMap((t) => t.screens), ...SETTINGS_SCREENS, ...BARE_SCREENS];
    assert.equal(new Set(all).size, all.length);
  });
  it("every tab and switcher target is a real screen", () => {
    const real = new Set(routes());
    for (const t of TABS) {
      assert.ok(real.has(t.href), t.href);
      for (const s of t.screens) assert.ok(real.has(s), s);
    }
    for (const s of [...SETTINGS_SCREENS, ...BARE_SCREENS]) assert.ok(real.has(s), s);
    for (const items of Object.values(SWITCHES)) for (const i of items ?? []) assert.ok(real.has(i.href), i.href);
  });
  it("the switcher only offers screens of its own tab", () => {
    for (const [id, items] of Object.entries(SWITCHES)) {
      const tab = TABS.find((t) => t.id === id)!;
      for (const i of items ?? []) assert.ok(tab.screens.includes(i.href), `${i.href} is not in ${id}`);
    }
  });
});

describe("areaFor and tabFor", () => {
  it("maps screens to their tab", () => {
    assert.equal(tabFor("/"), "today");
    assert.equal(tabFor("/budget"), "money");
    assert.equal(tabFor("/recipes"), "groceries");
    assert.equal(tabFor("/stores"), "money");
  });
  it("puts Settings and the screens opened from it in their own area, with no tab", () => {
    for (const path of ["/settings", "/sync", "/receipts", "/receipt-sources", "/rules", "/server-config"]) {
      assert.equal(areaFor(path), "settings", path);
      assert.equal(tabFor(path), null, path);
    }
    assert.equal(areaFor("/onboarding"), "bare");
    assert.equal(areaFor("/spending"), "tab");
  });
  it("ignores a trailing slash and falls back to an everyday screen", () => {
    assert.equal(tabFor("/budget/"), "money");
    assert.equal(areaFor("/nope"), "tab");
    assert.equal(tabFor("/nope"), "today");
  });
});

describe("switchFor", () => {
  it("is offered on the lead screens of Money and Groceries", () => {
    assert.equal(switchFor("/spending")?.items.length, 2);
    assert.equal(switchFor("/mealplan")?.items.length, 4);
    assert.equal(switchFor("/mealplan")?.active, "/mealplan");
  });
  it("is not offered in the settings area or on Stores", () => {
    assert.equal(switchFor("/sync"), null);
    assert.equal(switchFor("/receipts"), null);
    assert.equal(switchFor("/settings"), null);
    assert.equal(switchFor("/stores"), null);
  });
});
