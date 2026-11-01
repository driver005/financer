// Turning API answers into what the design system's components show. Pure, so it is tested.

import type { Comparison, DealItem, Offer, SearchItem, Verdict } from "../api/types";
import { formatCents, savingText } from "./format";

// Shapes the design system's components take (see @financer/ui); kept here as plain types so this file
// has no dependency on React Native and runs in the Node tests.
export type AppliedFilter = { key: string; label: string };
export type ProductBadge = { label: string; tone?: "success" | "warning" | "danger" | "info" | "accent" | "neutral" };
export type CompareColumn = { id: string; title: string; subtitle?: string | null; priceText?: string | null; score?: number | null; imageUri?: string | null };
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

export function compareView(c: Comparison, images: Readonly<Record<string, string | null | undefined>> = {}): { columns: CompareColumn[]; rows: CompareRow[] } {
  return {
    columns: c.columns.map((col) => ({
      id: col.product_id,
      title: col.title,
      priceText: col.price_cents === null ? null : formatCents(col.price_cents),
      score: col.score,
      imageUri: images[col.product_id] ?? null,
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

/** "Understood 3 conditions · budget 700 €": one line about what the query was taken to mean. */
export function understoodLine(parsed: { max_price_cents: number | null; constraints: unknown[] }): string | null {
  const n = (parsed.max_price_cents ? 1 : 0) + parsed.constraints.length;
  if (n === 0) return null;
  const budget = parsed.max_price_cents ? ` · budget ${formatCents(parsed.max_price_cents).replace(",00", "")}` : "";
  return `Understood ${n} ${n === 1 ? "condition" : "conditions"}${budget}`;
}

/** The result that saves the most a month against what the person pays now, if any saves anything. */
export function bestSaving(items: readonly SearchItem[]): { perMonthCents: number; overHorizonCents: number; current: string | null; title: string } | null {
  let best: SearchItem | null = null;
  for (const it of items) {
    if (it.saving && it.saving.per_month_cents > 0 && (!best || it.saving.per_month_cents > (best.saving?.per_month_cents ?? 0))) best = it;
  }
  if (!best?.saving) return null;
  return { perMonthCents: best.saving.per_month_cents, overHorizonCents: best.saving.over_horizon_cents, current: best.saving.current, title: best.product.title };
}

/** The saving as a share (0..1) of what the person pays now, when that is known. */
export function savingShare(perMonthCents: number, currentMonthlyCents: number | null | undefined): number | null {
  if (!currentMonthlyCents || currentMonthlyCents <= 0) return null;
  return Math.min(1, Math.max(0, perMonthCents / currentMonthlyCents));
}

/** Round budgets to offer as quick choices (euros). */
export function budgetPresets(kind: string | undefined): number[] {
  return kind === "subscription" ? [10, 20, 30, 50] : [300, 500, 700, 1000];
}

export type DealFilter = "all" | "big" | `category:${string}`;

/** "All", "15 % off or more" and one entry per category that has deals (most deals first). */
export function dealFilters(deals: readonly DealItem[]): { key: DealFilter; label: string }[] {
  const counts = new Map<string, number>();
  for (const d of deals) counts.set(d.product.category, (counts.get(d.product.category) ?? 0) + 1);
  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out: { key: DealFilter; label: string }[] = [{ key: "all", label: "All deals" }];
  if (deals.some((d) => d.deal.discount_pct >= BIG_DEAL_PCT)) out.push({ key: "big", label: `${BIG_DEAL_PCT} % off or more` });
  if (cats.length > 1) for (const [c] of cats) out.push({ key: `category:${c}`, label: c.replace(/_/g, " ") });
  return out;
}

const BIG_DEAL_PCT = 15;

export function filterDeals(deals: readonly DealItem[], filter: DealFilter): DealItem[] {
  if (filter === "all") return [...deals];
  if (filter === "big") return deals.filter((d) => d.deal.discount_pct >= BIG_DEAL_PCT);
  const cat = filter.slice("category:".length);
  return deals.filter((d) => d.product.category === cat);
}
