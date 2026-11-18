/**
 * Pure, client-safe per-account report + bank reconciliation helpers (tested).
 * Flow rules mirror the `account_balances` view exactly (amounts in `amount`, the account's
 * currency): balance = initial + income on the account − expense/transfer from the account
 * + transfers to the account. A row with account_id = to_account_id counts only as outflow,
 * as the view's CASE matches the account_id branch first.
 */
import { addDays, diffDays, shiftMonth } from "./dates";
import { parseAmount, parseDate } from "./csv";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type AccountTx = {
  id?: string;
  kind: string;
  amount: unknown;
  account_id?: string | null;
  to_account_id?: string | null;
  occurred_at: unknown;
  description?: string | null;
  merchant?: string | null;
  category_id?: string | null;
  category?: { name?: string | null; color?: string | null } | null;
};
export type AccountMonth = { month: string; inflow: number; outflow: number };

/** Inflow/outflow of one transaction for one account (same CASE as the view). */
export function flowOf(t: AccountTx, accountId: string): { inflow: number; outflow: number } {
  const v = Number(t.amount) || 0;
  if (t.account_id === accountId) {
    if (t.kind === "income") return { inflow: v, outflow: 0 };
    if (t.kind === "expense" || t.kind === "transfer") return { inflow: 0, outflow: v };
    return { inflow: 0, outflow: 0 };
  }
  if (t.to_account_id === accountId && t.kind === "transfer") return { inflow: v, outflow: 0 };
  return { inflow: 0, outflow: 0 };
}

/** Signed effect on the account balance (+ in, − out). */
export const signedAmount = (t: AccountTx, accountId: string) => {
  const f = flowOf(t, accountId);
  return r2(f.inflow - f.outflow);
};

/** = dk_account_monthly: per-month inflow/outflow (JS fallback). */
export function sumAccountMonthly(rows: readonly AccountTx[], accountId: string): AccountMonth[] {
  const m = new Map<string, AccountMonth>();
  for (const t of rows) {
    const month = String(t.occurred_at).slice(0, 7);
    const f = flowOf(t, accountId);
    const cur = m.get(month) ?? { month, inflow: 0, outflow: 0 };
    cur.inflow += f.inflow;
    cur.outflow += f.outflow;
    m.set(month, cur);
  }
  return [...m.values()]
    .map((x) => ({ month: x.month, inflow: r2(x.inflow), outflow: r2(x.outflow) }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

/** rpc rows → numbers (numeric may arrive as string). */
export function normalizeAccountMonths(
  rows: readonly { month: unknown; inflow: unknown; outflow: unknown }[] | null | undefined,
): AccountMonth[] {
  return (rows ?? []).map((r) => ({
    month: String(r.month),
    inflow: r2(Number(r.inflow) || 0),
    outflow: r2(Number(r.outflow) || 0),
  }));
}

/** Balance after every month in `months` (initial + all flows), i.e. the account_balances value. */
export function totalBalance(initial: unknown, months: readonly AccountMonth[]): number {
  return r2(months.reduce((a, m) => a + m.inflow - m.outflow, Number(initial) || 0));
}

/** Opening / inflow / outflow / closing for one month. */
export function monthSummary(
  initial: unknown,
  months: readonly AccountMonth[],
  month: string,
): { opening: number; inflow: number; outflow: number; closing: number } {
  const opening = totalBalance(
    initial,
    months.filter((m) => m.month < month),
  );
  const cur = months.find((m) => m.month === month);
  const inflow = cur?.inflow ?? 0;
  const outflow = cur?.outflow ?? 0;
  return { opening, inflow, outflow, closing: r2(opening + inflow - outflow) };
}

/** Closing balance at the end of each of the `count` months ending with `endMonth`. */
export function balanceSeries(
  initial: unknown,
  months: readonly AccountMonth[],
  endMonth: string,
  count = 12,
): { month: string; balance: number }[] {
  const keys = Array.from({ length: count }, (_, i) => shiftMonth(endMonth, i - count + 1));
  return keys.map((k) => ({
    month: k,
    balance: totalBalance(
      initial,
      months.filter((m) => m.month <= k),
    ),
  }));
}

export const TRANSFER_OUT = "Transfer keluar";
export type OutflowSlice = { name: string; color: string | null; value: number };

/** Outflows of the account by category (transfers out grouped as one slice), biggest first. */
export function outflowByCategory(
  rows: readonly AccountTx[],
  accountId: string,
  uncategorized = "Tanpa kategori",
): OutflowSlice[] {
  const m = new Map<string, OutflowSlice>();
  for (const t of rows) {
    const { outflow } = flowOf(t, accountId);
    if (!outflow) continue;
    const name = t.kind === "transfer" ? TRANSFER_OUT : (t.category?.name ?? null) || uncategorized;
    const cur = m.get(name) ?? {
      name,
      color: t.kind === "transfer" ? null : (t.category?.color ?? null),
      value: 0,
    };
    cur.value += outflow;
    m.set(name, cur);
  }
  return [...m.values()]
    .map((s) => ({ ...s, value: r2(s.value) }))
    .sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : 1));
}

/* ---------------- Reconciliation ---------------- */
export type StatementLine = { line: number; date: string; description: string; amount: number };

const STATEMENT_HEADERS: Record<string, string[]> = {
  date: ["tanggal", "date", "tgl", "tanggal transaksi", "tgl transaksi", "transaction date"],
  description: ["keterangan", "deskripsi", "description", "uraian", "catatan", "notes", "remark"],
  amount: ["jumlah", "amount", "nominal", "mutasi"],
  debit: ["debit", "debet", "keluar", "db"],
  credit: ["kredit", "credit", "masuk", "cr"],
};

/**
 * Parses a bank mutation table (header row + rows): date, description and either a signed
 * amount column or separate debit (−) / credit (+) columns.
 */
export function parseStatement(table: string[][]): {
  lines: StatementLine[];
  errors: number[];
  missingHeaders: string[];
} {
  const [head = [], ...body] = table;
  const norm = head.map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const [k, aliases] of Object.entries(STATEMENT_HEADERS))
    idx[k] = norm.findIndex((h) => aliases.includes(h));
  const hasAmount = idx["amount"]! >= 0 || idx["debit"]! >= 0 || idx["credit"]! >= 0;
  const missingHeaders = [
    ...(idx["date"]! < 0 ? ["tanggal"] : []),
    ...(hasAmount ? [] : ["jumlah"]),
  ];
  if (missingHeaders.length) return { lines: [], errors: [], missingHeaders };
  const get = (r: string[], k: string) => (idx[k]! >= 0 ? (r[idx[k]!] ?? "").trim() : "");
  const lines: StatementLine[] = [];
  const errors: number[] = [];
  body.forEach((r, i) => {
    const date = parseDate(get(r, "date"));
    let amount: number | null = null;
    if (idx["amount"]! >= 0) amount = parseAmount(get(r, "amount"));
    else {
      const d = get(r, "debit") ? parseAmount(get(r, "debit")) : 0;
      const c = get(r, "credit") ? parseAmount(get(r, "credit")) : 0;
      if (d != null && c != null) amount = r2(Math.abs(c) - Math.abs(d));
    }
    if (!date || amount == null || amount === 0) errors.push(i + 2);
    else lines.push({ line: i + 2, date, description: get(r, "description"), amount: r2(amount) });
  });
  return { lines, errors, missingHeaders };
}

export type ReconcileMatch<T> = { line: StatementLine; tx: T; days: number };

/**
 * Pairs statement lines with app transactions of the same signed amount whose date is within
 * ±`toleranceDays`. Each transaction is used at most once; the closest date wins, ties go to the
 * earlier statement line. Returns matches plus unmatched lines / transactions.
 */
export function matchStatement<T extends AccountTx>(
  lines: readonly StatementLine[],
  txs: readonly T[],
  accountId: string,
  toleranceDays = 2,
): { matched: ReconcileMatch<T>[]; unmatchedLines: StatementLine[]; unmatchedTx: T[] } {
  const used = new Set<number>();
  const signed = txs.map((t) => signedAmount(t, accountId));
  const dates = txs.map((t) => String(t.occurred_at).slice(0, 10));
  const order = [...lines].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.line - b.line,
  );
  const matched: ReconcileMatch<T>[] = [];
  const unmatchedLines: StatementLine[] = [];
  for (const line of order) {
    let best = -1;
    let bestDays = Infinity;
    for (let i = 0; i < txs.length; i++) {
      if (used.has(i) || Math.abs(signed[i]! - line.amount) >= 0.005) continue;
      const d = Math.abs(diffDays(line.date, dates[i]!));
      if (d <= toleranceDays && d < bestDays) {
        best = i;
        bestDays = d;
      }
    }
    if (best >= 0) {
      used.add(best);
      matched.push({ line, tx: txs[best]!, days: bestDays });
    } else unmatchedLines.push(line);
  }
  const unmatchedTx = txs.filter((_, i) => !used.has(i) && signed[i] !== 0);
  return { matched, unmatchedLines, unmatchedTx };
}

/** Date window of app transactions needed to match a statement (± tolerance). */
export function statementWindow(
  lines: readonly StatementLine[],
  toleranceDays = 2,
): { from: string; to: string } | null {
  if (!lines.length) return null;
  const ds = lines.map((l) => l.date).sort();
  return { from: addDays(ds[0]!, -toleranceDays), to: addDays(ds[ds.length - 1]!, toleranceDays) };
}

/** Statement − app balance (positive = bank has more than the app). */
export const reconcileDifference = (statement: number, app: number) => r2(statement - app);

/** Prefill for "Catat": a statement line → transaction draft on this account. */
export function draftFromLine(line: StatementLine, accountId: string, currency = "IDR") {
  return {
    kind: line.amount > 0 ? "income" : "expense",
    amount: Math.abs(line.amount),
    currency,
    account_id: accountId,
    occurred_at: line.date,
    description: line.description || null,
    source: "web",
    items: null,
  };
}
