import { getDb } from "./database";

export type Account = {
  id: string; name: string; balanceCents: number; kind: string;
  currency: string; settlementDay: number; outstandingCents: number;
};
export type Rate = { code: string; rate: number };
export type Debt = { id: number; name: string; totalCents: number; paidCents: number; dueDate: string };
export type StandingOrder = { id: number; name: string; amountCents: number; dayOfMonth: number; target: string; active: number };
export type Category = { id: number; name: string; parent: string };
export type Goal = { id: number; name: string; targetCents: number; savedCents: number; dueDate: string };
export type Receipt = { id: number; merchant: string; date: string; amountCents: number; warrantyUntil: string; note: string; tags: string };
export type LedgerEntry = { id: number; txId: string; accountId: string; side: "debit" | "credit"; cents: number };
export type Budget = { id: number; category: string; limitCents: number; rolloverCents: number };
export type Recurring = { id: number; name: string; amountCents: number; dayOfMonth: number; category: string; active: number };
export type Bookmark = { id: number; name: string; amountCents: number; category: string };

export async function accounts(): Promise<Account[]> {
  const db = await getDb();
  return db.getAllAsync<Account>("SELECT * FROM accounts ORDER BY name");
}

export async function addAccount(name: string, kind = "bank"): Promise<void> {
  const db = await getDb();
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  await db.runAsync("INSERT INTO accounts (id, name, balanceCents, kind) VALUES (?, ?, 0, ?)", id, name, kind);
}

export async function transfer(fromId: string, toId: string, cents: number): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE accounts SET balanceCents = balanceCents - ? WHERE id = ?", cents, fromId);
    await db.runAsync("UPDATE accounts SET balanceCents = balanceCents + ? WHERE id = ?", cents, toId);
    const today = new Date().toISOString().slice(0, 10);
    const txId = `transfer-${Date.now()}`;
    await db.runAsync("INSERT INTO transactions (date, merchant, amountCents, category, storeId, source, externalId, accountId, kind) VALUES (?, 'Transfer', ?, 'Transfer', NULL, 'manual', ?, ?, 'transfer')", today, cents, `${txId}-out`, fromId);
    await db.runAsync("INSERT INTO transactions (date, merchant, amountCents, category, storeId, source, externalId, accountId, kind) VALUES (?, 'Transfer in', ?, 'Transfer', NULL, 'manual', ?, ?, 'transfer')", today, cents, `${txId}-in`, toId);
    await db.runAsync("INSERT INTO ledger_entries (txId, accountId, side, cents) VALUES (?, ?, 'debit', ?)", txId, fromId, cents);
    await db.runAsync("INSERT INTO ledger_entries (txId, accountId, side, cents) VALUES (?, ?, 'credit', ?)", txId, toId, cents);
  });
}

export async function budgets(): Promise<Budget[]> {
  const db = await getDb();
  return db.getAllAsync<Budget>("SELECT * FROM budgets ORDER BY category");
}

export async function setBudget(category: string, limitCents: number, rolloverCents = 0, includeChildren = true): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO budgets (category, limitCents, rolloverCents, includeChildren) VALUES (?, ?, ?, ?) ON CONFLICT(category) DO UPDATE SET limitCents = excluded.limitCents, rolloverCents = excluded.rolloverCents, includeChildren = excluded.includeChildren", category, limitCents, rolloverCents, includeChildren ? 1 : 0);
}

export async function deleteBudget(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM budgets WHERE id = ?", id);
}

export async function recurringList(): Promise<Recurring[]> {
  const db = await getDb();
  return db.getAllAsync<Recurring>("SELECT * FROM recurring ORDER BY dayOfMonth");
}

export async function addRecurring(row: Omit<Recurring, "id">): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO recurring (name, amountCents, dayOfMonth, category, active) VALUES (?, ?, ?, ?, ?)", row.name, row.amountCents, row.dayOfMonth, row.category, row.active);
}

export async function deleteRecurring(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM recurring WHERE id = ?", id);
}

export async function bookmarks(): Promise<Bookmark[]> {
  const db = await getDb();
  return db.getAllAsync<Bookmark>("SELECT * FROM bookmarks ORDER BY name");
}

export async function addBookmark(name: string, amountCents: number, category: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO bookmarks (name, amountCents, category) VALUES (?, ?, ?)", name, amountCents, category);
}

export async function deleteBookmark(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM bookmarks WHERE id = ?", id);
}

export async function rates(): Promise<Rate[]> {
  const db = await getDb();
  return db.getAllAsync<Rate>("SELECT * FROM rates ORDER BY code");
}

export async function setRate(code: string, rate: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO rates (code, rate) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET rate = excluded.rate", code.toUpperCase(), rate);
}

export async function setCardDetails(accountId: string, settlementDay: number, outstandingCents: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE accounts SET settlementDay = ?, outstandingCents = ? WHERE id = ?", settlementDay, outstandingCents, accountId);
}

export async function setAccountCurrency(accountId: string, currency: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE accounts SET currency = ? WHERE id = ?", currency.toUpperCase(), accountId);
}

export async function debts(): Promise<Debt[]> {
  const db = await getDb();
  return db.getAllAsync<Debt>("SELECT * FROM debts ORDER BY dueDate");
}

export async function addDebt(name: string, totalCents: number, dueDate: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO debts (name, totalCents, paidCents, dueDate) VALUES (?, ?, 0, ?)", name, totalCents, dueDate);
}

export async function payDebt(id: number, cents: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE debts SET paidCents = paidCents + ? WHERE id = ?", cents, id);
}

export async function deleteDebt(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM debts WHERE id = ?", id);
}

export async function standingOrders(): Promise<StandingOrder[]> {
  const db = await getDb();
  return db.getAllAsync<StandingOrder>("SELECT * FROM standing_orders ORDER BY dayOfMonth");
}

export async function addStandingOrder(name: string, amountCents: number, dayOfMonth: number, target: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO standing_orders (name, amountCents, dayOfMonth, target, active) VALUES (?, ?, ?, ?, 1)", name, amountCents, dayOfMonth, target);
}

export async function deleteStandingOrder(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM standing_orders WHERE id = ?", id);
}

export async function categories(): Promise<Category[]> {
  const db = await getDb();
  return db.getAllAsync<Category>("SELECT * FROM categories ORDER BY parent, name");
}

export async function addCategory(name: string, parent: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO categories (name, parent) VALUES (?, ?)", name, parent);
}

export async function goals(): Promise<Goal[]> {
  const db = await getDb();
  return db.getAllAsync<Goal>("SELECT * FROM savings_goals ORDER BY dueDate");
}

export async function addGoal(name: string, targetCents: number, dueDate: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO savings_goals (name, targetCents, savedCents, dueDate) VALUES (?, ?, 0, ?)", name, targetCents, dueDate);
}

export async function contributeGoal(id: number, cents: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE savings_goals SET savedCents = savedCents + ? WHERE id = ?", cents, id);
}

export async function deleteGoal(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM savings_goals WHERE id = ?", id);
}

export async function receipts(): Promise<Receipt[]> {
  const db = await getDb();
  return db.getAllAsync<Receipt>("SELECT * FROM receipts ORDER BY date DESC");
}

export async function addReceipt(row: Omit<Receipt, "id">): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO receipts (merchant, date, amountCents, warrantyUntil, note, tags) VALUES (?, ?, ?, ?, ?, ?)", row.merchant, row.date, row.amountCents, row.warrantyUntil, row.note, row.tags);
}

export async function deleteReceipt(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM receipts WHERE id = ?", id);
}

export async function ledgerEntries(): Promise<LedgerEntry[]> {
  const db = await getDb();
  return db.getAllAsync<LedgerEntry>("SELECT * FROM ledger_entries");
}

export async function updateTransaction(id: number, fields: { date?: string; merchant?: string; amountCents?: number; category?: string }): Promise<void> {
  const db = await getDb();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    await db.runAsync(`UPDATE transactions SET ${key} = ? WHERE id = ?`, value, id);
  }
}

export async function updateTransactionMeta(id: number, meta: { tags?: string; latitude?: number | null; longitude?: number | null; subcategory?: string }): Promise<void> {
  const db = await getDb();
  if (meta.tags !== undefined) await db.runAsync("UPDATE transactions SET tags = ? WHERE id = ?", meta.tags, id);
  if (meta.subcategory !== undefined) await db.runAsync("UPDATE transactions SET subcategory = ? WHERE id = ?", meta.subcategory, id);
  if (meta.latitude !== undefined) await db.runAsync("UPDATE transactions SET latitude = ? WHERE id = ?", meta.latitude, id);
  if (meta.longitude !== undefined) await db.runAsync("UPDATE transactions SET longitude = ? WHERE id = ?", meta.longitude, id);
}

export type NewTransaction = {
  date: string; merchant: string; amountCents: number; category: string;
  kind: "expense" | "income"; accountId: string; currency?: string; tags?: string;
};

export async function addMoneyTransaction(row: NewTransaction): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      "INSERT INTO transactions (date, merchant, amountCents, category, storeId, source, externalId, accountId, kind, currency, tags) VALUES (?, ?, ?, ?, NULL, 'manual', NULL, ?, ?, ?, ?)",
      row.date, row.merchant, row.amountCents, row.category, row.accountId, row.kind, row.currency ?? "EUR", row.tags ?? "",
    );
    const txId = String(result.lastInsertRowId);
    const accountSide = row.kind === "income" ? "credit" : "debit";
    const otherSide = row.kind === "income" ? "debit" : "credit";
    const otherAccount = row.kind === "income" ? `income:${row.category}` : `expense:${row.category}`;
    if (row.accountId) {
      await db.runAsync("INSERT INTO ledger_entries (txId, accountId, side, cents) VALUES (?, ?, ?, ?)", txId, row.accountId, accountSide, row.amountCents);
      await db.runAsync("INSERT INTO ledger_entries (txId, accountId, side, cents) VALUES (?, ?, ?, ?)", txId, otherAccount, otherSide, row.amountCents);
      const delta = row.kind === "income" ? row.amountCents : -row.amountCents;
      await db.runAsync("UPDATE accounts SET balanceCents = balanceCents + ? WHERE id = ?", delta, row.accountId);
    }
  });
}

export async function allTransactions(): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  return db.getAllAsync<Record<string, unknown>>("SELECT * FROM transactions ORDER BY date DESC");
}
