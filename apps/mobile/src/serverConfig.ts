// Logic behind Settings > Server settings: what the form shows for each key of the server's
// financer.toml, which edits are pending, what gets sent when you save, and how the app waits
// for the server to restart. No React Native imports, so it runs in plain Node tests.
//
// The server describes the keys (label, kind, range, where the value comes from); this file only
// knows the kinds, so a key added on the server shows up in the app without a new release.

import type { components } from "./api/schema";

export type ConfigView = components["schemas"]["ConfigView"];
export type ConfigGroup = components["schemas"]["GroupView"];
export type ConfigKey = components["schemas"]["KeyView"];
export type ConfigField = components["schemas"]["FieldView"];
export type ConfigChange = components["schemas"]["Change"];
export type ConfigSaved = components["schemas"]["ConfigSaved"];

/** One entry of a table key (an account, a store name, a sender) as the form edits it. */
export type Row = Record<string, string | boolean | string[]>;

/** What a form control holds: text and numbers as text, a toggle as a boolean, lists as lists. */
export type EditorValue = string | boolean | string[] | Row[];

/** The edits not saved yet: values by key, and keys whose value from the app is dropped. */
export type Draft = { set: Record<string, EditorValue | null>; reset: string[] };

export const EMPTY_DRAFT: Draft = { set: {}, reset: [] };

/** What a table's entries are called, for "Add account" and "Remove account". */
const ENTRY_NOUN: Record<string, string> = {
  "bank.accounts": "account",
  stores: "store name",
  "receipts.email.senders": "sender",
};

export function entryNoun(key: Pick<ConfigKey, "path">): string {
  return ENTRY_NOUN[key.path] ?? "entry";
}

/** "Account 2: Giro" for the heading of a table entry (the first column names it when it has a value). */
export function entryTitle(key: Pick<ConfigKey, "path" | "fields">, row: Row, index: number): string {
  const noun = entryNoun(key);
  const first = key.fields[0] ? row[key.fields[0].key] : "";
  const name = typeof first === "string" ? first.trim() : "";
  return `${noun[0].toUpperCase()}${noun.slice(1)} ${index + 1}${name ? `: ${name}` : ""}`;
}

// ---------------------------------------------------------------- reading a key

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim() !== "") return [v];
  return [];
}

/** The default of a column, as a choice's starting value. */
function fieldDefault(f: ConfigField): string {
  return f.default ?? f.options[0] ?? "";
}

/** One table entry from the server, as text fields and lists. */
export function rowFromServer(key: ConfigKey, raw: unknown): Row {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const row: Row = {};
  for (const f of key.fields) {
    const v = obj[f.key];
    if (f.kind === "list") row[f.key] = asStrings(v);
    else if (f.kind === "toggle") row[f.key] = v === undefined || v === null ? f.default === "on" : v === true;
    else if (f.kind === "choice") row[f.key] = typeof v === "string" && v !== "" ? v : fieldDefault(f);
    else row[f.key] = v === undefined || v === null ? "" : String(v);
  }
  return row;
}

/** A new, empty entry; a choice starts on its default (an account on FinTS). */
export function emptyRow(key: ConfigKey): Row {
  return rowFromServer(key, {});
}

/** The value the server has now, in the shape the form edits. */
export function serverValue(key: ConfigKey): EditorValue {
  const v = key.value;
  switch (key.kind) {
    case "secret":
      return "";
    case "toggle":
      return v === undefined || v === null ? key.default === "on" : v === true;
    case "choice":
      return typeof v === "string" && v !== "" ? v : (key.default ?? key.options[0] ?? "");
    case "list":
      return asStrings(v);
    case "table":
      return Array.isArray(v) ? v.map((r) => rowFromServer(key, r)) : [];
    default:
      return v === undefined || v === null ? "" : String(v);
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What the form shows for a key: the pending edit if there is one, else what the server has. */
export function editorValue(key: ConfigKey, draft: Draft): EditorValue {
  if (key.path in draft.set) {
    const pending = draft.set[key.path];
    return pending === null ? (key.kind === "secret" ? "" : serverValue(key)) : pending;
  }
  return serverValue(key);
}

// ---------------------------------------------------------------- editing

/** The draft with this key set to `value`; setting it back to what the server has drops the edit. */
export function setValue(draft: Draft, key: ConfigKey, value: EditorValue): Draft {
  const set = { ...draft.set };
  if (key.kind !== "secret" && same(value, serverValue(key))) delete set[key.path];
  else if (key.kind === "secret" && value === "") delete set[key.path];
  else set[key.path] = value;
  return { set, reset: draft.reset.filter((p) => p !== key.path) };
}

/** Clear a secret (the server forgets it). */
export function clearSecret(draft: Draft, key: ConfigKey): Draft {
  return { set: { ...draft.set, [key.path]: null }, reset: draft.reset.filter((p) => p !== key.path) };
}

/** Drop the value set from the app so the file's, or the default, applies again. */
export function resetKey(draft: Draft, key: ConfigKey): Draft {
  const set = { ...draft.set };
  delete set[key.path];
  return { set, reset: key.source === "app" && !draft.reset.includes(key.path) ? [...draft.reset, key.path] : draft.reset };
}

/** Undo an edit or a reset of one key. */
export function discardKey(draft: Draft, key: ConfigKey): Draft {
  const set = { ...draft.set };
  delete set[key.path];
  return { set, reset: draft.reset.filter((p) => p !== key.path) };
}

export function isDirty(key: Pick<ConfigKey, "path">, draft: Draft): boolean {
  return key.path in draft.set || draft.reset.includes(key.path);
}

export function changeCount(draft: Draft): number {
  return Object.keys(draft.set).length + draft.reset.length;
}

/** Whether this key can be edited here: not while an environment variable decides it. */
export function editable(key: ConfigKey): boolean {
  return !key.locked;
}

// ---------------------------------------------------------------- what is sent

/**
 * Whether a column applies to this entry (a FinTS column of a Plaid account does not). A column can
 * apply to several values of the other one, written as a comma-separated list.
 */
export function fieldVisible(key: ConfigKey, field: ConfigField, row: Row): boolean {
  if (!field.when_field) return true;
  const other = key.fields.find((f) => f.key === field.when_field);
  const actual = String(row[field.when_field] ?? (other ? fieldDefault(other) : ""));
  return (field.when_value ?? "").split(",").some((v) => v.trim() === actual);
}

function blank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

function wireScalar(f: Pick<ConfigField, "kind">, v: unknown): unknown {
  if (f.kind === "toggle") return v === true ? true : null; // off is the default, so it is left out
  if (blank(v)) return null;
  if (f.kind === "number") return Number(String(v).trim());
  if (f.kind === "list") return asStrings(v).map((s) => s.trim()).filter((s) => s !== "");
  return typeof v === "string" ? v.trim() : v;
}

/** One entry as the server wants it: only the columns that apply and have a value. */
export function rowToWire(key: ConfigKey, row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of key.fields) {
    if (!fieldVisible(key, f, row)) continue;
    const v = wireScalar(f, row[f.key]);
    if (v !== null && !(Array.isArray(v) && v.length === 0)) out[f.key] = v;
  }
  return out;
}

/** The value to send for an edited key; `null` clears it. */
export function wireValue(key: ConfigKey, value: EditorValue | null): unknown {
  if (value === null) return null;
  switch (key.kind) {
    case "toggle":
      return value === true;
    case "table": {
      const rows = (value as Row[]).map((r) => rowToWire(key, r));
      return rows.length === 0 ? null : rows;
    }
    case "list": {
      const list = wireScalar(key, value) as string[] | null;
      return list && list.length > 0 ? list : null;
    }
    default:
      return wireScalar(key, value);
  }
}

/** The request body for saving the draft. */
export function toChange(view: ConfigView, draft: Draft): ConfigChange {
  const keys = new Map(view.groups.flatMap((g) => g.keys).map((k) => [k.path, k]));
  const set: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(draft.set)) {
    const key = keys.get(path);
    if (key) set[path] = wireValue(key, value);
  }
  return { set, reset: draft.reset.filter((p) => keys.has(p)) };
}

// ---------------------------------------------------------------- checking before saving

function numberProblem(label: string, v: unknown, min: number | null | undefined, max: number | null | undefined): string | null {
  if (blank(v)) return null;
  const text = String(v).trim();
  if (!/^-?\d+$/.test(text)) return `${label}: enter a whole number`;
  const n = Number(text);
  if (min != null && n < min) return `${label}: at least ${min}`;
  if (max != null && n > max) return `${label}: at most ${max}`;
  return null;
}

/** What is wrong with the edit of a key, in a few words; null when it is fine. The server checks again. */
export function problemFor(key: ConfigKey, value: EditorValue | null): string | null {
  if (value === null) return null;
  if (key.kind === "number") return numberProblem(key.label, value, key.min, key.max);
  if (key.kind === "choice" && typeof value === "string" && value !== "" && !key.options.includes(value)) {
    return `${key.label}: choose one of ${key.options.join(", ")}`;
  }
  if (key.kind === "table") {
    for (const [i, row] of (value as Row[]).entries()) {
      for (const f of key.fields) {
        if (!fieldVisible(key, f, row)) continue;
        const v = row[f.key];
        const where = entryTitle({ path: key.path, fields: [] }, row, i);
        if (f.required && blank(v)) return `${where}: ${f.label} is needed`;
        if (f.kind === "number") {
          const p = numberProblem(f.label, v, f.min, f.max);
          if (p) return `${where}: ${p}`;
        }
      }
    }
  }
  return null;
}

/** Problems with all pending edits, by key. */
export function draftProblems(view: ConfigView, draft: Draft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of view.groups.flatMap((g) => g.keys)) {
    if (!(key.path in draft.set)) continue;
    const p = problemFor(key, draft.set[key.path]);
    if (p) out[key.path] = p;
  }
  return out;
}

/** The warnings of the keys being changed (the listen address, the token, the database). */
export function warningsFor(view: ConfigView, draft: Draft): { label: string; warning: string }[] {
  return view.groups
    .flatMap((g) => g.keys)
    .filter((k) => k.warning && isDirty(k, draft))
    .map((k) => ({ label: k.label, warning: k.warning as string }));
}

/** The new API token typed into the form, if there is one. The app then switches to it after the restart. */
export function newToken(draft: Draft): string | null {
  const v = draft.set["auth.api_token"];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// ---------------------------------------------------------------- words

/** Where the value of a key comes from, in plain words. */
export function sourceLabel(key: ConfigKey): string {
  switch (key.source) {
    case "env":
      return `Set by ${key.env ?? "an environment variable"} on the server`;
    case "app":
      return key.is_set ? "Set in the app" : "Cleared in the app";
    case "file":
      return "From financer.toml";
    default:
      return key.default ? `Default: ${key.default}` : "Not set";
  }
}

export type SourceTone = "locked" | "app" | "file" | "default";

export function sourceTone(key: ConfigKey): SourceTone {
  if (key.locked) return "locked";
  return key.source === "app" ? "app" : key.source === "file" ? "file" : "default";
}

/** A few words for the value of a key, when it is shown without its editor. */
export function valueSummary(key: ConfigKey): string {
  if (!key.is_set) return key.default && key.kind !== "secret" ? key.default : "Not set";
  switch (key.kind) {
    case "secret":
      return key.preview ?? "Set";
    case "toggle":
      return key.value === true ? "On" : "Off";
    case "list":
      return asStrings(key.value).join(", ");
    case "table": {
      const n = Array.isArray(key.value) ? key.value.length : 0;
      return `${n} ${n === 1 ? entryNoun(key) : n === 0 ? `${entryNoun(key)}s` : `${entryNoun(key)}s`}`;
    }
    default:
      return String(key.value ?? "");
  }
}

/** "3 of 7 set", and how many of them you changed. */
export function groupSummary(group: ConfigGroup, draft: Draft): string {
  const set = group.keys.filter((k) => k.is_set).length;
  const changed = group.keys.filter((k) => isDirty(k, draft)).length;
  const base = set === 0 ? "Nothing set" : `${set} of ${group.keys.length} set`;
  return changed > 0 ? `${base}, ${changed} changed` : base;
}

/** The one line the save button area says. */
export function saveSummary(draft: Draft): string {
  const n = changeCount(draft);
  return n === 1 ? "1 change not saved" : `${n} changes not saved`;
}

export function savedText(saved: ConfigSaved): string {
  if (!saved.restarting) return "Nothing needed changing.";
  const n = saved.changed.length;
  return `${n === 1 ? "1 setting" : `${n} settings`} saved. The server is restarting to use ${n === 1 ? "it" : "them"}.`;
}

// ---------------------------------------------------------------- waiting for the restart

export type PollResult = { view: ConfigView; token: string };

export type RestartOutcome =
  | { kind: "applied"; view: ConfigView; token: string }
  | { kind: "rolled_back"; view: ConfigView; token: string }
  | { kind: "timeout" };

/**
 * After a change was saved: ask the server again and again until it has restarted. `poll` resolves
 * with the view and the token that worked, or rejects while the server is down (or does not know
 * the token yet). The old process answers until it restarts, with `applying` still true.
 */
export async function waitForRestart(
  poll: () => Promise<PollResult>,
  sleep: (ms: number) => Promise<void>,
  opts: { intervalMs?: number; attempts?: number } = {},
): Promise<RestartOutcome> {
  const interval = opts.intervalMs ?? 1000;
  const attempts = opts.attempts ?? 60;
  for (let i = 0; i < attempts; i++) {
    await sleep(interval);
    let result: PollResult;
    try {
      result = await poll();
    } catch {
      continue;
    }
    if (result.view.applying) continue;
    return { kind: result.view.state === "rolled_back" ? "rolled_back" : "applied", view: result.view, token: result.token };
  }
  return { kind: "timeout" };
}

/** What to say when the server did not come back. */
export function timeoutText(changedListenAddress: boolean): string {
  return changedListenAddress
    ? "The server did not answer at the old address. If you changed where it listens, set the new address under Settings > Backend."
    : "The server did not come back within a minute. Check that it is running, then open this screen again.";
}
