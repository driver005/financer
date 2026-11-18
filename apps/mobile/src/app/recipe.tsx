import React, { useCallback, useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Badge, Button, Card, Checkbox, Empty, IconButton, Loading, Note, Screen, SectionTitle, Segmented, Stepper, Text } from "../ui/primitives";
import { tokens, useTheme } from "../ui/theme";
import { cachedRecipe, cacheRecipe, favorite, isFavorite, unfavorite } from "../db/recipes";
import { addIngredients } from "../db/shopping";
import { getStores } from "../db/money";
import { recipeApp } from "../lib/providerRust";
import { core } from "../rust/core";
import type { Recipe, Scope, Store } from "../lib/types";

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFav, setIsFav] = useState(false);
  const [servings, setServings] = useState(2);
  const [scope, setScope] = useState<Scope>("week");
  const [stores, setStores] = useState<Store[]>([]);
  const [store, setStore] = useState("");
  const [added, setAdded] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cached = await cachedRecipe(id);
        const found = cached ?? await recipeApp.byId(id);
        if (!found) throw new Error("Recipe not found");
        if (!cached) await cacheRecipe(found);
        if (!alive) return;
        setRecipe(found);
        setServings(found.servings);
        setIsFav(await isFavorite(id));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load recipe");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    void getStores().then((rows) => { if (alive) { setStores(rows); setStore(rows[0]?.id ?? ""); } });
    return () => { alive = false; };
  }, [id]);

  const toggleFav = useCallback(async () => {
    if (!recipe) return;
    if (isFav) { await unfavorite(recipe.id); setIsFav(false); }
    else { await favorite(recipe); setIsFav(true); }
  }, [recipe, isFav]);

  const addAll = useCallback(async () => {
    if (!recipe) return;
    const ingredients = recipe.ingredients.map((i) => ({ name: i.name, amount: core.scaleAmount(i.amount, servings, recipe.servings) }));
    const count = await addIngredients(ingredients, scope, core.periodKey(scope, new Date()), recipe.id, store);
    setAdded(count);
  }, [recipe, servings, scope, store]);

  if (loading) return <Screen title="Recipe" back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}><Loading rows={5} /></Screen>;
  if (!recipe) return <Screen title="Recipe" back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}><Empty title="Not available" message={error ?? "This recipe could not be loaded."} /></Screen>;

  return (
    <Screen
      title={recipe.title}
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
      action={<IconButton icon={isFav ? "heart" : "heart-outline"} label={isFav ? "Remove from saved" : "Save recipe"} onPress={() => void toggleFav()} />}
    >
      {recipe.image ? <Image source={{ uri: recipe.image }} style={styles.cover} /> : null}
      <View style={styles.badges}>
        <Badge label={recipe.category || "Recipe"} />
        {recipe.area ? <Badge label={recipe.area} /> : null}
        <Badge label={`${recipe.minutes} min`} />
      </View>
      {recipe.summary ? <Text color="muted">{recipe.summary}</Text> : null}

      <Card>
        <SectionTitle>Add to shopping list</SectionTitle>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[{ value: "week", label: "This week" }, { value: "month", label: "This month" }]}
        />
        <View style={styles.stores}>
          {stores.map((s) => (
            <Checkbox key={s.id} checked={store === s.id} onPress={() => setStore(s.id)} label={s.name} />
          ))}
        </View>
        <Button label={`Add ${recipe.ingredients.length} ingredients`} onPress={() => void addAll()} />
        {added > 0 ? <Note tone="success">{added} ingredients added to your {scope} list.</Note> : null}
      </Card>

      <SectionTitle>Ingredients</SectionTitle>
      <View style={styles.servings}>
        <Text>Servings: {servings}</Text>
        <Stepper value={servings} onChange={setServings} />
      </View>
      <Card>
        {recipe.ingredients.map((ingredient, i) => (
          <View key={`${ingredient.name}-${i}`} style={styles.ingredient}>
            <Text variant="caption" color="accent">{core.scaleAmount(ingredient.amount, servings, recipe.servings)}</Text>
            <Text>{ingredient.name}</Text>
          </View>
        ))}
      </Card>

      <SectionTitle>Method</SectionTitle>
      <Card>
        {recipe.steps.map((step, i) => (
          <View key={i} style={styles.step}>
            <Badge label={String(i + 1)} tone="accent" />
            <Text>{step}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cover: { width: "100%", height: 200, borderRadius: tokens.radius.md },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: tokens.xs },
  stores: { flexDirection: "row", flexWrap: "wrap", gap: tokens.md },
  servings: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ingredient: { flexDirection: "row", gap: tokens.md, alignItems: "baseline" },
  step: { flexDirection: "row", gap: tokens.sm, alignItems: "flex-start" },
});
