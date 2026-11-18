import { getDb } from "./database";
import type { Scope, ShoppingItem } from "../lib/types";

export async function shoppingList(scope: Scope, period: string): Promise<ShoppingItem[]> {
  const db = await getDb();
  return db.getAllAsync<ShoppingItem>("SELECT * FROM shopping_items WHERE scope = ? AND period = ? ORDER BY checked, name COLLATE NOCASE", scope, period);
}

export async function shoppingItem(id: number): Promise<ShoppingItem | null> {
  const db = await getDb();
  return db.getFirstAsync<ShoppingItem>("SELECT * FROM shopping_items WHERE id = ?", id);
}

export async function addShoppingItem(item: Omit<ShoppingItem, "id" | "createdAt" | "checked"> & { checked?: number }): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO shopping_items (name, qty, scope, period, store, recipeId, checked, offerPrice, offerProduct, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
    item.name, item.qty, item.scope, item.period, item.store, item.recipeId, item.offerPrice ?? "", item.offerProduct ?? "", Date.now(),
  );
}

export async function addIngredients(ingredients: { name: string; amount: string }[], scope: Scope, period: string, recipeId: string, store: string): Promise<number> {
  const db = await getDb();
  let added = 0;
  await db.withTransactionAsync(async () => {
    for (const ingredient of ingredients) {
      const existing = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM shopping_items WHERE name = ? COLLATE NOCASE AND scope = ? AND period = ? LIMIT 1",
        ingredient.name, scope, period,
      );
      if (existing) {
        await db.runAsync("UPDATE shopping_items SET qty = ? WHERE id = ?", ingredient.amount, existing.id);
      } else {
        await db.runAsync(
          "INSERT INTO shopping_items (name, qty, scope, period, store, recipeId, checked, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
          ingredient.name, ingredient.amount, scope, period, store, recipeId, Date.now(),
        );
      }
      added += 1;
    }
  });
  return added;
}

export async function toggleShoppingItem(id: number, checked: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE shopping_items SET checked = ? WHERE id = ?", checked ? 1 : 0, id);
}

export async function removeShoppingItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM shopping_items WHERE id = ?", id);
}

export async function clearChecked(scope: Scope, period: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM shopping_items WHERE scope = ? AND period = ? AND checked = 1", scope, period);
}
