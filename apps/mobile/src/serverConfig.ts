// Logic behind Settings > Server settings: what the form shows for each key of the server's
// financer.toml, which edits are pending, what gets sent when you save, and how the app waits
// for the server to restart. The rules are in Rust (crates/logic, server_config.rs); only the wait
// (a poll and a clock) stays here.
//
// The server describes the keys (label, kind, range, where the value comes from); the rules only
// know the kinds, so a key added on the server shows up in the app without a new release.

import { logic } from "../../../packages/wire/src/logic";
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
export const entryNoun = (key: Pick<ConfigKey, "path">): string => logic("server_config.entry_noun", { path: key.path });

/** "Account 2: Giro" for the heading of a table entry (the first column names it when it has a value). */
export const entryTitle = (key: Pick<ConfigKey, "path" | "fields">, row: Row, index: number): string =>
  logic("server_config.entry_title", { path: key.path, fields: key.fields, row, index });
/** A new, empty entry; a choice starts on its default (an account on FinTS). */
export const emptyRow = (key: ConfigKey): Row => logic("server_config.empty_row", { key });

/** The value the server has now, in the shape the form edits. */
export const serverValue = (key: ConfigKey): EditorValue => logic("server_config.server_value", { key });

/** What the form shows for a key: the pending edit if there is one, else what the server has. */
export const editorValue = (key: ConfigKey, draft: Draft): EditorValue => logic("server_config.editor_value", { key, draft });

/** The draft with this key set to `value`; setting it back to what the server has drops the edit. */
export const setValue = (draft: Draft, key: ConfigKey, value: EditorValue): Draft => logic("server_config.set_value", { draft, key, value });

/** Clear a secret (the server forgets it). */
export const clearSecret = (draft: Draft, key: ConfigKey): Draft => logic("server_config.clear_secret", { draft, key });

/** Drop the value set from the app so the file's, or the default, applies again. */
export const resetKey = (draft: Draft, key: ConfigKey): Draft => logic("server_config.reset_key", { draft, key });

/** Undo an edit or a reset of one key. */
export const discardKey = (draft: Draft, key: ConfigKey): Draft => logic("server_config.discard_key", { draft, key });

export const isDirty = (key: Pick<ConfigKey, "path">, draft: Draft): boolean => logic("server_config.is_dirty", { path: key.path, draft });

export const changeCount = (draft: Draft): number => logic("server_config.change_count", { draft });

/** Whether this key can be edited here: not while an environment variable decides it. */
export const editable = (key: ConfigKey): boolean => logic("server_config.editable", { key });

/** Whether a column applies to this entry (a FinTS column of a Plaid account does not). */
export const fieldVisible = (key: ConfigKey, field: ConfigField, row: Row): boolean =>
  logic("server_config.field_visible", { key, field, row });

/** One entry as the server wants it: only the columns that apply and have a value. */
export const rowToWire = (key: ConfigKey, row: Row): Record<string, unknown> => logic("server_config.row_to_wire", { key, row });

/** The value to send for an edited key; `null` clears it. */
export const wireValue = (key: ConfigKey, value: EditorValue | null): unknown => logic("server_config.wire_value", { key, value });

/** The request body for saving the draft. */
export const toChange = (view: ConfigView, draft: Draft): ConfigChange => logic("server_config.to_change", { view, draft });

/** What is wrong with the edit of a key, in a few words; null when it is fine. The server checks again. */
export const problemFor = (key: ConfigKey, value: EditorValue | null): string | null => logic("server_config.problem_for", { key, value });

/** Problems with all pending edits, by key. */
export const draftProblems = (view: ConfigView, draft: Draft): Record<string, string> => logic("server_config.draft_problems", { view, draft });

/** The warnings of the keys being changed (the listen address, the token, the database). */
export const warningsFor = (view: ConfigView, draft: Draft): { label: string; warning: string }[] =>
  logic("server_config.warnings_for", { view, draft });

/** The new API token typed into the form, if there is one. The app then switches to it after the restart. */
export const newToken = (draft: Draft): string | null => logic("server_config.new_token", { draft });

/** Where the value of a key comes from, in plain words. */
export const sourceLabel = (key: ConfigKey): string => logic("server_config.source_label", { key });

export type SourceTone = "locked" | "app" | "file" | "default";

export const sourceTone = (key: ConfigKey): SourceTone => logic("server_config.source_tone", { key });

/** A few words for the value of a key, when it is shown without its editor. */
export const valueSummary = (key: ConfigKey): string => logic("server_config.value_summary", { key });

/** "3 of 7 set", and how many of them you changed. */
export const groupSummary = (group: ConfigGroup, draft: Draft): string => logic("server_config.group_summary", { group, draft });

/** The one line the save button area says. */
export const saveSummary = (draft: Draft): string => logic("server_config.save_summary", { draft });

export const savedText = (saved: ConfigSaved): string => logic("server_config.saved_text", { saved });

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
export const timeoutText = (changedListenAddress: boolean): string =>
  logic("server_config.timeout_text", { changed_listen_address: changedListenAddress });
