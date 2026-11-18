import type { Ingredient, Recipe } from "./types";

const BASE = "https://www.themealdb.com/api/json/v1/1";

type Meal = Record<string, string | null> & {
  idMeal: string;
  strMeal: string;
  strInstructions?: string | null;
};

async function get(path: string): Promise<Meal[]> {
  const response = await fetch(`${BASE}/${path}`);
  if (!response.ok) throw new Error(`Recipe provider returned ${response.status}`);
  const data = (await response.json()) as { meals: Meal[] | null };
  return data.meals ?? [];
}

export function normalizeMeal(meal: Meal): Recipe {
  const ingredients: Ingredient[] = [];
  for (let i = 1; i <= 20; i += 1) {
    const name = meal[`strIngredient${i}`];
    if (!name || !name.trim()) continue;
    const measure = meal[`strMeasure${i}`]?.trim() ?? "";
    ingredients.push({ name: name.trim(), amount: measure || "1" });
  }
  const steps = (meal.strInstructions ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    id: meal.idMeal,
    title: meal.strMeal,
    summary: meal.strArea ? `${meal.strArea} · ${meal.strCategory}` : meal.strCategory ?? "",
    image: meal.strMealThumb ?? undefined,
    category: meal.strCategory ?? "",
    area: meal.strArea ?? "",
    minutes: 30,
    servings: 2,
    ingredients,
    steps: steps.length ? steps : ["Prepare the ingredients, then cook until done."],
    source: "themealdb",
  };
}

/** Raw provider payloads. Business logic (normalisation) lives in Rust; see providerRust.ts. */
export const recipeRaw = {
  name: "TheMealDB",
  search(query: string): Promise<Meal[]> {
    if (!query.trim()) return Promise.resolve([]);
    return get(`search.php?s=${encodeURIComponent(query.trim())}`);
  },
  byId(id: string): Promise<Meal[]> {
    return get(`lookup.php?i=${encodeURIComponent(id)}`);
  },
  random(): Promise<Meal[]> {
    return get("random.php");
  },
};

export const recipeProvider = {
  name: "TheMealDB",
  async search(query: string): Promise<Recipe[]> {
    return (await recipeRaw.search(query)).map(normalizeMeal);
  },
  async byId(id: string): Promise<Recipe | null> {
    const meals = await recipeRaw.byId(id);
    return meals[0] ? normalizeMeal(meals[0]) : null;
  },
  async random(count = 10): Promise<Recipe[]> {
    const out: Recipe[] = [];
    for (let i = 0; i < count; i += 1) {
      const meals = await recipeRaw.random();
      if (meals[0]) out.push(normalizeMeal(meals[0]));
    }
    return out;
  },
};
