import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CategorySchema, CriterionDef, JobView, Notification, ProgressState, SearchResponse } from "../src/api/types";
import { planDealNotices } from "../src/logic/dealNotifications";
import { ago, dealLine, formatCents, planTerms, savingText } from "../src/logic/format";
import { followJob, progressModel, textBar, worthShowing, type ProgressModel, type ProgressSurface } from "../src/logic/progress";
import { addAlias, addAttribute, addCriterion, formulaProblem, newCategory, removeCriterion, slugKey, uniqueKey } from "../src/logic/schemaEdit";
import { chipsFor, indexRequestFor, nextStep } from "../src/logic/searchPlan";
import { currentLevel, groups, levelOf, presetsFor, setLevel, weightFor } from "../src/logic/weights";

const camera: CriterionDef = { key: "camera", label: "Camera", kind: "formula", expr: "x", weight: 2, group: "camera" };
const price: CriterionDef = { key: "price", label: "Price", kind: "price", weight: 3, group: "cost" };
const deal: CriterionDef = { key: "deal", label: "Deal", kind: "deal", weight: 1, group: "cost" };
const battery: CriterionDef = { key: "battery", label: "Battery", kind: "number", attribute: "battery_mah", weight: 2, group: "battery" };
const schema: CategorySchema = { id: "smartphone", name: "Smartphone", criteria: [price, deal, camera, battery] };

describe("format", () => {
  it("formats German prices, savings and ages", () => {
    assert.equal(formatCents(129_900), "1.299,00 €");
    assert.equal(formatCents(-5), "-0,05 €");
    assert.equal(savingText(1234, 29616, 24), "Save 12,34 € a month (296,16 € over 24 months)");
    assert.equal(savingText(-500, -12000, 24, "Old plan"), "5,00 € a month more than Old plan");
    assert.equal(savingText(0, 0, 24), "Same cost than now");
    assert.equal(ago(1000, 1000 + 3 * 86_400), "3 days ago");
    assert.equal(ago(1000, 1000 + 3600), "1 hour ago");
    assert.equal(ago(1000, 1010), "just now");
  });

  it("says why a price is or is not a deal", () => {
    const base = { current_cents: 1, reference_cents: 2, discount_pct: 22.4, lowest_cents: 1, lowest_90d: true, all_time_low: false, samples: 6, verdict: "great" as const };
    assert.equal(dealLine(base), "22 % below its usual price, lowest in 90 days");
    assert.equal(dealLine({ ...base, all_time_low: true }), "22 % below its usual price, lowest we have seen");
    assert.equal(dealLine({ ...base, verdict: "none", samples: 1 }), "Not enough price history yet");
    assert.equal(dealLine({ ...base, verdict: "none" }), "Priced as usual");
  });

  it("describes a contract", () => {
    const text = planTerms({ shop: "t", url: "u", price_cents: 0, recurring: { monthly_cents: 2499, min_term_months: 24, promo_months: 6, promo_monthly_cents: 0, setup_cents: 3999, cashback_cents: 5000 } });
    assert.equal(text, "24 months, first 6 months at 0,00 €, 39,99 € to set up, 50,00 € cash back");
    assert.equal(planTerms({ shop: "t", url: "u", price_cents: 0, recurring: { monthly_cents: 1000 } }), "cancel monthly");
    assert.equal(planTerms({ shop: "s", url: "u", price_cents: 100 }), "");
  });
});

describe("importance levels", () => {
  it("map to weights relative to the default and back", () => {
    assert.equal(weightFor(camera, "normal"), 2);
    assert.equal(weightFor(camera, "high"), 5);
    assert.equal(weightFor(camera, "off"), 0);
    for (const level of ["low", "normal", "high", "essential"] as const) assert.equal(levelOf(camera, weightFor(camera, level)), level);
    assert.equal(levelOf(camera, 0), "off");
  });

  it("setting the default level removes the override", () => {
    let p = setLevel({}, camera, "high");
    assert.deepEqual(p.weights, { camera: 5 });
    assert.equal(currentLevel(camera, p), "high");
    p = setLevel(p, camera, "normal");
    assert.deepEqual(p.weights, {});
    assert.equal(currentLevel(camera, p), "normal");
    assert.equal(currentLevel({ ...camera, weight: 0 }, {}), "off");
    assert.equal(weightFor({ ...camera, weight: 0 }, "normal"), 1);
  });

  it("groups criteria and builds presets from the groups the category defines", () => {
    assert.deepEqual(groups(schema.criteria ?? []).map((g) => g.label), ["Price and deals", "Camera", "Battery"]);
    const presets = presetsFor(schema);
    assert.deepEqual(presets.map((p) => p.label), ["Balanced", "Camera first", "Battery first", "Cheapest that is still good", "Best, whatever it costs"]);
    assert.deepEqual(presets[1].profile.weights, { camera: 12 });
    assert.deepEqual(presets[4].profile.weights, { price: 0, deal: 0 });
    // a custom group gets its preset without code
    const custom: CategorySchema = { ...schema, criteria: [...(schema.criteria ?? []), { key: "triggers", label: "Triggers", kind: "flag", attribute: "t", group: "gaming" }] };
    assert.ok(presetsFor(custom).some((p) => p.label === "Gaming first"));
  });
});

const running = (over: Partial<ProgressState>): ProgressState => ({ phase: "running", message: "Reading Shop", done: 2, total: 8, products: 5, failed: 0, percent: 25, ...over });

describe("progress notification", () => {
  it("draws a bar and words for every phase", () => {
    assert.equal(textBar(30), "▰▰▰▱▱▱▱▱▱▱ 30 %");
    assert.equal(textBar(0), "▱▱▱▱▱▱▱▱▱▱ 0 %");
    assert.equal(textBar(140), "▰▰▰▰▰▰▰▰▰▰ 100 %");
    const m = progressModel("pixel 9", running({}));
    assert.equal(m.title, 'Indexing "pixel 9"');
    assert.equal(m.body, "Reading Shop · 2/8 pages · 5 products");
    assert.ok(m.ongoing && !m.finished && !m.indeterminate);
    assert.ok(progressModel("x", running({ total: 0, done: 0, percent: 0 })).indeterminate);
    const done = progressModel("pixel 9", running({ phase: "done", percent: 100, products: 12 }));
    assert.deepEqual([done.title, done.body, done.ongoing, done.finished], ["Search index ready", '12 products indexed for "pixel 9"', false, true]);
    assert.equal(progressModel("q", running({ phase: "done", products: 0 })).body, 'Nothing found for "q"');
    assert.equal(progressModel("q", running({ phase: "failed", message: "No source could be read" })).body, "No source could be read");
    assert.equal(progressModel("q", running({ phase: "cancelled" })).title, "Indexing stopped");
  });

  it("is throttled but never misses the first or the last state", () => {
    const a = progressModel("q", running({ percent: 10 }));
    const b = progressModel("q", running({ percent: 11 }));
    assert.ok(worthShowing(null, a, 0, 0));
    assert.ok(!worthShowing(a, b, 1000, 1200), "too soon");
    assert.ok(worthShowing(a, b, 1000, 2100));
    assert.ok(!worthShowing(a, a, 1000, 5000), "nothing changed");
    assert.ok(worthShowing(a, progressModel("q", running({ phase: "done" })), 1000, 1001), "the end is always shown");
  });

  it("follows a job to the end through a surface", async () => {
    const states = [running({ percent: 10, done: 1 }), running({ percent: 10, done: 1 }), running({ percent: 50, done: 4 }), running({ phase: "done", percent: 100, done: 8, products: 7 })];
    let i = 0;
    let clock = 0;
    const shown: ProgressModel[] = [];
    const finished: ProgressModel[] = [];
    const surface: ProgressSurface = { show: async (m) => void shown.push(m), finish: async (m) => void finished.push(m) };
    const job = (p: ProgressState): JobView => ({ id: "j", query: "q", category: null, started_at: 0, progress: p, report: null });
    const result = await followJob("j", "q", {
      poll: async () => job(states[Math.min(i++, states.length - 1)]),
      surface,
      sleep: async (ms) => void (clock += ms),
      now: () => clock,
      pollMs: 600,
    });
    assert.equal(result.job?.progress.phase, "done");
    assert.deepEqual(shown.map((m) => m.percent), [10, 50]);
    assert.equal(finished.length, 1);
    assert.equal(finished[0].body, '7 products indexed for "q"');
  });

  it("gives up with a failure notification when the server goes away", async () => {
    const finished: ProgressModel[] = [];
    await followJob("j", "q", {
      poll: async () => {
        throw new Error("offline");
      },
      surface: { show: async () => {}, finish: async (m) => void finished.push(m) },
      sleep: async () => {},
      maxFailures: 3,
    });
    assert.equal(finished.length, 1);
    assert.equal(finished[0].phase, "failed");
    assert.equal(finished[0].body, "Lost contact with the search");
  });
});

const notice = (id: number, over: Partial<Notification> = {}): Notification => ({
  id,
  created_at: 0,
  read: false,
  message: `Pixel ${id} is 549,00 EUR at Shop (-15 %)`,
  event: { key: `k${id}`, watch_id: 1, watch_name: "w", product_id: `p${id}`, title: `Pixel ${id}`, shop: "Shop", url: "https://s/p", price_cents: 54_900, reference_cents: 64_900, discount_pct: 15.4, verdict: "good", kind: "deal" },
  ...over,
});

describe("deal notices", () => {
  it("shows each message once and remembers the newest", () => {
    const first = planDealNotices([notice(1), notice(2)], 0);
    assert.deepEqual(first.notices.map((n) => n.id), ["financer.shop.deal.1", "financer.shop.deal.2"]);
    assert.equal(first.lastShownId, 2);
    assert.equal(first.notices[0].title, "Good deal: Pixel 1");
    assert.ok(first.notices[0].body.endsWith("(was about 649,00 €)"));
    const again = planDealNotices([notice(1), notice(2), notice(3, { read: true })], 2);
    assert.deepEqual(again, { notices: [], lastShownId: 2 });
  });

  it("collapses a long backlog into a summary", () => {
    const many = [1, 2, 3, 4, 5].map((i) => notice(i));
    const { notices, lastShownId } = planDealNotices(many, 0, 3);
    assert.equal(notices.length, 3);
    assert.equal(notices[0].title, "3 more deals");
    assert.deepEqual(notices.slice(1).map((n) => n.data.eventId), [4, 5]);
    assert.equal(lastShownId, 5);
  });

  it("words the kinds of deal", () => {
    assert.ok(planDealNotices([notice(1, { event: { ...notice(1).event, kind: "below_target" } })], 0).notices[0].title.startsWith("Below your target price"));
    assert.ok(planDealNotices([notice(1, { event: { ...notice(1).event, kind: "new_low" } })], 0).notices[0].title.startsWith("Lowest price"));
  });
});

describe("schema editing", () => {
  it("makes safe keys", () => {
    assert.equal(slugKey("Battery life (h)"), "battery_life_h");
    assert.equal(slugKey("Größe & Gewicht"), "grosse_gewicht");
    assert.equal(uniqueKey("Battery", ["battery", "battery_2"]), "battery_3");
    assert.equal(uniqueKey("!!!", []), "item");
  });

  it("adds an attribute, a criterion over it, an alias, and removes an inherited criterion", () => {
    let s = newCategory("Gaming phone", "smartphone");
    assert.equal(s.id, "gaming_phone");
    assert.equal(s.extends, "smartphone");
    const a = addAttribute(s, "Shoulder triggers", "bool");
    s = addAlias(a.schema, a.key, "Schultertasten");
    s = addAlias(s, a.key, "schultertasten");
    assert.deepEqual(s.attributes?.[0].aliases, ["Schultertasten"]);
    const c = addCriterion(s, "Triggers", { kind: "flag", attribute: a.key }, 2);
    assert.deepEqual(c.schema.criteria?.[0], { key: "triggers", label: "Triggers", kind: "flag", attribute: "shoulder_triggers", weight: 2 });
    const f = addCriterion(c.schema, "Battery per gram", { kind: "formula", expr: " battery_mah / weight_g ", min: 20, max: 40, higherIsBetter: true });
    assert.equal(f.schema.criteria?.[1].kind, "formula");
    const removed = removeCriterion(f.schema, "weight");
    assert.deepEqual(removed.remove, ["weight"]);
  });

  it("checks formulas the way a person types them wrong", () => {
    assert.equal(formulaProblem("battery_mah / weight_g"), null);
    assert.equal(formulaProblem("coalesce(a, b * 2)"), null);
    assert.match(formulaProblem("") ?? "", /Write a formula/);
    assert.match(formulaProblem("(a + b") ?? "", /not closed/);
    assert.match(formulaProblem("a + b)") ?? "", /closing bracket/);
    assert.match(formulaProblem("a +") ?? "", /ends with an operator/);
    assert.match(formulaProblem("a ** b") ?? "", /Two operators/);
    assert.match(formulaProblem("a; drop") ?? "", /Only numbers/);
  });
});

const response = (over: Partial<SearchResponse>): SearchResponse => ({
  category: "smartphone",
  category_guessed: false,
  parsed: { text: "handy", terms: [], category: "smartphone", max_price_cents: 50_000, constraints: [{ attribute: "ram_gb", op: "gte", value: 8 }] },
  profile: {},
  items: [{} as SearchResponse["items"][number]],
  excluded: [],
  picks: { best_overall: null, best_value: null, cheapest_good: null, premium: null },
  tiers: [],
  candidates: 1,
  catalogue: { products_in_category: 4, newest_offer_at: 1, stale: false },
  ...over,
});

describe("search planning", () => {
  it("offers to build the index when nothing is known or the data is old", () => {
    assert.deepEqual(nextStep(response({}), true), { kind: "show" });
    assert.deepEqual(nextStep(response({ category: null }), true), { kind: "suggest-index", reason: "no-category" });
    assert.deepEqual(nextStep(response({ catalogue: { products_in_category: 0, newest_offer_at: 0, stale: true }, items: [] }), true), { kind: "suggest-index", reason: "empty" });
    assert.deepEqual(nextStep(response({ catalogue: { products_in_category: 4, newest_offer_at: 1, stale: true } }), true), { kind: "suggest-index", reason: "stale" });
    // a server keeps its own data fresh: old data is not the person's problem there
    assert.deepEqual(nextStep(response({ catalogue: { products_in_category: 4, newest_offer_at: 1, stale: true } }), false), { kind: "show" });
    assert.deepEqual(nextStep(response({ items: [] }), false), { kind: "none-found" });
    assert.deepEqual(nextStep(response({ items: [] }), true), { kind: "suggest-index", reason: "empty" });
  });

  it("builds the index request and the chips", () => {
    assert.deepEqual(indexRequestFor({ query: " pixel 9 " }, response({})), { query: "pixel 9", category: "smartphone" });
    assert.deepEqual(indexRequestFor({ query: "x", category: "laptop" }), { query: "x", category: "laptop" });
    assert.deepEqual(chipsFor(response({})), ["under 500 €", "ram gb ≥ 8"]);
  });
});
