import React, { useCallback, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text as RNText, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Badge, Button, Card, Chip, Empty, IconButton, Loading, Screen, Text, TextField } from "../ui/primitives";
import { tokens, useTheme } from "../ui/theme";
import { recipeApp } from "../lib/providerRust";
import { cacheRecipe, favorite, isFavorite, unfavorite } from "../db/recipes";
import type { Recipe } from "../lib/types";

const QUICK = ["Chicken", "Pasta", "Salad", "Beef", "Fish"];

export default function RecipesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipe[]>([]);
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const refreshFavorites = useCallback(async () => {
    const ids = await Promise.all(results.map((r) => isFavorite(r.id)));
    setFavs(Object.fromEntries(results.map((r, i) => [r.id, ids[i]])));
  }, [results]);

  useEffect(() => { void refreshFavorites(); }, [refreshFavorites]);

  useEffect(() => {
    if (initialLoaded) return;
    setInitialLoaded(true);
    (async () => {
      setLoading(true);
      try {
        const suggestions = await recipeApp.random(8);
        await Promise.all(suggestions.map(cacheRecipe));
        setResults(suggestions);
      } catch {
        // offline: the empty state offers another try
      } finally {
        setLoading(false);
      }
    })();
  }, [initialLoaded]);

  useFocusEffect(useCallback(() => {
    if (results.length) void refreshFavorites();
  }, [results.length, refreshFavorites]));

  const run = useCallback(async (fn: () => Promise<Recipe[]>) => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const recipes = await fn();
      await Promise.all(recipes.map(cacheRecipe));
      setResults(recipes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load recipes");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(async (recipe: Recipe) => {
    if (favs[recipe.id]) {
      await unfavorite(recipe.id);
      setFavs((prev) => ({ ...prev, [recipe.id]: false }));
    } else {
      await favorite(recipe);
      setFavs((prev) => ({ ...prev, [recipe.id]: true }));
    }
  }, [favs]);

  return (
    <Screen
      title="Recipes"
      subtitle="From TheMealDB. Save what you like, add it to your list."
      action={<IconButton icon="shuffle-variant" label="Surprise me" onPress={() => run(() => recipeApp.random(10))} />}
    >
      <TextField label="Find a recipe" value={query} onChangeText={setQuery} placeholder="e.g. Chicken curry" />
      <Button label="Search recipes" onPress={() => run(() => recipeApp.search(query))} disabled={!query.trim() || loading} />
      <View style={styles.chips}>
        {QUICK.map((term) => <Chip key={term} label={term} onPress={() => { setQuery(term); void run(() => recipeApp.search(term)); }} />)}
      </View>
      {error ? <Text color="danger">{error}</Text> : null}
      {loading ? <Loading rows={4} /> : null}
      {!loading && !results.length ? (
        <Empty
          icon="food-outline"
          title={searched ? "No recipes found" : "Find something to cook"}
          message={searched ? "Try another search or use Surprise me." : "Search the recipe provider or let it surprise you."}
          actionLabel={searched ? "Surprise me" : undefined}
          onAction={searched ? () => run(() => recipeApp.random(10)) : undefined}
        />
      ) : null}
      {results.map((recipe, index) => index === 0 && recipe.image ? (
        <FeaturedRecipe
          key={`${recipe.id}-${index}`}
          recipe={recipe}
          onPress={() => router.push({ pathname: "/recipe", params: { id: recipe.id } })}
          onSave={() => void toggle(recipe)}
          saved={!!favs[recipe.id]}
        />
      ) : (
        <Card key={`${recipe.id}-${index}`}>
          <View style={styles.row}>
            <Pressable style={styles.grow} onPress={() => router.push({ pathname: "/recipe", params: { id: recipe.id } })}>
              <View style={styles.row}>
                {recipe.image ? <Image source={{ uri: recipe.image }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: colors.accentSoft }]} />}
                <View style={styles.grow}>
                  <Text variant="subheading" numberOfLines={2}>{recipe.title}</Text>
                  <Text variant="caption" color="muted">{recipe.summary}</Text>
                  <View style={styles.badges}>
                    <Badge label={`${recipe.ingredients.length} ingredients`} />
                    <Badge label={`${recipe.minutes} min`} />
                  </View>
                </View>
              </View>
            </Pressable>
            <IconButton
              icon={favs[recipe.id] ? "heart" : "heart-outline"}
              label={favs[recipe.id] ? "Remove from saved" : "Save recipe"}
              onPress={() => void toggle(recipe)}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

function FeaturedRecipe({ recipe, onPress, onSave, saved }: {
  recipe: Recipe; onPress: () => void; onSave: () => void; saved: boolean;
}) {
  return (
    <View style={styles.featured}>
      <Pressable onPress={onPress} style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`Open recipe ${recipe.title}`}>
        <Image source={{ uri: recipe.image }} style={styles.featuredImage} />
        <View style={styles.featuredScrim} />
        <View style={styles.featuredBody}>
          <Badge label="DISH OF THE DAY" tone="offer" />
          <RNText style={[styles.featuredTitle, { color: "#FFFFFF" }]} numberOfLines={2}>{recipe.title}</RNText>
          <RNText style={[styles.featuredMeta, { color: "#FFFFFF" }]}>
            {`${recipe.minutes} min · ${recipe.ingredients.length} ingredients`}
          </RNText>
        </View>
        <View style={{ position: "absolute", bottom: 12, right: 16 }}>
          <MaterialCommunityIcons name="arrow-right" size={22} color="#FFFFFF" />
        </View>
      </Pressable>
      <Pressable onPress={onSave} accessibilityRole="button" accessibilityLabel={saved ? "Remove from saved" : "Save recipe"} style={styles.featuredSave}>
        <MaterialCommunityIcons name={saved ? "heart" : "heart-outline"} size={22} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: tokens.md, alignItems: "center" },
  grow: { flex: 1, gap: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: tokens.xs, marginTop: 4 },
  thumb: { width: 88, height: 88, borderRadius: 16 },
  featured: { height: 190, borderRadius: tokens.radius.card, overflow: "hidden", borderWidth: 1, borderColor: "#E2E8E1" },
  featuredImage: { width: "100%", height: "100%" },
  featuredScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,20,14,0.45)" },
  featuredBody: { position: "absolute", left: 18, right: 18, bottom: 18, gap: 6 },
  featuredTitle: { fontFamily: tokens.serif, fontSize: 24, fontWeight: "600" },
  featuredMeta: { fontFamily: tokens.sans, fontSize: 12 },
  featuredSave: { position: "absolute", top: 14, right: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.28)", alignItems: "center", justifyContent: "center" },
});
