import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api, type BankConnection } from "../src/api/client";
import { RemoteTransport } from "../src/api/transport";
import {
  anyBusy,
  approvalLeftText,
  canSync,
  connectionKey,
  formatStamp,
  isBusy,
  lastResultText,
  needsTypedPin,
  nextSyncText,
  stateLabel,
  stateTone,
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
    assert.equal(calls[0].url, "https://x.test/v1/bank/connections");
    assert.equal(calls[1].url, "https://x.test/v1/bank/connections/Giro%20Konto/sync");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[1].body, '{"pin":"1234"}');
    assert.equal(calls[2].body, undefined); // the server has the PIN: nothing is sent
    assert.equal(calls[3].url, "https://x.test/v1/bank/connections/Giro%20Konto/cancel");
  });
});
