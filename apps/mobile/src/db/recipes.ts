import { getDb } from "./database";
import type { Recipe } from "../lib/types";

export async function cacheRecipe(recipe: Recipe): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO recipes_cache (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json", recipe.id, JSON.stringify(recipe));
}

export async function cachedRecipe(id: string): Promise<Recipe | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>("SELECT json FROM recipes_cache WHERE id = ?", id);
  return row ? (JSON.parse(row.json) as Recipe) : null;
}

export async function favorite(recipe: Recipe): Promise<void> {
  await cacheRecipe(recipe);
  const db = await getDb();
  await db.runAsync("INSERT OR REPLACE INTO favorites (id, json, createdAt) VALUES (?, ?, ?)", recipe.id, JSON.stringify(recipe), Date.now());
}

export async function unfavorite(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM favorites WHERE id = ?", id);
}

export async function isFavorite(id: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>("SELECT id FROM favorites WHERE id = ?", id);
  return row !== null;
}

export async function favorites(): Promise<Recipe[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>("SELECT json FROM favorites ORDER BY createdAt DESC");
  return rows.map((row) => JSON.parse(row.json) as Recipe);
}

export async function cachedSearch(query: string): Promise<Recipe[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(`SELECT json FROM recipes_cache WHERE json LIKE ? ORDER BY id LIMIT 30`, [`%${query}%`]);
  return rows.map((row) => JSON.parse(row.json) as Recipe);
}
