import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { apiWith } from "./fakeWire";
import {
  SOURCE_ORDER,
  attentionCount,
  callbackHasResult,
  canSyncNow,
  disconnectedText,
  extractCallbackUrl,
  healthPill,
  importedText,
  isSourceKey,
  lastSyncText,
  lidlPromises,
  isSignedIn,
  lidlStateText,
  listedSources,
  noSourceText,
  nextRunText,
  setupSteps,
  signInMode,
  sourceBlurb,
  sourceIcon,
  sourceTitle,
  summaryText,
  syncResultText,
  type SourceLike,
} from "../src/receiptSources";

function src(over: Partial<SourceLike>): SourceLike {
  return { source: "email", enabled: true, state: "ok", imported_total: 0, last_imported: 0, ...over };
}

describe("names and icons", () => {
  it("every source has a title, an icon, a blurb and setup steps", () => {
    for (const k of SOURCE_ORDER) {
      assert.ok(sourceTitle(k).length > 0 && sourceTitle(k) !== k);
      assert.ok(sourceIcon(k).length > 0);
      assert.ok(sourceBlurb(k).length > 20);
      assert.ok(setupSteps(k).length >= 2);
    }
    assert.equal(isSourceKey("email"), true);
    assert.equal(isSourceKey("fax"), false);
    assert.deepEqual(setupSteps("fax"), []);
  });

  it("the setup help never asks for a secret in the file", () => {
    const email = setupSteps("email").join(" ");
    assert.match(email, /environment variable/);
    assert.match(email, /never goes into the config file/);
  });
});

describe("healthPill", () => {
  it("says every state in words and picks a distinct tone for trouble", () => {
    const states = ["ok", "running", "waiting", "error", "not_connected", "needs_signin", "disabled"];
    const labels = states.map((s) => healthPill({ state: s, enabled: true }).label);
    assert.equal(new Set(labels).size, states.length, "no two states share a label");
    assert.equal(healthPill({ state: "ok", enabled: true }).tone, "good");
    assert.equal(healthPill({ state: "error", enabled: true }).tone, "bad");
    assert.equal(healthPill({ state: "needs_signin", enabled: true }).tone, "warn");
    assert.equal(healthPill({ state: "something-new", enabled: true }).label, "Off");
  });
});

describe("time wording", () => {
  const now = 1_800_000_000;
  it("last sync", () => {
    assert.equal(lastSyncText(null, now), "Never");
    assert.equal(lastSyncText(undefined, now), "Never");
    assert.equal(lastSyncText(now - 20, now), "Just now");
    assert.equal(lastSyncText(now + 500, now), "Just now", "a clock a little ahead is not negative");
    assert.equal(lastSyncText(now - 5 * 60, now), "5 min ago");
    assert.equal(lastSyncText(now - 3 * 3600, now), "3 h ago");
    assert.equal(lastSyncText(now - 30 * 3600, now), "Yesterday");
    assert.equal(lastSyncText(now - 5 * 86_400, now), "5 days ago");
  });

  it("next run", () => {
    assert.equal(nextRunText(null, now), null);
    assert.equal(nextRunText(now - 100, now), "Next run due now");
    assert.equal(nextRunText(now + 25 * 60, now), "Next run in 25 min");
    assert.equal(nextRunText(now + 3 * 3600, now), "Next run in 3 h");
    assert.equal(nextRunText(now + 3 * 86_400, now), "Next run in 3 days");
  });
});

describe("counts and summaries", () => {
  it("imported text", () => {
    assert.equal(importedText(0), "No receipts yet");
    assert.equal(importedText(1), "1 receipt imported");
    assert.equal(importedText(14), "14 receipts imported");
  });

  it("sync result", () => {
    assert.equal(syncResultText(0, 0), "No new receipts.");
    assert.equal(syncResultText(1, 0), "1 new receipt.");
    assert.equal(syncResultText(3, 1), "3 new receipts; 1 matched to a bank payment.");
    assert.equal(syncResultText(0, 2), "No new receipts; 2 matched to a bank payment.");
  });

  it("which sources can sync and which need attention", () => {
    assert.equal(canSyncNow(src({ state: "ok" })), true);
    assert.equal(canSyncNow(src({ state: "waiting" })), true);
    assert.equal(canSyncNow(src({ state: "error" })), true, "a failed source can be retried");
    assert.equal(canSyncNow(src({ state: "running" })), false);
    assert.equal(canSyncNow(src({ state: "needs_signin" })), false);
    assert.equal(canSyncNow(src({ state: "not_connected" })), false);
    assert.equal(canSyncNow(src({ enabled: false, state: "disabled" })), false);

    const list = [src({ state: "ok" }), src({ state: "error" }), src({ state: "needs_signin" }), src({ enabled: false, state: "disabled" })];
    assert.equal(attentionCount(list), 2);
    assert.equal(attentionCount([]), 0);
  });

  it("summary line", () => {
    assert.equal(summaryText([src({ enabled: false, state: "disabled" })]), "No automatic source is switched on yet.");
    assert.equal(summaryText([src({}), src({ enabled: false, state: "disabled" })]), "1 of 2 sources on");
    assert.equal(summaryText([src({ imported_total: 12 }), src({ imported_total: 1 })]), "2 of 2 sources on, 13 receipts imported");
    assert.equal(summaryText([src({ imported_total: 1 })]), "1 of 1 sources on, 1 receipt imported");
  });
});

describe("Lidl sign-in", () => {
  const scheme = "com.lidlplus.app";

  it("finds the callback address in whatever was pasted", () => {
    const url = "com.lidlplus.app://callback?code=ABC123&scope=openid&state=xyz";
    assert.equal(extractCallbackUrl(url, scheme), url);
    assert.equal(extractCallbackUrl(`  ${url}\n`, scheme), url);
    assert.equal(extractCallbackUrl(`"${url}"`, scheme), url);
    assert.equal(extractCallbackUrl(`Address bar: ${url} (copied)`, scheme), url);
    assert.equal(extractCallbackUrl("https://accounts.lidl.com/connect/authorize?client_id=x", scheme), null);
    assert.equal(extractCallbackUrl("com.lidlplus.app://", scheme), null);
    assert.equal(extractCallbackUrl("", scheme), null);
  });

  it("recognises an address that carries a result", () => {
    assert.equal(callbackHasResult("com.lidlplus.app://callback?code=ABC"), true);
    assert.equal(callbackHasResult("com.lidlplus.app://callback?error=access_denied"), true);
    assert.equal(callbackHasResult("com.lidlplus.app://callback"), false);
  });

  it("only phones can finish the sign-in inside the app", () => {
    assert.equal(signInMode("ios"), "auth-session");
    assert.equal(signInMode("android"), "auth-session");
    assert.equal(signInMode("web"), "paste");
    assert.equal(signInMode("windows"), "paste");
  });

  it("the card says the promises plainly", () => {
    const text = lidlPromises(false).join(" ");
    for (const must of ["Lidl's own page", "never sees your password", "refresh token", "unofficial", "disconnect"]) {
      assert.ok(text.includes(must) || text.toLowerCase().includes(must.toLowerCase()), must);
    }
  });

  it("state line", () => {
    const now = 1_800_000_000;
    assert.equal(lidlStateText("connected", now - 7200, now), "Connected 2 h ago");
    assert.equal(lidlStateText("connected", null, now), "Connected");
    assert.equal(lidlStateText("never", null, now), "Not connected");
    assert.match(lidlStateText("needs_signin", null, now), /no longer accepts/);
    assert.match(lidlStateText("disabled", null, now), /Switched off/);
  });
});

describe("API client", () => {
  it("calls the receipt source endpoints, the same for every source", async () => {
    const { api: a, calls } = apiWith((op) => (op === "list_sources" ? [] : op === "disconnect_source" ? undefined : { ok: true }));
    await a.receiptSources();
    await a.receiptSource("lidl_plus");
    await a.syncReceipts();
    await a.syncReceipts("folder");
    await a.connectSource("kaufland_card");
    await a.finishSource("lidl_plus", "st", "com.lidlplus.app://callback?code=A");
    await a.disconnectSource("lidl_plus");
    await a.knownReceipts("rewe_app", ["a", "b"]);
    await a.importReceipts("rewe_app", []);
    await a.importReceipts("orders_file", [], "Amazon");
    assert.deepEqual(
      calls.map((c) => [c.op, c.args]),
      [
        ["list_sources", {}],
        ["get_source", { kind: "lidl_plus" }],
        ["sync_now", {}],
        ["sync_now", { body: { source: "folder" } }],
        ["connect_source", { kind: "kaufland_card" }],
        ["finish_source", { kind: "lidl_plus", body: { state: "st", callback_url: "com.lidlplus.app://callback?code=A" } }],
        ["disconnect_source", { kind: "lidl_plus" }],
        ["known_receipts", { kind: "rewe_app", body: { ids: ["a", "b"] } }],
        ["import_receipts", { kind: "rewe_app", body: { receipts: [] } }], // no shop for a REWE push
        ["import_receipts", { kind: "orders_file", body: { shop: "Amazon", receipts: [] } }],
      ],
    );
  });

  it("reads the states of the one source list", () => {
    for (const state of ["ok", "waiting", "running", "error", "connected"]) assert.equal(isSignedIn(state), true, state);
    for (const state of ["not_connected", "needs_signin", "disabled", "never"]) assert.equal(isSignedIn(state), false, state);
    assert.equal(signInStateText("Lidl", "not_connected", null, 0), "Not connected");
    assert.equal(signInStateText("Lidl", "ok", 1000, 1000 + 7200), "Connected 2 h ago");
    const list = [
      { source: "email", flow: "server" },
      { source: "lidl_plus", flow: "sign_in" },
      { source: "rewe_app", flow: "push" },
      { source: "orders_file", flow: "push" },
    ];
    assert.deepEqual(listedSources(list).map((s) => s.source), ["email", "lidl_plus"]);
  });
});

describe("on the phone's own backend", () => {
  it("never points a phone user at a server or financer.toml", () => {
    for (const k of SOURCE_ORDER) {
      const text = setupSteps(k, true).join(" ");
      assert.ok(setupSteps(k, true).length >= 1);
      assert.ok(!/financer\.toml|restart the server|environment variable/i.test(text), `${k}: ${text}`);
    }
    assert.ok(!/financer\.toml|restart the server/i.test(noSourceText(true)));
    assert.ok(!/server/i.test(disconnectedText(true)));
    assert.ok(!/your server/i.test(lidlPromises(true).join(" ")));
  });

  it("tells the truth about what works there", () => {
    assert.match(setupSteps("lidl_plus", true).join(" "), /Switch it on below/);
    assert.match(setupSteps("email", true).join(" "), /Not available on this phone/);
    assert.match(setupSteps("folder", true).join(" "), /Not available on this phone/);
    assert.match(noSourceText(true), /Lidl Plus/);
  });

  it("keeps the server wording when there is a server", () => {
    assert.match(setupSteps("lidl_plus", false).join(" "), /financer\.toml/);
    assert.match(lidlPromises(false)[1], /on your server/);
    assert.match(disconnectedText(false), /your server/);
    assert.match(noSourceText(false), /financer\.toml/);
  });

  it("keeps the same four statements, the unofficial warning included", () => {
    assert.equal(lidlPromises(true).length, 4);
    assert.ok(lidlPromises(true).some((t) => t.startsWith("This is unofficial")));
  });
});

import { SHOP_GUIDES } from "../src/receiptSources";

describe("shop guides", () => {
  it("cover the four shops and say what to do in steps", () => {
    assert.deepEqual(SHOP_GUIDES.map((g) => g.shop), ["REWE", "Kaufland", "Penny", "ALDI"]);
    for (const g of SHOP_GUIDES) assert.ok(g.summary.length > 0 && g.steps.length >= 2);
  });
  it("never promise a sign-in to an app", () => {
    for (const g of SHOP_GUIDES) assert.ok(!/sign in to (the )?(app|your account)/i.test(g.steps.join(" ")));
  });
});

import { signInPromises, signInStateText } from "../src/receiptSources";

describe("the Kaufland Card source", () => {
  it("is one of the sources, between Lidl Plus and the folder", () => {
    assert.deepEqual([...SOURCE_ORDER], ["email", "lidl_plus", "kaufland_card", "folder"]);
    assert.equal(sourceTitle("kaufland_card"), "Kaufland Card");
    assert.ok(sourceBlurb("kaufland_card").includes("Kaufland's own page"));
  });
  it("tells the same four truths as Lidl Plus, with the shop's name and where the token is kept", () => {
    const k = signInPromises("Kaufland", true);
    assert.equal(k.length, 4);
    assert.ok(k[0].includes("Kaufland's own page"));
    assert.ok(k[1].includes("on this phone"));
    assert.ok(k[2].startsWith("This is unofficial"));
    assert.ok(signInPromises("Kaufland", false)[1].includes("on your server"));
  });
  it("words the state of the card", () => {
    assert.equal(signInStateText("Kaufland", "needs_signin", null, 0), "Kaufland no longer accepts the saved sign-in");
    assert.equal(signInStateText("Kaufland", "never", null, 0), "Not connected");
    assert.equal(signInStateText("Kaufland", "disabled", null, 0, true), "Switched off on this phone");
  });
  it("has setup steps on a server and on the phone", () => {
    assert.ok(setupSteps("kaufland_card", false)[0].includes("[receipts.kaufland]"));
    assert.ok(setupSteps("kaufland_card", true)[0].includes("this phone"));
  });
});
