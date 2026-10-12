import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { Api, Idea, RecipeMatch } from "@/api/client";
import { HelperText, List, Searchbar, Text } from "@/components/kit";
import { Body, Button, Loading } from "@/components/ui";
import { entryFromIdea, entryFromRecipe, type MealEntry } from "@/mealplan";
import { usePalette } from "@/theme";

const SHOWN = 8;

/** Inline chooser for one day: search the recipes, or ask the language model for new ideas. */
export function MealPicker({
  api,
  recipes,
  loading,
  onPick,
  onClose,
}: {
  api: Api;
  recipes: RecipeMatch[];
  loading: boolean;
  onPick: (entry: MealEntry) => void;
  onClose: () => void;
}) {
  const p = usePalette();
  const [query, setQuery] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? recipes.filter((r) => r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q))) : recipes;
    return list.slice(0, SHOWN);
  }, [query, recipes]);

  async function askForIdeas() {
    setAsking(true);
    setMessage(null);
    try {
      setIdeas(await api.ideas({ count: 3 }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not get ideas");
    } finally {
      setAsking(false);
    }
  }

  return (
    <View style={{ marginTop: 12, borderTopWidth: 2, borderTopColor: p.border, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <Text variant="titleSmall" style={{ flex: 1 }}>Choose a recipe</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the recipe list" hitSlop={10}>
          <MaterialCommunityIcons name="close" size={22} color={p.muted} />
        </Pressable>
      </View>
      <Searchbar placeholder="Search recipes" accessibilityLabel="Search recipes" value={query} onChangeText={setQuery} />
      {loading && recipes.length === 0 ? <Loading /> : null}
      {matches.map((r) => (
        <List.Item
          key={r.id}
          title={r.title}
          description={`${r.minutes} min · ${r.servings} servings`}
          left={() => <List.Icon icon="plus-circle-outline" />}
          onPress={() => onPick(entryFromRecipe(r))}
          accessibilityLabel={`Plan ${r.title}`}
        />
      ))}
      {!loading && matches.length === 0 ? <Body muted>No recipe matches.</Body> : null}
      <View style={{ marginTop: 8 }}>
        <Button label={asking ? "Thinking…" : "Suggest new ideas"} icon="creation" mode="contained-tonal" onPress={askForIdeas} disabled={asking} />
      </View>
      {message ? <HelperText type="error" visible>{message}</HelperText> : null}
      {ideas.map((idea) => (
        <List.Item
          key={idea.title}
          title={idea.title}
          description={`${idea.minutes} min · ${idea.servings} servings · idea`}
          left={() => <List.Icon icon="creation" />}
          onPress={() => onPick(entryFromIdea(idea))}
          accessibilityLabel={`Plan the idea ${idea.title}`}
        />
      ))}
    </View>
  );
}
