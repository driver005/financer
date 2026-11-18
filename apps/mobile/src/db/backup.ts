import { getDb } from "./database";

const TABLES = ["transactions", "accounts", "budgets", "recurring", "bookmarks", "rates", "debts", "standing_orders", "purchases", "prices", "stores", "shopping_items", "offers", "favorites", "recipes_cache", "settings", "ledger_entries", "savings_goals", "categories", "receipts", "shared_snapshot", "envelopes", "envelope_funding", "goal_checklist", "paychecks", "paycheck_allocations", "invoices", "invoice_items", "account_valuations", "splits", "gold_holdings", "receivables", "subscriptions", "chat_log", "ocr_receipts", "payment_methods", "invoice_payments", "project_groups", "projects", "project_purchases", "bill_confirmations", "credit_commitments", "onboarding_state", "goal_funding"];

/** Local backup file: the offline equivalent of the cloud sync in the Play Store apps. */
export async function exportBackup(): Promise<string> {
  const db = await getDb();
  const data: Record<string, unknown> = { version: 1, exportedAt: new Date().toISOString() };
  for (const table of TABLES) data[table] = await db.getAllAsync(`SELECT * FROM ${table}`);
  return JSON.stringify(data);
}

export async function loadSharedSnapshot(json: string): Promise<void> {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (!Array.isArray(parsed.transactions)) throw new Error("Not a Pantry backup");
  const db = await getDb();
  await db.runAsync("INSERT INTO shared_snapshot (id, json, loadedAt) VALUES ('partner', ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, loadedAt = excluded.loadedAt", json, new Date().toISOString());
}

export async function sharedTransactions(): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>("SELECT json FROM shared_snapshot WHERE id = 'partner'");
  if (!row) return [];
  const parsed = JSON.parse(row.json) as { transactions?: Record<string, unknown>[] };
  return parsed.transactions ?? [];
}

export async function clearSharedSnapshot(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM shared_snapshot WHERE id = 'partner'");
}

export async function importBackup(json: string): Promise<void> {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (parsed.version !== 1) throw new Error("Unsupported backup version");
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const table of TABLES) {
      const rows = parsed[table];
      if (!Array.isArray(rows)) continue;
      await db.runAsync(`DELETE FROM ${table}`);
      for (const row of rows) {
        const record = row as Record<string, unknown>;
        const keys = Object.keys(record).filter((key) => record[key] !== null);
        const values = keys.map((key) => record[key]);
        const placeholders = keys.map(() => "?").join(", ");
        await db.runAsync(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`, values as never);
      }
    }
  });
}
