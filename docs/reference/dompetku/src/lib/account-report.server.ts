/**
 * Per-account report + reconciliation (server only). Monthly flows come from the optional v13
 * `dk_account_monthly` function, falling back to fetchAll + the pure aggregator (identical result).
 * The v13 "missing" state is tracked here, separately from aggregate.ts, so a missing v13 never
 * disables the v9 functions.
 */
import { db } from "./db.server";
import { isMissingTable, logActivity } from "./finance.server";
import { fetchAll } from "./paginate";
import { isMissingFunction } from "./aggregate";
import { addDays, monthRange } from "./dates";
import {
  balanceSeries,
  monthSummary,
  normalizeAccountMonths,
  outflowByCategory,
  sumAccountMonthly,
  totalBalance,
  type AccountMonth,
  type AccountTx,
} from "./account-report";

const MISSING_RETRY_MS = 5 * 60 * 1000;
let missingUntil = 0;

async function loadAccount(id: string) {
  const res = await db()
    .from("accounts")
    .select("id, name, type, currency, color, archived, initial_balance")
    .eq("id", id)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error("Akun tidak ditemukan");
  return res.data;
}

const accountOr = (id: string) => `account_id.eq.${id},to_account_id.eq.${id}`;

/** Monthly inflow/outflow of an account for every month with occurred_at < end. */
export async function accountMonthly(id: string, end: string): Promise<AccountMonth[]> {
  if (Date.now() >= missingUntil) {
    try {
      const res = await db().rpc("dk_account_monthly", { p_account: id, p_end: end });
      if (!res.error) return normalizeAccountMonths(res.data);
      if (isMissingFunction(res.error)) missingUntil = Date.now() + MISSING_RETRY_MS;
      else console.error("dk_account_monthly failed, using fallback", res.error.message);
    } catch (e) {
      console.error("dk_account_monthly failed, using fallback", e);
    }
  }
  const all = await fetchAll<AccountTx>((from, to) =>
    db()
      .from("transactions")
      .select("id, kind, amount, account_id, to_account_id, occurred_at")
      .or(accountOr(id))
      .lt("occurred_at", end)
      .order("id")
      .range(from, to),
  );
  if (all.error) throw new Error(all.error.message);
  return sumAccountMonthly(all.data ?? [], id);
}

async function lastReconciliation(id: string) {
  try {
    const res = await db()
      .from("account_reconciliations")
      .select("as_of, statement_balance, app_balance, created_at")
      .eq("account_id", id)
      .order("as_of", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) {
      if (!isMissingTable(res.error))
        console.error("reconciliation read failed", res.error.message);
      return { ready: !isMissingTable(res.error), last: null };
    }
    const d = res.data;
    return {
      ready: true,
      last: d
        ? {
            as_of: d.as_of,
            statement_balance: Number(d.statement_balance),
            app_balance: Number(d.app_balance),
            created_at: d.created_at,
          }
        : null,
    };
  } catch (e) {
    console.error("reconciliation read failed", e);
    return { ready: false, last: null };
  }
}

export async function computeAccountReport(id: string, month: string) {
  const account = await loadAccount(id);
  const { start, end } = monthRange(month);
  const [months, monthTx, recon] = await Promise.all([
    accountMonthly(id, end),
    fetchAll<AccountTx>((from, to) =>
      db()
        .from("transactions")
        .select(
          "id, kind, amount, account_id, to_account_id, occurred_at, category:categories(name,color)",
        )
        .or(accountOr(id))
        .gte("occurred_at", start)
        .lt("occurred_at", end)
        .order("id")
        .range(from, to),
    ),
    lastReconciliation(id),
  ]);
  if (monthTx.error) throw new Error(monthTx.error.message);
  return {
    account: { ...account, initial_balance: Number(account.initial_balance) },
    summary: monthSummary(account.initial_balance, months, month),
    series: balanceSeries(account.initial_balance, months, month, 12),
    byCategory: outflowByCategory(monthTx.data ?? [], id),
    reconciliation: recon,
  };
}

/** App balance of the account at the end of `date` (inclusive). */
export async function balanceAt(id: string, date: string) {
  const account = await loadAccount(id);
  return totalBalance(account.initial_balance, await accountMonthly(id, addDays(date, 1)));
}

/** Transactions touching the account between two dates (inclusive), for statement matching. */
export async function reconcileTransactions(id: string, from: string, to: string) {
  const res = await fetchAll(
    (a, b) =>
      db()
        .from("transactions")
        .select(
          "id, kind, amount, currency, account_id, to_account_id, occurred_at, description, merchant, category:categories(name,color)",
        )
        .or(accountOr(id))
        .gte("occurred_at", from)
        .lte("occurred_at", to)
        .order("occurred_at")
        .order("id")
        .range(a, b),
    { hardCap: 5000 },
  );
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

/** Saves a reconciliation checkpoint; `{ saved:false }` when v13 is not installed. */
export async function saveReconciliation(id: string, asOf: string, statementBalance: number) {
  const appBalance = await balanceAt(id, asOf);
  const res = await db().from("account_reconciliations").insert({
    account_id: id,
    as_of: asOf,
    statement_balance: statementBalance,
    app_balance: appBalance,
  });
  if (res.error) {
    if (isMissingTable(res.error)) return { saved: false, appBalance };
    throw new Error(res.error.message);
  }
  await logActivity("account.reconcile", id, {
    as_of: asOf,
    amount: statementBalance,
    difference: Math.round((statementBalance - appBalance) * 100) / 100,
  });
  return { saved: true, appBalance };
}
