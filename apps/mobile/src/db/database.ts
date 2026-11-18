import * as SQLite from "expo-sqlite";
import { SUPERMARKETS } from "../lib/stores";

export type Db = SQLite.SQLiteDatabase;

let dbPromise: Promise<Db> | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS recipes_cache (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorites (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shopping_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL, qty TEXT NOT NULL, scope TEXT NOT NULL, period TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT '', recipeId TEXT, checked INTEGER NOT NULL DEFAULT 0,
  offerPrice TEXT NOT NULL DEFAULT '', offerProduct TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, aliases TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, storeId TEXT NOT NULL, name TEXT NOT NULL, qty TEXT NOT NULL DEFAULT '1', createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS prices (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, storeId TEXT NOT NULL, name TEXT NOT NULL, cents INTEGER NOT NULL, date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual');
CREATE INDEX IF NOT EXISTS price_lookup ON prices(name, storeId, date);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, storeId TEXT NOT NULL, product TEXT NOT NULL,
  price TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', validFrom TEXT NOT NULL, validTo TEXT NOT NULL,
  source TEXT NOT NULL, createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, date TEXT NOT NULL, merchant TEXT NOT NULL,
  amountCents INTEGER NOT NULL, category TEXT NOT NULL, storeId TEXT, source TEXT NOT NULL,
  externalId TEXT, UNIQUE(source, externalId)
);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, balanceCents INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'bank');
CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, category TEXT NOT NULL, limitCents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recurring (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, amountCents INTEGER NOT NULL, dayOfMonth INTEGER NOT NULL, category TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, amountCents INTEGER NOT NULL, category TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rates (code TEXT PRIMARY KEY NOT NULL, rate REAL NOT NULL);
CREATE TABLE IF NOT EXISTS debts (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, totalCents INTEGER NOT NULL, paidCents INTEGER NOT NULL DEFAULT 0, dueDate TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS standing_orders (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, amountCents INTEGER NOT NULL, dayOfMonth INTEGER NOT NULL, target TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS ledger_entries (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, txId TEXT NOT NULL, accountId TEXT NOT NULL, side TEXT NOT NULL, cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS savings_goals (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, targetCents INTEGER NOT NULL, savedCents INTEGER NOT NULL DEFAULT 0, dueDate TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, parent TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, merchant TEXT NOT NULL, date TEXT NOT NULL, amountCents INTEGER NOT NULL, warrantyUntil TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS shared_snapshot (id INTEGER PRIMARY KEY NOT NULL, json TEXT NOT NULL, loadedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS envelopes (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, balanceCents INTEGER NOT NULL DEFAULT 0, limitCents INTEGER NOT NULL DEFAULT 0, rollover INTEGER NOT NULL DEFAULT 1, period TEXT NOT NULL DEFAULT 'month');
CREATE TABLE IF NOT EXISTS envelope_funding (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, envelopeId INTEGER NOT NULL, cents INTEGER NOT NULL, date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goal_checklist (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, goalId INTEGER NOT NULL, title TEXT NOT NULL, amountCents INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, link TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS paychecks (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, date TEXT NOT NULL, takeHomeCents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS paycheck_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, paycheckId INTEGER NOT NULL, label TEXT NOT NULL, cents INTEGER NOT NULL, kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, number TEXT NOT NULL, customer TEXT NOT NULL, totalCents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft');
CREATE TABLE IF NOT EXISTS invoice_items (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, invoiceId INTEGER NOT NULL, description TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1, cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS account_valuations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, accountId TEXT NOT NULL, date TEXT NOT NULL, valueCents INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'manual');
CREATE TABLE IF NOT EXISTS splits (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, receiptId INTEGER NOT NULL, person TEXT NOT NULL, sharePercent REAL NOT NULL);
CREATE TABLE IF NOT EXISTS gold_holdings (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, grams REAL NOT NULL, buyCentsPerGram INTEGER NOT NULL, currentCentsPerGram INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS receivables (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, totalCents INTEGER NOT NULL, paidCents INTEGER NOT NULL DEFAULT 0, dueDate TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, amountCents INTEGER NOT NULL, interval TEXT NOT NULL DEFAULT 'monthly', startDate TEXT NOT NULL, taxPercent REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_log (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, command TEXT NOT NULL, resultJson TEXT NOT NULL, createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ocr_receipts (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, uri TEXT NOT NULL DEFAULT '', merchant TEXT NOT NULL, amountCents INTEGER NOT NULL, itemsJson TEXT NOT NULL DEFAULT '[]', createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payment_methods (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'bank');
CREATE TABLE IF NOT EXISTS invoice_payments (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, invoiceId INTEGER NOT NULL, methodId INTEGER NOT NULL, cents INTEGER NOT NULL, proofUri TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS project_groups (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, groupId INTEGER NOT NULL, name TEXT NOT NULL, targetCents INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS project_purchases (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, projectId INTEGER NOT NULL, name TEXT NOT NULL, cents INTEGER NOT NULL, funded INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS bill_confirmations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, billCents INTEGER NOT NULL, paidCents INTEGER NOT NULL, resultJson TEXT NOT NULL, createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS credit_commitments (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, balanceCents INTEGER NOT NULL, monthlyCents INTEGER NOT NULL, aprPercent REAL NOT NULL DEFAULT 18);
CREATE TABLE IF NOT EXISTS onboarding_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goal_funding (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, goalId INTEGER NOT NULL, cents INTEGER NOT NULL, date TEXT NOT NULL);
`;

const SAMPLE_ITEMS = ["Milk", "Bread", "Eggs", "Chicken", "Rice", "Pasta", "Bananas", "Coffee"];
const SAMPLE_STORES = ["rewe", "kaufland", "lidl", "aldi", "penny", "netto"];

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

/** Local sample price history so price curves work before the user enters real prices. */
async function seedSamplePrices(db: Db): Promise<void> {
  const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM prices");
  if (count && count.n > 0) return;
  const today = new Date();
  for (const name of SAMPLE_ITEMS) {
    for (const storeId of SAMPLE_STORES) {
      const base = 90 + (hash(`${name}-${storeId}`) % 260);
      for (let w = 7; w >= 0; w -= 1) {
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - w * 7);
        const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
        const wave = Math.sin((hash(name) % 7) + w * 0.9) * 0.09;
        const offer = w === 2 || w === 5 ? -0.18 : 0;
        const cents = Math.max(39, Math.round(base * (1 + wave + offer) / 5) * 5);
        await db.runAsync("INSERT INTO prices (storeId, name, cents, date, source) VALUES (?, ?, ?, ?, 'sample')", storeId, name, cents, iso);
      }
    }
  }
}

export async function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("pantry.db");
      await db.execAsync(SCHEMA);
      const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(shopping_items)");
      const names = columns.map((c) => c.name);
      if (!names.includes("offerPrice")) await db.execAsync("ALTER TABLE shopping_items ADD COLUMN offerPrice TEXT NOT NULL DEFAULT ''");
      if (!names.includes("offerProduct")) await db.execAsync("ALTER TABLE shopping_items ADD COLUMN offerProduct TEXT NOT NULL DEFAULT ''");
      const txColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
      const txNames = txColumns.map((c) => c.name);
      if (!txNames.includes("accountId")) await db.execAsync("ALTER TABLE transactions ADD COLUMN accountId TEXT NOT NULL DEFAULT ''");
      if (!txNames.includes("kind")) await db.execAsync("ALTER TABLE transactions ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense'");
      if (!txNames.includes("currency")) await db.execAsync("ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'");
      if (!txNames.includes("tags")) await db.execAsync("ALTER TABLE transactions ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
      if (!txNames.includes("latitude")) await db.execAsync("ALTER TABLE transactions ADD COLUMN latitude REAL");
      if (!txNames.includes("longitude")) await db.execAsync("ALTER TABLE transactions ADD COLUMN longitude REAL");
      if (!txNames.includes("subcategory")) await db.execAsync("ALTER TABLE transactions ADD COLUMN subcategory TEXT NOT NULL DEFAULT ''");
      const budgetColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(budgets)");
      if (!budgetColumns.some((c) => c.name === "rolloverCents")) await db.execAsync("ALTER TABLE budgets ADD COLUMN rolloverCents INTEGER NOT NULL DEFAULT 0");
      if (!budgetColumns.some((c) => c.name === "includeChildren")) await db.execAsync("ALTER TABLE budgets ADD COLUMN includeChildren INTEGER NOT NULL DEFAULT 1");
      const categoryColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(categories)");
      if (!categoryColumns.some((c) => c.name === "type")) await db.execAsync("ALTER TABLE categories ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'");
      if (!categoryColumns.some((c) => c.name === "archived")) await db.execAsync("ALTER TABLE categories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
      const goalColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(savings_goals)");
      if (!goalColumns.some((c) => c.name === "paused")) await db.execAsync("ALTER TABLE savings_goals ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
      if (!goalColumns.some((c) => c.name === "archived")) await db.execAsync("ALTER TABLE savings_goals ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
      const recurringColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(recurring)");
      if (!recurringColumns.some((c) => c.name === "frequency")) await db.execAsync("ALTER TABLE recurring ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly'");
      if (!recurringColumns.some((c) => c.name === "count")) await db.execAsync("ALTER TABLE recurring ADD COLUMN count INTEGER NOT NULL DEFAULT 12");
      if (!recurringColumns.some((c) => c.name === "startDate")) await db.execAsync("ALTER TABLE recurring ADD COLUMN startDate TEXT NOT NULL DEFAULT ''");
      const ocrColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(ocr_receipts)");
      if (!ocrColumns.some((c) => c.name === "photosJson")) await db.execAsync("ALTER TABLE ocr_receipts ADD COLUMN photosJson TEXT NOT NULL DEFAULT '[]'");
      const accColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(accounts)");
      const accNames = accColumns.map((c) => c.name);
      if (!accNames.includes("currency")) await db.execAsync("ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'");
      if (!accNames.includes("settlementDay")) await db.execAsync("ALTER TABLE accounts ADD COLUMN settlementDay INTEGER NOT NULL DEFAULT 0");
      if (!accNames.includes("outstandingCents")) await db.execAsync("ALTER TABLE accounts ADD COLUMN outstandingCents INTEGER NOT NULL DEFAULT 0");
      if (!accNames.includes("feesCents")) await db.execAsync("ALTER TABLE accounts ADD COLUMN feesCents INTEGER NOT NULL DEFAULT 0");
      const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM stores");
      if (!count || count.n === 0) {
        for (const store of SUPERMARKETS) {
          await db.runAsync("INSERT INTO stores (id, name, aliases, active) VALUES (?, ?, ?, ?)", store.id, store.name, store.aliases, store.active);
        }
      }
      await seedSamplePrices(db);
      const accountCount = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM accounts");
      if (!accountCount || accountCount.n === 0) {
        await db.runAsync("INSERT INTO accounts (id, name, balanceCents, kind) VALUES ('cash', 'Cash', 0, 'cash')");
        await db.runAsync("INSERT INTO accounts (id, name, balanceCents, kind) VALUES ('bank', 'Bank', 0, 'bank')");
      }
      const budgetCount = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM budgets");
      if (!budgetCount || budgetCount.n === 0) {
        await db.runAsync("INSERT INTO budgets (category, limitCents) VALUES ('Groceries', 25000)");
        await db.runAsync("INSERT INTO budgets (category, limitCents) VALUES ('Transport', 8000)");
      }
      const rateCount = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM rates");
      if (!rateCount || rateCount.n === 0) {
        await db.runAsync("INSERT INTO rates (code, rate) VALUES ('EUR', 1)");
        await db.runAsync("INSERT INTO rates (code, rate) VALUES ('USD', 1.1)");
        await db.runAsync("INSERT INTO rates (code, rate) VALUES ('GBP', 1.17)");
      }
      const categoryCount = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM categories");
      if (!categoryCount || categoryCount.n === 0) {
        const seeded: [string, string][] = [
          ["Coffee", "Leisure"], ["Restaurants", "Leisure"], ["Cinema", "Leisure"],
          ["Bus", "Transport"], ["Fuel", "Transport"], ["Train", "Transport"],
          ["Bakery", "Groceries"], ["Fruit", "Groceries"], ["Dairy", "Groceries"],
          ["Rent", "Housing"], ["Insurance", "Housing"],
        ];
        for (const [name, parent] of seeded) await db.runAsync("INSERT INTO categories (name, parent) VALUES (?, ?)", name, parent);
      }
      const bookmarkCount = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM bookmarks");
      if (!bookmarkCount || bookmarkCount.n === 0) {
        await db.runAsync("INSERT INTO bookmarks (name, amountCents, category) VALUES ('Coffee', 350, 'Leisure')");
        await db.runAsync("INSERT INTO bookmarks (name, amountCents, category) VALUES ('Bus ticket', 290, 'Transport')");
      }
      return db;
    })();
  }
  return dbPromise;
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}
