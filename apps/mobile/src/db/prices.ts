import { getDb } from "./database";

export type PriceRow = { id: number; storeId: string; name: string; cents: number; date: string; source: string };

export async function allPrices(): Promise<PriceRow[]> {
  const db = await getDb();
  return db.getAllAsync<PriceRow>("SELECT * FROM prices ORDER BY date");
}

export async function pricesFor(name: string): Promise<PriceRow[]> {
  const db = await getDb();
  return db.getAllAsync<PriceRow>("SELECT * FROM prices WHERE name = ? COLLATE NOCASE ORDER BY date", name);
}

export async function addPrice(row: { storeId: string; name: string; cents: number; date: string }): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO prices (storeId, name, cents, date, source) VALUES (?, ?, ?, ?, 'manual')", row.storeId, row.name, row.cents, row.date);
}

export async function clearSamplePrices(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM prices WHERE source = 'sample'");
}
