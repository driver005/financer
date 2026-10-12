import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Api } from "../src/api/client";
import {
  INTENSITIES,
  STEP_IDS,
  clampHousehold,
  entryAction,
  firstQuest,
  mergeProfile,
  parseProfile,
  groceryLimitFor,
  mascotFor,
  monthlyGroceryCents,
  newState,
  nextStep,
  parseBudget,
  parsePostalCode,
  parseState,
  planApply,
  previousStep,
  progressOf,
  recapRows,
  resolveStep,
  sanitizeDraft,
  serializeState,
  stepsFor,
  suggestAllowance,
  validateServer,
  type BuildInfo,
  type Draft,
} from "../src/onboarding";
import { applyDraft } from "../src/onboardingApply";
import { dailyAllowanceOn } from "../src/game";

const phone: BuildInfo = { platform: "android", embeddedAvailable: true };
const web: BuildInfo = { platform: "web", embeddedAvailable: false };

describe("steps", () => {
  it("has the eight steps in order on a phone", () => {
    assert.deepEqual(stepsFor(phone), ["welcome", "data", "household", "rhythm", "habits", "money", "safety", "finish"]);
    assert.deepEqual(stepsFor(phone), [...STEP_IDS]);
  });

  it("drops the safety step (lock and notifications) in the browser", () => {
    assert.deepEqual(stepsFor(web), ["welcome", "data", "household", "rhythm", "habits", "money", "finish"]);
  });

  it("walks forward and back and stops at the ends", () => {
    const steps = stepsFor(web);
    assert.equal(nextStep(steps, "welcome"), "data");
    assert.equal(nextStep(steps, "money"), "finish"); // skips safety
    assert.equal(nextStep(steps, "finish"), null);
    assert.equal(previousStep(steps, "finish"), "money");
    assert.equal(previousStep(steps, "welcome"), null);
    assert.equal(nextStep(steps, "safety"), null); // not part of this build
  });

  it("reports progress from 0 to 1", () => {
    const steps = stepsFor(phone);
    assert.deepEqual(progressOf(steps, "welcome"), { index: 0, total: 8, fraction: 0 });
    assert.equal(progressOf(steps, "finish").fraction, 1);
    assert.ok(progressOf(steps, "rhythm").fraction > progressOf(steps, "household").fraction);
  });

  it("moves a stored step the build no longer has on to the next one", () => {
    assert.equal(resolveStep(stepsFor(web), "safety"), "finish");
    assert.equal(resolveStep(stepsFor(web), "rhythm"), "rhythm");
  });
});

describe("stored state", () => {
  it("round-trips", () => {
    const s = { ...newState("rhythm"), draft: { householdSize: 3, chains: ["lidl", "rewe"] as Draft["chains"], intensity: "regular" as const } };
    assert.deepEqual(parseState(serializeState(s)), s);
  });

  it("treats nothing and garbage as no state", () => {
    assert.equal(parseState(null), null);
    assert.equal(parseState(""), null);
    assert.equal(parseState("{nope"), null);
    assert.equal(parseState(JSON.stringify({ v: 2, step: "welcome", draft: {} })), null);
    assert.equal(parseState(JSON.stringify({ v: 1, step: "bogus", draft: {} })), null);
  });

  it("keeps only well-formed answers", () => {
    const d = sanitizeDraft({
      backend: "cloud",
      householdSize: 99,
      groceryBudgetCents: -5,
      chains: ["lidl", "tesco", "rewe"],
      postalCode: "1011",
      payday: 31,
      intensity: "extreme",
      dailyAllowanceCents: 800,
      habitMode: "receipts",
      demoLoaded: "yes",
      notifyKinds: ["evening", 3],
    });
    assert.deepEqual(d, { chains: ["lidl", "rewe"], dailyAllowanceCents: 800, habitMode: "receipts", notifyKinds: ["evening"] });
    assert.deepEqual(sanitizeDraft(null), {});
    assert.deepEqual(sanitizeDraft("x"), {});
  });
});

describe("validation", () => {
  it("clamps the household size", () => {
    assert.equal(clampHousehold(0), 1);
    assert.equal(clampHousehold(3.9), 3);
    assert.equal(clampHousehold(20), 8);
    assert.equal(clampHousehold(Number.NaN), 1);
  });

  it("accepts an empty or 5-digit postal code only", () => {
    assert.deepEqual(parsePostalCode(""), { ok: true, value: null });
    assert.deepEqual(parsePostalCode(" 10115 "), { ok: true, value: "10115" });
    assert.equal(parsePostalCode("1011").ok, false);
    assert.equal(parsePostalCode("1011a").ok, false);
    assert.equal(parsePostalCode("101155").ok, false);
  });

  it("parses the budget in German or plain notation and rejects nonsense", () => {
    assert.deepEqual(parseBudget(""), { ok: true, value: null });
    assert.deepEqual(parseBudget("60"), { ok: true, value: 6000 });
    assert.deepEqual(parseBudget("59,90"), { ok: true, value: 5990 });
    assert.deepEqual(parseBudget("59.90"), { ok: true, value: 5990 }); // decimal point from a phone keyboard
    assert.deepEqual(parseBudget("1.234"), { ok: true, value: 123400 }); // thousands separator
    assert.equal(parseBudget("abc").ok, false);
    assert.equal(parseBudget("0").ok, false);
    assert.equal(parseBudget("20000").ok, false);
  });

  it("turns a weekly budget into a monthly one", () => {
    assert.equal(monthlyGroceryCents(6000, "weekly"), 26000);
    assert.equal(monthlyGroceryCents(26000, "monthly"), 26000);
  });

  it("checks the server address and token", () => {
    assert.equal(validateServer("", "t").ok, false);
    assert.equal(validateServer("not a url", "t").ok, false);
    assert.equal(validateServer("ftp://x.example", "t").ok, false);
    assert.equal(validateServer("https://f.example.com", "").ok, false);
    const ok = validateServer(" https://f.example.com/// ", " tok ");
    assert.equal(ok.ok, true);
    assert.equal(ok.normalized, "https://f.example.com");
    assert.equal(ok.warning, undefined);
  });

  it("warns about plain http except on your own network", () => {
    assert.ok(validateServer("http://f.example.com", "t").warning);
    assert.equal(validateServer("http://192.168.1.20:8080", "t").warning, undefined);
    assert.equal(validateServer("http://localhost:8080", "t").warning, undefined);
    assert.equal(validateServer("http://172.20.0.5", "t").warning, undefined);
    assert.ok(validateServer("http://172.40.0.5", "t").warning);
  });
});

describe("savings levels", () => {
  it("has the three named levels, from relaxed to strict", () => {
    assert.deepEqual(INTENSITIES.map((i) => i.label), ["Casual", "Regular", "Serious"]);
    assert.ok(INTENSITIES[0].factor > INTENSITIES[1].factor && INTENSITIES[1].factor > INTENSITIES[2].factor);
  });

  it("suggests less money per day the stricter the level, from the household size", () => {
    const at = (intensity: "casual" | "regular" | "serious", householdSize: number) => suggestAllowance({ intensity, householdSize });
    assert.equal(at("casual", 1), 650);
    assert.equal(at("regular", 1), 550);
    assert.equal(at("serious", 1), 460);
    assert.ok(at("casual", 2) > at("casual", 1));
    assert.ok(at("casual", 4) < 4 * at("casual", 1)); // shared packs: not simply times four
    assert.ok(at("serious", 3) < at("regular", 3) && at("regular", 3) < at("casual", 3));
  });

  it("starts from the entered budget when there is one", () => {
    // 300 EUR a month over 30.4 days is about 9,86 EUR a day
    assert.equal(suggestAllowance({ intensity: "casual", groceryBudgetCents: 30000, groceryCadence: "monthly" }), 990);
    assert.equal(suggestAllowance({ intensity: "serious", groceryBudgetCents: 30000, groceryCadence: "monthly" }), 690);
    // 70 EUR a week is the same ballpark as 303 a month
    const weekly = suggestAllowance({ intensity: "casual", groceryBudgetCents: 7000, groceryCadence: "weekly" });
    assert.ok(weekly >= 990 && weekly <= 1010);
  });

  it("never suggests less than a euro or an unrounded amount", () => {
    assert.equal(suggestAllowance({ intensity: "serious", groceryBudgetCents: 100, groceryCadence: "monthly" }), 100);
    for (const i of INTENSITIES) assert.equal(suggestAllowance({ intensity: i.id, householdSize: 3 }) % 10, 0);
  });

  it("gives back the daily number the Today screen will show", () => {
    const today = "2026-10-12";
    for (const payday of [1, 15, 25]) {
      const limit = groceryLimitFor({ dailyAllowanceCents: 820, payday }, today)!;
      assert.equal(dailyAllowanceOn(limit, today, payday), 820);
    }
  });

  it("falls back to the budget, and to nothing", () => {
    assert.equal(groceryLimitFor({ groceryBudgetCents: 6000, groceryCadence: "weekly" }, "2026-10-12"), 26000);
    assert.equal(groceryLimitFor({ groceryBudgetCents: 30000 }, "2026-10-12"), 30000);
    assert.equal(groceryLimitFor({}, "2026-10-12"), null);
  });
});

describe("profile", () => {
  it("keeps earlier answers the new run did not give", () => {
    const before = { householdSize: 2, chains: ["lidl"] as Draft["chains"], postalCode: "10115" };
    assert.deepEqual(mergeProfile(before, {}), before);
    assert.deepEqual(mergeProfile(before, { householdSize: 3, chains: [] }), { householdSize: 3, chains: [], postalCode: "10115" });
    assert.deepEqual(mergeProfile({}, { payday: 5, intensity: "casual" }), {});
  });

  it("reads a stored profile defensively", () => {
    assert.deepEqual(parseProfile(null), {});
    assert.deepEqual(parseProfile("{bad"), {});
    assert.deepEqual(parseProfile(JSON.stringify({ householdSize: 4, chains: ["aldi", "x"], postalCode: "80331", payday: 3 })), {
      householdSize: 4,
      chains: ["aldi"],
      postalCode: "80331",
    });
  });
});

describe("applying the answers", () => {
  it("writes nothing for unanswered questions", () => {
    assert.deepEqual(planApply({}, "2026-10-12", [{ category: "dining", limit_cents: 5000 }]), { payday: undefined, habitMode: undefined, envelopes: null });
  });

  it("replaces only the groceries envelope", () => {
    const plan = planApply({ dailyAllowanceCents: 800, payday: 1, habitMode: "receipts" }, "2026-10-12", [
      { category: "dining", limit_cents: 5000 },
      { category: "groceries", limit_cents: 1 },
    ]);
    assert.deepEqual(plan.envelopes, [
      { category: "dining", limit_cents: 5000 },
      { category: "groceries", limit_cents: 800 * 31 },
    ]);
    assert.equal(plan.habitMode, "receipts");
  });

  it("calls the API with the settings and the merged envelopes", async () => {
    const calls: unknown[] = [];
    const api = {
      envelopes: async () => [{ category: "dining", limit_cents: 5000 }],
      saveEnvelopes: async (e: unknown) => {
        calls.push(["envelopes", e]);
        return e;
      },
      saveSettings: async (s: unknown) => {
        calls.push(["settings", s]);
        return {};
      },
    } as unknown as Pick<Api, "envelopes" | "saveEnvelopes" | "saveSettings">;
    const r = await applyDraft(api, { payday: 25, habitMode: "spending", dailyAllowanceCents: 700 }, "2026-10-12");
    assert.equal(r.ok, true);
    assert.deepEqual(calls[0], ["settings", { payday: 25, habit_mode: "spending" }]);
    // payday 25: the period 25.09. to 24.10. has 30 days
    assert.deepEqual(calls[1], [
      "envelopes",
      [
        { category: "dining", limit_cents: 5000 },
        { category: "groceries", limit_cents: 700 * 30 },
      ],
    ]);
  });

  it("does not touch the backend when nothing was answered", async () => {
    const api = {
      envelopes: async () => assert.fail("no read"),
      saveEnvelopes: async () => assert.fail("no write"),
      saveSettings: async () => assert.fail("no write"),
    } as unknown as Pick<Api, "envelopes" | "saveEnvelopes" | "saveSettings">;
    assert.deepEqual(await applyDraft(api, {}, "2026-10-12"), { ok: true, wrote: [] });
  });

  it("reports a failure instead of throwing", async () => {
    const api = {
      envelopes: async () => [],
      saveEnvelopes: async () => {
        throw new Error("HTTP 500");
      },
      saveSettings: async () => ({}),
    } as unknown as Pick<Api, "envelopes" | "saveEnvelopes" | "saveSettings">;
    assert.deepEqual(await applyDraft(api, { dailyAllowanceCents: 700 }, "2026-10-12"), { ok: false, error: "HTTP 500" });
  });
});

describe("mascot, recap and first quest", () => {
  it("reacts to the savings level with the daily number", () => {
    const line = mascotFor("rhythm", { intensity: "serious", dailyAllowanceCents: 460 }, phone);
    assert.match(line.message, /Serious/);
    assert.match(line.message, /4,60 €/);
    assert.equal(line.mood, "cheer");
    assert.match(mascotFor("rhythm", { intensity: "casual", dailyAllowanceCents: 650 }, phone).message, /Casual/);
  });

  it("has a line for every step and says honestly when the build has no on-phone backend", () => {
    for (const id of STEP_IDS) assert.ok(mascotFor(id, {}, phone).message.length > 0);
    assert.match(mascotFor("data", {}, web).message, /server/);
  });

  it("recaps only what was answered", () => {
    assert.deepEqual(recapRows({}, phone), []);
    const rows = recapRows(
      { backend: "embedded", householdSize: 2, chains: ["lidl", "aldi"], payday: 25, intensity: "regular", dailyAllowanceCents: 550, habitMode: "receipts", demoLoaded: true, lockOn: true, notifyKinds: ["evening", "payday"] },
      phone,
    );
    const text = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    assert.equal(text["Data"], "On this phone");
    assert.equal(text["Household"], "2 people");
    assert.equal(text["Stores"], "Lidl, Aldi");
    assert.equal(text["Payday"], "Day 25");
    assert.equal(text["Grocery goal"], "5,50 € a day");
    assert.equal(text["Bookings"], "Demo data (labelled DEMO)");
    assert.equal(text["App lock"], "On");
    assert.equal(text["Reminders"], "2 on");
    // the lock and reminders are not part of the browser build
    assert.equal(recapRows({ lockOn: true }, web).length, 0);
  });

  it("points the first quest at planning once there are bookings, else at adding them", () => {
    assert.equal(firstQuest({}).route, "/spending");
    assert.equal(firstQuest({}).title, "Add your first transaction");
    assert.equal(firstQuest({ demoLoaded: true }).route, "/mealplan");
    assert.equal(firstQuest({ csvImported: 12 }).title, "Plan this week");
    assert.equal(firstQuest({ csvImported: 0 }).route, "/spending");
  });
});

describe("who sees the setup", () => {
  const base = { apiLoaded: true, configured: false, onOnboarding: false };
  const fresh = { done: false, state: null };

  it("waits until storage and the API configuration are read", () => {
    assert.equal(entryAction({ ...base, stored: null }), "wait");
    assert.equal(entryAction({ ...base, stored: fresh, apiLoaded: false }), "wait");
  });

  it("shows the setup on the first run", () => {
    assert.equal(entryAction({ ...base, stored: fresh }), "redirect");
  });

  it("never shows it again once done", () => {
    assert.equal(entryAction({ ...base, stored: { done: true, state: null } }), "stay");
    assert.equal(entryAction({ ...base, stored: { done: true, state: null }, configured: true }), "stay");
  });

  it("does not force existing users through it: the flag is set silently", () => {
    assert.equal(entryAction({ ...base, stored: fresh, configured: true }), "mark_done");
  });

  it("resumes a setup that was started, even if the connection was saved on the way", () => {
    const started = { done: false, state: newState("rhythm") };
    assert.equal(entryAction({ ...base, stored: started }), "redirect");
    assert.equal(entryAction({ ...base, stored: started, configured: true }), "redirect");
  });

  it("leaves the user alone while they are on the setup", () => {
    assert.equal(entryAction({ ...base, stored: { done: false, state: newState() }, onOnboarding: true }), "stay");
    assert.equal(entryAction({ ...base, stored: fresh, onOnboarding: true }), "stay");
  });
});
