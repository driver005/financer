import { getDb } from "./database";

export type Purchase = { id: number; storeId: string; name: string; qty: string; createdAt: number };

export async function purchases(storeId?: string): Promise<Purchase[]> {
  const db = await getDb();
  return storeId
    ? db.getAllAsync<Purchase>("SELECT * FROM purchases WHERE storeId = ? ORDER BY name COLLATE NOCASE", storeId)
    : db.getAllAsync<Purchase>("SELECT * FROM purchases ORDER BY storeId, name COLLATE NOCASE");
}

export async function savePurchases(rows: { storeId: string; name: string; qty: string }[]): Promise<number> {
  const db = await getDb();
  let saved = 0;
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const existing = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM purchases WHERE storeId = ? AND name = ? COLLATE NOCASE LIMIT 1", row.storeId, row.name,
      );
      if (existing) {
        await db.runAsync("UPDATE purchases SET qty = ? WHERE id = ?", row.qty, existing.id);
      } else {
        await db.runAsync("INSERT INTO purchases (storeId, name, qty, createdAt) VALUES (?, ?, ?, ?)", row.storeId, row.name, row.qty, Date.now());
      }
      saved += 1;
    }
  });
  return saved;
}

export async function deletePurchase(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM purchases WHERE id = ?", id);
}

export async function clearPurchases(storeId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM purchases WHERE storeId = ?", storeId);
}
