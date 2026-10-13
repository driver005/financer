/**
 * Pure logic for the Stores screen (spending per supermarket chain): which periods can be chosen,
 * how shares and changes are worded, and the ranked list. The server sends numbers (cents,
 * tenths of a percent); the words are chosen here.
 */
import type { StoreSpend, StoreSpending, StoresPeriod } from "./api/client";
import { formatCents, formatDate } from "./format";

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
export function formatPermille(permille: number): string {
  const tenths = Math.round(permille);
  const whole = Math.trunc(Math.abs(tenths) / 10);
  const frac = Math.abs(tenths) % 10;
  const sign = tenths < 0 ? "-" : "";
  return `${sign}${whole}${frac ? `,${frac}` : ""} %`;
}

export type ChangeTone = "up" | "down" | "flat" | "new";

/** Spending went up, down, stayed the same, or there is nothing to compare with. */
export function changeTone(row: StoreSpend): ChangeTone {
  if (row.previous_total_cents === 0) return row.total_cents > 0 ? "new" : "flat";
  if (row.change_cents > 0) return "up";
  if (row.change_cents < 0) return "down";
  return "flat";
}

/** `+12,3 %` / `-33,3 %` / `same` / `new`, for the chip next to a chain. */
export function changeText(row: StoreSpend): string {
  const tone = changeTone(row);
  if (tone === "new") return "new";
  if (tone === "flat") return "same";
  const pct = row.change_permille;
  const sign = row.change_cents > 0 ? "+" : "";
  return pct == null ? `${sign}${formatCents(row.change_cents)}` : `${sign}${formatPermille(pct)}`;
}

/** The ranked list: chains by spend, then the unmatched groceries when there are any. */
export function rankedRows(r: StoreSpending): StoreSpend[] {
  return r.other.total_cents > 0 ? [...r.chains, r.other] : [...r.chains];
}

/** Length of a row's bar relative to the biggest row, 0..1. */
export function barFraction(row: StoreSpend, rows: StoreSpend[]): number {
  const max = Math.max(0, ...rows.map((x) => x.total_cents));
  return max === 0 ? 0 : Math.max(0, Math.min(1, row.total_cents / max));
}

export function visitsText(visits: number): string {
  return `${visits} visit${visits === 1 ? "" : "s"}`;
}

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** `today`, `yesterday`, `5 days ago`, or the date for anything older than two weeks. */
export function lastVisitText(lastVisit: string | null | undefined, today: string): string | null {
  if (!lastVisit) return null;
  const days = Math.round((toUtc(today) - toUtc(lastVisit)) / DAY_MS);
  if (days < 0) return formatDate(lastVisit);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 14) return `${days} days ago`;
  return formatDate(lastVisit);
}

/** What the figures are compared with, e.g. `01.09. - 11.09.2026 (the same number of days)`. */
export function compareText(r: StoreSpending): string {
  const range = `${formatDate(r.compare_start)} - ${formatDate(r.compare_end)}`;
  return r.compare_is_partial ? `${range} (the same number of days)` : range;
}

/** One line about the total, with its comparison. */
export function totalText(r: StoreSpending): string {
  if (r.total_cents === 0) return "Nothing spent in stores yet.";
  if (r.previous_total_cents === 0) return `${formatCents(r.total_cents)} in stores. Nothing to compare with before.`;
  const diff = r.total_cents - r.previous_total_cents;
  if (diff === 0) return `${formatCents(r.total_cents)} in stores, the same as before.`;
  const more = diff > 0;
  return `${formatCents(r.total_cents)} in stores, ${formatCents(Math.abs(diff))} ${more ? "more" : "less"} than before.`;
}

/** Hint under the list when groceries could not be assigned to a chain; `null` when all were. */
export function unmatchedHint(r: StoreSpending): string | null {
  if (r.other.total_cents <= 0) return null;
  return `${formatCents(r.other.total_cents)} of groceries could not be matched to a chain. If a shop is missing, add its bank text under [[stores]] in the server's financer.toml.`;
}

/** Accessible one-line summary of a row. */
export function rowLabel(row: StoreSpend): string {
  return `${row.name}, ${formatCents(row.total_cents)}, ${formatPermille(row.share_permille)} of store spending, ${visitsText(row.visits)}, ${changeText(row)}`;
}
