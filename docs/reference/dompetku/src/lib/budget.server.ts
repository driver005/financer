/**
 * v11 budget server logic: rollover carry (one aggregate query for all rollover budgets) and
 * instant 80%/100% alerts after an expense is recorded, deduplicated via `budget_alerts`.
 * Pure math lives in ./budget.ts. Every entry point degrades gracefully before schema v11.
 */
import { db } from "./db.server";
import { monthRange } from "./dates";
import { fetchAll } from "./paginate";
import { normalizeTotals, sqlOrFallback, sumMonthCategories } from "./aggregate";
import {
  budgetAlertText,
  budgetPercent,
  crossedLevels,
  rolloverCarry,
  rolloverStart,
  type BudgetAlert,
} from "./budget";
import { logError } from "./monitoring.server";

type RolloverBudget = { id: string; category_id: string; amount: number; created_at?: string };

/** Expense per category per month in [start, end) — SQL v9 function with JS fallback. */
async function spentByMonthCategory(
  start: string,
  end: string,
  categoryIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const r = await sqlOrFallback(
    () => db().rpc("dk_month_category_totals", { p_start: start, p_end: end }),
    async () => {
      const res = await fetchAll(
        (from, to) =>
          db()
            .from("transactions")
            .select("kind, amount_idr, occurred_at, category_id")
            .gte("occurred_at", start)
            .lt("occurred_at", end)
            .eq("kind", "expense")
            .in("category_id", categoryIds)
            .order("id")
            .range(from, to),
        { hardCap: 50_000 },
      );
      if (res.error) throw new Error(res.error.message);
      return sumMonthCategories(res.data ?? []);
    },
  );
  const out = new Map<string, Map<string, number>>();
  for (const row of normalizeTotals(r.rows)) {
    if (!row.category_id) continue;
    const m = out.get(row.category_id) ?? new Map<string, number>();
    m.set(row.month, (m.get(row.month) ?? 0) + row.total);
    out.set(row.category_id, m);
  }
  return out;
}

/** Carry into `month` per budget id for the given rollover budgets (empty map when none). */
export async function rolloverCarries(
  month: string,
  budgets: readonly RolloverBudget[],
): Promise<Map<string, number>> {
  const carries = new Map<string, number>();
  if (!budgets.length) return carries;
  const startMonth = budgets
    .map((b) => rolloverStart(month, b.created_at?.slice(0, 7)))
    .reduce((a, b) => (a < b ? a : b));
  if (startMonth >= month) {
    for (const b of budgets) carries.set(b.id, 0);
    return carries;
  }
  const spent = await spentByMonthCategory(
    monthRange(startMonth).start,
    monthRange(month).start,
    budgets.map((b) => b.category_id),
  );
  for (const b of budgets)
    carries.set(
      b.id,
      rolloverCarry(
        b.amount,
        month,
        b.created_at?.slice(0, 7),
        spent.get(b.category_id) ?? new Map(),
      ),
    );
  return carries;
}

/** Records a crossing; false when it was already alerted this month. Missing table → true. */
async function claimAlert(budgetId: string, month: string, level: number): Promise<boolean> {
  const res = await db().from("budget_alerts").insert({ budget_id: budgetId, month, level });
  if (!res.error) return true;
  if (/duplicate key|23505/i.test(`${res.error.message} ${res.error.code ?? ""}`)) return false;
  const { isMissingTable } = await import("./finance.server");
  if (isMissingTable(res.error)) return true; // v11 not run: alert without dedup
  throw new Error(res.error.message);
}

type TxLike = {
  kind: string;
  category_id?: string | null;
  amount_idr?: number | string | null;
  occurred_at: string;
};

/**
 * Budget threshold crossings caused by a just-inserted expense in the current month. Never throws:
 * failures are logged and yield no alerts, so saving a transaction is never affected.
 */
export async function budgetAlertsFor(tx: TxLike | null | undefined): Promise<BudgetAlert[]> {
  try {
    if (!tx || tx.kind !== "expense" || !tx.category_id) return [];
    const { computeBudgets, today } = await import("./finance.server");
    const month = today().slice(0, 7);
    if (String(tx.occurred_at).slice(0, 7) !== month) return [];
    const b = (await computeBudgets(month)).find((x) => x.category_id === tx.category_id);
    if (!b) return [];
    const added = Number(tx.amount_idr) || 0;
    const before = budgetPercent(b.spent - added, b.effective, b.amount);
    const levels = crossedLevels(before, b.percent, b.alert_percent);
    const out: BudgetAlert[] = [];
    for (const level of levels)
      if (await claimAlert(b.id, month, level))
        out.push({
          budget_id: b.id,
          category: b.category,
          level,
          percent: b.percent,
          spent: b.spent,
          effective: b.effective,
          alert_percent: b.alert_percent,
        });
    return out;
  } catch (e) {
    logError("budget.alerts", e);
    return [];
  }
}

/** Telegram lines appended to the "saved" reply ("" when there is nothing to report). */
export function budgetAlertLines(alerts: readonly BudgetAlert[]): string {
  return alerts.length ? `\n\n${alerts.map(budgetAlertText).join("\n")}` : "";
}
