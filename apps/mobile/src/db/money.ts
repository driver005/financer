import { getDb } from "./database";
import { core } from "../rust/core";
import type { Offer, Store, Transaction } from "../lib/types";

export async function transactions(month?: string): Promise<Transaction[]> {
  const db = await getDb();
  return month
    ? db.getAllAsync<Transaction>("SELECT * FROM transactions WHERE date LIKE ? ORDER BY date DESC", `${month}%`)
    : db.getAllAsync<Transaction>("SELECT * FROM transactions ORDER BY date DESC LIMIT 500");
}

export async function saveTransactions(rows: Transaction[]): Promise<number> {
  const db = await getDb();
  const stores = await getStores();
  let saved = 0;
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      if (row.externalId) {
        const existing = await db.getFirstAsync<{ id: number }>(
          "SELECT id FROM transactions WHERE source = ? AND externalId = ?",
          row.source, row.externalId,
        );
        if (existing) continue;
      }
      const result = await db.runAsync(
        "INSERT INTO transactions (date, merchant, amountCents, category, storeId, source, externalId) VALUES (?, ?, ?, ?, ?, ?, ?)",
        row.date, row.merchant, row.amountCents, row.category,
        row.storeId ?? core.matchStore(row.merchant, stores), row.source, row.externalId,
      );
      saved += result.changes;
    }
  });
  return saved;
}

export async function addTransaction(row: Omit<Transaction, "id">): Promise<void> {
  const db = await getDb();
  const stores = await getStores();
  await db.runAsync(
    "INSERT INTO transactions (date, merchant, amountCents, category, storeId, source, externalId) VALUES (?, ?, ?, ?, ?, ?, ?)",
    row.date, row.merchant, row.amountCents, row.category, row.storeId ?? core.matchStore(row.merchant, stores), row.source, row.externalId,
  );
}

export async function setTransactionStore(id: number, storeId: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE transactions SET storeId = ? WHERE id = ?", storeId, id);
}

export async function deleteTransaction(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM transactions WHERE id = ?", id);
}

export async function autoMatchStores(): Promise<number> {
  const db = await getDb();
  const stores = await getStores();
  const rows = await db.getAllAsync<{ id: number; merchant: string }>("SELECT id, merchant FROM transactions WHERE storeId IS NULL");
  let matched = 0;
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const found = core.matchStore(row.merchant, stores);
      if (found) {
        await db.runAsync("UPDATE transactions SET storeId = ? WHERE id = ?", found, row.id);
        matched += 1;
      }
    }
  });
  return matched;
}

export async function getStores(): Promise<Store[]> {
  const db = await getDb();
  return db.getAllAsync<Store>("SELECT * FROM stores ORDER BY name");
}

export async function saveStore(store: Store): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO stores (id, name, aliases, active) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, aliases = excluded.aliases, active = excluded.active", store.id, store.name, store.aliases, store.active);
}

export async function offers(storeId?: string): Promise<Offer[]> {
  const db = await getDb();
  return storeId
    ? db.getAllAsync<Offer>("SELECT * FROM offers WHERE storeId = ? ORDER BY validTo, product", storeId)
    : db.getAllAsync<Offer>("SELECT * FROM offers ORDER BY validTo, product");
}

export async function saveOffers(rows: Offer[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      await db.runAsync(
        "INSERT INTO offers (storeId, product, price, note, validFrom, validTo, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        row.storeId, row.product, row.price, row.note, row.validFrom, row.validTo, row.source, row.createdAt,
      );
    }
  });
  await db.runAsync("DELETE FROM offers WHERE validTo < ?", new Date().toISOString().slice(0, 10));
}

export async function deleteOffer(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM offers WHERE id = ?", id);
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  await db.execAsync("DELETE FROM transactions; DELETE FROM offers; DELETE FROM shopping_items; DELETE FROM favorites; DELETE FROM recipes_cache; DELETE FROM purchases; DELETE FROM prices; DELETE FROM settings;");
}
