import { MaterialCommunityIcons } from "@expo/vector-icons";
import { servingsText } from "@/format";
import { useMemo, useState } from "react";
import { Text as RNText, View } from "react-native";

import type { Api, Idea, RecipeMatch } from "@/api/client";
import { Avatar, Badge, Group, RoundIcon, SkeletonCards, Tap, space } from "@/components/grocery/primitives";
import { ChunkyButton, HelperText, Searchbar, Text } from "@/components/kit";
import { initials, mealTint } from "@/groceryView";
import { entryFromIdea, entryFromRecipe, type MealEntry } from "@/mealplan";
import { usePalette } from "@/theme";

const SHOWN = 8;

function PickRow({ title, meta, seed, onPress, label, idea }: { title: string; meta: string; seed: string; onPress: () => void; label: string; idea?: boolean }) {
  const p = usePalette();
  return (
    <Tap
      onPress={onPress}
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, minHeight: 60 }}
    >
      <Avatar tint={mealTint(seed)} label={initials(title)} size={40} square />
      <View style={{ flex: 1, gap: 2 }}>
        <RNText style={{ color: p.text, fontSize: 15, fontWeight: "700" }} numberOfLines={2}>
          {title}
        </RNText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <RNText style={{ color: p.muted, fontSize: 13 }}>{meta}</RNText>
          {idea ? <Badge tone="accent" label="Idea" icon="creation" /> : null}
        </View>
      </View>
      <MaterialCommunityIcons name="plus-circle" size={26} color={p.accent} />
    </Tap>
  );
}

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
    <View style={{ marginTop: space.md, borderTopWidth: 2, borderTopColor: p.border, paddingTop: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm }}>
        <Text variant="titleSmall" style={{ flex: 1 }}>Choose a recipe</Text>
        <RoundIcon icon="close" onPress={onClose} label="Close the recipe list" />
      </View>
      <Searchbar placeholder="Search recipes" accessibilityLabel="Search recipes" value={query} onChangeText={setQuery} style={{ marginBottom: space.md }} />
      {loading && recipes.length === 0 ? <SkeletonCards count={2} label="Loading recipes" /> : null}
      {matches.length > 0 ? (
        <Group>
          {matches.map((r) => (
            <PickRow
              key={r.id}
              seed={r.id}
              title={r.title}
              meta={`${r.minutes} min · ${servingsText(r.servings)}`}
              label={`Plan ${r.title}`}
              onPress={() => onPick(entryFromRecipe(r))}
            />
          ))}
        </Group>
      ) : null}
      {!loading && matches.length === 0 ? <Text variant="bodyMedium" style={{ color: p.muted, marginBottom: space.md }}>No recipe matches.</Text> : null}
      <ChunkyButton label={asking ? "Thinking…" : "Suggest new ideas"} icon="creation" tone="blue" onPress={askForIdeas} disabled={asking} />
      {message ? <HelperText type="error" visible>{message}</HelperText> : null}
      {ideas.length > 0 ? (
        <View style={{ marginTop: space.md }}>
          <Group>
            {ideas.map((idea) => (
              <PickRow
                key={idea.title}
                idea
                seed={idea.title}
                title={idea.title}
                meta={`${idea.minutes} min · ${servingsText(idea.servings)}`}
                label={`Plan the idea ${idea.title}`}
                onPress={() => onPick(entryFromIdea(idea))}
              />
            ))}
          </Group>
        </View>
      ) : null}
    </View>
  );
}
