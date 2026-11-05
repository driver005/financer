/**
 * What the Spending list shows: a filter (everything, only money out, only money in) and the net
 * amount of each booking day. The rules are in Rust (crates/logic, app_misc.rs).
 */
import { logic } from "../../../packages/wire/src/logic";

type Tx = { amount_cents: number };

export type TxFilter = "all" | "spending" | "income";

export const TX_FILTERS: readonly { value: TxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "income", label: "Income" },
  { value: "spending", label: "Expenses" },
];

/** The bookings that match `filter`; the input order is kept. */
export const filterTx = <T extends Tx>(items: T[], filter: TxFilter): T[] => (filter === "all" ? items : logic("app_misc.filter_tx", { items, filter }));

/** The bookings whose counterparty, purpose or category contain every word typed in the search box. */
export const searchTx = <T extends Tx>(items: T[], query: string): T[] => (query.trim() === "" ? items : logic("app_misc.search_tx", { items, query }));

/** What came in and what went out of these bookings, as positive cents each. */
export const incomeSpent = (items: Tx[]): { income: number; spent: number } => logic("app_misc.income_spent", { items });

/** Net amount of a day's bookings: income minus spending. */
export const dayTotal = (items: Tx[]): number => logic("app_misc.day_total", { items });

/** `No spending in this period` style sentence for an empty filtered list. */
export const emptyFilterText = (filter: TxFilter): string => logic("app_misc.empty_filter_text", { filter });

// ---- the filters of the list ----

export type DatePreset = "all" | "7d" | "30d" | "month" | "last_month" | "90d" | "year";
export type SortKey = "newest" | "oldest" | "largest" | "smallest";

/** Everything the filter sheet and the search box set. The rules that apply it are in Rust (`app_misc.apply_filters`). */
export type BookingFilters = {
  query: string;
  kind: TxFilter;
  /** Category keys; `uncategorized` for a booking with none. Empty is every category. */
  categories: string[];
  preset: DatePreset;
  /** Cents, no matter whether it came in or went out. */
  min_cents: number | null;
  max_cents: number | null;
  sort: SortKey;
};

export const NO_FILTERS: BookingFilters = { query: "", kind: "all", categories: [], preset: "all", min_cents: null, max_cents: null, sort: "newest" };

export const PRESETS: readonly { value: DatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "90d", label: "Last 90 days" },
  { value: "year", label: "This year" },
];

export const SORTS: readonly { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "largest", label: "Largest amount first" },
  { value: "smallest", label: "Smallest amount first" },
];

/** The bookings that pass every filter, in the order asked for. */
export const applyFilters = <T>(items: T[], filters: BookingFilters, today: string): T[] => logic("app_misc.apply_filters", { items, filters, today });

export type FilterChip = { key: string; label: string };

/** One removable chip for every filter that is on. */
export const filterChips = (filters: BookingFilters): FilterChip[] => logic("app_misc.filter_chips", { filters });

/** The filters with the one that `key` names (from `filterChips`) switched off. */
export function withoutFilter(f: BookingFilters, key: string): BookingFilters {
  if (key === "query") return { ...f, query: "" };
  if (key === "kind") return { ...f, kind: "all" };
  if (key === "preset") return { ...f, preset: "all" };
  if (key === "amount") return { ...f, min_cents: null, max_cents: null };
  if (key === "sort") return { ...f, sort: "newest" };
  if (key.startsWith("category:")) return { ...f, categories: f.categories.filter((c) => c !== key.slice("category:".length)) };
  return f;
}
