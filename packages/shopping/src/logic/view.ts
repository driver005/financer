// Turning API answers into what the design system's components show. The rules are in Rust
// (crates/logic, shop_view.rs).

import { logic } from "../../../wire/src/logic";
import type { Comparison, DealItem, Offer, SearchItem, Verdict } from "../api/types";

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
export const sortItems = (items: readonly SearchItem[], key: SortKey): SearchItem[] => logic("shop_view.sort_items", { items, key });

export const isMonthly = (item: SearchItem): boolean => logic("shop_view.is_monthly", { item });

/** The offer behind the price shown for a result. */
export const bestOffer = (item: SearchItem): Offer | undefined => logic<Offer | null>("shop_view.best_offer", { item }) ?? undefined;

export const dealBadges = (verdict: Verdict | undefined): ProductBadge[] => logic("shop_view.deal_badges", { verdict: verdict ?? null });

export const savingNote = (item: SearchItem, months: number): string | null => logic("shop_view.saving_note", { item, months });

/** The "understood as" chips: what the query's price and conditions were taken to mean. */
export const understood = (parsed: { max_price_cents: number | null; constraints: { attribute: string; op: string; value: unknown }[] }): AppliedFilter[] =>
  logic("shop_view.understood", { parsed });

/** The comparison as the table component takes it: the price goes into the header, not a row. */
export const compareView = (c: Comparison, images: Readonly<Record<string, string | null | undefined>> = {}): { columns: CompareColumn[]; rows: CompareRow[] } =>
  logic("shop_view.compare_view", { c, images });

/** Example searches shown before the first one: they teach the query language by example. */
export const EXAMPLE_SEARCHES = [
  "best phone under 600 € with a good camera",
  "laptop 16 GB ram under 1000 €",
  "5G plan 20 GB no contract",
  "ram_gb>=8 battery_mah>4500 brand:google",
] as const;

/** "Understood 3 conditions · budget 700 €": one line about what the query was taken to mean. */
export const understoodLine = (parsed: { max_price_cents: number | null; constraints: unknown[] }): string | null =>
  logic("shop_view.understood_line", { parsed });

/** The result that saves the most a month against what the person pays now, if any saves anything. */
export const bestSaving = (items: readonly SearchItem[]): { perMonthCents: number; overHorizonCents: number; current: string | null; title: string } | null =>
  logic("shop_view.best_saving", { items });

/** The saving as a share (0..1) of what the person pays now, when that is known. */
export const savingShare = (perMonthCents: number, currentMonthlyCents: number | null | undefined): number | null =>
  logic("shop_view.saving_share", { per_month_cents: perMonthCents, current_monthly_cents: currentMonthlyCents ?? null });

/** Round budgets to offer as quick choices (euros). */
export const budgetPresets = (kind: string | undefined): number[] => logic("shop_view.budget_presets", { kind: kind ?? null });

export type DealFilter = "all" | "big" | `category:${string}`;

/** "All", "15 % off or more" and one entry per category that has deals (most deals first). */
export const dealFilters = (deals: readonly DealItem[]): { key: DealFilter; label: string }[] => logic("shop_view.deal_filters", { deals });

export const filterDeals = (deals: readonly DealItem[], filter: DealFilter): DealItem[] => logic("shop_view.filter_deals", { deals, filter });
