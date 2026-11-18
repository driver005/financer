import { core } from "../rust/core";
import { recipeRaw } from "./provider";
import type { Recipe } from "./types";

/** The app's recipe provider: network in this module, normalisation in Rust. */
export const recipeApp = {
  name: recipeRaw.name,
  async search(query: string): Promise<Recipe[]> {
    return (await recipeRaw.search(query)).map((meal) => core.normalizeMeal(meal) as unknown as Recipe);
  },
  async byId(id: string): Promise<Recipe | null> {
    const meals = await recipeRaw.byId(id);
    return meals[0] ? (core.normalizeMeal(meals[0]) as unknown as Recipe) : null;
  },
  async random(count = 10): Promise<Recipe[]> {
    const seen = new Set<string>();
    const out: Recipe[] = [];
    for (let attempt = 0; attempt < count * 3 && out.length < count; attempt += 1) {
      const meals = await recipeRaw.random();
      const meal = meals[0];
      if (!meal || !meal.idMeal || seen.has(meal.idMeal)) continue;
      seen.add(meal.idMeal);
      out.push(core.normalizeMeal(meal) as unknown as Recipe);
    }
    return out;
  },
};
