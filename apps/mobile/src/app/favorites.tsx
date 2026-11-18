import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Badge, Button, Card, Empty, IconButton, Loading, Screen, Text } from "../ui/primitives";
import { tokens } from "../ui/theme";
import { favorites, unfavorite } from "../db/recipes";
import type { Recipe } from "../lib/types";

export default function FavoritesScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRecipes(await favorites());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen
      title="Saved"
      subtitle="Stored on this device. Available offline."
      action={<IconButton icon="refresh" label="Refresh" onPress={() => void load()} />}
    >
      {loading ? <Loading rows={3} /> : null}
      {!loading && !recipes.length ? (
        <Empty icon="heart-outline" title="Nothing saved yet" message="Save a recipe from the search results and it appears here, even without a connection." />
      ) : null}
      {recipes.map((recipe) => (
        <Card key={recipe.id}>
          <View style={styles.row}>
            <Pressable style={styles.grow} onPress={() => router.push({ pathname: "/recipe", params: { id: recipe.id } })}>
              <Text variant="subheading" numberOfLines={2}>{recipe.title}</Text>
              <View style={styles.badges}>
                <Badge label={`${recipe.ingredients.length} ingredients`} />
                <Badge label={`${recipe.minutes} min`} />
              </View>
              <Text variant="caption" color="muted">Tap to add its ingredients to your list.</Text>
            </Pressable>
            <IconButton icon="trash-can-outline" label="Remove saved recipe" onPress={() => void unfavorite(recipe.id).then(load)} />
          </View>
        </Card>
      ))}
      {recipes.length > 0 ? <Button label="Find more recipes" tone="secondary" onPress={() => router.push("/")} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.md },
  grow: { flex: 1, gap: tokens.xs },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: tokens.xs },
});
