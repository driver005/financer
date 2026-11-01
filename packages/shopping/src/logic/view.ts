// Turning API answers into what the design system's components show. Pure, so it is tested.

import type { Comparison, Offer, SearchItem, Verdict } from "../api/types";
import { formatCents, savingText } from "./format";

// Shapes the design system's components take (see @financer/ui); kept here as plain types so this file
// has no dependency on React Native and runs in the Node tests.
export type AppliedFilter = { key: string; label: string };
export type ProductBadge = { label: string; tone?: "success" | "warning" | "danger" | "info" | "accent" | "neutral" };
export type CompareColumn = { id: string; title: string; subtitle?: string | null; priceText?: string | null; score?: number | null };
export type CompareRow = { key: string; label: string; group?: string | null; cells: { value: string | null; best?: boolean }[] };

export type SortKey = "best" | "price" | "deal";

export const SORT_OPTIONS = [
  { value: "best", label: "Best match", description: "Ranked by your weights" },
  { value: "price", label: "Price: low to high" },
  { value: "deal", label: "Biggest discount" },
] as const;

/** Re-order results the person already has. "Best match" is the server's order. */
export function sortItems(items: readonly SearchItem[], key: SortKey): SearchItem[] {
  const list = [...items];
  if (key === "price") list.sort((a, b) => (a.ranked.price_cents ?? Infinity) - (b.ranked.price_cents ?? Infinity));
  if (key === "deal") list.sort((a, b) => (b.deal?.discount_pct ?? 0) - (a.deal?.discount_pct ?? 0));
  return list;
}

export function isMonthly(item: SearchItem): boolean {
  return item.product.offers.some((o) => o.recurring);
}

/** The offer behind the price shown for a result. */
export function bestOffer(item: SearchItem): Offer | undefined {
  return item.product.offers.find((o) => o.url === item.ranked.url) ?? item.product.offers[0];
}

export function dealBadges(verdict: Verdict | undefined): ProductBadge[] {
  if (verdict === "great") return [{ label: "Great deal", tone: "success" }];
  if (verdict === "good") return [{ label: "Good deal", tone: "success" }];
  return [];
}

export function savingNote(item: SearchItem, months: number): string | null {
  if (!item.saving) return null;
  return savingText(item.saving.per_month_cents, item.saving.over_horizon_cents, months, item.saving.current);
}

/** The "understood as" chips: what the query's price and conditions were taken to mean. */
export function understood(parsed: { max_price_cents: number | null; constraints: { attribute: string; op: string; value: unknown }[] }): AppliedFilter[] {
  const out: AppliedFilter[] = [];
  if (parsed.max_price_cents) out.push({ key: "price", label: `under ${formatCents(parsed.max_price_cents).replace(",00", "")}` });
  for (const c of parsed.constraints) {
    const sym = c.op === "gte" ? "≥" : c.op === "lte" ? "≤" : c.op === "eq" ? "=" : c.op === "ne" ? "≠" : ":";
    out.push({ key: `${c.attribute}${c.op}${String(c.value)}`, label: `${c.attribute.replace(/_/g, " ")} ${sym} ${String(c.value)}` });
  }
  return out;
}

/** The comparison as the table component takes it: the price goes into the header, not a row. */
/** A spec row that shows what a criterion row already shows (same label, or the same values in every cell) is noise. */
function dropRepeatedSpecs<R extends { kind: string; label: string; cells: { value: string | null }[] }>(rows: R[]): R[] {
  const criteria = rows.filter((r) => r.kind === "criterion");
  const same = (a: R, b: R) => a.cells.length === b.cells.length && a.cells.every((cell, i) => cell.value !== null && cell.value === b.cells[i]?.value);
  return rows.filter(
    (r) => r.kind !== "spec" || !criteria.some((c) => c.label.toLowerCase() === r.label.toLowerCase() || same(r, c)),
  );
}

export function compareView(c: Comparison): { columns: CompareColumn[]; rows: CompareRow[] } {
  return {
    columns: c.columns.map((col) => ({
      id: col.product_id,
      title: col.title,
      priceText: col.price_cents === null ? null : formatCents(col.price_cents),
      score: col.score,
    })),
    rows: dropRepeatedSpecs(c.rows.filter((r) => r.kind !== "price"))
      .map((r) => ({ key: r.key, label: r.label, group: r.group, cells: r.cells.map((cell) => ({ value: cell.value, best: cell.best })) })),
  };
}

/** Example searches shown before the first one: they teach the query language by example. */
export const EXAMPLE_SEARCHES = [
  "best phone under 600 € with a good camera",
  "laptop 16 GB ram under 1000 €",
  "5G plan 20 GB no contract",
  "ram_gb>=8 battery_mah>4500 brand:google",
] as const;
