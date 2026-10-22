import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_DRAFT,
  changeCount,
  clearSecret,
  draftProblems,
  editable,
  editorValue,
  emptyRow,
  entryTitle,
  fieldVisible,
  groupSummary,
  isDirty,
  newToken,
  problemFor,
  resetKey,
  rowToWire,
  saveSummary,
  savedText,
  serverValue,
  setValue,
  sourceLabel,
  sourceTone,
  timeoutText,
  toChange,
  valueSummary,
  waitForRestart,
  warningsFor,
  wireValue,
  type ConfigField,
  type ConfigKey,
  type ConfigView,
  type Row,
} from "../src/serverConfig";

function key(over: Partial<ConfigKey> = {}): ConfigKey {
  return {
    path: "server.refresh_hours",
    label: "Refresh prices every (hours)",
    help: "",
    kind: "number",
    options: [],
    fields: [],
    source: "default",
    locked: false,
    is_set: false,
    min: 0,
    max: 8784,
    default: "24",
    ...over,
  };
}

function field(over: Partial<ConfigField> = {}): ConfigField {
  return { key: "name", label: "Name", help: "", kind: "text", options: [], required: false, ...over };
}

const ACCOUNT_FIELDS: ConfigField[] = [
  field({ key: "name", label: "Name", required: true }),
  field({ key: "kind", label: "Provider", kind: "choice", options: ["fints", "plaid"], default: "fints" }),
  field({ key: "bank_code", label: "Bank code", required: true, when_field: "kind", when_value: "fints" }),
  field({ key: "account_ids", label: "Accounts to read", kind: "list", when_field: "kind", when_value: "plaid" }),
  field({ key: "sync_every_hours", label: "Sync every (hours)", kind: "number", min: 0, max: 8784, default: "0" }),
];

function accounts(value?: unknown, over: Partial<ConfigKey> = {}): ConfigKey {
  return key({ path: "bank.accounts", label: "Accounts", kind: "table", fields: ACCOUNT_FIELDS, default: undefined, value, ...over });
}

function view(keys: ConfigKey[], over: Partial<ConfigView> = {}): ConfigView {
  return {
    settings_file: "/data/financer.settings.json",
    writable: true,
    applying: false,
    state: "ok",
    problems: [],
    warnings: [],
    groups: [{ id: "g", title: "G", hint: "", icon: "cog", keys }],
    ...over,
  };
}

describe("reading a key for the form", () => {
  it("shows numbers and text as text, toggles as booleans, choices with their default", () => {
    assert.equal(serverValue(key({ value: 6, is_set: true, source: "app" })), "6");
    assert.equal(serverValue(key()), "");
    assert.equal(serverValue(key({ kind: "text", value: "0.0.0.0:80" })), "0.0.0.0:80");
    assert.equal(serverValue(key({ kind: "toggle", default: "on" })), true);
    assert.equal(serverValue(key({ kind: "toggle", default: "off" })), false);
    assert.equal(serverValue(key({ kind: "toggle", default: "on", value: false })), false);
    const choice = key({ kind: "choice", options: ["claude", "openai"], default: "claude" });
    assert.equal(serverValue(choice), "claude");
    assert.equal(serverValue({ ...choice, value: "openai" }), "openai");
  });

  it("never shows a secret", () => {
    assert.equal(serverValue(key({ kind: "secret", is_set: true, value: "leaked?" })), "");
  });

  it("turns a list, or a text written for a list, into a list", () => {
    assert.deepEqual(serverValue(key({ kind: "list", value: ["a", "b"] })), ["a", "b"]);
    assert.deepEqual(serverValue(key({ kind: "list", value: "solo" })), ["solo"]);
    assert.deepEqual(serverValue(key({ kind: "list" })), []);
  });

  it("turns table entries into rows with every column", () => {
    const rows = serverValue(accounts([{ name: "Giro", kind: "plaid", sync_every_hours: 12, account_ids: ["a1"] }])) as Row[];
    assert.deepEqual(rows, [{ name: "Giro", kind: "plaid", bank_code: "", account_ids: ["a1"], sync_every_hours: "12" }]);
    assert.deepEqual(emptyRow(accounts()), { name: "", kind: "fints", bank_code: "", account_ids: [], sync_every_hours: "" });
  });
});

describe("editing", () => {
  it("keeps an edit until it is set back to what the server has", () => {
    const k = key({ value: 6, is_set: true, source: "app" });
    let d = setValue(EMPTY_DRAFT, k, "12");
    assert.equal(editorValue(k, d), "12");
    assert.equal(isDirty(k, d), true);
    assert.equal(changeCount(d), 1);
    d = setValue(d, k, "6");
    assert.equal(isDirty(k, d), false);
    assert.equal(changeCount(d), 0);
  });

  it("treats a typed secret as an edit and an empty one as no edit", () => {
    const k = key({ path: "llm.openai_api_key", kind: "secret", is_set: true });
    const d = setValue(EMPTY_DRAFT, k, "sk-new");
    assert.equal(editorValue(k, d), "sk-new");
    assert.equal(changeCount(setValue(d, k, "")), 0);
    const cleared = clearSecret(EMPTY_DRAFT, k);
    assert.equal(isDirty(k, cleared), true);
    assert.equal(editorValue(k, cleared), "");
    assert.equal(toChange(view([k]), cleared).set?.["llm.openai_api_key"], null);
  });

  it("resets only what was set from the app, and an edit and a reset do not coexist", () => {
    const fromApp = key({ source: "app", is_set: true, value: 6 });
    const fromFile = key({ source: "file", is_set: true, value: 6 });
    const d = resetKey(EMPTY_DRAFT, fromApp);
    assert.deepEqual(d.reset, ["server.refresh_hours"]);
    assert.deepEqual(resetKey(EMPTY_DRAFT, fromFile).reset, []);
    const edited = setValue(d, fromApp, "9");
    assert.deepEqual(edited.reset, []);
    assert.deepEqual(resetKey(edited, fromApp).set, {});
  });

  it("cannot change a key the environment decides", () => {
    assert.equal(editable(key({ locked: true, source: "env", env: "FINANCER_BIND" })), false);
    assert.equal(editable(key()), true);
  });
});

describe("what is sent", () => {
  it("sends numbers as numbers and an empty field as a clear", () => {
    const k = key();
    assert.equal(wireValue(k, "12"), 12);
    assert.equal(wireValue(k, " 12 "), 12);
    assert.equal(wireValue(k, ""), null);
    assert.equal(wireValue(key({ kind: "toggle" }), true), true);
    assert.equal(wireValue(key({ kind: "text" }), "  x "), "x");
    assert.equal(wireValue(key({ kind: "text" }), "   "), null);
    assert.deepEqual(wireValue(key({ kind: "list" }), ["a", " ", " b "]), ["a", "b"]);
    assert.equal(wireValue(key({ kind: "list" }), ["", " "]), null);
  });

  it("sends only the columns that apply to an entry", () => {
    const k = accounts();
    const plaid: Row = { name: " Plaid ", kind: "plaid", bank_code: "123", account_ids: ["a1", ""], sync_every_hours: "6" };
    assert.deepEqual(rowToWire(k, plaid), { name: "Plaid", kind: "plaid", account_ids: ["a1"], sync_every_hours: 6 });
    const fints: Row = { name: "Giro", kind: "fints", bank_code: "37050198", account_ids: ["x"], sync_every_hours: "" };
    assert.deepEqual(rowToWire(k, fints), { name: "Giro", kind: "fints", bank_code: "37050198" });
    assert.equal(wireValue(k, []), null, "no entries clears the list");
  });

  it("builds the request from the draft, without keys the server does not know", () => {
    const refresh = key({ value: 6, is_set: true, source: "app" });
    const provider = key({ path: "llm.provider", kind: "choice", options: ["claude", "openai"], default: "claude", source: "app", is_set: true, value: "openai" });
    const v = view([refresh, provider]);
    let d = setValue(EMPTY_DRAFT, refresh, "12");
    d = resetKey(d, provider);
    d = { ...d, set: { ...d.set, "gone.key": "x" }, reset: [...d.reset, "gone.too"] };
    assert.deepEqual(toChange(v, d), { set: { "server.refresh_hours": 12 }, reset: ["llm.provider"] });
  });
});

describe("checking before saving", () => {
  it("catches numbers that are not numbers or out of range", () => {
    const k = key();
    assert.equal(problemFor(k, "12"), null);
    assert.equal(problemFor(k, ""), null);
    assert.match(problemFor(k, "12.5") ?? "", /whole number/);
    assert.match(problemFor(k, "abc") ?? "", /whole number/);
    assert.match(problemFor(k, "-1") ?? "", /at least 0/);
    assert.match(problemFor(k, "9000") ?? "", /at most 8784/);
  });

  it("catches a missing column in an entry, but not in a hidden column", () => {
    const k = accounts();
    const ok: Row = { name: "A", kind: "plaid", bank_code: "", account_ids: [], sync_every_hours: "" };
    assert.equal(problemFor(k, [ok]), null, "bank code is a FinTS column");
    assert.match(problemFor(k, [{ ...ok, kind: "fints" }]) ?? "", /Account 1: Bank code is needed/);
    assert.match(problemFor(k, [{ ...ok, name: "" }]) ?? "", /Account 1: Name is needed/);
    assert.match(problemFor(k, [ok, { ...ok, sync_every_hours: "x" }]) ?? "", /Account 2: Sync every \(hours\): enter a whole number/);
  });

  it("lists the problems of a draft by key", () => {
    const k = key();
    const v = view([k]);
    const d = setValue(EMPTY_DRAFT, k, "99999");
    assert.deepEqual(Object.keys(draftProblems(v, d)), ["server.refresh_hours"]);
    assert.deepEqual(draftProblems(v, EMPTY_DRAFT), {});
  });

  it("repeats the warnings of the keys you changed", () => {
    const bind = key({ path: "server.bind", kind: "text", label: "Listen address", warning: "May lock this app out" });
    const hours = key();
    const v = view([bind, hours]);
    assert.deepEqual(warningsFor(v, EMPTY_DRAFT), []);
    assert.deepEqual(warningsFor(v, setValue(EMPTY_DRAFT, hours, "5")), []);
    assert.deepEqual(warningsFor(v, setValue(EMPTY_DRAFT, bind, "0.0.0.0:9")), [{ label: "Listen address", warning: "May lock this app out" }]);
  });

  it("finds a new token", () => {
    const tok = key({ path: "auth.api_token", kind: "secret" });
    assert.equal(newToken(EMPTY_DRAFT), null);
    assert.equal(newToken(setValue(EMPTY_DRAFT, tok, " abc ")), "abc");
    assert.equal(newToken(clearSecret(EMPTY_DRAFT, tok)), null);
  });
});

describe("entry headings", () => {
  it("name the entry by its first column when it has one", () => {
    const k = accounts();
    assert.equal(entryTitle(k, { name: " Giro " }, 0), "Account 1: Giro");
    assert.equal(entryTitle(k, { name: "" }, 1), "Account 2");
    assert.equal(entryTitle(key({ path: "stores", kind: "table", fields: [field({ key: "chain" })] }), { chain: "edeka" }, 0), "Store name 1: edeka");
    assert.equal(entryTitle(key({ path: "other", kind: "table", fields: [] }), {}, 2), "Entry 3");
  });
});

describe("price sources", () => {
  const SOURCE_FIELDS: ConfigField[] = [
    field({ key: "type", label: "Kind of source", kind: "choice", options: ["json_ld", "llm_page", "open_prices"], default: "json_ld" }),
    field({ key: "chain", label: "Shop", kind: "choice", options: ["rewe", "lidl"], default: "rewe", when_field: "type", when_value: "json_ld,llm_page" }),
    field({ key: "urls", label: "Pages", kind: "list", required: true, when_field: "type", when_value: "json_ld,llm_page" }),
    field({ key: "is_offer", label: "These are offers", kind: "toggle", when_field: "type", when_value: "json_ld,llm_page" }),
    field({ key: "items", label: "Items", kind: "list", required: true, when_field: "type", when_value: "open_prices" }),
    field({ key: "max_age_days", label: "Ignore prices older than (days)", kind: "number", min: 1, max: 365, default: "60", when_field: "type", when_value: "open_prices" }),
  ];
  const sources = (value?: unknown) => key({ path: "prices.sources", label: "Price sources", kind: "table", fields: SOURCE_FIELDS, default: undefined, value });

  it("shows a column for each of several values of the kind", () => {
    const k = sources();
    const [, chain, urls, , items, maxAge] = SOURCE_FIELDS;
    for (const type of ["json_ld", "llm_page"]) {
      assert.equal(fieldVisible(k, chain, { type }), true, type);
      assert.equal(fieldVisible(k, items, { type }), false, type);
    }
    assert.equal(fieldVisible(k, items, { type: "open_prices" }), true);
    assert.equal(fieldVisible(k, urls, { type: "open_prices" }), false);
    assert.equal(fieldVisible(k, maxAge, {}), false, "json_ld is the default kind");
    assert.equal(fieldVisible(k, urls, {}), true);
  });

  it("reads a toggle and sends it only when it is on", () => {
    const k = sources();
    const rows = serverValue(sources([{ type: "llm_page", chain: "rewe", urls: ["https://x"], is_offer: true }])) as Row[];
    assert.equal(rows[0].is_offer, true);
    assert.equal((serverValue(sources([{ type: "json_ld", urls: [] }])) as Row[])[0].is_offer, false);
    const row: Row = { type: "json_ld", chain: "rewe", urls: ["https://x", ""], is_offer: true, items: ["a=b"], max_age_days: "30" };
    assert.deepEqual(rowToWire(k, row), { type: "json_ld", chain: "rewe", urls: ["https://x"], is_offer: true });
    assert.deepEqual(rowToWire(k, { ...row, is_offer: false }), { type: "json_ld", chain: "rewe", urls: ["https://x"] });
    assert.deepEqual(rowToWire(k, { ...row, type: "open_prices", items: ["milch=4012345678901"] }), { type: "open_prices", items: ["milch=4012345678901"], max_age_days: 30 });
  });

  it("asks for the pages of a page source and the items of a price source, not the other way round", () => {
    const k = sources();
    const open: Row = { type: "open_prices", chain: "rewe", urls: [], is_offer: false, items: [], max_age_days: "" };
    assert.match(problemFor(k, [open]) ?? "", /Entry 1: Items is needed/);
    assert.equal(problemFor(k, [{ ...open, items: ["milch=4012345678901"] }]), null);
    assert.match(problemFor(k, [{ ...open, type: "json_ld" }]) ?? "", /Entry 1: Pages is needed/);
  });
});

describe("fields that depend on another field", () => {
  it("show a FinTS column only for FinTS, using the default while nothing is chosen", () => {
    const k = accounts();
    const bank = ACCOUNT_FIELDS[2];
    assert.equal(fieldVisible(k, bank, { kind: "fints" }), true);
    assert.equal(fieldVisible(k, bank, { kind: "plaid" }), false);
    assert.equal(fieldVisible(k, bank, {}), true, "FinTS is the default");
    assert.equal(fieldVisible(k, ACCOUNT_FIELDS[0], { kind: "plaid" }), true);
  });
});

describe("words", () => {
  it("says where a value comes from", () => {
    assert.equal(sourceLabel(key({ source: "env", locked: true, env: "FINANCER_BIND" })), "Set by FINANCER_BIND on the server");
    assert.equal(sourceLabel(key({ source: "app", is_set: true })), "Set in the app");
    assert.equal(sourceLabel(key({ source: "app", is_set: false })), "Cleared in the app");
    assert.equal(sourceLabel(key({ source: "file" })), "From financer.toml");
    assert.equal(sourceLabel(key()), "Default: 24");
    assert.equal(sourceLabel(key({ default: undefined })), "Not set");
    assert.equal(sourceTone(key({ locked: true, source: "env" })), "locked");
    assert.equal(sourceTone(key({ source: "app" })), "app");
    assert.equal(sourceTone(key({ source: "file" })), "file");
    assert.equal(sourceTone(key()), "default");
  });

  it("summarises a value", () => {
    assert.equal(valueSummary(key()), "24");
    assert.equal(valueSummary(key({ default: undefined })), "Not set");
    assert.equal(valueSummary(key({ is_set: true, value: 6 })), "6");
    assert.equal(valueSummary(key({ kind: "secret", is_set: true })), "Set");
    assert.equal(valueSummary(key({ kind: "secret", is_set: true, preview: "postgres://me:<hidden>@h/db" })), "postgres://me:<hidden>@h/db");
    assert.equal(valueSummary(key({ kind: "secret", default: "x" })), "Not set");
    assert.equal(valueSummary(key({ kind: "toggle", is_set: true, value: true })), "On");
    assert.equal(valueSummary(key({ kind: "list", is_set: true, value: ["a", "b"] })), "a, b");
    assert.equal(valueSummary(accounts([{}, {}], { is_set: true })), "2 accounts");
    assert.equal(valueSummary(accounts([{}], { is_set: true })), "1 account");
  });

  it("counts what is set and what you changed in a group", () => {
    const a = key({ is_set: true, value: 1 });
    const b = key({ path: "b", is_set: false });
    const group = view([a, b]).groups[0];
    assert.equal(groupSummary(group, EMPTY_DRAFT), "1 of 2 set");
    assert.equal(groupSummary(group, setValue(EMPTY_DRAFT, b, "5")), "1 of 2 set, 1 changed");
    assert.equal(groupSummary(view([b]).groups[0], EMPTY_DRAFT), "Nothing set");
    assert.equal(saveSummary(setValue(EMPTY_DRAFT, b, "5")), "1 change not saved");
    assert.equal(saveSummary(setValue(setValue(EMPTY_DRAFT, b, "5"), a, "9")), "2 changes not saved");
  });

  it("says what a save did", () => {
    assert.match(savedText({ changed: ["a"], warnings: [], restarting: true }), /1 setting saved.*restarting to use it/);
    assert.match(savedText({ changed: ["a", "b"], warnings: [], restarting: true }), /2 settings saved.*use them/);
    assert.equal(savedText({ changed: [], warnings: [], restarting: false }), "Nothing needed changing.");
    assert.match(timeoutText(true), /Settings > Backend/);
    assert.match(timeoutText(false), /within a minute/);
  });
});

describe("waiting for the restart", () => {
  const sleep = async () => {};
  const ok = (over: Partial<ConfigView> = {}) => view([], over);

  it("keeps asking while the server is down or still the old one, then reports the new one", async () => {
    const answers: (() => Promise<{ view: ConfigView; token: string }>)[] = [
      () => Promise.resolve({ view: ok({ applying: true }), token: "t" }), // the old process, not yet restarted
      () => Promise.reject(new Error("connection refused")), // restarting
      () => Promise.reject(new Error("connection refused")),
      () => Promise.resolve({ view: ok({ applying: false }), token: "t2" }),
    ];
    let i = 0;
    const out = await waitForRestart(() => answers[i++](), sleep, { attempts: 10 });
    assert.deepEqual(out.kind, "applied");
    assert.equal(i, 4);
    if (out.kind === "applied") assert.equal(out.token, "t2");
  });

  it("reports a change that was taken back", async () => {
    const out = await waitForRestart(() => Promise.resolve({ view: ok({ state: "rolled_back", message: "cannot bind" }), token: "old" }), sleep);
    assert.equal(out.kind, "rolled_back");
    if (out.kind === "rolled_back") assert.equal(out.token, "old");
  });

  it("gives up after the attempts", async () => {
    let calls = 0;
    const out = await waitForRestart(() => (calls++, Promise.reject(new Error("down"))), sleep, { attempts: 5 });
    assert.deepEqual(out, { kind: "timeout" });
    assert.equal(calls, 5);
  });
});
