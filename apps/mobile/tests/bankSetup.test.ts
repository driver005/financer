import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BankConnection } from "../src/api/client";
import {
  SOURCES,
  connectionsOf,
  defaultSource,
  needsSetup,
  panelActionLabel,
  setupBlocked,
  setupChange,
  setupDefaults,
  setupFields,
  setupProblems,
  sourceStatus,
} from "../src/bankSetup";
import { isSafeLinkUrl, linksOnce, providerLabel } from "../src/bankConnections";
import type { ConfigField, ConfigKey, ConfigView } from "../src/serverConfig";

function conn(over: Partial<BankConnection> = {}): BankConnection {
  return {
    name: "Giro",
    kind: "gocardless",
    bank_code: "",
    login_masked: "",
    iban_masked: "",
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

function field(over: Partial<ConfigField> = {}): ConfigField {
  return { key: "name", label: "Name", help: "", kind: "text", options: [], required: false, ...over };
}

function key(path: string, over: Partial<ConfigKey> = {}): ConfigKey {
  return { path, label: path, help: "", kind: "secret", options: [], fields: [], source: "default", locked: false, is_set: false, ...over };
}

const ACCOUNT_FIELDS: ConfigField[] = [
  field({ key: "name", required: true }),
  field({ key: "kind", kind: "choice", options: ["fints", "plaid", "gocardless", "finapi"], default: "fints" }),
  field({ key: "institution", when_field: "kind", when_value: "gocardless" }),
  field({ key: "sync_every_hours", kind: "number", default: "0" }),
];

function view(over: { have?: string[]; locked?: string[]; accounts?: unknown[]; accountsLocked?: boolean; writable?: boolean } = {}): ConfigView {
  const have = new Set(over.have ?? []);
  const lock = new Set(over.locked ?? []);
  const secret = (path: string) => key(path, { is_set: have.has(path), locked: lock.has(path) });
  const keys: ConfigKey[] = [
    secret("bank.gocardless.secret_id"),
    secret("bank.gocardless.secret_key"),
    secret("bank.plaid.client_id"),
    secret("bank.plaid.secret"),
    key("bank.plaid.environment", { kind: "choice", options: ["sandbox", "production"], default: "sandbox", is_set: true }),
    secret("bank.finapi.client_id"),
    secret("bank.finapi.client_secret"),
    key("bank.finapi.environment", { kind: "choice", options: ["sandbox", "live"], default: "sandbox", is_set: true }),
    key("bank.accounts", { kind: "table", fields: ACCOUNT_FIELDS, value: over.accounts ?? [], is_set: (over.accounts ?? []).length > 0, locked: over.accountsLocked ?? false }),
  ];
  return {
    settings_file: "/data/financer.settings.json",
    writable: over.writable ?? true,
    applying: false,
    state: "ok",
    problems: [],
    warnings: [],
    groups: [{ id: "bank", title: "Bank", hint: "", icon: "bank", keys }],
  };
}

describe("the sources", () => {
  it("lists CSV first and every provider once", () => {
    assert.deepEqual(SOURCES.map((s) => s.id), ["csv", "fints", "gocardless", "plaid", "finapi"]);
  });

  it("offers the setup only while no connection exists", () => {
    assert.equal(needsSetup([]), true);
    assert.equal(needsSetup([conn()]), false);
  });

  it("picks the connections of a source by kind", () => {
    const list = [conn({ name: "A", kind: "plaid" }), conn({ name: "B", kind: "gocardless" }), conn({ name: "C", kind: "gocardless" })];
    assert.deepEqual(connectionsOf(list, "gocardless").map((c) => c.name), ["B", "C"]);
    assert.deepEqual(connectionsOf(list, "csv"), []);
  });

  it("says in a few words where each source stands", () => {
    assert.equal(sourceStatus([], "csv"), "Always available");
    assert.equal(sourceStatus([], "plaid"), "Not set up");
    assert.equal(sourceStatus([conn({ linked: false })], "gocardless"), "Not connected yet");
    assert.equal(sourceStatus([conn()], "gocardless"), "Connected");
    assert.equal(sourceStatus([conn(), conn({ name: "B" })], "gocardless"), "2 connected");
    assert.equal(sourceStatus([conn(), conn({ name: "B", linked: false })], "gocardless"), "1 of 2 connected");
    assert.equal(sourceStatus([conn({ state: "needs_link" })], "gocardless"), "Sign in to your bank");
    assert.equal(sourceStatus([conn({ state: "syncing" })], "gocardless"), "Syncing");
  });

  it("opens on CSV without connections, else on the source synced last", () => {
    assert.equal(defaultSource([]), "csv");
    assert.equal(defaultSource([conn({ kind: "plaid", name: "P" }), conn({ kind: "finapi", name: "F" })]), "plaid");
    assert.equal(defaultSource([conn({ kind: "plaid", name: "P", last_sync_at: 100 }), conn({ kind: "finapi", name: "F", last_sync_at: 200 })]), "finapi");
  });

  it("words the main button of a panel", () => {
    assert.equal(panelActionLabel(conn({ linked: false }), false), "Connect via GoCardless");
    assert.equal(panelActionLabel(conn({ linked: false, kind: "finapi" }), false), "Connect via finAPI");
    assert.equal(panelActionLabel(conn(), false), "Sync now");
    assert.equal(panelActionLabel(conn({ linked: false }), true), "Opening…");
    assert.equal(panelActionLabel(conn(), true), "Starting…");
  });
});

describe("providers in the connection helpers", () => {
  it("treats Plaid, GoCardless and finAPI alike and FinTS apart", () => {
    for (const kind of ["plaid", "gocardless", "finapi"]) assert.equal(linksOnce({ kind }), true, kind);
    assert.equal(linksOnce({ kind: "fints" }), false);
    assert.equal(providerLabel({ kind: "gocardless" }), "GoCardless");
    assert.equal(providerLabel({ kind: "finapi" }), "finAPI");
  });

  it("opens the sign-in pages of the three providers and nothing else", () => {
    assert.equal(isSafeLinkUrl("https://ob.gocardless.com/psd2/start/x/Y"), true);
    assert.equal(isSafeLinkUrl("https://webform-sandbox.finapi.io/wf/abc"), true);
    assert.equal(isSafeLinkUrl("https://secure.plaid.com/hl/abc"), true);
    for (const bad of ["http://ob.gocardless.com/x", "https://gocardless.com.evil.example/x", "https://evilfinapi.io/x", "javascript:alert(1)", ""]) {
      assert.equal(isSafeLinkUrl(bad), false, bad);
    }
  });
});

describe("the guided setup", () => {
  it("asks GoCardless for a name, the bank and both keys", () => {
    const f = setupFields(view(), "gocardless");
    assert.deepEqual(f.map((x) => x.id), ["name", "institution", "secret_id", "secret_key"]);
    assert.equal(f.find((x) => x.id === "secret_key")?.secret, true);
  });

  it("asks finAPI and Plaid for their keys and the environment, and neither for a bank", () => {
    assert.deepEqual(setupFields(view(), "finapi").map((x) => x.id), ["name", "client_id", "client_secret", "environment"]);
    assert.deepEqual(setupFields(view(), "plaid").map((x) => x.id), ["name", "client_id", "secret", "environment"]);
  });

  it("does not ask again for keys the server has, or that an environment variable decides", () => {
    const have = view({ have: ["bank.plaid.client_id", "bank.plaid.secret"] });
    assert.deepEqual(setupFields(have, "plaid").map((x) => x.id), ["name"]);
    const locked = view({ have: ["bank.finapi.client_id"], locked: ["bank.finapi.client_secret"] });
    assert.deepEqual(setupFields(locked, "finapi").map((x) => x.id), ["name", "environment"]);
  });

  it("has nothing to set up for CSV and FinTS", () => {
    assert.deepEqual(setupFields(view(), "csv"), []);
    assert.deepEqual(setupFields(view(), "fints"), []);
    assert.equal(setupBlocked(view(), "csv"), null);
  });

  it("starts the environment on sandbox", () => {
    const d = setupDefaults(setupFields(view(), "finapi"));
    assert.equal(d.environment, "sandbox");
    assert.equal(d.name, "");
  });

  it("names what is missing", () => {
    const p = setupProblems(view(), "gocardless", setupDefaults(setupFields(view(), "gocardless")));
    assert.deepEqual(Object.keys(p).sort(), ["institution", "name", "secret_id", "secret_key"]);
    assert.match(p.secret_id, /needed/);
  });

  it("refuses a name that is taken (any case) and a bad institution id", () => {
    const v = view({ accounts: [{ name: "Giro", kind: "plaid" }] });
    const values = { ...setupDefaults(setupFields(v, "gocardless")), name: "giro", institution: "bad id!", secret_id: "a", secret_key: "b" };
    const p = setupProblems(v, "gocardless", values);
    assert.match(p.name, /exists already/);
    assert.match(p.institution, /Letters/);
  });

  it("builds the change: the keys, and the new account added to the existing ones", () => {
    const v = view({ accounts: [{ name: "Sparkasse", kind: "fints", bank_code: "37050198", sync_every_hours: 0 }] });
    const change = setupChange(v, "gocardless", { name: " Girokonto ", institution: "SPARKASSE_X", secret_id: " id ", secret_key: "key" });
    assert.deepEqual(change.reset, []);
    const set = change.set ?? {};
    assert.equal(set["bank.gocardless.secret_id"], "id");
    assert.equal(set["bank.gocardless.secret_key"], "key");
    const rows = (change.set ?? {})["bank.accounts"] as Record<string, unknown>[];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, "Sparkasse");
    assert.equal(rows[1].name, "Girokonto");
    assert.equal(rows[1].kind, "gocardless");
    assert.equal(rows[1].institution, "SPARKASSE_X");
    assert.equal(rows[1].sync_every_hours, 12);
  });

  it("leaves keys the server has out of the change", () => {
    const v = view({ have: ["bank.plaid.client_id", "bank.plaid.secret"] });
    const change = setupChange(v, "plaid", { name: "Plaid Giro" });
    assert.deepEqual(Object.keys(change.set ?? {}), ["bank.accounts"]);
    const rows = (change.set ?? {})["bank.accounts"] as Record<string, unknown>[];
    assert.equal(rows[0].kind, "plaid");
    assert.equal("institution" in rows[0], false);
  });

  it("explains when the app cannot write the setup", () => {
    assert.match(setupBlocked(view({ writable: false }), "plaid") ?? "", /cannot write/);
    assert.match(setupBlocked(view({ accountsLocked: true }), "plaid") ?? "", /environment variable/);
    assert.match(setupBlocked(null, "plaid") ?? "", /Could not read/);
    assert.equal(setupBlocked(view(), "plaid"), null);
  });
});
