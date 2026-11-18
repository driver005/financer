/**
 * Pure, client-safe helpers for split transactions (one receipt → several expense categories).
 * A split is stored as N sibling expense transactions sharing `split_group`, so every existing
 * aggregate (budgets, dashboard, reports, SQL functions, net worth) stays correct unchanged.
 */

export type SplitRow = {
  category_id: string | null;
  amount: number | string;
  note?: string | null | undefined;
};
export type ReceiptItem = { name: string; qty?: number | null; price?: number | null };

export const SPLIT_MIN_ROWS = 2;
export const SPLIT_MAX_ROWS = 20;

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Sum of the row amounts (rounded to cents). */
export function splitSum(rows: SplitRow[]): number {
  return r2(rows.reduce((a, r) => a + num(r.amount), 0));
}

/** total − sum(rows); 0 when the split is balanced. */
export function splitRemaining(total: number | string, rows: SplitRow[]): number {
  return r2(num(total) - splitSum(rows));
}

/** Indonesian error key (wrap in t()) or null when the split can be saved. */
export function validateSplit(total: number | string, rows: SplitRow[]): string | null {
  if (!(num(total) > 0)) return "Isi jumlah total dulu";
  if (rows.length < SPLIT_MIN_ROWS) return "Split minimal 2 baris";
  if (rows.length > SPLIT_MAX_ROWS) return "Split maksimal 20 baris";
  if (rows.some((r) => !(num(r.amount) > 0))) return "Setiap baris harus punya jumlah > 0";
  if (rows.some((r) => !r.category_id)) return "Setiap baris harus punya kategori";
  if (Math.abs(splitRemaining(total, rows)) >= 0.005) return "Jumlah baris harus sama dengan total";
  return null;
}

/** "Belanja" → "Belanja (1/3)"; the note (if any) wins over the shared description. */
export function splitDescription(
  base: string | null | undefined,
  index: number,
  count: number,
  note?: string | null,
): string | null {
  const text = (note ?? "").trim() || (base ?? "").trim();
  return text ? `${text} (${index + 1}/${count})` : `Split (${index + 1}/${count})`;
}

/** Line amount of a receipt item: `price` is the line total as read by OCR. */
export function itemAmount(it: ReceiptItem): number {
  return r2(num(it.price));
}

/**
 * Builds split rows from OCR items: each item is assigned a category (by `assign[i]`, falling back
 * to `guess(name)`), amounts are summed per category, in first-seen order. Items without price are skipped.
 */
export function rowsFromItems(
  items: ReceiptItem[],
  guess: (name: string) => string | null,
  assign: (string | null | undefined)[] = [],
): SplitRow[] {
  const byCat = new Map<string, { amount: number; names: string[] }>();
  items.forEach((it, i) => {
    const amount = itemAmount(it);
    if (!(amount > 0)) return;
    const cat = assign[i] ?? guess(it.name) ?? "";
    const cur = byCat.get(cat) ?? { amount: 0, names: [] };
    cur.amount = r2(cur.amount + amount);
    cur.names.push(it.name);
    byCat.set(cat, cur);
  });
  return [...byCat.entries()].map(([cat, v]) => ({
    category_id: cat || null,
    amount: v.amount,
    note: v.names.slice(0, 3).join(", ") + (v.names.length > 3 ? "…" : ""),
  }));
}

/** Puts any leftover (total − sum, e.g. tax/discount) on the last row so the split balances. */
export function balanceLastRow(total: number | string, rows: SplitRow[]): SplitRow[] {
  if (!rows.length) return rows;
  const rest = splitRemaining(total, rows);
  if (rest === 0) return rows;
  const last = rows[rows.length - 1]!;
  const amount = r2(num(last.amount) + rest);
  if (!(amount > 0)) return rows;
  return [...rows.slice(0, -1), { ...last, amount }];
}
