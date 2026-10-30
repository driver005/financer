/**
 * What the Spending list shows: a filter (everything, only money out, only money in) and the net
 * amount of each booking day. Pure, unit-tested.
 */
type Tx = { amount_cents: number };

export type TxFilter = "all" | "spending" | "income";

export const TX_FILTERS: readonly { value: TxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "spending", label: "Spending" },
  { value: "income", label: "Income" },
];

/** The bookings that match `filter`; the input order is kept. */
export function filterTx<T extends Tx>(items: T[], filter: TxFilter): T[] {
  if (filter === "spending") return items.filter((t) => t.amount_cents < 0);
  if (filter === "income") return items.filter((t) => t.amount_cents > 0);
  return items;
}

/** Net amount of a day's bookings: income minus spending. */
export function dayTotal(items: Tx[]): number {
  return items.reduce((sum, t) => sum + t.amount_cents, 0);
}

/** `No spending in this period` style sentence for an empty filtered list. */
export function emptyFilterText(filter: TxFilter): string {
  if (filter === "spending") return "No spending to show.";
  if (filter === "income") return "No income to show.";
  return "Nothing to show.";
}
