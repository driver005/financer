/**
 * What the Spending list shows: a filter (everything, only money out, only money in) and the net
 * amount of each booking day. The rules are in Rust (crates/logic, app_misc.rs).
 */
import { logic } from "../../../packages/wire/src/logic";

type Tx = { amount_cents: number };

export type TxFilter = "all" | "spending" | "income";

export const TX_FILTERS: readonly { value: TxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "spending", label: "Spending" },
  { value: "income", label: "Income" },
];

/** The bookings that match `filter`; the input order is kept. */
export const filterTx = <T extends Tx>(items: T[], filter: TxFilter): T[] => (filter === "all" ? items : logic("app_misc.filter_tx", { items, filter }));

/** Net amount of a day's bookings: income minus spending. */
export const dayTotal = (items: Tx[]): number => logic("app_misc.day_total", { items });

/** `No spending in this period` style sentence for an empty filtered list. */
export const emptyFilterText = (filter: TxFilter): string => logic("app_misc.empty_filter_text", { filter });
