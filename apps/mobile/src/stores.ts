/**
 * The Stores screen (spending per supermarket chain): which periods can be chosen and the ranked list
 * are here; how shares and changes are worded is in Rust (crates/logic, stores.rs). The server sends numbers (cents,
 * tenths of a percent); the words are chosen here.
 */
import type { StoreSpend, StoreSpending, StoresPeriod } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";

export type StoresView = "current" | "previous" | "last3";

export const STORES_VIEWS: { value: StoresView; label: string; period: StoresPeriod; n?: number }[] = [
  { value: "current", label: "This", period: "current" },
  { value: "previous", label: "Last", period: "previous" },
  { value: "last3", label: "Last 3", period: "last_n", n: 3 },
];

/** The API arguments for a view. */
export function viewQuery(view: StoresView): { period: StoresPeriod; n?: number } {
  const v = STORES_VIEWS.find((x) => x.value === view) ?? STORES_VIEWS[0];
  return { period: v.period, n: v.n };
}

/** `123` (tenths of a percent) -> `12,3 %`; whole numbers drop the decimal. */
export const formatPermille = (permille: number): string => logic("stores.format_permille", { permille });

export type ChangeTone = "up" | "down" | "flat" | "new";

/** Spending went up, down, stayed the same, or there is nothing to compare with. */
export const changeTone = (row: StoreSpend): ChangeTone => logic("stores.change_tone", { row });

/** `+12,3 %` / `-33,3 %` / `same` / `new`, for the chip next to a chain. */
export const changeText = (row: StoreSpend): string => logic("stores.change_text", { row });

/** The ranked list: chains by spend, then the unmatched groceries when there are any. */
export function rankedRows(r: StoreSpending): StoreSpend[] {
  return r.other.total_cents > 0 ? [...r.chains, r.other] : [...r.chains];
}

/** Length of a row's bar relative to the biggest row, 0..1. */
export const barFraction = (row: StoreSpend, rows: StoreSpend[]): number =>
  logic("stores.bar_fraction", { total_cents: row.total_cents, totals: rows.map((x) => x.total_cents) });

export const visitsText = (visits: number): string => logic("stores.visits_text", { visits });

/** `today`, `yesterday`, `5 days ago`, or the date for anything older than two weeks. */
export const lastVisitText = (lastVisit: string | null | undefined, today: string): string | null =>
  logic("stores.last_visit_text", { last_visit: lastVisit ?? null, today });

/** What the figures are compared with, e.g. `01.09. - 11.09.2026 (the same number of days)`. */
export const compareText = (r: StoreSpending): string => logic("stores.compare_text", { r });

/** One line about the total, with its comparison. */
export const totalText = (r: StoreSpending): string => logic("stores.total_text", { r });

/** Hint under the list when groceries could not be assigned to a chain; `null` when all were. */
export const unmatchedHint = (r: StoreSpending): string | null => logic("stores.unmatched_hint", { r });

/** Accessible one-line summary of a row. */
export const rowLabel = (row: StoreSpend): string => logic("stores.row_label", { row });
