import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api, type BankConnection } from "../src/api/client";
import { RemoteTransport } from "../src/api/transport";
import {
  anyBusy,
  approvalLeftText,
  canSync,
  connectionKey,
  connectionSubtitle,
  formatStamp,
  isBusy,
  isSafeLinkUrl,
  lastResultText,
  linkedAccountsText,
  needsLinking,
  needsTypedPin,
  nextSyncText,
  stateLabel,
  stateTone,
  syncButtonLabel,
} from "../src/bankConnections";

function conn(over: Partial<BankConnection> = {}): BankConnection {
  return {
    name: "Girokonto",
    kind: "fints",
    bank_code: "37050198",
    login_masked: "me****",
    iban_masked: "DE89****3000",
    sync_every_hours: 12,
    pin_from_env: false,
    state: "idle",
    message: null,
    approval_expires_at: null,
    linked: true,
    link_url: null,
    accounts: [],
    sync_due: false,
    last_sync_at: null,
    last_result: null,
    next_sync_at: null,
    balance_cents: null,
    balance_date: null,
    ...over,
  };
}

const NOW = 1_800_000_000;

describe("state", () => {
  it("labels and colours every state", () => {
    assert.equal(stateLabel(conn()), "Ready");
    assert.equal(stateTone(conn()), "good");
    assert.equal(stateLabel(conn({ sync_due: true })), "Sync due");
    assert.equal(stateTone(conn({ sync_due: true })), "warn");
    assert.equal(stateLabel(conn({ state: "syncing" })), "Syncing");
    assert.equal(stateLabel(conn({ state: "needs_approval" })), "Needs approval");
    assert.equal(stateTone(conn({ state: "needs_approval" })), "warn");
    assert.equal(stateLabel(conn({ state: "error" })), "Error");
    assert.equal(stateTone(conn({ state: "error" })), "bad");
  });

  it("is busy while syncing or waiting for approval", () => {
    assert.equal(isBusy(conn()), false);
    assert.equal(isBusy(conn({ state: "error" })), false);
    assert.equal(isBusy(conn({ state: "syncing" })), true);
    assert.equal(isBusy(conn({ state: "needs_approval" })), true);
    assert.equal(anyBusy([conn(), conn({ state: "needs_approval" })]), true);
    assert.equal(anyBusy([]), false);
  });
});

describe("Sync now", () => {
  it("needs a typed PIN unless the server has one", () => {
    assert.equal(needsTypedPin(conn()), true);
    assert.equal(needsTypedPin(conn({ pin_from_env: true })), false);
    assert.equal(canSync(conn(), ""), false);
    assert.equal(canSync(conn(), "1234"), true);
    assert.equal(canSync(conn({ pin_from_env: true }), ""), true);
  });

  it("cannot be pressed while a sync runs", () => {
    assert.equal(canSync(conn({ pin_from_env: true, state: "needs_approval" }), ""), false);
    assert.equal(canSync(conn({ pin_from_env: true, state: "syncing" }), ""), false);
    assert.equal(canSync(conn({ pin_from_env: true, state: "error" }), ""), true);
  });
});

describe("texts", () => {
  it("formats a time stamp in the device's zone", () => {
    const local = new Date(2026, 9, 12, 14, 3).getTime() / 1000;
    assert.equal(formatStamp(local), "12.10.2026 14:03");
  });

  it("reports the last attempt", () => {
    const at = new Date(2026, 9, 12, 14, 3).getTime() / 1000;
    assert.equal(lastResultText(conn()), null);
    assert.equal(
      lastResultText(conn({ last_result: { ok: true, at, imported: 2, duplicates: 5, skipped: 0, message: null } })),
      "Last sync 12.10.2026 14:03: 2 new, 5 already known.",
    );
    assert.equal(
      lastResultText(conn({ last_result: { ok: false, at, imported: null, duplicates: null, skipped: null, message: "x" } })),
      "Last attempt 12.10.2026 14:03 failed.",
    );
  });

  it("says when the next sync is", () => {
    assert.equal(nextSyncText(conn({ sync_every_hours: 0 }), NOW), "Syncs only when you press Sync now.");
    assert.equal(nextSyncText(conn({ next_sync_at: NOW + 40 * 60 }), NOW), "Scheduled every 12 hours. Next in about 40 minutes.");
    assert.equal(nextSyncText(conn({ sync_every_hours: 1, next_sync_at: NOW + 60 }), NOW), "Scheduled every hour. Next in about 1 minute.");
    assert.equal(nextSyncText(conn({ next_sync_at: NOW + 5 * 3600 }), NOW), "Scheduled every 12 hours. Next in about 5 hours.");
    assert.equal(nextSyncText(conn({ next_sync_at: NOW - 10 }), NOW), "Scheduled every 12 hours. Due now.");
    assert.match(nextSyncText(conn({ sync_due: true, next_sync_at: NOW - 10 }), NOW) ?? "", /press Sync now and enter your PIN/);
    assert.equal(nextSyncText(conn({ next_sync_at: null }), NOW), null);
  });

  it("says how long the server waits for the approval", () => {
    assert.equal(approvalLeftText(conn(), NOW), null);
    assert.equal(approvalLeftText(conn({ state: "needs_approval", approval_expires_at: NOW + 10 * 60 }), NOW), "The server waits about 10 more minutes.");
    assert.equal(approvalLeftText(conn({ state: "needs_approval", approval_expires_at: NOW + 20 }), NOW), "The server waits about 1 more minute.");
    assert.equal(approvalLeftText(conn({ state: "needs_approval", approval_expires_at: NOW - 1 }), NOW), "Time is about up.");
  });

  it("keys connections by lower-case name", () => {
    assert.equal(connectionKey(conn({ name: " Giro Konto " })), "giro konto");
  });
});

describe("API calls", () => {
  it("lists, starts (with or without a PIN) and cancels", async () => {
    const calls: { url: string; method?: string; body?: unknown; headers?: unknown }[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method, body: init.body, headers: init.headers });
      return { status: 200, ok: true, text: async () => JSON.stringify(conn()) } as Response;
    }) as unknown as typeof fetch;
    const api = new Api(new RemoteTransport({ baseUrl: "https://x.test", token: "t" }, impl));
    await api.bankConnections();
    await api.syncConnection("Giro Konto", "1234");
    await api.syncConnection("Giro Konto");
    await api.cancelConnection("Giro Konto");
    await api.disconnectConnection("Plaid Giro");
    assert.equal(calls[0].url, "https://x.test/v1/bank/connections");
    assert.equal(calls[1].url, "https://x.test/v1/bank/connections/Giro%20Konto/sync");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[1].body, '{"pin":"1234"}');
    assert.equal(calls[2].body, undefined); // the server has the PIN: nothing is sent
    assert.equal(calls[3].url, "https://x.test/v1/bank/connections/Giro%20Konto/cancel");
    assert.equal(calls[4].url, "https://x.test/v1/bank/connections/Plaid%20Giro/disconnect");
    assert.equal(calls[4].method, "POST");
  });
});

/** A Plaid connection as the server lists it. */
function plaid(over: Partial<BankConnection> = {}): BankConnection {
  return conn({ name: "Plaid Giro", kind: "plaid", bank_code: "", login_masked: "", iban_masked: "", linked: false, ...over });
}

describe("Plaid connections", () => {
  it("are not connected until you signed in once, and then need no PIN", () => {
    const fresh = plaid();
    assert.equal(needsLinking(fresh), true);
    assert.equal(needsTypedPin(fresh), false);
    assert.equal(canSync(fresh, ""), true, "no PIN to type for Plaid");
    assert.equal(stateLabel(fresh), "Not connected");
    assert.equal(stateTone(fresh), "muted");
    assert.equal(syncButtonLabel(fresh, false), "Connect your bank");
    assert.equal(syncButtonLabel(fresh, true), "Opening…");
    const linked = plaid({ linked: true });
    assert.equal(needsLinking(linked), false);
    assert.equal(stateLabel(linked), "Ready");
    assert.equal(syncButtonLabel(linked, false), "Sync now");
    assert.equal(syncButtonLabel(linked, true), "Starting…");
    // a FinTS connection is never "not connected"
    assert.equal(needsLinking(conn({ linked: false })), false);
  });

  it("are busy while you sign in, and say how long the page is valid", () => {
    const signingIn = plaid({ state: "needs_link", link_url: "https://secure.plaid.com/hl/abc", approval_expires_at: NOW + 10 * 60 });
    assert.equal(isBusy(signingIn), true);
    assert.equal(canSync(signingIn, ""), false);
    assert.equal(stateLabel(signingIn), "Sign in to your bank");
    assert.equal(stateTone(signingIn), "warn");
    assert.equal(approvalLeftText(signingIn, NOW), "The server waits about 10 more minutes.");
    assert.equal(anyBusy([conn(), signingIn]), true);
  });

  it("describe what they are connected to", () => {
    assert.equal(connectionSubtitle(conn()), "Bank code 37050198 · login me**** · DE89****3000");
    assert.equal(connectionSubtitle(plaid()), "Plaid · not connected yet");
    assert.equal(connectionSubtitle(plaid({ linked: true })), "Plaid · connected");
    const accounts = [
      { id: "a1", name: "Giro", mask: "0000", kind: "depository" },
      { id: "a2", name: "Tagesgeld", mask: null, kind: "depository" },
    ];
    assert.equal(connectionSubtitle(plaid({ linked: true, accounts })), "Plaid · 2 accounts connected");
    assert.equal(connectionSubtitle(plaid({ linked: true, accounts: accounts.slice(0, 1) })), "Plaid · 1 account connected");
    assert.equal(linkedAccountsText(plaid({ linked: true, accounts })), "Giro ••0000, Tagesgeld");
    assert.equal(linkedAccountsText(plaid()), null);
  });

  it("explain how to connect before anything is scheduled", () => {
    assert.match(nextSyncText(plaid(), NOW) ?? "", /Connect your bank .* no PIN and no approval/);
    assert.equal(nextSyncText(plaid({ linked: true, sync_every_hours: 0 }), NOW), "Syncs only when you press Sync now.");
  });

  it("only open web addresses that are Plaid's own", () => {
    assert.equal(isSafeLinkUrl("https://secure.plaid.com/hl/abc"), true);
    assert.equal(isSafeLinkUrl("https://plaid.com/x"), true);
    for (const bad of [
      "http://secure.plaid.com/hl/abc", // not https
      "https://plaid.com.evil.example/x", // another host
      "https://evilplaid.com/x",
      "javascript:alert(1)",
      "intent://x#Intent;end",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      assert.equal(isSafeLinkUrl(bad), false, String(bad));
    }
  });
});
